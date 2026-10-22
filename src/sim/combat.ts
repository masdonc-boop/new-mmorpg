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

/** XP distribution for damage dealt: 1.2xp per damage split over style skills, plus hitpoints. */
export function combatXp(style: CombatStyle, damage: number): { skill: SkillId; amount: number }[] {
  const skills = STYLES[style].xpSkills;
  const per = (damage * 1.2) / skills.length;
  const out = skills.map((skill) => ({ skill, amount: per }));
  out.push({ skill: 'hitpoints', amount: damage * 0.4 });
  return out;
}
