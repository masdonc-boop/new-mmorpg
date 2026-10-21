import { describe, expect, it } from 'vitest';
import { Inventory, INVENTORY_SLOTS } from '../src/sim/inventory';

describe('Inventory', () => {
  it('stacks stackable materials into a single slot', () => {
    const inv = new Inventory();
    inv.add('logs', 3);
    inv.add('logs', 4);
    expect(inv.count('logs')).toBe(7);
    expect(inv.freeSlots()).toBe(INVENTORY_SLOTS - 1);
  });

  it('gives non-stackable items one slot each and respects the slot limit', () => {
    const inv = new Inventory();
    expect(inv.add('bread', 30)).toBe(INVENTORY_SLOTS);
    expect(inv.freeSlots()).toBe(0);
    expect(inv.add('logs', 1)).toBe(0);
    expect(inv.capacityFor('logs')).toBe(0);
  });

  it('allows adding to an existing stack when full', () => {
    const inv = new Inventory();
    inv.add('coins', 10);
    inv.add('bread', INVENTORY_SLOTS - 1);
    expect(inv.add('coins', 5)).toBe(5);
    expect(inv.count('coins')).toBe(15);
  });

  it('removes items across slots and clears empty ones', () => {
    const inv = new Inventory();
    inv.add('bread', 3);
    expect(inv.remove('bread', 2)).toBe(2);
    expect(inv.count('bread')).toBe(1);
    expect(inv.freeSlots()).toBe(INVENTORY_SLOTS - 1);
  });

  it('round-trips through JSON and drops unknown items', () => {
    const inv = new Inventory();
    inv.add('copper_ore', 12);
    inv.add('bronze_axe');
    const json = inv.toJSON();
    (json as unknown[])[5] = { item: 'not_real', qty: 3 };
    const copy = Inventory.fromJSON(json);
    expect(copy.count('copper_ore')).toBe(12);
    expect(copy.has('bronze_axe')).toBe(true);
    expect(copy.slots[5]).toBeNull();
  });
});
