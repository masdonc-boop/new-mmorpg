import type { ItemId } from './items';

/** Crop ids are saved in patches, so the first three keep their earlier ids (docs/ORIGINALITY.md H10). */
export type CropId = 'potato' | 'onion' | 'cabbage' | 'bluebell';

/** Allotment crops. Growth runs on real time, even while away. */
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
  // Sunroot: the village staple, roasted on a range.
  potato: { id: 'potato', name: 'Sunroot', seed: 'potato_seed', produce: 'potato', level: 1, plantXp: 7, harvestXp: 8, stages: 4, stageMinutes: 9, color: '#5f9a3a' },
  // Wardleaf: a silvery herb burned as incense at the shrine and waystones.
  onion: { id: 'onion', name: 'Wardleaf', seed: 'onion_seed', produce: 'onion', level: 4, plantXp: 9, harvestXp: 10, stages: 4, stageMinutes: 10, color: '#a8c4b8' },
  // Glowcaps: pale mushrooms that glow faintly; slow to come up.
  cabbage: { id: 'cabbage', name: 'Glowcaps', seed: 'cabbage_seed', produce: 'cabbage', level: 8, plantXp: 11, harvestXp: 13, stages: 5, stageMinutes: 8, color: '#d8e8c8' },
  // Bluebell flax: the fibre the village spins into bowstrings.
  bluebell: { id: 'bluebell', name: 'Bluebell flax', seed: 'bluebell_seed', produce: 'flax', level: 12, plantXp: 13, harvestXp: 9, stages: 4, stageMinutes: 12, color: '#7fa8e8' },
};

/** Seeds per planting in an allotment. */
export const SEEDS_PER_PATCH = 2;
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
