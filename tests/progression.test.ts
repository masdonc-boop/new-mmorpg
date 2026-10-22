import { describe, expect, it } from 'vitest';
import { GameWorld, type Enemy, type SaveData } from '../src/sim/world';
import { combatXp, TRAINING_FOCUSES } from '../src/sim/combat';
import { validateCommand as parseCommand } from '../src/net/validate';
import { ITEMS, itemDef, type ItemId } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { xpForLevel } from '../src/data/skills';
import { ENEMIES } from '../src/data/enemies';

const run = (w: GameWorld, s: number) => {
  for (let t = 0; t < s * 30; t++) w.tick();
};
const hit = (w: GameWorld, e: Enemy, dmg: number) => (w as unknown as { damageEnemy: (e: Enemy, d: number, hit: boolean, s: string) => void }).damageEnemy(e, dmg, true, w.player.style);

describe('4B.1 combat skills train independently', () => {
  it('the focus directs xp without changing the total', () => {
    const total = (f: (typeof TRAINING_FOCUSES)[number], style: 'melee' | 'ranged' | 'magic') => combatXp(style, 10, f).reduce((a, x) => a + x.amount, 0);
    for (const f of TRAINING_FOCUSES) for (const s of ['melee', 'ranged', 'magic'] as const) expect(total(f, s)).toBeCloseTo(16);
    expect(combatXp('melee', 10, 'accuracy').map((x) => x.skill)).toEqual(['attack', 'hitpoints']);
    expect(combatXp('melee', 10, 'power').map((x) => x.skill)).toEqual(['strength', 'hitpoints']);
    expect(combatXp('melee', 10, 'defence').map((x) => x.skill)).toEqual(['defence', 'hitpoints']);
    expect(combatXp('melee', 10, 'shared').map((x) => x.skill)).toEqual(['attack', 'strength', 'defence', 'hitpoints']);
    expect(combatXp('ranged', 10, 'defence').map((x) => x.skill)).toEqual(['ranged', 'defence', 'hitpoints']);
    expect(combatXp('magic', 10, 'power').map((x) => x.skill)).toEqual(['magic', 'hitpoints']);
  });

  it('fighting with a focus raises only that skill (and Hitpoints); the focus is saved', () => {
    const w = new GameWorld();
    const p = w.player;
    const slime = w.enemies.find((e) => e.def.id === 'slime')!;
    const before = { ...p.skills.xp };
    w.issue({ type: 'setFocus', focus: 'power' });
    hit(w, slime, 5);
    expect(p.skills.xp.strength - before.strength).toBeCloseTo(6);
    expect(p.skills.xp.attack).toBe(before.attack);
    expect(p.skills.xp.defence).toBe(before.defence);
    expect(p.skills.xp.hitpoints - before.hitpoints).toBeCloseTo(2);
    w.issue({ type: 'setStyle', style: 'ranged' });
    w.issue({ type: 'setFocus', focus: 'defence' });
    const r0 = p.skills.xp.ranged;
    const d0 = p.skills.xp.defence;
    hit(w, slime, 5);
    expect(p.skills.xp.ranged - r0).toBeCloseTo(3);
    expect(p.skills.xp.defence - d0).toBeCloseTo(3);
    const save = JSON.parse(JSON.stringify(w.save())) as SaveData;
    expect(new GameWorld({ save, map: w.map }).player.focus).toBe('defence');
    // Older saves (no focus) keep the original shared split.
    delete save.options!.focus;
    expect(new GameWorld({ save, map: w.map }).player.focus).toBe('shared');
    run(w, 0.1);
  });

  it('the server only accepts known focuses', () => {
    expect(parseCommand({ type: 'setFocus', focus: 'power' })).toBeTruthy();
    expect(parseCommand({ type: 'setFocus', focus: 'godlike' })).toBeNull();
  });
});

