import type { ItemId } from './items';

/**
 * Vows of the Brightwater shrines (the Devotion skill). Five shrine spirits watch over the valley:
 * the Hearth wards the body, the Ember fires the arm, the Lantern steadies the eye, the Wind guides
 * arrows and the Tide carries spells. A vow is a promise made to one of them; keeping it costs
 * devotion while it lasts. (Original to Brightwater: see docs/ORIGINALITY.md, H1.)
 */
export type PrayerId =
  | 'warm_hearth'
  | 'hearthward'
  | 'hearth_bastion'
  | 'ember_spark'
  | 'emberheart'
  | 'ember_fury'
  | 'lantern_glow'
  | 'lanternsight'
  | 'lantern_blaze'
  | 'light_breeze'
  | 'windsong'
  | 'tide_whisper'
  | 'tidecall'
  | 'mending_song'
  | 'keepsake'
  | 'hearth_bulwark';

export type Spirit = 'Hearth' | 'Ember' | 'Lantern' | 'Wind' | 'Tide';

/**
 * Which effective level a vow raises in the custom hit formula: accuracy uses the attack level, max
 * hit the strength level, enemy accuracy the defence level; Wind and Tide raise both of their style's.
 */
type Boost = 'defence' | 'strength' | 'attack' | 'ranged' | 'magic';

export interface PrayerDef {
  id: PrayerId;
  name: string;
  spirit: Spirit;
  level: number;
  /** Devotion points used per minute while the vow is kept. */
  drainPerMin: number;
  boost?: { kind: Boost; mult: number };
  special?: 'mending' | 'keepsake' | 'bulwark';
  icon: string;
  text: string;
}

const v = (d: PrayerDef) => d;

export const PRAYERS: PrayerDef[] = [
  v({ id: 'warm_hearth', name: 'Warm Hearth', spirit: 'Hearth', level: 2, drainPerMin: 1.5, boost: { kind: 'defence', mult: 1.04 }, icon: '🏠', text: '+4% Defence' }),
  v({ id: 'ember_spark', name: 'Ember Spark', spirit: 'Ember', level: 5, drainPerMin: 1.5, boost: { kind: 'strength', mult: 1.04 }, icon: '🔥', text: '+4% Strength' }),
  v({ id: 'lantern_glow', name: 'Lantern Glow', spirit: 'Lantern', level: 6, drainPerMin: 1.5, boost: { kind: 'attack', mult: 1.04 }, icon: '🏮', text: '+4% Attack' }),
  v({ id: 'light_breeze', name: 'Light Breeze', spirit: 'Wind', level: 9, drainPerMin: 2, boost: { kind: 'ranged', mult: 1.05 }, icon: '🍃', text: '+5% Ranged' }),
  v({ id: 'tide_whisper', name: 'Tide Whisper', spirit: 'Tide', level: 11, drainPerMin: 2, boost: { kind: 'magic', mult: 1.05 }, icon: '🌊', text: '+5% Magic' }),
  v({ id: 'hearthward', name: 'Hearthward', spirit: 'Hearth', level: 14, drainPerMin: 4, boost: { kind: 'defence', mult: 1.09 }, icon: '🏠', text: '+9% Defence' }),
  v({ id: 'emberheart', name: 'Emberheart', spirit: 'Ember', level: 17, drainPerMin: 4, boost: { kind: 'strength', mult: 1.09 }, icon: '🔥', text: '+9% Strength' }),
  v({ id: 'lanternsight', name: 'Lanternsight', spirit: 'Lantern', level: 19, drainPerMin: 4, boost: { kind: 'attack', mult: 1.09 }, icon: '🏮', text: '+9% Attack' }),
  v({ id: 'mending_song', name: 'Mending Song', spirit: 'Hearth', level: 21, drainPerMin: 1.5, special: 'mending', icon: '🎶', text: 'Hitpoints mend nearly twice as fast' }),
  v({ id: 'keepsake', name: 'Keepsake', spirit: 'Lantern', level: 24, drainPerMin: 2, special: 'keepsake', icon: '🎁', text: 'Keep one extra item if you fall' }),
  v({ id: 'windsong', name: 'Windsong', spirit: 'Wind', level: 27, drainPerMin: 5, boost: { kind: 'ranged', mult: 1.1 }, icon: '🍃', text: '+10% Ranged' }),
  v({ id: 'tidecall', name: 'Tidecall', spirit: 'Tide', level: 28, drainPerMin: 5, boost: { kind: 'magic', mult: 1.1 }, icon: '🌊', text: '+10% Magic' }),
  v({ id: 'hearth_bastion', name: 'Hearth Bastion', spirit: 'Hearth', level: 30, drainPerMin: 8, boost: { kind: 'defence', mult: 1.14 }, icon: '🏰', text: '+14% Defence' }),
  v({ id: 'ember_fury', name: 'Ember Fury', spirit: 'Ember', level: 33, drainPerMin: 8, boost: { kind: 'strength', mult: 1.14 }, icon: '🔥', text: '+14% Strength' }),
  v({ id: 'lantern_blaze', name: 'Lantern Blaze', spirit: 'Lantern', level: 35, drainPerMin: 8, boost: { kind: 'attack', mult: 1.14 }, icon: '🏮', text: '+14% Attack' }),
  v({ id: 'hearth_bulwark', name: "Hearth's Bulwark", spirit: 'Hearth', level: 40, drainPerMin: 14, special: 'bulwark', icon: '🛡', text: 'Creatures hit you half as hard' }),
];

/** How much creature damage gets through Hearth's Bulwark. */
export const BULWARK_DAMAGE = 0.5;
/** Hitpoint regeneration interval (seconds) with and without Mending Song. */
export const REGEN_SECONDS = 1;
export const MENDING_REGEN_SECONDS = 0.55;

export function prayerDef(id: string): PrayerDef | undefined {
  return PRAYERS.find((x) => x.id === id);
}

/**
 * Vows that can't be kept together: one boost of each kind at a time; the Wind and the Tide each
 * exclude the melee vows (Ember, Lantern) and one another. Hearth vows go with anything.
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

/** Bones and the Devotion experience for burying one. */
export const BONES: Partial<Record<ItemId, number>> = { bones: 5, big_bones: 18 };
/** Devotion xp for each wardleaf burned as incense at the shrine or a waystone; each also restores a point. */
export const WARDLEAF_XP = 4;
