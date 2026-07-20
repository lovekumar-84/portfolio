# 🏏 Baltic Cricket

A grassroots cricket scoring app — a CricHeroes-style MVP built to be field-tested
with cricket communities in the Baltic states (Lithuania, Latvia, Estonia).

**Zero dependencies.** Plain Node.js backend + vanilla JS mobile-first frontend.
No build step, no database server — clone and run.

## Quick start

```bash
npm start          # → http://localhost:3000
npm test           # scoring-engine unit tests
```

Open it on your phone (same Wi-Fi: `http://<your-ip>:3000`) — the UI is built
for one-thumb scoring at the ground.

**Admin access:** adding teams and players requires an admin login (👤 button,
top right). The default password is `cricket123`; override it for real
deployments with `ADMIN_PASSWORD=yoursecret npm start`.

## What it does today (MVP)

| Feature | Status |
|---|---|
| Teams & player rosters | ✅ |
| Limited-overs match setup (1–50 overs) with toss | ✅ |
| Ball-by-ball scoring: runs, 4s/6s, wides, no-balls, byes, leg-byes | ✅ |
| Wickets: bowled, caught, lbw, stumped, run out, hit wicket, retired | ✅ |
| Strike rotation, over changes, bowler figures | ✅ |
| Undo any ball (event-sourced — the scorecard is replayed from events) | ✅ |
| Live scorecard, fall of wickets, extras, run rate, target/chase | ✅ |
| Automatic result (win by runs / wickets / tie) | ✅ |
| Career leaderboards: most runs, strike rate, most wickets, economy | ✅ |

## Architecture

```
server/engine.js   Pure scoring engine. An innings = a list of events
                   (openers, newBatter, ball). All state is derived by
                   replay — undo is just "drop the last event".
server/store.js    JSON-file persistence (data/db.json). Swap for
                   Postgres/SQLite behind the same interface later.
server/index.js    Zero-dependency HTTP server: REST API + static files.
public/            Mobile-first single-page app (no framework).
test/              node:test unit tests for the engine.
```

### API sketch

```
GET  /api/teams                         POST /api/teams {name, city}
POST /api/teams/:id/players {name}
GET  /api/matches                       POST /api/matches {teamAId, teamBId, oversPerInnings, tossWonBy, tossDecision}
GET  /api/matches/:id                   POST /api/matches/:id/events {event}
POST /api/matches/:id/undo              POST /api/matches/:id/start-second-innings
GET  /api/leaderboard
```

## Roadmap: Baltic launch

**Phase 1 — validate with one league (now).** Deploy this MVP (a single
`node server/index.js` on any €5 VPS, Fly.io or Railway), hand it to scorers at
one club — e.g. via the Lithuanian Cricket Federation, Latvian Cricket
Federation, or Estonian Cricket Association — and watch a real match being
scored. The goal is learning what scorers actually need, not features.

**Phase 2 — make it a real product.**
- Accounts & auth (magic-link email keeps it simple), player claims their profile
- PostgreSQL instead of the JSON file; websockets for live-score spectators
- PWA manifest + offline-first scoring (grounds often have poor connectivity)
- Tournaments: fixtures, points tables, net run rate
- i18n: EN first (cricket vocabulary is English anyway), then LT/LV/ET UI strings
- GDPR basics before public launch: consent, data export/delete (players are EU residents)

**Phase 3 — the CricHeroes-like layer.** Match feeds, photos, MVP ratings,
looking-for-a-team, club pages, sponsor banners for local leagues.

## Why the Baltics first

Small but growing cricket communities (largely South Asian expat–driven) in
Vilnius, Kaunas, Riga and Tallinn, with national federations and organized
summer leagues — big enough to test with real matches every weekend, small
enough that you can talk to every captain personally.
