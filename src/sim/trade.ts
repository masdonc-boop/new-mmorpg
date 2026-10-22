import { itemDef, type ItemId } from '../data/items';
import type { Inventory, ItemStack } from './inventory';
import type { GameEvent, Player, PlayerId } from './world';

/**
 * Player-to-player trading (docs/MULTIPLAYER.md 3A.6 and 5.2), as a rule of the shared world.
 *
 * 1. One player asks; the other asks back (or taps the request) and the trade opens.
 * 2. Both put items from their bag on offer. Offered items stay in the bag until the very end, so
 *    a crash or disconnect mid-trade can never strand them. Any change to either offer clears
 *    both players' acceptance.
 * 3. Both accept: the offers are frozen and shown again on a final screen.
 * 4. Both confirm: one swap, checked again (each still has what they offered and room for what
 *    they get), done in one step by the world. A server saves both characters in one database
 *    transaction (`commitHook`) before anyone is told; if that fails the swap is undone exactly.
 *
 * Moving out of range, dying or leaving the world cancels the trade, and nothing changes.
 */

/** How close two players must be to start a trade, and how far apart a trade survives. */
export const TRADE_REACH = 6;
export const TRADE_LEASH = 12;
/** A trade request lapses after this long. */
export const TRADE_REQUEST_SECONDS = 30;

export type TradeStage = 'offer' | 'confirm';

/** A trade as one of its players sees it. */
export interface TradeView {
  id: number;
  with: PlayerId;
  name: string;
  stage: TradeStage;
  mine: ItemStack[];
  theirs: ItemStack[];
  iAccepted: boolean;
  theyAccepted: boolean;
  /** Free bag slots the other player has (for "not enough room" hints). */
  theirFreeSlots: number;
}

/** A completed swap: what each side gave. */
export interface TradeCommit {
  id: number;
  a: PlayerId;
  b: PlayerId;
  aGave: ItemStack[];
  bGave: ItemStack[];
}

/** What the trade desk needs from the world. */
export interface TradeHost {
  readonly time: number;
  readonly player: Player;
  playerById(id: PlayerId): Player | undefined;
  emitFor(id: PlayerId, e: GameEvent): void;
}

class Trade {
  stage: TradeStage = 'offer';
  readonly accepted = new Set<PlayerId>();
  readonly offers = new Map<PlayerId, ItemStack[]>();
  constructor(
    readonly id: number,
    readonly a: PlayerId,
    readonly b: PlayerId,
  ) {
    this.offers.set(a, []);
    this.offers.set(b, []);
  }
  other(id: PlayerId) {
    return id === this.a ? this.b : this.a;
  }
}

const copy = (s: ItemStack[]) => s.map((x) => ({ ...x }));
const offered = (list: ItemStack[], item: ItemId) => list.filter((s) => s.item === item).reduce((n, s) => n + s.qty, 0);

/** Takes `give` out of a copy of the bag and puts `get` in; null if either doesn't work out. */
function afterSwap(bag: Inventory, give: ItemStack[], get: ItemStack[]): Inventory | null {
  const c = bag.clone();
  for (const s of give) if (c.remove(s.item, s.qty) !== s.qty) return null;
  for (const s of get) if (c.add(s.item, s.qty) !== s.qty) return null;
  return c;
}

export class TradeDesk {
  private requests = new Map<PlayerId, { to: PlayerId; at: number }>();
  private byPlayer = new Map<PlayerId, Trade>();
  private nextId = 1;
  /**
   * Called with each swap once both bags have changed. A server saves both characters here; if it
   * throws, the swap is undone exactly and the trade is cancelled.
   */
  commitHook: ((c: TradeCommit) => void) | null = null;

  constructor(private w: TradeHost) {}

  /** Whether a player is in a trade. */
  trading(id: PlayerId): boolean {
    return this.byPlayer.has(id);
  }

