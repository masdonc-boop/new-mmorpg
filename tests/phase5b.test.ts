import { describe, expect, it } from 'vitest';
import { GameWorld, type Enemy, type GameEvent, type SaveData } from '../src/sim/world';
import { combatXp, hitChance, TRAINING_FOCUSES, type TrainingFocus } from '../src/sim/combat';
import { ARMOUR_VS, ITEMS, armourClass, armourVs, itemDef, type ItemId } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { SKILL_IDS, xpForLevel, type SkillId } from '../src/data/skills';
import { ENEMIES } from '../src/data/enemies';
import { armourLine, compareWorn } from '../src/ui/compare';
import { validateCommand } from '../src/net/validate';

/** Phase 5B: combat depth and equipment progression (docs/PROGRESSION.md, section 6). */

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
const setRng = (w: GameWorld, f: () => number) => ((w as unknown as { rng: () => number }).rng = f);
const enemyAttack = (w: GameWorld, e: Enemy) => (w as unknown as { enemyAttack: (e: Enemy) => void }).enemyAttack(e);
const xpOf = (w: GameWorld) => Object.fromEntries(SKILL_IDS.map((id) => [id, w.player.skills.xp[id]])) as Record<SkillId, number>;

/** Fights a slime with a given focus; returns the xp gained per skill and the damage dealt. */
function fight(focus: TrainingFocus, seconds = 12) {
  const w = new GameWorld();
  train(w, 30);
  wear(w, 'steel_sword');
  w.issue({ type: 'setFocus', focus });
  const e = w.enemies.find((x) => x.def.id === 'slime')!;
  e.hp = 1e9;
  stand(w, e.x + 1, e.z);
  const before = xpOf(w);
  w.issue({ type: 'interact', target: e.id });
  let dealt = 0;
  let xpEvents = 0;
  for (let t = 0; t < 30 * seconds; t++) {
    w.tick();
    for (const ev of w.drainEvents()) {
      if (ev.type === 'damage' && ev.source === w.player.id && ev.target === e.id) dealt += ev.amount;
      if (ev.type === 'xp') xpEvents += ev.amount;
    }
  }
  const after = xpOf(w);
  const gained = Object.fromEntries(SKILL_IDS.map((id) => [id, after[id] - before[id]])) as Record<SkillId, number>;
  return { gained, dealt, xpEvents };
}

