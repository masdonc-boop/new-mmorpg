import type { ItemId } from './items';
import type { SkillId } from './skills';

export type ResourceType = 'tree' | 'oak' | 'copper_rock' | 'tin_rock' | 'iron_rock';

export interface ResourceDef {
  id: ResourceType;
  name: string;
  skill: Extract<SkillId, 'woodcutting' | 'mining'>;
  levelReq: number;
  xp: number;
  item: ItemId;
  tool: ItemId;
  /** Success chance per action at the level requirement; grows with level. */
  baseChance: number;
  /** Chance the node depletes after each successful gather. */
  depleteChance: number;
  respawnSeconds: number;
  actionSeconds: number;
  rareDrop?: { item: ItemId; chance: number };
}

export const RESOURCES: Record<ResourceType, ResourceDef> = {
  tree: { id: 'tree', name: 'Tree', skill: 'woodcutting', levelReq: 1, xp: 25, item: 'logs', tool: 'bronze_axe', baseChance: 0.55, depleteChance: 0.25, respawnSeconds: 12, actionSeconds: 1.8 },
  oak: { id: 'oak', name: 'Oak tree', skill: 'woodcutting', levelReq: 15, xp: 38, item: 'oak_logs', tool: 'bronze_axe', baseChance: 0.4, depleteChance: 0.15, respawnSeconds: 20, actionSeconds: 1.8 },
  copper_rock: { id: 'copper_rock', name: 'Copper rock', skill: 'mining', levelReq: 1, xp: 18, item: 'copper_ore', tool: 'bronze_pickaxe', baseChance: 0.55, depleteChance: 0.5, respawnSeconds: 8, actionSeconds: 1.8, rareDrop: { item: 'sapphire', chance: 0.01 } },
  tin_rock: { id: 'tin_rock', name: 'Tin rock', skill: 'mining', levelReq: 1, xp: 18, item: 'tin_ore', tool: 'bronze_pickaxe', baseChance: 0.55, depleteChance: 0.5, respawnSeconds: 8, actionSeconds: 1.8, rareDrop: { item: 'sapphire', chance: 0.01 } },
  iron_rock: { id: 'iron_rock', name: 'Iron rock', skill: 'mining', levelReq: 15, xp: 35, item: 'iron_ore', tool: 'bronze_pickaxe', baseChance: 0.4, depleteChance: 0.6, respawnSeconds: 14, actionSeconds: 1.8, rareDrop: { item: 'sapphire', chance: 0.02 } },
};

export function gatherChance(def: ResourceDef, level: number): number {
  return Math.min(0.95, def.baseChance + (level - def.levelReq) * 0.012);
}
