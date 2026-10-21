import { itemDef, type ItemId } from '../data/items';

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
    if (qty <= 0) return 0;
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
    const inv = new Inventory();
    if (!Array.isArray(data)) return inv;
    data.slice(0, INVENTORY_SLOTS).forEach((s, i) => {
      if (s && typeof s.item === 'string' && s.qty > 0) {
        try {
          itemDef(s.item);
          inv.slots[i] = { item: s.item, qty: Math.floor(s.qty) };
        } catch {
          /* unknown item from older save: drop it */
        }
      }
    });
    return inv;
  }
}
