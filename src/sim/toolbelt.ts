import { isItemId, itemDef, type ItemId } from '../data/items';
import type { SkillId } from '../data/skills';
import { TOOL_SLOTS, type ToolCategory } from '../data/tools';
import type { Inventory, ItemStack } from './inventory';

/**
 * The toolbelt: one tool per category, kept apart from the 28 inventory slots (a Brightwater
 * quality-of-life addition to the OSRS-style rules). Tools still have to be obtained normally and
 * still obey their use requirements; the belt only saves inventory space.
 */
export class Toolbelt {
  readonly slots: Partial<Record<ToolCategory, ItemId>> = {};

  get(c: ToolCategory): ItemId | null {
    return this.slots[c] ?? null;
  }

  count(item: ItemId): number {
    return Object.values(this.slots).filter((x) => x === item).length;
  }

  toJSON(): Partial<Record<ToolCategory, ItemId>> {
    return { ...this.slots };
  }

  /** Rebuilds from a save; anything that isn't a tool of that slot's category is returned (kept), not lost. */
  static restore(data: unknown): { belt: Toolbelt; displaced: ItemStack[] } {
    const belt = new Toolbelt();
    const displaced: ItemStack[] = [];
    if (!data || typeof data !== 'object') return { belt, displaced };
    for (const [cat, it] of Object.entries(data as Record<string, unknown>)) {
      if (typeof it !== 'string' || !isItemId(it)) continue;
      const slot = TOOL_SLOTS.find((t) => t.id === cat);
      if (slot?.available && itemDef(it).tool?.category === cat) belt.slots[cat as ToolCategory] = it;
      else displaced.push({ item: it, qty: 1 });
    }
    return { belt, displaced };
  }
}

export type BeltFailure = 'empty' | 'notTool' | 'unavailable' | 'space';

/**
 * Puts the tool from an inventory slot on the belt. If that category already holds a tool, the old one
 * swaps into the freed inventory slot, so the move always fits and nothing is ever lost or duplicated.
 */
export function addToBelt(belt: Toolbelt, inv: Inventory, slot: number): { ok: boolean; reason?: BeltFailure; added?: ItemId; replaced?: ItemId } {
  const st = inv.slots[slot];
  if (!st) return { ok: false, reason: 'empty' };
  const info = itemDef(st.item).tool;
  if (!info) return { ok: false, reason: 'notTool' };
  if (!TOOL_SLOTS.find((t) => t.id === info.category)?.available) return { ok: false, reason: 'unavailable' };
  const old = belt.slots[info.category];
  if (inv.removeAt(slot, 1)?.qty !== 1) throw new Error('toolbelt add invariant broken');
  belt.slots[info.category] = st.item;
  if (old) {
    // Tools never stack, so the slot the new tool came from is now free.
    if (inv.slots[slot] === null) inv.slots[slot] = { item: old, qty: 1 };
    else if (inv.add(old, 1) !== 1) throw new Error('toolbelt swap invariant broken');
  }
  return { ok: true, added: st.item, replaced: old };
}

/** Takes a tool off the belt into the inventory, if there is room. */
export function removeFromBelt(belt: Toolbelt, inv: Inventory, c: ToolCategory): { ok: boolean; reason?: BeltFailure; removed?: ItemId } {
  const it = belt.slots[c];
  if (!it) return { ok: false, reason: 'empty' };
  if (inv.capacityFor(it) < 1) return { ok: false, reason: 'space' };
  if (inv.add(it, 1) !== 1) throw new Error('toolbelt remove invariant broken');
  delete belt.slots[c];
  return { ok: true, removed: it };
}

export interface ToolChoice {
  item: ItemId;
  tier: number;
  /** Where the chosen tool is. */
  from: 'belt' | 'inventory';
}

/**
 * The tool a skill action uses: the highest-tier tool of the category, from the belt or the bag, whose
 * use requirement the player meets. Only that one tool counts, so carrying several gives no extra bonus.
 * `blocked` names the best tool the player owns but can't use yet (for the message).
 */
export function bestTool(c: ToolCategory, belt: Toolbelt, inv: Inventory, level: (s: SkillId) => number): { tool: ToolChoice | null; blocked: ItemId | null } {
  const owned: ToolChoice[] = [];
  const b = belt.slots[c];
  if (b) owned.push({ item: b, tier: itemDef(b).tool!.tier, from: 'belt' });
  for (const s of inv.slots) {
    const t = s ? itemDef(s.item).tool : undefined;
    if (s && t?.category === c) owned.push({ item: s.item, tier: t.tier, from: 'inventory' });
  }
  const usable = owned.filter((o) => {
    const req = itemDef(o.item).tool?.req;
    return !req || level(req.skill) >= req.level;
  });
  usable.sort((x, y) => y.tier - x.tier);
  const blocked = owned.filter((o) => !usable.includes(o)).sort((x, y) => y.tier - x.tier)[0]?.item ?? null;
  return { tool: usable[0] ?? null, blocked };
}
