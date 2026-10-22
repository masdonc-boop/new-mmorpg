import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RateLimiter, hashPassword, verifyPassword } from '../server/auth';
import { openDatabase } from '../server/db';
import { Repos, StaleWriteError } from '../server/repo';
import { startServer, type RunningServer } from '../server/server';
import { NetClient } from '../src/net/client';
import type { Auth } from '../src/net/protocol';
import { GameWorld, type Player } from '../src/sim/world';
import { isBlocked } from '../src/sim/worldmap';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const running: RunningServer[] = [];
const clients: NetClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of running.splice(0)) await s.close().catch(() => {});
});

async function serve(dbPath: string, extra: Parameters<typeof startServer>[0] = {}) {
  const logs: string[] = [];
  const s = await startServer({ port: 0, dbPath, log: (m) => logs.push(m), ...extra });
  running.push(s);
  return { s, url: `ws://127.0.0.1:${s.port}`, logs };
}
async function client(url: string, auth: Auth, autoReconnect = false) {
  const c = new NetClient({ url, auth, autoReconnect });
  clients.push(c);
  const world = await c.connect();
  return { c, world };
}
/** Connects and expects a refusal; returns the error code and message. */
async function refused(url: string, auth: Auth) {
  const c = new NetClient({ url, auth });
  clients.push(c);
  await expect(c.connect()).rejects.toThrow();
  return { code: c.errorCode, reason: c.closeReason };
}
async function pump(c: NetClient, ms: number) {
  const end = Date.now() + ms;
  let last = Date.now();
  while (Date.now() < end) {
    await sleep(16);
    const now = Date.now();
    c.update((now - last) / 1000);
    last = now;
  }
}
const tempDb = () => join(mkdtempSync(join(tmpdir(), 'bw-')), 'test.sqlite');
const ownedP = (p: Player) => JSON.stringify([p.inventory.toJSON(), p.bank.toJSON(), p.equipment.toJSON(), p.skills.xp]);
const owned = (w: GameWorld) => ownedP(w.player);

describe('3A.3 passwords, tokens and sign-in limits', () => {
  it('scrypt hashes are salted, never contain the password, and verify', async () => {
    const a = await hashPassword('correct horse');
    const b = await hashPassword('correct horse');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(a).not.toContain('correct horse');
    expect(await verifyPassword('correct horse', a)).toBe(true);
    expect(await verifyPassword('correct horsf', a)).toBe(false);
    expect(await verifyPassword('anything', 'garbage')).toBe(false);
  });

  it('the rate limiter locks after repeated failures and unlocks after the window', () => {
    let t = 0;
    const r = new RateLimiter(3, 1000, () => t);
    for (let i = 0; i < 3; i++) r.fail('wren');
    expect(r.blocked('wren')).toBe(true);
    expect(r.blocked('ash')).toBe(false);
    t = 1001;
    expect(r.blocked('wren')).toBe(false);
  });
});

describe('3A.3 repositories', () => {
  const fresh = () => {
    let t = 1_000;
    const repos = new Repos(openDatabase(':memory:'), () => t);
    const record = new GameWorld({ name: 'Rowan' }).characterRecord();
    return { repos, record, setTime: (v: number) => (t = v) };
  };

  it('one account and character per name (ignoring case); player ids from 1,000,000', () => {
    const { repos, record } = fresh();
    const a = repos.createAccount('Rowan', 'h', record, {})!;
    expect(a.character.playerId).toBe(1_000_000);
    expect(a.character.record.playerId).toBe(1_000_000);
    expect(repos.createAccount('rowan', 'h', record, {})).toBeNull();
    expect(repos.createAccount('Elara', 'h', record, {})!.character.playerId).toBe(1_000_001);
  });

  it('sessions are stored as hashes, expire, and can be revoked', () => {
    const { repos, record, setTime } = fresh();
    const { account } = repos.createAccount('Rowan', 'h', record, {})!;
    const token = repos.createSession(account.id);
    expect(JSON.stringify(repos.db.prepare('SELECT * FROM sessions').all())).not.toContain(token);
    expect(repos.sessionAccount(token)).toBe(account.id);
    setTime(1_000 + 31 * 86_400_000);
    expect(repos.sessionAccount(token)).toBeNull();
    setTime(2_000);
    const t2 = repos.createSession(account.id);
    repos.revokeSession(t2);
    expect(repos.sessionAccount(t2)).toBeNull();
  });

  it('saves need the current lease epoch and version: stale writers are refused', () => {
    const { repos, record } = fresh();
    const { character } = repos.createAccount('Rowan', 'h', record, {})!;
    const a = repos.acquireLease(character.id, 'server-a');
    expect(a.leaseEpoch).toBe(1);
    const v2 = repos.saveCharacter(character.id, a.leaseEpoch, a.version, { ...record, laps: 3 }, {});
    expect(v2).toBe(2);
    // Saving again from the old version is refused (lost update).
    expect(() => repos.saveCharacter(character.id, a.leaseEpoch, a.version, record, {})).toThrow(StaleWriteError);
    // Another server takes the lease: the first can no longer write at all.
    const b = repos.acquireLease(character.id, 'server-b');
    expect(b.leaseEpoch).toBe(2);
    expect(() => repos.saveCharacter(character.id, a.leaseEpoch, v2, { ...record, laps: 99 }, {})).toThrow(StaleWriteError);
    expect(repos.characterFor(character.accountId)!.record.laps).toBe(3);
    expect(repos.saveCharacter(character.id, b.leaseEpoch, v2, { ...record, laps: 4 }, {})).toBe(3);
  });
});

