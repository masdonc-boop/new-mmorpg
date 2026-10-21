import { isItemId, itemDef, type ItemId } from '../data/items';

export interface ItemStack {
  item: ItemId;
  qty: number;
}

export const INVENTORY_SLOTS = 28;

/** Fixed-slot inventory. Stackable items share one slot; others take one slot each. */
export class Inventory {
  readonly slots: (ItemStack | null)[];

  constructor(size = INVENTORY_SLOTS) {
    this.slots = new Array(size).fill(null);
  }

  count(item: ItemId): number {
    let n = 0;
    for (const s of this.slots) if (s && s.item === item) n += s.qty;
    return n;
  }

  has(item: ItemId, qty = 1): boolean {
    return this.count(item) >= qty;
  }

  freeSlots(): number {
    return this.slots.filter((s) => s === null).length;
  }

  usedSlots(): number {
    return this.slots.length - this.freeSlots();
  }

  isFull(): boolean {
    return this.freeSlots() === 0;
  }

  clone(): Inventory {
    const c = new Inventory(this.slots.length);
    this.slots.forEach((s, i) => (c.slots[i] = s ? { ...s } : null));
    return c;
  }

  /** Whether every stack in `items` would fit at once (checked on a copy; nothing changes). */
  canAddAll(items: readonly ItemStack[]): boolean {
    const c = this.clone();
    return items.every((it) => c.add(it.item, it.qty) === it.qty);
  }

  /** How many of `item` could be added right now. */
  capacityFor(item: ItemId): number {
    const d = itemDef(item);
    if (d.stackable) {
      const existing = this.slots.find((s) => s?.item === item);
      if (existing) return d.maxStack - existing.qty;
      return this.freeSlots() > 0 ? d.maxStack : 0;
    }
    return this.freeSlots();
  }

  /** Adds as many as fit; returns the quantity actually added. */
  add(item: ItemId, qty = 1): number {
    qty = Math.floor(qty);
    if (!(qty > 0)) return 0;
    const d = itemDef(item);
    if (d.stackable) {
      let slot = this.slots.find((s) => s?.item === item) ?? null;
      if (!slot) {
        const i = this.slots.indexOf(null);
        if (i < 0) return 0;
        slot = { item, qty: 0 };
        this.slots[i] = slot;
      }
      const added = Math.min(qty, d.maxStack - slot.qty);
      slot.qty += added;
      return added;
    }
    let added = 0;
    for (let i = 0; i < this.slots.length && added < qty; i++) {
      if (this.slots[i] === null) {
        this.slots[i] = { item, qty: 1 };
        added++;
      }
    }
    return added;
  }

  /** Removes up to qty; returns the quantity actually removed. */
  remove(item: ItemId, qty = 1): number {
    qty = Math.floor(qty);
    let removed = 0;
    for (let i = this.slots.length - 1; i >= 0 && removed < qty; i--) {
      const s = this.slots[i];
      if (!s || s.item !== item) continue;
      const take = Math.min(s.qty, qty - removed);
      s.qty -= take;
      removed += take;
      if (s.qty <= 0) this.slots[i] = null;
    }
    return removed;
  }

  removeAt(slot: number, qty = Infinity): ItemStack | null {
    const s = this.slots[slot];
    if (!s) return null;
    const take = Math.min(qty, s.qty);
    s.qty -= take;
    if (s.qty <= 0) this.slots[slot] = null;
    return { item: s.item, qty: take };
  }

  swap(a: number, b: number) {
    if (a === b || a < 0 || b < 0 || a >= this.slots.length || b >= this.slots.length) return;
    [this.slots[a], this.slots[b]] = [this.slots[b], this.slots[a]];
  }

  toJSON(): (ItemStack | null)[] {
    return this.slots.map((s) => (s ? { ...s } : null));
  }

  static fromJSON(data: (ItemStack | null)[] | undefined): Inventory {
    return Inventory.restore(data).inventory;
  }

  /**
   * Rebuilds an inventory from saved slots, normalising it to the current item rules.
   * Saves from before resources became non-stackable may hold e.g. 40 logs in one slot: each
   * non-stackable item is split into its own slot where there is room, and whatever cannot fit is
   * returned as `overflow` rather than deleted. Unknown item ids (removed content) are dropped.
   */
  static restore(data: (ItemStack | null)[] | undefined, size = INVENTORY_SLOTS): { inventory: Inventory; overflow: ItemStack[] } {
    const inv = new Inventory(size);
    const overflow: ItemStack[] = [];
    if (!Array.isArray(data)) return { inventory: inv, overflow };
    const extra: ItemStack[] = [];
    data.forEach((s, i) => {
      if (!s || typeof s.item !== 'string' || !isItemId(s.item)) return;
      const qty = Math.floor(Number(s.qty));
      if (!(qty > 0)) return;
      const d = itemDef(s.item);
      // Keep each saved slot where it was (up to one item / one full stack); the rest is re-added below.
      const keep = i < size ? Math.min(qty, d.stackable ? d.maxStack : 1) : 0;
      if (keep > 0) inv.slots[i] = { item: s.item, qty: keep };
      if (qty > keep) extra.push({ item: s.item, qty: qty - keep });
    });
    for (const e of extra) {
      const added = inv.add(e.item, e.qty);
      if (added < e.qty) addTo(overflow, e.item, e.qty - added);
    }
    return { inventory: inv, overflow };
  }
}

/** Adds to a loose list of stacks, merging by item. */
export function addTo(list: ItemStack[], item: ItemId, qty: number) {
  const s = list.find((x) => x.item === item);
  if (s) s.qty += qty;
  else list.push({ item, qty });
}
