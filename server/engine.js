// Pure cricket scoring engine.
// An innings is a list of events; the full scorecard state is derived by
// replaying them. Undo = drop the last event.
//
// Event shapes:
//   { type: 'openers', striker, nonStriker }
//   { type: 'newBatter', player }                       // after a wicket
//   { type: 'ball', bowler, runs, extra, wicket }
//     extra:  null | 'wide' | 'noball' | 'bye' | 'legbye'
//     runs:   runs off the bat (normal/noball), or runs physically run (wide/bye/legbye)
//     wicket: null | { how, out, fielder }
//       how: 'bowled'|'caught'|'lbw'|'stumped'|'runout'|'hitwicket'|'retired'

export const WICKET_KINDS = ['bowled', 'caught', 'lbw', 'stumped', 'runout', 'hitwicket', 'retired'];
const BOWLER_CREDITED = new Set(['bowled', 'caught', 'lbw', 'stumped', 'hitwicket']);

export function deriveInnings(events, { oversLimit, battingSquadSize, target = null }) {
  const s = {
    runs: 0,
    wickets: 0,
    legalBalls: 0,
    extras: { wides: 0, noballs: 0, byes: 0, legbyes: 0 },
    batters: new Map(), // player -> { runs, balls, fours, sixes, out: null|{how,fielder,bowler} }
    bowlers: new Map(), // player -> { balls, runs, wickets }
    battingOrder: [],
    striker: null,
    nonStriker: null,
    needsBatter: false,
    fow: [], // { player, runs, wickets, over }
    complete: false,
    completeReason: null,
    thisOver: [], // display tokens for the over in progress
    log: [], // per-delivery commentary feed
  };

  const batter = (p) => {
    if (!s.batters.has(p)) {
      s.batters.set(p, { runs: 0, balls: 0, fours: 0, sixes: 0, out: null });
      s.battingOrder.push(p);
    }
    return s.batters.get(p);
  };
  const bowler = (p) => {
    if (!s.bowlers.has(p)) s.bowlers.set(p, { balls: 0, runs: 0, wickets: 0 });
    return s.bowlers.get(p);
  };
  const overStr = () => `${Math.floor(s.legalBalls / 6)}.${s.legalBalls % 6}`;
  const finish = (reason) => {
    s.complete = true;
    s.completeReason = reason;
  };

  for (const ev of events) {
    if (s.complete) break;

    if (ev.type === 'endInnings') {
      finish('declared');
      continue;
    }

    if (ev.type === 'openers') {
      batter(ev.striker);
      batter(ev.nonStriker);
      s.striker = ev.striker;
      s.nonStriker = ev.nonStriker;
      continue;
    }

    if (ev.type === 'newBatter') {
      batter(ev.player);
      if (s.striker === null) s.striker = ev.player;
      else s.nonStriker = ev.player;
      s.needsBatter = false;
      s.log.push({ type: 'newBatter', over: null, player: ev.player });
      continue;
    }

    if (ev.type !== 'ball') continue;

    const { runs = 0, extra = null, wicket = null } = ev;
    const bw = bowler(ev.bowler);
    const bt = batter(s.striker);
    const strikerAtDelivery = s.striker;
    const ballLabel = `${Math.floor(s.legalBalls / 6) + 1}.${(s.legalBalls % 6) + 1}`;
    const legal = extra !== 'wide' && extra !== 'noball';
    let ranRuns = runs; // physical runs that rotate strike

    if (extra === 'wide') {
      s.runs += 1 + runs;
      s.extras.wides += 1 + runs;
      bw.runs += 1 + runs;
      s.thisOver.push(runs ? `${runs}wd` : 'wd');
    } else if (extra === 'noball') {
      s.runs += 1 + runs;
      s.extras.noballs += 1;
      bw.runs += 1 + runs;
      bt.runs += runs;
      bt.balls += 1;
      if (runs === 4) bt.fours += 1;
      if (runs === 6) bt.sixes += 1;
      s.thisOver.push(runs ? `${runs}nb` : 'nb');
    } else if (extra === 'bye' || extra === 'legbye') {
      s.runs += runs;
      s.extras[extra === 'bye' ? 'byes' : 'legbyes'] += runs;
      bt.balls += 1;
      s.thisOver.push(`${runs}${extra === 'bye' ? 'b' : 'lb'}`);
    } else {
      s.runs += runs;
      bt.runs += runs;
      bt.balls += 1;
      bw.runs += runs;
      if (runs === 4) bt.fours += 1;
      if (runs === 6) bt.sixes += 1;
      s.thisOver.push(String(runs));
    }

    if (legal) {
      s.legalBalls += 1;
      bw.balls += 1;
    }
    if (runs === 4 || runs === 6) ranRuns = 0; // boundaries: no physical crossing

    if (wicket) {
      s.wickets += 1;
      const outPlayer = wicket.out || s.striker;
      const credited = BOWLER_CREDITED.has(wicket.how);
      batter(outPlayer).out = {
        how: wicket.how,
        fielder: wicket.fielder || null,
        bowler: credited ? ev.bowler : null,
      };
      if (credited) bw.wickets += 1;
      s.fow.push({ player: outPlayer, runs: s.runs, wickets: s.wickets, over: overStr() });
      s.thisOver[s.thisOver.length - 1] += 'W';
      if (outPlayer === s.striker) s.striker = null;
      else s.nonStriker = null;
      s.needsBatter = true;
    } else if (ranRuns % 2 === 1) {
      [s.striker, s.nonStriker] = [s.nonStriker, s.striker];
    }

    s.log.push({
      type: 'ball',
      over: ballLabel,
      bowler: ev.bowler,
      striker: strikerAtDelivery,
      runs,
      extra,
      wicket: wicket ? { how: wicket.how, out: wicket.out || strikerAtDelivery } : null,
      token: s.thisOver[s.thisOver.length - 1],
    });

    // Terminal conditions, checked after every delivery.
    if (target !== null && s.runs >= target) finish('target');
    else if (s.wickets >= battingSquadSize - 1) finish('allout');
    else if (s.legalBalls >= oversLimit * 6) finish('overs');

    if (!s.complete && legal && s.legalBalls % 6 === 0) {
      [s.striker, s.nonStriker] = [s.nonStriker, s.striker];
      s.thisOver = [];
    }
  }

  s.overs = overStr();
  s.runRate = s.legalBalls ? +(s.runs / (s.legalBalls / 6)).toFixed(2) : 0;
  return s;
}

