/* Baltic Cricket — mobile-first SPA (no framework, no build step) */
const app = document.getElementById('app');
let teamsCache = null;

const api = async (path, opts = {}) => {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'request failed');
  return data;
};

const getTeams = async (force = false) => {
  if (!teamsCache || force) teamsCache = (await api('/teams')).teams;
  return teamsCache;
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function playerName(teams, id) {
  for (const t of teams) {
    const p = t.players.find((p) => p.id === id);
    if (p) return p.name;
  }
  return id || '—';
}
const teamById = (teams, id) => teams.find((t) => t.id === id);

/* ---------- modal ---------- */
function modal(title, bodyHtml, onMount) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal"><h2>${esc(title)}</h2>${bodyHtml}</div>`;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
  onMount?.(backdrop);
  return backdrop;
}

function pickPlayer(title, players, cb) {
  const m = modal(title, `<div class="choice-grid">${players.map((p) =>
    `<button data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div>`);
  m.querySelectorAll('button[data-id]').forEach((b) =>
    b.addEventListener('click', () => { m.remove(); cb(b.dataset.id); }));
}

/* ---------- routing ---------- */
const routes = [
  [/^#?\/?$/, renderMatches, 'matches'],
  [/^#\/teams$/, renderTeams, 'teams'],
  [/^#\/new-match$/, renderNewMatch, 'matches'],
  [/^#\/match\/(\w+)$/, (m) => renderMatch(m[1]), 'matches'],
  [/^#\/leaderboard$/, renderLeaderboard, 'leaderboard'],
];

async function route() {
  const hash = location.hash || '#/';
  for (const [pattern, handler, nav] of routes) {
    const m = hash.match(pattern);
    if (m) {
      document.querySelectorAll('nav a').forEach((a) =>
        a.classList.toggle('active', a.dataset.nav === nav));
      try {
        await handler(m);
      } catch (err) {
        app.innerHTML = `<div class="card">⚠️ ${esc(err.message)}</div>`;
      }
      return;
    }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', route);

/* ---------- matches list ---------- */
async function renderMatches() {
  const [teams, { matches }] = await Promise.all([getTeams(), api('/matches')]);
  app.innerHTML = `
    <button class="primary" style="width:100%" onclick="location.hash='#/new-match'">＋ New match</button>
    <div class="card" style="margin-top:0.8rem">
      <h2>Matches</h2>
      ${matches.length === 0 ? '<p class="muted">No matches yet. Create teams, then start your first match.</p>' : ''}
      ${matches.slice().reverse().map((m) => {
        const a = teamById(teams, m.teamAId)?.name || '?';
        const b = teamById(teams, m.teamBId)?.name || '?';
        const result = m.result ? (m.result.winnerTeamId
          ? `${esc(teamById(teams, m.result.winnerTeamId)?.name)} won by ${esc(m.result.by)}`
          : esc(m.result.by)) : '';
        return `<div class="list-item" onclick="location.hash='#/match/${m.id}'">
          <div><strong>${esc(a)} vs ${esc(b)}</strong><br>
          <span class="muted">${m.oversPerInnings} overs${result ? ' · ' + result : ''}</span></div>
          <span class="badge ${m.status === 'live' ? 'live' : m.status === 'completed' ? 'completed' : ''}">${m.status.replace('_', ' ')}</span>
        </div>`;
      }).join('')}
    </div>`;
}

/* ---------- teams ---------- */
async function renderTeams() {
  const teams = await getTeams(true);
  app.innerHTML = `
    <div class="card">
      <h2>Add team</h2>
      <div class="row">
        <input id="team-name" class="grow" placeholder="Team name (e.g. Vilnius CC)">
        <input id="team-city" class="grow" placeholder="City (e.g. Riga, Tallinn)">
        <button class="primary" id="add-team">Add</button>
      </div>
    </div>
    ${teams.map((t) => `
      <div class="card">
        <div class="row spread">
          <h2>${esc(t.name)} ${t.city ? `<span class="muted">· ${esc(t.city)}</span>` : ''}</h2>
          <span class="badge">${t.players.length} players</span>
        </div>
        ${t.players.map((p) => `<div class="list-item" style="cursor:default">${esc(p.name)}</div>`).join('')}
        <div class="row" style="margin-top:0.6rem">
          <input class="grow" placeholder="Player name" data-team="${t.id}">
          <button class="info" data-add-player="${t.id}">Add player</button>
        </div>
      </div>`).join('')}`;

  document.getElementById('add-team').addEventListener('click', async () => {
    const name = document.getElementById('team-name').value;
    if (!name.trim()) return;
    await api('/teams', { method: 'POST', body: { name, city: document.getElementById('team-city').value } });
    renderTeams();
  });
  app.querySelectorAll('[data-add-player]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const teamId = btn.dataset.addPlayer;
      const input = app.querySelector(`input[data-team="${teamId}"]`);
      if (!input.value.trim()) return;
      await api(`/teams/${teamId}/players`, { method: 'POST', body: { name: input.value } });
      renderTeams();
    }));
}

/* ---------- new match ---------- */
async function renderNewMatch() {
  const teams = await getTeams(true);
  const ready = teams.filter((t) => t.players.length >= 2);
  if (ready.length < 2) {
    app.innerHTML = `<div class="card"><h2>New match</h2>
      <p class="muted">You need at least two teams with 2+ players each.
      <a href="#/teams" style="color:var(--accent2)">Create teams first →</a></p></div>`;
    return;
  }
  const opts = ready.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  app.innerHTML = `<div class="card"><h2>New match</h2>
    <label>Team A</label><select id="team-a">${opts}</select>
    <label>Team B</label><select id="team-b">${opts}</select>
    <label>Overs per innings</label>
    <select id="overs"><option>5</option><option>6</option><option>8</option><option selected>10</option><option>15</option><option>20</option><option>30</option><option>40</option><option>50</option></select>
    <label>Toss won by</label><select id="toss-won"><option value="A">Team A</option><option value="B">Team B</option></select>
    <label>Decision</label><select id="toss-dec"><option value="bat">Bat first</option><option value="bowl">Bowl first</option></select>
    <button class="primary" style="width:100%;margin-top:1rem" id="start">Start match</button></div>`;
  document.getElementById('team-b').selectedIndex = Math.min(1, ready.length - 1);
  document.getElementById('start').addEventListener('click', async () => {
    const teamAId = document.getElementById('team-a').value;
    const teamBId = document.getElementById('team-b').value;
    if (teamAId === teamBId) return alert('Pick two different teams');
    const match = await api('/matches', {
      method: 'POST',
      body: {
        teamAId, teamBId,
        oversPerInnings: +document.getElementById('overs').value,
        tossWonBy: document.getElementById('toss-won').value === 'A' ? teamAId : teamBId,
        tossDecision: document.getElementById('toss-dec').value,
      },
    });
    location.hash = `#/match/${match.id}`;
  });
}

