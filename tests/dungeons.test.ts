import { describe, expect, it } from 'vitest';
import { GameWorld, type SaveData } from '../src/sim/world';
import { generateWorld, isBlocked, inHollow } from '../src/sim/worldmap';
import { DUNGEON_AREAS, chestOf, dungeonAt, type DungeonId } from '../src/sim/dungeonmap';
import { zoneArea, zoneFor } from '../src/sim/zones';
import { findPath } from '../src/sim/pathfinding';
import { DUNGEONS } from '../src/data/dungeons';
import { xpForLevel } from '../src/data/skills';

const map = generateWorld(1337);
const run = (w: GameWorld, s: number) => {
  for (let t = 0; t < s * 30; t++) w.tick();
};
const stand = (w: GameWorld, x: number, z: number) => {
  w.player.x = w.player.prevX = x;
  w.player.z = w.player.prevZ = z;
};
/** Walks to a passage and goes through it; returns the messages said on the way. */
function goThrough(w: GameWorld, id: string) {
  const d = w.doorways.find((x) => x.def.id === id)!;
  // Start beside it (each passage's arrival point is the open tile next to it).
  stand(w, d.def.arriveX, d.def.arriveZ);
  w.drainEvents();
  w.issue({ type: 'interact', target: d.id });
  run(w, 3);
  return w.drainEvents().flatMap((e) => (e.type === 'message' ? [e.text] : []));
}
/** A character who meets both dungeons' requirements. */
function veteran(w: GameWorld) {
  for (const q of ['elders_request', 'lanterns_of_heronwick', 'ninefold_watch']) w.player.quests[q] = { stage: 9, kills: 0, done: true };
  for (const s of ['attack', 'strength', 'defence', 'hitpoints'] as const) w.player.skills.addXp(s, xpForLevel(45));
  return w;
}

describe('4C.1 the dungeons’ shape', () => {
  for (const id of Object.keys(DUNGEON_AREAS) as DungeonId[]) {
    it(`${id}: every open tile can be reached from the way in (stairs included), and nothing is in a wall`, () => {
      const d = DUNGEON_AREAS[id];
      const out = map.passages.find((p) => p.id === `${id}_out`)!;
      const W = map.width;
      const seen = new Set<number>();
      const stack = [Math.floor(out.arriveZ) * W + Math.floor(out.arriveX)];
      const jumps = map.passages.filter((p) => dungeonAt(p.x, p.z) === id && p.id !== `${id}_out`);
      while (stack.length) {
        const i = stack.pop()!;
        if (seen.has(i)) continue;
        seen.add(i);
        const x = i % W;
        const z = Math.floor(i / W);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = (z + dz) * W + x + dx;
          if (!map.blocked[n]) stack.push(n);
          // A stair next to this tile leads to its other end.
          const st = jumps.find((p) => Math.floor(p.x) === x + dx && Math.floor(p.z) === z + dz);
          if (st) {
            const other = map.passages.find((p) => p.id === st.to)!;
            stack.push(Math.floor(other.arriveZ) * W + Math.floor(other.arriveX));
          }
        }
      }
      let open = 0;
      for (let z = d.z; z < d.z + d.layout.length; z++) for (let x = d.x; x < d.x + d.layout[0].length; x++) {
        if (map.blocked[z * W + x]) continue;
        open++;
        expect(seen.has(z * W + x), `${x},${z} cut off`).toBe(true);
      }
      expect(open).toBeGreaterThan(150);
      for (const e of map.enemySpawns.filter((e) => dungeonAt(e.x, e.z) === id)) expect(isBlocked(map, e.x, e.z), `${e.type} in a wall`).toBe(false);
      const chest = chestOf(id);
      expect(isBlocked(map, chest.x, chest.z)).toBe(true);
      expect([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => seen.has(Math.floor(chest.z + b) * W + Math.floor(chest.x + a)))).toBe(true);
    });
  }

  it('each holds its boss, and each door stands at its landmark and can be walked to from the village', () => {
    expect(map.enemySpawns.filter((e) => e.type === 'shrinekeeper').map((e) => dungeonAt(e.x, e.z))).toEqual(['sunken_shrine']);
    expect(map.enemySpawns.filter((e) => e.type === 'watchcaptain').map((e) => dungeonAt(e.x, e.z))).toEqual(['old_watchtower']);
    for (const id of Object.keys(DUNGEON_AREAS) as DungeonId[]) {
      const door = map.passages.find((p) => p.id === `${id}_door`)!;
      expect(door.requires).toBe(id);
      expect(isBlocked(map, door.x, door.z), `${id} door tile`).toBe(true);
      expect(map.decor.some((d) => d.kind === DUNGEONS[id].landmark && Math.hypot(d.x - door.x, d.z - door.z) < 2)).toBe(true);
      expect(findPath(map, map.spawn.x, map.spawn.z, door.arriveX, door.arriveZ, 200_000), id).not.toBeNull();
    }
  });

  it('the dungeons are far from every coast (out of sight, beyond the fog)', () => {
    for (const d of Object.values(DUNGEON_AREAS)) {
      for (let z = d.z - 18; z < d.z; z++) for (let x = d.x - 4; x < d.x + d.layout[0].length + 4; x++) expect(map.blocked[z * map.width + x] && !dungeonAt(x, z) && !inHollow(x, z), `${x},${z}`).toBeTruthy();
    }
  });
});

