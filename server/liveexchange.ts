import { Exchange, fnv, type Asset, type Result } from '../src/exchange/engine';
import { buyLimitFor } from '../src/exchange/simulation';
import { itemDef, type ItemId } from '../src/data/items';
import type { Player } from '../src/sim/world';
import type { LiveIntent, LiveResult, LiveTrade, LiveView } from '../src/net/protocol';

/**
 * The live Exchange (docs/MULTIPLAYER.md 3A.7): one engine for the whole world, run by the server,
 * with a bank bridge to real characters. It is off unless the server is started with the live
 * flag; the practice market on each device is unaffected.
 *
 * - **Accounts** come from the signed-in session (`acct:<id>`), never from the client.
 * - **Placing** an offer first moves exactly what it needs (coins for a buy, items for a sell)
 *   from exchange storage, then the bank, then the bag, into the engine, then places it.
 * - **Collecting** moves the proceeds out: into the bag while there is room, then the bank. Anything
 *   that fits nowhere waits in exchange storage ("Take out" moves it later).
 * - **One request is one transaction:** the engine and the character are changed together and saved
 *   together (`commit`). If anything fails, including the save, both are put back exactly as they
 *   were, so nothing is created, lost or half-done.
 * - **Client nonces** make retries safe: an exact repeat returns the first result, anything older is
 *   refused. (The engine keeps its own nonces for the server's requests.)
 */

export type { LiveIntent, LiveResult, LiveTrade, LiveView };

export const liveAccount = (accountId: number) => `acct:${accountId}`;

interface ClientNonces {
  last: number;
  recent: { nonce: number; fp: string; result: LiveResult }[];
}

const REPLAY_MEMORY = 32;

export class LiveExchange {
  x: Exchange;
  private clients: Record<string, ClientNonces> = {};
  /** The newest audit entry and trade already saved, so each commit adds only what is new. */
  private savedSeq = 0;
  private savedTrade = 0;

  constructor(
    private clock: () => number,
    saved: unknown = null,
  ) {
    const d = saved as { engine?: unknown; clients?: Record<string, ClientNonces> } | null;
    if (d) {
      const x = Exchange.restore(d.engine, this.options());
      // A saved market that doesn't add up is never started: better closed than wrong.
      if (!x) throw new Error('The saved live Exchange failed its accounting check.');
      this.x = x;
      this.clients = JSON.parse(JSON.stringify(d.clients ?? {}));
    } else this.x = new Exchange(this.options());
    this.markSaved();
  }

  private options() {
    return { clock: this.clock, buyLimit: buyLimitFor };
  }

  private markSaved() {
    this.savedSeq = this.x.auditLog().at(-1)?.seq ?? 0;
    this.savedTrade = this.x.history({}, 1)[0]?.id ?? 0;
  }

  /** Why the Exchange is closed (null: open). Reads still work while frozen; requests don't. */
  frozen: string | null = null;
  /** Called when the Exchange freezes itself (the server tells admins and logs it). */
  onFreeze: (why: string) => void = () => {};

  freeze(why: string) {
    if (this.frozen) return;
    this.frozen = why;
    this.onFreeze(why);
  }

  unfreeze() {
    this.frozen = null;
  }

  /**
   * The periodic check: the engine's books balance, and its newest audit entry is the one the
   * database holds (so memory and disk agree). Freezes the Exchange if not; returns the problems.
   */
  checkIntegrity(storedLastHash: string | null): string[] {
    const problems = this.x.verify();
    const last = this.x.auditLog().at(-1)?.hash ?? null;
    if (last !== storedLastHash) problems.push(`newest audit entry ${last ?? 'none'} doesn’t match the database (${storedLastHash ?? 'none'})`);
    if (problems.length) this.freeze(problems.join('; '));
    return problems;
  }

  toJSON() {
    return { engine: this.x.toJSON(), clients: this.clients };
  }

  /** Audit entries and trades since the last commit. */
  unsaved() {
    return {
      audit: this.x.auditLog().filter((e) => e.seq > this.savedSeq),
      trades: this.x.history({}, 1000).filter((t) => t.id > this.savedTrade).reverse(),
    };
  }

