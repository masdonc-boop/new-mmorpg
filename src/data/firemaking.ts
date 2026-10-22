import type { ItemId } from './items';

/** Logs that can be lit, with the Firemaking level needed and the experience for each fire. */
export const FIRE_LOGS: Partial<Record<ItemId, { level: number; xp: number }>> = {
  logs: { level: 1, xp: 30 },
  oak_logs: { level: 12, xp: 48 },
};

/** Seconds per attempt to light (keep trying until it catches). */
export const LIGHT_SECONDS = 1.2;

/** A fire burns for a random time in this range (seconds), then leaves ashes. */
export const FIRE_LIFE = { min: 60, max: 120 };

/** Chance each attempt catches: about half at the log's level, certain 22 levels above it. */
export function lightChance(level: number, req: number): number {
  return Math.min(1, 0.45 + Math.max(0, level - req) * 0.025);
}
