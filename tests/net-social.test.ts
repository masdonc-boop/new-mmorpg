import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { startServer, type RunningServer, type Session } from '../server/server';
import { cleanChat } from '../server/chat';
import { NetClient, type ChatLine } from '../src/net/client';
import type { GameEvent } from '../src/sim/world';
import type { ItemStack } from '../src/sim/inventory';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const running: RunningServer[] = [];
const clients: NetClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of running.splice(0)) await s.close().catch(() => {});
});

async function serve(dbPath = ':memory:') {
  const s = await startServer({ port: 0, dbPath, log: () => {}, allowGuests: true, graceMs: 150 });
  running.push(s);
  return { s, url: `ws://127.0.0.1:${s.port}` };
}

interface Who {
  name: string;
  c: NetClient;
  s: Session;
  chat: ChatLine[];
  events: GameEvent[];
  token: string | null;
}
async function join(server: RunningServer, url: string, name: string, kind: 'register' | 'guest' | 'token' = 'register', token?: string): Promise<Who> {
  const auth = kind === 'register' ? { kind, username: name, password: 'brightwater1' } : kind === 'guest' ? { kind, name } : { kind, token: token! };
  const c = new NetClient({ url, auth } as ConstructorParameters<typeof NetClient>[0]);
  clients.push(c);
  await c.connect();
  const s = [...server.sessions.values()].find((x) => x.name.toLowerCase() === name.toLowerCase())!;
  return { name, c, s, chat: [], events: [], token: c.session ?? token ?? null };
}
async function pump(who: Who[], ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(15);
    for (const w of who) {
      w.c.update(0.015);
      w.chat.push(...w.c.drainChat());
      w.events.push(...w.c.drainEvents());
    }
  }
}
const said = (w: Who) => w.events.filter((e) => e.type === 'message').map((e) => (e as { text: string }).text);
const bagOf = (rec: { inventory?: unknown }) => JSON.stringify(rec.inventory);

describe('3A.6 chat', () => {
  it('cleans messages: control characters, length, links and a basic word filter', () => {
    expect(cleanChat('  hello\u0000   there  ')).toEqual({ text: 'hello there' });
    expect(cleanChat('   ')).toEqual({ error: 'Say something first.' });
    expect('error' in cleanChat('x'.repeat(121))).toBe(true);
    expect(cleanChat('free coins at www.example.com now')).toEqual({ text: 'free coins at [link] now' });
    expect(cleanChat('visit brightwater-gold.gg')).toEqual({ text: 'visit [link]' });
    expect(cleanChat('oh sh1t, that hurt')).toEqual({ text: 'oh ****, that hurt' });
    expect(cleanChat('FUUUCK')).toEqual({ text: '******' });
    // Ordinary words that merely contain letters in that order are left alone.
    expect(cleanChat('shiny shields and a bass')).toEqual({ text: 'shiny shields and a bass' });
  });

  it('local chat reaches players nearby only; private chat one player; blocking is silent and remembered', async () => {
    const { s: server, url } = await serve();
    const ash = await join(server, url, 'Ash');
    const brin = await join(server, url, 'Brindle');
    const far = await join(server, url, 'Faraway', 'guest');
    far.s.player.x = far.s.player.prevX = ash.s.player.x + 40;
    const all = [ash, brin, far];
    ash.c.say('hello there');
    await pump(all, 200);
    expect(brin.chat).toEqual([{ channel: 'local', from: 'Ash', text: 'hello there' }]);
    expect(ash.chat.map((l) => l.text)).toEqual(['hello there']);
    expect(far.chat).toEqual([]);

    ash.c.say('psst', 'faraway');
    await pump(all, 200);
    expect(far.chat).toEqual([{ channel: 'private', from: 'Ash', text: 'psst' }]);
    expect(ash.chat.at(-1)).toEqual({ channel: 'private', from: 'Ash', to: 'Faraway', text: 'psst' });
    ash.c.say('anyone?', 'Nobody');
    await pump(all, 200);
    expect(said(ash).at(-1)).toBe('Nobody isn’t online.');

    // Brindle blocks Ash: nothing from Ash reaches them, and Ash can't tell the difference.
    brin.c.block('Ash', true);
    await pump(all, 200);
    expect(brin.c.blocked).toEqual(['ash']);
    brin.chat = [];
    ash.c.say('can you hear me');
    ash.c.say('hello?', 'Brindle');
    await pump(all, 200);
    expect(brin.chat).toEqual([]);
    expect(said(ash).at(-1)).toBe('Brindle isn’t online.');
    // Remembered for the account.
    const again = await join(server, url, 'Brindle', 'token', brin.token!);
    await pump([again], 100);
    expect(again.c.blocked).toEqual(['ash']);
  }, 15_000);

  it('pacing, mutes and reports', async () => {
    const { s: server, url } = await serve();
    const ash = await join(server, url, 'Ash');
    const brin = await join(server, url, 'Brindle');
    for (let i = 0; i < 7; i++) ash.c.say(`message ${i}`);
    await pump([ash, brin], 200);
    expect(brin.chat.length).toBe(5);
    expect(said(ash)).toContain('You are sending messages too quickly.');

    brin.c.report('Ash', 'spamming');
    await pump([ash, brin], 200);
    expect(said(brin).at(-1)).toMatch(/report about Ash has been sent/);
    const [r] = server.repos.reports();
    expect(r.target).toBe('Ash');
    expect(r.context).toEqual(['message 0', 'message 1', 'message 2', 'message 3', 'message 4']);

    expect(server.mute('ash', 10)).toBe(true);
    await sleep(2100);
    ash.c.say('let me speak');
    await pump([ash, brin], 200);
    expect(said(ash).at(-1)).toMatch(/You are muted until/);
    expect(brin.chat.some((l) => l.text === 'let me speak')).toBe(false);
  }, 15_000);
});

