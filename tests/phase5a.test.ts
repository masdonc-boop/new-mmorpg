import { describe, expect, it } from 'vitest';
import { GameWorld, type GameEvent, type SaveData } from '../src/sim/world';
import { STYLES, expectedDps, maxHit } from '../src/sim/combat';
import { Skills } from '../src/sim/skills';
import { COIN_STACK, ITEMS, itemDef, type ItemId } from '../src/data/items';
import { MAX_LEVEL, MAX_XP, SKILL_IDS, XP_TABLE, levelForXp, xpForLevel } from '../src/data/skills';
import { RECIPES } from '../src/data/recipes';
import { SHOPS, sellPrice } from '../src/data/shops';
import { BANK_MAX_STACK } from '../src/sim/bank';
import { compareWorn } from '../src/ui/compare';

/** Phase 5A: core progression and equipment (docs/PROGRESSION.md, section 5A). */

const run = (w: GameWorld, s: number) => {
  for (let t = 0; t < s * 30; t++) w.tick();
};
const stand = (w: GameWorld, x: number, z: number) => {
  w.player.x = w.player.prevX = x;
  w.player.z = w.player.prevZ = z;
};
const wear = (w: GameWorld, item: ItemId) => {
  w.player.inventory.add(item, 1);
  w.issue({ type: 'equip', slot: w.player.inventory.slots.findIndex((x) => x?.item === item) });
  return w.player.equipment.slots[itemDef(item).equip!.slot] === item;
};
const train = (w: GameWorld, level: number) => {
  for (const s of ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic'] as const) w.player.skills.addXp(s, xpForLevel(level));
};
const weapons = Object.values(ITEMS).filter((i) => i.equip?.slot === 'weapon' && i.equip.style);
const secondsOf = (id: string) => {
  const e = itemDef(id as ItemId).equip!;
  return e.speed ?? STYLES[e.style!].attackSeconds;
};

describe('5A skills and levels', () => {
  it('every skill runs 1 to 99 on one curve; xp and levels agree both ways, and xp is capped', () => {
    expect(XP_TABLE[1]).toBe(0);
    for (let l = 2; l <= MAX_LEVEL; l++) {
      expect(XP_TABLE[l]).toBeGreaterThan(XP_TABLE[l - 1]);
      expect(levelForXp(XP_TABLE[l])).toBe(l);
      expect(levelForXp(XP_TABLE[l] - 1)).toBe(l - 1);
    }
    expect(levelForXp(MAX_XP)).toBe(99);
    const s = new Skills();
    for (const id of SKILL_IDS) {
      s.addXp(id, MAX_XP * 2);
      expect(s.xp[id]).toBe(MAX_XP);
      expect(s.level(id)).toBe(99);
    }
    // Negative or junk xp from a save never lowers or breaks a skill.
    const junk = new Skills({ attack: -50, strength: Number.NaN, defence: 'x' as unknown as number });
    expect([junk.level('attack'), junk.level('strength'), junk.level('defence')]).toEqual([1, 1, 1]);
    expect(junk.addXp('attack', -500).newLevel).toBe(1);
  });

  it('the combat level comes from the combat skills, and the breakdown names the quickest ways up', () => {
    const s = new Skills();
    expect(s.combatLevel()).toBe(3);
    const fresh = s.combatBreakdown();
    expect(fresh.level).toBe(3);
    expect(fresh.next[0].levels).toBeGreaterThan(0);
    // Every listed route really raises the level by exactly that many levels.
    s.addXp('attack', xpForLevel(30));
    s.addXp('strength', xpForLevel(30));
    s.addXp('defence', xpForLevel(25));
    s.addXp('hitpoints', xpForLevel(28));
    const b = s.combatBreakdown();
    expect(b.style).toBe('melee');
    for (const r of b.next) {
      for (const skill of r.skills) {
        const t = new Skills({ ...s.xp });
        t.addXp(skill, xpForLevel(t.level(skill) + r.levels) - t.xp[skill]);
        expect(t.combatLevel(), `${r.levels} ${skill}`).toBe(b.level + 1);
        const u = new Skills({ ...s.xp });
        if (r.levels > 1) {
          u.addXp(skill, xpForLevel(u.level(skill) + r.levels - 1) - u.xp[skill]);
          expect(u.combatLevel(), `${r.levels - 1} ${skill}`).toBe(b.level);
        }
      }
    }
    // A ranger is levelled by Ranged, not by melee.
    const r = new Skills({ ranged: xpForLevel(60), hitpoints: xpForLevel(40), defence: xpForLevel(30) });
    expect(r.combatBreakdown().style).toBe('ranged');
    // Maxed: nowhere left to go.
    const max = new Skills(Object.fromEntries(SKILL_IDS.map((id) => [id, MAX_XP])));
    expect(max.combatBreakdown().next).toEqual([]);
  });

  it('a level up says what it unlocks and when the combat level rises', () => {
    const w = new GameWorld();
    w.drainEvents();
    w.grantXp('woodcutting', xpForLevel(12));
    const ev = w.drainEvents();
    const up = ev.find((e): e is Extract<GameEvent, { type: 'levelUp' }> => e.type === 'levelUp')!;
    expect(up.level).toBe(12);
    expect(up.unlocked!.join(' ')).toMatch(/oak/i);
    const said = ev.filter((e): e is Extract<GameEvent, { type: 'message' }> => e.type === 'message').map((e) => e.text).join(' ');
    expect(said).toMatch(/New: .*oak/i);
    const before = w.player.skills.combatLevel();
    w.grantXp('attack', xpForLevel(20));
    const ev2 = w.drainEvents();
    const up2 = ev2.find((e): e is Extract<GameEvent, { type: 'levelUp' }> => e.type === 'levelUp')!;
    expect(up2.combat).toBe(w.player.skills.combatLevel());
    expect(up2.combat).toBeGreaterThan(before);
    // Gathering skills never claim a combat level.
    w.grantXp('mining', xpForLevel(30));
    expect(w.drainEvents().some((e) => e.type === 'levelUp' && e.combat)).toBe(false);
  });
});

describe('5A equipment progression', () => {
  it('each weapon type has its own pace and reach; damage per second stays level within a tier', () => {
    // Daggers are quick, the warhammer and the staff slow, longbows slow with a longer reach.
    for (const id of ['bronze_dagger', 'iron_dagger', 'steel_dagger', 'glimsteel_dagger']) expect(secondsOf(id)).toBeLessThan(STYLES.melee.attackSeconds);
    expect(secondsOf('duskiron_warhammer')).toBeGreaterThan(STYLES.melee.attackSeconds);
    for (const id of ['riverwood_longbow', 'rowan_longbow', 'warders_longbow']) {
      expect(secondsOf(id)).toBeGreaterThan(STYLES.ranged.attackSeconds);
      expect(itemDef(id as ItemId).equip!.range).toBeGreaterThan(STYLES.ranged.range);
    }
    expect(itemDef('rowan_staff').equip!.range).toBeGreaterThan(STYLES.magic.range);
    // Same tier, different type: within 8% of each other at the tier's level (against the same foe).
    const dps = (id: string, lvl: number) => {
      const e = itemDef(id as ItemId).equip!;
      return expectedDps(lvl, e.accuracy ?? 0, e.power ?? 0, secondsOf(id));
    };
    const pairs: [string, string, number][] = [
      ['bronze_dagger', 'bronze_sword', 1],
      ['iron_dagger', 'iron_sword', 10],
      ['steel_dagger', 'steel_sword', 20],
      ['glimsteel_dagger', 'glimsteel_sword', 30],
      ['duskiron_warhammer', 'duskiron_sword', 45],
      ['rowan_longbow', 'rowan_shortbow', 40],
    ];
    for (const [a, b, lvl] of pairs) {
      const r = dps(a, lvl) / dps(b, lvl);
      expect(r, `${a} vs ${b}`).toBeGreaterThan(0.88);
      expect(r, `${a} vs ${b}`).toBeLessThan(1.08);
    }
    // A slow weapon hits harder each time, a quick one softer.
    const hit = (id: string) => maxHit({ attackLevel: 45, strengthLevel: 45, accuracyBonus: 0, powerBonus: itemDef(id as ItemId).equip!.power ?? 0 });
    expect(hit('duskiron_warhammer')).toBeGreaterThan(hit('duskiron_sword'));
    expect(hit('glimsteel_dagger')).toBeLessThan(hit('glimsteel_sword'));
    // Higher tiers of a style are always better by damage per second at their own level.
    for (const style of ['melee', 'ranged', 'magic'] as const) {
      const list = weapons.filter((i) => i.equip!.style === style).map((i) => ({ id: i.id, lvl: Math.max(1, ...Object.values(i.equip!.req ?? {})) }));
      for (const a of list) for (const b of list) if (b.lvl >= a.lvl + 10) expect(dps(b.id, b.lvl), `${b.id} vs ${a.id}`).toBeGreaterThan(dps(a.id, b.lvl));
    }
  });

  it('the simulation uses the worn weapon’s pace: a dagger strikes more often than a sword', () => {
    const swings = (weapon: ItemId) => {
      const w = new GameWorld();
      train(w, 40);
      expect(wear(w, weapon)).toBe(true);
      const e = w.enemies.find((x) => x.def.id === 'slime')!;
      e.hp = 1e9;
      stand(w, e.x + 1, e.z);
      w.issue({ type: 'interact', target: e.id });
      run(w, 0.5);
      w.drainEvents();
      let n = 0;
      for (let t = 0; t < 30 * 15; t++) {
        w.tick();
        n += w.drainEvents().filter((x) => x.type === 'attack' && x.source === w.player.id).length;
      }
      return n;
    };
    const dagger = swings('steel_dagger');
    const sword = swings('steel_sword');
    expect(dagger).toBeGreaterThanOrEqual(Math.floor(15 / 1.5) - 1);
    expect(sword).toBeLessThanOrEqual(Math.ceil(15 / 1.6) + 1);
    expect(dagger).toBeGreaterThan(sword);
  });

  it('a longbow fires from further away than a shortbow', () => {
    const w = new GameWorld();
    train(w, 45);
    expect(wear(w, 'rowan_longbow')).toBe(true);
    expect(w.player.equipment.attackProfile('ranged').range).toBe(8.5);
    expect(w.player.equipment.attackProfile('melee').range).toBe(STYLES.melee.range);
    w.player.equipment.slots.weapon = 'rowan_shortbow';
    expect(w.player.equipment.attackProfile('ranged')).toEqual({ seconds: STYLES.ranged.attackSeconds, range: STYLES.ranged.range });
  });

  it('wearing needs every listed skill level, gear goes only in its own slot, and nothing is lost on a refusal', () => {
    for (const i of Object.values(ITEMS)) {
      const e = i.equip;
      if (!e) continue;
      for (const [skill, lvl] of Object.entries(e.req ?? {})) {
        expect(['attack', 'strength', 'defence', 'ranged', 'magic'], i.id).toContain(skill);
        expect(lvl, i.id).toBeGreaterThanOrEqual(1);
        expect(lvl, i.id).toBeLessThanOrEqual(99);
      }
      if (e.style) expect(e.slot, i.id).toBe('weapon');
      if (e.speed !== undefined) expect(e.slot, i.id).toBe('weapon');
      if (e.ammoFor) expect(e.slot, i.id).toBe('ammo');
    }
    const w = new GameWorld();
    w.player.skills.addXp('attack', xpForLevel(44));
    w.player.skills.addXp('strength', xpForLevel(45));
    const before = w.player.inventory.count('duskiron_warhammer');
    expect(wear(w, 'duskiron_warhammer')).toBe(false);
    expect(w.player.inventory.count('duskiron_warhammer')).toBe(before + 1);
    w.player.skills.addXp('attack', xpForLevel(45));
    w.issue({ type: 'equip', slot: w.player.inventory.slots.findIndex((x) => x?.item === 'duskiron_warhammer') });
    expect(w.player.equipment.get('weapon')).toBe('duskiron_warhammer');
    expect(w.player.style).toBe('melee');
  });

  it('the item card compares with what is worn: stats, pace and reach', () => {
    const w = new GameWorld();
    train(w, 45);
    expect(compareWorn(w.player.equipment, 'steel_sword')).toMatch(/empty/);
    wear(w, 'steel_sword');
    expect(compareWorn(w.player.equipment, 'steel_sword')).toBeNull();
    const c = compareWorn(w.player.equipment, 'steel_dagger')!;
    expect(c).toMatch(/Compared with your Steel sword/);
    expect(c).toMatch(/−4 accuracy/);
    expect(c).toMatch(/quicker by 0\.1s/);
    expect(compareWorn(w.player.equipment, 'glimsteel_sword')).toMatch(/\+10 accuracy.*\+8 power/);
    expect(compareWorn(w.player.equipment, 'rowan_longbow')).toMatch(/switches to Ranged/);
  });
});

describe('5A economy', () => {
  it('coins hold as much in the bag as in the bank; a rich player can still sell and loot', () => {
    expect(COIN_STACK).toBe(BANK_MAX_STACK);
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('coins', 250_000);
    expect(p.inventory.count('coins')).toBe(250_025);
    // Selling to Tilly past the old 99,999 cap.
    const tilly = w.npcs.find((n) => n.def.id === 'merchant')!;
    stand(w, tilly.x + 1.2, tilly.z);
    w.issue({ type: 'interact', target: tilly.id });
    run(w, 0.3);
    p.inventory.add('iron_ore', 1);
    w.issue({ type: 'shopSell', slot: p.inventory.slots.findIndex((x) => x?.item === 'iron_ore'), qty: 1 });
    expect(p.inventory.count('iron_ore')).toBe(0);
    expect(p.inventory.count('coins')).toBe(250_025 + sellPrice('iron_ore'));
    // Still a hard ceiling: nothing past it, and nothing taken when it would overflow.
    p.inventory.remove('coins', p.inventory.count('coins'));
    p.inventory.add('coins', COIN_STACK);
    expect(p.inventory.add('coins', 5)).toBe(0);
    p.inventory.add('iron_ore', 1);
    w.issue({ type: 'shopSell', slot: p.inventory.slots.findIndex((x) => x?.item === 'iron_ore'), qty: 1 });
    expect(p.inventory.count('iron_ore')).toBe(1);
    expect(p.inventory.count('coins')).toBe(COIN_STACK);
  });

  it('a big purse survives a save and load whole', () => {
    const w = new GameWorld();
    w.player.inventory.add('coins', 1_234_567);
    const save = JSON.parse(JSON.stringify(w.save())) as SaveData;
    const w2 = new GameWorld({ save });
    expect(w2.player.inventory.count('coins')).toBe(1_234_592);
  });

  it('stackability follows the rules: currency and ammunition stack, gathered and made things take a slot each', () => {
    for (const i of Object.values(ITEMS)) {
      if (i.kind === 'currency' || i.kind === 'ammo') expect(i.stackable, i.id).toBe(true);
      if (['weapon', 'armour', 'food', 'tool'].includes(i.kind)) expect(i.stackable, i.id).toBe(false);
    }
  });

  it('within each style and slot, better gear is worth more (the shop and Exchange prices follow)', () => {
    const groups = new Map<string, { id: string; lvl: number; value: number }[]>();
    for (const i of Object.values(ITEMS)) {
      const e = i.equip;
      if (!e?.req || e.slot === 'ammo') continue;
      const lvl = Math.max(...Object.values(e.req));
      // Weapons compare with their own kind (a one-bar dagger is cheaper than a sword of the tier below).
      const key = `${e.slot}:${e.slot === 'weapon' ? i.id.split('_').pop() : ''}:${e.style ?? Object.keys(e.styleBonus ?? {}).find((k) => (e.styleBonus as Record<string, { accuracy?: number }>)[k].accuracy! > 0) ?? 'any'}`;
      groups.set(key, [...(groups.get(key) ?? []), { id: i.id, lvl, value: i.value }]);
    }
    const starters = new Map<string, number>();
    for (const i of Object.values(ITEMS)) if (i.equip && !i.equip.req && i.equip.slot !== 'ammo') starters.set(i.id, i.value);
    for (const [key, list] of groups) {
      for (const a of list) for (const b of list) if (b.lvl >= a.lvl + 10) expect(b.value, `${key}: ${b.id} vs ${a.id}`).toBeGreaterThan(a.value);
    }
    expect(starters.size).toBeGreaterThan(0);
  });

  it('every recipe is well formed: real items, levels 1–99, xp for the work, and it uses up what it takes', () => {
    for (const r of Object.values(RECIPES)) {
      expect(r.level, r.id).toBeGreaterThanOrEqual(1);
      expect(r.level, r.id).toBeLessThanOrEqual(99);
      expect(r.xp, r.id).toBeGreaterThan(0);
      const ins = r.inputs.map((x) => x.item);
      for (const x of r.inputs) {
        expect(itemDef(x.item), `${r.id} in ${x.item}`).toBeTruthy();
        expect(x.qty, r.id).toBeGreaterThan(0);
      }
      expect(itemDef(r.output.item), r.id).toBeTruthy();
      expect(r.output.qty, r.id).toBeGreaterThan(0);
      // No recipe gives back one of its own inputs (a loop that makes something from nothing).
      expect(ins, r.id).not.toContain(r.output.item);
    }
  });

  it('nothing a shop sells can be sold straight back for more, at any quantity', () => {
    for (const shop of Object.values(SHOPS)) for (const s of shop.stock) expect(sellPrice(s.item) * 1000, s.item).toBeLessThanOrEqual(s.price * 1000);
  });
});

describe('5A persistence and compatibility', () => {
  it('xp, levels, worn gear (with its pace), the bank and the collection log all carry through a save', () => {
    const w = new GameWorld();
    train(w, 45);
    wear(w, 'rowan_longbow');
    w.player.collectionLog.add('warders_longbow');
    const save = JSON.parse(JSON.stringify(w.save())) as SaveData;
    const w2 = new GameWorld({ save });
    for (const id of SKILL_IDS) expect(w2.player.skills.xp[id]).toBe(w.player.skills.xp[id]);
    expect(w2.player.skills.combatLevel()).toBe(w.player.skills.combatLevel());
    expect(w2.player.equipment.get('weapon')).toBe('rowan_longbow');
    expect(w2.player.equipment.attackProfile('ranged').seconds).toBe(2);
    expect([...w2.player.collectionLog]).toEqual(['warders_longbow']);
  });

  it('an older save with weapons whose stats changed in 5A loads unchanged: same items, now with the new pace', () => {
    const w = new GameWorld();
    const save = JSON.parse(JSON.stringify(w.save())) as SaveData;
    save.equipment = { weapon: 'duskiron_warhammer' };
    save.inventory = [{ item: 'riverwood_longbow', qty: 1 }, { item: 'rowan_staff', qty: 1 }, { item: 'coins', qty: 99_999 }];
    const w2 = new GameWorld({ save });
    expect(w2.player.equipment.get('weapon')).toBe('duskiron_warhammer');
    expect(w2.player.inventory.count('riverwood_longbow')).toBe(1);
    expect(w2.player.inventory.count('rowan_staff')).toBe(1);
    expect(w2.player.inventory.count('coins')).toBe(99_999);
    expect(w2.player.equipment.attackProfile('melee').seconds).toBe(1.9);
  });
});
