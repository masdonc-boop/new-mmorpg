import { describe, expect, it } from 'vitest';
import { GameWorld, Gravestone, type SaveData } from '../src/sim/world';
import { Inventory, INVENTORY_SLOTS, type ItemStack } from '../src/sim/inventory';
import { Equipment, equipFromInventory, unequipToInventory } from '../src/sim/equipment';
import { GRAVE_SECONDS, KEEP_ON_DEATH, takeLostOnDeath } from '../src/sim/death';
import { itemDef, type ItemId } from '../src/data/items';
import { isBlocked } from '../src/sim/worldmap';

const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds * 30; t++) w.tick();
};
const setRng = (w: GameWorld, v: number) => ((w as unknown as { rng: () => number }).rng = () => v);
const stand = (w: GameWorld, x: number, z: number) => {
  w.player.x = w.player.prevX = x;
  w.player.z = w.player.prevZ = z;
};
const kill = (w: GameWorld) => (w as unknown as { killPlayer: () => void }).killPlayer();
const slotOf = (inv: Inventory, item: ItemId) => inv.slots.findIndex((s) => s?.item === item);
const reload = (w: GameWorld) => new GameWorld({ save: JSON.parse(JSON.stringify(w.save())) as SaveData });

/** Every item the player owns anywhere (bag, worn, belt, bank, held, wisps, shrines), by item id. */
function owned(w: GameWorld): Record<string, number> {
  const p = w.player;
  const out: Record<string, number> = {};
  const add = (item: ItemId, qty: number) => (out[item] = (out[item] ?? 0) + qty);
  for (const s of p.inventory.slots) if (s) add(s.item, s.qty);
  for (const [slot, it] of Object.entries(p.equipment.slots)) if (it) add(it, slot === 'ammo' ? p.equipment.ammoQty : 1);
  for (const it of Object.values(p.toolbelt.slots)) if (it) add(it, 1);
  for (const s of p.bank.toJSON()) add(s.item, s.qty);
  for (const s of p.overflow) add(s.item, s.qty);
  for (const g of w.graves) if (!g.expired) for (const s of g.items) add(s.item, s.qty);
  for (const s of p.shrineHeld) add(s.item, s.qty);
  return out;
}