describe('5B melee training modes', () => {
  it('each mode sends melee xp to its skill (Balanced shares it), Hitpoints always gets its share, and nothing is counted twice', () => {
    const expectOnly: Record<TrainingFocus, SkillId[]> = { shared: ['attack', 'strength', 'defence'], accuracy: ['attack'], power: ['strength'], defence: ['defence'] };
    for (const focus of TRAINING_FOCUSES) {
      const { gained, dealt, xpEvents } = fight(focus);
      expect(dealt, focus).toBeGreaterThan(50);
      // Exactly the published split of the damage actually dealt: 1.2 xp per damage over the mode's
      // skills and 0.4 to Hitpoints, so the total is 1.6 per damage, never more.
      const want = combatXp('melee', dealt, focus);
      const sums: Partial<Record<SkillId, number>> = {};
      for (const x of want) sums[x.skill] = (sums[x.skill] ?? 0) + x.amount;
      for (const id of SKILL_IDS) expect(gained[id], `${focus} ${id}`).toBeCloseTo(sums[id] ?? 0, 6);
      const total = SKILL_IDS.reduce((a, id) => a + gained[id], 0);
      expect(total, focus).toBeCloseTo(dealt * 1.6, 6);
      expect(xpEvents, focus).toBeCloseTo(total, 6);
      for (const id of ['attack', 'strength', 'defence'] as SkillId[]) if (!expectOnly[focus].includes(id)) expect(gained[id], `${focus} ${id}`).toBe(0);
    }
  });

  it('switching mode mid-fight applies from the next hit on, deterministically', () => {
    const a = new GameWorld();
    const b = new GameWorld();
    for (const w of [a, b]) {
      train(w, 30);
      setRng(w, () => 0.3);
    }
    const hit = (w: GameWorld, e: Enemy, dmg: number) => (w as unknown as { damageEnemy: (e: Enemy, d: number, hit: boolean, s: string) => void }).damageEnemy(e, dmg, true, 'melee');
    for (const w of [a, b]) {
      const e = w.enemies.find((x) => x.def.id === 'goblin')!;
      e.hp = 1e6;
      w.issue({ type: 'setFocus', focus: 'power' });
      hit(w, e, 10);
      w.issue({ type: 'setFocus', focus: 'defence' });
      hit(w, e, 10);
    }
    expect(xpOf(a)).toEqual(xpOf(b));
    const fresh = new GameWorld();
    train(fresh, 30);
    expect(a.player.skills.xp.strength - fresh.player.skills.xp.strength).toBeCloseTo(12, 6);
    expect(a.player.skills.xp.defence - fresh.player.skills.xp.defence).toBeCloseTo(12, 6);
    expect(a.player.skills.xp.attack - fresh.player.skills.xp.attack).toBe(0);
  });

  it('bows and wands keep their own rules: their skill, or half with Defence in Defence mode', () => {
    expect(combatXp('ranged', 10, 'power')).toEqual([{ skill: 'ranged', amount: 12 }, { skill: 'hitpoints', amount: 4 }]);
    expect(combatXp('magic', 10, 'defence')).toEqual([{ skill: 'magic', amount: 6 }, { skill: 'defence', amount: 6 }, { skill: 'hitpoints', amount: 4 }]);
  });

  it('the mode is chosen only through a validated command, survives a save, and junk is refused', () => {
    expect(validateCommand({ type: 'setFocus', focus: 'power' })).toEqual({ type: 'setFocus', focus: 'power' });
    for (const junk of ['all', 'strength', '', null, 7, { a: 1 }]) expect(validateCommand({ type: 'setFocus', focus: junk })).toBeNull();
    expect(validateCommand({ type: 'grantXp', skill: 'strength', amount: 1e6 })).toBeNull();
    const w = new GameWorld();
    w.issue({ type: 'setFocus', focus: 'power' });
    w.issue({ type: 'setFocus', focus: 'nonsense' as TrainingFocus });
    expect(w.player.focus).toBe('power');
    const w2 = new GameWorld({ save: JSON.parse(JSON.stringify(w.save())) as SaveData });
    expect(w2.player.focus).toBe('power');
  });
});