describe('3A.3 accounts and persistence over the network', () => {
  it('register, play, restart the server: the character comes back exactly, by token or password', async () => {
    const db = tempDb();
    const first = await serve(db);
    const { c, world } = await client(first.url, { kind: 'register', username: 'Rowan', password: 'brightwater1' });
    expect(c.session).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    // Play a little (the harness stands the server-side player beside a tree).
    const s = [...first.s.sessions.values()][0];
    const w = first.s.zone;
    (w as unknown as { rng: () => number }).rng = () => 0.3;
    const tree = w.nodes.find((n) => n.def.id === 'tree' && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !isBlocked(w.map, n.x + a, n.z + b)))!;
    const [a, b] = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([a, b]) => !isBlocked(w.map, tree.x + a, tree.z + b))!;
    s.player.x = s.player.prevX = tree.x + a;
    s.player.z = s.player.prevZ = tree.z + b;
    c.issue({ type: 'interact', target: tree.id });
    await pump(c, 3500);
    expect(s.player.inventory.count('logs')).toBeGreaterThan(0);
    const before = ownedP(s.player);
    const at = { x: s.player.x, z: s.player.z };
    expect(owned(world)).toBe(before);
    await first.s.close();
    running.splice(running.indexOf(first.s), 1);

    const second = await serve(db);
    const again = await client(second.url, { kind: 'token', token: c.session! });
    expect(owned(again.world)).toBe(before);
    expect(again.world.player.x).toBeCloseTo(at.x, 2);
    expect(again.c.playerId).toBe(c.playerId);
    again.c.close();
    await sleep(100);
    const byPassword = await client(second.url, { kind: 'login', username: 'rowan', password: 'brightwater1' });
    expect(owned(byPassword.world)).toBe(before);
  }, 20_000);

  it('a crash loses only unsaved progress and never duplicates items', async () => {
    const db = tempDb();
    const first = await serve(db);
    const { c } = await client(first.url, { kind: 'register', username: 'Elara', password: 'brightwater2' });
    const s = [...first.s.sessions.values()][0];
    s.player.inventory.add('oak_logs', 5);
    first.s.saveAll();
    s.player.inventory.add('oak_logs', 3);
    await first.s.close({ save: false });
    running.splice(running.indexOf(first.s), 1);
    const second = await serve(db);
    const { world } = await client(second.url, { kind: 'token', token: c.session! });
    expect(world.player.inventory.count('oak_logs')).toBe(5);
  }, 15_000);

  it('a stale server copy can never overwrite the character (lease epochs)', async () => {
    const db = tempDb();
    const a = await serve(db, { instance: 'server-a' });
    const b = await serve(db, { instance: 'server-b' });
    const onA = await client(a.url, { kind: 'register', username: 'Torin', password: 'brightwater3' });
    const sa = [...a.s.sessions.values()][0];
    sa.player.inventory.add('iron_bar', 4);
    a.s.saveAll();
    // The same account signs in on server B, which takes the lease.
    const onB = await client(b.url, { kind: 'login', username: 'Torin', password: 'brightwater3' });
    expect(onB.world.player.inventory.count('iron_bar')).toBe(4);
    const sb = [...b.s.sessions.values()][0];
    sb.player.inventory.remove('iron_bar', 4);
    b.s.saveAll();
    // Server A still has its old copy with the bars. Its next save is refused and the copy dropped.
    sa.player.inventory.add('iron_bar', 10);
    a.s.saveAll();
    expect(a.s.sessions.size).toBe(0);
    await pump(onA.c, 200);
    expect(onA.c.errorCode).toBe('stale');
    const row = b.s.repos.characterFor(sb.accountId!)!;
    expect(row.record.inventory.filter((x) => x?.item === 'iron_bar').length).toBe(0);
    expect(b.s.repos.auditLog(sb.accountId!).some((e) => e.kind === 'stale-write')).toBe(true);
  }, 15_000);

  it('signing in again on the same server takes over the same world (nothing reloaded or duplicated)', async () => {
    const { s, url } = await serve(':memory:');
    const one = await client(url, { kind: 'register', username: 'Lyra', password: 'brightwater4' });
    const world = [...s.sessions.values()][0].player;
    world.inventory.add('steel_bar', 2);
    const two = await client(url, { kind: 'login', username: 'Lyra', password: 'brightwater4' });
    await pump(one.c, 200);
    expect(one.c.errorCode).toBe('replaced');
    expect(s.sessions.size).toBe(1);
    expect([...s.sessions.values()][0].player).toBe(world);
    expect(two.world.player.inventory.count('steel_bar')).toBe(2);
  }, 15_000);

  it('a dropped connection keeps the character in the world for a grace period, then saves and unloads it', async () => {
    const { s, url } = await serve(':memory:', { graceMs: 800 });
    const { c } = await client(url, { kind: 'register', username: 'Cass', password: 'brightwater5' }, true);
    const sess = [...s.sessions.values()][0];
    // Drop the socket without signing out: the client reconnects by itself with its token.
    (c as unknown as { ws: WebSocket }).ws.close();
    await pump(c, 1500);
    expect(c.status).toBe('ready');
    expect([...s.sessions.values()][0]).toBe(sess);
    // Now go away for good: after the grace period the character is saved and unloaded.
    sess.player.inventory.add('bread', 1);
    c.close();
    await sleep(1500);
    expect(s.sessions.size).toBe(0);
    const row = s.repos.characterFor(sess.accountId!)!;
    expect(row.leaseOwner).toBeNull();
    expect(row.record.inventory.some((x) => x?.item === 'bread')).toBe(true);
  }, 15_000);

  it('signing out saves, unloads and ends the session token', async () => {
    const { s, url } = await serve(':memory:');
    const { c } = await client(url, { kind: 'register', username: 'Fenwick', password: 'brightwater6' });
    const token = c.session!;
    c.logout();
    await sleep(300);
    expect(s.sessions.size).toBe(0);
    expect((await refused(url, { kind: 'token', token })).code).toBe('session');
  }, 15_000);

  it('wrong passwords are refused and repeated failures lock the name; names are unique', async () => {
    const { url, s } = await serve(':memory:');
    const { c } = await client(url, { kind: 'register', username: 'Mira', password: 'brightwater7' });
    c.logout();
    await sleep(200);
    expect((await refused(url, { kind: 'register', username: 'MIRA', password: 'otherpass9' })).code).toBe('taken');
    expect((await refused(url, { kind: 'register', username: 'Bo', password: 'otherpass9' })).code).toBe('auth');
    expect((await refused(url, { kind: 'register', username: 'Shorty', password: 'short' })).code).toBe('auth');
    for (let i = 0; i < 5; i++) expect((await refused(url, { kind: 'login', username: 'Mira', password: `wrong-${i}-pass` })).code).toBe('auth');
    // Locked now, even with the right password.
    expect((await refused(url, { kind: 'login', username: 'Mira', password: 'brightwater7' })).code).toBe('locked');
    expect((await refused(url, { kind: 'login', username: 'Nobody', password: 'brightwater7' })).code).toBe('auth');
    expect(s.repos.auditLog(s.repos.findAccount('Mira')!.id).filter((e) => e.kind === 'login-failed').length).toBe(5);
  }, 30_000);

  it('guests are refused unless the server allows them', async () => {
    const { url } = await serve(':memory:');
    expect((await refused(url, { kind: 'guest', name: 'Visitor' })).code).toBe('auth');
  }, 10_000);

  it('passwords never appear in the database file or the server log', async () => {
    const db = tempDb();
    const { s, url, logs } = await serve(db);
    await client(url, { kind: 'register', username: 'Aldric', password: 'sup3r-secret-pw' });
    await refused(url, { kind: 'login', username: 'Aldric', password: 'not-the-pw-123' });
    await s.close();
    running.splice(running.indexOf(s), 1);
    const dir = join(db, '..');
    const bytes = readdirSync(dir).map((f) => readFileSync(join(dir, f)).toString('latin1')).join('');
    expect(bytes).toContain('Aldric');
    expect(bytes).not.toContain('sup3r-secret-pw');
    expect(bytes).not.toContain('not-the-pw-123');
    expect(logs.join('\n')).not.toContain('sup3r-secret-pw');
  }, 15_000);
});