describe('Ammo slot', () => {
  it('new characters wear their arrows, and bows fire from the ammo slot', () => {
    const w = new GameWorld();
    const p = w.player;
    expect(p.equipment.get('ammo')).toBe('bronze_arrow');
    expect(p.equipment.ammoQty).toBe(60);
    expect(p.inventory.count('bronze_arrow')).toBe(0);
    w.issue({ type: 'setStyle', style: 'ranged' });
    expect(w.ammoLeft()).toBe(60);
  });

  it('equips a whole stack, merges more of the same ammo, and takes it off only when it fits', () => {
    const eq = new Equipment();
    const inv = new Inventory();
    inv.add('bronze_arrow', 40);
    expect(equipFromInventory(eq, inv, 0, () => 1).ok).toBe(true);
    expect(eq.get('ammo')).toBe('bronze_arrow');
    expect(eq.ammoQty).toBe(40);
    expect(inv.count('bronze_arrow')).toBe(0);
    inv.add('bronze_arrow', 15);
    equipFromInventory(eq, inv, slotOf(inv, 'bronze_arrow'), () => 1);
    expect(eq.ammoQty).toBe(55);
    // A full bag with no arrow stack can't take them back: nothing moves, nothing is lost.
    inv.add('logs', INVENTORY_SLOTS);
    expect(unequipToInventory(eq, inv, 'ammo').ok).toBe(false);
    expect(eq.ammoQty).toBe(55);
    inv.removeAt(0);
    expect(unequipToInventory(eq, inv, 'ammo').ok).toBe(true);
    expect(eq.get('ammo')).toBeNull();
    expect(inv.count('bronze_arrow')).toBe(55);
  });

  it('runes stay in the bag: only arrows can be worn', () => {
    expect(itemDef('bronze_arrow').equip?.slot).toBe('ammo');
    expect(itemDef('air_rune').equip).toBeUndefined();
  });

  it('a bow with arrows only in the bag asks you to equip them and does not shoot', () => {
    const w = new GameWorld();
    const p = w.player;
    w.issue({ type: 'unequip', slot: 'ammo' });
    expect(p.inventory.count('bronze_arrow')).toBe(60);
    w.issue({ type: 'setStyle', style: 'ranged' });
    const s = w.enemies.find((e) => e.def.id === 'slime')!;
    stand(w, s.x + 3, s.z);
    if (isBlocked(w.map, p.x, p.z)) stand(w, s.x - 3, s.z);
    w.drainEvents();
    w.issue({ type: 'interact', target: s.id });
    run(w, 2);
    const ev = w.drainEvents();
    expect(ev.some((e) => e.type === 'message' && e.text.startsWith('Equip your bronze arrows first'))).toBe(true);
    expect(ev.some((e) => e.type === 'attack' && e.source === p.id)).toBe(false);
    expect(p.inventory.count('bronze_arrow')).toBe(60);
    // Tapping the arrows wears them; now the bow fires and uses them up one at a time.
    w.issue({ type: 'equip', slot: slotOf(p.inventory, 'bronze_arrow') });
    w.issue({ type: 'interact', target: s.id });
    run(w, 4);
    expect(p.equipment.ammoQty).toBeLessThan(60);
    expect(p.equipment.ammoQty).toBeGreaterThan(0);
    expect(p.skills.xp.ranged).toBeGreaterThan(0);
  });

  it('the last arrow empties the slot', () => {
    const eq = new Equipment();
    eq.slots.ammo = 'bronze_arrow';
    eq.ammoQty = 1;
    expect(eq.useAmmo('bronze_arrow')).toBe(true);
    expect(eq.get('ammo')).toBeNull();
    expect(eq.useAmmo('bronze_arrow')).toBe(false);
  });

  it('older saves move bag arrows into the ammo slot once, and the worn count survives save and load', () => {
    const w = new GameWorld();
    const save = w.save();
    // An older save: arrows in the bag, no ammo slot, no ammo grant.
    save.equipment = {};
    delete save.ammoQty;
    save.grants = (save.grants ?? []).filter((g) => g !== 'ammo-v1');
    save.inventory[5] = { item: 'bronze_arrow', qty: 137 };
    const w2 = new GameWorld({ save: JSON.parse(JSON.stringify(save)) });
    expect(w2.player.equipment.get('ammo')).toBe('bronze_arrow');
    expect(w2.player.equipment.ammoQty).toBe(137);
    expect(w2.player.inventory.count('bronze_arrow')).toBe(0);
    expect(w2.drainEvents().some((e) => e.type === 'message' && e.text.includes('ammo slot'))).toBe(true);
    // Taken off again, they stay off after a reload (the migration runs once).
    w2.issue({ type: 'unequip', slot: 'ammo' });
    const w3 = reload(w2);
    expect(w3.player.equipment.get('ammo')).toBeNull();
    expect(w3.player.inventory.count('bronze_arrow')).toBe(137);
    w3.issue({ type: 'equip', slot: slotOf(w3.player.inventory, 'bronze_arrow') });
    w3.player.equipment.useAmmo('bronze_arrow');
    expect(reload(w3).player.equipment.ammoQty).toBe(136);
  });

  it('a corrupt ammo count in a save is ignored rather than inventing arrows', () => {
    const w = new GameWorld();
    const save = w.save();
    save.ammoQty = -5;
    const w2 = new GameWorld({ save: JSON.parse(JSON.stringify(save)) });
    expect(w2.player.equipment.get('ammo')).toBeNull();
    expect(w2.player.equipment.ammoQty).toBe(0);
  });
});

