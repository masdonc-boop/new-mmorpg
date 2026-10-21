import { describe, expect, it } from 'vitest';
import { GameWorld } from '../src/sim/world';
import { Inventory, INVENTORY_SLOTS } from '../src/sim/inventory';
import { Equipment, equipFromInventory, unequipToInventory } from '../src/sim/equipment';
import { RECIPES, failChance, recipesFor } from '../src/data/recipes';
import { ITEMS, itemDef, type ItemId } from '../src/data/items';
import { SKILL_IDS, xpForLevel } from '../src/data/skills';
import { hitChance } from '../src/sim/combat';
import { isBlocked } from '../src/sim/worldmap';

const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds * 30; t++) w.tick();
};
const setRng = (w: GameWorld, v: number) => ((w as unknown as { rng: () => number }).rng = () => v);
const stand = (w: GameWorld, x: number, z: number) => {
  w.player.x = w.player.prevX = x;
  w.player.z = w.player.prevZ = z;
};
/** Walk up to a station and open it. */
function openStation(w: GameWorld, kind: 'furnace' | 'anvil' | 'range') {
  const st = w.stations.find((s) => s.kind === kind)!;
  stand(w, st.x - 1.0, st.z);
  w.issue({ type: 'interact', target: st.id });
  run(w, 0.3);
  return st;
}
const slotOf = (inv: Inventory, item: ItemId) => inv.slots.findIndex((s) => s?.item === item);
const events = (w: GameWorld) => w.drainEvents();

describe('Skills and saves', () => {
  it('adds Smithing, Fletching and Cooking without touching existing progress', () => {
    expect(SKILL_IDS).toContain('smithing');
    expect(SKILL_IDS).toContain('fletching');
    expect(SKILL_IDS).toContain('cooking');
    const w = new GameWorld();
    const save = w.save();
    // An older save: only the original eight skills, with real progress.
    save.xp = { attack: 5000, mining: 1234, woodcutting: 999, hitpoints: xpForLevel(12) };
    const w2 = new GameWorld({ save: JSON.parse(JSON.stringify(save)) });
    const sk = w2.player.skills;
    expect(sk.xp.attack).toBe(5000);
    expect(sk.xp.mining).toBe(1234);
    expect(sk.level('hitpoints')).toBe(12);
    expect(sk.level('smithing')).toBe(1);
    expect(sk.level('cooking')).toBe(1);
    expect(w2.player.equipment.toJSON()).toEqual({});
  });

  it('every recipe and wearable has consistent data', () => {
    for (const r of Object.values(RECIPES)) {
      expect(r.level).toBeGreaterThanOrEqual(1);
      expect(r.level).toBeLessThanOrEqual(99);
      expect(r.xp).toBeGreaterThan(0);
      for (const i of r.inputs) expect(ITEMS[i.item]).toBeTruthy();
      expect(ITEMS[r.output.item]).toBeTruthy();
    }
    for (const d of Object.values(ITEMS)) {
      if (!d.equip) continue;
      expect(['weapon', 'armour']).toContain(d.kind);
      expect(d.stackable).toBe(false);
      if (d.equip.slot === 'weapon') expect(d.equip.style).toBeTruthy();
    }
  });
});