const wear = (w: GameWorld, item: ItemId) => {
  w.player.inventory.add(item, 1);
  w.issue({ type: 'equip', slot: w.player.inventory.slots.findIndex((x) => x?.item === item) });
  return w.player.equipment.slots[itemDef(item).equip!.slot] === item;
};

describe('4B.2 equipment: style bonuses, tiers and requirements', () => {
  it('metal armour costs magic and ranged accuracy but not melee; hides help archers only', () => {
    const w = new GameWorld();
    const p = w.player;
    p.skills.addXp('defence', xpForLevel(20));
    const acc = (style: 'melee' | 'ranged' | 'magic') => {
      p.style = style;
      return w.playerBonuses().accuracy;
    };
    const bare = { melee: acc('melee'), ranged: acc('ranged'), magic: acc('magic') };
    for (const it of ['steel_helm', 'steel_platebody', 'steel_platelegs'] as ItemId[]) expect(wear(w, it)).toBe(true);
    expect(acc('melee')).toBe(bare.melee);
    expect(acc('magic')).toBe(bare.magic - 12);
    expect(acc('ranged')).toBe(bare.ranged - 6);
    expect(w.playerBonuses().armour).toBe(12 + 30 + 21);
    const w2 = new GameWorld();
    for (const it of ['leather_cowl', 'leather_body', 'leather_chaps', 'leather_vambraces'] as ItemId[]) wear(w2, it);
    w2.player.style = 'ranged';
    const r = w2.playerBonuses().accuracy;
    w2.player.style = 'melee';
    expect(r - 14).toBe(2 + 4 + 3 + 3);
    expect(w2.playerBonuses().accuracy).toBe(12);
  });

  it('each melee tier has a dagger, sword, helm, shield, greaves and breastplate, with rising requirements and stats', () => {
    const tiers: [string, number][] = [['bronze', 0], ['iron', 10], ['steel', 20], ['glimsteel', 30], ['duskiron', 45]];
    let prevArmour = 0;
    for (const [t, lvl] of tiers) {
      const body = itemDef(`${t}_platebody` as ItemId).equip!;
      expect(body.req?.defence ?? 0, t).toBe(lvl);
      expect(body.armour!, t).toBeGreaterThan(prevArmour);
      prevArmour = body.armour!;
      for (const piece of ['helm', 'shield', 'platelegs', 'platebody']) expect(RECIPES[`${t}_${piece}`], `${t}_${piece}`).toBeTruthy();
      const blade = (t === 'duskiron' ? ['sword'] : ['dagger', 'sword']).map((b) => `${t}_${b}` as ItemId);
      for (const b of blade) {
        expect(ITEMS[b as keyof typeof ITEMS], b).toBeTruthy();
        expect(itemDef(b).equip!.req?.attack ?? 0, b).toBe(lvl);
        expect(RECIPES[b], b).toBeTruthy();
      }
    }
  });

  it('gear can only be worn at its level; the duskiron warhammer also needs Strength 45', () => {
    const w = new GameWorld();
    const p = w.player;
    expect(wear(w, 'iron_dagger')).toBe(false);
    p.skills.addXp('attack', xpForLevel(10));
    expect(wear(w, 'iron_dagger')).toBe(true);
    p.skills.addXp('attack', xpForLevel(45));
    expect(wear(w, 'duskiron_warhammer')).toBe(false);
    p.skills.addXp('strength', xpForLevel(45));
    expect(wear(w, 'duskiron_warhammer')).toBe(true);
    expect(itemDef('glimsteel_arrow').equip!.req).toEqual({ ranged: 30 });
  });

  it('a save with gear the wearer no longer meets the level for keeps it worn (nothing is lost)', () => {
    const w = new GameWorld();
    const save = JSON.parse(JSON.stringify(w.save())) as SaveData;
    save.equipment = { ...(save.equipment ?? {}), ammo: 'glimsteel_arrow' };
    save.ammoQty = 40;
    const w2 = new GameWorld({ save, map: w.map });
    expect(w2.player.equipment.slots.ammo).toBe('glimsteel_arrow');
    expect(w2.player.equipment.ammoQty).toBe(40);
  });
});

