import type { ItemId } from './items';
import type { SkillId } from './skills';

/** Where a recipe is made. 'fletching' needs no station: a knife-and-lap job anywhere. */
export type StationKind = 'furnace' | 'anvil' | 'range' | 'fletching';

export const STATION_INFO: Record<StationKind, { name: string; verb: string; doing: string; skill: SkillId }> = {
  furnace: { name: 'Furnace', verb: 'Smelt', doing: 'Smelting', skill: 'smithing' },
  anvil: { name: 'Anvil', verb: 'Forge', doing: 'Forging', skill: 'smithing' },
  range: { name: 'Cooking range', verb: 'Cook', doing: 'Cooking', skill: 'cooking' },
  fletching: { name: 'Fletching', verb: 'Fletch', doing: 'Fletching', skill: 'fletching' },
};

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
  /**
   * Chance of failure (e.g. burning food) at the recipe's level, falling linearly to zero at
   * `failStopLevel`. A failure still uses the ingredients and gives `failOutput` instead.
   */
  fail?: { chance: number; stopLevel: number; output: ItemId };
}

const r = (d: RecipeDef) => d;

export const RECIPES: Record<string, RecipeDef> = {
  // ---- Smithing: furnace
  bronze_bar: r({ id: 'bronze_bar', station: 'furnace', skill: 'smithing', level: 1, xp: 12, inputs: [{ item: 'copper_ore', qty: 1 }, { item: 'tin_ore', qty: 1 }], output: { item: 'bronze_bar', qty: 1 }, seconds: 1.8 }),
  iron_bar: r({ id: 'iron_bar', station: 'furnace', skill: 'smithing', level: 15, xp: 25, inputs: [{ item: 'iron_ore', qty: 1 }], output: { item: 'iron_bar', qty: 1 }, seconds: 1.8 }),
  // ---- Smithing: anvil
  bronze_dagger: r({ id: 'bronze_dagger', station: 'anvil', skill: 'smithing', level: 1, xp: 12, inputs: [{ item: 'bronze_bar', qty: 1 }], output: { item: 'bronze_dagger', qty: 1 }, seconds: 2.4 }),
  bronze_helm: r({ id: 'bronze_helm', station: 'anvil', skill: 'smithing', level: 3, xp: 12, inputs: [{ item: 'bronze_bar', qty: 1 }], output: { item: 'bronze_helm', qty: 1 }, seconds: 2.4 }),
  bronze_sword: r({ id: 'bronze_sword', station: 'anvil', skill: 'smithing', level: 4, xp: 12, inputs: [{ item: 'bronze_bar', qty: 1 }], output: { item: 'bronze_sword', qty: 1 }, seconds: 2.4 }),
  bronze_shield: r({ id: 'bronze_shield', station: 'anvil', skill: 'smithing', level: 8, xp: 25, inputs: [{ item: 'bronze_bar', qty: 2 }], output: { item: 'bronze_shield', qty: 1 }, seconds: 2.4 }),
  bronze_platelegs: r({ id: 'bronze_platelegs', station: 'anvil', skill: 'smithing', level: 10, xp: 25, inputs: [{ item: 'bronze_bar', qty: 2 }], output: { item: 'bronze_platelegs', qty: 1 }, seconds: 2.4 }),
  bronze_platebody: r({ id: 'bronze_platebody', station: 'anvil', skill: 'smithing', level: 12, xp: 38, inputs: [{ item: 'bronze_bar', qty: 3 }], output: { item: 'bronze_platebody', qty: 1 }, seconds: 2.4 }),
  iron_helm: r({ id: 'iron_helm', station: 'anvil', skill: 'smithing', level: 18, xp: 25, inputs: [{ item: 'iron_bar', qty: 1 }], output: { item: 'iron_helm', qty: 1 }, seconds: 2.4 }),
  iron_sword: r({ id: 'iron_sword', station: 'anvil', skill: 'smithing', level: 19, xp: 25, inputs: [{ item: 'iron_bar', qty: 1 }], output: { item: 'iron_sword', qty: 1 }, seconds: 2.4 }),
  iron_shield: r({ id: 'iron_shield', station: 'anvil', skill: 'smithing', level: 23, xp: 50, inputs: [{ item: 'iron_bar', qty: 2 }], output: { item: 'iron_shield', qty: 1 }, seconds: 2.4 }),
  iron_platelegs: r({ id: 'iron_platelegs', station: 'anvil', skill: 'smithing', level: 26, xp: 50, inputs: [{ item: 'iron_bar', qty: 2 }], output: { item: 'iron_platelegs', qty: 1 }, seconds: 2.4 }),
  iron_platebody: r({ id: 'iron_platebody', station: 'anvil', skill: 'smithing', level: 30, xp: 75, inputs: [{ item: 'iron_bar', qty: 3 }], output: { item: 'iron_platebody', qty: 1 }, seconds: 2.4 }),
  // ---- Fletching (anywhere)
  arrow_shafts: r({ id: 'arrow_shafts', station: 'fletching', skill: 'fletching', level: 1, xp: 5, inputs: [{ item: 'logs', qty: 1 }], output: { item: 'arrow_shafts', qty: 15 }, seconds: 1.5 }),
  bronze_arrow: r({ id: 'bronze_arrow', station: 'fletching', skill: 'fletching', level: 3, xp: 20, inputs: [{ item: 'arrow_shafts', qty: 15 }, { item: 'bronze_bar', qty: 1 }], output: { item: 'bronze_arrow', qty: 15 }, seconds: 1.5 }),
  shortbow: r({ id: 'shortbow', station: 'fletching', skill: 'fletching', level: 5, xp: 10, inputs: [{ item: 'logs', qty: 1 }], output: { item: 'shortbow', qty: 1 }, seconds: 1.5 }),
  wooden_shield: r({ id: 'wooden_shield', station: 'fletching', skill: 'fletching', level: 8, xp: 16, inputs: [{ item: 'logs', qty: 2 }], output: { item: 'wooden_shield', qty: 1 }, seconds: 1.5 }),
  oak_shortbow: r({ id: 'oak_shortbow', station: 'fletching', skill: 'fletching', level: 20, xp: 17, inputs: [{ item: 'oak_logs', qty: 1 }], output: { item: 'oak_shortbow', qty: 1 }, seconds: 1.5 }),
  // ---- Cooking
  cooked_meat: r({ id: 'cooked_meat', station: 'range', skill: 'cooking', level: 1, xp: 30, inputs: [{ item: 'raw_meat', qty: 1 }], output: { item: 'cooked_meat', qty: 1 }, seconds: 1.8, fail: { chance: 0.4, stopLevel: 20, output: 'burnt_meat' } }),
};

export function recipesFor(station: StationKind): RecipeDef[] {
  return Object.values(RECIPES).filter((x) => x.station === station);
}

export function failChance(rec: RecipeDef, level: number): number {
  if (!rec.fail) return 0;
  const span = Math.max(1, rec.fail.stopLevel - rec.level);
  return Math.max(0, rec.fail.chance * (1 - (level - rec.level) / span));
}
