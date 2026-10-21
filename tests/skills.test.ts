import { describe, expect, it } from 'vitest';
import { XP_TABLE, levelForXp, xpForLevel } from '../src/data/skills';
import { Skills } from '../src/sim/skills';
import { combatXp, hitChance, maxHit, rollHit } from '../src/sim/combat';
import { mulberry32 } from '../src/core/rng';

describe('XP curve', () => {
  it('matches the classic curve anchor points', () => {
    expect(XP_TABLE[2]).toBe(83);
    expect(XP_TABLE[10]).toBe(1154);
    expect(XP_TABLE[99]).toBe(13034431);
  });

  it('maps xp to levels', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(82)).toBe(1);
    expect(levelForXp(83)).toBe(2);
    expect(levelForXp(xpForLevel(50))).toBe(50);
    expect(levelForXp(1e9)).toBe(99);
  });
});

describe('Skills', () => {
  it('tracks skills independently and reports level ups', () => {
    const s = new Skills();
    expect(s.level('hitpoints')).toBe(10);
    expect(s.maxHp()).toBe(100);
    const r = s.addXp('woodcutting', 100);
    expect(r.oldLevel).toBe(1);
    expect(r.newLevel).toBe(2);
    expect(s.level('mining')).toBe(1);
    expect(s.combatLevel()).toBeGreaterThanOrEqual(3);
  });
});

describe('Combat math', () => {
  const att = { attackLevel: 1, strengthLevel: 1, accuracyBonus: 12, powerBonus: 10 };
  it('clamps hit chance', () => {
    expect(hitChance(att, { defenceLevel: 1, armour: 0 })).toBeGreaterThan(0.4);
    expect(hitChance(att, { defenceLevel: 500, armour: 500 })).toBe(0.15);
    expect(hitChance({ ...att, attackLevel: 500 }, { defenceLevel: 1, armour: 0 })).toBe(0.95);
  });

  it('never exceeds max hit', () => {
    const rng = mulberry32(1);
    const m = maxHit(att);
    for (let i = 0; i < 500; i++) {
      const r = rollHit(rng, att, { defenceLevel: 1, armour: 0 });
      expect(r.damage).toBeLessThanOrEqual(m);
      if (!r.hit) expect(r.damage).toBe(0);
    }
  });

  it('splits melee xp across attack, strength and defence', () => {
    const xp = combatXp('melee', 10);
    expect(xp.map((x) => x.skill).sort()).toEqual(['attack', 'defence', 'hitpoints', 'strength']);
    expect(xp.find((x) => x.skill === 'ranged')).toBeUndefined();
  });
});
