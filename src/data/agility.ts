/** One obstacle of an agility course, crossed from (x1, z1) to (x2, z2). */
export interface ObstacleDef {
  id: string;
  name: string;
  verb: string;
  kind: 'log' | 'wall' | 'rope' | 'beam' | 'hedge' | 'stones' | 'fallen';
  level: number;
  xp: number;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** Chance to slip at the obstacle's level, falling to zero 15 levels above it (no xp, some damage). */
  fail?: number;
  /** A shortcut: crossed either way, not part of a lap. */
  shortcut?: boolean;
}

/**
 * The Brightwater Village course (Agility 1), east of the smithy. Laps run in order; finishing the
 * last obstacle after all the others gives the lap bonus.
 */
export const VILLAGE_COURSE: ObstacleDef[] = [
  { id: 'log', name: 'Log balance', verb: 'Walk across', kind: 'log', level: 1, xp: 6, x1: 80.5, z1: 74.5, x2: 85.5, z2: 74.5 },
  { id: 'wall', name: 'Low wall', verb: 'Climb over', kind: 'wall', level: 1, xp: 9, x1: 86.5, z1: 74.5, x2: 88.5, z2: 74.5 },
  { id: 'rope', name: 'Rope swing', verb: 'Swing across', kind: 'rope', level: 1, xp: 8, x1: 89.5, z1: 75.5, x2: 89.5, z2: 78.5 },
  { id: 'beam', name: 'Balance beam', verb: 'Balance along', kind: 'beam', level: 1, xp: 10, x1: 88.5, z1: 79.5, x2: 83.5, z2: 79.5, fail: 0.15 },
  { id: 'hedge', name: 'Hedge tunnel', verb: 'Squeeze through', kind: 'hedge', level: 1, xp: 7, x1: 81.5, z1: 78.5, x2: 81.5, z2: 75.5 },
];

/**
 * Agility shortcuts across the river (either direction): stepping stones in the south between the
 * Slime Meadows and the fields, and a fallen pine in the north between the meadows and the woods.
 */
export const SHORTCUTS: ObstacleDef[] = [
  { id: 'stones', name: 'Stepping stones', verb: 'Hop across', kind: 'stones', level: 10, xp: 14, x1: 36.5, z1: 80.5, x2: 42.5, z2: 80.5, fail: 0.12, shortcut: true },
  { id: 'fallen', name: 'Fallen pine', verb: 'Edge along', kind: 'fallen', level: 22, xp: 24, x1: 31.5, z1: 45.5, x2: 38.5, z2: 45.5, fail: 0.15, shortcut: true },
];

export const LAP_BONUS = 30;
/** Fleet of foot: each Agility level past 1 adds 0.2% walking speed, up to 8%. */
export function agilitySpeedBonus(level: number): number {
  return Math.min(0.08, Math.max(0, level - 1) * 0.002);
}
/** Crossing speed in tiles per second. */
export const CROSS_SPEED = 1.6;
/** Damage taken when slipping off an obstacle. */
export const SLIP_DAMAGE = 10;

export function slipChance(o: ObstacleDef, level: number): number {
  if (!o.fail) return 0;
  return Math.max(0, o.fail * (1 - (level - o.level) / 15));
}
