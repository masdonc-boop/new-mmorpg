import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import WS from 'ws';
import { startServer, type RunningServer } from '../server/server';
import { NetClient } from '../src/net/client';
import { PROTOCOL_VERSION, contentVersion, type LiveResult } from '../src/net/protocol';
import { generateWorld } from '../src/sim/worldmap';
import { HOUSE } from '../src/data/construction';

const map = generateWorld(1337);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const running: RunningServer[] = [];
const clients: NetClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of running.splice(0)) await s.close().catch(() => {});
});
const freshDb = () => joinPath(mkdtempSync(joinPath(tmpdir(), 'bw-')), 'rc.sqlite');
async function serve(dbPath: string, extra: Parameters<typeof startServer>[0] = {}) {
  const s = await startServer({ port: 0, dbPath, log: () => {}, allowGuests: true, graceMs: 2000, ...extra });
  running.push(s);
  return { s, url: `ws://127.0.0.1:${s.port}` };
}
async function stop(s: RunningServer, save = true) {
  await s.close({ save });
  running.splice(running.indexOf(s), 1);
}
function client(url: string, auth: object, extra: Partial<ConstructorParameters<typeof NetClient>[0]> = {}) {
  const c = new NetClient({ url, auth: auth as never, autoReconnect: true, ...extra });
  clients.push(c);
  return c;
}
async function pump(c: NetClient, ms: number, said?: string[]) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(20);
    c.update(0.02);
    for (const e of c.drainEvents()) if (e.type === 'message') said?.push(e.text);
  }
}

describe('3B.4 reconnecting', () => {
  it('keeps trying while the server is down, and comes back when it returns', async () => {
    const dbPath = freshDb();
    let { s: server } = await serve(dbPath);
    const port = server.port;
    const c = client(`ws://127.0.0.1:${port}`, { kind: 'register', username: 'Ash', password: 'brightwater1' });
    await c.connect();
    c.world!.player.name;
    await stop(server);
    const said: string[] = [];
    // Down for longer than the first two retries.
    await pump(c, 1800, said);
    expect(c.status).toBe('reconnecting');
    server = (await serve(dbPath, { port })).s;
    await pump(c, 5000, said);
    expect(c.status).toBe('ready');
    expect(said).toContain('Reconnected.');
    expect(server.sessions.size).toBe(1);
  }, 20_000);

  it('a silent connection is dropped and replaced without waiting for the network to notice', async () => {
    const { s: server, url } = await serve(freshDb());
    let fake = 0;
    const c = client(url, { kind: 'guest', name: 'Ash' }, { now: () => performance.now() + fake });
    await c.connect();
    const said: string[] = [];
    fake = 9000;
    await pump(c, 1500, said);
    expect(said).toContain('The server stopped answering. Reconnecting…');
    expect(said).toContain('Reconnected.');
    expect(c.status).toBe('ready');
    expect([...server.zone.players.values()].filter((p) => p.name === 'Ash').length).toBe(1);
  }, 10_000);

  it('the server closes connections that stop answering pings, starting the grace period', async () => {
    const { s: server, url } = await serve(freshDb(), { heartbeatMs: 100 });
    const ws = new WS(url, { autoPong: false } as WS.ClientOptions);
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, content: contentVersion(map), auth: { kind: 'guest', name: 'Ghost' } }));
    await sleep(100);
    const s = server.sessions.get('guest:ghost')!;
    expect(s.ws).not.toBeNull();
    await sleep(400);
    expect(s.ws).toBeNull();
    expect(s.disconnectedAt).not.toBeNull();
    ws.terminate();
  }, 10_000);

  it('an Exchange request sent while the connection was down goes again after reconnecting, and is applied once', async () => {
    const { s: server, url } = await serve(freshDb(), { liveExchange: true });
    const c = client(url, { kind: 'register', username: 'Ash', password: 'brightwater1' });
    await c.connect();
    const s = [...server.sessions.values()][0];
    const clerk = server.zone.npcs.find((n) => n.def.service === 'exchange')!;
    s.player.x = s.player.prevX = clerk.x + 1;
    s.player.z = s.player.prevZ = clerk.z;
    s.player.exchangeAt = clerk.id;
    s.player.bank.add('logs', 10);
    // The connection drops (from the server's side), and the player places an offer meanwhile.
    s.ws!.terminate();
    await sleep(50);
    c.gx({ op: 'place', nonce: 1, slot: 0, side: 'sell', item: 'logs', qty: 4, price: 5 });
    const results: LiveResult[] = [];
    const end = Date.now() + 5000;
    while (!results.length && Date.now() < end) {
      await sleep(20);
      c.update(0.02);
      for (const e of c.drainEvents()) if (e.type === 'exchangeResult' && e.live) results.push(e.result);
    }
    expect(results[0]?.ok).toBe(true);
    expect(s.player.bank.count('logs')).toBe(6);
    expect(server.live!.x.ordersOf(`acct:${s.accountId}`).length).toBe(1);
  }, 15_000);

  it('signing in somewhere else takes over the same character (never a copy)', async () => {
    const { s: server, url } = await serve(freshDb());
    const a = client(url, { kind: 'register', username: 'Ash', password: 'brightwater1' });
    await a.connect();
    const s = [...server.sessions.values()][0];
    s.player.inventory.add('logs', 3);
    const b = client(url, { kind: 'login', username: 'Ash', password: 'brightwater1' });
    await b.connect();
    await pump(a, 200);
    expect(a.status).toBe('closed');
    expect(a.errorCode).toBe('replaced');
    expect(server.sessions.size).toBe(1);
    expect([...server.zones.values()].reduce((n, w) => n + w.players.size, 0)).toBe(1);
    expect(b.world!.player.inventory.count('logs')).toBe(3);
  }, 10_000);

  it('dropping out inside a house: back in the same house within the grace period; the house closes after it', async () => {
    const { s: server, url } = await serve(freshDb(), { graceMs: 300, limits: { transferCooldownMs: 0 } });
    const c = client(url, { kind: 'register', username: 'Ash', password: 'brightwater1' });
    await c.connect();
    const token = c.session!;
    const s = [...server.sessions.values()][0];
    s.player.x = s.player.prevX = HOUSE.doorX + 0.5;
    s.player.z = s.player.prevZ = HOUSE.z2 - 0.5;
    await pump(c, 200);
    expect(s.zoneId).toBe(`house:${s.playerId}`);
    c.close();
    await sleep(100);
    const again = client(url, { kind: 'token', token });
    await again.connect();
    expect(again.zone).toBe(`house:${s.playerId}`);
    again.close();
    await sleep(700);
    expect(server.sessions.size).toBe(0);
    expect([...server.zones.keys()].sort()).toEqual(['brightwater', 'hollow', 'old_watchtower', 'sunken_shrine']);
    // Signing in later puts them back in their (re-opened) house.
    const later = client(url, { kind: 'token', token });
    await later.connect();
    expect(later.zone).toBe(`house:${s.playerId}`);
  }, 10_000);
});
