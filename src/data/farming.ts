import type { ItemId } from './items';

export type CropId = 'potato' | 'onion' | 'cabbage';

/** Allotment crops (OSRS levels and experience). Growth runs on real time, even while away. */
export interface CropDef {
  id: CropId;
  name: string;
  seed: ItemId;
  produce: ItemId;
  level: number;
  plantXp: number;
  harvestXp: number;
  /** Growth stages before it can be harvested, and real minutes per stage. */
  stages: number;
  stageMinutes: number;
  color: string;
}

export const CROPS: Record<CropId, CropDef> = {
  potato: { id: 'potato', name: 'Potatoes', seed: 'potato_seed', produce: 'potato', level: 1, plantXp: 8, harvestXp: 9, stages: 4, stageMinutes: 10, color: '#4f8f3a' },
  onion: { id: 'onion', name: 'Onions', seed: 'onion_seed', produce: 'onion', level: 5, plantXp: 9.5, harvestXp: 10.5, stages: 4, stageMinutes: 10, color: '#7fae4a' },
  cabbage: { id: 'cabbage', name: 'Cabbages', seed: 'cabbage_seed', produce: 'cabbage', level: 7, plantXp: 10, harvestXp: 11.5, stages: 4, stageMinutes: 10, color: '#8fc45a' },
};

/** Seeds per planting in an allotment (OSRS: 3). */
export const SEEDS_PER_PATCH = 3;
/** Harvest "lives": each pick may use one up (less often at higher levels); at zero the patch is bare. */
export const PATCH_LIVES = 3;
/** Untended empty patches grow a level of weeds this often (up to 3). */
export const WEED_MINUTES = 5;
export const MAX_WEEDS = 3;
export const RAKE_XP = 4;

/** Chance a harvest pick uses up a life: about 1 in 3 at level 1, falling slowly with level. */
export function lifeLossChance(level: number): number {
  return Math.max(0.12, 0.35 - level * 0.004);
}

export function cropForSeed(seed: ItemId): CropDef | undefined {
  return Object.values(CROPS).find((c) => c.seed === seed);
}
