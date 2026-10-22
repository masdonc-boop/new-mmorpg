import type { ItemId } from './items';

export type FurnitureModel = 'chair' | 'table' | 'bookcase' | 'bed';

/** A piece of furniture (OSRS levels, materials and experience). Building needs a hammer and a saw. */
export interface FurnitureDef {
  id: string;
  name: string;
  level: number;
  xp: number;
  plank: ItemId;
  planks: number;
  /** Nails used (any kind; bronze first). */
  nails: number;
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
 * Your house: a plot north of the village with four furniture spaces. Build, remove (no refund, as in
 * OSRS) and build again to train.
 */
export const HOUSE = { x1: 65, z1: 42, x2: 72, z2: 47, doorX: 69 };

export const HOTSPOTS: HotspotDef[] = [
  {
    id: 'chair', name: 'Chair space', x: 69.0, z: 46.1, rot: Math.PI,
    options: [
      f({ id: 'crude_chair', name: 'Crude wooden chair', level: 1, xp: 58, plank: 'plank', planks: 2, nails: 2, model: 'chair', oak: false }),
      f({ id: 'wooden_chair', name: 'Wooden chair', level: 8, xp: 87, plank: 'plank', planks: 3, nails: 3, model: 'chair', oak: false }),
      f({ id: 'oak_chair', name: 'Oak chair', level: 19, xp: 120, plank: 'oak_plank', planks: 2, nails: 2, model: 'chair', oak: true }),
    ],
  },
  {
    id: 'bookcase', name: 'Bookcase space', x: 71.4, z: 43.3, rot: 0,
    options: [
      f({ id: 'wooden_bookcase', name: 'Wooden bookcase', level: 4, xp: 115, plank: 'plank', planks: 4, nails: 4, model: 'bookcase', oak: false }),
      f({ id: 'oak_bookcase', name: 'Oak bookcase', level: 29, xp: 180, plank: 'oak_plank', planks: 3, nails: 3, model: 'bookcase', oak: true }),
    ],
  },
  {
    id: 'table', name: 'Table space', x: 69.0, z: 44.8, rot: 0,
    options: [
      f({ id: 'wood_table', name: 'Wood dining table', level: 10, xp: 115, plank: 'plank', planks: 4, nails: 4, model: 'table', oak: false }),
      f({ id: 'oak_table', name: 'Oak dining table', level: 22, xp: 240, plank: 'oak_plank', planks: 4, nails: 4, model: 'table', oak: true }),
    ],
  },
  {
    id: 'bed', name: 'Bed space', x: 66.5, z: 43.6, rot: 0,
    options: [
      f({ id: 'wooden_bed', name: 'Wooden bed', level: 20, xp: 117, plank: 'plank', planks: 3, nails: 3, model: 'bed', oak: false }),
      f({ id: 'oak_bed', name: 'Oak bed', level: 30, xp: 210, plank: 'oak_plank', planks: 5, nails: 5, model: 'bed', oak: true }),
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
