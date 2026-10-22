import type { ItemId } from './items';
import type { ToolCategory } from './tools';
import type { SkillId } from './skills';

export type ResourceType = 'tree' | 'oak' | 'willow' | 'rowan' | 'mire_pool' | 'silver_vein' | 'copper_rock' | 'tin_rock' | 'iron_rock' | 'coal_rock' | 'glimmerite_rock' | 'duskiron_slag' | 'ember_vent' | 'spark_quartz_rock' | 'net_spot' | 'flax' | 'bakery_stall' | 'seed_stall' | 'ice_chest' | 'rod_spot' | 'warm_spring';

export interface ResourceDef {
  id: ResourceType;
  name: string;
  skill: Extract<SkillId, 'woodcutting' | 'mining' | 'fishing' | 'crafting' | 'thieving'>;
  levelReq: number;
  xp: number;
  item: ItemId;
  /** Tool category needed (any tool of that category in the bag or toolbelt; the best usable one counts). None for flax. */
  tool?: ToolCategory;
  /** Success chance per action at the level requirement; grows with level. */
  baseChance: number;
  /** Chance the node depletes after each successful gather. */
  depleteChance: number;
  respawnSeconds: number;
  actionSeconds: number;
  rareDrop?: { item: ItemId; chance: number };
  /** Better catches at higher levels: each eligible one replaces the base item with this chance. */
  catches?: { item: ItemId; level: number; xp: number; chance: number }[];
}