  /** The trade a player is in, as they see it. */
  viewFor(id: PlayerId): TradeView | null {
    const t = this.byPlayer.get(id);
    if (!t) return null;
    const o = t.other(id);
    const them = this.w.playerById(o);
    return {
      id: t.id,
      with: o,
      name: them?.name ?? '?',
      stage: t.stage,
      mine: copy(t.offers.get(id)!),
      theirs: copy(t.offers.get(o)!),
      iAccepted: t.accepted.has(id),
      theyAccepted: t.accepted.has(o),
      theirFreeSlots: them?.inventory.freeSlots() ?? 0,
    };
  }

  private say(id: PlayerId, text: string, tone: 'info' | 'warn' | 'good' = 'info') {
    this.w.emitFor(id, { type: 'message', text, tone });
  }

  private show(t: Trade) {
    for (const id of [t.a, t.b]) this.w.emitFor(id, { type: 'trade', view: this.viewFor(id) });
  }

  private near(a: Player, b: Player, range: number) {
    return Math.hypot(a.x - b.x, a.z - b.z) <= range;
  }

  /** Asks another player to trade (or accepts their request). */
  request(target: PlayerId) {
    const me = this.w.player;
    const them = this.w.playerById(target);
    if (me.dead || target === me.id) return;
    if (!them || them.dead) return this.say(me.id, "They aren't here.", 'warn');
    if (this.byPlayer.has(me.id)) return this.say(me.id, 'You are already trading.', 'warn');
    if (this.byPlayer.has(them.id)) return this.say(me.id, `${them.name} is busy trading.`, 'warn');
    if (!this.near(me, them, TRADE_REACH)) return this.say(me.id, `Get closer to ${them.name} to trade.`, 'warn');
    const theirs = this.requests.get(them.id);
    if (theirs && theirs.to === me.id && this.w.time - theirs.at <= TRADE_REQUEST_SECONDS) {
      this.requests.delete(them.id);
      this.requests.delete(me.id);
      const t = new Trade(this.nextId++, them.id, me.id);
      this.byPlayer.set(t.a, t);
      this.byPlayer.set(t.b, t);
      this.show(t);
      return;
    }
    this.requests.set(me.id, { to: them.id, at: this.w.time });
    this.w.emitFor(them.id, { type: 'tradeRequest', from: me.id, name: me.name });
    this.say(me.id, `You ask ${them.name} to trade.`);
  }

  /** Puts up to `qty` of the item in a bag slot on offer. */
  offer(slot: number, qty: number) {
    const me = this.w.player;
    const t = this.byPlayer.get(me.id);
    if (!t) return;
    if (t.stage !== 'offer') return this.say(me.id, 'The offer is final now. Decline to change it.', 'warn');
    const s = me.inventory.slots[slot];
    if (!s) return;
    const list = t.offers.get(me.id)!;
    const n = Math.min(qty, me.inventory.count(s.item) - offered(list, s.item));
    if (n <= 0) return;
    const stack = list.find((x) => x.item === s.item);
    if (stack) stack.qty += n;
    else list.push({ item: s.item, qty: n });
    this.changed(t);
  }

  /** Takes up to `qty` of an item back off the offer. */
  withdraw(item: ItemId, qty: number) {
    const me = this.w.player;
    const t = this.byPlayer.get(me.id);
    if (!t) return;
    if (t.stage !== 'offer') return this.say(me.id, 'The offer is final now. Decline to change it.', 'warn');
    const list = t.offers.get(me.id)!;
    const i = list.findIndex((x) => x.item === item);
    if (i < 0) return;
    list[i].qty -= Math.min(qty, list[i].qty);
    if (list[i].qty === 0) list.splice(i, 1);
    // Taking something away is worth pointing out to the other side.
    this.say(t.other(me.id), `${me.name} took ${itemDef(item).name} off the offer.`, 'warn');
    this.changed(t);
  }

  private changed(t: Trade) {
    t.accepted.clear();
    this.show(t);
  }