describe('5B armour against each attack style', () => {
  it('every piece of armour is read as metal, hide, cloth or plain from what it already does', () => {
    const cls = (id: string) => armourClass(itemDef(id as ItemId).equip!);
    for (const id of ['bronze_platebody', 'steel_helm', 'glimsteel_shield', 'duskiron_platelegs', 'iron_sabatons', 'steel_handguards']) expect(cls(id), id).toBe('metal');
    for (const id of ['leather_body', 'boarhide_chaps', 'ridgehide_vambraces', 'ridgehide_boots']) expect(cls(id), id).toBe('hide');
    for (const id of ['linen_robe', 'mireweave_hood', 'heronscale_hood', 'mireweave_gloves']) expect(cls(id), id).toBe('cloth');
    for (const id of ['wooden_shield', 'travellers_cape', 'silver_ring', 'mirepearl_amulet']) expect(cls(id), id).toBe('plain');
  });

  it('metal is strongest against blows and arrows, cloth against spells; plain gear is exactly as before', () => {
    const plate = itemDef('steel_platebody').equip!;
    expect(armourVs(plate, 'melee')).toBe(30);
    expect(armourVs(plate, 'ranged')).toBeCloseTo(33, 6);
    expect(armourVs(plate, 'magic')).toBeCloseTo(10.5, 6);
    const robe = itemDef('mireweave_robe').equip!;
    expect(armourVs(robe, 'magic')).toBeGreaterThan(armourVs(robe, 'melee'));
    const hide = itemDef('ridgehide_body').equip!;
    expect(armourVs(hide, 'ranged')).toBeGreaterThan(armourVs(hide, 'melee'));
    expect(armourVs(hide, 'magic')).toBeGreaterThan((hide.armour ?? 0) * ARMOUR_VS.metal.magic);
    // Plain: full against melee and ranged, half against magic: the pre-5B rule.
    expect(ARMOUR_VS.plain).toEqual({ melee: 1, ranged: 1, magic: 0.5 });
    // The triangle at the same tier (full tier-30 sets): each line is best against its own threat.
    const set = (ids: ItemId[]) => {
      const w = new GameWorld();
      train(w, 60);
      for (const id of ids) expect(wear(w, id), id).toBe(true);
      return w.player.equipment.armourAgainst();
    };
    const metal = set(['glimsteel_helm', 'glimsteel_platebody', 'glimsteel_platelegs', 'glimsteel_handguards', 'glimsteel_sabatons']);
    const hides = set(['ridgehide_coif', 'ridgehide_body', 'ridgehide_chaps', 'ridgehide_vambraces', 'ridgehide_boots']);
    const cloth = set(['mireweave_hood', 'mireweave_robe', 'mireweave_skirt', 'mireweave_gloves', 'mireweave_slippers']);
    expect(metal.melee).toBeGreaterThan(hides.melee);
    expect(metal.melee).toBeGreaterThan(cloth.melee);
    expect(cloth.magic).toBeGreaterThan(metal.magic);
    expect(hides.magic).toBeGreaterThan(metal.magic);
    expect(metal.ranged).toBeGreaterThan(metal.magic * 2);
  });

  it('a fresh character, and anyone in plain gear, is hit exactly as often as before 5B', () => {
    const w = new GameWorld();
    wear(w, 'wooden_shield');
    wear(w, 'travellers_cape');
    const a = w.player.equipment.armourAgainst();
    const old = w.player.equipment.bonuses('melee').armour;
    expect(a).toEqual({ melee: old, ranged: old, magic: old * 0.5 });
  });

  it('creatures roll against the armour for their own style: robes turn the acolyte’s spells more than plate does', () => {
    const acolyte = ENEMIES.drowned_acolyte;
    const attacker = { attackLevel: acolyte.attack, strengthLevel: acolyte.strength, accuracyBonus: 0, powerBonus: 0 };
    const chanceIn = (ids: ItemId[]) => {
      const w = new GameWorld();
      train(w, 40);
      for (const id of ids) wear(w, id);
      const lvl = (w.player.skills.level('defence') + w.player.skills.level('magic')) / 2;
      return hitChance(attacker, { defenceLevel: lvl, armour: w.player.equipment.armourAgainst().magic });
    };
    const plate = chanceIn(['steel_helm', 'steel_platebody', 'steel_platelegs']);
    const robes = chanceIn(['mireweave_hood', 'mireweave_robe', 'mireweave_skirt']);
    expect(robes).toBeLessThan(plate);
    // And in the simulation itself: the same roll misses a robed mage and hits a knight.
    const outcome = (ids: ItemId[], roll: number) => {
      const w = new GameWorld();
      train(w, 40);
      for (const id of ids) wear(w, id);
      const e = w.enemies.find((x) => x.def.id === 'goblin')!;
      setRng(w, () => roll);
      w.drainEvents();
      enemyAttack(w, e);
      return w.drainEvents().find((x): x is Extract<GameEvent, { type: 'damage' }> => x.type === 'damage');
    };
    // Goblins swing in melee: plate (melee 30+) should turn a roll that a robe (melee ~4) lets through.
    const gob = ENEMIES.goblin;
    const ga = { attackLevel: gob.attack, strengthLevel: gob.strength, accuracyBonus: 0, powerBonus: 0 };
    const w0 = new GameWorld();
    train(w0, 40);
    const lvl = w0.player.skills.level('defence');
    const pPlate = hitChance(ga, { defenceLevel: lvl, armour: 12 + 30 + 21 });
    const pRobe = hitChance(ga, { defenceLevel: lvl, armour: Math.round(3 * 0.6) + Math.round(6 * 0.6) + Math.round(4 * 0.6) });
    expect(pPlate).toBeLessThan(pRobe);
    const roll = (pPlate + pRobe) / 2;
    expect(outcome(['steel_helm', 'steel_platebody', 'steel_platelegs'], roll)?.hit).toBe(false);
    expect(outcome(['mireweave_hood', 'mireweave_robe', 'mireweave_skirt'], roll)?.hit).toBe(true);
  });
});