describe('Death: keep 4, the rest with a shrine wisp', () => {
  it('keeps the four most valuable units, splitting stacks, and never touches the toolbelt', () => {
    const inv = new Inventory();
    const eq = new Equipment();
    inv.add('iron_platebody'); // 180
    inv.add('logs', 5); // 4 each
    inv.add('coins', 500); // 1 each
    eq.slots.weapon = 'iron_sword'; // 90
    eq.slots.ammo = 'bronze_arrow';
    eq.ammoQty = 30;
    inv.add('air_rune', 10); // 2 each
    eq.slots.head = 'bronze_helm'; // 20
    eq.slots.feet = 'leather_boots'; // 14
    const { kept, lost } = takeLostOnDeath(inv, eq);
    expect(kept).toEqual([
      { item: 'iron_platebody', qty: 1 },
      { item: 'iron_sword', qty: 1 },
      { item: 'bronze_helm', qty: 1 },
      { item: 'leather_boots', qty: 1 },
    ]);
    expect(inv.count('iron_platebody')).toBe(1);
    expect(eq.get('weapon')).toBe('iron_sword');
    expect(eq.get('head')).toBe('bronze_helm');
    expect(inv.count('logs') + inv.count('coins') + inv.count('air_rune')).toBe(0);
    expect(eq.get('ammo')).toBeNull();
    const lostMap = Object.fromEntries(lost.map((s) => [s.item, s.qty]));
    expect(lostMap).toEqual({ logs: 5, coins: 500, air_rune: 10, bronze_arrow: 30 });
  });

  it('can keep part of a stack', () => {
    const inv = new Inventory();
    const eq = new Equipment();
    inv.add('air_rune', 10);
    inv.add('coins', 10);
    const { kept, lost } = takeLostOnDeath(inv, eq);
    expect(kept).toEqual([{ item: 'air_rune', qty: 4 }]);
    expect(inv.count('air_rune')).toBe(4);
    expect(lost).toEqual(expect.arrayContaining([{ item: 'air_rune', qty: 6 }, { item: 'coins', qty: 10 }]));
  });

  it('dying moves the rest into a gravestone; nothing is duplicated or lost', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('iron_sword');
    p.inventory.add('logs', 4);
    const before = owned(w);
    kill(w);
    expect(p.dead).toBe(true);
    expect(owned(w)).toEqual(before);
    expect(w.graves.length).toBe(1);
    const g = w.graves[0];
    expect(Math.hypot(g.x - p.x, g.z - p.z)).toBeLessThan(1);
    expect(p.lastDeath?.kept.reduce((a, s) => a + s.qty, 0)).toBe(KEEP_ON_DEATH);
    expect(p.lastDeath?.grave).toBe(g.id);
    // Toolbelt tools are never at risk.
    expect(p.toolbelt.get('pickaxe')).toBe('bronze_pickaxe');
    const carried = p.inventory.slots.reduce((a, s) => a + (s?.qty ?? 0), 0) + (p.equipment.ammoQty || 0);
    expect(carried).toBe(KEEP_ON_DEATH);
  });

  it('with four items or fewer, nothing is lost and no wisp appears', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.slots.fill(null);
    p.equipment.clearAmmo();
    p.inventory.add('iron_sword');
    p.inventory.add('bread', 3);
    kill(w);
    expect(w.graves.length).toBe(0);
    expect(p.inventory.count('iron_sword')).toBe(1);
    expect(p.inventory.count('bread')).toBe(3);
  });

  it('tapping the wisp takes the items back (what fits), and it disappears once empty', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('logs', 20);
    const before = owned(w);
    kill(w);
    w.issue({ type: 'respawn', at: 'home' });
    const g = w.graves[0];
    // Make the bag nearly full so only part fits.
    p.inventory.add('oak_logs', INVENTORY_SLOTS - p.inventory.usedSlots() - 5);
    stand(w, g.x + 0.5, g.z);
    w.issue({ type: 'interact', target: g.id });
    run(w, 1);
    expect(w.graves.length).toBe(1);
    expect(g.count).toBeGreaterThan(0);
    // Bank-free test: drop the filler, then collect the rest.
    while (p.inventory.count('oak_logs') > 0) w.issue({ type: 'dropItem', slot: slotOf(p.inventory, 'oak_logs') });
    w.issue({ type: 'interact', target: g.id });
    run(w, 1);
    expect(w.graves.length).toBe(0);
    expect(w.interactable(g.id)).toBeNull();
    expect(owned(w)).toEqual(before);
  });

  it('a wisp lasts 20 minutes of play, survives save and load, then carries what is left to the shrines', () => {
    const w = new GameWorld();
    w.player.inventory.add('logs', 6);
    kill(w);
    w.issue({ type: 'respawn', at: 'home' });
    w.graves[0].age = GRAVE_SECONDS - 30;
    const items = w.graves[0].items.map((i) => ({ ...i }));
    expect(items.some((i) => i.item === 'logs')).toBe(true);
    const w2 = reload(w);
    expect(w2.graves.length).toBe(1);
    expect(w2.graves[0].secondsLeft).toBeCloseTo(30, 0);
    expect(w2.graves[0].items).toEqual(items);
    const before = owned(w2);
    run(w2, 31);
    expect(w2.graves.length).toBe(0);
    expect(w2.drainEvents().some((e) => e.type === 'message' && e.text.includes('carried your things to the shrines'))).toBe(true);
    expect(w2.player.shrineHeld).toEqual(items);
    expect(owned(w2)).toEqual(before);
    const w3 = reload(w2);
    expect(w3.graves.length).toBe(0);
    expect(w3.player.shrineHeld).toEqual(items);
  });

  it('only its owner can use a wisp', () => {
    const w = new GameWorld();
    const g = new Gravestone(99999, 0, 0, w.player.id + 1, [{ item: 'logs', qty: 1 } as ItemStack]);
    (w as unknown as { byId: Map<number, unknown> }).byId.set(g.id, g);
    expect(w.interactable(g.id)).toBeNull();
  });
});

