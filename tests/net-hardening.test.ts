import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import WS from 'ws';
import { startServer, type RunningServer } from '../server/server';
import { runAdmin } from '../server/admin';
import { prepareImport } from '../server/import';
import { NetClient } from '../src/net/client';
import { PROTOCOL_VERSION, contentVersion } from '../src/net/protocol';
import { GameWorld, type SaveData } from '../src/sim/world';
import { findPath } from '../src/sim/pathfinding';
import { HOLLOW, generateWorld } from '../src/sim/worldmap';
import { HOUSE } from '../src/data/construction';

const map = generateWorld(1337);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const running: RunningServer[] = [];
const clients: NetClient[] = [];
const sockets: WS[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const w of sockets.splice(0)) w.terminate();
  for (const s of running.splice(0)) await s.close().catch(() => {});
});
async function serve(extra: Parameters<typeof startServer>[0] = {}) {
  const dbPath = joinPath(mkdtempSync(joinPath(tmpdir(), 'bw-')), 'hard.sqlite');
  const s = await startServer({ port: 0, dbPath, log: () => {}, allowGuests: true, graceMs: 150, ...extra });
  running.push(s);
  return { s, url: `ws://127.0.0.1:${s.port}`, dbPath };
}
async function join(url: string, auth: object) {
  const c = new NetClient({ url, auth: auth as never });
  clients.push(c);
  await c.connect();
  return c;
}
const register = (url: string, name: string) => join(url, { kind: 'register', username: name, password: 'brightwater1' });
/** A raw socket (optionally claiming to come from a web page) and what it is sent. */
function raw(url: string, origin?: string): Promise<{ ws: WS; got: string[]; closed: () => boolean }> {
  return new Promise((resolve, reject) => {
    const ws = new WS(url, origin ? { origin } : {});
    sockets.push(ws);
    const got: string[] = [];
    let closed = false;
    ws.on('message', (d) => got.push(String(d)));
    ws.on('close', () => (closed = true));
    ws.on('error', reject);
    ws.on('open', () => resolve({ ws, got, closed: () => closed }));
  });
}
const hello = (auth: object) => JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, content: contentVersion(map), auth });

describe('3B.1 hardening: costs a client can cause', () => {
  it('a walk to somewhere unreachable is refused at once instead of searching the whole island', () => {
    const w = new GameWorld({ map, clock: () => 0 });
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      expect(findPath(map, w.player.x, w.player.z, 4000, 4000)).toBeNull();
      expect(findPath(map, w.player.x, w.player.z, HOLLOW.x + 10.5, HOLLOW.z + 10.5)).toBeNull();
    }
    expect((performance.now() - t0) / 400).toBeLessThan(0.2);
  });

  it('game commands have their own pace: a flood is cut to about 15 a second', async () => {
    const { s: server, url } = await serve();
    const c = await join(url, { kind: 'guest', name: 'Flood' });
    let applied = 0;
    const issueFor = server.zone.issueFor.bind(server.zone);
    server.zone.issueFor = (id, cmd) => {
      if (cmd.type === 'moveTo') applied++;
      return issueFor(id, cmd);
    };
    for (let i = 0; i < 80; i++) c.issue({ type: 'moveTo', x: 4000, z: 4000 });
    await sleep(300);
    expect(applied).toBeGreaterThanOrEqual(15);
    expect(applied).toBeLessThanOrEqual(22);
  }, 10_000);

  it('a client that stops reading is cut off; open connections per address are capped; pre-sign-in messages are small', async () => {
    const { s: server, url } = await serve({ limits: { connectionsPerAddress: 3 } });
    const open = await Promise.all([raw(url), raw(url), raw(url)]);
    const fourth = await raw(url);
    await sleep(100);
    expect(fourth.closed()).toBe(true);
    expect(open.some((o) => o.closed())).toBe(false);
    open[0].ws.send('x'.repeat(10_000));
    await sleep(100);
    expect(open[0].closed()).toBe(true);
    expect(server.sessions.size).toBe(0);
  }, 10_000);
});

describe('3B.1 hardening: signing in', () => {
  it('many password guesses at once are refused while one is being checked', async () => {
    const { url } = await serve({ limits: { signInsPerAddress: 50, connectionsPerAddress: 50 } });
    (await register(url, 'Ash')).close();
    const tries = await Promise.all(Array.from({ length: 6 }, () => raw(url)));
    for (const t of tries) t.ws.send(hello({ kind: 'login', username: 'Ash', password: 'wrong-password-1' }));
    await sleep(800);
    const answers = tries.map((t) => t.got.join(' '));
    expect(answers.filter((a) => /already in progress/.test(a)).length).toBeGreaterThanOrEqual(4);
    expect(answers.filter((a) => /Wrong name or password/.test(a)).length).toBeLessThanOrEqual(2);
  }, 15_000);

  it('guests can’t take an account’s name; a guest who signs out leaves the world', async () => {
    const { s: server, url } = await serve();
    (await register(url, 'Ash')).close();
    await expect(join(url, { kind: 'guest', name: 'ash' })).rejects.toThrow();
    const g = await join(url, { kind: 'guest', name: 'Visitor' });
    expect(server.sessions.has('guest:visitor')).toBe(true);
    g.logout();
    await sleep(200);
    expect(server.sessions.has('guest:visitor')).toBe(false);
    expect([...server.zone.players.values()].some((p) => p.name === 'Visitor')).toBe(false);
  }, 10_000);

  it('only pages on the allowed list may connect (other clients send no Origin and are fine)', async () => {
    const { url } = await serve({ allowedOrigins: ['http://192.168.1.20:4173'] });
    const evil = await raw(url, 'https://evil.example');
    await sleep(100);
    expect(evil.closed()).toBe(true);
    const good = await raw(url, 'http://192.168.1.20:4173');
    good.ws.send(hello({ kind: 'guest', name: 'Phone' }));
    await sleep(300);
    expect(good.got[0]).toMatch(/"t":"welcome"/);
    expect((await join(url, { kind: 'guest', name: 'Tool' })).status).toBe('ready');
  }, 10_000);
});

