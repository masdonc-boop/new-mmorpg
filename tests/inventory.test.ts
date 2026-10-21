import { describe, expect, it } from 'vitest';
import { Inventory, INVENTORY_SLOTS } from '../src/sim/inventory';

describe('Inventory', () => {
  it('stacks stackable items (ammo, runes, coins) into a single slot', () => {
    const inv = new Inventory();
    inv.add('bronze_arrow', 3);
    inv.add('bronze_arrow', 4);
    expect(inv.count('bronze_arrow')).toBe(7);
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
    inv.add('coins', 300);
    inv.add('bronze_axe');
    const json = inv.toJSON();
    (json as unknown[])[20] = { item: 'not_real', qty: 3 };
    const copy = Inventory.fromJSON(json);
    expect(copy.count('copper_ore')).toBe(12);
    expect(copy.count('coins')).toBe(300);
    expect(copy.toJSON()).toEqual(json.map((x, i) => (i === 20 ? null : x)));
    expect(copy.has('bronze_axe')).toBe(true);
    expect(copy.slots[20]).toBeNull();
  });
});
