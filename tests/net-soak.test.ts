import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { startServer, type RunningServer, type Session } from '../server/server';
import { NetClient } from '../src/net/client';
import { fnv } from '../src/exchange/engine';
import { mergeSave } from '../src/sim/records';
import { GameWorld, type Command } from '../src/sim/world';
import { generateWorld, isBlocked } from '../src/sim/worldmap';
import { mulberry32 } from '../src/core/rng';

/**
 * 3B.5 soak test: many accounts doing everything at once (gathering, fighting and dying, banking,
 * trading in pairs, the live Exchange), dropping out and coming back, through a crash, a clean
 * restart and another crash. A marker item that no gathering, fight or loot can make or destroy
 * (oak planks: only the sawmill makes them, and nobody here uses it) must add up exactly across
 * every saved character (bag, bank, gear, wisps) and the Exchange after every phase.
 */
const map = generateWorld(1337);
const MARKER = 'oak_plank';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const running: RunningServer[] = [];
const clients: NetClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of running.splice(0)) await s.close().catch(() => {});
});

type Role = 'gather' | 'fight' | 'bank' | 'trade' | 'exchange';
const ROLES: Role[] = ['gather', 'gather', 'fight', 'fight', 'fight', 'bank', 'bank', 'trade', 'trade', 'trade', 'trade', 'exchange', 'exchange', 'exchange', 'gather', 'bank'];

interface Bot {
  name: string;
  role: Role;
  token: string;
  c: NetClient;
  nonce: number;
  step: number;
  partner?: Bot;
}

