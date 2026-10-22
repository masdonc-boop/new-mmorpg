import type { Db } from './db';
import { hashToken, newToken } from './auth';
import type { CharacterRecord, ZoneState } from '../src/sim/records';
import type { AuditEntry, Trade } from '../src/exchange/engine';

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

export type Role = 'player' | 'moderator' | 'admin';

export interface ReportRow {
  id: number;
  at: number;
  reporter: string;
  target: string;
  reason: string;
  context: string[];
  status: string;
  resolvedBy: string | null;
  resolution: string | null;
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

  // ---------------------------------------------------------------- live exchange

  /** The saved live Exchange (engine and client nonces), or null before the first request. */
  exchangeState(): unknown {
    const r = this.db.prepare('SELECT state FROM exchange_state WHERE id = 1').get() as { state: string } | undefined;
    return r ? JSON.parse(r.state) : null;
  }

  /**
   * Saves one live Exchange request: the engine state, its new audit entries and trades, and the
   * character whose bank or bag it touched, all in one transaction. The character needs its current
   * lease and version (throws StaleWriteError otherwise, and nothing is written). Returns the
   * character's new version.
   */
  commitExchange(
    state: unknown,
    audit: AuditEntry[],
    trades: Trade[],
    character: { characterId: number; epoch: number; version: number; record: CharacterRecord; zone: ZoneState } | null,
  ): number | null {
    return this.db.transaction(() => {
      const v = character ? this.saveCharacter(character.characterId, character.epoch, character.version, character.record, character.zone) : null;
      this.db.prepare('INSERT INTO exchange_state (id, state, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at').run(JSON.stringify(state), this.now());
      const a = this.db.prepare('INSERT INTO exchange_audit (seq, at, op, account, nonce, detail, hash) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const e of audit) a.run(e.seq, e.at, e.op, e.account, e.nonce ?? null, e.detail, e.hash);
      const t = this.db.prepare('INSERT INTO exchange_trades (id, at, item, qty, price, buyer, seller, buy_order, sell_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const x of trades) t.run(x.id, x.at, x.item, x.qty, x.price, x.buyer, x.seller, x.buyOrder, x.sellOrder);
      return v;
    })();
  }

  /** The stored audit chain, oldest first (for checking it end to end). */
  exchangeAudit(): AuditEntry[] {
    // Rebuilt in the engine's field order, which its hashes are computed over.
    return (this.db.prepare('SELECT seq, at, op, account, nonce, detail, hash FROM exchange_audit ORDER BY seq').all() as (AuditEntry & { nonce: number | null })[]).map((e) =>
      e.nonce === null ? { seq: e.seq, at: e.at, op: e.op, account: e.account, detail: e.detail, hash: e.hash } : { seq: e.seq, at: e.at, op: e.op, account: e.account, nonce: e.nonce, detail: e.detail, hash: e.hash },
    );
  }

  exchangeTrades(): Trade[] {
    return this.db.prepare('SELECT id, at, item, qty, price, buyer, seller, buy_order AS buyOrder, sell_order AS sellOrder FROM exchange_trades ORDER BY id').all() as Trade[];
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

  // ---------------------------------------------------------------- moderation (3B.2)

  role(accountId: number): Role {
    const r = this.db.prepare('SELECT role FROM accounts WHERE id = ?').get(accountId) as { role: string } | undefined;
    return r?.role === 'admin' || r?.role === 'moderator' ? r.role : 'player';
  }

  /** Only the local admin tool calls this (never anything a client sends). */
  setRole(username: string, role: Role, by: string): boolean {
    const a = this.findAccount(username);
    if (!a) return false;
    this.db.prepare('UPDATE accounts SET role = ? WHERE id = ?').run(role, a.id);
    this.adminAudit(by, 'role', a.username, role);
    return true;
  }

  /** The ban in force for an account, if any. */
  activeBan(accountId: number): { until: number | null; reason: string } | null {
    const r = this.db.prepare('SELECT until, reason FROM bans WHERE account_id = ? AND lifted_at IS NULL AND (until IS NULL OR until > ?) ORDER BY id DESC').get(accountId, this.now()) as { until: number | null; reason: string } | undefined;
    return r ?? null;
  }

  ban(accountId: number, until: number | null, reason: string, by: string) {
    this.db.prepare('INSERT INTO bans (account_id, at, until, reason, by) VALUES (?, ?, ?, ?, ?)').run(accountId, this.now(), until, reason.slice(0, 200), by);
  }

  unban(accountId: number, by: string): number {
    return this.db.prepare('UPDATE bans SET lifted_at = ?, lifted_by = ? WHERE account_id = ? AND lifted_at IS NULL').run(this.now(), by, accountId).changes;
  }

  reportList(status: 'open' | 'resolved' | 'all' = 'open', limit = 50): ReportRow[] {
    const where = status === 'all' ? '' : 'WHERE r.status = ?';
    const sql = `SELECT r.id, r.at, a.username AS reporter, r.target, r.reason, r.context, r.status, r.resolved_by AS resolvedBy, r.resolution FROM reports r JOIN accounts a ON a.id = r.reporter ${where} ORDER BY r.id DESC LIMIT ?`;
    const rows = (status === 'all' ? this.db.prepare(sql).all(limit) : this.db.prepare(sql).all(status, limit)) as (Omit<ReportRow, 'context'> & { context: string })[];
    return rows.map((r) => ({ ...r, context: JSON.parse(r.context) }));
  }

  resolveReport(id: number, resolution: string, by: string): boolean {
    return this.db.prepare("UPDATE reports SET status = 'resolved', resolved_by = ?, resolved_at = ?, resolution = ? WHERE id = ? AND status = 'open'").run(by, this.now(), resolution.slice(0, 300), id).changes === 1;
  }

  filterWords(): string[] {
    return (this.db.prepare('SELECT word FROM chat_filter ORDER BY word').all() as { word: string }[]).map((r) => r.word);
  }

  setFilterWord(word: string, on: boolean, by: string) {
    if (on) this.db.prepare('INSERT OR IGNORE INTO chat_filter (word, added_by, at) VALUES (?, ?, ?)').run(word, by, this.now());
    else this.db.prepare('DELETE FROM chat_filter WHERE word = ?').run(word);
  }

  adminAudit(actor: string, action: string, target = '', detail = '') {
    this.db.prepare('INSERT INTO admin_audit (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)').run(this.now(), actor, action, target, detail.slice(0, 500));
  }

  adminLog(limit = 50): { at: number; actor: string; action: string; target: string; detail: string }[] {
    return this.db.prepare('SELECT at, actor, action, target, detail FROM admin_audit ORDER BY id DESC LIMIT ?').all(limit) as { at: number; actor: string; action: string; target: string; detail: string }[];
  }

  // ---------------------------------------------------------------- audit

  audit(accountId: number | null, kind: string, detail = '') {
    this.db.prepare('INSERT INTO audit (at, account_id, kind, detail) VALUES (?, ?, ?, ?)').run(this.now(), accountId, kind, detail.slice(0, 500));
  }

  auditLog(accountId: number): { kind: string; detail: string }[] {
    return this.db.prepare('SELECT kind, detail FROM audit WHERE account_id = ? ORDER BY id').all(accountId) as { kind: string; detail: string }[];
  }
}
