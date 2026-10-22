import type { ItemId } from './items';
import type { ToolCategory } from './tools';
import type { SkillId } from './skills';

/**
 * Where a recipe is made. 'fletching' and 'crafting' need no station (a knife on logs, a needle on
 * leather, anywhere); 'fire' is a campfire, which cooks the same recipes as a range.
 */
export type StationKind = 'furnace' | 'anvil' | 'range' | 'fire' | 'spinning_wheel' | 'fletching' | 'crafting';

/** Production done anywhere, with tools rather than at a station. */
export type AnywhereKind = Extract<StationKind, 'fletching' | 'crafting'>;
export function isAnywhere(kind: StationKind): kind is AnywhereKind {
  return kind === 'fletching' || kind === 'crafting';
}

export const STATION_INFO: Record<StationKind, { name: string; verb: string; doing: string; skill: SkillId; prompt: string }> = {
  furnace: { name: 'Furnace', verb: 'Smelt', doing: 'Smelting', skill: 'smithing', prompt: 'Smelt ore into bars' },
  anvil: { name: 'Anvil', verb: 'Forge', doing: 'Forging', skill: 'smithing', prompt: 'Forge gear (needs a hammer)' },
  range: { name: 'Cooking range', verb: 'Cook', doing: 'Cooking', skill: 'cooking', prompt: 'Cook fish and meat' },
  fire: { name: 'Campfire', verb: 'Cook', doing: 'Cooking', skill: 'cooking', prompt: 'Cook fish and meat' },
  spinning_wheel: { name: 'Spinning wheel', verb: 'Spin', doing: 'Spinning', skill: 'crafting', prompt: 'Spin flax into bowstrings' },
  fletching: { name: 'Fletching', verb: 'Fletch', doing: 'Fletching', skill: 'fletching', prompt: 'Use a knife on logs' },
  crafting: { name: 'Crafting', verb: 'Craft', doing: 'Crafting', skill: 'crafting', prompt: 'Use a needle on leather or a chisel on a gem' },
};

/** Whether a recipe can be made at a station of this kind (campfires cook what a range cooks). */
export function recipeAt(rec: RecipeDef, kind: StationKind): boolean {
  return rec.station === kind || (rec.station === 'range' && kind === 'fire');
}

/** "bronze bar" → "bronze bars" (names already plural, like "arrow shafts", are kept). */
export function plural(name: string, n: number): string {
  return n === 1 || name.endsWith('s') ? name : `${name}s`;
}

export interface RecipeDef {
  id: string;
  station: StationKind;
  skill: SkillId;
  level: number;
  /** Experience for each successful make (never for failures such as burnt food). */
  xp: number;
  inputs: { item: ItemId; qty: number }[];
  output: { item: ItemId; qty: number };
  /** Seconds per make. */
  seconds: number;
  /** Tool category needed in the bag or toolbelt (not used up), e.g. a hammer for forging. */
  tool?: ToolCategory;
  /**
   * Chance of failure (e.g. burning food) at the recipe's level, falling linearly to zero at
   * `failStopLevel`. A failure still uses the ingredients and gives `failOutput` instead.
   */
  fail?: { chance: number; stopLevel: number; output: ItemId };
}

const r = (d: RecipeDef) => d;

