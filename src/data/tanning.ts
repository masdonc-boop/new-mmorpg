import type { ItemId } from './items';

/** NPC services that turn one item into another for a fee each (OSRS tanner and sawmill operator). */
export type ConvertService = 'tanner' | 'sawmill';

export const SERVICES: Record<ConvertService, { title: string; verb: string; blurb: string; list: { from: ItemId; to: ItemId; cost: number }[] }> = {
  tanner: {
    title: 'Tannery',
    verb: 'tans',
    blurb: '“Good hides make good leather.” Leather is sewn into armour with a needle and thread (Crafting).',
    list: [
      { from: 'wolf_pelt', to: 'leather', cost: 2 },
      // Thornridge hides (Phase 4B).
      { from: 'boar_hide', to: 'boar_leather', cost: 8 },
      { from: 'ridge_pelt', to: 'ridgehide', cost: 15 },
    ],
  },
  sawmill: {
    title: 'Sawmill',
    verb: 'saws',
    blurb: '“Logs in, planks out.” Planks and nails build furniture in your house (Construction).',
    list: [
      { from: 'logs', to: 'plank', cost: 5 },
      { from: 'oak_logs', to: 'oak_plank', cost: 15 },
    ],
  },
};

export function isConvertService(s: string | undefined): s is ConvertService {
  return s === 'tanner' || s === 'sawmill';
}
