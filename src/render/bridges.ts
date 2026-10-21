import { T, type WorldMap } from '../sim/worldmap';

/** Whether a bridge tile's deck runs along x (true) or z (false). */
export function bridgeRunsAlongX(map: WorldMap, x: number, z: number): boolean {
  const W = map.width;
  const t = (tx: number, tz: number) => map.tiles[tz * W + tx];
  return t(x - 1, z) === T.Bridge || t(x + 1, z) === T.Bridge || t(x - 1, z) === T.Path || t(x + 1, z) === T.Path;
}

/** Support pilings: one on each side of every bridge tile. Shared by the bridge props and the water shader (ripples). */
export function bridgePiers(map: WorldMap): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const W = map.width;
  for (let z = 1; z < map.height - 1; z++) {
    for (let x = 1; x < W - 1; x++) {
      if (map.tiles[z * W + x] !== T.Bridge) continue;
      const alongX = bridgeRunsAlongX(map, x, z);
      for (const s of [-1, 1]) {
        // Only on the bridge's outer edges, never under the middle of a wide deck.
        const nx = alongX ? x : x + s;
        const nz = alongX ? z + s : z;
        if (map.tiles[nz * W + nx] === T.Bridge) continue;
        out.push(alongX ? { x: x + 0.5, z: z + 0.5 + s * 0.44 } : { x: x + 0.5 + s * 0.44, z: z + 0.5 });
      }
    }
  }
  return out;
}
