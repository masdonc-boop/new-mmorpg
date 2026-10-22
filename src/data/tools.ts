import type { SkillId } from './skills';

/** Toolbelt categories. Each holds one tool; a tool's category comes from its item definition. */
export type ToolCategory = 'pickaxe' | 'axe' | 'hammer' | 'knife' | 'tinderbox' | 'needle' | 'chisel' | 'saw' | 'small_net' | 'fishing_rod' | 'rake' | 'seed_dibber' | 'spade';

export interface ToolSlotDef {
  id: ToolCategory;
  label: string;
  skill: string;
  /** False while no tool of this kind exists in the game yet (the slot is shown but locked). */
  available: boolean;
  note?: string;
}

export const TOOL_SLOTS: ToolSlotDef[] = [
  { id: 'pickaxe', label: 'Pickaxe', skill: 'Mining', available: true },
  { id: 'axe', label: 'Axe', skill: 'Woodcutting', available: true },
  { id: 'hammer', label: 'Hammer', skill: 'Smithing', available: true },
  { id: 'knife', label: 'Knife', skill: 'Fletching', available: true },
  { id: 'small_net', label: 'Small net', skill: 'Fishing', available: true },
  { id: 'tinderbox', label: 'Tinderbox', skill: 'Firemaking', available: true },
  { id: 'needle', label: 'Needle', skill: 'Crafting', available: true },
  { id: 'chisel', label: 'Chisel', skill: 'Crafting', available: true },
  { id: 'fishing_rod', label: 'Fishing rod', skill: 'Fishing', available: false, note: 'Rod fishing is not in the game yet.' },
  { id: 'saw', label: 'Saw', skill: 'Construction', available: true },
  { id: 'rake', label: 'Rake', skill: 'Farming', available: true },
  { id: 'seed_dibber', label: 'Seed dibber', skill: 'Farming', available: true },
  { id: 'spade', label: 'Spade', skill: 'Farming', available: true },
];

/** Tool data on an item: its toolbelt category, tier (better tools work faster) and use requirement. */
export interface ToolInfo {
  category: ToolCategory;
  tier: number;
  req?: { skill: SkillId; level: number };
}

export function toolLabel(c: ToolCategory): string {
  return TOOL_SLOTS.find((t) => t.id === c)?.label ?? c;
}
