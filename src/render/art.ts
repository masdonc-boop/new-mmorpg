/**
 * Art direction switches and shared palette for the Phase 2A visual style.
 * See docs/ART_STYLE.md for the full guide.
 */
export const ART = {
  /** Phase 2A preview style (rounded characters, new water, showcase assets). Off = classic Phase 1 look. */
  v2: true,
};

/** Showcase area where Phase 2A environment detail is applied (village + east road to the copper rocks). */
export const SHOWCASE = {
  village: { x: 56, z: 66, radius: 21 },
  road: { ax: 62, az: 64, bx: 84, bz: 58, width: 7 },
  bridge: { x: 35, z: 64, radius: 9 },
};

export function showcaseWeight(x: number, z: number): number {
  const v = SHOWCASE.village;
  const dv = Math.hypot(x - v.x, z - v.z);
  const wv = 1 - smooth((dv - v.radius + 5) / 5);
  const r = SHOWCASE.road;
  const dx = r.bx - r.ax;
  const dz = r.bz - r.az;
  const t = Math.max(0, Math.min(1, ((x - r.ax) * dx + (z - r.az) * dz) / (dx * dx + dz * dz)));
  const dr = Math.hypot(x - (r.ax + dx * t), z - (r.az + dz * t));
  const wr = 1 - smooth((dr - r.width + 3) / 3);
  const b = SHOWCASE.bridge;
  const wb = 1 - smooth((Math.hypot(x - b.x, z - b.z) - b.radius + 3) / 3);
  return Math.max(wv, wr, wb);
}

function smooth(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** Core palette (sRGB hex). Saturated but not neon; warm light, cool shadow. */
export const PALETTE = {
  skinShadow: '#c98f72',
  leather: '#7a4e2d',
  leatherDark: '#4e321e',
  linen: '#efe3c8',
  iron: '#8d949c',
  gold: '#e3b64a',
  timber: '#6b4426',
  plaster: '#efe4cc',
  stone: '#a9a196',
  copper: '#d9773a',
  copperBright: '#ffb06a',
  // Still water: darker, deeper blues. Rivers: livelier green-turquoise.
  stillShallow: '#4aa7a6',
  stillMid: '#22688f',
  stillDeep: '#163f6b',
  riverShallow: '#5fc0b4',
  riverDeep: '#2c7f9e',
};
