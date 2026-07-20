// Baltic Cricket — zero-dependency HTTP server: REST API + static frontend.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { deriveMatch, WICKET_KINDS } from './engine.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const PUBLIC = join(ROOT, 'public');
const PORT = process.env.PORT || 3000;
const store = new Store(process.env.DB_PATH || join(ROOT, 'data', 'db.json'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function squadSizes(match) {
  const sizes = {};
  for (const teamId of [match.teamAId, match.teamBId]) {
    sizes[teamId] = Math.max(store.teamPlayers(teamId).length, 2);
  }
  return sizes;
}

function matchView(match) {
  const derived = deriveMatch(match, squadSizes(match));
  return {
    ...match,
    derived: {
      ...derived,
      innings: derived.innings.map((inn) => ({
        ...inn,
        batters: Object.fromEntries(inn.batters),
        bowlers: Object.fromEntries(inn.bowlers),
      })),
    },
  };
}

// Auto-advance match state after events are appended.
function reconcile(match) {
  const derived = deriveMatch(match, squadSizes(match));
  const last = derived.innings[derived.innings.length - 1];
  if (match.innings.length === 1 && last?.complete) {
    match.status = 'innings_break';
  } else if (match.innings.length === 2 && last?.complete) {
    match.status = 'completed';
  } else if (match.innings.length > 0) {
    match.status = 'live';
  }
}

const routes = [
  ['GET', /^\/api\/teams$/, () => ({ teams: store.data.teams.map((t) => ({ ...t, players: store.teamPlayers(t.id) })) })],

  ['POST', /^\/api\/teams$/, (m, body) => {
    if (!body.name?.trim()) throw { status: 400, message: 'name required' };
    const team = { id: store.id(), name: body.name.trim(), city: body.city?.trim() || '' };
    store.data.teams.push(team);
    store.save();
    return team;
  }],

  ['POST', /^\/api\/teams\/(\w+)\/players$/, (m, body) => {
    const team = store.team(m[1]);
    if (!team) throw { status: 404, message: 'team not found' };
    if (!body.name?.trim()) throw { status: 400, message: 'name required' };
    const player = { id: store.id(), teamId: team.id, name: body.name.trim() };
    store.data.players.push(player);
    store.save();
    return player;
  }],

  ['GET', /^\/api\/matches$/, () => ({
    matches: store.data.matches.map((m) => {
      const v = matchView(m);
      return { id: m.id, teamAId: m.teamAId, teamBId: m.teamBId, oversPerInnings: m.oversPerInnings, status: m.status, result: v.derived.result };
    }),
  })],

  ['POST', /^\/api\/matches$/, (m, body) => {
    const { teamAId, teamBId, oversPerInnings = 20, tossWonBy, tossDecision } = body;
    if (!store.team(teamAId) || !store.team(teamBId) || teamAId === teamBId) {
      throw { status: 400, message: 'two distinct valid teams required' };
    }
    if (![teamAId, teamBId].includes(tossWonBy) || !['bat', 'bowl'].includes(tossDecision)) {
      throw { status: 400, message: 'toss required: tossWonBy + tossDecision(bat|bowl)' };
    }
    const battingFirst = tossDecision === 'bat' ? tossWonBy : (tossWonBy === teamAId ? teamBId : teamAId);
    const match = {
      id: store.id(),
      teamAId,
      teamBId,
      oversPerInnings: Math.min(Math.max(+oversPerInnings || 20, 1), 50),
      toss: { wonBy: tossWonBy, decision: tossDecision },
      status: 'live',
      createdAt: new Date().toISOString(),
      innings: [{
        battingTeamId: battingFirst,
        bowlingTeamId: battingFirst === teamAId ? teamBId : teamAId,
        events: [],
      }],
    };
    store.data.matches.push(match);
    store.save();
    return matchView(match);
  }],

  ['GET', /^\/api\/matches\/(\w+)$/, (m) => {
    const match = store.match(m[1]);
    if (!match) throw { status: 404, message: 'match not found' };
    return matchView(match);
  }],

  // Append any innings event: openers, newBatter, or ball.
  ['POST', /^\/api\/matches\/(\w+)\/events$/, (m, body) => {
    const match = store.match(m[1]);
    if (!match) throw { status: 404, message: 'match not found' };
    if (match.status === 'completed') throw { status: 400, message: 'match is over' };
    const inn = match.innings[match.innings.length - 1];
    const ev = body.event || {};
    if (!['openers', 'newBatter', 'ball'].includes(ev.type)) {
      throw { status: 400, message: 'event.type must be openers|newBatter|ball' };
    }
    if (ev.type === 'ball') {
      if (!ev.bowler) throw { status: 400, message: 'ball event needs bowler' };
      if (ev.wicket && !WICKET_KINDS.includes(ev.wicket.how)) {
        throw { status: 400, message: `wicket.how must be one of ${WICKET_KINDS.join(',')}` };
      }
    }
    inn.events.push(ev);
    reconcile(match);
    store.save();
    return matchView(match);
  }],

  ['POST', /^\/api\/matches\/(\w+)\/undo$/, (m) => {
    const match = store.match(m[1]);
    if (!match) throw { status: 404, message: 'match not found' };
    const inn = match.innings[match.innings.length - 1];
    if (inn.events.length === 0 && match.innings.length === 2) {
      match.innings.pop(); // undo across the innings break
    } else {
      inn.events.pop();
    }
    reconcile(match);
    store.save();
    return matchView(match);
  }],

  // End the current innings early (declaration, time limit, rain, …).
  // Event-sourced like everything else, so it can be undone.
  ['POST', /^\/api\/matches\/(\w+)\/end-innings$/, (m) => {
    const match = store.match(m[1]);
    if (!match) throw { status: 404, message: 'match not found' };
    if (match.status !== 'live') throw { status: 400, message: 'match is not live' };
    match.innings[match.innings.length - 1].events.push({ type: 'endInnings' });
    reconcile(match);
    store.save();
    return matchView(match);
  }],

  ['POST', /^\/api\/matches\/(\w+)\/start-second-innings$/, (m) => {
    const match = store.match(m[1]);
    if (!match) throw { status: 404, message: 'match not found' };
    if (match.status !== 'innings_break') throw { status: 400, message: 'first innings not finished' };
    const first = match.innings[0];
    match.innings.push({
      battingTeamId: first.bowlingTeamId,
      bowlingTeamId: first.battingTeamId,
      events: [],
    });
    match.status = 'live';
    store.save();
    return matchView(match);
  }],

  ['GET', /^\/api\/leaderboard$/, async () => {
    const { aggregateStats } = await import('./engine.js');
    const rows = aggregateStats(store.data.matches, squadSizes);
    const named = rows.map((r) => {
      const p = store.player(r.player);
      return { ...r, name: p?.name || r.player, teamName: p ? store.team(p.teamId)?.name : '' };
    });
    return {
      batting: [...named].sort((a, b) => b.runs - a.runs).slice(0, 20),
      bowling: [...named].filter((r) => r.wickets > 0 || r.economy !== null).sort((a, b) => b.wickets - a.wickets || a.economy - b.economy).slice(0, 20),
    };
  }],
];

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    for (const [method, pattern, handler] of routes) {
      const m = url.pathname.match(pattern);
      if (m && req.method === method) {
        const body = method === 'POST' ? await readBody(req) : null;
        return json(res, 200, await handler(m, body));
      }
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });

    // Static frontend
    let file = normalize(url.pathname).replace(/^([.\\/])+/, '');
    if (file === '' || file === '/') file = 'index.html';
    const path = join(PUBLIC, file);
    if (path.startsWith(PUBLIC) && existsSync(path)) {
      res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
      return res.end(readFileSync(path));
    }
    // SPA fallback
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(readFileSync(join(PUBLIC, 'index.html')));
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    return json(res, status, { error: err.message || 'server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Baltic Cricket running on http://localhost:${PORT}`);
});
