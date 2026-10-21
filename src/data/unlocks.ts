import { ITEMS, itemDef, type ItemId } from './items';
import { RECIPES, STATION_INFO } from './recipes';
import { RESOURCES } from './resources';
import type { SkillId } from './skills';

export interface Unlock {
  level: number;
  text: string;
  icon: ItemId;
}

/** Everything a skill unlocks, by level: resources to gather, recipes to make and gear to wear. */
export function skillUnlocks(skill: SkillId): Unlock[] {
  const out: Unlock[] = [];
  for (const r of Object.values(RESOURCES)) if (r.skill === skill) out.push({ level: r.levelReq, text: `${skill === 'woodcutting' ? 'Chop' : 'Mine'} ${r.name.toLowerCase()}`, icon: r.item });
  for (const r of Object.values(RECIPES)) {
    if (r.skill !== skill) continue;
    const o = itemDef(r.output.item);
    out.push({ level: r.level, text: `${STATION_INFO[r.station].verb} ${r.output.qty > 1 ? `${r.output.qty} ` : ''}${o.name.toLowerCase()}`, icon: r.output.item });
  }
  for (const d of Object.values(ITEMS)) {
    const lvl = d.equip?.req?.[skill as keyof NonNullable<NonNullable<typeof d.equip>['req']>];
    if (lvl) out.push({ level: lvl, text: `${d.equip!.slot === 'weapon' ? 'Wield' : 'Wear'} ${d.name.toLowerCase()}`, icon: d.id as ItemId });
  }
  return out.sort((a, b) => a.level - b.level);
}
