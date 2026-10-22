import type { Db } from './db';
import { hashToken, newToken } from './auth';
import type { CharacterRecord, ZoneState } from '../src/sim/records';

/**
 * Repositories over the SQLite database (docs/MULTIPLAYER.md 3.5). Game code talks to these, not
 * to SQL, so a PostgreSQL implementation can replace them later.
 */

export interface AccountRow {
  id: number;
  username: string;
  password: string;
}

export interface CharacterRow {
  id: number;
  accountId: number;
  name: string;
  playerId: number;
  record: CharacterRecord;
  zone: ZoneState;
  version: number;
  leaseOwner: string | null;
  leaseEpoch: number;
}

/** A save was refused because another server (or a later sign-in) now owns the character, or it changed underneath. */
export class StaleWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleWriteError';
  }
}

/** Sessions last this long without being used. */
export const SESSION_DAYS = 30;

export class Repos {
  constructor(
    readonly db: Db,
    private now: () => number = () => Date.now(),
  ) {}

  // ---------------------------------------------------------------- accounts

  findAccount(username: string): AccountRow | null {
    return (this.db.prepare('SELECT id, username, password FROM accounts WHERE username = ?').get(username) as AccountRow | undefined) ?? null;
  }

  /**
   * Creates an account and its character in one transaction. Returns null if the name is taken
   * (as an account or a character name).
   */
  createAccount(username: string, passwordHash: string, record: CharacterRecord, zone: ZoneState): { account: AccountRow; character: CharacterRow } | null {
    return this.db.transaction(() => {
      if (this.findAccount(username) || this.db.prepare('SELECT 1 FROM characters WHERE name = ?').get(username)) return null;
      const at = this.now();
      const info = this.db.prepare('INSERT INTO accounts (username, password, created_at) VALUES (?, ?, ?)').run(username, passwordHash, at);
      const accountId = Number(info.lastInsertRowid);
      const max = this.db.prepare('SELECT MAX(player_id) AS m FROM characters').get() as { m: number | null };
      const playerId = Math.max(1_000_000, (max.m ?? 999_999) + 1);
      const rec = { ...record, name: username, playerId };
      this.db
        .prepare('INSERT INTO characters (account_id, name, player_id, record, zone, version, lease_epoch, updated_at) VALUES (?, ?, ?, ?, ?, 1, 0, ?)')
        .run(accountId, username, playerId, JSON.stringify(rec), JSON.stringify(zone), at);
      this.audit(accountId, 'register', username);
      return { account: this.findAccount(username)!, character: this.characterFor(accountId)! };
    })();
  }

  // ---------------------------------------------------------------- sessions

  createSession(accountId: number): string {
    const token = newToken();
    const at = this.now();
    this.db.prepare('INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(hashToken(token), accountId, at, at + SESSION_DAYS * 86_400_000);
    return token;
  }

  /** The account a token belongs to, if the session is live (and extends it). */
  sessionAccount(token: string): number | null {
    const row = this.db.prepare('SELECT account_id AS a, expires_at AS e, revoked AS r FROM sessions WHERE token_hash = ?').get(hashToken(token)) as { a: number; e: number; r: number } | undefined;
    if (!row || row.r || row.e < this.now()) return null;
    this.db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(this.now() + SESSION_DAYS * 86_400_000, hashToken(token));
    return row.a;
  }

  revokeSession(token: string) {
    this.db.prepare('UPDATE sessions SET revoked = 1 WHERE token_hash = ?').run(hashToken(token));
  }

  // ---------------------------------------------------------------- characters

  characterFor(accountId: number): CharacterRow | null {
    const r = this.db.prepare('SELECT * FROM characters WHERE account_id = ?').get(accountId) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      id: r.id as number,
      accountId: r.account_id as number,
      name: r.name as string,
      playerId: r.player_id as number,
      record: JSON.parse(r.record as string),
      zone: JSON.parse(r.zone as string),
      version: r.version as number,
      leaseOwner: (r.lease_owner as string | null) ?? null,
      leaseEpoch: r.lease_epoch as number,
    };
  }

  /**
   * Takes the character's lease for `owner` (a server instance), raising the epoch. Any writer
   * holding an older epoch can no longer save. Returns the new epoch and the current row.
   */
  acquireLease(characterId: number, owner: string): CharacterRow {
    return this.db.transaction(() => {
      this.db.prepare('UPDATE characters SET lease_owner = ?, lease_epoch = lease_epoch + 1 WHERE id = ?').run(owner, characterId);
      const row = this.db.prepare('SELECT account_id FROM characters WHERE id = ?').get(characterId) as { account_id: number };
      return this.characterFor(row.account_id)!;
    })();
  }

  /**
   * Saves a character (and its zone state) if the caller still holds the lease epoch and the row
   * hasn't changed since `version`. Returns the new version; throws StaleWriteError otherwise.
   */
  saveCharacter(characterId: number, epoch: number, version: number, record: CharacterRecord, zone: ZoneState): number {
    const info = this.db
      .prepare('UPDATE characters SET record = ?, zone = ?, version = version + 1, updated_at = ? WHERE id = ? AND lease_epoch = ? AND version = ?')
      .run(JSON.stringify(record), JSON.stringify(zone), this.now(), characterId, epoch, version);
    if (info.changes !== 1) throw new StaleWriteError(`character ${characterId}: lease ${epoch} / version ${version} is out of date`);
    return version + 1;
  }

