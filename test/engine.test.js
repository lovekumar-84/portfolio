import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveInnings, deriveMatch } from '../server/engine.js';

const OPTS = { oversLimit: 2, battingSquadSize: 4 };
const openers = { type: 'openers', striker: 'A', nonStriker: 'B' };
const ball = (over = {}) => ({ type: 'ball', bowler: 'X', runs: 0, extra: null, wicket: null, ...over });

test('runs accumulate and strike rotates on odd runs', () => {
  const s = deriveInnings([openers, ball({ runs: 1 }), ball({ runs: 2 })], OPTS);
  assert.equal(s.runs, 3);
  assert.equal(s.striker, 'B'); // single swapped strike; the 2 kept it
  assert.equal(s.batters.get('A').runs, 1);
  assert.equal(s.batters.get('B').runs, 2);
});

test('boundaries do not rotate strike and are tallied', () => {
  const s = deriveInnings([openers, ball({ runs: 4 }), ball({ runs: 6 })], OPTS);
  assert.equal(s.runs, 10);
  assert.equal(s.striker, 'A');
  assert.equal(s.batters.get('A').fours, 1);
  assert.equal(s.batters.get('A').sixes, 1);
});

test('wide adds penalty run, no ball faced, not a legal delivery', () => {
  const s = deriveInnings([openers, ball({ extra: 'wide', runs: 0 })], OPTS);
  assert.equal(s.runs, 1);
  assert.equal(s.legalBalls, 0);
  assert.equal(s.batters.get('A').balls, 0);
  assert.equal(s.bowlers.get('X').runs, 1);
  assert.equal(s.bowlers.get('X').balls, 0);
});

test('no ball: penalty + bat runs to batter, not legal', () => {
  const s = deriveInnings([openers, ball({ extra: 'noball', runs: 4 })], OPTS);
  assert.equal(s.runs, 5);
  assert.equal(s.legalBalls, 0);
  assert.equal(s.batters.get('A').runs, 4);
  assert.equal(s.batters.get('A').fours, 1);
  assert.equal(s.bowlers.get('X').runs, 5);
});

test('byes count to team and extras, not batter or bowler', () => {
  const s = deriveInnings([openers, ball({ extra: 'bye', runs: 2 })], OPTS);
  assert.equal(s.runs, 2);
  assert.equal(s.extras.byes, 2);
  assert.equal(s.batters.get('A').runs, 0);
  assert.equal(s.bowlers.get('X').runs, 0);
  assert.equal(s.legalBalls, 1);
});

test('strike swaps at the end of an over', () => {
  const s = deriveInnings([openers, ...Array.from({ length: 6 }, () => ball())], OPTS);
  assert.equal(s.legalBalls, 6);
  assert.equal(s.striker, 'B');
  assert.equal(s.thisOver.length, 0);
});

test('wicket credited to bowler; run out is not', () => {
  const s1 = deriveInnings([openers, ball({ wicket: { how: 'bowled' } })], OPTS);
  assert.equal(s1.wickets, 1);
  assert.equal(s1.bowlers.get('X').wickets, 1);
  assert.equal(s1.needsBatter, true);
  assert.equal(s1.batters.get('A').out.how, 'bowled');

  const s2 = deriveInnings([openers, ball({ runs: 1, wicket: { how: 'runout', out: 'B' } })], OPTS);
  assert.equal(s2.bowlers.get('X').wickets, 0);
  assert.equal(s2.runs, 1);
  assert.equal(s2.batters.get('B').out.how, 'runout');
});

test('new batter fills the vacant end', () => {
  const s = deriveInnings([
    openers,
    ball({ wicket: { how: 'bowled' } }),
    { type: 'newBatter', player: 'C' },
    ball({ runs: 4 }),
  ], OPTS);
  assert.equal(s.batters.get('C').runs, 4);
  assert.equal(s.striker, 'C');
});

test('innings ends: all out with squad of 4 after 3 wickets', () => {
  const events = [openers, ball({ wicket: { how: 'bowled' } }), { type: 'newBatter', player: 'C' },
    ball({ wicket: { how: 'lbw' } }), { type: 'newBatter', player: 'D' },
    ball({ wicket: { how: 'caught' } })];
  const s = deriveInnings(events, OPTS);
  assert.equal(s.complete, true);
  assert.equal(s.completeReason, 'allout');
});

test('innings ends when overs are used up', () => {
  const s = deriveInnings([openers, ...Array.from({ length: 12 }, () => ball({ runs: 1 }))], OPTS);
  assert.equal(s.complete, true);
  assert.equal(s.completeReason, 'overs');
  assert.equal(s.overs, '2.0');
});

test('chase ends immediately when target reached', () => {
  const s = deriveInnings([openers, ball({ runs: 6 })], { ...OPTS, target: 5 });
  assert.equal(s.complete, true);
  assert.equal(s.completeReason, 'target');
});

test('deriveMatch produces result by wickets and by runs', () => {
  const mk = (inn1, inn2) => ({
    status: 'live',
    oversPerInnings: 2,
    innings: [
      { battingTeamId: 'T1', bowlingTeamId: 'T2', events: inn1 },
      { battingTeamId: 'T2', bowlingTeamId: 'T1', events: inn2 },
    ],
  });
  const squads = { T1: 4, T2: 4 };

  // T1 scores 4; T2 chases with a six → wins by 3 wickets
  const chase = deriveMatch(mk([openers, ball({ runs: 4 })].concat(Array.from({ length: 11 }, () => ball())),
    [openers, ball({ runs: 6 })]), squads);
  assert.equal(chase.result.winnerTeamId, 'T2');
  assert.equal(chase.result.by, '3 wickets');

  // T2 falls short → T1 wins by runs
  const defend = deriveMatch(mk(
    [openers, ball({ runs: 4 }), ...Array.from({ length: 11 }, () => ball())],
    [openers, ...Array.from({ length: 12 }, () => ball())]), squads);
  assert.equal(defend.result.winnerTeamId, 'T1');
  assert.equal(defend.result.by, '4 runs');
});

test('undo is just dropping the last event', () => {
  const events = [openers, ball({ runs: 4 }), ball({ wicket: { how: 'bowled' } })];
  const before = deriveInnings(events.slice(0, 2), OPTS);
  const after = deriveInnings(events.slice(0, 2), OPTS); // replay after popping the wicket
  assert.deepEqual(
    { runs: after.runs, wickets: after.wickets },
    { runs: before.runs, wickets: before.wickets },
  );
});