describe('Vertical slice: mine, bank, smelt, forge, equip', () => {
  it('plays through end to end', () => {
    const w = new GameWorld();
    const p = w.player;
    // Roll 0.52: every swing succeeds (chance 0.55) and the rock never depletes (0.5), no gems.
    setRng(w, 0.52);
    // 1. Mine copper and tin.
    const sides = [[1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1]];
    for (const type of ['copper_rock', 'tin_rock'] as const) {
      const node = w.nodes.find((n) => n.def.id === type && sides.some(([dx, dz]) => !isBlocked(w.map, n.x + dx, n.z + dz)))!;
      const [dx, dz] = sides.find(([a, b]) => !isBlocked(w.map, node.x + a, node.z + b))!;
      stand(w, node.x + dx, node.z + dz);
      w.issue({ type: 'interact', target: node.id });
      run(w, 1.8 * 3 + 0.6);
      w.issue({ type: 'moveTo', x: p.x, z: p.z });
    }
    expect(p.inventory.count('copper_ore')).toBeGreaterThanOrEqual(3);
    expect(p.inventory.count('tin_ore')).toBeGreaterThanOrEqual(3);
    // 2. Bank the ore and take it back out.
    const banker = w.npcs.find((n) => n.def.id === 'banker')!;
    stand(w, 51.5, 60.5);
    w.issue({ type: 'interact', target: banker.id });
    run(w, 0.3);
    const ores = { copper: p.inventory.count('copper_ore'), tin: p.inventory.count('tin_ore') };
    w.issue({ type: 'bankDeposit', slot: slotOf(p.inventory, 'copper_ore'), qty: 99 });
    w.issue({ type: 'bankDeposit', slot: slotOf(p.inventory, 'tin_ore'), qty: 99 });
    expect(p.bank.count('copper_ore')).toBe(ores.copper);
    w.issue({ type: 'bankWithdraw', item: 'copper_ore', qty: 3 });
    w.issue({ type: 'bankWithdraw', item: 'tin_ore', qty: 3 });
    expect(p.inventory.count('copper_ore')).toBe(3);
    // 3. Smelt three bronze bars at the furnace.
    events(w);
    openStation(w, 'furnace');
    expect(events(w).some((e) => e.type === 'productionOpen' && e.station === 'furnace')).toBe(true);
    w.issue({ type: 'craft', recipe: 'bronze_bar', count: 3 });
    run(w, 1.8 * 3 + 0.5);
    expect(p.inventory.count('bronze_bar')).toBe(3);
    expect(p.inventory.count('copper_ore')).toBe(0);
    expect(p.skills.xp.smithing).toBe(3 * RECIPES.bronze_bar.xp);
    expect(p.action).toBeNull();
    // 4. Forge a bronze dagger and (after levelling) a sword at the anvil.
    openStation(w, 'anvil');
    w.issue({ type: 'craft', recipe: 'bronze_sword', count: 1 });
    expect(p.action).toBeNull(); // level 4 needed
    w.issue({ type: 'craft', recipe: 'bronze_dagger', count: 1 });
    run(w, 3);
    expect(p.inventory.count('bronze_dagger')).toBe(1);
    p.skills.addXp('smithing', xpForLevel(4));
    w.issue({ type: 'craft', recipe: 'bronze_sword', count: 1 });
    run(w, 3);
    expect(p.inventory.count('bronze_sword')).toBe(1);
    // 5. Equip it: the sword now drives melee accuracy and power.
    const before = w.playerBonuses();
    w.issue({ type: 'equip', slot: slotOf(p.inventory, 'bronze_sword') });
    expect(p.equipment.get('weapon')).toBe('bronze_sword');
    expect(p.inventory.count('bronze_sword')).toBe(0);
    expect(p.style).toBe('melee');
    const after = w.playerBonuses();
    expect(after.weapon).toBe('bronze_sword');
    expect(after.accuracy).toBeGreaterThan(before.accuracy);
    expect(after.power).toBeGreaterThan(before.power);
    // Survives save and reload.
    const w2 = new GameWorld({ save: JSON.parse(JSON.stringify(w.save())) });
    expect(w2.player.equipment.get('weapon')).toBe('bronze_sword');
    expect(w2.playerBonuses().accuracy).toBe(after.accuracy);
  });
});

