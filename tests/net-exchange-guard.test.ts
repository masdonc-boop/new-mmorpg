import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer, type Session } from '../server/server';
import { runAdmin } from '../server/admin';
import { DEFAULT_EXCHANGE_POLICY, ExchangeWatch, checkOffer, type ExchangePolicy } from '../server/exchangeguard';
import { Exchange, type Trade } from '../src/exchange/engine';
import { NetClient } from '../src/net/client';
import type { AdminCommand, LiveIntent, LiveResult } from '../src/net/protocol';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const running: RunningServer[] = [];
const clients: NetClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of running.splice(0)) await s.close().catch(() => {});
});
type Ask = LiveIntent extends infer T ? (T extends LiveIntent ? Omit<T, 'nonce'> : never) : never;

async function serve(opts: { policy?: Partial<ExchangePolicy>; integrityIntervalMs?: number } = {}) {
  const dbPath = joinPath(mkdtempSync(joinPath(tmpdir(), 'bw-')), 'guard.sqlite');
  const s = await startServer({ port: 0, dbPath, log: () => {}, liveExchange: true, exchangePolicy: opts.policy, integrityIntervalMs: opts.integrityIntervalMs });
  running.push(s);
  return { s, url: `ws://127.0.0.1:${s.port}`, dbPath };
}
async function join(server: RunningServer, url: string, name: string, auth?: object) {
  const c = new NetClient({ url, auth: (auth ?? { kind: 'register', username: name, password: 'brightwater1' }) as never });
  clients.push(c);
  await c.connect();
  const s = [...server.sessions.values()].find((x) => x.name === name)!;
  const clerk = server.zone.npcs.find((n) => n.def.service === 'exchange')!;
  s.player.x = s.player.prevX = clerk.x + 1;
  s.player.z = s.player.prevZ = clerk.z;
  s.player.exchangeAt = clerk.id;
  return { c, s, nonce: 0, said: [] as string[] };
}
type Who = Awaited<ReturnType<typeof join>>;
async function ask(w: Who, req: Ask): Promise<LiveResult> {
  const n = ++w.nonce;
  w.c.gx({ ...req, nonce: n } as LiveIntent);
  const end = Date.now() + 2000;
  for (;;) {
    await sleep(10);
    w.c.update(0.01);
    for (const e of w.c.drainEvents()) {
      if (e.type === 'message') w.said.push(e.text);
      if (e.type === 'exchangeResult' && e.live && e.nonce === n) return e.result;
    }
    if (Date.now() > end) throw new Error('no answer');
  }
}
async function admin(w: Who, cmd: AdminCommand) {
  const before = w.c.adminReplies.length;
  w.c.admin(cmd);
  const end = Date.now() + 2000;
  while (w.c.adminReplies.length === before && Date.now() < end) {
    await sleep(10);
    w.c.update(0.01);
    for (const e of w.c.drainEvents()) if (e.type === 'message') w.said.push(e.text);
  }
  return w.c.adminReplies[before];
}
const trade = (id: number, buyer: string, seller: string, price: number): Trade => ({ id, seq: id, at: 0, item: 'logs', qty: 1, price, buyOrder: 1, sellOrder: 2, buyer, seller });

