import { describe, expect, it } from 'vitest';
import { BANK_MAX_STACK, BANK_SLOTS, Bank, bankCategory, depositInventory, depositItem, withdrawItem } from '../src/sim/bank';
import { INVENTORY_SLOTS, Inventory } from '../src/sim/inventory';
import { GameWorld, type GameEvent } from '../src/sim/world';
import { ITEMS, itemDef, type ItemId } from '../src/data/items';
import { BANKER, isBlocked } from '../src/sim/worldmap';

const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds * 30; t++) w.tick();
};

/** Every item the character owns: inventory + bank + held overflow. */
const owned = (w: GameWorld) => {
  const t: Record<string, number> = {};
  const add = (item: string, q: number) => (t[item] = (t[item] ?? 0) + q);
  for (const s of w.player.inventory.slots) if (s) add(s.item, s.qty);
  for (const s of w.player.bank.slots) add(s.item, s.qty);
  for (const s of w.player.overflow) add(s.item, s.qty);
  return t;
};

/** A world with the player standing at the bank counter and the bank open. */
function atBank() {
  const w = new GameWorld();
  const p = w.player;
  const banker = w.npcs.find((n) => n.def.id === 'banker')!;
  p.x = p.prevX = 51.5;
  p.z = p.prevZ = 60.5;
  w.issue({ type: 'interact', target: banker.id });
  run(w, 0.5);
  return { w, p, banker, events: w.drainEvents() };
}

const slotOf = (inv: Inventory, item: ItemId) => inv.slots.findIndex((s) => s?.item === item);

describe('Bank storage', () => {
  it('starts with 200 slots and stacks every item type, including non-stackables', () => {
    const b = new Bank();
    expect(b.capacity).toBe(BANK_SLOTS);
    expect(BANK_SLOTS).toBe(200);
    expect(b.add('logs', 120)).toBe(120);
    expect(b.add('logs', 5)).toBe(5);
    expect(b.add('bread', 3)).toBe(3);
    expect(b.usedSlots()).toBe(2);
    expect(b.count('logs')).toBe(125);
  });

  it('refuses new item types when full but still tops up existing stacks', () => {
    const b = new Bank(2);
    b.add('logs', 1);
    b.add('copper_ore', 1);
    expect(b.isFull()).toBe(true);
    expect(b.roomFor('tin_ore')).toBe(0);
    expect(b.add('tin_ore', 4)).toBe(0);
    expect(b.add('logs', 9)).toBe(9);
    expect(b.count('logs')).toBe(10);
  });

  it('frees a slot when the last of an item is withdrawn, and never goes negative', () => {
    const b = new Bank();
    b.add('logs', 2);
    expect(b.remove('logs', 5)).toBe(2);
    expect(b.usedSlots()).toBe(0);
    expect(b.remove('logs', 1)).toBe(0);
    expect(b.add('logs', -3)).toBe(0);
    expect(b.add('logs', Number.NaN)).toBe(0);
  });

  it('caps a single stack at the per-slot maximum', () => {
    const b = new Bank();
    b.add('coins', BANK_MAX_STACK - 5);
    expect(b.add('coins', 10)).toBe(5);
    expect(b.roomFor('coins')).toBe(0);
  });

  it('restores from saves safely: merges duplicates, ignores junk, keeps everything valid', () => {
    const b = Bank.restore([
      { item: 'logs', qty: 10 },
      { item: 'logs', qty: 5 },
      { item: 'unknown', qty: 3 },
      { item: 'coins', qty: -1 },
      null,
      { item: 'bread', qty: 2.9 },
    ]);
    expect(b.toJSON()).toEqual([
      { item: 'logs', qty: 15 },
      { item: 'bread', qty: 2 },
    ]);
    expect(Bank.restore(undefined).usedSlots()).toBe(0);
    expect(Bank.restore('nonsense').usedSlots()).toBe(0);
  });

  it('puts every item in a category', () => {
    for (const d of Object.values(ITEMS)) expect(['materials', 'equipment', 'tools', 'food', 'ammo', 'other']).toContain(bankCategory(d));
    expect(bankCategory(itemDef('logs'))).toBe('materials');
    expect(bankCategory(itemDef('bronze_axe'))).toBe('tools');
    expect(bankCategory(itemDef('air_rune'))).toBe('ammo');
  });
});