  view(account: string): LiveView {
    const mine = this.x.history({ account }, 40).map((t) => ({ id: t.id, at: t.at, item: t.item, qty: t.qty, price: t.price, bought: t.buyer === account }));
    const market = this.x.history({}, 25).map((t) => ({ id: t.id, at: t.at, item: t.item, qty: t.qty, price: t.price }));
    return { slots: this.x.slots, orders: this.x.ordersOf(account), holdings: this.x.holdings(account), mine, market, nonce: (this.clients[account]?.last ?? 0) + 1 };
  }

  guide(item: ItemId) {
    return this.x.guide(item);
  }

  /** Accounts (other than `account`) whose offers were filled by a result: they should be told. */
  counterparts(account: string, r: Result): string[] {
    if (!r.ok || !r.trades) return [];
    return [...new Set(r.trades.flatMap((t) => [t.buyer, t.seller]).filter((a) => a !== account))];
  }

  /**
   * Runs one request for a character. `commit` saves the engine and the character together and may
   * throw (then everything is put back). Returns the result to show the player.
   */
  handle(account: string, p: Player, req: LiveIntent, commit: () => void): LiveResult {
    if (this.frozen) return { ok: false, error: 'The Exchange is closed for checks. Your offers and items are safe.' };
    const c = (this.clients[account] ??= { last: 0, recent: [] });
    const fp = fnv(JSON.stringify(req));
    if (req.nonce <= c.last) {
      const seen = c.recent.find((r) => r.nonce === req.nonce);
      if (seen && seen.fp === fp) return { ...seen.result, replayed: true };
      return { ok: false, error: seen ? 'That request number was already used for something else.' : 'Stale request (already processed).' };
    }
    // A deep copy: toJSON() shares the engine's own objects.
    const before = { engine: JSON.parse(JSON.stringify(this.x.toJSON())), clients: JSON.stringify(this.clients), bag: p.inventory.clone(), bank: p.bank.toJSON() };
    const undo = () => {
      this.x = Exchange.restore(before.engine, this.options(), false)!;
      this.clients = JSON.parse(before.clients);
      p.inventory.slots.splice(0, p.inventory.slots.length, ...before.bag.slots);
      p.bank.slots = before.bank;
    };
    let result: LiveResult;
    try {
      result = this.apply(account, p, req);
    } catch (err) {
      undo();
      throw err;
    }
    if (!result.ok) {
      // Validation failed part way (e.g. after moving coins in): put everything back.
      undo();
    } else {
      // Integrity (3B.3): the books must still balance before anything is saved. If they don't,
      // nothing is kept and the Exchange closes until an admin has looked.
      const problems = this.x.verify();
      if (problems.length) {
        undo();
        this.freeze(`accounting check failed after a ${req.op}: ${problems.join('; ')}`);
        return { ok: false, error: 'The Exchange is closed for checks. Nothing changed.' };
      }
    }
    // (Looked up again: undoing replaces the nonce records.)
    const n = (this.clients[account] ??= { last: 0, recent: [] });
    n.last = req.nonce;
    n.recent.push({ nonce: req.nonce, fp, result });
    if (n.recent.length > REPLAY_MEMORY) n.recent.shift();
    // A refused request changed nothing worth writing: its number is remembered in memory and saved
    // with the next request that does change something.
    if (!result.ok) return result;
    try {
      commit();
    } catch (err) {
      undo();
      return { ok: false, error: 'The Exchange could not save that just now. Nothing changed.' };
    }
    this.markSaved();
    return result;
  }

  private submit(req: Parameters<Exchange['submit']>[0]) {
    return this.x.submit({ ...req, nonce: this.x.nextNonce(req.account) } as typeof req);
  }

