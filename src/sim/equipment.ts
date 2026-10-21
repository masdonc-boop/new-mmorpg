import { EQUIP_SLOTS, isItemId, itemDef, type EquipSlot, type ItemId } from '../data/items';
import type { SkillId } from '../data/skills';
import type { Inventory, ItemStack } from './inventory';
import type { CombatStyle } from './combat';

export type EquipFailure = 'notEquippable' | 'level' | 'space' | 'empty';

export interface EquipResult {
  ok: boolean;
  reason?: EquipFailure;
  /** For 'level': the skill and level required. */
  need?: { skill: SkillId; level: number };
  /** Items that came off as a result (swapped weapon, shield removed by a two-handed bow, …). */
  removed: ItemId[];
}

/** Worn gear: one item per slot, kept apart from the 28-slot inventory. */
export class Equipment {
  readonly slots: Record<EquipSlot, ItemId | null> = { head: null, body: null, legs: null, weapon: null, shield: null };

  get(slot: EquipSlot): ItemId | null {
    return this.slots[slot];
  }

  /** Total bonuses for a combat style: the weapon only counts when used with its own style. */
  bonuses(style: CombatStyle): { weapon: ItemId | null; accuracy: number; power: number; armour: number } {
    let armour = 0;
    for (const s of EQUIP_SLOTS) {
      const it = this.slots[s];
      if (it) armour += itemDef(it).equip?.armour ?? 0;
    }
    const w = this.slots.weapon;
    const we = w ? itemDef(w).equip : undefined;
    const matches = !!we && we.style === style;
    return { weapon: matches ? w : null, accuracy: matches ? (we!.accuracy ?? 0) : 0, power: matches ? (we!.power ?? 0) : 0, armour };
  }

  toJSON(): Partial<Record<EquipSlot, ItemId>> {
    const out: Partial<Record<EquipSlot, ItemId>> = {};
    for (const s of EQUIP_SLOTS) if (this.slots[s]) out[s] = this.slots[s]!;
    return out;
  }

  /**
   * Rebuilds worn gear from a save. Anything that is no longer wearable in that slot is returned in
   * `displaced` (so the caller can keep it rather than delete it).
   */
  static restore(data: unknown): { equipment: Equipment; displaced: ItemStack[] } {
    const eq = new Equipment();
    const displaced: ItemStack[] = [];
    if (!data || typeof data !== 'object') return { equipment: eq, displaced };
    for (const s of EQUIP_SLOTS) {
      const it = (data as Record<string, unknown>)[s];
      if (typeof it !== 'string' || !isItemId(it)) continue;
      if (itemDef(it).equip?.slot === s) eq.slots[s] = it;
      else displaced.push({ item: it, qty: 1 });
    }
    return { equipment: eq, displaced };
  }
}

/**
 * Wears the item in inventory slot `slot`. Whatever has to come off (the item already worn there, or
 * a shield/two-handed weapon conflict) goes back into the inventory, starting with the freed slot.
 * Either everything happens or nothing does: if the removed items would not fit, nothing changes.
 */
export function equipFromInventory(eq: Equipment, inv: Inventory, slot: number, level: (s: SkillId) => number): EquipResult {
  const st = inv.slots[slot];
  if (!st) return { ok: false, reason: 'empty', removed: [] };
  const e = itemDef(st.item).equip;
  if (!e) return { ok: false, reason: 'notEquippable', removed: [] };
  for (const [skill, lvl] of Object.entries(e.req ?? {}) as [SkillId, number][]) {
    if (level(skill) < lvl) return { ok: false, reason: 'level', need: { skill, level: lvl }, removed: [] };
  }
  const off: EquipSlot[] = [];
  if (eq.slots[e.slot]) off.push(e.slot);
  if (e.slot === 'weapon' && e.twoHanded && eq.slots.shield) off.push('shield');
  if (e.slot === 'shield' && eq.slots.weapon && itemDef(eq.slots.weapon).equip?.twoHanded) off.push('weapon');
  // The item leaves its slot (one non-stackable item, or one from a stack), freeing at most one slot.
  const freesSlot = st.qty === 1;
  if (off.length > inv.freeSlots() + (freesSlot ? 1 : 0)) return { ok: false, reason: 'space', removed: [] };
  inv.removeAt(slot, 1);
  const removed = off.map((s) => eq.slots[s]!);
  for (const s of off) eq.slots[s] = null;
  eq.slots[e.slot] = st.item;
  removed.forEach((it, i) => {
    if (i === 0 && freesSlot && inv.slots[slot] === null) inv.slots[slot] = { item: it, qty: 1 };
    else if (inv.add(it, 1) !== 1) throw new Error('equip invariant broken');
  });
  return { ok: true, removed };
}

/** Takes off the item in an equipment slot, if there is room for it in the inventory. */
export function unequipToInventory(eq: Equipment, inv: Inventory, slot: EquipSlot): EquipResult {
  const it = eq.slots[slot];
  if (!it) return { ok: false, reason: 'empty', removed: [] };
  if (inv.capacityFor(it) < 1) return { ok: false, reason: 'space', removed: [] };
  if (inv.add(it, 1) !== 1) throw new Error('unequip invariant broken');
  eq.slots[slot] = null;
  return { ok: true, removed: [it] };
}
