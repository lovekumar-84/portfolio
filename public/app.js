/* Baltic Cricket — mobile-first SPA (no framework, no build step) */
const app = document.getElementById('app');
let teamsCache = null;

const isAdmin = () => !!localStorage.getItem('adminToken');

const api = async (path, opts = {}) => {
  const token = localStorage.getItem('adminToken');
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'request failed');
  return data;
};

/* ---------- admin login ---------- */
function setAdminUi() {
  const btn = document.getElementById('admin-btn');
  btn.textContent = isAdmin() ? '👤 Admin' : '👤';
  btn.classList.toggle('on', isAdmin());
}

document.getElementById('back-btn').addEventListener('click', () => {
  if (location.hash && location.hash !== '#/') history.back();
  else location.hash = '#/';
});

document.getElementById('admin-btn').addEventListener('click', () => {
  if (isAdmin()) {
    const m = modal('Admin', `<p class="muted" style="margin-bottom:0.8rem">You are logged in as admin.</p>
      <div class="choice-grid"><button class="danger" id="logout">Log out</button><button id="stay">Stay logged in</button></div>`);
    m.querySelector('#logout').addEventListener('click', () => {
      localStorage.removeItem('adminToken');
      m.remove();
      setAdminUi();
      route();
    });
    m.querySelector('#stay').addEventListener('click', () => m.remove());
    return;
  }
  const m = modal('Admin login', `
    <label>Password</label><input id="admin-pass" type="password" placeholder="Admin password">
    <p class="muted" style="margin:0.5rem 0">Admins can add teams and players.</p>
    <button class="primary" style="width:100%" id="do-login">Log in</button>`);
  m.querySelector('#do-login').addEventListener('click', async () => {
    try {
      const { token } = await api('/admin/login', { method: 'POST', body: { password: m.querySelector('#admin-pass').value } });
      localStorage.setItem('adminToken', token);
      m.remove();
      setAdminUi();
      route();
    } catch (err) {
      alert(err.message);
    }
  });
});

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
  [/^#\/team\/(\w+)$/, (m) => renderTeamDetail(m[1]), 'teams'],
  [/^#\/new-match$/, renderNewMatch, 'matches'],
  [/^#\/match\/(\w+)$/, (m) => renderMatch(m[1]), 'matches'],
  [/^#\/leaderboard$/, renderLeaderboard, 'leaderboard'],
  [/^#\/tournaments$/, renderTournaments, 'tournaments'],
  [/^#\/tournament\/(\w+)$/, (m) => renderTournament(m[1]), 'tournaments'],
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

/* ---------- home ---------- */
function fmtWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function matchCard(m, teams, tournaments) {
  const league = tournaments?.find((t) => t.id === m.tournamentId);
  const date = m.createdAt ? new Date(m.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
  const result = m.result ? (m.result.winnerTeamId
    ? `${esc(teamById(teams, m.result.winnerTeamId)?.name)} won by ${esc(m.result.by)}`
    : esc(m.result.by)) : '';
  const scoreRow = (teamId) => {
    const inn = m.innings.find((i) => i.battingTeamId === teamId);
    return `<div class="row spread score-row">
      <strong>${esc(teamById(teams, teamId)?.name || '?')}</strong>
      <span>${inn ? `<strong>${inn.runs}/${inn.wickets}</strong> <span class="muted">(${inn.overs} ov)</span>` : '<span class="muted">yet to bat</span>'}</span>
    </div>`;
  };
  // batting-first team on top
  const order = m.innings.length ? [m.innings[0].battingTeamId, m.innings[0].battingTeamId === m.teamAId ? m.teamBId : m.teamAId] : [m.teamAId, m.teamBId];
  const badge = m.status === 'live' ? 'live' : m.status === 'completed' ? 'completed' : m.status === 'upcoming' ? 'upcoming' : '';
  return `<div class="card match-card" onclick="location.hash='#/match/${m.id}'">
    <div class="row spread" style="margin-bottom:0.4rem">
      <span class="muted">${league ? esc(league.name) : 'Friendly'} · ${m.oversPerInnings} ov${date ? ' · ' + date : ''}</span>
      <span class="badge ${badge}">${m.status.replace('_', ' ')}</span>
    </div>
    ${order.map(scoreRow).join('')}
    ${m.status === 'upcoming'
      ? `<div class="muted" style="margin-top:0.4rem">🕐 ${m.scheduledAt ? `Scheduled to begin at ${fmtWhen(m.scheduledAt)}` : 'Not started yet — tap to record the toss'}</div>`
      : result ? `<div class="muted" style="margin-top:0.4rem">${result}</div>` : ''}
  </div>`;
}

async function renderMatches() {
  const [teams, { matches }, { tournaments }] = await Promise.all([getTeams(), api('/matches'), api('/tournaments')]);
  const live = matches.filter((m) => m.status === 'live' || m.status === 'innings_break');
  const upcoming = matches.filter((m) => m.status === 'upcoming')
    .sort((a, b) => (a.scheduledAt || a.createdAt || '').localeCompare(b.scheduledAt || b.createdAt || ''));
  const past = matches.filter((m) => m.status === 'completed').slice().reverse();
  const section = (title, cards) => cards.length
    ? `<h2 class="section-title">${title}</h2>${cards}` : '';
  app.innerHTML = `
    <button class="primary" style="width:100%;margin-bottom:0.8rem" onclick="location.hash='#/new-match'">＋ New match</button>
    ${matches.length === 0 ? '<div class="card"><p class="muted">Welcome! Create teams, then start or schedule your first match.</p></div>' : ''}
    ${section('🔴 Live now', live.map((m) => matchCard(m, teams, tournaments)).join(''))}
    ${section('🕐 Upcoming matches', upcoming.map((m) => matchCard(m, teams, tournaments)).join(''))}
    ${tournaments.length ? `<h2 class="section-title">🏆 Leagues</h2>
      <div class="card">${tournaments.map((t) => `<div class="list-item" onclick="event.stopPropagation();location.hash='#/tournament/${t.id}'">
        <strong>${esc(t.name)}</strong><span class="badge">${t.matches} matches</span></div>`).join('')}
      </div>` : ''}
    ${section('✅ Recent results', past.slice(0, 5).map((m) => matchCard(m, teams, tournaments)).join(''))}
    ${past.length > 5 ? `<p class="muted" style="text-align:center">…and ${past.length - 5} more in each league's Matches tab</p>` : ''}`;
}

/* ---------- teams ---------- */
async function renderTeams() {
  const teams = await getTeams(true);
  app.innerHTML = `
    ${isAdmin() ? `<div class="card">
      <h2>Add team</h2>
      <div class="row">
        <input id="team-name" class="grow" placeholder="Team name (e.g. Vilnius CC)">
        <input id="team-city" class="grow" placeholder="City (e.g. Riga, Tallinn)">
        <button class="primary" id="add-team">Add</button>
      </div>
    </div>` : ''}
    <div class="card">
      <h2>Teams</h2>
      ${teams.length === 0 ? `<p class="muted">No teams yet.${isAdmin() ? '' : ' Log in as admin (👤 top right) to add teams.'}</p>` : ''}
      ${teams.map((t) => `<div class="list-item" onclick="location.hash='#/team/${t.id}'">
        <strong>${esc(t.name)}</strong>${t.city ? `<span class="muted">${esc(t.city)}</span>` : ''}
      </div>`).join('')}
    </div>`;

  document.getElementById('add-team')?.addEventListener('click', async () => {
    const name = document.getElementById('team-name').value;
    if (!name.trim()) return;
    await api('/teams', { method: 'POST', body: { name, city: document.getElementById('team-city').value } });
    renderTeams();
  });
}

async function renderTeamDetail(id) {
  const [teams, lb, { matches }] = await Promise.all([getTeams(true), api('/leaderboard'), api('/matches')]);
  const team = teamById(teams, id);
  if (!team) { app.innerHTML = '<div class="card">Team not found.</div>'; return; }

  // team totals across completed matches
  let played = 0, won = 0, totalRuns = 0;
  for (const m of matches) {
    if (m.teamAId !== id && m.teamBId !== id) continue;
    if (m.status !== 'completed') continue;
    played += 1;
    if (m.result?.winnerTeamId === id) won += 1;
    for (const inn of m.innings) if (inn.battingTeamId === id) totalRuns += inn.runs;
  }
  const teamLb = {
    batting: lb.batting.filter((r) => r.teamId === id),
    bowling: lb.bowling.filter((r) => r.teamId === id),
  };
  app.innerHTML = `
    <div class="card">
      <h2>${esc(team.name)} ${team.city ? `<span class="muted">· ${esc(team.city)}</span>` : ''}</h2>
      <p class="muted" style="margin-top:0.3rem">Matches: ${played} · Won: ${won} · Total runs: ${totalRuns}</p>
    </div>
    <div class="card">
      <h2>Squad (${team.players.length})</h2>
      ${team.players.length === 0 ? '<p class="muted">No players yet.</p>' : ''}
      ${team.players.map((p) => `<div class="list-item" style="cursor:default">${esc(p.name)}</div>`).join('')}
      ${isAdmin() ? `<div class="row" style="margin-top:0.6rem">
        <input class="grow" id="new-player" placeholder="Player name">
        <button class="info" id="add-player">Add player</button>
      </div>` : ''}
    </div>
    ${played || teamLb.batting.length ? leaderboardCards(teamLb) : ''}`;

  document.getElementById('add-player')?.addEventListener('click', async () => {
    const input = document.getElementById('new-player');
    if (!input.value.trim()) return;
    await api(`/teams/${id}/players`, { method: 'POST', body: { name: input.value } });
    renderTeamDetail(id);
  });
}

/* ---------- new match ---------- */
async function renderNewMatch() {
  const [teams, { tournaments }] = await Promise.all([getTeams(true), api('/tournaments')]);
  const ready = teams.filter((t) => t.players.length >= 2);
  if (ready.length < 2 && !isAdmin()) {
    app.innerHTML = `<div class="card"><h2>New match</h2>
      <p class="muted">You need at least two teams with 2+ players each.
      Ask an admin to add them (👤 top right).</p></div>`;
    return;
  }
  const newTeamOpt = isAdmin() ? '<option value="__new__">＋ Create new team…</option>' : '';
  const newTeamRow = (side) => `<div id="new-team-${side}-row" style="display:none">
    <label>New team ${side.toUpperCase()} name</label><input id="new-team-${side}-name" placeholder="Team name">
    <label>Players (comma separated, min 2)</label><input id="new-team-${side}-players" placeholder="e.g. Rony, Anand, Tanvir">
  </div>`;
  const opts = ready.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('') + newTeamOpt;
  app.innerHTML = `<div class="card"><h2>New match</h2>
    <label>League</label>
    <select id="tourn">
      <option value="">Friendly (no league)</option>
      ${tournaments.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}
      <option value="__new__">＋ Create new league…</option>
    </select>
    <div id="new-league-row" style="display:none"><label>New league name</label>
      <input id="new-league-name" placeholder="e.g. Baltic Premier Liiga"></div>
    <label>Team A</label><select id="team-a">${opts}</select>
    ${newTeamRow('a')}
    <label>Team B</label><select id="team-b">${opts}</select>
    ${newTeamRow('b')}
    <label>Overs per innings</label>
    <select id="overs"><option>5</option><option>6</option><option>8</option><option selected>10</option><option>15</option><option>20</option><option>30</option><option>40</option><option>50</option></select>
    <label>When</label>
    <select id="when"><option value="now">Start now (toss done)</option><option value="later">Schedule for later</option></select>
    <div id="toss-rows">
      <label>Toss won by</label><select id="toss-won"><option value="A">Team A</option><option value="B">Team B</option></select>
      <label>Decision</label><select id="toss-dec"><option value="bat">Bat first</option><option value="bowl">Bowl first</option></select>
    </div>
    <div id="schedule-row" style="display:none">
      <label>Start time</label><input id="start-time" type="datetime-local">
    </div>
    <button class="primary" style="width:100%;margin-top:1rem" id="start">Start match</button></div>`;
  document.getElementById('team-b').selectedIndex = Math.min(1, ready.length - 1);

  const whenSel = document.getElementById('when');
  const startBtn = document.getElementById('start');
  whenSel.addEventListener('change', () => {
    const later = whenSel.value === 'later';
    document.getElementById('toss-rows').style.display = later ? 'none' : '';
    document.getElementById('schedule-row').style.display = later ? '' : 'none';
    startBtn.textContent = later ? 'Schedule match' : 'Start match';
  });
  document.getElementById('tourn').addEventListener('change', (e) => {
    document.getElementById('new-league-row').style.display = e.target.value === '__new__' ? '' : 'none';
  });
  const updateTossLabels = () => {
    const nameOf = (side) => {
      const v = document.getElementById(`team-${side}`).value;
      if (v === '__new__') return document.getElementById(`new-team-${side}-name`).value.trim() || `Team ${side.toUpperCase()}`;
      return teamById(teams, v)?.name || `Team ${side.toUpperCase()}`;
    };
    const tossSel = document.getElementById('toss-won');
    tossSel.options[0].text = nameOf('a');
    tossSel.options[1].text = nameOf('b');
  };
  for (const side of ['a', 'b']) {
    document.getElementById(`team-${side}`).addEventListener('change', (e) => {
      document.getElementById(`new-team-${side}-row`).style.display = e.target.value === '__new__' ? '' : 'none';
      updateTossLabels();
    });
    document.getElementById(`new-team-${side}-name`).addEventListener('input', updateTossLabels);
  }
  updateTossLabels();

  // Resolve a side to a team id, creating the team (with roster) if "new" chosen.
  const resolveTeam = async (side) => {
    const sel = document.getElementById(`team-${side}`).value;
    if (sel !== '__new__') return sel;
    const name = document.getElementById(`new-team-${side}-name`).value;
    const players = document.getElementById(`new-team-${side}-players`).value.split(',').map((s) => s.trim()).filter(Boolean);
    if (!name.trim()) throw new Error(`Give team ${side.toUpperCase()} a name`);
    if (players.length < 2) throw new Error(`Team ${side.toUpperCase()} needs at least 2 players`);
    return (await api('/teams', { method: 'POST', body: { name, players } })).id;
  };

  startBtn.addEventListener('click', async () => {
    let teamAId, teamBId;
    try {
      teamAId = await resolveTeam('a');
      teamBId = await resolveTeam('b');
    } catch (err) {
      return alert(err.message);
    }
    if (teamAId === teamBId) return alert('Pick two different teams');
    let tournamentId = document.getElementById('tourn').value || null;
    if (tournamentId === '__new__') {
      const name = document.getElementById('new-league-name').value;
      if (!name.trim()) return alert('Give the new league a name');
      tournamentId = (await api('/tournaments', { method: 'POST', body: { name } })).id;
    }
    const later = whenSel.value === 'later';
    const body = {
      teamAId, teamBId, tournamentId,
      oversPerInnings: +document.getElementById('overs').value,
    };
    if (later) {
      const t = document.getElementById('start-time').value;
      body.scheduledAt = t ? new Date(t).toISOString() : null;
    } else {
      body.tossWonBy = document.getElementById('toss-won').value === 'A' ? teamAId : teamBId;
      body.tossDecision = document.getElementById('toss-dec').value;
    }
    const match = await api('/matches', { method: 'POST', body });
    location.hash = later ? '#/' : `#/match/${match.id}`;
    if (later) route();
  });
}

/* ---------- match / scoring ---------- */
let matchTab = 'live';
let matchTabFor = null;

function tabBar(tabs, active, id) {
  return `<div class="tabs">${tabs.map(([key, label]) =>
    `<button class="${key === active ? 'active' : ''}" data-tab="${key}">${label}</button>`).join('')}</div>`;
}

function wireTabs(id) {
  app.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => { matchTab = b.dataset.tab; renderMatch(id); }));
}

async function renderMatch(id) {
  if (matchTabFor !== id) { matchTab = 'live'; matchTabFor = id; }
  const [teams, match] = await Promise.all([getTeams(), api(`/matches/${id}`)]);

  /* scheduled, not started yet: record the toss to begin */
  if (match.status === 'upcoming') {
    const a = teamById(teams, match.teamAId);
    const b = teamById(teams, match.teamBId);
    app.innerHTML = `
      <div class="card">
        <div class="row spread">
          <h2 style="margin:0">${esc(a.name)} vs ${esc(b.name)}</h2>
          <button class="ghost" onclick="location.hash='#/'">‹ Back</button>
        </div>
        <p class="muted" style="margin-top:0.4rem">${match.oversPerInnings} overs${match.scheduledAt ? ` · scheduled for ${fmtWhen(match.scheduledAt)}` : ''}</p>
      </div>
      <div class="card"><h2>Record the toss to start</h2>
        <label>Toss won by</label>
        <select id="toss-won"><option value="${a.id}">${esc(a.name)}</option><option value="${b.id}">${esc(b.name)}</option></select>
        <label>Decision</label>
        <select id="toss-dec"><option value="bat">Bat first</option><option value="bowl">Bowl first</option></select>
        <button class="primary" style="width:100%;margin-top:1rem" id="start-match">Start match</button>
      </div>`;
    document.getElementById('start-match').addEventListener('click', async () => {
      await api(`/matches/${id}/start`, {
        method: 'POST',
        body: { tossWonBy: document.getElementById('toss-won').value, tossDecision: document.getElementById('toss-dec').value },
      });
      renderMatch(id);
    });
    return;
  }

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
    </div>`;

  const allScorecards = () => match.derived.innings.map((i) => scorecardHtml(i, teams)).join('');
  const allCommentary = () => match.derived.innings.slice().reverse().map((i) =>
    `<div class="card"><h2>${esc(teamById(teams, i.battingTeamId)?.name)} innings</h2>${commentaryHtml(i, teams)}</div>`).join('');

  /* completed */
  if (match.status === 'completed') {
    const r = match.derived.result;
    if (matchTab === 'live') matchTab = 'scorecard';
    app.innerHTML = `
      <div class="card"><h2>${r ? (r.winnerTeamId ? `🏆 ${esc(teamById(teams, r.winnerTeamId).name)} won by ${esc(r.by)}` : esc(r.by)) : 'Match over'}</h2>
      <button class="ghost" onclick="location.hash='#/'">‹ Back to matches</button></div>
      ${tabBar([['scorecard', 'Scorecard'], ['commentary', 'Commentary']], matchTab, id)}
      ${matchTab === 'commentary' ? allCommentary() : allScorecards()}`;
    wireTabs(id);
    return;
  }

  /* innings break */
  if (match.status === 'innings_break') {
    app.innerHTML = `${header}
      <div class="card"><h2>End of innings — ${esc(bowlTeam.name)} need ${inn.runs + 1} to win</h2>
      <button class="primary" style="width:100%" id="start-2nd">Start 2nd innings</button></div>
      ${tabBar([['scorecard', 'Scorecard'], ['commentary', 'Commentary']], matchTab === 'commentary' ? 'commentary' : 'scorecard', id)}
      ${matchTab === 'commentary' ? allCommentary() : allScorecards()}`;
    wireTabs(id);
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

  const liveCard = `
    <div class="card">
      <table>
        <tr><th>Batter</th><th class="num">R</th><th class="num">B</th><th class="num">4s/6s</th></tr>
        ${batterRow(inn.striker, true)}${batterRow(inn.nonStriker, false)}
      </table>
      <h3>Bowling${bowlerId ? `: ${esc(name(bowlerId))} ${bw ? `${Math.floor(bw.balls / 6)}.${bw.balls % 6}-${bw.runs}-${bw.wickets}` : ''}` : ''}</h3>
      <div class="balls">${inn.thisOver.length ? inn.thisOver.map((b) => ballChip(b)).join('') : '<span class="muted">New over</span>'}</div>
      <div class="pad">
        ${[0, 1, 2, 3].map((r) => `<button data-runs="${r}">${r}</button>`).join('')}
        <button class="info" data-runs="4">4</button>
        <button class="primary" data-runs="6">6</button>
        <button class="danger" id="wicket" style="grid-column:span 2">OUT</button>
        <button class="warn" data-extra="wide">Wide</button>
        <button class="warn" data-extra="noball">No ball</button>
        <button data-extra="bye">Bye</button>
        <button data-extra="legbye">Leg bye</button>
      </div>
      <div class="row" style="margin-top:0.6rem">
        <button class="ghost grow" id="undo">↩ Undo</button>
        <button class="ghost grow" id="change-bowler">Change bowler</button>
        <button class="ghost grow" id="end-innings" style="color:var(--danger)">⏹ End ${match.innings.length === 1 ? 'innings' : 'match'}</button>
      </div>
    </div>`;

  app.innerHTML = `${header}
    ${tabBar([['live', 'Live'], ['scorecard', 'Scorecard'], ['commentary', 'Commentary']], matchTab, id)}
    ${matchTab === 'scorecard' ? allScorecards() : matchTab === 'commentary' ? allCommentary() : liveCard}`;
  wireTabs(id);
  if (matchTab !== 'live') return;

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
      const choices = extra === 'bye' || extra === 'legbye' ? [1, 2, 3, 4] : [0, 1, 2, 3, 4];
      const m = modal(label, `<div class="choice-grid">${choices.map((r) => `<button data-r="${r}">${r}</button>`).join('')}</div>`);
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
  document.getElementById('end-innings').addEventListener('click', () => {
    const second = match.innings.length === 2;
    const m = modal(second ? 'End the match now?' : 'End the innings now?',
      `<p class="muted" style="margin-bottom:0.8rem">${esc(batTeam.name)} will finish on ${inn.runs}/${inn.wickets} (${inn.overs} ov).
       ${second ? 'The result will be decided on the current scores.' : `${esc(bowlTeam.name)} will bat next.`}
       You can undo this afterwards.</p>
       <div class="choice-grid">
         <button class="danger" id="confirm-end">Yes, end ${second ? 'match' : 'innings'}</button>
         <button id="cancel-end">Cancel</button>
       </div>`);
    m.querySelector('#cancel-end').addEventListener('click', () => m.remove());
    m.querySelector('#confirm-end').addEventListener('click', async () => {
      m.remove();
      await api(`/matches/${id}/end-innings`, { method: 'POST' });
      renderMatch(id);
    });
  });
  document.getElementById('change-bowler').addEventListener('click', () => {
    sessionStorage.removeItem(`bowler:${id}:${match.innings.length}:${Math.floor(inn.legalBalls / 6)}`);
    pickPlayer('Bowler', bowlTeam.players, (pid) => {
      sessionStorage.setItem(`bowler:${id}:${match.innings.length}:${Math.floor(inn.legalBalls / 6)}`, pid);
      renderMatch(id);
    });
  });
}

function ballChip(b) {
  const cls = b.includes('W') ? 'w' : b === '4' ? 'four' : b === '6' ? 'six' : '';
  return `<span class="ball-chip ${cls}">${esc(b)}</span>`;
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
      <tr><th>Batter</th><th class="num">R</th><th class="num">B</th><th class="num">4s</th><th class="num">6s</th><th class="num">SR</th></tr>
      ${inn.battingOrder.map((pid) => {
        const b = inn.batters[pid];
        const sr = b.balls ? ((b.runs / b.balls) * 100).toFixed(0) : '—';
        return `<tr><td><strong>${esc(name(pid))}</strong><br><span class="muted">${esc(outDesc(b.out))}</span></td>
          <td class="num"><strong>${b.runs}</strong></td><td class="num">${b.balls}</td>
          <td class="num">${b.fours}</td><td class="num">${b.sixes}</td><td class="num">${sr}</td></tr>`;
      }).join('')}
    </table>
    <p class="muted" style="margin-top:0.4rem">Extras: ${inn.extras.wides} wd, ${inn.extras.noballs} nb, ${inn.extras.byes} b, ${inn.extras.legbyes} lb</p>
    <h3>Bowling</h3>
    <table>
      <tr><th>Bowler</th><th class="num">O</th><th class="num">R</th><th class="num">W</th><th class="num">Econ</th></tr>
      ${Object.entries(inn.bowlers).map(([pid, bw]) =>
        `<tr><td>${esc(name(pid))}</td><td class="num">${Math.floor(bw.balls / 6)}.${bw.balls % 6}</td><td class="num">${bw.runs}</td><td class="num">${bw.wickets}</td><td class="num">${bw.balls ? (bw.runs / (bw.balls / 6)).toFixed(1) : '—'}</td></tr>`).join('')}
    </table>
    ${inn.fow.length ? `<p class="muted" style="margin-top:0.4rem">FoW: ${inn.fow.map((f) => `${f.runs}/${f.wickets} (${esc(name(f.player))}, ${f.over})`).join(' · ')}</p>` : ''}
  </div>`;
}

/* CricHeroes-style ball-by-ball feed, newest first, grouped by over */
function commentaryHtml(inn, teams) {
  const name = (pid) => playerName(teams, pid);
  const desc = (e) => {
    if (e.wicket) {
      const w = e.wicket.how === 'runout' ? `run out (${name(e.wicket.out)})` : e.wicket.how;
      return `<strong>OUT!</strong> ${esc(w)}${e.runs ? `, ${e.runs} run${e.runs > 1 ? 's' : ''}` : ''}`;
    }
    if (e.extra === 'wide') return `wide${e.runs ? `, ${e.runs} extra run${e.runs > 1 ? 's' : ''}` : ''}`;
    if (e.extra === 'noball') return `no ball${e.runs ? `, ${e.runs} off the bat` : ''}`;
    if (e.extra === 'bye') return `${e.runs} bye${e.runs !== 1 ? 's' : ''}`;
    if (e.extra === 'legbye') return `${e.runs} leg bye${e.runs !== 1 ? 's' : ''}`;
    if (e.runs === 0) return 'no run';
    if (e.runs === 4) return '<strong>FOUR!</strong>';
    if (e.runs === 6) return '<strong>SIX!</strong>';
    return `${e.runs} run${e.runs > 1 ? 's' : ''}`;
  };

  // group ball entries into overs
  const overs = [];
  for (const e of inn.log) {
    if (e.type === 'newBatter') {
      (overs[overs.length - 1] || (overs[overs.length] = { n: 1, balls: [] })).balls.push(e);
      continue;
    }
    const n = +e.over.split('.')[0];
    if (!overs.length || overs[overs.length - 1].n !== n) overs.push({ n, balls: [] });
    overs[overs.length - 1].balls.push(e);
  }

  if (!overs.length) return '<p class="muted">No balls bowled yet.</p>';

  return overs.slice().reverse().map((ov) => {
    const balls = ov.balls.filter((e) => e.type !== 'newBatter');
    const runs = balls.reduce((t, e) => t + e.runs + (e.extra === 'wide' || e.extra === 'noball' ? 1 : 0), 0);
    const wkts = balls.filter((e) => e.wicket).length;
    return `
      <div class="over-head"><span>Over ${ov.n} — ${runs} run${runs !== 1 ? 's' : ''}${wkts ? `, ${wkts} wkt${wkts > 1 ? 's' : ''}` : ''}</span>
        <span class="balls">${balls.map((e) => ballChip(e.token)).join('')}</span></div>
      ${ov.balls.slice().reverse().map((e) => e.type === 'newBatter'
        ? `<div class="comm-item"><span class="comm-over"></span><div class="muted">${esc(name(e.player))} comes to the crease</div></div>`
        : `<div class="comm-item"><span class="comm-over">${esc(e.over)}</span>${ballChip(e.token)}
           <div>${esc(name(e.bowler))} to ${esc(name(e.striker))}, ${desc(e)}</div></div>`).join('')}`;
  }).join('');
}

/* ---------- leaderboards (shared by Stats page and league pages) ---------- */
function leaderboardCards(lb) {
  const rankRow = (r, i, statsLine) => `
    <div class="rank-item">
      <span class="rank-no">${String(i + 1).padStart(2, '0')}</span>
      <div class="grow">
        <strong>${esc(r.name)}</strong> <span class="muted">(${esc(r.teamName)})</span>
        <div class="muted">${statsLine}</div>
      </div>
    </div>`;
  return `
    <div class="card"><h2>🏏 Batting — most runs</h2>
      ${lb.batting.length === 0 ? '<p class="muted">Complete a match to see stats.</p>' : ''}
      ${lb.batting.map((r, i) => rankRow(r, i,
        `Inn: ${r.innings} · <strong>Runs: ${r.runs}</strong> · Avg: ${r.average ?? '—'} · SR: ${r.strikeRate}`)).join('')}
    </div>
    <div class="card"><h2>⚡ Bowling — most wickets</h2>
      ${lb.bowling.length === 0 ? '<p class="muted">Complete a match to see stats.</p>' : ''}
      ${lb.bowling.map((r, i) => rankRow(r, i,
        `Inn: ${r.bowlInnings} · <strong>Wkts: ${r.wickets}</strong> · Econ: ${r.economy ?? '—'}`)).join('')}
    </div>`;
}

async function renderLeaderboard() {
  const [teams, { matches }] = await Promise.all([getTeams(), api('/matches')]);
  const rows = teams.map((t) => {
    let played = 0, won = 0, totalRuns = 0, wktsTaken = 0;
    for (const m of matches) {
      if (m.teamAId !== t.id && m.teamBId !== t.id) continue;
      if (m.status !== 'completed') continue;
      played += 1;
      if (m.result?.winnerTeamId === t.id) won += 1;
      for (const inn of m.innings) {
        if (inn.battingTeamId === t.id) totalRuns += inn.runs;
        else wktsTaken += inn.wickets;
      }
    }
    return { team: t, played, won, totalRuns, wktsTaken };
  }).sort((a, b) => b.won - a.won || b.totalRuns - a.totalRuns);
  app.innerHTML = `
    <div class="card">
      <h2>📊 Team stats</h2>
      <p class="muted" style="margin-bottom:0.5rem">Tap a team for its full scorecard and player stats.</p>
      ${rows.length === 0 ? '<p class="muted">No teams yet.</p>' : ''}
      ${rows.map((r) => `<div class="list-item" onclick="location.hash='#/team/${r.team.id}'">
        <div><strong>${esc(r.team.name)}</strong><br>
          <span class="muted">P: ${r.played} · W: ${r.won} · Runs scored: ${r.totalRuns} · Wkts taken: ${r.wktsTaken}</span></div>
        <span class="badge">${r.team.players.length} players</span>
      </div>`).join('')}
    </div>`;
}

/* ---------- leagues ---------- */
async function renderTournaments() {
  const { tournaments } = await api('/tournaments');
  app.innerHTML = `
    <div class="card">
      <h2>Create league</h2>
      <div class="row">
        <input id="tourn-name" class="grow" placeholder="League name (e.g. Baltic Premier Liiga)">
        <button class="primary" id="add-tourn">Create</button>
      </div>
    </div>
    <div class="card">
      <h2>Leagues</h2>
      ${tournaments.length === 0 ? '<p class="muted">No leagues yet. Create one, then pick it when starting a match.</p>' : ''}
      ${tournaments.map((t) => `<div class="list-item" onclick="location.hash='#/tournament/${t.id}'">
        <strong>${esc(t.name)}</strong><span class="badge">${t.matches} matches</span>
      </div>`).join('')}
    </div>`;
  document.getElementById('add-tourn').addEventListener('click', async () => {
    const name = document.getElementById('tourn-name').value;
    if (!name.trim()) return;
    await api('/tournaments', { method: 'POST', body: { name } });
    renderTournaments();
  });
}

let tournTab = 'matches';
let tournTabFor = null;

async function renderTournament(id) {
  if (tournTabFor !== id) { tournTab = 'matches'; tournTabFor = id; }
  const [teams, t] = await Promise.all([getTeams(), api(`/tournaments/${id}`)]);
  const pointsHtml = t.points.length === 0
    ? '<div class="card"><p class="muted">The table appears once a league match is completed.</p></div>'
    : `<div class="card"><h2>Points table</h2>
      <table>
        <tr><th>Team</th><th class="num">M</th><th class="num">W</th><th class="num">L</th><th class="num">T</th><th class="num">Pts</th><th class="num">NRR</th></tr>
        ${t.points.map((r) => `<tr><td><strong>${esc(r.teamName)}</strong></td>
          <td class="num">${r.played}</td><td class="num">${r.won}</td><td class="num">${r.lost}</td>
          <td class="num">${r.tied + r.noResult}</td><td class="num"><strong>${r.points}</strong></td>
          <td class="num">${r.nrr > 0 ? '+' : ''}${r.nrr.toFixed(3)}</td></tr>`).join('')}
      </table>
      <p class="muted" style="margin-top:0.4rem">Win 2 pts · tie/no result 1 pt · ranked by points, then net run rate.</p>
    </div>`;
  app.innerHTML = `
    <div class="card row spread">
      <h2 style="margin:0">🏆 ${esc(t.name)}</h2>
      <button class="ghost" onclick="location.hash='#/tournaments'">‹ Leagues</button>
    </div>
    ${tabBar([['matches', 'Matches'], ['points', 'Points Table'], ['stats', 'Leaderboard']], tournTab)}
    ${tournTab === 'points' ? pointsHtml
      : tournTab === 'stats' ? leaderboardCards(t.leaderboard)
      : (t.matches.length === 0 ? '<div class="card"><p class="muted">No matches yet — start one and pick this league.</p></div>'
        : t.matches.slice().reverse().map((m) => matchCard(m, teams)).join(''))}`;
  app.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => { tournTab = b.dataset.tab; renderTournament(id); }));
}

setAdminUi();
route();
