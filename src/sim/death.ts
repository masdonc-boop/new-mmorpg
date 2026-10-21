import { EQUIP_SLOTS, itemDef, type EquipSlot } from '../data/items';
import type { Equipment } from './equipment';
import { addTo, type Inventory, type ItemStack } from './inventory';

/** OSRS rule: on death you keep your three most valuable items; everything else carried is at risk. */
export const KEEP_ON_DEATH = 3;
/** A gravestone holds the rest for this long (simulation time, so it only counts down while playing). */
export const GRAVE_SECONDS = 15 * 60;

type Holding = { item: ItemStack['item']; qty: number; value: number; inv?: number; eq?: EquipSlot };

/**
 * Splits what the player carries (inventory and worn gear, ammo included) into the most valuable
 * `keep` units, which stay where they are, and the rest, which is removed and returned. Each unit of
 * a stack counts as one item, so a stack of coins or arrows can be partly kept. The toolbelt is never
 * at risk (it is a quality-of-life store for tools, not carried loot).
 */
export function takeLostOnDeath(inv: Inventory, eq: Equipment, keep = KEEP_ON_DEATH): { kept: ItemStack[]; lost: ItemStack[] } {
  const all: Holding[] = [];
  inv.slots.forEach((s, i) => {
    if (s) all.push({ item: s.item, qty: s.qty, value: itemDef(s.item).value, inv: i });
  });
  for (const slot of EQUIP_SLOTS) {
    const it = eq.slots[slot];
    if (it) all.push({ item: it, qty: slot === 'ammo' ? eq.ammoQty : 1, value: itemDef(it).value, eq: slot });
  }
  // Most valuable first; worn gear wins ties (it is what the player chose to use).
  all.sort((a, b) => b.value - a.value || (a.eq ? 0 : 1) - (b.eq ? 0 : 1));
  const kept: ItemStack[] = [];
  const lost: ItemStack[] = [];
  let left = keep;
  for (const h of all) {
    const k = Math.min(left, h.qty);
    left -= k;
    if (k > 0) addTo(kept, h.item, k);
    if (k === h.qty) continue;
    addTo(lost, h.item, h.qty - k);
    if (h.inv !== undefined) {
      if (k > 0) inv.slots[h.inv] = { item: h.item, qty: k };
      else inv.slots[h.inv] = null;
    } else if (h.eq === 'ammo') {
      if (k > 0) eq.ammoQty = k;
      else eq.clearAmmo();
    } else if (h.eq) eq.slots[h.eq] = null;
  }
  return { kept, lost };
}