export const RECIPES: Record<string, RecipeDef> = {
  // ---- Smithing: furnace
  bronze_bar: r({ id: 'bronze_bar', station: 'furnace', skill: 'smithing', level: 1, xp: 8, inputs: [{ item: 'copper_ore', qty: 1 }, { item: 'tin_ore', qty: 1 }], output: { item: 'bronze_bar', qty: 1 }, seconds: 1.8 }),
  iron_bar: r({ id: 'iron_bar', station: 'furnace', skill: 'smithing', level: 12, xp: 20, inputs: [{ item: 'iron_ore', qty: 1 }], output: { item: 'iron_bar', qty: 1 }, seconds: 1.8 }),
  // Steel is iron refined a second time over coal: a bar of iron and a lump of coal.
  steel_bar: r({ id: 'steel_bar', station: 'furnace', skill: 'smithing', level: 26, xp: 24, inputs: [{ item: 'iron_bar', qty: 1 }, { item: 'coal_ore', qty: 1 }], output: { item: 'steel_bar', qty: 1 }, seconds: 1.8 }),
  // Glimsteel: smelt a hot bloom, then quench it in running water (see GameWorld.quench).
  glimsteel_bloom: r({ id: 'glimsteel_bloom', station: 'furnace', skill: 'smithing', level: 40, xp: 30, inputs: [{ item: 'glimmerite_ore', qty: 1 }, { item: 'coal_ore', qty: 2 }], output: { item: 'glimsteel_bloom', qty: 1 }, seconds: 1.8 }),
  // Duskiron only runs clean with a flux: slime gel from the meadow.
  duskiron_bar: r({ id: 'duskiron_bar', station: 'furnace', skill: 'smithing', level: 55, xp: 45, inputs: [{ item: 'duskiron_ore', qty: 1 }, { item: 'coal_ore', qty: 2 }, { item: 'slime_gel', qty: 1 }], output: { item: 'duskiron_bar', qty: 1 }, seconds: 1.8 }),
  // ---- Smithing: anvil
  bronze_dagger: r({ id: 'bronze_dagger', station: 'anvil', skill: 'smithing', level: 1, xp: 10, inputs: [{ item: 'bronze_bar', qty: 1 }], output: { item: 'bronze_dagger', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  bronze_helm: r({ id: 'bronze_helm', station: 'anvil', skill: 'smithing', level: 4, xp: 10, inputs: [{ item: 'bronze_bar', qty: 1 }], output: { item: 'bronze_helm', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  bronze_sword: r({ id: 'bronze_sword', station: 'anvil', skill: 'smithing', level: 5, xp: 10, inputs: [{ item: 'bronze_bar', qty: 1 }], output: { item: 'bronze_sword', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  bronze_shield: r({ id: 'bronze_shield', station: 'anvil', skill: 'smithing', level: 8, xp: 20, inputs: [{ item: 'bronze_bar', qty: 2 }], output: { item: 'bronze_shield', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  bronze_platelegs: r({ id: 'bronze_platelegs', station: 'anvil', skill: 'smithing', level: 10, xp: 20, inputs: [{ item: 'bronze_bar', qty: 2 }], output: { item: 'bronze_platelegs', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  bronze_platebody: r({ id: 'bronze_platebody', station: 'anvil', skill: 'smithing', level: 12, xp: 30, inputs: [{ item: 'bronze_bar', qty: 3 }], output: { item: 'bronze_platebody', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  bronze_axe: r({ id: 'bronze_axe', station: 'anvil', skill: 'smithing', level: 2, xp: 10, inputs: [{ item: 'bronze_bar', qty: 1 }], output: { item: 'bronze_axe', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  bronze_pickaxe: r({ id: 'bronze_pickaxe', station: 'anvil', skill: 'smithing', level: 6, xp: 20, inputs: [{ item: 'bronze_bar', qty: 2 }], output: { item: 'bronze_pickaxe', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  iron_axe: r({ id: 'iron_axe', station: 'anvil', skill: 'smithing', level: 14, xp: 22, inputs: [{ item: 'iron_bar', qty: 1 }], output: { item: 'iron_axe', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  iron_pickaxe: r({ id: 'iron_pickaxe', station: 'anvil', skill: 'smithing', level: 18, xp: 44, inputs: [{ item: 'iron_bar', qty: 2 }], output: { item: 'iron_pickaxe', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  bronze_nails: r({ id: 'bronze_nails', station: 'anvil', skill: 'smithing', level: 3, xp: 10, inputs: [{ item: 'bronze_bar', qty: 1 }], output: { item: 'bronze_nails', qty: 15 }, seconds: 2.4, tool: 'hammer' }),
  iron_nails: r({ id: 'iron_nails', station: 'anvil', skill: 'smithing', level: 15, xp: 22, inputs: [{ item: 'iron_bar', qty: 1 }], output: { item: 'iron_nails', qty: 15 }, seconds: 2.4, tool: 'hammer' }),
  steel_nails: r({ id: 'steel_nails', station: 'anvil', skill: 'smithing', level: 29, xp: 34, inputs: [{ item: 'steel_bar', qty: 1 }], output: { item: 'steel_nails', qty: 15 }, seconds: 2.4, tool: 'hammer' }),
  iron_helm: r({ id: 'iron_helm', station: 'anvil', skill: 'smithing', level: 16, xp: 22, inputs: [{ item: 'iron_bar', qty: 1 }], output: { item: 'iron_helm', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  iron_sword: r({ id: 'iron_sword', station: 'anvil', skill: 'smithing', level: 17, xp: 22, inputs: [{ item: 'iron_bar', qty: 1 }], output: { item: 'iron_sword', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  iron_shield: r({ id: 'iron_shield', station: 'anvil', skill: 'smithing', level: 20, xp: 44, inputs: [{ item: 'iron_bar', qty: 2 }], output: { item: 'iron_shield', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  iron_platelegs: r({ id: 'iron_platelegs', station: 'anvil', skill: 'smithing', level: 22, xp: 44, inputs: [{ item: 'iron_bar', qty: 2 }], output: { item: 'iron_platelegs', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  iron_platebody: r({ id: 'iron_platebody', station: 'anvil', skill: 'smithing', level: 24, xp: 66, inputs: [{ item: 'iron_bar', qty: 3 }], output: { item: 'iron_platebody', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  steel_dagger: r({ id: 'steel_dagger', station: 'anvil', skill: 'smithing', level: 27, xp: 34, inputs: [{ item: 'steel_bar', qty: 1 }], output: { item: 'steel_dagger', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  steel_axe: r({ id: 'steel_axe', station: 'anvil', skill: 'smithing', level: 28, xp: 34, inputs: [{ item: 'steel_bar', qty: 1 }], output: { item: 'steel_axe', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  steel_helm: r({ id: 'steel_helm', station: 'anvil', skill: 'smithing', level: 30, xp: 34, inputs: [{ item: 'steel_bar', qty: 1 }], output: { item: 'steel_helm', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  steel_sword: r({ id: 'steel_sword', station: 'anvil', skill: 'smithing', level: 31, xp: 34, inputs: [{ item: 'steel_bar', qty: 1 }], output: { item: 'steel_sword', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  steel_pickaxe: r({ id: 'steel_pickaxe', station: 'anvil', skill: 'smithing', level: 32, xp: 68, inputs: [{ item: 'steel_bar', qty: 2 }], output: { item: 'steel_pickaxe', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  steel_shield: r({ id: 'steel_shield', station: 'anvil', skill: 'smithing', level: 34, xp: 68, inputs: [{ item: 'steel_bar', qty: 2 }], output: { item: 'steel_shield', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  steel_platelegs: r({ id: 'steel_platelegs', station: 'anvil', skill: 'smithing', level: 36, xp: 68, inputs: [{ item: 'steel_bar', qty: 2 }], output: { item: 'steel_platelegs', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  steel_platebody: r({ id: 'steel_platebody', station: 'anvil', skill: 'smithing', level: 38, xp: 102, inputs: [{ item: 'steel_bar', qty: 3 }], output: { item: 'steel_platebody', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  glimsteel_dagger: r({ id: 'glimsteel_dagger', station: 'anvil', skill: 'smithing', level: 42, xp: 50, inputs: [{ item: 'glimsteel_bar', qty: 1 }], output: { item: 'glimsteel_dagger', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  glimsteel_axe: r({ id: 'glimsteel_axe', station: 'anvil', skill: 'smithing', level: 43, xp: 50, inputs: [{ item: 'glimsteel_bar', qty: 1 }], output: { item: 'glimsteel_axe', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  glimsteel_helm: r({ id: 'glimsteel_helm', station: 'anvil', skill: 'smithing', level: 45, xp: 50, inputs: [{ item: 'glimsteel_bar', qty: 1 }], output: { item: 'glimsteel_helm', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  glimsteel_sword: r({ id: 'glimsteel_sword', station: 'anvil', skill: 'smithing', level: 46, xp: 50, inputs: [{ item: 'glimsteel_bar', qty: 1 }], output: { item: 'glimsteel_sword', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  glimsteel_pickaxe: r({ id: 'glimsteel_pickaxe', station: 'anvil', skill: 'smithing', level: 47, xp: 100, inputs: [{ item: 'glimsteel_bar', qty: 2 }], output: { item: 'glimsteel_pickaxe', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  glimsteel_shield: r({ id: 'glimsteel_shield', station: 'anvil', skill: 'smithing', level: 50, xp: 100, inputs: [{ item: 'glimsteel_bar', qty: 2 }], output: { item: 'glimsteel_shield', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  glimsteel_platelegs: r({ id: 'glimsteel_platelegs', station: 'anvil', skill: 'smithing', level: 54, xp: 100, inputs: [{ item: 'glimsteel_bar', qty: 2 }], output: { item: 'glimsteel_platelegs', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  glimsteel_platebody: r({ id: 'glimsteel_platebody', station: 'anvil', skill: 'smithing', level: 58, xp: 150, inputs: [{ item: 'glimsteel_bar', qty: 3 }], output: { item: 'glimsteel_platebody', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  duskiron_helm: r({ id: 'duskiron_helm', station: 'anvil', skill: 'smithing', level: 56, xp: 70, inputs: [{ item: 'duskiron_bar', qty: 1 }], output: { item: 'duskiron_helm', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  duskiron_warhammer: r({ id: 'duskiron_warhammer', station: 'anvil', skill: 'smithing', level: 60, xp: 140, inputs: [{ item: 'duskiron_bar', qty: 2 }], output: { item: 'duskiron_warhammer', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  duskiron_shield: r({ id: 'duskiron_shield', station: 'anvil', skill: 'smithing', level: 63, xp: 140, inputs: [{ item: 'duskiron_bar', qty: 2 }], output: { item: 'duskiron_shield', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  duskiron_platelegs: r({ id: 'duskiron_platelegs', station: 'anvil', skill: 'smithing', level: 67, xp: 140, inputs: [{ item: 'duskiron_bar', qty: 2 }], output: { item: 'duskiron_platelegs', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  duskiron_platebody: r({ id: 'duskiron_platebody', station: 'anvil', skill: 'smithing', level: 72, xp: 210, inputs: [{ item: 'duskiron_bar', qty: 3 }], output: { item: 'duskiron_platebody', qty: 1 }, seconds: 2.4, tool: 'hammer' }),
  // ---- Fletching (knife on logs, anywhere)
  arrow_shafts: r({ id: 'arrow_shafts', station: 'fletching', skill: 'fletching', level: 1, xp: 6, inputs: [{ item: 'logs', qty: 1 }], output: { item: 'arrow_shafts', qty: 12 }, seconds: 1.5, tool: 'knife' }),
  bronze_arrow: r({ id: 'bronze_arrow', station: 'fletching', skill: 'fletching', level: 2, xp: 18, inputs: [{ item: 'arrow_shafts', qty: 12 }, { item: 'bronze_bar', qty: 1 }], output: { item: 'bronze_arrow', qty: 12 }, seconds: 1.5 }),
  shortbow_u: r({ id: 'shortbow_u', station: 'fletching', skill: 'fletching', level: 4, xp: 7, inputs: [{ item: 'logs', qty: 1 }], output: { item: 'shortbow_u', qty: 1 }, seconds: 1.5, tool: 'knife' }),
  shortbow: r({ id: 'shortbow', station: 'fletching', skill: 'fletching', level: 4, xp: 7, inputs: [{ item: 'shortbow_u', qty: 1 }, { item: 'bowstring', qty: 1 }], output: { item: 'shortbow', qty: 1 }, seconds: 1.2 }),
  riverwood_wand: r({ id: 'riverwood_wand', station: 'fletching', skill: 'fletching', level: 10, xp: 20, inputs: [{ item: 'logs', qty: 1 }, { item: 'dull_spark', qty: 4 }], output: { item: 'riverwood_wand', qty: 1 }, seconds: 1.8, tool: 'knife' }),
  wooden_shield: r({ id: 'wooden_shield', station: 'fletching', skill: 'fletching', level: 7, xp: 15, inputs: [{ item: 'logs', qty: 2 }], output: { item: 'wooden_shield', qty: 1 }, seconds: 1.5, tool: 'knife' }),
  oak_shortbow_u: r({ id: 'oak_shortbow_u', station: 'fletching', skill: 'fletching', level: 16, xp: 19, inputs: [{ item: 'oak_logs', qty: 1 }], output: { item: 'oak_shortbow_u', qty: 1 }, seconds: 1.5, tool: 'knife' }),
  oak_shortbow: r({ id: 'oak_shortbow', station: 'fletching', skill: 'fletching', level: 16, xp: 19, inputs: [{ item: 'oak_shortbow_u', qty: 1 }, { item: 'bowstring', qty: 1 }], output: { item: 'oak_shortbow', qty: 1 }, seconds: 1.2 }),
  // ---- Crafting (needle and thread on leather; chisel on gems; flax at the spinning wheel)
  // Wolfhide set (recipe ids kept). The jerkin and breeches take two hides.
  leather_gloves: r({ id: 'leather_gloves', station: 'crafting', skill: 'crafting', level: 1, xp: 12, inputs: [{ item: 'leather', qty: 1 }, { item: 'thread', qty: 1 }], output: { item: 'leather_gloves', qty: 1 }, seconds: 1.8, tool: 'needle' }),
  leather_boots: r({ id: 'leather_boots', station: 'crafting', skill: 'crafting', level: 3, xp: 15, inputs: [{ item: 'leather', qty: 1 }, { item: 'thread', qty: 1 }], output: { item: 'leather_boots', qty: 1 }, seconds: 1.8, tool: 'needle' }),
  fang_amulet: r({ id: 'fang_amulet', station: 'crafting', skill: 'crafting', level: 4, xp: 15, inputs: [{ item: 'wolf_fang', qty: 1 }, { item: 'thread', qty: 1 }], output: { item: 'fang_amulet', qty: 1 }, seconds: 1.8, tool: 'needle' }),
  leather_cowl: r({ id: 'leather_cowl', station: 'crafting', skill: 'crafting', level: 6, xp: 18, inputs: [{ item: 'leather', qty: 1 }, { item: 'thread', qty: 1 }], output: { item: 'leather_cowl', qty: 1 }, seconds: 1.8, tool: 'needle' }),
  leather_chaps: r({ id: 'leather_chaps', station: 'crafting', skill: 'crafting', level: 9, xp: 34, inputs: [{ item: 'leather', qty: 2 }, { item: 'thread', qty: 2 }], output: { item: 'leather_chaps', qty: 1 }, seconds: 1.8, tool: 'needle' }),
  bowstring: r({ id: 'bowstring', station: 'spinning_wheel', skill: 'crafting', level: 6, xp: 12, inputs: [{ item: 'flax', qty: 1 }], output: { item: 'bowstring', qty: 1 }, seconds: 1.8 }),
  leather_vambraces: r({ id: 'leather_vambraces', station: 'crafting', skill: 'crafting', level: 12, xp: 22, inputs: [{ item: 'leather', qty: 1 }, { item: 'thread', qty: 1 }], output: { item: 'leather_vambraces', qty: 1 }, seconds: 1.8, tool: 'needle' }),
  leather_body: r({ id: 'leather_body', station: 'crafting', skill: 'crafting', level: 15, xp: 44, inputs: [{ item: 'leather', qty: 2 }, { item: 'thread', qty: 2 }], output: { item: 'leather_body', qty: 1 }, seconds: 1.8, tool: 'needle' }),
  // Seal a jerkin with slime gel (the slimes' one gift to the village).
  sealed_jerkin: r({ id: 'sealed_jerkin', station: 'crafting', skill: 'crafting', level: 20, xp: 38, inputs: [{ item: 'leather_body', qty: 1 }, { item: 'slime_gel', qty: 3 }], output: { item: 'sealed_jerkin', qty: 1 }, seconds: 2.2, tool: 'needle' }),
  dull_spark: r({ id: 'dull_spark', station: 'crafting', skill: 'crafting', level: 1, xp: 6, inputs: [{ item: 'spark_quartz', qty: 1 }], output: { item: 'dull_spark', qty: 8 }, seconds: 1.5, tool: 'chisel' }),
  emberglass_wand: r({ id: 'emberglass_wand', station: 'crafting', skill: 'crafting', level: 35, xp: 70, inputs: [{ item: 'emberglass_shard', qty: 2 }, { item: 'oak_logs', qty: 1 }], output: { item: 'emberglass_wand', qty: 1 }, seconds: 2.4, tool: 'chisel' }),
  cut_sapphire: r({ id: 'cut_sapphire', station: 'crafting', skill: 'crafting', level: 20, xp: 50, inputs: [{ item: 'sapphire', qty: 1 }], output: { item: 'cut_sapphire', qty: 1 }, seconds: 1.8, tool: 'chisel' }),
  // ---- Cooking
  // Brightfin (recipe id kept for saves and offers in progress).
  shrimps: r({ id: 'shrimps', station: 'range', skill: 'cooking', level: 1, xp: 28, inputs: [{ item: 'raw_shrimps', qty: 1 }], output: { item: 'shrimps', qty: 1 }, seconds: 1.8, fail: { chance: 0.32, stopLevel: 16, output: 'burnt_fish' } }),
  cooked_meat: r({ id: 'cooked_meat', station: 'range', skill: 'cooking', level: 1, xp: 32, inputs: [{ item: 'raw_meat', qty: 1 }], output: { item: 'cooked_meat', qty: 1 }, seconds: 1.8, fail: { chance: 0.3, stopLevel: 22, output: 'burnt_meat' } }),
  // Roasted sunroot (recipe id kept for saves).
  baked_potato: r({ id: 'baked_potato', station: 'range', skill: 'cooking', level: 5, xp: 24, inputs: [{ item: 'potato', qty: 1 }], output: { item: 'baked_potato', qty: 1 }, seconds: 2, fail: { chance: 0.3, stopLevel: 26, output: 'burnt_potato' } }),
  // Mudskipper eel: smoked slowly over the coals.
  anchovies: r({ id: 'anchovies', station: 'range', skill: 'cooking', level: 12, xp: 42, inputs: [{ item: 'raw_anchovies', qty: 1 }], output: { item: 'anchovies', qty: 1 }, seconds: 2.2, fail: { chance: 0.38, stopLevel: 30, output: 'burnt_fish' } }),
};

export function recipesFor(station: StationKind): RecipeDef[] {
  return Object.values(RECIPES).filter((x) => recipeAt(x, station));
}

export function failChance(rec: RecipeDef, level: number): number {
  if (!rec.fail) return 0;
  const span = Math.max(1, rec.fail.stopLevel - rec.level);
  return Math.max(0, rec.fail.chance * (1 - (level - rec.level) / span));
}

/**
 * "Use X on Y" combinations that open a production interface (either order works), e.g. a knife on
 * logs opens fletching.
 */
export const USE_COMBOS: { a: ItemId; b: ItemId[]; opens: AnywhereKind }[] = [
  { a: 'knife', b: ['logs', 'oak_logs'], opens: 'fletching' },
  { a: 'bowstring', b: ['shortbow_u', 'oak_shortbow_u'], opens: 'fletching' },
  { a: 'arrow_shafts', b: ['bronze_bar'], opens: 'fletching' },
  { a: 'needle', b: ['leather', 'wolf_fang', 'leather_body'], opens: 'crafting' },
  { a: 'chisel', b: ['sapphire', 'spark_quartz', 'emberglass_shard'], opens: 'crafting' },
];

export function useCombo(x: ItemId, y: ItemId): AnywhereKind | null {
  for (const c of USE_COMBOS) if ((c.a === x && c.b.includes(y)) || (c.a === y && c.b.includes(x))) return c.opens;
  return null;
}

/** Whether an item takes part in any "use" combination (so the bag shows a Use button). */
export function usable(item: ItemId): boolean {
  return USE_COMBOS.some((c) => c.a === item || c.b.includes(item));
}