describe('5B combat feedback', () => {
  it('a miss your armour caused says "blocked"; a plain miss does not; a vow-softened hit is marked', () => {
    const gob = ENEMIES.goblin;
    const ga = { attackLevel: gob.attack, strengthLevel: gob.strength, accuracyBonus: 0, powerBonus: 0 };
    const make = () => {
      const w = new GameWorld();
      train(w, 40);
      for (const id of ['steel_helm', 'steel_platebody', 'steel_platelegs'] as ItemId[]) wear(w, id);
      return w;
    };
    const w = make();
    const lvl = w.player.skills.level('defence');
    const bare = hitChance(ga, { defenceLevel: lvl, armour: 0 });
    const armoured = hitChance(ga, { defenceLevel: lvl, armour: w.player.equipment.armourAgainst().melee });
    const dmgEvent = (w: GameWorld, roll: number) => {
      const e = w.enemies.find((x) => x.def.id === 'goblin')!;
      setRng(w, () => roll);
      w.drainEvents();
      enemyAttack(w, e);
      return w.drainEvents().find((x): x is Extract<GameEvent, { type: 'damage' }> => x.type === 'damage')!;
    };
    const blocked = dmgEvent(w, (bare + armoured) / 2);
    expect(blocked).toMatchObject({ hit: false, amount: 0, outcome: 'blocked' });
    const missed = dmgEvent(make(), Math.min(0.99, bare + 0.02));
    expect(missed.hit).toBe(false);
    expect(missed.outcome).toBeUndefined();
    const hit = dmgEvent(make(), 0.01);
    expect(hit.hit).toBe(true);
    expect(hit.outcome).toBeUndefined();
    const vowed = make();
    vowed.player.prayers.add('hearth_bulwark');
    expect(dmgEvent(vowed, 0.01).outcome).toBe('warded');
  });

  it('a creature’s arrow carries its "blocked" to where it lands', () => {
    const w = new GameWorld();
    train(w, 40);
    for (const id of ['steel_helm', 'steel_platebody', 'steel_platelegs'] as ItemId[]) wear(w, id);
    const archer = w.enemies.find((x) => x.def.attackStyle === 'ranged')!;
    expect(archer.def.attackStyle).toBe('ranged');
    const d = archer.def;
    const a = { attackLevel: d.attack, strengthLevel: d.strength, accuracyBonus: 0, powerBonus: 0 };
    const lvl = w.player.skills.level('defence');
    const roll = (hitChance(a, { defenceLevel: lvl, armour: 0 }) + hitChance(a, { defenceLevel: lvl, armour: w.player.equipment.armourAgainst().ranged })) / 2;
    stand(w, archer.x + 3, archer.z);
    setRng(w, () => roll);
    enemyAttack(w, archer);
    w.drainEvents();
    let landed: Extract<GameEvent, { type: 'damage' }> | undefined;
    for (let t = 0; t < 30 && !landed; t++) {
      w.tick();
      landed = w.drainEvents().find((x): x is Extract<GameEvent, { type: 'damage' }> => x.type === 'damage' && x.target === w.player.id);
    }
    expect(landed?.outcome).toBe('blocked');
  });
});