describe('Auto-continue gathering (setting)', () => {
  function chopUntilDepleted(w: GameWorld) {
    const p = w.player;
    const tree = w.nodes.find((n) => n.def.id === 'tree' && w.nearestNode('tree', n.x, n.z, 6) !== null && w.nodes.some((m) => m !== n && m.def.id === 'tree' && Math.hypot(m.x - n.x, m.z - n.z) < 5))!;
    stand(w, tree.x + 1, tree.z);
    if (isBlocked(w.map, p.x, p.z)) stand(w, tree.x - 1, tree.z);
    setRng(w, 0); // every swing succeeds and depletes the tree
    w.issue({ type: 'interact', target: tree.id });
    for (let i = 0; i < 30 * 6 && !tree.depleted; i++) w.tick();
    expect(tree.depleted).toBe(true);
    return tree;
  }

  it('is off by default: the player stops when the tree falls', () => {
    const w = new GameWorld();
    expect(w.player.autoGather).toBe(false);
    chopUntilDepleted(w);
    expect(w.player.action).toBeNull();
  });

  it('when turned on, carries on at the next tree nearby, and the setting is saved', () => {
    const w = new GameWorld();
    w.issue({ type: 'setOption', option: 'autoGather', on: true });
    const first = chopUntilDepleted(w);
    expect(w.player.action?.type).toBe('gather');
    expect((w.player.action as { node: number }).node).not.toBe(first.id);
    expect(reload(w).player.autoGather).toBe(true);
    w.issue({ type: 'setOption', option: 'autoGather', on: false });
    expect(reload(w).player.autoGather).toBe(false);
  });
});