/** Puts both players next to each other and returns their bags as saved now. */
async function ready(server: RunningServer, a: Who, b: Who) {
  b.s.player.x = b.s.player.prevX = a.s.player.x + 1;
  b.s.player.z = b.s.player.prevZ = a.s.player.z;
  server.saveAll();
  return [bagOf(server.repos.characterFor(a.s.accountId!)!.record), bagOf(server.repos.characterFor(b.s.accountId!)!.record)];
}
const slot = (w: Who, item: string) => w.s.player.inventory.slots.findIndex((s) => s?.item === item);

/** The steps of a trade, in order. */
function steps(a: Who, b: Who): (() => void)[] {
  return [
    () => a.c.issue({ type: 'tradeRequest', target: b.s.playerId }),
    () => b.c.issue({ type: 'tradeRequest', target: a.s.playerId }),
    () => a.c.issue({ type: 'tradeOffer', slot: slot(a, 'coins'), qty: 25 }),
    () => b.c.issue({ type: 'tradeOffer', slot: slot(b, 'bread'), qty: 2 }),
    () => a.c.issue({ type: 'tradeAccept' }),
    () => b.c.issue({ type: 'tradeAccept' }),
    () => a.c.issue({ type: 'tradeAccept' }),
    () => b.c.issue({ type: 'tradeAccept' }),
  ];
}