/* ---------- match / scoring ---------- */
async function renderMatch(id) {
  const [teams, match] = await Promise.all([getTeams(), api(`/matches/${id}`)]);
  const inn = match.derived.innings[match.derived.innings.length - 1];
  const rawInn = match.innings[match.innings.length - 1];
  const batTeam = teamById(teams, inn.battingTeamId);
  const bowlTeam = teamById(teams, inn.bowlingTeamId);
  const name = (pid) => playerName(teams, pid);

  const header = `
    <div class="card">
      <div class="row spread">
        <div>
          <div class="muted">${esc(batTeam.name)} batting · ${match.oversPerInnings} ov ${match.derived.target && match.innings.length === 2 ? `· target ${match.derived.target}` : ''}</div>
          <div class="scoreline">${inn.runs}/${inn.wickets} <small>(${inn.overs} ov, RR ${inn.runRate})</small></div>
        </div>
        <button class="ghost" onclick="location.hash='#/'">‹ Back</button>
      </div>
      <div class="balls">${inn.thisOver.map((b) => `<span class="ball-chip ${b.includes('W') ? 'w' : b === '4' ? 'four' : b === '6' ? 'six' : ''}">${esc(b)}</span>`).join('')}</div>
    </div>`;

  /* completed */
  if (match.status === 'completed') {
    const r = match.derived.result;
    app.innerHTML = `
      <div class="card"><h2>${r ? (r.winnerTeamId ? `🏆 ${esc(teamById(teams, r.winnerTeamId).name)} won by ${esc(r.by)}` : esc(r.by)) : 'Match over'}</h2>
      <button class="ghost" onclick="location.hash='#/'">‹ Back to matches</button></div>
      ${match.derived.innings.map((i) => scorecardHtml(i, teams)).join('')}`;
    return;
  }

  /* innings break */
  if (match.status === 'innings_break') {
    app.innerHTML = `${header}
      <div class="card"><h2>End of innings — ${esc(bowlTeam.name)} need ${inn.runs + 1} to win</h2>
      <button class="primary" style="width:100%" id="start-2nd">Start 2nd innings</button></div>
      ${scorecardHtml(inn, teams)}`;
    document.getElementById('start-2nd').addEventListener('click', async () => {
      await api(`/matches/${id}/start-second-innings`, { method: 'POST' });
      renderMatch(id);
    });
    return;
  }

  const post = async (event) => { await api(`/matches/${id}/events`, { method: 'POST', body: { event } }); renderMatch(id); };

  /* openers not set */
  if (!rawInn.events.some((e) => e.type === 'openers')) {
    app.innerHTML = header + `<div class="card"><h2>Pick opening batters</h2><p class="muted">Tap the striker first, then the non-striker.</p></div>`;
    pickPlayer('Striker', batTeam.players, (striker) => {
      pickPlayer('Non-striker', batTeam.players.filter((p) => p.id !== striker), (nonStriker) => {
        post({ type: 'openers', striker, nonStriker });
      });
    });
    return;
  }

  /* wicket fell → need replacement */
  if (inn.needsBatter) {
    const available = batTeam.players.filter((p) => !(p.id in inn.batters));
    app.innerHTML = header + `<div class="card"><h2>Wicket! Pick the next batter.</h2></div>`;
    pickPlayer('Next batter', available, (pid) => post({ type: 'newBatter', player: pid }));
    return;
  }

  /* figure out the current bowler; ask at the start of each over */
  const ballEvents = rawInn.events.filter((e) => e.type === 'ball');
  const lastBall = ballEvents[ballEvents.length - 1];
  const startOfOver = inn.thisOver.length === 0;
  let bowlerId = !startOfOver && lastBall ? lastBall.bowler : sessionStorage.getItem(`bowler:${id}:${match.innings.length}:${Math.floor(inn.legalBalls / 6)}`);

  const batterRow = (pid, star) => {
    const b = inn.batters[pid];
    return b ? `<tr class="${star ? 'active' : ''}"><td>${esc(name(pid))}${star ? ' *' : ''}</td><td class="num">${b.runs}</td><td class="num">${b.balls}</td><td class="num">${b.fours}/${b.sixes}</td></tr>` : '';
  };
  const bw = bowlerId ? inn.bowlers[bowlerId] : null;

  app.innerHTML = `${header}
    <div class="card">
      <table>
        <tr><th>Batter</th><th class="num">R</th><th class="num">B</th><th class="num">4s/6s</th></tr>
        ${batterRow(inn.striker, true)}${batterRow(inn.nonStriker, false)}
      </table>
      <h3>Bowling${bowlerId ? `: ${esc(name(bowlerId))} ${bw ? `${Math.floor(bw.balls / 6)}.${bw.balls % 6}-${bw.runs}-${bw.wickets}` : ''}` : ''}</h3>
      <div class="pad">
        ${[0, 1, 2, 3].map((r) => `<button data-runs="${r}">${r}</button>`).join('')}
        <button class="info" data-runs="4">4</button>
        <button data-runs="5">5</button>
        <button class="primary" data-runs="6">6</button>
        <button class="danger" id="wicket">OUT</button>
        <button class="warn" data-extra="wide">Wide</button>
        <button class="warn" data-extra="noball">No ball</button>
        <button data-extra="bye">Bye</button>
        <button data-extra="legbye">Leg bye</button>
      </div>
      <div class="row" style="margin-top:0.6rem">
        <button class="ghost grow" id="undo">↩ Undo</button>
        <button class="ghost grow" id="change-bowler">Change bowler</button>
      </div>
    </div>
    ${scorecardHtml(inn, teams)}`;

  const needBowler = (cb) => {
    if (bowlerId) return cb(bowlerId);
    const lastOverBowler = startOfOver && lastBall ? lastBall.bowler : null;
    pickPlayer('Who bowls this over?', bowlTeam.players.filter((p) => p.id !== lastOverBowler), (pid) => {
      sessionStorage.setItem(`bowler:${id}:${match.innings.length}:${Math.floor(inn.legalBalls / 6)}`, pid);
      cb(pid);
    });
  };

  app.querySelectorAll('[data-runs]').forEach((b) =>
    b.addEventListener('click', () => needBowler((bowler) =>
      post({ type: 'ball', bowler, runs: +b.dataset.runs, extra: null, wicket: null }))));

  app.querySelectorAll('[data-extra]').forEach((b) =>
    b.addEventListener('click', () => needBowler((bowler) => {
      const extra = b.dataset.extra;
      const label = { wide: 'Runs run on the wide (besides the 1 penalty)', noball: 'Runs off the bat (besides the 1 penalty)', bye: 'Byes run', legbye: 'Leg byes run' }[extra];
      const m = modal(label, `<div class="choice-grid">${[0, 1, 2, 3, 4].map((r) => `<button data-r="${r}">${r}</button>`).join('')}</div>`);
      m.querySelectorAll('[data-r]').forEach((rb) => rb.addEventListener('click', () => {
        m.remove();
        post({ type: 'ball', bowler, runs: +rb.dataset.r, extra, wicket: null });
      }));
    })));

  document.getElementById('wicket').addEventListener('click', () => needBowler((bowler) => {
    const kinds = ['bowled', 'caught', 'lbw', 'stumped', 'runout', 'hitwicket', 'retired'];
    const m = modal('How out?', `<div class="choice-grid">${kinds.map((k) => `<button data-k="${k}">${k}</button>`).join('')}</div>`);
    m.querySelectorAll('[data-k]').forEach((kb) => kb.addEventListener('click', () => {
      const how = kb.dataset.k;
      m.remove();
      const finishWicket = (out, runs = 0) => post({ type: 'ball', bowler, runs, extra: null, wicket: { how, out } });
      if (how === 'runout') {
        pickPlayer('Who was run out?', [inn.striker, inn.nonStriker].map((pid) => ({ id: pid, name: name(pid) })), (out) => {
          const rm = modal('Runs completed before the run out', `<div class="choice-grid">${[0, 1, 2, 3].map((r) => `<button data-r="${r}">${r}</button>`).join('')}</div>`);
          rm.querySelectorAll('[data-r]').forEach((rb) => rb.addEventListener('click', () => { rm.remove(); finishWicket(out, +rb.dataset.r); }));
        });
      } else {
        finishWicket(null);
      }
    }));
  }));

  document.getElementById('undo').addEventListener('click', async () => {
    await api(`/matches/${id}/undo`, { method: 'POST' });
    renderMatch(id);
  });
  document.getElementById('change-bowler').addEventListener('click', () => {
    sessionStorage.removeItem(`bowler:${id}:${match.innings.length}:${Math.floor(inn.legalBalls / 6)}`);
    pickPlayer('Bowler', bowlTeam.players, (pid) => {
      sessionStorage.setItem(`bowler:${id}:${match.innings.length}:${Math.floor(inn.legalBalls / 6)}`, pid);
      renderMatch(id);
    });
  });
}