describe('3B.5 soak: everything at once, through crashes and restarts', () => {
  it('16 accounts gather, fight, bank, trade and use the Exchange; the marker item always adds up', async () => {
    const dbPath = joinPath(mkdtempSync(joinPath(tmpdir(), 'bw-')), 'soak.sqlite');
    const errors: string[] = [];
    const start = async (port = 0) => {
      const s = await startServer({
        port,
        dbPath,
        log: (m) => {
          if (/error|failed|FROZEN/i.test(m)) errors.push(m);
        },
        liveExchange: true,
        exchangePolicy: { requestsPerMinute: 600, priceBand: null },
        limits: { connectionsPerAddress: 100, signInsPerAddress: 100, transferCooldownMs: 1000, registrationsPerHour: 100 },
        saveIntervalMs: 2000,
      });
      running.push(s);
      return s;
    };
    let server = await start();
    const port = server.port;
    const url = `ws://127.0.0.1:${port}`;
    const rng = mulberry32(0x3b5);
    const pick = <T,>(a: readonly T[]) => a[Math.floor(rng() * a.length)];

    const bots: Bot[] = [];
    for (let i = 0; i < ROLES.length; i++) {
      const c = new NetClient({ url, auth: { kind: 'register', username: `Soak${i}`, password: 'brightwater1' }, autoReconnect: true });
      clients.push(c);
      await c.connect();
      bots.push({ name: `Soak${i}`, role: ROLES[i], token: c.session!, c, nonce: 0, step: 0 });
    }
    const traders = bots.filter((b) => b.role === 'trade');
    for (let i = 0; i < traders.length; i += 2) {
      traders[i].partner = traders[i + 1];
      traders[i + 1].partner = traders[i];
    }
    const session = (b: Bot) => [...server.sessions.values()].find((s) => s.name === b.name);
    // Everyone gets marker planks (some in the bag, some in the bank) and coins to trade with.
    for (const b of bots) {
      const s = session(b)!;
      s.player.inventory.add(MARKER, 6);
      s.player.bank.add(MARKER, 40);
      s.player.bank.add('coins', 2000);
    }
    server.saveAll();
    const ids = bots.map((b) => session(b)!.accountId!);

    /** Every marker plank: in each saved character (with their wisps and loot) and in the Exchange. */
    const markers = () => {
      let n = 0;
      for (const id of ids) {
        const row = server.repos.characterFor(id)!;
        const w = new GameWorld({ noPlayer: true, map, clock: () => 0 });
        const p = w.addPlayer({ playerId: row.playerId, save: mergeSave({ character: row.record, zone: row.zone }), worldItems: true });
        for (const s of p.inventory.slots) if (s?.item === MARKER) n += s.qty;
        n += p.bank.count(MARKER) + p.overflow.filter((s) => s.item === MARKER).reduce((a, s) => a + s.qty, 0);
        for (const g of w.graves) for (const s of g.items) if (s.item === MARKER) n += s.qty;
        for (const g of w.groundItems) if (g.item === MARKER) n += g.qty;
      }
      const supply = (server.live!.x.toJSON().supply ?? {}) as Record<string, number>;
      return n + (supply[MARKER] ?? 0);
    };
    const chainOk = () => {
      let prev = '00000000';
      for (const e of server.repos.exchangeAudit()) {
        const { hash, ...rest } = e;
        if (fnv(prev + JSON.stringify(rest)) !== hash) return false;
        prev = hash;
      }
      return true;
    };
    const total = markers();
    expect(total).toBe(46 * bots.length);

    /** Stands each bot where its job is (a test harness shortcut for walking there). */
    const placeAll = () => {
      const near = (s: Session, x: number, z: number) => {
        const spot = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]].map(([a, b]) => ({ x: x + a, z: z + b })).find((q) => !isBlocked(map, q.x, q.z))!;
        s.player.x = s.player.prevX = spot.x;
        s.player.z = s.player.prevZ = spot.z;
        s.player.path = [];
      };
      const w = server.zone;
      const trees = w.nodes.filter((n) => n.def.id === 'tree');
      const foes = w.enemies.filter((e) => e.def.id === 'goblin' || e.def.id === 'wolf');
      const banker = w.npcs.find((n) => n.def.service === 'bank')!;
      const clerk = w.npcs.find((n) => n.def.service === 'exchange')!;
      bots.forEach((b, i) => {
        const s = session(b);
        if (!s || s.zoneId !== 'brightwater') return;
        if (b.role === 'gather') near(s, trees[i % trees.length].x, trees[i % trees.length].z);
        if (b.role === 'fight') near(s, foes[i % foes.length].x, foes[i % foes.length].z);
        if (b.role === 'bank') near(s, banker.x, banker.z);
        if (b.role === 'exchange') {
          near(s, clerk.x, clerk.z);
          s.player.exchangeAt = clerk.id;
        }
        if (b.role === 'trade') near(s, map.spawn.x + (i % 4), map.spawn.z + 2);
      });
    };

    /** One step of each bot's job, as its client would send it. */
    const act = (b: Bot) => {
      const s = session(b);
      if (!s || b.c.status !== 'ready') return;
      const w = s.world;
      const cmd = (c: Command) => b.c.issue(c);
      const slot = (item: string) => s.player.inventory.slots.findIndex((x) => x?.item === item);
      b.step++;
      if (s.player.dead) return cmd({ type: 'respawn', at: 'home' });
      switch (b.role) {
        case 'gather': {
          const tree = w.nodes.filter((n) => n.def.id === 'tree' && !n.depleted).sort((a, c) => Math.hypot(a.x - s.player.x, a.z - s.player.z) - Math.hypot(c.x - s.player.x, c.z - s.player.z))[0];
          if (tree && !s.player.action) cmd({ type: 'interact', target: tree.id });
          return;
        }
        case 'fight': {
          const foe = w.enemies.filter((e) => e.alive).sort((a, c) => Math.hypot(a.x - s.player.x, a.z - s.player.z) - Math.hypot(c.x - s.player.x, c.z - s.player.z))[0];
          if (foe && !s.player.action) cmd({ type: 'interact', target: foe.id });
          return;
        }
        case 'bank': {
          const banker = w.npcs.find((n) => n.def.service === 'bank');
          if (s.player.bankAt === null && banker) return cmd({ type: 'interact', target: banker.id });
          if (b.step % 2 && slot(MARKER) >= 0) cmd({ type: 'bankDeposit', slot: slot(MARKER), qty: 1 + Math.floor(rng() * 3) });
          else cmd({ type: 'bankWithdraw', item: MARKER, qty: 1 + Math.floor(rng() * 3) });
          return;
        }
        case 'trade': {
          const other = b.partner!;
          const os = session(other);
          if (!os) return;
          const view = w.trades.viewFor(s.playerId);
          if (!view) {
            if (b.name < other.name || rng() < 0.3) cmd({ type: 'tradeRequest', target: os.playerId });
            return;
          }
          if (view.stage === 'offer' && !view.mine.length && rng() < 0.7) {
            const item = rng() < 0.6 ? MARKER : 'coins';
            if (slot(item) >= 0) cmd({ type: 'tradeOffer', slot: slot(item), qty: 1 + Math.floor(rng() * 4) });
            return;
          }
          if (rng() < 0.05) return cmd({ type: 'tradeDecline' });
          cmd({ type: 'tradeAccept' });
          return;
        }
        case 'exchange': {
          const view = b.c.liveView;
          if (!view) return b.c.gxOpen();
          const orders = view.orders;
          const r = rng();
          let req;
          if (r < 0.5 && orders.length < 6) {
            const free = [0, 1, 2, 3, 4, 5].find((x) => !orders.some((o) => o.slot === x))!;
            req = { op: 'place' as const, slot: free, side: pick(['buy', 'sell'] as const), item: MARKER as typeof MARKER, qty: 1 + Math.floor(rng() * 5), price: 20 + Math.floor(rng() * 10) };
          } else if (r < 0.65 && orders.length) req = { op: 'cancel' as const, orderId: pick(orders).id };
          else if (orders.length) req = { op: 'collect' as const, orderId: pick(orders).id };
          else return;
          b.c.gx({ ...req, nonce: Math.max(++b.nonce, view.nonce) } as never);
          b.nonce = Math.max(b.nonce, view.nonce);
          return;
        }
      }
    };

    const runPhase = async (seconds: number) => {
      placeAll();
      const end = Date.now() + seconds * 1000;
      let tick = 0;
      while (Date.now() < end) {
        await sleep(50);
        tick++;
        for (const b of bots) {
          b.c.update(0.05);
          b.c.drainEvents();
          b.c.drainChat();
          if (tick % 4 === 0) act(b);
        }
        // Now and then someone's connection drops (their client reconnects by itself).
        if (tick % 15 === 0) {
          const s = session(pick(bots));
          s?.ws?.terminate();
        }
      }
    };
    const checkWorld = () => {
      for (const s of server.sessions.values()) expect(server.zones.get(s.zoneId)!.players.get(s.playerId)).toBe(s.player);
      const inWorlds = [...server.zones.values()].reduce((n, w) => n + w.players.size, 0);
      expect(inWorlds).toBe(server.sessions.size);
    };
    const reconnectAll = async () => {
      for (const b of bots) {
        b.c.close();
        const c = new NetClient({ url, auth: { kind: 'token', token: b.token }, autoReconnect: true });
        clients.push(c);
        await c.connect();
        b.c = c;
      }
    };

    let traded = 0;
    let exchanged = 0;
    for (const crash of [true, false, true]) {
      server.stats.tickMsTotal = server.stats.ticks = 0;
      await runPhase(5);
      const avgTick = server.stats.tickMsTotal / Math.max(1, server.stats.ticks);
      expect(avgTick).toBeLessThan(10);
      checkWorld();
      expect(server.live!.x.verify()).toEqual([]);
      traded = server.repos.ledger().length;
      exchanged = server.repos.exchangeTrades().length;
      // Stop the server: a crash (nothing saved on the way down) or a clean stop.
      await server.close({ save: !crash });
      running.splice(running.indexOf(server), 1);
      server = await start(port);
      expect(server.live!.x.verify()).toEqual([]);
      expect(chainOk()).toBe(true);
      expect(markers()).toBe(total);
      await reconnectAll();
      checkWorld();
    }
    const xp = (role: Role, skill: string) => bots.filter((b) => b.role === role).reduce((n, b) => n + (session(b)?.player.skills.xp[skill as 'woodcutting'] ?? 0), 0);
    console.log(`soak: ${traded} trade ledger rows, ${exchanged} exchange trades, woodcutting xp ${xp('gather', 'woodcutting')}, attack xp ${xp('fight', 'attack')}, hitpoints xp ${xp('fight', 'hitpoints')}`);
    expect(traded).toBeGreaterThan(5);
    expect(xp('gather', 'woodcutting')).toBeGreaterThan(0);
    expect(xp('fight', 'hitpoints')).toBeGreaterThan(0);
    expect(exchanged).toBeGreaterThan(3);
    expect(errors).toEqual([]);
  }, 120_000);
});