describe('Transfers', () => {
  it('withdrawn non-stackable resources take one inventory slot each', () => {
    const b = new Bank();
    const inv = new Inventory();
    b.add('logs', 50);
    const r = withdrawItem(b, inv, 'logs', 10);
    expect(r).toMatchObject({ moved: 10, limit: 'none' });
    expect(inv.usedSlots()).toBe(10);
    expect(inv.slots.filter(Boolean).every((s) => s!.qty === 1)).toBe(true);
    expect(b.count('logs')).toBe(40);
  });

  it('never withdraws more than the inventory can hold, and moves nothing when full', () => {
    const b = new Bank();
    const inv = new Inventory();
    b.add('copper_ore', 100);
    inv.add('bread', INVENTORY_SLOTS - 3);
    const r = withdrawItem(b, inv, 'copper_ore', 100);
    expect(r).toMatchObject({ moved: 3, requested: 100, limit: 'inventoryFull' });
    expect(inv.isFull()).toBe(true);
    expect(b.count('copper_ore')).toBe(97);
    const r2 = withdrawItem(b, inv, 'copper_ore', 1);
    expect(r2).toMatchObject({ moved: 0, limit: 'inventoryFull' });
    expect(b.count('copper_ore')).toBe(97);
    // Stackables already in the inventory still withdraw onto their stack.
    inv.slots[0] = { item: 'coins', qty: 1 };
    b.add('coins', 500);
    expect(withdrawItem(b, inv, 'coins', 500).moved).toBe(500);
    expect(inv.count('coins')).toBe(501);
  });

  it('deposits a non-stackable item type from all its slots into one bank slot', () => {
    const b = new Bank();
    const inv = new Inventory();
    inv.add('logs', 6);
    inv.add('coins', 30);
    expect(depositItem(b, inv, 'logs', 4).moved).toBe(4);
    expect(inv.count('logs')).toBe(2);
    expect(depositItem(b, inv, 'logs', 999).moved).toBe(2);
    expect(b.usedSlots()).toBe(1);
    expect(b.count('logs')).toBe(6);
    expect(depositItem(b, inv, 'coins', 10).moved).toBe(10);
    expect(inv.count('coins')).toBe(20);
  });

  it('deposit-all keeps item types that would need a new slot in a full bank, moving the rest', () => {
    const b = new Bank(2);
    b.add('logs', 1);
    const inv = new Inventory();
    inv.add('logs', 3);
    inv.add('copper_ore', 2);
    inv.add('tin_ore', 2);
    const res = depositInventory(b, inv);
    expect(res.find((r) => r.item === 'logs')!.moved).toBe(3);
    expect(res.find((r) => r.item === 'copper_ore')!.moved).toBe(2);
    expect(res.find((r) => r.item === 'tin_ore')).toMatchObject({ moved: 0, limit: 'bankFull' });
    expect(inv.count('tin_ore')).toBe(2);
    expect(inv.usedSlots()).toBe(2);
  });

  it('thousands of random transfers neither duplicate nor lose items', () => {
    const b = new Bank(6);
    const inv = new Inventory();
    const items: ItemId[] = ['logs', 'copper_ore', 'coins', 'bread', 'air_rune', 'iron_ore', 'sapphire', 'bones'];
    for (const it of items) inv.add(it, 3);
    b.add('logs', 40);
    const total = () => {
      const t: Record<string, number> = {};
      for (const it of items) t[it] = inv.count(it) + b.count(it);
      return t;
    };
    const start = total();
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 3000; i++) {
      const it = items[Math.floor(rnd() * items.length)];
      const q = Math.floor(rnd() * 40);
      if (rnd() < 0.5) depositItem(b, inv, it, q);
      else withdrawItem(b, inv, it, q);
      if (i % 97 === 0) depositInventory(b, inv);
      expect(inv.usedSlots()).toBeLessThanOrEqual(INVENTORY_SLOTS);
      expect(b.usedSlots()).toBeLessThanOrEqual(6);
    }
    expect(total()).toEqual(start);
  });
});

