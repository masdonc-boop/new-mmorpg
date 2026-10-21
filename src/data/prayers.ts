import type { ItemId } from './items';

export type PrayerId =
  | 'thick_skin'
  | 'burst_of_strength'
  | 'clarity_of_thought'
  | 'sharp_eye'
  | 'mystic_will'
  | 'rock_skin'
  | 'superhuman_strength'
  | 'improved_reflexes'
  | 'rapid_heal'
  | 'protect_item'
  | 'hawk_eye'
  | 'mystic_lore'
  | 'steel_skin'
  | 'ultimate_strength'
  | 'incredible_reflexes'
  | 'protect_from_melee';

/**
 * Which effective level a prayer boosts. OSRS prayers raise effective levels, which maps directly
 * onto Brightwater's custom hit formula (accuracy uses the attack level, max hit the strength level,
 * enemy accuracy the defence level). Ranged and magic prayers boost both the style's rolls.
 */
type Boost = 'defence' | 'strength' | 'attack' | 'ranged' | 'magic';

export interface PrayerDef {
  id: PrayerId;
  name: string;
  level: number;
  /** OSRS drain effect: points drain at (effect / 60) per 0.6 s game tick, i.e. one point every 36/effect s. */
  drain: number;
  boost?: { kind: Boost; mult: number };
  /** Special effects (no level boost). */
  special?: 'rapidHeal' | 'protectItem' | 'protectMelee';
  icon: string;
  text: string;
}

const p = (d: PrayerDef) => d;

export const PRAYERS: PrayerDef[] = [
  p({ id: 'thick_skin', name: 'Thick Skin', level: 1, drain: 1, boost: { kind: 'defence', mult: 1.05 }, icon: '🛡', text: '+5% Defence' }),
  p({ id: 'burst_of_strength', name: 'Burst of Strength', level: 4, drain: 1, boost: { kind: 'strength', mult: 1.05 }, icon: '💪', text: '+5% Strength' }),
  p({ id: 'clarity_of_thought', name: 'Clarity of Thought', level: 7, drain: 1, boost: { kind: 'attack', mult: 1.05 }, icon: '🎯', text: '+5% Attack' }),
  p({ id: 'sharp_eye', name: 'Sharp Eye', level: 8, drain: 1, boost: { kind: 'ranged', mult: 1.05 }, icon: '🏹', text: '+5% Ranged' }),
  p({ id: 'mystic_will', name: 'Mystic Will', level: 9, drain: 1, boost: { kind: 'magic', mult: 1.05 }, icon: '✨', text: '+5% Magic' }),
  p({ id: 'rock_skin', name: 'Rock Skin', level: 10, drain: 6, boost: { kind: 'defence', mult: 1.1 }, icon: '🪨', text: '+10% Defence' }),
  p({ id: 'superhuman_strength', name: 'Superhuman Strength', level: 13, drain: 6, boost: { kind: 'strength', mult: 1.1 }, icon: '💪', text: '+10% Strength' }),
  p({ id: 'improved_reflexes', name: 'Improved Reflexes', level: 16, drain: 6, boost: { kind: 'attack', mult: 1.1 }, icon: '🎯', text: '+10% Attack' }),
  p({ id: 'rapid_heal', name: 'Rapid Heal', level: 22, drain: 1, special: 'rapidHeal', icon: '❤', text: 'Hitpoints recover twice as fast' }),
  p({ id: 'protect_item', name: 'Protect Item', level: 25, drain: 1, special: 'protectItem', icon: '👜', text: 'Keep one extra item when you die' }),
  p({ id: 'hawk_eye', name: 'Hawk Eye', level: 26, drain: 6, boost: { kind: 'ranged', mult: 1.1 }, icon: '🏹', text: '+10% Ranged' }),
  p({ id: 'mystic_lore', name: 'Mystic Lore', level: 27, drain: 6, boost: { kind: 'magic', mult: 1.1 }, icon: '✨', text: '+10% Magic' }),
  p({ id: 'steel_skin', name: 'Steel Skin', level: 28, drain: 12, boost: { kind: 'defence', mult: 1.15 }, icon: '⛨', text: '+15% Defence' }),
  p({ id: 'ultimate_strength', name: 'Ultimate Strength', level: 31, drain: 12, boost: { kind: 'strength', mult: 1.15 }, icon: '💪', text: '+15% Strength' }),
  p({ id: 'incredible_reflexes', name: 'Incredible Reflexes', level: 34, drain: 12, boost: { kind: 'attack', mult: 1.15 }, icon: '🎯', text: '+15% Attack' }),
  p({ id: 'protect_from_melee', name: 'Protect from Melee', level: 37, drain: 12, special: 'protectMelee', icon: '⚔', text: 'Blocks melee hits from creatures' }),
];

export function prayerDef(id: string): PrayerDef | undefined {
  return PRAYERS.find((x) => x.id === id);
}

/**
 * Prayers that can't be active together (OSRS): one of each boost kind; melee attack/strength
 * prayers exclude ranged and magic prayers, and ranged excludes magic.
 */
export function conflicts(a: PrayerDef, b: PrayerDef): boolean {
  if (a.id === b.id || !a.boost || !b.boost) return false;
  const k1 = a.boost.kind;
  const k2 = b.boost.kind;
  if (k1 === k2) return true;
  const offence = (k: Boost) => k !== 'defence';
  const melee = (k: Boost) => k === 'attack' || k === 'strength';
  if (!offence(k1) || !offence(k2)) return false;
  return !(melee(k1) && melee(k2));
}

/** Bones and the Prayer experience for burying one. */
export const BONES: Partial<Record<ItemId, number>> = { bones: 4.5, big_bones: 15 };

/** Drain resistance with no prayer bonus (OSRS: 60 + 2 × bonus). */
export const DRAIN_RESISTANCE = 60;
export const PRAYER_TICK = 0.6;
