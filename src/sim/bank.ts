import { isItemId, type ItemDef, type ItemId } from '../data/items';
import { addTo, type Inventory, type ItemStack } from './inventory';

/** Starting bank size. Kept as a field on Bank so it can grow later (upgrades, membership). */
export const BANK_SLOTS = 200;
/** Per-slot ceiling. Every item stacks in the bank, so one slot holds any amount up to this. */
export const BANK_MAX_STACK = 2_000_000_000;

export type BankCategory = 'all' | 'materials' | 'tools' | 'food' | 'ammo' | 'other';

export const BANK_CATEGORIES: { id: BankCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'materials', label: 'Materials' },
  { id: 'tools', label: 'Tools' },
  { id: 'food', label: 'Food' },
  { id: 'ammo', label: 'Ammo & runes' },
  { id: 'other', label: 'Other' },
];

export function bankCategory(d: ItemDef): Exclude<BankCategory, 'all'> {
  switch (d.kind) {
    case 'material':
      return 'materials';
    case 'tool':
      return 'tools';
    case 'food':
      return 'food';
    case 'ammo':
      return 'ammo';
    default:
      return 'other';
  }
}

/**
 * Item storage kept at the bank. Unlike the inventory, every item type stacks into a single slot
 * (one slot per item type), so 200 slots hold 200 different items in any quantity.
 *
 * Storage is per character today. It is deliberately a standalone object with its own JSON form so a
 * server can later key it by account instead of by character without touching the transfer rules.
 */
export class Bank {
  /** Occupied slots in display order (first deposit first). */
  slots: ItemStack[] = [];

  constructor(public capacity = BANK_SLOTS) {}

  count(item: ItemId): number {
    return this.slots.find((s) => s.item === item)?.qty ?? 0;
  }

  usedSlots(): number {
    return this.slots.length;
  }

  isFull(): boolean {
    return this.slots.length >= this.capacity;
  }

  /** How many of `item` the bank can still take. */
  roomFor(item: ItemId): number {
    const s = this.slots.find((x) => x.item === item);
    if (s) return BANK_MAX_STACK - s.qty;
    return this.isFull() ? 0 : BANK_MAX_STACK;
  }

  /** Adds up to qty (bounded by roomFor); returns the amount added. */
  add(item: ItemId, qty: number): number {
    const n = Math.min(Math.floor(qty), this.roomFor(item));
    if (!(n > 0)) return 0;
    const s = this.slots.find((x) => x.item === item);
    if (s) s.qty += n;
    else this.slots.push({ item, qty: n });
    return n;
  }

  /** Removes up to qty; an emptied slot is freed. Returns the amount removed. */
  remove(item: ItemId, qty: number): number {
    const i = this.slots.findIndex((x) => x.item === item);
    if (i < 0) return 0;
    const n = Math.min(Math.floor(qty), this.slots[i].qty);
    if (!(n > 0)) return 0;
    this.slots[i].qty -= n;
    if (this.slots[i].qty <= 0) this.slots.splice(i, 1);
    return n;
  }

  toJSON(): ItemStack[] {
    return this.slots.map((s) => ({ ...s }));
  }

  /**
   * Rebuilds a bank from saved data. Duplicate entries merge, unknown ids and invalid quantities are
   * ignored. Nothing valid is dropped: if a save somehow holds more item types than the capacity, they
   * are all kept (the bank then simply accepts no new item types until slots are freed).
   */
  static restore(data: unknown, capacity = BANK_SLOTS): Bank {
    const bank = new Bank(capacity);
    if (!Array.isArray(data)) return bank;
    const merged: ItemStack[] = [];
    for (const s of data as Partial<ItemStack>[]) {
      if (!s || typeof s.item !== 'string' || !isItemId(s.item)) continue;
      const qty = Math.floor(Number(s.qty));
      if (!(qty > 0)) continue;
      addTo(merged, s.item, qty);
    }
    bank.slots = merged.map((s) => ({ item: s.item, qty: Math.min(s.qty, BANK_MAX_STACK) }));
    return bank;
  }
}

export type TransferFailure = 'none' | 'bankFull' | 'inventoryFull' | 'nothing';

export interface TransferResult {
  item: ItemId;
  /** Amount actually moved. */
  moved: number;
  /** Amount that was requested (after clamping to what the source holds). */
  requested: number;
  /** Why fewer than `requested` moved (or 'none'). */
  limit: TransferFailure;
}

/**
 * Moves up to `qty` of `item` from the inventory into the bank. The amount is decided first from both
 * sides' limits, then exactly that amount leaves the inventory and enters the bank, so a transfer can
 * never duplicate or lose items.
 */
export function depositItem(bank: Bank, inv: Inventory, item: ItemId, qty: number): TransferResult {
  const have = inv.count(item);
  const requested = Math.min(have, Math.max(0, Math.floor(qty)));
  if (requested <= 0) return { item, moved: 0, requested: 0, limit: 'nothing' };
  const n = Math.min(requested, bank.roomFor(item));
  if (n <= 0) return { item, moved: 0, requested, limit: 'bankFull' };
  const removed = inv.remove(item, n);
  const added = bank.add(item, removed);
  if (added !== removed) throw new Error('bank deposit invariant broken');
  return { item, moved: added, requested, limit: added < requested ? 'bankFull' : 'none' };
}

/** Moves up to `qty` of `item` from the bank into the inventory (one slot each for non-stackables). */
export function withdrawItem(bank: Bank, inv: Inventory, item: ItemId, qty: number): TransferResult {
  const have = bank.count(item);
  const requested = Math.min(have, Math.max(0, Math.floor(qty)));
  if (requested <= 0) return { item, moved: 0, requested: 0, limit: 'nothing' };
  const n = Math.min(requested, inv.capacityFor(item));
  if (n <= 0) return { item, moved: 0, requested, limit: 'inventoryFull' };
  const removed = bank.remove(item, n);
  const added = inv.add(item, removed);
  if (added !== removed) throw new Error('bank withdraw invariant broken');
  return { item, moved: added, requested, limit: added < requested ? 'inventoryFull' : 'none' };
}

/** Deposits every item in the inventory, item type by item type. */
export function depositInventory(bank: Bank, inv: Inventory): TransferResult[] {
  const items: ItemId[] = [];
  for (const s of inv.slots) if (s && !items.includes(s.item)) items.push(s.item);
  return items.map((item) => depositItem(bank, inv, item, inv.count(item)));
}

/** Deposits loose stacks (e.g. items held after a save migration) into the bank; returns what is left. */
export function depositStacks(bank: Bank, stacks: ItemStack[]): { left: ItemStack[]; moved: number } {
  let moved = 0;
  const left: ItemStack[] = [];
  for (const s of stacks) {
    const n = bank.add(s.item, s.qty);
    moved += n;
    if (n < s.qty) left.push({ item: s.item, qty: s.qty - n });
  }
  return { left, moved };
}
