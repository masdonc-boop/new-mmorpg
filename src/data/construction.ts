import type { ItemId } from './items';

export type FurnitureModel = 'stool' | 'chair' | 'table' | 'bookcase' | 'bed';

/**
 * A piece of Brightwater furniture (ids kept from earlier content so built pieces carry over:
 * docs/ORIGINALITY.md H8). Building needs a hammer and a saw.
 */
export interface FurnitureDef {
  id: string;
  name: string;
  level: number;
  xp: number;
  plank: ItemId;
  planks: number;
  /** Nails used (any kind; bronze first). */
  nails: number;
  /** A finishing material: slime-gel varnish, spark stones for a lamp, or hide for bedding. */
  extra?: { item: ItemId; qty: number };
  model: FurnitureModel;
  oak: boolean;
}

export interface HotspotDef {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Facing (radians) for the built model. */
  rot: number;
  options: FurnitureDef[];
}

const f = (d: FurnitureDef) => d;

/**
 * Your house: a plot north of the village with four furniture spaces. Build, remove (materials are used
 * up) and build again to train.
 */
export const HOUSE = { x1: 65, z1: 42, x2: 72, z2: 47, doorX: 69 };

export const HOTSPOTS: HotspotDef[] = [
  {
    id: 'chair', name: 'Chair space', x: 69.0, z: 46.1, rot: Math.PI,
    options: [
      f({ id: 'crude_chair', name: 'Settler’s stool', level: 1, xp: 40, plank: 'plank', planks: 2, nails: 2, model: 'stool', oak: false }),
      f({ id: 'wooden_chair', name: 'Riverwood chair', level: 7, xp: 72, plank: 'plank', planks: 3, nails: 3, model: 'chair', oak: false }),
      f({ id: 'oak_chair', name: 'Oak rocker', level: 18, xp: 130, plank: 'oak_plank', planks: 3, nails: 3, extra: { item: 'slime_gel', qty: 2 }, model: 'chair', oak: true }),
    ],
  },
  {
    id: 'bookcase', name: 'Shelf space', x: 71.4, z: 43.3, rot: 0,
    options: [
      f({ id: 'wooden_bookcase', name: 'Lantern shelf', level: 5, xp: 96, plank: 'plank', planks: 3, nails: 3, extra: { item: 'air_rune', qty: 2 }, model: 'bookcase', oak: false }),
      f({ id: 'oak_bookcase', name: 'Oak map cabinet', level: 27, xp: 190, plank: 'oak_plank', planks: 3, nails: 3, extra: { item: 'slime_gel', qty: 1 }, model: 'bookcase', oak: true }),
    ],
  },
  {
    id: 'table', name: 'Table space', x: 69.0, z: 44.8, rot: 0,
    options: [
      f({ id: 'wood_table', name: 'Riverwood trestle', level: 11, xp: 104, plank: 'plank', planks: 4, nails: 4, model: 'table', oak: false }),
      f({ id: 'oak_table', name: 'Oak feast table', level: 23, xp: 230, plank: 'oak_plank', planks: 4, nails: 4, extra: { item: 'slime_gel', qty: 2 }, model: 'table', oak: true }),
    ],
  },
  {
    id: 'bed', name: 'Bed space', x: 66.5, z: 43.6, rot: 0,
    options: [
      f({ id: 'wooden_bed', name: 'Hearth bed', level: 15, xp: 110, plank: 'plank', planks: 3, nails: 3, extra: { item: 'leather', qty: 1 }, model: 'bed', oak: false }),
      f({ id: 'oak_bed', name: 'Oak canopy bed', level: 29, xp: 220, plank: 'oak_plank', planks: 5, nails: 5, extra: { item: 'leather', qty: 1 }, model: 'bed', oak: true }),
    ],
  },
];

export const NAILS: ItemId[] = ['bronze_nails', 'iron_nails', 'steel_nails'];

export function furnitureDef(id: string): FurnitureDef | undefined {
  for (const h of HOTSPOTS) for (const o of h.options) if (o.id === id) return o;
  return undefined;
}

/** Seconds to build one piece. */
export const BUILD_SECONDS = 2.4;
