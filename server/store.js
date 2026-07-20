// Minimal JSON-file persistence. Fine for MVP field testing; swap for
// Postgres/SQLite behind the same interface when real traffic arrives.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const EMPTY = { teams: [], players: [], matches: [] };

export class Store {
  constructor(path) {
    this.path = path;
    if (existsSync(path)) {
      this.data = JSON.parse(readFileSync(path, 'utf8'));
    } else {
      this.data = structuredClone(EMPTY);
    }
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }

  id() {
    return randomUUID().slice(0, 8);
  }

  team(id) {
    return this.data.teams.find((t) => t.id === id);
  }

  player(id) {
    return this.data.players.find((p) => p.id === id);
  }

  match(id) {
    return this.data.matches.find((m) => m.id === id);
  }

  teamPlayers(teamId) {
    return this.data.players.filter((p) => p.teamId === teamId);
  }
}
