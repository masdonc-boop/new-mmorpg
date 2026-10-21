import { ITEMS, itemDef, type ItemId } from './items';
import { RECIPES, STATION_INFO } from './recipes';
import { RESOURCES } from './resources';
import { FIRE_LOGS } from './firemaking';
import type { SkillId } from './skills';

export interface Unlock {
  level: number;
  text: string;
  icon: ItemId;
}

/** Everything a skill unlocks, by level: resources to gather, recipes to make and gear to wear. */
export function skillUnlocks(skill: SkillId): Unlock[] {
  const out: Unlock[] = [];
  const verb = { woodcutting: 'Chop', mining: 'Mine', fishing: 'Fish at a' }[skill as 'woodcutting'] ?? 'Gather';
  for (const r of Object.values(RESOURCES)) if (r.skill === skill) out.push({ level: r.levelReq, text: `${verb} ${r.name.toLowerCase()}`, icon: r.item });
  if (skill === 'firemaking') for (const [item, f] of Object.entries(FIRE_LOGS)) out.push({ level: f!.level, text: `Light ${itemDef(item).name.toLowerCase()}`, icon: item as ItemId });
  for (const r of Object.values(RECIPES)) {
    if (r.skill !== skill) continue;
    const o = itemDef(r.output.item);
    out.push({ level: r.level, text: `${STATION_INFO[r.station].verb} ${r.output.qty > 1 ? `${r.output.qty} ` : ''}${o.name.toLowerCase()}`, icon: r.output.item });
  }
  for (const d of Object.values(ITEMS)) {
    const lvl = d.equip?.req?.[skill as keyof NonNullable<NonNullable<typeof d.equip>['req']>];
    if (lvl) out.push({ level: lvl, text: `${d.equip!.slot === 'weapon' ? 'Wield' : 'Wear'} ${d.name.toLowerCase()}`, icon: d.id as ItemId });
    const req = d.tool?.req;
    if (req && req.skill === skill && req.level > 1) out.push({ level: req.level, text: `Use a ${d.name.toLowerCase()}`, icon: d.id as ItemId });
  }
  return out.sort((a, b) => a.level - b.level);
}