  /** Accepts the offers (first screen) or confirms the swap (final screen). */
  accept() {
    const me = this.w.player;
    const t = this.byPlayer.get(me.id);
    if (!t) return;
    const a = this.w.playerById(t.a);
    const b = this.w.playerById(t.b);
    if (!a || !b) return this.cancel(t, 'The trade was cancelled.');
    const offerA = t.offers.get(t.a)!;
    const offerB = t.offers.get(t.b)!;
    if (!offerA.length && !offerB.length) return this.say(me.id, 'Nothing has been offered yet.', 'warn');
    // Room for what's coming (counting what goes out), checked before anyone can accept.
    const mine = t.offers.get(me.id)!;
    const theirs = t.offers.get(t.other(me.id))!;
    if (!afterSwap(me.inventory, mine, theirs)) return this.say(me.id, 'You need more room in your bag for this trade.', 'warn');
    t.accepted.add(me.id);
    if (t.accepted.size < 2) return this.show(t);
    if (t.stage === 'offer') {
      t.stage = 'confirm';
      t.accepted.clear();
      return this.show(t);
    }
    this.commit(t, a, b);
  }

  private commit(t: Trade, a: Player, b: Player) {
    const aGave = copy(t.offers.get(t.a)!);
    const bGave = copy(t.offers.get(t.b)!);
    const newA = afterSwap(a.inventory, aGave, bGave);
    const newB = afterSwap(b.inventory, bGave, aGave);
    if (!newA || !newB) {
      const who = !newA ? a : b;
      return this.cancel(t, `The trade was cancelled: ${who.name} no longer has the items or the room for it.`);
    }
    const oldA = a.inventory.clone();
    const oldB = b.inventory.clone();
    const put = (bag: Inventory, from: Inventory) => bag.slots.splice(0, bag.slots.length, ...from.slots);
    put(a.inventory, newA);
    put(b.inventory, newB);
    try {
      this.commitHook?.({ id: t.id, a: t.a, b: t.b, aGave, bGave });
    } catch {
      put(a.inventory, oldA);
      put(b.inventory, oldB);
      return this.cancel(t, 'The trade could not be completed. Nothing changed.');
    }
    this.byPlayer.delete(t.a);
    this.byPlayer.delete(t.b);
    for (const id of [t.a, t.b]) {
      this.w.emitFor(id, { type: 'trade', view: null });
      this.say(id, 'Trade complete.', 'good');
    }
  }

  decline() {
    const me = this.w.player;
    const t = this.byPlayer.get(me.id);
    if (t) this.cancel(t, `${me.name} declined the trade.`);
  }

  private cancel(t: Trade, why: string) {
    this.byPlayer.delete(t.a);
    this.byPlayer.delete(t.b);
    for (const id of [t.a, t.b]) {
      this.w.emitFor(id, { type: 'trade', view: null });
      this.say(id, why, 'warn');
    }
  }

  /** A player left the world (or disconnected): their trade and requests end. */
  leave(id: PlayerId, name: string) {
    this.requests.delete(id);
    for (const [from, r] of this.requests) if (r.to === id) this.requests.delete(from);
    const t = this.byPlayer.get(id);
    if (t) this.cancel(t, `The trade was cancelled: ${name} left.`);
  }

  /** Lapses old requests and cancels trades whose players died or wandered apart. */
  tick() {
    for (const [from, r] of this.requests) if (this.w.time - r.at > TRADE_REQUEST_SECONDS) this.requests.delete(from);
    for (const t of new Set(this.byPlayer.values())) {
      const a = this.w.playerById(t.a);
      const b = this.w.playerById(t.b);
      if (!a || !b || a.dead || b.dead) this.cancel(t, 'The trade was cancelled.');
      else if (!this.near(a, b, TRADE_LEASH)) this.cancel(t, 'The trade was cancelled: you moved too far apart.');
    }
  }
}
