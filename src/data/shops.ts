import { itemDef, type ItemId } from './items';
import type { NpcId } from './npcs';

export interface ShopDef {
  name: string;
  npc: NpcId;
  /** Items for sale (unlimited stock) and their price in coins, each. */
  stock: { item: ItemId; price: number }[];
}

/** Tilly's stall: every starter tool, so no skill can be locked out by a lost or banked tool. */
export const SHOPS: Record<string, ShopDef> = {
  tilly: {
    name: "Tilly's Trading Stall",
    npc: 'merchant',
    stock: [
      { item: 'bronze_axe', price: 16 },
      { item: 'bronze_pickaxe', price: 16 },
      { item: 'hammer', price: 6 },
      { item: 'knife', price: 6 },
      { item: 'small_fishing_net', price: 8 },
      { item: 'tinderbox', price: 4 },
      { item: 'needle', price: 2 },
      { item: 'thread', price: 1 },
      { item: 'chisel', price: 2 },
      { item: "travellers_cape", price: 20 },
      { item: 'bowstring', price: 5 },
      { item: 'bronze_arrow', price: 2 },
      { item: 'air_rune', price: 3 },
      { item: 'bread', price: 8 },
      { item: 'potato_seed', price: 4 },
      { item: 'rake', price: 6 },
      { item: 'seed_dibber', price: 6 },
      { item: 'spade', price: 6 },
      { item: 'saw', price: 8 },
    ],
  },
};

export function shopFor(npc: NpcId): ShopDef | null {
  return Object.values(SHOPS).find((s) => s.npc === npc) ?? null;
}

/** What the shop pays for an item: 40% of its value (nothing for worthless items or coins). */
export function sellPrice(item: ItemId): number {
  if (item === 'coins') return 0;
  const v = itemDef(item).value;
  return v > 0 ? Math.max(1, Math.floor(v * 0.4)) : 0;
}
