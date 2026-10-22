import { describe, expect, it } from 'vitest';
import { GameWorld, type SaveData } from '../src/sim/world';
import { HOLLOW, HOLLOW_LAYOUT, inHollow, isBlocked, regionAt } from '../src/sim/worldmap';
import { findPath } from '../src/sim/pathfinding';
import { LANTERN_SECONDS } from '../src/data/hollow';
import { xpForLevel } from '../src/data/skills';

const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds * 30; t++) w.tick();
};
const messages = (w: GameWorld) => w.drainEvents().filter((e) => e.type === 'message').map((e) => (e as { text: string }).text);
const door = (w: GameWorld, id: string) => w.doorways.find((d) => d.def.id === id)!;
/** Walks through a passage from just beside it. */
function go(w: GameWorld, id: string) {
  const d = door(w, id);
  const p = w.player;
  const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => ({ x: d.x + a, z: d.z + b })).find((s) => !isBlocked(w.map, s.x, s.z))!;
  p.x = p.prevX = spot.x;
  p.z = p.prevZ = spot.z;
  w.issue({ type: 'interact', target: d.id });
  run(w, 1.5);
}

describe('Glimmer Hollow', () => {
  it('a cave mouth on the Ironcrag slopes leads down; the cave is reached only through it', () => {
    const w = new GameWorld();
    const map = w.map;
    const mouth = door(w, 'hollow_mouth');
    const up = door(w, 'hollow_up');
    expect(regionAt(mouth.x, mouth.z)?.id).toBe('hills');
    expect(inHollow(up.x, up.z)).toBe(true);
    expect(findPath(map, map.spawn.x, map.spawn.z, mouth.def.arriveX, mouth.def.arriveZ, 20000)).not.toBeNull();
    expect(findPath(map, map.spawn.x, map.spawn.z, up.def.arriveX, up.def.arriveZ, 20000)).toBeNull();
    // Every ore and creature inside can be reached from the foot of the ladder.
    const inside = [...map.resources.filter((r) => inHollow(r.x, r.z)).map((r) => ({ x: r.x + 0.5, z: r.z + 0.5 })), ...map.enemySpawns.filter((e) => inHollow(e.x, e.z))];
    // 7 ore veins and 4 gloom slimes.
    expect(inside.length).toBe(11);
    for (const t of inside) expect(findPath(map, up.def.arriveX, up.def.arriveZ, t.x, t.z, 20000), `${t.x},${t.z}`).not.toBeNull();
    expect(HOLLOW_LAYOUT.every((r) => r.length === HOLLOW_LAYOUT[0].length)).toBe(true);
    expect(inHollow(HOLLOW.x, HOLLOW.z)).toBe(true);
  });

  it('in and out through the passages', () => {
    const w = new GameWorld();
    go(w, 'hollow_mouth');
    expect(inHollow(w.player.x, w.player.z)).toBe(true);
    go(w, 'hollow_up');
    const mouth = door(w, 'hollow_mouth');
    expect(Math.hypot(w.player.x - mouth.def.arriveX, w.player.z - mouth.def.arriveZ)).toBeLessThan(0.01);
  });

  it('without a lit glowcap lantern it is too dark to mine or fight', () => {
    const w = new GameWorld();
    const p = w.player;
    p.skills.addXp('mining', xpForLevel(40));
    go(w, 'hollow_mouth');
    expect(w.isLit()).toBe(false);
    const iron = w.nodes.find((n) => n.def.id === 'iron_rock' && inHollow(n.x, n.z))!;
    w.drainEvents();
    w.issue({ type: 'interact', target: iron.id });
    expect(messages(w).some((m) => m.includes('too dark'))).toBe(true);
    expect(p.action).toBeNull();
    const slime = w.enemies.find((e) => e.def.id === 'gloom_slime')!;
    w.issue({ type: 'interact', target: slime.id });
    run(w, 3);
    expect(slime.hp).toBe(slime.def.maxHp);
  });

  it('a lantern burns one glowcap from the bag every four minutes underground', () => {
    const w = new GameWorld();
    const p = w.player;
    p.inventory.add('glowcap_lantern', 1);
    p.inventory.add('cabbage', 2);
    p.skills.addXp('mining', xpForLevel(40));
    // On the surface it doesn't burn.
    run(w, 10);
    expect(p.inventory.count('cabbage')).toBe(2);
    go(w, 'hollow_mouth');
    expect(w.isLit()).toBe(true);
    expect(p.inventory.count('cabbage')).toBe(1);
    // Mining works by lantern light (with the slimes out of the way for this test).
    for (const e of w.enemies) if (e.def.id === 'gloom_slime') {
      e.state = 'dead';
      e.respawnTimer = 999;
    }
    const iron = w.nodes.find((n) => n.def.id === 'iron_rock' && inHollow(n.x, n.z))!;
    const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => ({ x: iron.x + a, z: iron.z + b })).find((s) => !isBlocked(w.map, s.x, s.z))!;
    p.x = p.prevX = spot.x;
    p.z = p.prevZ = spot.z;
    (w as unknown as { rng: () => number }).rng = () => 0.52;
    w.issue({ type: 'interact', target: iron.id });
    run(w, 4);
    expect(p.inventory.count('iron_ore')).toBeGreaterThan(0);
    // The light survives a save, and the next glowcap goes in when it runs out.
    const w2 = new GameWorld({ save: JSON.parse(JSON.stringify(w.save())) as SaveData });
    expect(w2.player.lanternBurn).toBeCloseTo(p.lanternBurn, 0);
    w2.player.lanternBurn = 1;
    run(w2, 2);
    expect(w2.player.inventory.count('cabbage')).toBe(0);
    expect(w2.isLit()).toBe(true);
    w2.drainEvents();
    w2.player.lanternBurn = 1;
    run(w2, 2);
    expect(w2.isLit()).toBe(false);
    expect(messages(w2).some((m) => m.includes('gutters out'))).toBe(true);
    expect(LANTERN_SECONDS).toBe(240);
  });

  it('the lantern is made at the furnace from a bronze bar and a glowcap (Crafting 12)', () => {
    const w = new GameWorld();
    const p = w.player;
    p.skills.addXp('crafting', xpForLevel(12));
    p.inventory.add('bronze_bar', 1);
    p.inventory.add('cabbage', 1);
    const furnace = w.stations.find((s) => s.kind === 'furnace')!;
    p.x = p.prevX = furnace.x;
    p.z = p.prevZ = furnace.z + 1.2;
    w.issue({ type: 'interact', target: furnace.id });
    run(w, 0.5);
    w.issue({ type: 'craft', recipe: 'glowcap_lantern', count: 1 });
    run(w, 3);
    expect(p.inventory.count('glowcap_lantern')).toBe(1);
  });
});
