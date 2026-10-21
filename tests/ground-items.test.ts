import { describe, expect, it } from 'vitest';
import { GameWorld, GroundItem, LOOT_PRIVATE_SECONDS, LOOT_PUBLIC_SECONDS, type GameEvent } from '../src/sim/world';
import { INVENTORY_SLOTS } from '../src/sim/inventory';

const OTHER_PLAYER = 2;

const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds * 30; t++) w.tick();
};

/** Kill a slime with every drop rolling (rng 0 = always succeed, minimum quantities). */
function killSlime(w: GameWorld) {
  (w as unknown as { rng: () => number }).rng = () => 0;
  const e = w.enemies.find((x) => x.def.id === 'slime' && x.alive)!;
  (w as unknown as { killEnemy: (e: unknown) => void }).killEnemy(e);
  return e;
}

/** Stand on a pile and tap it. */
function pickUp(w: GameWorld, g: GroundItem) {
  w.player.x = w.player.prevX = g.x;
  w.player.z = w.player.prevZ = g.z;
  w.issue({ type: 'interact', target: g.id });
  run(w, 0.2);
}

const fullEvents = (ev: GameEvent[]) => ev.filter((e) => e.type === 'inventoryFull').length;

describe('Monster drops on the ground', () => {
  it('drops land beside the fallen enemy, reserved for the killer, not in the inventory', () => {
    const w = new GameWorld();
    const before = w.player.inventory.toJSON();
    const e = killSlime(w);
    expect(w.player.inventory.toJSON()).toEqual(before);
    expect(w.groundItems.map((g) => g.item).sort()).toEqual(['air_rune', 'coins', 'slime_gel']);
    for (const g of w.groundItems) {
      expect(g.owner).toBe(w.player.id);
      expect(Math.hypot(g.x - e.x, g.z - e.z)).toBeLessThan(0.9);
    }
  });

  it('is visible only to its owner for 10 minutes, to everyone for 5 more, then disappears', () => {
    const w = new GameWorld();
    killSlime(w);
    const g = w.groundItems[0];
    const at = (age: number) => {
      g.age = age;
      return [g.visibleTo(w.player.id), g.visibleTo(OTHER_PLAYER)];
    };
    expect(LOOT_PRIVATE_SECONDS).toBe(600);
    expect(LOOT_PUBLIC_SECONDS).toBe(300);
    expect(at(0)).toEqual([true, false]);
    expect(at(599.9)).toEqual([true, false]);
    expect(at(600)).toEqual([true, true]);
    expect(at(899.9)).toEqual([true, true]);
    expect(at(900)).toEqual([false, false]);
  });

  it('ages with game time and is removed when the 15 minutes are up', () => {
    const w = new GameWorld();
    killSlime(w);
    const n = w.groundItems.length;
    for (const g of w.groundItems) g.age = LOOT_PRIVATE_SECONDS + LOOT_PUBLIC_SECONDS - 2;
    run(w, 1);
    expect(w.groundItems.length).toBe(n);
    expect(w.visibleGroundItems().length).toBe(n);
    run(w, 1.2);
    expect(w.groundItems.length).toBe(0);
    expect(w.visibleGroundItems()).toEqual([]);
  });

  it("can't see or take another player's drop until it turns public", () => {
    const w = new GameWorld();
    const g = w.spawnGroundItem('wolf_pelt', 1, w.player.x + 0.3, w.player.z, OTHER_PLAYER);
    expect(w.visibleGroundItems()).toEqual([]);
    expect(w.interactable(g.id)).toBeNull();
    pickUp(w, g);
    expect(w.player.inventory.count('wolf_pelt')).toBe(0);
    g.age = LOOT_PRIVATE_SECONDS + 1;
    expect(w.visibleGroundItems()).toEqual([g]);
    pickUp(w, g);
    expect(w.player.inventory.count('wolf_pelt')).toBe(1);
    expect(w.groundItems).toEqual([]);
  });

  it('picking up walks to the pile and moves it into the inventory exactly once', () => {
    const w = new GameWorld();
    killSlime(w);
    const coins = w.player.inventory.count('coins');
    const gel = w.groundItems.find((g) => g.item === 'slime_gel')!;
    const cash = w.groundItems.find((g) => g.item === 'coins')!;
    const cashQty = cash.qty;
    w.drainEvents();
    // Start a few metres away: the player walks there first.
    w.player.x = w.player.prevX = gel.x + 2;
    w.player.z = w.player.prevZ = gel.z;
    w.issue({ type: 'interact', target: gel.id });
    run(w, 3);
    expect(w.player.inventory.count('slime_gel')).toBe(1);
    expect(w.drainEvents().filter((e) => e.type === 'loot').length).toBe(1);
    pickUp(w, cash);
    pickUp(w, cash); // second tap on a pile that is gone does nothing
    expect(w.player.inventory.count('coins')).toBe(coins + cashQty);
    expect(w.groundItems.map((g) => g.item)).toEqual(['air_rune']);
  });

  it('with a full inventory the pile stays on the ground and the player is told', () => {
    const w = new GameWorld();
    killSlime(w);
    const inv = w.player.inventory;
    inv.add('bread', INVENTORY_SLOTS - inv.usedSlots());
    const gel = w.groundItems.find((g) => g.item === 'slime_gel')!;
    const runes = w.groundItems.find((g) => g.item === 'air_rune')!;
    w.drainEvents();
    pickUp(w, gel);
    expect(inv.count('slime_gel')).toBe(0);
    expect(w.groundItems).toContain(gel);
    expect(gel.qty).toBe(1);
    expect(fullEvents(w.drainEvents())).toBe(1);
    // Stackable items already in the bag can still be picked up onto their stack.
    const runesBefore = inv.count('air_rune');
    pickUp(w, runes);
    expect(inv.count('air_rune')).toBe(runesBefore + 2);
    expect(w.groundItems).not.toContain(runes);
  });

  it('takes what fits from a non-stackable pile and leaves the rest', () => {
    const w = new GameWorld();
    const inv = w.player.inventory;
    inv.add('bread', INVENTORY_SLOTS - 1 - inv.usedSlots());
    const g = w.spawnGroundItem('iron_ore', 3, w.player.x, w.player.z, w.player.id);
    pickUp(w, g);
    expect(inv.count('iron_ore')).toBe(1);
    expect(g.qty).toBe(2);
    expect(w.groundItems).toContain(g);
  });

  it('keeps piles, owners and timers through save and load, dropping expired ones', () => {
    const w = new GameWorld();
    killSlime(w);
    const [a, b, c] = w.groundItems;
    a.age = 120;
    b.age = LOOT_PRIVATE_SECONDS + 30;
    c.age = LOOT_PRIVATE_SECONDS + LOOT_PUBLIC_SECONDS + 1;
    const save = JSON.parse(JSON.stringify(w.save()));
    const w2 = new GameWorld({ save });
    const got = w2.groundItems.map((g) => ({ item: g.item, qty: g.qty, x: g.x, z: g.z, owner: g.owner, age: g.age }));
    expect(got).toEqual([a, b].map((g) => ({ item: g.item, qty: g.qty, x: g.x, z: g.z, owner: g.owner, age: g.age })));
    expect(w2.groundItems[1].visibleTo(OTHER_PLAYER)).toBe(true);
    expect(w2.groundItems[0].visibleTo(OTHER_PLAYER)).toBe(false);
    // Older saves without ground items still load.
    delete (save as { ground?: unknown }).ground;
    expect(new GameWorld({ save }).groundItems).toEqual([]);
  });

  it('repeated kills and pickups neither duplicate nor lose items', () => {
    const w = new GameWorld();
    const start = w.player.inventory.count('slime_gel') + w.player.inventory.count('coins') + w.player.inventory.count('air_rune');
    let dropped = 0;
    for (let i = 0; i < 8; i++) {
      killSlime(w);
      run(w, 0.1);
    }
    for (const g of w.groundItems) dropped += g.qty;
    for (const g of [...w.groundItems]) pickUp(w, g);
    const end = w.player.inventory.count('slime_gel') + w.player.inventory.count('coins') + w.player.inventory.count('air_rune');
    const left = w.groundItems.reduce((a, g) => a + g.qty, 0);
    expect(end + left).toBe(start + dropped);
    expect(w.player.inventory.usedSlots()).toBeLessThanOrEqual(INVENTORY_SLOTS);
  });
});
