// Baltic Cricket — zero-dependency HTTP server: REST API + static frontend.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { deriveMatch, aggregateStats, pointsTable, WICKET_KINDS } from './engine.js';

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

function matchSummary(m) {
  const derived = deriveMatch(m, squadSizes(m));
  return {
    id: m.id,
    teamAId: m.teamAId,
    teamBId: m.teamBId,
    oversPerInnings: m.oversPerInnings,
    status: m.status,
    createdAt: m.createdAt,
    scheduledAt: m.scheduledAt || null,
    tournamentId: m.tournamentId || null,
    result: derived.result,
    innings: derived.innings.map((inn) => ({
      battingTeamId: inn.battingTeamId,
      runs: inn.runs,
      wickets: inn.wickets,
      overs: inn.overs,
    })),
  };
}

function leaderboards(matches) {
  const rows = aggregateStats(matches, squadSizes);
  const named = rows.map((r) => {
    const p = store.player(r.player);
    return { ...r, name: p?.name || r.player, teamName: p ? store.team(p.teamId)?.name : '' };
  });
  return {
    batting: [...named].filter((r) => r.innings > 0).sort((a, b) => b.runs - a.runs).slice(0, 25),
    bowling: [...named].filter((r) => r.bowlInnings > 0).sort((a, b) => b.wickets - a.wickets || a.economy - b.economy).slice(0, 25),
  };
}

function startMatch(match, tossWonBy, tossDecision) {
  if (![match.teamAId, match.teamBId].includes(tossWonBy) || !['bat', 'bowl'].includes(tossDecision)) {
    throw { status: 400, message: 'toss required: tossWonBy + tossDecision(bat|bowl)' };
  }
  const battingFirst = tossDecision === 'bat' ? tossWonBy : (tossWonBy === match.teamAId ? match.teamBId : match.teamAId);
  match.toss = { wonBy: tossWonBy, decision: tossDecision };
  match.status = 'live';
  match.innings = [{
    battingTeamId: battingFirst,
    bowlingTeamId: battingFirst === match.teamAId ? match.teamBId : match.teamAId,
    events: [],
  }];
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

  ['GET', /^\/api\/matches$/, () => ({ matches: store.data.matches.map(matchSummary) })],

  ['GET', /^\/api\/tournaments$/, () => ({
    tournaments: store.data.tournaments.map((t) => ({
      ...t,
      matches: store.data.matches.filter((m) => m.tournamentId === t.id).length,
    })),
  })],

  ['POST', /^\/api\/tournaments$/, (m, body) => {
    if (!body.name?.trim()) throw { status: 400, message: 'name required' };
    const t = { id: store.id(), name: body.name.trim(), createdAt: new Date().toISOString() };
    store.data.tournaments.push(t);
    store.save();
    return t;
  }],

  ['GET', /^\/api\/tournaments\/(\w+)$/, (m) => {
    const t = store.data.tournaments.find((x) => x.id === m[1]);
    if (!t) throw { status: 404, message: 'tournament not found' };
    const matches = store.data.matches.filter((x) => x.tournamentId === t.id);
    const points = pointsTable(matches, squadSizes).map((r) => ({ ...r, teamName: store.team(r.teamId)?.name || r.teamId }));
    return { ...t, matches: matches.map(matchSummary), points, leaderboard: leaderboards(matches) };
  }],

  // Create a match. With a toss it goes live immediately; without one it is
  // scheduled as 'upcoming' (optionally with a scheduledAt start time) and
  // goes live later via /start, when the toss actually happens.
  ['POST', /^\/api\/matches$/, (m, body) => {
    const { teamAId, teamBId, oversPerInnings = 20, tossWonBy, tossDecision, tournamentId = null, scheduledAt = null } = body;
    if (!store.team(teamAId) || !store.team(teamBId) || teamAId === teamBId) {
      throw { status: 400, message: 'two distinct valid teams required' };
    }
    if (tournamentId && !store.data.tournaments.some((t) => t.id === tournamentId)) {
      throw { status: 400, message: 'unknown tournament' };
    }
    const match = {
      id: store.id(),
      teamAId,
      teamBId,
      tournamentId,
      oversPerInnings: Math.min(Math.max(+oversPerInnings || 20, 1), 50),
      toss: null,
      status: 'upcoming',
      createdAt: new Date().toISOString(),
      scheduledAt: scheduledAt || null,
      innings: [],
    };
    store.data.matches.push(match);
    if (tossWonBy) startMatch(match, tossWonBy, tossDecision);
    store.save();
    return matchView(match);
  }],

  ['POST', /^\/api\/matches\/(\w+)\/start$/, (m, body) => {
    const match = store.match(m[1]);
    if (!match) throw { status: 404, message: 'match not found' };
    if (match.status !== 'upcoming') throw { status: 400, message: 'match already started' };
    startMatch(match, body.tossWonBy, body.tossDecision);
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
    if (match.innings.length === 0) throw { status: 400, message: 'match not started — record the toss first' };
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
    if (match.innings.length === 0) throw { status: 400, message: 'nothing to undo' };
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

  ['GET', /^\/api\/leaderboard$/, () => leaderboards(store.data.matches)],
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