describe('3A.6 trading over the network', () => {
  it('a trade is saved for both players at once, with a ledger row for every stack', async () => {
    const { s: server, url } = await serve();
    const a = await join(server, url, 'Ash');
    const b = await join(server, url, 'Brindle');
    await ready(server, a, b);
    const coins = [a.s.player.inventory.count('coins'), b.s.player.inventory.count('coins')];
    const bread = [a.s.player.inventory.count('bread'), b.s.player.inventory.count('bread')];
    for (const step of steps(a, b)) {
      step();
      await pump([a, b], 120);
    }
    expect(said(a).at(-1)).toBe('Trade complete.');
    const ra = server.repos.characterFor(a.s.accountId!)!;
    const rb = server.repos.characterFor(b.s.accountId!)!;
    const count = (inv: (ItemStack | null)[], item: string) => inv.filter((s) => s?.item === item).reduce((n, s) => n + s!.qty, 0);
    expect(count(ra.record.inventory as never, 'coins')).toBe(coins[0] - 25);
    expect(count(rb.record.inventory as never, 'coins')).toBe(coins[1] + 25);
    expect(count(ra.record.inventory as never, 'bread')).toBe(bread[0] + 2);
    expect(count(rb.record.inventory as never, 'bread')).toBe(bread[1] - 2);
    const ledger = server.repos.ledger();
    expect(ledger.map(({ from, to, item, qty }) => ({ from, to, item, qty }))).toEqual([
      { from: ra.id, to: rb.id, item: 'coins', qty: 25 },
      { from: rb.id, to: ra.id, item: 'bread', qty: 2 },
    ]);
    expect(new Set(ledger.map((l) => l.ref)).size).toBe(1);
    // The replica on each device shows the new bag too.
    expect(a.c.world!.player.inventory.count('bread')).toBe(bread[0] + 2);
  }, 15_000);

  it('guests can’t trade', async () => {
    const { s: server, url } = await serve();
    const a = await join(server, url, 'Ash');
    const g = await join(server, url, 'Visitor', 'guest');
    g.c.issue({ type: 'tradeRequest', target: a.s.playerId });
    a.c.issue({ type: 'tradeRequest', target: g.s.playerId });
    await pump([a, g], 200);
    expect(said(g).at(-1)).toMatch(/Guests can’t trade/);
    expect(said(a).at(-1)).toMatch(/Visitor is a guest/);
    expect(server.zone.trades.trading(a.s.playerId)).toBe(false);
  }, 10_000);

  // Chaos: a disconnect after every step, by either side. The trade is either fully done or not at all.
  for (let upTo = 1; upTo <= 7; upTo++) {
    for (const leaver of ['first', 'second'] as const) {
      it(`a disconnect by the ${leaver} player after step ${upTo} of 8 cancels the trade and changes nothing`, async () => {
        const { s: server, url } = await serve();
        const a = await join(server, url, 'Ash');
        const b = await join(server, url, 'Brindle');
        const before = await ready(server, a, b);
        const all = steps(a, b);
        for (const step of all.slice(0, upTo)) {
          step();
          await pump([a, b], 60);
        }
        const gone = leaver === 'first' ? a : b;
        const stays = leaver === 'first' ? b : a;
        gone.c.close();
        // Once the server has seen them go, nothing the other one does can complete the trade.
        while (gone.s.ws) await sleep(5);
        for (const step of all.slice(upTo)) step();
        await pump([stays], 300);
        expect(server.zone.trades.trading(stays.s.playerId)).toBe(false);
        expect(server.sessions.has(gone.s.key)).toBe(false);
        server.saveAll();
        const after = [bagOf(server.repos.characterFor(a.s.accountId!)!.record), bagOf(server.repos.characterFor(b.s.accountId!)!.record)];
        expect(after).toEqual(before);
        expect(server.repos.ledger()).toEqual([]);
      }, 10_000);
    }
  }

  it('the server stopping the instant a trade completes keeps it; stopping just before loses it whole', async () => {
    for (const finish of [true, false]) {
      const dbPath = joinPath(mkdtempSync(joinPath(tmpdir(), 'bw-')), 'trade.sqlite');
      let { s: server, url } = await serve(dbPath);
      const a = await join(server, url, 'Ash');
      const b = await join(server, url, 'Brindle');
      const before = await ready(server, a, b);
      const all = steps(a, b);
      for (const step of all.slice(0, finish ? 8 : 7)) {
        step();
        await pump([a, b], 60);
      }
      const ids = [a.s.accountId!, b.s.accountId!];
      // A crash: nothing is saved on the way down.
      await server.close({ save: false });
      running.splice(running.indexOf(server), 1);
      ({ s: server } = await serve(dbPath));
      const after = ids.map((id) => bagOf(server.repos.characterFor(id)!.record));
      if (finish) {
        expect(after[0]).not.toBe(before[0]);
        expect(after[1]).not.toBe(before[1]);
        expect(server.repos.ledger().length).toBe(2);
      } else {
        expect(after).toEqual(before);
        expect(server.repos.ledger()).toEqual([]);
      }
    }
  }, 20_000);
});