export const RESOURCES: Record<ResourceType, ResourceDef> = {
  tree: { id: 'tree', name: 'Tree', skill: 'woodcutting', levelReq: 1, xp: 22, item: 'logs', tool: 'axe', baseChance: 0.55, depleteChance: 0.25, respawnSeconds: 12, actionSeconds: 1.8 },
  oak: { id: 'oak', name: 'Oak tree', skill: 'woodcutting', levelReq: 12, xp: 34, item: 'oak_logs', tool: 'axe', baseChance: 0.4, depleteChance: 0.15, respawnSeconds: 20, actionSeconds: 1.8 },
  copper_rock: { id: 'copper_rock', name: 'Copper rock', skill: 'mining', levelReq: 1, xp: 16, item: 'copper_ore', tool: 'pickaxe', baseChance: 0.55, depleteChance: 0.5, respawnSeconds: 8, actionSeconds: 1.8, rareDrop: { item: 'sapphire', chance: 0.008 } },
  tin_rock: { id: 'tin_rock', name: 'Tin rock', skill: 'mining', levelReq: 1, xp: 16, item: 'tin_ore', tool: 'pickaxe', baseChance: 0.55, depleteChance: 0.5, respawnSeconds: 8, actionSeconds: 1.8, rareDrop: { item: 'sapphire', chance: 0.008 } },
  coal_rock: { id: 'coal_rock', name: 'Coal rock', skill: 'mining', levelReq: 24, xp: 42, item: 'coal_ore', tool: 'pickaxe', baseChance: 0.3, depleteChance: 0.6, respawnSeconds: 30, actionSeconds: 1.8, rareDrop: { item: 'sapphire', chance: 0.015 } },
  // Glimmerite: Brightwater's own metal, from the deepest Ironcrag veins (Mining 40).
  glimmerite_rock: { id: 'glimmerite_rock', name: 'Glimmerite vein', skill: 'mining', levelReq: 40, xp: 65, item: 'glimmerite_ore', tool: 'pickaxe', baseChance: 0.25, depleteChance: 0.7, respawnSeconds: 45, actionSeconds: 1.8 },
  // Duskiron: picked from the slag heaps of the Goblin Encampment (dangerous ground; Mining 55).
  duskiron_slag: { id: 'duskiron_slag', name: 'Duskiron slag heap', skill: 'mining', levelReq: 55, xp: 90, item: 'duskiron_ore', tool: 'pickaxe', baseChance: 0.2, depleteChance: 0.75, respawnSeconds: 60, actionSeconds: 1.8 },
  // Emberglass: cooled glass at the encampment's old fire-vents (Mining 35).
  ember_vent: { id: 'ember_vent', name: 'Ember vent', skill: 'mining', levelReq: 35, xp: 45, item: 'emberglass_shard', tool: 'pickaxe', baseChance: 0.3, depleteChance: 0.6, respawnSeconds: 30, actionSeconds: 1.8 },
  // Spark quartz: the crystal behind Brightwater's magic (chipped, then charged at a shrine).
  spark_quartz_rock: { id: 'spark_quartz_rock', name: 'Spark quartz', skill: 'mining', levelReq: 5, xp: 14, item: 'spark_quartz', tool: 'pickaxe', baseChance: 0.5, depleteChance: 0.45, respawnSeconds: 7, actionSeconds: 1.8 },
  // Wild bluebell flax: picking needs no tool and gives no experience; Crafting turns it into bowstrings.
  flax: { id: 'flax', name: 'Bluebell flax', skill: 'crafting', levelReq: 1, xp: 0, item: 'flax', baseChance: 1, depleteChance: 0.17, respawnSeconds: 6, actionSeconds: 1.2 },
  // Market stalls (Thieving): taking from one always works and empties it until it restocks.
  // Thieving stalls (ids kept so world state carries over: docs/ORIGINALITY.md H9).
  bakery_stall: { id: 'bakery_stall', name: 'Baker’s cart', skill: 'thieving', levelReq: 4, xp: 14, item: 'bread', baseChance: 1, depleteChance: 1, respawnSeconds: 3, actionSeconds: 1.2, catches: [{ item: 'baked_potato', level: 12, xp: 14, chance: 0.25 }] },
  seed_stall: { id: 'seed_stall', name: 'Seed barrow', skill: 'thieving', levelReq: 20, xp: 18, item: 'potato_seed', baseChance: 1, depleteChance: 1, respawnSeconds: 7, actionSeconds: 1.2, catches: [{ item: 'onion_seed', level: 20, xp: 18, chance: 0.35 }, { item: 'cabbage_seed', level: 20, xp: 18, chance: 0.25 }, { item: 'bluebell_seed', level: 20, xp: 18, chance: 0.2 }] },
  // The fishmonger's ice chest by the river: brightfin, and eels for the more practised hand.
  ice_chest: { id: 'ice_chest', name: 'Fishmonger’s ice chest', skill: 'thieving', levelReq: 14, xp: 24, item: 'raw_shrimps', baseChance: 1, depleteChance: 1, respawnSeconds: 5, actionSeconds: 1.2, catches: [{ item: 'raw_anchovies', level: 18, xp: 24, chance: 0.35 }] },
  // Shallows: brightfin from level 1; mudskipper eels from the muddy edges from level 12.
  // Clear pools upriver by the Whispering Woods: glass trout on a rod (slower, but a better fish).
  rod_spot: { id: 'rod_spot', name: 'Clear pool', skill: 'fishing', levelReq: 20, xp: 48, item: 'raw_glass_trout', tool: 'fishing_rod', baseChance: 0.38, depleteChance: 0, respawnSeconds: 0, actionSeconds: 3, rareDrop: { item: 'river_agate', chance: 0.02 } },
  // Warm springs high in the Ironcrag Hills: ember carp on a rod.
  warm_spring: { id: 'warm_spring', name: 'Warm spring', skill: 'fishing', levelReq: 35, xp: 70, item: 'raw_ember_carp', tool: 'fishing_rod', baseChance: 0.33, depleteChance: 0, respawnSeconds: 0, actionSeconds: 3.2 },
  net_spot: { id: 'net_spot', name: 'Fishing spot', skill: 'fishing', levelReq: 1, xp: 12, item: 'raw_shrimps', tool: 'small_net', baseChance: 0.5, depleteChance: 0, respawnSeconds: 0, actionSeconds: 2.4, rareDrop: { item: 'river_agate', chance: 0.012 }, catches: [{ item: 'raw_anchovies', level: 12, xp: 36, chance: 0.4 }] },
  // Mirefen Marsh (Phase 4A): willows by the pools, and silverpike in the still mire pools.
  willow: { id: 'willow', name: 'Willow tree', skill: 'woodcutting', levelReq: 25, xp: 52, item: 'willow_logs', tool: 'axe', baseChance: 0.36, depleteChance: 0.14, respawnSeconds: 24, actionSeconds: 1.8 },
  mire_pool: { id: 'mire_pool', name: 'Mire pool', skill: 'fishing', levelReq: 28, xp: 62, item: 'raw_silverpike', tool: 'fishing_rod', baseChance: 0.35, depleteChance: 0, respawnSeconds: 0, actionSeconds: 3, rareDrop: { item: 'marsh_pearl', chance: 0.015 } },
  // Thornridge Highlands (Phase 4A): silver in the crags.
  silver_vein: { id: 'silver_vein', name: 'Silver vein', skill: 'mining', levelReq: 30, xp: 48, item: 'silver_ore', tool: 'pickaxe', baseChance: 0.3, depleteChance: 0.6, respawnSeconds: 32, actionSeconds: 1.8, rareDrop: { item: 'sapphire', chance: 0.012 } },
  // Thornridge rowans (Phase 4B): the highest-tier wood (Woodcutting 40).
  rowan: { id: 'rowan', name: 'Rowan tree', skill: 'woodcutting', levelReq: 40, xp: 82, item: 'rowan_logs', tool: 'axe', baseChance: 0.3, depleteChance: 0.12, respawnSeconds: 32, actionSeconds: 1.8 },
  iron_rock: { id: 'iron_rock', name: 'Iron rock', skill: 'mining', levelReq: 12, xp: 32, item: 'iron_ore', tool: 'pickaxe', baseChance: 0.4, depleteChance: 0.6, respawnSeconds: 14, actionSeconds: 1.8, rareDrop: { item: 'sapphire', chance: 0.015 } },
};

/** Success chance per swing: grows with level and with the tool's tier (iron beats bronze). */
export function gatherChance(def: ResourceDef, level: number, toolTier = 1): number {
  return Math.min(0.95, def.baseChance + (level - def.levelReq) * 0.012 + (toolTier - 1) * 0.08);
}
