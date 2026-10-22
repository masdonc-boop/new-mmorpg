import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The development server's database (docs/MULTIPLAYER.md 3A.3): one SQLite file (or `:memory:` in
 * tests). Schema changes are numbered migrations tracked in SQLite's `user_version`.
 */
export type Db = Database.Database;

const MIGRATIONS: string[] = [
  // 1: accounts, sessions, characters, audit log.
  `
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX sessions_account ON sessions(account_id);
  CREATE TABLE characters (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id),
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    player_id INTEGER NOT NULL UNIQUE,
    record TEXT NOT NULL,
    zone TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    lease_owner TEXT,
    lease_epoch INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE audit (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    account_id INTEGER,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
  );
  `,
  // 2: imports of browser-local saves (docs/MULTIPLAYER.md section 7): once per account, once per save.
  `
  CREATE TABLE imports (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL UNIQUE REFERENCES accounts(id),
    character_id INTEGER NOT NULL REFERENCES characters(id),
    save_hash TEXT NOT NULL UNIQUE,
    at INTEGER NOT NULL,
    report TEXT NOT NULL DEFAULT '[]'
  );
  `,
  // 3: player trading and chat (docs/MULTIPLAYER.md 3A.6). The item ledger is append-only: one row
  // per item moved between characters, under the trade's reference.
  `
  CREATE TABLE item_ledger (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    from_character INTEGER NOT NULL REFERENCES characters(id),
    to_character INTEGER NOT NULL REFERENCES characters(id),
    item TEXT NOT NULL,
    qty INTEGER NOT NULL CHECK (qty > 0)
  );
  CREATE INDEX item_ledger_ref ON item_ledger(ref);
  CREATE TABLE blocks (
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    blocked TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (account_id, blocked)
  );
  CREATE TABLE reports (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    reporter INTEGER NOT NULL REFERENCES accounts(id),
    target TEXT NOT NULL,
    reason TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '[]'
  );
  ALTER TABLE accounts ADD COLUMN muted_until INTEGER NOT NULL DEFAULT 0;
  `,
];

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 2000');
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}