describe('5B equipment progression: hands and feet for every line', () => {
  const NEW: ItemId[] = [
    'bronze_sabatons', 'iron_sabatons', 'steel_sabatons', 'glimsteel_sabatons', 'duskiron_sabatons',
    'bronze_handguards', 'iron_handguards', 'steel_handguards', 'glimsteel_handguards', 'duskiron_handguards',
    'boarhide_boots', 'ridgehide_boots', 'mireweave_gloves', 'mireweave_slippers',
  ];

  it('each new piece is made from existing materials at an existing station, and rises with its tier', () => {
    for (const id of NEW) {
      const r = RECIPES[id];
      expect(r, id).toBeTruthy();
      for (const x of r.inputs) expect(Object.values(RECIPES).some((o) => o.output.item === x.item) || ['boar_leather', 'ridgehide', 'mire_oil', 'thread', 'glimsteel_bar'].includes(x.item), `${id}: ${x.item}`).toBe(true);
    }
    const metals = ['bronze', 'iron', 'steel', 'glimsteel', 'duskiron'];
    for (const kind of ['sabatons', 'handguards']) {
      for (let i = 1; i < metals.length; i++) {
        const a = itemDef(`${metals[i - 1]}_${kind}` as ItemId);
        const b = itemDef(`${metals[i]}_${kind}` as ItemId);
        expect(b.equip!.armour!, b.id).toBeGreaterThan(a.equip!.armour!);
        expect(b.value, b.id).toBeGreaterThan(a.value);
        expect(RECIPES[b.id].level, b.id).toBeGreaterThan(RECIPES[a.id].level);
        // Smithed within the metal's own range (between its helm and its breastplate).
        expect(RECIPES[b.id].level).toBeGreaterThan(RECIPES[`${metals[i]}_helm`].level);
        expect(RECIPES[b.id].level).toBeLessThan(RECIPES[`${metals[i]}_platebody`].level);
      }
    }
    // Each metal's pieces need the same Defence as its helm.
    for (const m of metals) for (const kind of ['sabatons', 'handguards']) expect(itemDef(`${m}_${kind}` as ItemId).equip!.req ?? {}).toEqual(itemDef(`${m}_helm` as ItemId).equip!.req ?? {});
    // No line is now missing a hands or feet piece above tier 1.
    const lines: Record<string, { hands: boolean; feet: boolean }> = { metal: { hands: false, feet: false }, hide: { hands: false, feet: false }, cloth: { hands: false, feet: false } };
    for (const i of Object.values(ITEMS)) {
      const e = i.equip;
      if (!e || (e.slot !== 'hands' && e.slot !== 'feet') || !e.req) continue;
      const c = armourClass(e);
      if (c in lines) lines[c][e.slot] = true;
    }
    expect(lines).toEqual({ metal: { hands: true, feet: true }, hide: { hands: true, feet: true }, cloth: { hands: true, feet: true } });
  });

  it('forged at the anvil end to end: steel bars → steel sabatons, worn at Defence 20, shown in the armour totals', () => {
    const w = new GameWorld();
    const p = w.player;
    p.skills.addXp('smithing', xpForLevel(33));
    p.skills.addXp('defence', xpForLevel(20));
    const anvil = w.stations.find((s) => s.kind === 'anvil')!;
    stand(w, anvil.x - 1.0, anvil.z);
    w.issue({ type: 'interact', target: anvil.id });
    run(w, 0.5);
    p.inventory.add('steel_bar', 1);
    w.issue({ type: 'craft', recipe: 'steel_sabatons', count: 1 });
    run(w, 4);
    expect(p.inventory.count('steel_sabatons')).toBe(1);
    expect(p.inventory.count('steel_bar')).toBe(0);
    const before = p.equipment.armourAgainst();
    w.issue({ type: 'equip', slot: p.inventory.slots.findIndex((x) => x?.item === 'steel_sabatons') });
    expect(p.equipment.get('feet')).toBe('steel_sabatons');
    const after = p.equipment.armourAgainst();
    expect(after.melee - before.melee).toBeCloseTo(5, 6);
    expect(after.magic - before.magic).toBeCloseTo(1.75, 6);
  });

  it('the new pieces bank, trade-check and save like any other gear; older saves are untouched', () => {
    const w = new GameWorld();
    train(w, 45);
    for (const id of ['duskiron_handguards', 'ridgehide_boots'] as ItemId[]) wear(w, id);
    w.player.inventory.add('mireweave_gloves', 1);
    const save = JSON.parse(JSON.stringify(w.save())) as SaveData;
    const w2 = new GameWorld({ save });
    expect(w2.player.equipment.get('hands')).toBe('duskiron_handguards');
    expect(w2.player.equipment.get('feet')).toBe('ridgehide_boots');
    expect(w2.player.inventory.count('mireweave_gloves')).toBe(1);
    expect(w2.player.equipment.armourAgainst()).toEqual(w.player.equipment.armourAgainst());
    // A pre-5B save (no new fields at all) loads with the same gear and armour as its items give.
    const old = JSON.parse(JSON.stringify(new GameWorld().save())) as SaveData;
    old.equipment = { body: 'steel_platebody', hands: 'leather_vambraces' };
    const w3 = new GameWorld({ save: old });
    const a3 = w3.player.equipment.armourAgainst();
    expect(a3.melee).toBeCloseTo(30 + 3 * 0.8, 6);
    expect(a3.ranged).toBeCloseTo(33 + 3 * 1.2, 6);
    expect(a3.magic).toBeCloseTo(30 * 0.35 + 3 * 0.8, 6);
  });

  it('the item card shows armour by style and compares it with what is worn', () => {
    expect(armourLine(itemDef('steel_platebody').equip!)).toBe('armour 30 melee · 33 ranged · 11 magic');
    expect(armourLine(itemDef('wooden_shield').equip!)).toBe('armour 4 melee · 4 ranged · 2 magic');
    expect(armourLine(itemDef('steel_sword').equip!)).toBe('');
    const w = new GameWorld();
    train(w, 30);
    wear(w, 'steel_platebody');
    const c = compareWorn(w.player.equipment, 'ridgehide_body')!;
    expect(c).toMatch(/armour .*\(melee\/ranged\/magic\)/);
    expect(c).toMatch(/−14.*−9.*\+5/);
  });
});
