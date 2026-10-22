import { isItemId, type ItemDef, type ItemId } from '../data/items';
import type { Inventory, ItemStack } from './inventory';

/** Starting bank size. Kept as a field on Bank so it can grow later (upgrades, membership). */
export const BANK_SLOTS = 200;
/** Per-slot ceiling. Every item stacks in the bank, so one slot holds any amount up to this. */
export const BANK_MAX_STACK = 2_000_000_000;
/** Custom tabs (1..9) besides the main tab (0), as in OSRS. Empty tabs close up automatically. */
export const BANK_TABS = 9;

/** A bank slot. `tab` 0 is the main tab. qty 0 is a placeholder that keeps the item's place. */
export interface BankSlot extends ItemStack {
  tab: number;
}

export type BankCategory = 'all' | 'materials' | 'equipment' | 'tools' | 'food' | 'ammo' | 'other';

export const BANK_CATEGORIES: { id: BankCategory; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'materials', label: 'Materials' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'tools', label: 'Tools' },
  { id: 'food', label: 'Food' },
  { id: 'ammo', label: 'Ammo & sparks' },
  { id: 'other', label: 'Other' },
];

export function bankCategory(d: ItemDef): Exclude<BankCategory, 'all'> {
  switch (d.kind) {
    case 'material':
      return 'materials';
    case 'tool':
      return 'tools';
    case 'weapon':
    case 'armour':
      return 'equipment';
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
  /** Occupied slots (placeholders included) in display order within each tab (first deposit first). */
  slots: BankSlot[] = [];
  /** Leave a placeholder when the last of an item is withdrawn (OSRS setting; off by default). */
  placeholders = false;

  constructor(public capacity = BANK_SLOTS) {}

  count(item: ItemId): number {
    return this.slots.find((s) => s.item === item)?.qty ?? 0;
  }

  /** Custom tabs in use, in order (1, 2, …; always gap-free). */
  tabs(): number[] {
    const used = new Set(this.slots.map((s) => s.tab).filter((t) => t > 0));
    return [...used].sort((a, b) => a - b);
  }

  /** Slots in display order: main tab first, then each custom tab. */
  ordered(): BankSlot[] {
    return [...this.slots].sort((a, b) => a.tab - b.tab);
  }

  /** Moves an item (or its placeholder) to a tab: 0 = main, up to one past the last tab (a new tab). */
  setTab(item: ItemId, tab: number): boolean {
    const s = this.slots.find((x) => x.item === item);
    const max = Math.min(BANK_TABS, this.tabs().length + 1);
    if (!s || !Number.isInteger(tab) || tab < 0 || tab > max) return false;
    // Moving to a tab puts the item at the end of it.
    this.slots.splice(this.slots.indexOf(s), 1);
    s.tab = tab;
    this.slots.push(s);
    this.compactTabs();
    return true;
  }

  /** Removes placeholders (one item's, or all of them); returns how many were released. */
  releasePlaceholders(item?: ItemId): number {
    const before = this.slots.length;
    this.slots = this.slots.filter((s) => s.qty > 0 || (item !== undefined && s.item !== item));
    this.compactTabs();
    return before - this.slots.length;
  }

  /** Renumbers custom tabs 1..n after one empties, so there are never gaps. */
  private compactTabs() {
    const map = new Map(this.tabs().map((t, i) => [t, i + 1]));
    for (const s of this.slots) if (s.tab > 0) s.tab = map.get(s.tab)!;
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

  /**
   * Adds up to qty (bounded by roomFor); returns the amount added. An item already in the bank (or
   * its placeholder) keeps its place and tab; a new item goes into `tab` (or the main tab).
   */
  add(item: ItemId, qty: number, tab = 0): number {
    const n = Math.min(Math.floor(qty), this.roomFor(item));
    if (!(n > 0)) return 0;
    const s = this.slots.find((x) => x.item === item);
    if (s) s.qty += n;
    else {
      const t = Number.isInteger(tab) && tab > 0 && tab <= Math.min(BANK_TABS, this.tabs().length + 1) ? tab : 0;
      this.slots.push({ item, qty: n, tab: t });
      this.compactTabs();
    }
    return n;
  }

  /** Removes up to qty; an emptied slot is freed (or kept as a placeholder). Returns the amount removed. */
  remove(item: ItemId, qty: number): number {
    const i = this.slots.findIndex((x) => x.item === item);
    if (i < 0) return 0;
    const n = Math.min(Math.floor(qty), this.slots[i].qty);
    if (!(n > 0)) return 0;
    this.slots[i].qty -= n;
    if (this.slots[i].qty <= 0 && !this.placeholders) {
      this.slots.splice(i, 1);
      this.compactTabs();
    }
    return n;
  }

  toJSON(): BankSlot[] {
    return this.slots.map((s) => ({ ...s }));
  }

  /**
   * Rebuilds a bank from saved data. Duplicate entries merge, unknown ids and invalid quantities are
   * ignored. Nothing valid is dropped: if a save somehow holds more item types than the capacity, they
   * are all kept (the bank then simply accepts no new item types until slots are freed).
   */
  static restore(data: unknown, capacity = BANK_SLOTS, opts?: { placeholders?: unknown }): Bank {
    const bank = new Bank(capacity);
    bank.placeholders = opts?.placeholders === true;
    if (!Array.isArray(data)) return bank;
    const merged: BankSlot[] = [];
    for (const s of data as Partial<BankSlot>[]) {
      if (!s || typeof s.item !== 'string' || !isItemId(s.item)) continue;
      const qty = Math.floor(Number(s.qty));
      // qty 0 is a saved placeholder; anything else invalid is ignored.
      if (!(qty >= 0) || (qty === 0 && s.qty !== 0)) continue;
      const tab = Number.isInteger(s.tab) && s.tab! > 0 && s.tab! <= BANK_TABS ? s.tab! : 0;
      const m = merged.find((x) => x.item === s.item);
      if (m) m.qty += qty;
      else merged.push({ item: s.item, qty, tab });
    }
    bank.slots = merged.map((s) => ({ ...s, qty: Math.min(s.qty, BANK_MAX_STACK) }));
    bank.compactTabs();
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
export function depositItem(bank: Bank, inv: Inventory, item: ItemId, qty: number, tab = 0): TransferResult {
  const have = inv.count(item);
  const requested = Math.min(have, Math.max(0, Math.floor(qty)));
  if (requested <= 0) return { item, moved: 0, requested: 0, limit: 'nothing' };
  const n = Math.min(requested, bank.roomFor(item));
  if (n <= 0) return { item, moved: 0, requested, limit: 'bankFull' };
  const removed = inv.remove(item, n);
  const added = bank.add(item, removed, tab);
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
export function depositInventory(bank: Bank, inv: Inventory, tab = 0): TransferResult[] {
  const items: ItemId[] = [];
  for (const s of inv.slots) if (s && !items.includes(s.item)) items.push(s.item);
  return items.map((item) => depositItem(bank, inv, item, inv.count(item), tab));
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
