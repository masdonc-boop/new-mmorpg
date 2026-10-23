import type { Rng } from '../core/rng';
import type { SkillId } from '../data/skills';
import type { ItemId } from '../data/items';

export type CombatStyle = 'melee' | 'ranged' | 'magic';

export interface StyleDef {
  id: CombatStyle;
  name: string;
  weapon: string;
  range: number;
  attackSeconds: number;
  /** Weapon accuracy / power bonuses. */
  accuracy: number;
  power: number;
  ammo?: ItemId;
  /** Ammo is drawn from the worn ammo slot (arrows) rather than the bag (spark stones). */
  ammoWorn?: boolean;
  /** Projectile speed in tiles per second; undefined = instant (melee). */
  projectileSpeed?: number;
  xpSkills: SkillId[];
}

export const STYLES: Record<CombatStyle, StyleDef> = {
  melee: { id: 'melee', name: 'Melee', weapon: 'Training sword', range: 1.5, attackSeconds: 1.6, accuracy: 12, power: 10, xpSkills: ['attack', 'strength', 'defence'] },
  ranged: { id: 'ranged', name: 'Ranged', weapon: 'Training bow', range: 7, attackSeconds: 1.8, accuracy: 14, power: 8, ammo: 'bronze_arrow', ammoWorn: true, projectileSpeed: 16, xpSkills: ['ranged'] },
  magic: { id: 'magic', name: 'Magic', weapon: 'Apprentice wand', range: 6.5, attackSeconds: 2.2, accuracy: 18, power: 14, ammo: 'air_rune', projectileSpeed: 11, xpSkills: ['magic'] },
};

export interface AttackerStats {
  attackLevel: number;
  strengthLevel: number;
  accuracyBonus: number;
  powerBonus: number;
}

export interface DefenderStats {
  defenceLevel: number;
  armour: number;
}

export function hitChance(a: AttackerStats, d: DefenderStats): number {
  const att = (a.attackLevel + 8) * (a.accuracyBonus + 64);
  const def = (d.defenceLevel + 8) * (d.armour + 64);
  // Smooth ratio, clamped so fights never feel hopeless or guaranteed.
  const p = att / (att + def * 0.8);
  return Math.max(0.15, Math.min(0.95, p));
}

export function maxHit(a: AttackerStats): number {
  return Math.max(1, Math.floor(6 + a.strengthLevel * 1.1 + a.powerBonus * 0.5));
}

/**
 * Average damage per second against a target of a given Defence (no armour), from the same rules as
 * a real fight: hit chance × average hit ÷ seconds between attacks. Used to keep weapon types of a
 * tier level with each other (tests) and for the item card's damage rating.
 */
export function expectedDps(level: number, accuracy: number, power: number, seconds: number, targetDefence = level): number {
  const a = { attackLevel: level, strengthLevel: level, accuracyBonus: accuracy, powerBonus: power };
  // rollHit's average: max × (0.25 + 0.75 × E[√u]) with E[√u] = 2/3.
  return (hitChance(a, { defenceLevel: targetDefence, armour: 0 }) * maxHit(a) * 0.75) / seconds;
}

export interface HitResult {
  hit: boolean;
  damage: number;
}

export function rollHit(rng: Rng, a: AttackerStats, d: DefenderStats, fixedMax?: number): HitResult {
  if (rng() > hitChance(a, d)) return { hit: false, damage: 0 };
  const m = fixedMax ?? maxHit(a);
  // Bias slightly upward so hits feel meaningful.
  const damage = Math.max(1, Math.round(m * (0.25 + 0.75 * Math.sqrt(rng()))));
  return { hit: true, damage };
}

/**
 * Where combat xp goes (docs/PROGRESSION.md): shared (the original split), or focused on accuracy
 * (Attack), power (Strength) or Defence. Ranged and Magic train their own skill unless the focus is
 * Defence, which splits it half and half. The total per damage never changes.
 */
export type TrainingFocus = 'shared' | 'accuracy' | 'power' | 'defence';
export const TRAINING_FOCUSES: readonly TrainingFocus[] = ['shared', 'accuracy', 'power', 'defence'];

/** XP distribution for damage dealt: 1.2xp per damage over the focused skills, plus hitpoints. */
export function combatXp(style: CombatStyle, damage: number, focus: TrainingFocus = 'shared'): { skill: SkillId; amount: number }[] {
  let skills: SkillId[] = STYLES[style].xpSkills;
  if (style === 'melee') {
    if (focus === 'accuracy') skills = ['attack'];
    else if (focus === 'power') skills = ['strength'];
    else if (focus === 'defence') skills = ['defence'];
  } else if (focus === 'defence') skills = [style, 'defence'];
  const per = (damage * 1.2) / skills.length;
  const out = skills.map((skill) => ({ skill, amount: per }));
  out.push({ skill: 'hitpoints', amount: damage * 0.4 });
  return out;
}
