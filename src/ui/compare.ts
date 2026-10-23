import { armourVs, itemDef, type EquipDef, type ItemId } from '../data/items';
import { STYLES } from '../sim/combat';
import type { Equipment } from '../sim/equipment';

/** Item-card text for gear (Phase 5A): kept free of the DOM so tests can check it. */
/** A weapon's pace and reach next to its style's training weapon (item card, 5A). */
export function weaponTiming(e: EquipDef): string {
  const st = STYLES[e.style!];
  const secs = e.speed ?? st.attackSeconds;
  const pace = secs < st.attackSeconds ? 'quick' : secs > st.attackSeconds ? 'slow' : 'steady';
  return ` · ${pace}, every ${secs}s · reach ${e.range ?? st.range}`;
}

/**
 * The item set against what is worn in its slot (item card, 5A): each stat that changes, in green or
 * red, and for weapons the change of pace. Null when the slot is empty or the item is the one worn.
 */
export function compareWorn(eq: Equipment, item: ItemId): string | null {
  const e = itemDef(item).equip;
  if (!e) return null;
  const wornId = eq.get(e.slot);
  if (!wornId || wornId === item) return wornId ? null : `<span class="req-ok">Your ${e.slot} slot is empty.</span>`;
  const w = itemDef(wornId).equip!;
  const style = e.style ?? w.style;
  const stat = (x: EquipDef, k: 'accuracy' | 'power') => (x[k] ?? 0) + (style && x.slot !== 'weapon' ? (x.styleBonus?.[style]?.[k] ?? 0) : 0);
  const diffs: string[] = [];
  const push = (label: string, d: number) => {
    if (d) diffs.push(`<span class="${d > 0 ? 'req-ok' : 'req-no'}">${d > 0 ? '+' : '−'}${Math.abs(d)} ${label}</span>`);
  };
  push('accuracy', stat(e, 'accuracy') - stat(w, 'accuracy'));
  push('power', stat(e, 'power') - stat(w, 'power'));
  // Armour by attack style (5B): one figure when all three move together, otherwise all three.
  const dv = (['melee', 'ranged', 'magic'] as const).map((st) => Math.round(armourVs(e, st)) - Math.round(armourVs(w, st)));
  if (dv[0] === dv[1] && dv[1] === dv[2]) push('armour', dv[0]);
  else if (dv.some((d) => d)) {
    const sg = (d: number) => `<span class="${d > 0 ? 'req-ok' : d < 0 ? 'req-no' : ''}">${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}</span>`;
    diffs.push(`armour ${dv.map(sg).join('/')} (melee/ranged/magic)`);
  }
  if (e.slot === 'weapon' && e.style && e.style === w.style) {
    const st = STYLES[e.style];
    const ds = (e.speed ?? st.attackSeconds) - (w.speed ?? st.attackSeconds);
    if (ds) diffs.push(`<span class="${ds < 0 ? 'req-ok' : 'req-no'}">${ds < 0 ? 'quicker' : 'slower'} by ${Math.abs(Math.round(ds * 10) / 10)}s</span>`);
    const dr = (e.range ?? st.range) - (w.range ?? st.range);
    push('reach', dr);
  } else if (e.slot === 'weapon' && e.style !== w.style) diffs.push(`switches to ${STYLES[e.style!].name}`);
  return `Compared with your ${itemDef(wornId).name}: ${diffs.length ? diffs.join(' · ') : 'the same'}`;
}

/** Armour against each attack style, for the item card (5B): "armour 30 melee · 33 ranged · 12 magic". */
export function armourLine(e: EquipDef): string {
  if (!e.armour && !e.defence) return '';
  const [m, r, g] = (['melee', 'ranged', 'magic'] as const).map((st) => Math.round(armourVs(e, st)));
  return m === r && r === g ? `armour ${m}` : `armour ${m} melee · ${r} ranged · ${g} magic`;
}