describe('3B.1 hardening: integrity', () => {
  it('the same character can’t be imported twice by padding the save with extra fields', () => {
    const save = new GameWorld({ map, clock: () => 0, name: 'Old' }).save() as SaveData & Record<string, unknown>;
    const current = new GameWorld({ map, clock: () => 0, name: 'Rowan', playerId: 1_000_000 }).characterRecord();
    const opts = { map, clock: () => 0, playerId: 1_000_000, name: 'Rowan', current, policy: 'full' as const };
    const a = prepareImport(save, opts);
    const b = prepareImport({ ...save, junk: Math.random() }, opts);
    const c = prepareImport(save, { ...opts, name: 'Brindle', playerId: 1_000_001 });
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) {
      expect(b.hash).toBe(a.hash);
      expect(c.hash).toBe(a.hash);
    }
  });

  it('a save that fails (database busy) keeps the character in the world until it succeeds', async () => {
    const { s: server, url } = await serve();
    const c = await register(url, 'Ash');
    const s = [...server.sessions.values()][0];
    s.player.inventory.add('logs', 9);
    const real = server.repos.saveCharacter.bind(server.repos);
    let busy = true;
    server.repos.saveCharacter = (...args) => {
      if (busy) throw new Error('SQLITE_BUSY: database is locked');
      return real(...args);
    };
    c.logout();
    await sleep(400);
    expect(server.sessions.has(s.key)).toBe(true);
    busy = false;
    await sleep(1500);
    expect(server.sessions.has(s.key)).toBe(false);
    expect(JSON.stringify(server.repos.characterFor(s.accountId!)!.record.inventory)).toContain('logs');
  }, 10_000);

  it('an error in one request or one zone is logged and the server carries on', async () => {
    const logs: string[] = [];
    const { s: server, url } = await serve({ log: (m) => logs.push(m) });
    const c = await join(url, { kind: 'guest', name: 'Ash' });
    const issueFor = server.zone.issueFor.bind(server.zone);
    server.zone.issueFor = () => {
      throw new Error('boom');
    };
    c.issue({ type: 'setStyle', style: 'ranged' });
    const hollow = server.zones.get('hollow')!;
    const tick = hollow.tick.bind(hollow);
    hollow.tick = () => {
      throw new Error('hollow fault');
    };
    await sleep(200);
    server.zone.issueFor = issueFor;
    hollow.tick = tick;
    expect(logs.some((l) => /error handling a message/.test(l))).toBe(true);
    expect(logs.some((l) => /error in zone hollow/.test(l))).toBe(true);
    const before = server.stats.ticks;
    await sleep(200);
    expect(server.stats.ticks).toBeGreaterThan(before);
    c.issue({ type: 'setStyle', style: 'ranged' });
    await sleep(100);
    expect([...server.sessions.values()][0].player.style).toBe('ranged');
  }, 10_000);

  it('stepping back and forth over the house threshold changes zone at most once a second', async () => {
    const { s: server, url } = await serve();
    await join(url, { kind: 'guest', name: 'Ash' });
    const s = [...server.sessions.values()][0];
    const put = (z: number) => {
      s.player.x = s.player.prevX = HOUSE.doorX + 0.5;
      s.player.z = s.player.prevZ = z;
    };
    let transfers = 0;
    let last = s.zoneId;
    for (let i = 0; i < 20; i++) {
      put(i % 2 ? HOUSE.z2 + 1.5 : HOUSE.z2 - 0.5);
      await sleep(50);
      if (s.zoneId !== last) transfers++;
      last = s.zoneId;
    }
    expect(transfers).toBeLessThanOrEqual(2);
  }, 10_000);

  it('moderators can’t act on admins', async () => {
    const { url, dbPath } = await serve();
    const boss = await register(url, 'Boss');
    const mod = await register(url, 'Warden');
    runAdmin(['grant', 'Boss', 'admin'], dbPath, () => {});
    runAdmin(['grant', 'Warden', 'moderator'], dbPath, () => {});
    mod.admin({ op: 'kick', name: 'Boss', reason: '' });
    await sleep(200);
    expect(mod.adminReplies[0].lines[0]).toMatch(/Only an admin/);
    expect(boss.status).toBe('ready');
  }, 10_000);
});
