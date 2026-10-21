import type { ItemId } from './items';
import type { ToolCategory } from './tools';
import type { SkillId } from './skills';

export type ResourceType = 'tree' | 'oak' | 'copper_rock' | 'tin_rock' | 'iron_rock' | 'coal_rock' | 'net_spot' | 'flax';

export interface ResourceDef {
  id: ResourceType;
  name: string;
  skill: Extract<SkillId, 'woodcutting' | 'mining' | 'fishing' | 'crafting'>;
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
  tree: { id: 'tree', name: 'Tree', skill: 'woodcutting', levelReq: 1, xp: 25, item: 'logs', tool: 'axe', baseChance: 0.55, depleteChance: 0.25, respawnSeconds: 12, actionSeconds: 1.8 },
  oak: { id: 'oak', name: 'Oak tree', skill: 'woodcutting', levelReq: 15, xp: 38, item: 'oak_logs', tool: 'axe', baseChance: 0.4, depleteChance: 0.15, respawnSeconds: 20, actionSeconds: 1.8 },
  copper_rock: { id: 'copper_rock', name: 'Copper rock', skill: 'mining', levelReq: 1, xp: 18, item: 'copper_ore', tool: 'pickaxe', baseChance: 0.55, depleteChance: 0.5, respawnSeconds: 8, actionSeconds: 1.8, rareDrop: { item: 'sapphire', chance: 0.01 } },
  tin_rock: { id: 'tin_rock', name: 'Tin rock', skill: 'mining', levelReq: 1, xp: 18, item: 'tin_ore', tool: 'pickaxe', baseChance: 0.55, depleteChance: 0.5, respawnSeconds: 8, actionSeconds: 1.8, rareDrop: { item: 'sapphire', chance: 0.01 } },
  coal_rock: { id: 'coal_rock', name: 'Coal rock', skill: 'mining', levelReq: 30, xp: 50, item: 'coal_ore', tool: 'pickaxe', baseChance: 0.3, depleteChance: 0.6, respawnSeconds: 30, actionSeconds: 1.8, rareDrop: { item: 'sapphire', chance: 0.02 } },
  // Picking flax needs no tool and gives no experience (as in OSRS); Crafting turns it into bowstrings.
  flax: { id: 'flax', name: 'Flax', skill: 'crafting', levelReq: 1, xp: 0, item: 'flax', baseChance: 1, depleteChance: 0.17, respawnSeconds: 6, actionSeconds: 1.2 },
  net_spot: { id: 'net_spot', name: 'Fishing spot', skill: 'fishing', levelReq: 1, xp: 10, item: 'raw_shrimps', tool: 'small_net', baseChance: 0.5, depleteChance: 0, respawnSeconds: 0, actionSeconds: 2.4, catches: [{ item: 'raw_anchovies', level: 15, xp: 40, chance: 0.45 }] },
  iron_rock: { id: 'iron_rock', name: 'Iron rock', skill: 'mining', levelReq: 15, xp: 35, item: 'iron_ore', tool: 'pickaxe', baseChance: 0.4, depleteChance: 0.6, respawnSeconds: 14, actionSeconds: 1.8, rareDrop: { item: 'sapphire', chance: 0.02 } },
};

/** Success chance per swing: grows with level and with the tool's tier (iron beats bronze). */
export function gatherChance(def: ResourceDef, level: number, toolTier = 1): number {
  return Math.min(0.95, def.baseChance + (level - def.levelReq) * 0.012 + (toolTier - 1) * 0.08);
}