  private apply(account: string, p: Player, req: LiveIntent): LiveResult {
    switch (req.op) {
      case 'place': {
        const asset: Asset = req.side === 'buy' ? 'coins' : req.item;
        const need = req.side === 'buy' ? req.qty * req.price : req.qty;
        if (!Number.isSafeInteger(need) || need <= 0) return { ok: false, error: 'That offer is worth too much.' };
        const short = need - this.x.balance(account, asset);
        if (short > 0) {
          const moved = this.bringIn(account, p, asset, short);
          if (moved < short) return { ok: false, error: req.side === 'buy' ? 'You don’t have enough coins in your bank and bag.' : `You don’t have ${req.qty.toLocaleString()} ${itemDef(req.item).name.toLowerCase()} in your bank and bag.` };
        }
        return this.submit({ op: 'place', account, nonce: 0, slot: req.slot, side: req.side, item: req.item, qty: req.qty, price: req.price });
      }
      case 'cancel':
        return this.submit({ op: 'cancel', account, nonce: 0, orderId: req.orderId });
      case 'collect': {
        const r = this.submit({ op: 'collect', account, nonce: 0, orderId: req.orderId });
        if (!r.ok || !r.collected) return r;
        const notes = [this.payOut(account, p, 'coins').note, r.collected.item ? this.payOut(account, p, r.collected.item).note : ''].filter(Boolean);
        return { ...r, note: notes.join(' ') };
      }
      case 'claim': {
        const held = this.x.holdings(account);
        if (!held.length) return { ok: false, error: 'Exchange storage is empty.' };
        const outs = held.map((h) => this.payOut(account, p, h.asset));
        if (!outs.some((o) => o.moved > 0)) return { ok: false, error: 'There is no room in your bag or bank.' };
        return { ok: true, note: outs.map((o) => o.note).filter(Boolean).join(' ') };
      }
    }
  }

  /** Moves up to `qty` of an asset from the bank, then the bag, into exchange storage. Returns how much. */
  private bringIn(account: string, p: Player, asset: Asset, qty: number): number {
    const fromBank = Math.min(qty, p.bank.count(asset));
    const fromBag = Math.min(qty - fromBank, p.inventory.count(asset));
    if (fromBank + fromBag < qty) return fromBank + fromBag;
    if (fromBank && p.bank.remove(asset, fromBank) !== fromBank) throw new Error('bank bridge invariant broken');
    if (fromBag && p.inventory.remove(asset, fromBag) !== fromBag) throw new Error('bank bridge invariant broken');
    const r = this.submit({ op: 'deposit', account, nonce: 0, asset, qty, source: `${p.name} bank and bag` });
    if (!r.ok) throw new Error(`bank bridge deposit refused: ${r.error}`);
    return qty;
  }

  /** Moves an asset out of exchange storage: the bag while it fits, then the bank. Says where it went. */
  private payOut(account: string, p: Player, asset: Asset): { moved: number; note: string } {
    const have = this.x.balance(account, asset);
    if (have <= 0) return { moved: 0, note: '' };
    const toBag = Math.min(have, p.inventory.capacityFor(asset));
    const toBank = Math.min(have - toBag, p.bank.roomFor(asset));
    const out = (qty: number, dest: string) => {
      if (qty <= 0) return;
      const r = this.submit({ op: 'withdraw', account, nonce: 0, asset, qty, dest });
      if (!r.ok) throw new Error(`bank bridge withdraw refused: ${r.error}`);
    };
    out(toBag, 'bag');
    out(toBank, 'bank');
    if (toBag && p.inventory.add(asset, toBag) !== toBag) throw new Error('bank bridge invariant broken');
    if (toBank && p.bank.add(asset, toBank) !== toBank) throw new Error('bank bridge invariant broken');
    const name = asset === 'coins' ? 'coins' : itemDef(asset).name.toLowerCase();
    const left = have - toBag - toBank;
    const parts = [toBag ? `${toBag.toLocaleString()} ${name} into your bag` : '', toBank ? `${toBank.toLocaleString()} ${name} into your bank` : ''].filter(Boolean);
    return { moved: toBag + toBank, note: `${parts.length ? `Moved ${parts.join(' and ')}.` : ''}${left ? ` ${left.toLocaleString()} ${name} wait in exchange storage (no room).` : ''}`.trim() };
  }
}