const SIDES = [[1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1]];
const useAt = (w: GameWorld, t: { id: number; x: number; z: number }) => {
  const [a, b] = SIDES.find(([x, z]) => !w.map.blocked[Math.floor(t.z + z) * w.map.width + Math.floor(t.x + x)])!;
  w.player.x = w.player.prevX = t.x + a;
  w.player.z = w.player.prevZ = t.z + b;
  w.issue({ type: 'interact', target: t.id });
  run(w, 0.3);
};
const craft = (w: GameWorld, recipe: string, count = 1) => {
  w.issue({ type: 'craft', recipe, count });
  run(w, count * 3 + 0.5);
};
const count = (w: GameWorld, item: ItemId) => w.player.inventory.count(item);

describe('4B.3 ranged and magic chains, end to end', () => {
  it('rowan: Woodcutting 40 in Thornridge → rowan longbow (Fletching 45) → wielded at Ranged 40, firing steel arrows', () => {
    const w = new GameWorld();
    const p = w.player;
    (w as unknown as { rng: () => number }).rng = () => 0.01;
    const tree = w.nodes.find((n) => n.def.id === 'rowan')!;
    expect(tree.x).toBeGreaterThan(112);
    p.skills.addXp('woodcutting', xpForLevel(39));
    useAt(w, tree);
    run(w, 3);
    expect(count(w, 'rowan_logs')).toBe(0);
    p.skills.addXp('woodcutting', xpForLevel(40));
    useAt(w, tree);
    run(w, 3);
    expect(count(w, 'rowan_logs')).toBeGreaterThan(0);
    w.issue({ type: 'moveTo', x: p.x, z: p.z });
    p.inventory.add('rowan_logs', 2);
    p.inventory.add('bowstring', 1);
    p.skills.addXp('fletching', xpForLevel(45));
    craft(w, 'rowan_longbow');
    expect(count(w, 'rowan_longbow')).toBe(1);
    p.inventory.add('arrow_shafts', 12);
    p.inventory.add('steel_bar', 1);
    craft(w, 'steel_arrow');
    expect(count(w, 'steel_arrow')).toBe(12);
    p.skills.addXp('ranged', xpForLevel(40));
    expect(wear(w, 'rowan_longbow')).toBe(true);
    expect(wear(w, 'steel_arrow')).toBe(true);
    p.style = 'ranged';
    expect(w.playerBonuses()).toMatchObject({ weapon: 'rowan_longbow', accuracy: 46 + 2, power: 32 + 3 });
  });

  it('hides: boar and stalker hides → the tanner → boarhide and ridgehide armour, worn at Ranged 20 and 30', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('boar_hide', 3);
    p.inventory.add('ridge_pelt', 3);
    p.inventory.add('coins', 200);
    useAt(w, w.npcs.find((n) => n.def.id === 'tanner')!);
    w.issue({ type: 'tan', item: 'boar_hide', qty: 3 });
    w.issue({ type: 'tan', item: 'ridge_pelt', qty: 3 });
    expect(count(w, 'boar_leather')).toBe(3);
    expect(count(w, 'ridgehide')).toBe(3);
    w.issue({ type: 'tannerClose' });
    p.inventory.add('thread', 6);
    p.skills.addXp('crafting', xpForLevel(46));
    craft(w, 'boarhide_body');
    craft(w, 'ridgehide_body');
    expect(count(w, 'boarhide_body')).toBe(1);
    expect(count(w, 'ridgehide_body')).toBe(1);
    expect(wear(w, 'boarhide_body')).toBe(false);
    p.skills.addXp('ranged', xpForLevel(20));
    p.skills.addXp('defence', xpForLevel(20));
    expect(wear(w, 'boarhide_body')).toBe(true);
    expect(wear(w, 'ridgehide_body')).toBe(false);
    p.skills.addXp('ranged', xpForLevel(30));
    p.skills.addXp('defence', xpForLevel(30));
    expect(wear(w, 'ridgehide_body')).toBe(true);
    expect(ENEMIES_DROP('bristleback', 'boar_hide') && ENEMIES_DROP('ridge_stalker', 'ridge_pelt')).toBe(true);
  });

  it('robes: flax → linen at the spinning wheel → linen robe; with mire oil → mireweave (Magic 25)', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('flax', 6);
    p.skills.addXp('crafting', xpForLevel(34));
    useAt(w, w.stations.find((s) => s.kind === 'spinning_wheel')!);
    craft(w, 'linen', 3);
    expect(count(w, 'linen')).toBe(3);
    w.issue({ type: 'closeProduction' });
    p.inventory.add('thread', 4);
    craft(w, 'linen_robe');
    expect(count(w, 'linen_robe')).toBe(1);
    p.inventory.add('linen', 3);
    p.inventory.add('mire_oil', 4);
    craft(w, 'mireweave_robe');
    expect(count(w, 'mireweave_robe')).toBe(1);
    expect(wear(w, 'linen_robe')).toBe(true);
    p.style = 'magic';
    const withLinen = w.playerBonuses().accuracy;
    expect(wear(w, 'mireweave_robe')).toBe(false);
    p.skills.addXp('magic', xpForLevel(25));
    expect(wear(w, 'mireweave_robe')).toBe(true);
    expect(w.playerBonuses().accuracy).toBe(withLinen + 3);
  });

  it('magic weapons: the mirelight wand (marsh pearl) and the two-handed rowan staff (Thornridge silver)', () => {
    const w = new GameWorld();
    const p = w.player;
    p.skills.addXp('crafting', xpForLevel(45));
    p.inventory.add('willow_logs', 1);
    p.inventory.add('marsh_pearl', 1);
    p.inventory.add('dull_spark', 28);
    p.inventory.add('rowan_logs', 2);
    p.inventory.add('silver_bar', 1);
    craft(w, 'mirelight_wand');
    craft(w, 'rowan_staff');
    expect(count(w, 'mirelight_wand')).toBe(1);
    expect(count(w, 'rowan_staff')).toBe(1);
    p.skills.addXp('magic', xpForLevel(40));
    expect(wear(w, 'wooden_shield')).toBe(true);
    expect(wear(w, 'rowan_staff')).toBe(true);
    expect(p.equipment.slots.shield).toBeNull();
    p.style = 'magic';
    expect(w.playerBonuses()).toMatchObject({ weapon: 'rowan_staff', accuracy: 42, power: 35 });
  });

  it('new gear and materials bank and come back whole (non-stackable logs one per slot, arrows as a stack)', () => {
    const w = new GameWorld();
    const p = w.player;
    useAt(w, w.npcs.find((n) => n.def.id === 'cairn_banker')!);
    p.inventory.add('rowan_logs', 3);
    p.inventory.add('steel_arrow', 120);
    p.inventory.add('ridgehide_body', 1);
    expect(p.inventory.slots.filter((s) => s?.item === 'rowan_logs').length).toBe(3);
    for (const it of ['rowan_logs', 'steel_arrow', 'ridgehide_body'] as ItemId[]) w.issue({ type: 'bankDeposit', slot: p.inventory.slots.findIndex((s) => s?.item === it), qty: 999 });
    expect(count(w, 'rowan_logs') + count(w, 'steel_arrow') + count(w, 'ridgehide_body')).toBe(0);
    for (const it of ['rowan_logs', 'steel_arrow', 'ridgehide_body'] as ItemId[]) w.issue({ type: 'bankWithdraw', item: it, qty: 999 });
    expect([count(w, 'rowan_logs'), count(w, 'steel_arrow'), count(w, 'ridgehide_body')]).toEqual([3, 120, 1]);
  });
});

function ENEMIES_DROP(enemy: string, item: string) {
  return ENEMIES[enemy as keyof typeof ENEMIES].drops.some((d) => d.item === item);
}