export function deriveMatch(match, squads) {
  // squads: { [teamId]: playerCount }
  const out = { innings: [], status: match.status, result: null, target: null };
  let target = null;
  for (let i = 0; i < match.innings.length; i++) {
    const inn = match.innings[i];
    const derived = deriveInnings(inn.events, {
      oversLimit: match.oversPerInnings,
      battingSquadSize: squads[inn.battingTeamId],
      target: i === 1 ? target : null,
    });
    derived.battingTeamId = inn.battingTeamId;
    derived.bowlingTeamId = inn.bowlingTeamId;
    out.innings.push(derived);
    if (i === 0) target = derived.runs + 1;
  }
  out.target = target;

  if (out.innings.length === 2) {
    const [first, second] = out.innings;
    if (second.runs >= target) {
      const inHand = squads[second.battingTeamId] - 1 - second.wickets;
      out.result = { winnerTeamId: second.battingTeamId, by: `${inHand} wicket${inHand === 1 ? '' : 's'}` };
    } else if (second.complete) {
      if (second.runs === first.runs) out.result = { winnerTeamId: null, by: 'match tied' };
      else {
        const margin = first.runs - second.runs;
        out.result = { winnerTeamId: first.battingTeamId, by: `${margin} run${margin === 1 ? '' : 's'}` };
      }
    }
  }
  return out;
}