function scorecardHtml(inn, teams) {
  const name = (pid) => playerName(teams, pid);
  const outDesc = (o) => {
    if (!o) return 'not out';
    if (o.how === 'runout') return 'run out';
    if (o.how === 'retired') return 'retired';
    return `${o.how}${o.fielder ? ` (c ${name(o.fielder)})` : ''} b ${name(o.bowler)}`;
  };
  const batTeam = teamById(teams, inn.battingTeamId);
  return `<div class="card">
    <h2>${esc(batTeam?.name || '')} — ${inn.runs}/${inn.wickets} (${inn.overs})</h2>
    <table>
      <tr><th>Batter</th><th></th><th class="num">R</th><th class="num">B</th></tr>
      ${inn.battingOrder.map((pid) => {
        const b = inn.batters[pid] || (inn.batters.get && inn.batters.get(pid));
        return `<tr><td>${esc(name(pid))}</td><td class="muted">${esc(outDesc(b.out))}</td><td class="num">${b.runs}</td><td class="num">${b.balls}</td></tr>`;
      }).join('')}
    </table>
    <p class="muted" style="margin-top:0.4rem">Extras: ${inn.extras.wides} wd, ${inn.extras.noballs} nb, ${inn.extras.byes} b, ${inn.extras.legbyes} lb</p>
    <h3>Bowling</h3>
    <table>
      <tr><th>Bowler</th><th class="num">O</th><th class="num">R</th><th class="num">W</th></tr>
      ${Object.entries(inn.bowlers).map(([pid, bw]) =>
        `<tr><td>${esc(name(pid))}</td><td class="num">${Math.floor(bw.balls / 6)}.${bw.balls % 6}</td><td class="num">${bw.runs}</td><td class="num">${bw.wickets}</td></tr>`).join('')}
    </table>
    ${inn.fow.length ? `<p class="muted" style="margin-top:0.4rem">FoW: ${inn.fow.map((f) => `${f.runs}/${f.wickets} (${esc(name(f.player))}, ${f.over})`).join(' · ')}</p>` : ''}
  </div>`;
}