describe('Production rules', () => {
  it('needs the right station, level and materials; failures consume and award nothing', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('copper_ore', 2);
    // Away from any furnace.
    w.issue({ type: 'craft', recipe: 'bronze_bar', count: 1 });
    expect(p.action).toBeNull();
    openStation(w, 'furnace');
    events(w);
    // No tin.
    w.issue({ type: 'craft', recipe: 'bronze_bar', count: 1 });
    expect(p.action).toBeNull();
    expect(events(w).some((e) => e.type === 'message' && e.text.includes('tin ore'))).toBe(true);
    // Iron needs Smithing 15.
    p.inventory.add('iron_ore', 1);
    w.issue({ type: 'craft', recipe: 'iron_bar', count: 1 });
    expect(p.action).toBeNull();
    run(w, 3);
    expect(p.inventory.count('copper_ore')).toBe(2);
    expect(p.inventory.count('iron_ore')).toBe(1);
    expect(p.skills.xp.smithing).toBe(0);
  });

  it('stops when materials run out and reports how many were made', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('copper_ore', 2);
    p.inventory.add('tin_ore', 2);
    openStation(w, 'furnace');
    events(w);
    w.issue({ type: 'craft', recipe: 'bronze_bar', count: 10 });
    run(w, 10);
    expect(p.inventory.count('bronze_bar')).toBe(2);
    expect(p.action).toBeNull();
    expect(events(w).some((e) => e.type === 'message' && e.text === 'You make 2 bronze bars.')).toBe(true);
  });

  it('checks inventory space (after ingredients are used) before consuming anything', () => {
    const w = new GameWorld();
    const p = w.player;
    // A hypothetical recipe whose stackable input stays in the bag while its product needs a slot.
    RECIPES.__test = { id: '__test', station: 'fletching', skill: 'fletching', level: 1, xp: 1, inputs: [{ item: 'coins', qty: 1 }], output: { item: 'bread', qty: 1 }, seconds: 1 };
    try {
      p.inventory.add('bread', INVENTORY_SLOTS - p.inventory.usedSlots());
      const coins = p.inventory.count('coins');
      events(w);
      w.issue({ type: 'craft', recipe: '__test', count: 1 });
      run(w, 2);
      expect(p.inventory.count('coins')).toBe(coins);
      expect(events(w).some((e) => e.type === 'inventoryFull')).toBe(true);
      // Real recipes that use up a slot-holding ingredient still work in a full bag.
      p.inventory.removeAt(slotOf(p.inventory, 'bread'));
      p.inventory.add('logs', 1);
      expect(p.inventory.isFull()).toBe(true);
      w.issue({ type: 'craft', recipe: 'arrow_shafts', count: 1 });
      run(w, 2);
      expect(p.inventory.count('arrow_shafts')).toBe(15);
    } finally {
      delete RECIPES.__test;
    }
  });

  it('moving cancels production; walking away closes the station', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('copper_ore', 5);
    p.inventory.add('tin_ore', 5);
    openStation(w, 'furnace');
    w.issue({ type: 'craft', recipe: 'bronze_bar', count: 5 });
    run(w, 0.5);
    w.issue({ type: 'joystick', dx: 1, dz: 0 });
    run(w, 1.5);
    expect(p.action).toBeNull();
    expect(p.inventory.count('bronze_bar')).toBe(0);
    stand(w, 40, 72);
    run(w, 0.1);
    expect(events(w).some((e) => e.type === 'productionClose')).toBe(true);
  });

  it('cooking can burn (no xp) and the chance falls to zero with level', () => {
    const rec = RECIPES.cooked_meat;
    expect(failChance(rec, 1)).toBeCloseTo(0.35);
    expect(failChance(rec, rec.fail!.stopLevel)).toBe(0);
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('raw_meat', 2);
    openStation(w, 'range');
    setRng(w, 0); // burns
    w.issue({ type: 'craft', recipe: 'cooked_meat', count: 1 });
    run(w, 2);
    expect(p.inventory.count('burnt_meat')).toBe(1);
    expect(p.skills.xp.cooking).toBe(0);
    setRng(w, 0.99); // cooks
    w.issue({ type: 'craft', recipe: 'cooked_meat', count: 1 });
    run(w, 2);
    expect(p.inventory.count('cooked_meat')).toBe(1);
    expect(p.skills.xp.cooking).toBe(rec.xp);
    // Cooked food heals.
    p.hp = 20;
    w.issue({ type: 'useItem', slot: slotOf(p.inventory, 'cooked_meat') });
    expect(p.hp).toBe(20 + itemDef('cooked_meat').heal!);
  });

  it('fletching makes shafts, unstrung and strung bows and arrows anywhere; bows work with ranged combat', () => {
    const w = new GameWorld();
    const p = w.player;
    p.skills.addXp('fletching', xpForLevel(5));
    p.inventory.add('logs', 3);
    p.inventory.add('bronze_bar', 1);
    w.issue({ type: 'craft', recipe: 'arrow_shafts', count: 1 });
    run(w, 2);
    w.issue({ type: 'craft', recipe: 'shortbow_u', count: 1 });
    run(w, 2);
    p.inventory.add('bowstring', 1);
    w.issue({ type: 'craft', recipe: 'shortbow', count: 1 });
    run(w, 2);
    w.issue({ type: 'craft', recipe: 'bronze_arrow', count: 1 });
    run(w, 2);
    expect(p.inventory.count('shortbow')).toBe(1);
    expect(p.inventory.count('arrow_shafts')).toBe(0);
    expect(p.inventory.count('bronze_arrow')).toBe(60 + 15);
    w.issue({ type: 'equip', slot: slotOf(p.inventory, 'shortbow') });
    expect(p.style).toBe('ranged');
    expect(w.playerBonuses().weapon).toBe('shortbow');
    expect(recipesFor('fletching').length).toBeGreaterThanOrEqual(4);
  });
});