  /** Gives up the lease (only if still held). */
  releaseLease(characterId: number, epoch: number) {
    this.db.prepare('UPDATE characters SET lease_owner = NULL WHERE id = ? AND lease_epoch = ?').run(characterId, epoch);
  }

  // ---------------------------------------------------------------- imports

  /** Whether this account has already imported a browser save, or this save was imported anywhere. */
  importBlocked(accountId: number, saveHash: string): 'account' | 'save' | null {
    if (this.db.prepare('SELECT 1 FROM imports WHERE account_id = ?').get(accountId)) return 'account';
    if (this.db.prepare('SELECT 1 FROM imports WHERE save_hash = ?').get(saveHash)) return 'save';
    return null;
  }

  /**
   * Replaces a character with an imported one and records the import, in one transaction. The
   * save needs the current lease and version like any other (throws StaleWriteError otherwise).
   */
  importCharacter(characterId: number, accountId: number, epoch: number, version: number, record: CharacterRecord, zone: ZoneState, saveHash: string, report: string[]): number {
    return this.db.transaction(() => {
      const v = this.saveCharacter(characterId, epoch, version, record, zone);
      this.db.prepare('INSERT INTO imports (account_id, character_id, save_hash, at, report) VALUES (?, ?, ?, ?, ?)').run(accountId, characterId, saveHash, this.now(), JSON.stringify(report));
      this.audit(accountId, 'import', `${saveHash.slice(0, 16)} ${report.length} changes`);
      return v;
    })();
  }

  importReport(accountId: number): string[] | null {
    const r = this.db.prepare('SELECT report FROM imports WHERE account_id = ?').get(accountId) as { report: string } | undefined;
    return r ? JSON.parse(r.report) : null;
  }

  // ---------------------------------------------------------------- trades

  /**
   * Saves both sides of a player trade and its ledger rows in one transaction. Each character
   * needs its current lease and version (throws StaleWriteError otherwise, and nothing is written).
   * Returns the new versions.
   */
  commitTrade(
    ref: string,
    sides: { characterId: number; epoch: number; version: number; record: CharacterRecord; zone: ZoneState }[],
    moves: { from: number; to: number; item: string; qty: number }[],
  ): number[] {
    return this.db.transaction(() => {
      const versions = sides.map((x) => this.saveCharacter(x.characterId, x.epoch, x.version, x.record, x.zone));
      const at = this.now();
      const row = this.db.prepare('INSERT INTO item_ledger (at, kind, ref, from_character, to_character, item, qty) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const m of moves) row.run(at, 'trade', ref, m.from, m.to, m.item, m.qty);
      return versions;
    })();
  }

  ledger(ref?: string): { ref: string; from: number; to: number; item: string; qty: number }[] {
    const sql = 'SELECT ref, from_character AS "from", to_character AS "to", item, qty FROM item_ledger' + (ref ? ' WHERE ref = ?' : '') + ' ORDER BY id';
    return (ref ? this.db.prepare(sql).all(ref) : this.db.prepare(sql).all()) as { ref: string; from: number; to: number; item: string; qty: number }[];
  }

  // ---------------------------------------------------------------- chat and moderation

  blockedBy(accountId: number): string[] {
    return (this.db.prepare('SELECT blocked FROM blocks WHERE account_id = ? ORDER BY blocked').all(accountId) as { blocked: string }[]).map((r) => r.blocked);
  }

  setBlocked(accountId: number, name: string, on: boolean) {
    if (on) this.db.prepare('INSERT OR IGNORE INTO blocks (account_id, blocked) VALUES (?, ?)').run(accountId, name);
    else this.db.prepare('DELETE FROM blocks WHERE account_id = ? AND blocked = ?').run(accountId, name);
  }

  report(reporter: number, target: string, reason: string, context: string[]) {
    this.db.prepare('INSERT INTO reports (at, reporter, target, reason, context) VALUES (?, ?, ?, ?, ?)').run(this.now(), reporter, target, reason.slice(0, 200), JSON.stringify(context));
    this.audit(reporter, 'report', target);
  }

  reports(): { reporter: number; target: string; reason: string; context: string[] }[] {
    return (this.db.prepare('SELECT reporter, target, reason, context FROM reports ORDER BY id').all() as { reporter: number; target: string; reason: string; context: string }[]).map((r) => ({ ...r, context: JSON.parse(r.context) }));
  }

  /** Until when an account may not chat (0: not muted). */
  mutedUntil(accountId: number): number {
    return (this.db.prepare('SELECT muted_until AS m FROM accounts WHERE id = ?').get(accountId) as { m: number } | undefined)?.m ?? 0;
  }

  mute(accountId: number, until: number, by: string) {
    this.db.prepare('UPDATE accounts SET muted_until = ? WHERE id = ?').run(until, accountId);
    this.audit(accountId, 'muted', `${by} until ${new Date(until).toISOString()}`);
  }

  // ---------------------------------------------------------------- audit

  audit(accountId: number | null, kind: string, detail = '') {
    this.db.prepare('INSERT INTO audit (at, account_id, kind, detail) VALUES (?, ?, ?, ?)').run(this.now(), accountId, kind, detail.slice(0, 500));
  }

  auditLog(accountId: number): { kind: string; detail: string }[] {
    return this.db.prepare('SELECT kind, detail FROM audit WHERE account_id = ? ORDER BY id').all(accountId) as { kind: string; detail: string }[];
  }
}