/* ---------- leaderboard ---------- */
async function renderLeaderboard() {
  const { batting, bowling } = await api('/leaderboard');
  const rows = (list, cols) => list.length === 0
    ? '<p class="muted">Complete a match to see stats.</p>'
    : `<table><tr>${cols.map((c) => `<th class="${c[2] || ''}">${c[0]}</th>`).join('')}</tr>
       ${list.map((r) => `<tr>${cols.map((c) => `<td class="${c[2] || ''}">${esc(c[1](r) ?? '—')}</td>`).join('')}</tr>`).join('')}</table>`;
  app.innerHTML = `
    <div class="card"><h2>🏏 Most runs</h2>
      ${rows(batting.filter((r) => r.runs > 0 || r.balls > 0), [
        ['Player', (r) => `${r.name} (${r.teamName})`],
        ['M', (r) => r.matches, 'num'],
        ['Runs', (r) => r.runs, 'num'],
        ['SR', (r) => r.strikeRate, 'num'],
        ['Avg', (r) => r.average, 'num'],
      ])}
    </div>
    <div class="card"><h2>⚡ Most wickets</h2>
      ${rows(bowling, [
        ['Player', (r) => `${r.name} (${r.teamName})`],
        ['M', (r) => r.matches, 'num'],
        ['Wkts', (r) => r.wickets, 'num'],
        ['Econ', (r) => r.economy, 'num'],
      ])}
    </div>`;
}

route();