// Career aggregates across completed matches for the leaderboard.
export function aggregateStats(matches, squadSizes) {
  const stats = new Map(); // playerId -> { runs, balls, fours, sixes, outs, wickets, ballsBowled, runsConceded, matches: Set }
  const get = (p) => {
    if (!stats.has(p)) {
      stats.set(p, { runs: 0, balls: 0, fours: 0, sixes: 0, outs: 0, batInns: 0, bowlInns: 0, wickets: 0, ballsBowled: 0, runsConceded: 0, matches: new Set() });
    }
    return stats.get(p);
  };
  for (const match of matches) {
    if (match.status !== 'completed') continue;
    const derived = deriveMatch(match, squadSizes(match));
    for (const inn of derived.innings) {
      for (const [p, b] of inn.batters) {
        const st = get(p);
        st.runs += b.runs;
        st.balls += b.balls;
        st.fours += b.fours;
        st.sixes += b.sixes;
        st.batInns += 1;
        if (b.out && b.out.how !== 'retired') st.outs += 1;
        st.matches.add(match.id);
      }
      for (const [p, bw] of inn.bowlers) {
        const st = get(p);
        st.wickets += bw.wickets;
        st.bowlInns += 1;
        st.ballsBowled += bw.balls;
        st.runsConceded += bw.runs;
        st.matches.add(match.id);
      }
    }
  }
  const rows = [];
  for (const [player, st] of stats) {
    rows.push({
      player,
      matches: st.matches.size,
      innings: st.batInns,
      bowlInnings: st.bowlInns,
      runs: st.runs,
      balls: st.balls,
      strikeRate: st.balls ? +((st.runs / st.balls) * 100).toFixed(1) : 0,
      average: st.outs ? +(st.runs / st.outs).toFixed(1) : null,
      fours: st.fours,
      sixes: st.sixes,
      wickets: st.wickets,
      economy: st.ballsBowled ? +(st.runsConceded / (st.ballsBowled / 6)).toFixed(2) : null,
    });
  }
  return rows;
}

// League standings: 2 pts a win, 1 a tie/no-result. NRR per standard rules —
// a side bowled out is charged its full over quota, not the overs it survived.
export function pointsTable(matches, squadSizes) {
  const table = new Map();
  const row = (t) => {
    if (!table.has(t)) {
      table.set(t, { teamId: t, played: 0, won: 0, lost: 0, tied: 0, noResult: 0, points: 0, runsFor: 0, ballsFor: 0, runsAgainst: 0, ballsAgainst: 0 });
    }
    return table.get(t);
  };
  for (const match of matches) {
    if (match.status !== 'completed') continue;
    const d = deriveMatch(match, squadSizes(match));
    if (d.innings.length < 2) continue;
    const a = d.innings[0].battingTeamId;
    const b = d.innings[1].battingTeamId;
    row(a).played += 1;
    row(b).played += 1;
    if (!d.result || !d.result.winnerTeamId) {
      const key = d.result ? 'tied' : 'noResult';
      for (const t of [a, b]) { row(t)[key] += 1; row(t).points += 1; }
    } else {
      row(d.result.winnerTeamId).won += 1;
      row(d.result.winnerTeamId).points += 2;
      row(d.result.winnerTeamId === a ? b : a).lost += 1;
    }
    for (const inn of d.innings) {
      const balls = inn.completeReason === 'allout' ? match.oversPerInnings * 6 : inn.legalBalls;
      row(inn.battingTeamId).runsFor += inn.runs;
      row(inn.battingTeamId).ballsFor += balls;
      row(inn.bowlingTeamId).runsAgainst += inn.runs;
      row(inn.bowlingTeamId).ballsAgainst += balls;
    }
  }
  return [...table.values()]
    .map((r) => ({
      ...r,
      nrr: r.ballsFor && r.ballsAgainst
        ? +((r.runsFor / (r.ballsFor / 6)) - (r.runsAgainst / (r.ballsAgainst / 6))).toFixed(3)
        : 0,
    }))
    .sort((x, y) => y.points - x.points || y.nrr - x.nrr);
}