describe('4C.1 doors, zones and the way in and out', () => {
  it('the door stays shut without the requirements, and says what is missing', () => {
    const w = new GameWorld({ map, clock: () => 0 });
    const said = goThrough(w, 'sunken_shrine_door');
    expect(dungeonAt(w.player.x, w.player.z)).toBeNull();
    expect(said.join(' ')).toMatch(/won’t move\. You need Lanterns of Heronwick, combat level 30/);
  });

  it('with them, you go in, find yourself in the dungeon’s zone, climb the tower and come back out', () => {
    const w = veteran(new GameWorld({ map, clock: () => 0 }));
    const said = goThrough(w, 'old_watchtower_door');
    expect(dungeonAt(w.player.x, w.player.z)).toBe('old_watchtower');
    expect(zoneFor(w.player.x, w.player.z, w.player.id)).toBe('old_watchtower');
    expect(said.join(' ')).toMatch(/You step into The Old Watchtower/);
    goThrough(w, 'tower_up_1');
    goThrough(w, 'tower_up_2');
    const roof = w.player.x;
    expect(roof).toBeGreaterThan(DUNGEON_AREAS.old_watchtower.x + 22);
    goThrough(w, 'tower_down_roof');
    goThrough(w, 'tower_down_2');
    goThrough(w, 'old_watchtower_out');
    expect(dungeonAt(w.player.x, w.player.z)).toBeNull();
    expect(Math.hypot(w.player.x - 181.5, w.player.z - 22.5)).toBeLessThan(0.6);
  });

  it('each dungeon zone runs only its own creatures, and the island none of them', () => {
    const shrine = new GameWorld({ noPlayer: true, map, clock: () => 0, area: zoneArea('sunken_shrine') });
    const island = new GameWorld({ noPlayer: true, map, clock: () => 0, area: zoneArea('brightwater') });
    expect(shrine.enemies.length).toBeGreaterThan(8);
    expect(shrine.enemies.every((e) => dungeonAt(e.spawnX, e.spawnZ) === 'sunken_shrine')).toBe(true);
    expect(island.enemies.some((e) => dungeonAt(e.spawnX, e.spawnZ))).toBe(false);
  });

  it('a save made inside a dungeon loads inside it', () => {
    const w = veteran(new GameWorld({ map, clock: () => 0 }));
    goThrough(w, 'sunken_shrine_door');
    const save = JSON.parse(JSON.stringify(w.save())) as SaveData;
    const w2 = new GameWorld({ save, map, clock: () => 0 });
    expect(dungeonAt(w2.player.x, w2.player.z)).toBe('sunken_shrine');
  });
});
