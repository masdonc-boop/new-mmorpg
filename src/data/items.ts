export type IconShape =
  | 'log'
  | 'ore'
  | 'coins'
  | 'arrow'
  | 'gel'
  | 'pelt'
  | 'bone'
  | 'bread'
  | 'axe'
  | 'pickaxe'
  | 'fang'
  | 'gem'
  | 'rune';

export interface ItemDef {
  id: string;
  name: string;
  examine: string;
  /**
   * Stackable items share one slot up to maxStack (coins, ammo, runes). Everything else, including
   * primary gathered resources (logs, ores, gems, fish), takes one inventory slot per item.
   */
  stackable: boolean;
  maxStack: number;
  kind: 'material' | 'tool' | 'food' | 'ammo' | 'currency' | 'trophy';
  value: number;
  heal?: number;
  icon: { shape: IconShape; color: string; accent?: string };
}

const def = (d: Omit<ItemDef, 'maxStack'> & { maxStack?: number }): ItemDef => ({
  maxStack: d.stackable ? 99_999 : 1,
  ...d,
});

export const ITEMS = {
  coins: def({ id: 'coins', name: 'Coins', examine: 'Shiny golden crowns.', stackable: true, kind: 'currency', value: 1, icon: { shape: 'coins', color: '#f5c542', accent: '#c48a12' } }),
  logs: def({ id: 'logs', name: 'Logs', examine: 'Freshly cut timber.', stackable: false, kind: 'material', value: 4, icon: { shape: 'log', color: '#9b6a3a', accent: '#e6c48f' } }),
  oak_logs: def({ id: 'oak_logs', name: 'Oak logs', examine: 'Sturdy oak timber.', stackable: false, kind: 'material', value: 12, icon: { shape: 'log', color: '#7a4f2a', accent: '#d9a866' } }),
  copper_ore: def({ id: 'copper_ore', name: 'Copper ore', examine: 'Ore with a warm orange sheen.', stackable: false, kind: 'material', value: 5, icon: { shape: 'ore', color: '#7c6f66', accent: '#e8833a' } }),
  tin_ore: def({ id: 'tin_ore', name: 'Tin ore', examine: 'Soft silvery ore.', stackable: false, kind: 'material', value: 5, icon: { shape: 'ore', color: '#7c7a78', accent: '#d8dde2' } }),
  iron_ore: def({ id: 'iron_ore', name: 'Iron ore', examine: 'Heavy, dark and valuable.', stackable: false, kind: 'material', value: 18, icon: { shape: 'ore', color: '#5f5550', accent: '#b35a43' } }),
  sapphire: def({ id: 'sapphire', name: 'Uncut sapphire', examine: 'A rare blue gem found while mining.', stackable: false, kind: 'material', value: 60, icon: { shape: 'gem', color: '#3a6fe8', accent: '#bcd2ff' } }),
  bronze_arrow: def({ id: 'bronze_arrow', name: 'Bronze arrows', examine: 'Fired from a bow. Consumed on use.', stackable: true, kind: 'ammo', value: 1, icon: { shape: 'arrow', color: '#c98a4b', accent: '#f2f2f2' } }),
  air_rune: def({ id: 'air_rune', name: 'Air runes', examine: 'Fuel for basic spells. Consumed on cast.', stackable: true, kind: 'ammo', value: 2, icon: { shape: 'rune', color: '#d9e6f2', accent: '#6bb8ff' } }),
  slime_gel: def({ id: 'slime_gel', name: 'Slime gel', examine: 'Wobbly. Alchemists might want it.', stackable: true, kind: 'material', value: 3, icon: { shape: 'gel', color: '#6fdc5a', accent: '#d8ffd0' } }),
  wolf_pelt: def({ id: 'wolf_pelt', name: 'Wolf pelt', examine: 'Thick grey fur.', stackable: true, kind: 'material', value: 15, icon: { shape: 'pelt', color: '#8c8f99', accent: '#d7d9de' } }),
  wolf_fang: def({ id: 'wolf_fang', name: 'Wolf fang', examine: 'Sharp as a dagger.', stackable: true, kind: 'trophy', value: 8, icon: { shape: 'fang', color: '#f1ecd9', accent: '#b8ad8a' } }),
  bones: def({ id: 'bones', name: 'Bones', examine: 'Remains of a fallen foe.', stackable: true, kind: 'material', value: 2, icon: { shape: 'bone', color: '#efe8d6', accent: '#b9ad90' } }),
  bread: def({ id: 'bread', name: 'Bread', examine: 'Warm village bread. Heals 30 HP.', stackable: false, kind: 'food', value: 6, heal: 30, icon: { shape: 'bread', color: '#d99a4e', accent: '#f6d7a0' } }),
  bronze_axe: def({ id: 'bronze_axe', name: 'Bronze axe', examine: 'Required for woodcutting.', stackable: false, kind: 'tool', value: 16, icon: { shape: 'axe', color: '#c98a4b', accent: '#7a4f2a' } }),
  bronze_pickaxe: def({ id: 'bronze_pickaxe', name: 'Bronze pickaxe', examine: 'Required for mining.', stackable: false, kind: 'tool', value: 16, icon: { shape: 'pickaxe', color: '#c98a4b', accent: '#7a4f2a' } }),
} satisfies Record<string, ItemDef>;

export type ItemId = keyof typeof ITEMS;

export function itemDef(id: string): ItemDef {
  const d = (ITEMS as Record<string, ItemDef>)[id];
  if (!d) throw new Error(`Unknown item ${id}`);
  return d;
}

export function isItemId(id: string): id is ItemId {
  return id in ITEMS;
}

/** Coin value at or above which dropping asks for confirmation (per item, or for a whole stack). */
export const VALUABLE_DROP_VALUE = 15;

/** Whether dropping `qty` of an item should be confirmed first (tools, and anything valuable). */
export function dropNeedsConfirm(id: ItemId, qty: number): boolean {
  const d = itemDef(id);
  return d.kind === 'tool' || d.value >= VALUABLE_DROP_VALUE || d.value * qty >= VALUABLE_DROP_VALUE * 4;
}
