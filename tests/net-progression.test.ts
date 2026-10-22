import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { startServer, type RunningServer, type Session } from '../server/server';
import { NetClient } from '../src/net/client';
import { xpForLevel } from '../src/data/skills';
import type { GameEvent } from '../src/sim/world';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const running: RunningServer[] = [];
const clients: NetClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of running.splice(0)) await s.close().catch(() => {});
});
const freshDb = () => joinPath(mkdtempSync(joinPath(tmpdir(), 'bw-')), 'prog.sqlite');
async function serve(dbPath: string, port = 0) {
  const s = await startServer({ port, dbPath, log: () => {}, graceMs: 150 });
  running.push(s);
  return { s, url: `ws://127.0.0.1:${s.port}` };
}
interface Who {
  c: NetClient;
  s: Session;
  events: GameEvent[];
}
async function join(server: RunningServer, url: string, name: string, kind: 'register' | 'login' = 'register'): Promise<Who> {
  const c = new NetClient({ url, auth: { kind, username: name, password: 'brightwater1' } } as ConstructorParameters<typeof NetClient>[0]);
  clients.push(c);
  await c.connect();
  const s = [...server.sessions.values()].find((x) => x.name.toLowerCase() === name.toLowerCase())!;
  return { c, s, events: [] };
}
async function pump(who: Who[], ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(15);
    for (const w of who) {
      w.c.update(0.015);
      w.events.push(...w.c.drainEvents());
    }
  }
}

describe('4B multiplayer: progression stays server-side', () => {
  it('a training focus set on the phone reaches the server, directs xp there, and survives a restart', async () => {
    const dbPath = freshDb();
    const { s: server, url } = await serve(dbPath);
    const a = await join(server, url, 'Ash');
    a.c.issue({ type: 'setFocus', focus: 'defence' });
    await pump([a], 200);
    expect(a.s.player.focus).toBe('defence');
    server.saveAll();
    const port = server.port;
    a.c.close();
    await server.close({ save: true });
    running.splice(running.indexOf(server), 1);
    const again = await serve(dbPath, port);
    const b = await join(again.s, again.url, 'Ash', 'login');
    expect(b.s.player.focus).toBe('defence');
    // Junk from a modified client is refused.
    b.c.issue({ type: 'setFocus', focus: 'everything' } as never);
    await pump([b], 150);
    expect(b.s.player.focus).toBe('defence');
  }, 15_000);

  it('the server enforces quest requirements: a client can’t start a regional quest early', async () => {
    const { s: server, url } = await serve(':memory:');
    const a = await join(server, url, 'Ash');
    a.c.issue({ type: 'acceptQuest', quest: 'ninefold_watch' });
    await pump([a], 200);
    expect(a.s.player.quests.ninefold_watch).toBeUndefined();
    a.s.player.quests.elders_request = { stage: 3, kills: 0, done: true };
    for (const sk of ['attack', 'strength', 'defence', 'hitpoints'] as const) a.s.player.skills.addXp(sk, xpForLevel(25));
    a.c.issue({ type: 'acceptQuest', quest: 'ninefold_watch' });
    await pump([a], 200);
    expect(a.s.player.quests.ninefold_watch?.stage).toBe(1);
  }, 10_000);

  it('new gear trades between players like any item, saved for both at once', async () => {
    const { s: server, url } = await serve(':memory:');
    const a = await join(server, url, 'Ash');
    const b = await join(server, url, 'Brindle');
    a.s.player.inventory.add('rowan_longbow', 1);
    b.s.player.inventory.add('steel_arrow', 50);
    b.s.player.x = b.s.player.prevX = a.s.player.x + 1;
    b.s.player.z = b.s.player.prevZ = a.s.player.z;
    const slot = (w: Who, item: string) => w.s.player.inventory.slots.findIndex((x) => x?.item === item);
    for (const step of [
      () => a.c.issue({ type: 'tradeRequest', target: b.s.playerId }),
      () => b.c.issue({ type: 'tradeRequest', target: a.s.playerId }),
      () => a.c.issue({ type: 'tradeOffer', slot: slot(a, 'rowan_longbow'), qty: 1 }),
      () => b.c.issue({ type: 'tradeOffer', slot: slot(b, 'steel_arrow'), qty: 50 }),
      () => a.c.issue({ type: 'tradeAccept' }),
      () => b.c.issue({ type: 'tradeAccept' }),
      () => a.c.issue({ type: 'tradeAccept' }),
      () => b.c.issue({ type: 'tradeAccept' }),
    ]) {
      step();
      await pump([a, b], 120);
    }
    expect(a.s.player.inventory.count('steel_arrow')).toBe(50);
    expect(b.s.player.inventory.count('rowan_longbow')).toBe(1);
    expect(a.s.player.inventory.count('rowan_longbow')).toBe(0);
    expect(server.repos.ledger().map((l) => l.item).sort()).toEqual(['rowan_longbow', 'steel_arrow']);
  }, 15_000);
});
