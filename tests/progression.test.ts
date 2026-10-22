import { describe, expect, it } from 'vitest';
import { GameWorld, type Enemy, type SaveData } from '../src/sim/world';
import { combatXp, TRAINING_FOCUSES } from '../src/sim/combat';
import { validateCommand as parseCommand } from '../src/net/validate';
import { ITEMS, itemDef, type ItemId } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { xpForLevel } from '../src/data/skills';

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