describe('Bank in the world', () => {
  it('has a reachable banker behind a counter in Brightwater Village', () => {
    const w = new GameWorld();
    const banker = w.npcs.find((n) => n.def.id === 'banker')!;
    expect(banker.def.service).toBe('bank');
    expect([banker.x, banker.z]).toEqual([BANKER.x, BANKER.z]);
    expect(w.map.buildings.some((b) => b.style === 'bank')).toBe(true);
    expect(isBlocked(w.map, 50.5, 60.5)).toBe(true); // counter
    expect(isBlocked(w.map, 51.5, 60.5)).toBe(false); // customer side
  });

  it('talking to the banker opens the bank; walking away closes it', () => {
    const { w, p, events } = atBank();
    expect(events.some((e) => e.type === 'bankOpen')).toBe(true);
    expect(events.some((e) => e.type === 'dialogue')).toBe(false);
    expect(w.bankOpen).toBe(true);
    p.x = p.prevX = 58;
    run(w, 0.1);
    expect(w.bankOpen).toBe(false);
    expect(w.drainEvents().some((e) => e.type === 'bankClose')).toBe(true);
  });

  it('rejects bank commands away from the bank (server-side check), without moving anything', () => {
    const w = new GameWorld();
    const before = owned(w);
    const inv = w.player.inventory.toJSON();
    w.issue({ type: 'bankDepositAll' });
    w.issue({ type: 'bankDeposit', slot: 0, qty: 1 });
    expect(w.player.inventory.toJSON()).toEqual(inv);
    expect(owned(w)).toEqual(before);
    expect(w.drainEvents().some((e) => e.type === 'message' && e.text.includes('at the bank'))).toBe(true);
  });

  it('deposits and withdraws through commands with the right events and messages', () => {
    const { w, p } = atBank();
    p.inventory.add('logs', 5);
    const before = owned(w);
    w.issue({ type: 'bankDeposit', slot: slotOf(p.inventory, 'logs'), qty: 3 });
    expect(p.bank.count('logs')).toBe(3);
    expect(p.inventory.count('logs')).toBe(2);
    w.issue({ type: 'bankWithdraw', item: 'logs', qty: 1 });
    expect(p.inventory.count('logs')).toBe(3);
    const ev = w.drainEvents();
    expect(ev.filter((e) => e.type === 'bank').length).toBe(2);
    expect(owned(w)).toEqual(before);
    // Bogus input is ignored safely.
    w.issue({ type: 'bankWithdraw', item: 'not_an_item' as ItemId, qty: 5 });
    w.issue({ type: 'bankDeposit', slot: 99, qty: 5 });
    w.issue({ type: 'bankWithdraw', item: 'logs', qty: -4 });
    expect(owned(w)).toEqual(before);
  });

  it('full inventory and full bank are reported clearly and move nothing', () => {
    const { w, p } = atBank();
    p.bank.add('iron_ore', 10);
    p.inventory.add('bread', INVENTORY_SLOTS - p.inventory.usedSlots());
    w.drainEvents();
    w.issue({ type: 'bankWithdraw', item: 'iron_ore', qty: 1 });
    let ev: GameEvent[] = w.drainEvents();
    expect(ev.some((e) => e.type === 'inventoryFull')).toBe(true);
    expect(p.bank.count('iron_ore')).toBe(10);

    p.bank.capacity = p.bank.usedSlots();
    w.issue({ type: 'bankDeposit', slot: slotOf(p.inventory, 'bread'), qty: 1 });
    ev = w.drainEvents();
    expect(ev.some((e) => e.type === 'bankFull')).toBe(true);
    expect(ev.some((e) => e.type === 'message' && e.text.startsWith('Your bank is full'))).toBe(true);
    expect(p.inventory.isFull()).toBe(true);
  });

  it('deposits held overflow items into the bank', () => {
    const { w, p } = atBank();
    p.overflow = [{ item: 'logs', qty: 30 }];
    w.issue({ type: 'bankDepositHeld' });
    expect(p.overflow).toEqual([]);
    expect(p.bank.count('logs')).toBe(30);
  });

  it('persists through save, reload and region changes; old saves start with an empty bank', () => {
    const { w, p } = atBank();
    p.inventory.add('logs', 4);
    w.issue({ type: 'bankDepositAll' });
    const bank = p.bank.toJSON();
    expect(bank.length).toBeGreaterThan(3);
    const w2 = new GameWorld({ save: JSON.parse(JSON.stringify(w.save())) });
    expect(w2.player.bank.toJSON()).toEqual(bank);
    expect(w2.player.inventory.usedSlots()).toBe(0);
    // Travel far away (another region) and save again.
    w2.player.x = w2.player.prevX = 20.5;
    w2.player.z = w2.player.prevZ = 58.5;
    run(w2, 1);
    const w3 = new GameWorld({ save: JSON.parse(JSON.stringify(w2.save())) });
    expect(w3.player.bank.toJSON()).toEqual(bank);
    const old = w.save();
    delete (old as { bank?: unknown }).bank;
    expect(new GameWorld({ save: old }).player.bank.usedSlots()).toBe(0);
  });

  it('repeated command transfers keep the total of every item constant', () => {
    const { w, p } = atBank();
    p.inventory.add('logs', 6);
    p.inventory.add('copper_ore', 4);
    const start = owned(w);
    const items: ItemId[] = ['logs', 'copper_ore', 'coins', 'bread', 'bronze_arrow'];
    for (let i = 0; i < 400; i++) {
      const it = items[i % items.length];
      if (i % 3 === 0) w.issue({ type: 'bankWithdraw', item: it, qty: (i % 7) + 1 });
      else {
        const s = slotOf(p.inventory, it);
        if (s >= 0) w.issue({ type: 'bankDeposit', slot: s, qty: (i % 5) + 1 });
      }
      if (i % 50 === 0) w.issue({ type: 'bankDepositAll' });
      expect(p.inventory.usedSlots()).toBeLessThanOrEqual(INVENTORY_SLOTS);
    }
    expect(owned(w)).toEqual(start);
  });
});
