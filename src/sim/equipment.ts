import { EQUIP_SLOTS, armourVs, isItemId, itemDef, type EquipSlot, type ItemId } from '../data/items';
import type { SkillId } from '../data/skills';
import type { Inventory, ItemStack } from './inventory';
import { STYLES, type CombatStyle } from './combat';

export type EquipFailure = 'notEquippable' | 'level' | 'space' | 'empty';

export interface EquipResult {
  ok: boolean;
  reason?: EquipFailure;
  /** For 'level': the skill and level required. */
  need?: { skill: SkillId; level: number };
  /** Items that came off as a result (swapped weapon, shield removed by a two-handed bow, …). */
  removed: ItemId[];
}

/**
 * Worn gear: one item per slot, kept apart from the 28-slot inventory. The ammo slot holds a whole
 * stack (OSRS-style), counted in `ammoQty`.
 */
export class Equipment {
  readonly slots: Record<EquipSlot, ItemId | null> = { head: null, cape: null, neck: null, ammo: null, weapon: null, shield: null, body: null, legs: null, hands: null, feet: null, ring: null };
  ammoQty = 0;

  get(slot: EquipSlot): ItemId | null {
    return this.slots[slot];
  }

  /** How many of an item are worn (the ammo stack counts in full). */
  count(item: ItemId): number {
    let n = 0;
    for (const s of EQUIP_SLOTS) if (this.slots[s] === item) n += s === 'ammo' ? this.ammoQty : 1;
    return n;
  }

  /** Uses one piece of worn ammo of this item (false if none is worn). */
  useAmmo(item: ItemId): boolean {
    if (this.slots.ammo !== item || this.ammoQty <= 0) return false;
    if (--this.ammoQty <= 0) this.clearAmmo();
    return true;
  }

  clearAmmo() {
    this.slots.ammo = null;
    this.ammoQty = 0;
  }

  /**
   * Total bonuses for a combat style: the weapon only counts when used with its own style; other
   * gear (an amulet) adds its accuracy and power to every style (`extra*`).
   */
  bonuses(style: CombatStyle): { weapon: ItemId | null; accuracy: number; power: number; armour: number; extraAccuracy: number; extraPower: number } {
    let armour = 0;
    let extraAccuracy = 0;
    let extraPower = 0;
    for (const s of EQUIP_SLOTS) {
      const it = this.slots[s];
      if (!it) continue;
      const e = itemDef(it).equip;
      armour += e?.armour ?? 0;
      // Arrows only help bows.
      if (s === 'ammo' && style !== 'ranged') continue;
      if (s !== 'weapon') {
        extraAccuracy += (e?.accuracy ?? 0) + (e?.styleBonus?.[style]?.accuracy ?? 0);
        extraPower += (e?.power ?? 0) + (e?.styleBonus?.[style]?.power ?? 0);
      }
    }
    const w = this.slots.weapon;
    const we = w ? itemDef(w).equip : undefined;
    const matches = !!we && we.style === style;
    return { weapon: matches ? w : null, accuracy: matches ? (we!.accuracy ?? 0) : 0, power: matches ? (we!.power ?? 0) : 0, armour, extraAccuracy, extraPower };
  }

  /**
   * Seconds between attacks and reach for a combat style: the worn weapon's own when it is made for
   * that style and has them, otherwise the style's (the training weapon's).
   */
  attackProfile(style: CombatStyle): { seconds: number; range: number } {
    const w = this.slots.weapon;
    const e = w ? itemDef(w).equip : undefined;
    const own = !!e && e.style === style;
    return { seconds: (own && e!.speed) || STYLES[style].attackSeconds, range: (own && e!.range) || STYLES[style].range };
  }

  /** Total armour against each attack style (5B): what a creature's melee, arrows or spells meet. */
  armourAgainst(): Record<CombatStyle, number> {
    const out = { melee: 0, ranged: 0, magic: 0 };
    for (const s of EQUIP_SLOTS) {
      const it = this.slots[s];
      const e = it ? itemDef(it).equip : undefined;
      if (!e) continue;
      for (const st of ['melee', 'ranged', 'magic'] as const) out[st] += armourVs(e, st);
    }
    return out;
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
  static restore(data: unknown, ammoQty?: unknown): { equipment: Equipment; displaced: ItemStack[] } {
    const eq = new Equipment();
    const displaced: ItemStack[] = [];
    if (!data || typeof data !== 'object') return { equipment: eq, displaced };
    for (const s of EQUIP_SLOTS) {
      const it = (data as Record<string, unknown>)[s];
      if (typeof it !== 'string' || !isItemId(it)) continue;
      const qty = s === 'ammo' ? Math.floor(Number(ammoQty)) : 1;
      if (!(qty > 0)) continue;
      if (itemDef(it).equip?.slot === s) {
        eq.slots[s] = it;
        if (s === 'ammo') eq.ammoQty = qty;
      } else displaced.push({ item: it, qty });
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
  if (e.slot === 'ammo') return equipAmmo(eq, inv, slot);
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

/**
 * Wears a whole ammo stack. The same ammo adds to the worn stack; different ammo swaps, with the old
 * stack going back into the bag (the new stack's slot has just been freed, so it always fits).
 */
function equipAmmo(eq: Equipment, inv: Inventory, slot: number): EquipResult {
  const st = inv.removeAt(slot);
  if (!st) return { ok: false, reason: 'empty', removed: [] };
  const old = eq.slots.ammo;
  if (old === st.item) {
    // A worn stack can't pass the stack limit; any surplus stays in the bag slot it came from.
    const add = Math.min(st.qty, itemDef(st.item).maxStack - eq.ammoQty);
    eq.ammoQty += add;
    if (add < st.qty) inv.slots[slot] = { item: st.item, qty: st.qty - add };
    return { ok: true, removed: [] };
  }
  const oldQty = eq.ammoQty;
  eq.slots.ammo = st.item;
  eq.ammoQty = st.qty;
  if (old && inv.add(old, oldQty) !== oldQty) throw new Error('ammo swap invariant broken');
  return { ok: true, removed: old ? [old] : [] };
}

/** Takes off the item in an equipment slot, if there is room for it in the inventory. */
export function unequipToInventory(eq: Equipment, inv: Inventory, slot: EquipSlot): EquipResult {
  const it = eq.slots[slot];
  if (!it) return { ok: false, reason: 'empty', removed: [] };
  if (slot === 'ammo') {
    if (inv.capacityFor(it) < eq.ammoQty) return { ok: false, reason: 'space', removed: [] };
    if (inv.add(it, eq.ammoQty) !== eq.ammoQty) throw new Error('unequip invariant broken');
    eq.clearAmmo();
    return { ok: true, removed: [it] };
  }
  if (inv.capacityFor(it) < 1) return { ok: false, reason: 'space', removed: [] };
  if (inv.add(it, 1) !== 1) throw new Error('unequip invariant broken');
  eq.slots[slot] = null;
  return { ok: true, removed: [it] };
}