describe('3B.3 offer rules and watching', () => {
  it('keeps offers near the guide, within the largest value, off blocked items, and from old enough accounts', () => {
    const x = new Exchange({ clock: () => 0 });
    const p = { ...DEFAULT_EXCHANGE_POLICY, blockedItems: ['iron_bar' as const], minAccountAgeMinutes: 10, maxOfferValue: 1000 };
    const place = (item: 'logs' | 'iron_bar', qty: number, price: number): LiveIntent => ({ op: 'place', nonce: 1, slot: 0, side: 'sell', item, qty, price });
    const old = 3600_000;
    // No trades yet: the band is the item's value × 20 either way.
    expect(checkOffer(p, x, place('logs', 1, 5), old)).toBeNull();
    expect(checkOffer({ ...p, maxOfferValue: 1e9 }, x, place('logs', 1, 5000), old)).toMatch(/too far from the guide/);
    expect(checkOffer(p, x, place('iron_bar', 1, 30), old)).toMatch(/can’t be traded/);
    expect(checkOffer(p, x, place('logs', 300, 5), old)).toMatch(/limited to 1,000 coins/);
    expect(checkOffer(p, x, place('logs', 1, 5), 60_000)).toMatch(/after 10 minutes/);
    expect(checkOffer({ ...p, priceBand: null }, x, place('logs', 1, 900), old)).toBeNull();
    // Cancels and collections are never held back by price rules.
    expect(checkOffer(p, x, { op: 'cancel', nonce: 1, orderId: 9 }, old)).toBeNull();
  });

  it('flags lopsided prices, the same two accounts again and again, and offers churned in and out', () => {
    let now = 0;
    const w = new ExchangeWatch({ ...DEFAULT_EXCHANGE_POLICY, repeatPairPerHour: 2, churnPer10Minutes: 2 }, () => now);
    const place: LiveIntent = { op: 'place', nonce: 1, slot: 0, side: 'buy', item: 'logs', qty: 1, price: 50 };
    expect(w.observe('a', place, [trade(1, 'a', 'b', 50)], { price: 5, fromTrades: true }).map((f) => [f.kind, f.account])).toEqual([
      ['price-outlier', 'a'],
      ['price-outlier', 'b'],
    ]);
    // Without a traded guide there is nothing to compare against.
    expect(w.observe('a', place, [trade(2, 'a', 'b', 50)], { price: 5, fromTrades: false })).toEqual([]);
    expect(w.observe('a', place, [trade(3, 'a', 'b', 5)], null).map((f) => f.kind)).toEqual(['churn', 'repeat-pair', 'repeat-pair']);
    now += 3600_001;
    expect(w.observe('a', place, [trade(4, 'a', 'b', 5)], null)).toEqual([]);
  });
});