describe('Equipment', () => {
  it('swaps worn items atomically and keeps the swapped item in the freed slot', () => {
    const eq = new Equipment();
    const inv = new Inventory();
    inv.add('bronze_sword');
    inv.add('bronze_dagger');
    const lvl = () => 1;
    expect(equipFromInventory(eq, inv, 0, lvl).ok).toBe(true);
    expect(eq.get('weapon')).toBe('bronze_sword');
    expect(equipFromInventory(eq, inv, 1, lvl).removed).toEqual(['bronze_sword']);
    expect(inv.slots[1]).toEqual({ item: 'bronze_sword', qty: 1 });
    expect(eq.get('weapon')).toBe('bronze_dagger');
  });

  it('a two-handed bow takes off the shield only if there is room for it', () => {
    const eq = new Equipment();
    const inv = new Inventory();
    inv.add('bronze_shield');
    inv.add('bronze_sword');
    equipFromInventory(eq, inv, 0, () => 1);
    equipFromInventory(eq, inv, 1, () => 1);
    inv.add('shortbow');
    inv.add('bread', INVENTORY_SLOTS - inv.usedSlots());
    const snapshot = JSON.stringify([inv.toJSON(), eq.toJSON()]);
    const bow = inv.slots.findIndex((s) => s?.item === 'shortbow');
    // Sword and shield both have to come off, but only the bow's slot frees up.
    const r = equipFromInventory(eq, inv, bow, () => 1);
    expect(r).toMatchObject({ ok: false, reason: 'space' });
    expect(JSON.stringify([inv.toJSON(), eq.toJSON()])).toBe(snapshot);
    inv.removeAt(inv.slots.findIndex((s) => s?.item === 'bread'));
    expect(equipFromInventory(eq, inv, bow, () => 1).ok).toBe(true);
    expect(eq.get('shield')).toBeNull();
    expect(inv.count('bronze_shield') + inv.count('bronze_sword')).toBe(2);
  });

  it('enforces level requirements and keeps unequipped items safe when the bag is full', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('iron_sword');
    events(w);
    w.issue({ type: 'equip', slot: slotOf(p.inventory, 'iron_sword') });
    expect(p.equipment.get('weapon')).toBeNull();
    expect(events(w).some((e) => e.type === 'message' && e.text.includes('Attack level 10'))).toBe(true);
    p.inventory.add('bronze_helm');
    w.issue({ type: 'equip', slot: slotOf(p.inventory, 'bronze_helm') });
    p.inventory.add('bread', INVENTORY_SLOTS - p.inventory.usedSlots());
    w.issue({ type: 'unequip', slot: 'head' });
    expect(p.equipment.get('head')).toBe('bronze_helm');
    expect(unequipToInventory(p.equipment, p.inventory, 'head').ok).toBe(false);
  });

  it('armour lowers the chance enemies hit you', () => {
    const w = new GameWorld();
    const p = w.player;
    for (const it of ['bronze_helm', 'bronze_platebody', 'bronze_platelegs', 'bronze_shield'] as ItemId[]) {
      p.inventory.add(it);
      w.issue({ type: 'equip', slot: slotOf(p.inventory, it) });
    }
    const armour = w.playerBonuses().armour;
    expect(armour).toBe(4 + 12 + 8 + 7);
    const att = { attackLevel: 8, strengthLevel: 7, accuracyBonus: 0, powerBonus: 0 };
    expect(hitChance(att, { defenceLevel: 1, armour })).toBeLessThan(hitChance(att, { defenceLevel: 1, armour: 0 }));
  });

  it('equip and unequip never duplicate or lose items', () => {
    const w = new GameWorld();
    const p = w.player;
    const gear: ItemId[] = ['bronze_sword', 'bronze_dagger', 'bronze_shield', 'shortbow', 'bronze_helm', 'wooden_shield'];
    for (const g of gear) p.inventory.add(g);
    const count = () => gear.reduce((a, g) => a + p.inventory.count(g) + Object.values(p.equipment.slots).filter((x) => x === g).length, 0);
    for (let i = 0; i < 300; i++) {
      const g = gear[(i * 7) % gear.length];
      const s = slotOf(p.inventory, g);
      if (i % 3 === 2) w.issue({ type: 'unequip', slot: (['weapon', 'shield', 'head'] as const)[i % 3] });
      else if (s >= 0) w.issue({ type: 'equip', slot: s });
      if (i % 11 === 0) p.inventory.add('bread', 1);
      expect(count()).toBe(gear.length);
      expect(p.inventory.usedSlots()).toBeLessThanOrEqual(INVENTORY_SLOTS);
    }
  });

  it('keeps gear that can no longer be worn in a slot (held), never deleting it', () => {
    const w = new GameWorld();
    const save = w.save();
    save.equipment = { weapon: 'bronze_helm', head: 'bronze_helm', body: 'nonsense' as ItemId };
    const w2 = new GameWorld({ save: JSON.parse(JSON.stringify(save)) });
    expect(w2.player.equipment.get('head')).toBe('bronze_helm');
    expect(w2.player.equipment.get('weapon')).toBeNull();
    expect(w2.player.overflow).toEqual([{ item: 'bronze_helm', qty: 1 }]);
  });

  it('fights and kills a slime with a forged sword equipped', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('bronze_sword');
    w.issue({ type: 'equip', slot: slotOf(p.inventory, 'bronze_sword') });
    const e = w.enemies.find((x) => x.def.id === 'slime')!;
    stand(w, e.x + 1, e.z);
    w.issue({ type: 'interact', target: e.id });
    for (let i = 0; i < 30 * 40 && e.alive; i++) w.tick();
    expect(e.alive).toBe(false);
    expect(p.skills.xp.attack).toBeGreaterThan(0);
  });
});
