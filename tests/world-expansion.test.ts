import { describe, expect, it } from 'vitest';
import { generateWorld, inIslandBox, isBlocked, regionAt, T, MAP_WIDTH, MAP_HEIGHT, type WorldMap } from '../src/sim/worldmap';
import { CAUSEWAY, EAST, islandTilesChanged } from '../src/sim/eastreach';
import { findPath } from '../src/sim/pathfinding';
import { GameWorld, type SaveData } from '../src/sim/world';
import { zoneFor } from '../src/sim/zones';
import { fnv } from '../src/exchange/engine';

const map = generateWorld(1337);
const FILES = import.meta.glob('./fixtures/saves/*.json', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

/** Fingerprints of the island as it was before Eastreach (computed from the earlier generator). */
const ISLAND = {
  tiles: '388c5433',
  blocked: '5f6e4c78',
  heights: '8d549ee4',
  resources: '74135a56',
  enemies: '4369abc2',
  npcs: '59becc79',
  decor: '5aea783a',
  counts: { resources: 255, enemies: 28, npcs: 16, decor: 746, passages: 2, stations: 5, checkpoints: 4, buildings: 7 },
};

function islandPrint(m: WorldMap) {
  const skip = new Set(islandTilesChanged(m).map((c) => c.z * 1000 + c.x));
  let tiles = '';
  let blocked = '';
  let heights = '';
  for (let z = 0; z < 112; z++) for (let x = 0; x < 112; x++) {
    if (skip.has(z * 1000 + x)) continue;
    tiles += m.tiles[z * m.width + x];
    blocked += m.blocked[z * m.width + x];
  }
  for (let z = 0; z <= 112; z++) for (let x = 0; x <= 112; x++) heights += m.heights[z * (m.width + 1) + x].toFixed(4) + ',';
  const c = ISLAND.counts;
  return {
    tiles: fnv(tiles),
    blocked: fnv(blocked),
    heights: fnv(heights),
    resources: fnv(JSON.stringify(m.resources.slice(0, c.resources))),
    enemies: fnv(JSON.stringify(m.enemySpawns.slice(0, c.enemies))),
    npcs: fnv(JSON.stringify(m.npcs.slice(0, c.npcs))),
    decor: fnv(JSON.stringify(m.decor.slice(0, c.decor))),
  };
}

describe('4A.1 the island is unchanged', () => {
  it('every tile, height, resource, creature, NPC and piece of scenery is where it was (only the causeway and its trail are new)', () => {
    const { counts, ...prints } = ISLAND;
    expect(islandPrint(map)).toEqual(prints);
    expect(map.passages.slice(0, counts.passages).map((p) => p.id)).toEqual(['hollow_up', 'hollow_mouth']);
    expect(map.checkpoints.slice(0, counts.checkpoints).map((c) => c.id)).toEqual(['home', 'meadow', 'woods', 'hills']);
    expect(map.spawn).toEqual({ x: 56.5, z: 63.4 });
    // The changed island tiles are just the trail (path) and the causeway's west end (bridge), and a signpost.
    for (const c of islandTilesChanged(map)) {
      const t = map.tiles[c.z * map.width + c.x];
      if (c.x === 100 && c.z === 61) continue;
      expect([T.Path, T.Bridge]).toContain(t);
    }
  });

  it('the same seed always makes the same world', () => {
    const again = generateWorld(1337);
    expect(fnv(Array.from(again.tiles).join(''))).toBe(fnv(Array.from(map.tiles).join('')));
    expect(again.decor.length).toBe(map.decor.length);
  });
});

describe('4A.1 Eastreach is reachable and whole', () => {
  it('the map is bigger, and the island keeps its corner', () => {
    expect([map.width, map.height]).toEqual([MAP_WIDTH, MAP_HEIGHT]);
    expect(inIslandBox(111, 111)).toBe(true);
    expect(inIslandBox(112, 50)).toBe(false);
  });

  it('every landmark can be walked to from the village, across the causeway', () => {
    const from = map.spawn;
    const near = (p: { x: number; z: number }) => {
      for (let r = 0; r < 5; r++)
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) if (!isBlocked(map, p.x + dx, p.z + dz)) return { x: p.x + dx + 0.5, z: p.z + dz + 0.5 };
      throw new Error(`nowhere to stand near ${p.x},${p.z}`);
    };
    for (const [name, p] of Object.entries({ fork: EAST.fork, cairnhold: EAST.cairnhold, heronwick: EAST.heronwick, ninefold: EAST.ninefold, watchtower: EAST.watchtower, tarn: { x: EAST.tarn.x - 6, z: EAST.tarn.z }, shrine: EAST.shrine, tollhouse: EAST.tollhouse })) {
      const goal = near({ x: Math.floor(p.x), z: Math.floor(p.z) });
      const path = findPath(map, from.x, from.z, goal.x, goal.z, 200_000);
      expect(path, name).not.toBeNull();
    }
    // The causeway itself is walkable all the way across.
    for (let x = CAUSEWAY.fromX; x <= CAUSEWAY.toX; x++) expect(isBlocked(map, x + 0.5, CAUSEWAY.z + 0.5), `causeway at ${x}`).toBe(false);
  });

  it('almost none of Eastreach’s open ground is cut off (no trapping pockets)', () => {
    // Flood from the causeway's east end over walkable tiles.
    const W = map.width;
    const seen = new Uint8Array(W * map.height);
    const stack = [CAUSEWAY.z * W + CAUSEWAY.toX + 2];
    seen[stack[0]] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % W;
      const z = Math.floor(i / W);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = (z + dz) * W + x + dx;
        if (!seen[n] && !map.blocked[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    let open = 0;
    let reached = 0;
    const pockets: string[] = [];
    for (let z = 0; z < map.height; z++) for (let x = 0; x < W; x++) {
      if (inIslandBox(x, z) || map.blocked[z * W + x]) continue;
      open++;
      if (seen[z * W + x]) reached++;
      else if (pockets.length < 5) pockets.push(`${x},${z}`);
    }
    expect(reached / open, `cut-off tiles e.g. ${pockets.join(' ')}`).toBeGreaterThan(0.985);
  });
});

describe('4A.1 regions, zones and saves', () => {
  it('Eastreach places have names on the map and belong to the shared Brightwater zone', () => {
    expect(regionAt(EAST.cairnhold.x, EAST.cairnhold.z)?.name).toBe('Cairnhold');
    expect(regionAt(EAST.heronwick.x, EAST.heronwick.z)?.name).toBe('Heronwick');
    expect(regionAt(EAST.ninefold.x, EAST.ninefold.z)?.name).toBe('Ninefold Stones');
    expect(regionAt(165, 45)?.name).toBe('Thornridge Highlands');
    expect(regionAt(EAST.shrine.x, EAST.shrine.z)?.name).toBe('Sunken Shrine');
    expect(regionAt(160, 100)?.name).toBe('Mirefen Marsh');
    expect(regionAt(110, 62.5)?.name).toBe('Saltwind Causeway');
    for (const p of [EAST.cairnhold, EAST.heronwick, EAST.shrine]) expect(zoneFor(p.x, p.z, 7)).toBe('brightwater');
  });

  it('every save from earlier batches loads in the bigger world, in the same place', () => {
    for (const [file, text] of Object.entries(FILES)) {
      const save = JSON.parse(text) as SaveData;
      const w = new GameWorld({ save, map, clock: () => 0 });
      // A walkable spot is kept; a blocked one (here, inside the fountain) falls back to the spawn, as it always has.
      const at = isBlocked(map, save.x, save.z) ? map.spawn : save;
      expect(w.player.x, file).toBeCloseTo(at.x, 3);
      expect(w.player.z, file).toBeCloseTo(at.z, 3);
    }
  });

  it('walking onto the causeway and over to Eastreach works in the game itself', () => {
    const w = new GameWorld({ map, clock: () => 0 });
    w.player.x = w.player.prevX = 98.5;
    w.player.z = w.player.prevZ = CAUSEWAY.z + 0.5;
    w.issue({ type: 'moveTo', x: EAST.fork.x + 0.5, z: EAST.fork.z + 0.5 });
    for (let t = 0; t < 30 * 20 && Math.hypot(w.player.x - EAST.fork.x - 0.5, w.player.z - EAST.fork.z - 0.5) > 0.6; t++) w.tick();
    expect(Math.hypot(w.player.x - EAST.fork.x - 0.5, w.player.z - EAST.fork.z - 0.5)).toBeLessThan(0.6);
  });
});