describe('3B.3 live Exchange safeguards on the server', () => {
  it('rate limits are per account and survive reconnecting; refusals are logged', async () => {
    const { s: server, url } = await serve({ policy: { requestsPerMinute: 4 } });
    const a = await join(server, url, 'Ash');
    for (let i = 0; i < 4; i++) expect((await ask(a, { op: 'claim' })).ok === false).toBe(true);
    let r = await ask(a, { op: 'claim' });
    expect(r.ok === false && r.error).toMatch(/too quickly/);
    // Dropping the connection doesn't reset the limit.
    const token = a.c.session!;
    a.c.close();
    await sleep(100);
    const b = await join(server, url, 'Ash', { kind: 'token', token });
    b.nonce = 100;
    r = await ask(b, { op: 'claim' });
    expect(r.ok === false && r.error).toMatch(/too quickly/);
    expect(server.repos.exchangeFlags().some((f) => f.kind === 'rate-limited')).toBe(true);
  }, 15_000);

  it('offers outside the rules are refused before anything moves, and logged', async () => {
    const { s: server, url } = await serve();
    const a = await join(server, url, 'Ash');
    a.s.player.bank.add('logs', 10);
    const r = await ask(a, { op: 'place', slot: 0, side: 'sell', item: 'logs', qty: 10, price: 99_999 });
    expect(r.ok === false && r.error).toMatch(/too far from the guide/);
    expect(a.s.player.bank.count('logs')).toBe(10);
    expect(server.repos.exchangeFlags()[0]).toEqual(expect.objectContaining({ kind: 'refused' }));
  }, 10_000);

  it('a trade far from the guide is flagged for both accounts, and results never name the other side', async () => {
    const { s: server, url } = await serve({ policy: { priceBand: null } });
    const a = await join(server, url, 'Ash');
    const b = await join(server, url, 'Brindle');
    a.s.player.bank.add('logs', 20);
    b.s.player.bank.add('coins', 5000);
    // Establish a guide of 5 from a real trade, then a sale at 60.
    await ask(a, { op: 'place', slot: 0, side: 'sell', item: 'logs', qty: 5, price: 5 });
    await ask(b, { op: 'place', slot: 0, side: 'buy', item: 'logs', qty: 5, price: 5 });
    await ask(a, { op: 'place', slot: 1, side: 'sell', item: 'logs', qty: 5, price: 60 });
    const r = await ask(b, { op: 'place', slot: 1, side: 'buy', item: 'logs', qty: 5, price: 60 });
    expect(r.ok && r.trades?.length).toBe(1);
    expect(JSON.stringify(r)).not.toContain(`acct:${a.s.accountId}`);
    const flags = server.repos.exchangeFlags().filter((f) => f.kind === 'price-outlier');
    expect(flags.map((f) => f.account).sort()).toEqual([`acct:${a.s.accountId}`, `acct:${b.s.accountId}`].sort());
  }, 15_000);

  it('if the books stop balancing, the Exchange freezes itself, tells admins, and reopens only once they balance', async () => {
    const { s: server, url, dbPath } = await serve();
    const mod = await join(server, url, 'Warden');
    runAdmin(['grant', 'Warden', 'admin'], dbPath, () => {});
    const a = await join(server, url, 'Ash');
    a.s.player.bank.add('logs', 10);
    expect((await ask(a, { op: 'place', slot: 0, side: 'sell', item: 'logs', qty: 2, price: 5 })).ok).toBe(true);
    // Something goes wrong in memory: coins appear from nowhere.
    const x = server.live!.x as unknown as { balances: Record<string, Record<string, number>> };
    (x.balances['acct:999'] ??= {}).coins = 1000;
    const bankBefore = a.s.player.bank.count('logs');
    const r = await ask(a, { op: 'place', slot: 1, side: 'sell', item: 'logs', qty: 2, price: 5 });
    expect(r.ok === false && r.error).toMatch(/closed for checks/);
    expect(a.s.player.bank.count('logs')).toBe(bankBefore);
    expect(server.live!.frozen).toMatch(/accounting check failed/);
    await sleep(100);
    mod.c.update(0.01);
    for (const e of mod.c.drainEvents()) if (e.type === 'message') mod.said.push(e.text);
    expect(mod.said.some((t) => /froze itself/.test(t))).toBe(true);
    expect(server.repos.exchangeFlags()[0].kind).toBe('frozen');
    // Reads still work; requests don't; it won't reopen while the books are wrong.
    expect((await ask(a, { op: 'claim' })).ok).toBe(false);
    expect((await admin(mod, { op: 'exchange', action: 'unfreeze' })).lines[0]).toMatch(/Still failing/);
    // (Undoing the refused request rebuilt the engine: repair the one the server now holds.)
    delete (server.live!.x as unknown as typeof x).balances['acct:999'];
    expect((await admin(mod, { op: 'exchange', action: 'unfreeze' })).ok).toBe(true);
    expect((await ask(a, { op: 'place', slot: 1, side: 'sell', item: 'logs', qty: 2, price: 5 })).ok).toBe(true);
    // Admins can also close it by hand.
    expect((await admin(mod, { op: 'exchange', action: 'freeze', reason: 'maintenance' })).lines[0]).toMatch(/closed: frozen by Warden.*maintenance/);
  }, 15_000);

  it('the periodic check freezes the Exchange when memory and the database disagree', async () => {
    const { s: server, url } = await serve({ integrityIntervalMs: 100 });
    const a = await join(server, url, 'Ash');
    a.s.player.bank.add('logs', 10);
    expect((await ask(a, { op: 'place', slot: 0, side: 'sell', item: 'logs', qty: 2, price: 5 })).ok).toBe(true);
    await sleep(250);
    expect(server.live!.frozen).toBeNull();
    server.repos.db.prepare('DELETE FROM exchange_audit WHERE seq = (SELECT MAX(seq) FROM exchange_audit)').run();
    await sleep(250);
    expect(server.live!.frozen).toMatch(/doesn’t match the database/);
  }, 10_000);
});

/** (Typed helper use.) */
export type { Session };
