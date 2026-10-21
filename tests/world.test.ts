import { describe, expect, it } from 'vitest';
import { GameWorld } from '../src/sim/world';
import { findPath } from '../src/sim/pathfinding';
import { T, generateWorld, isBlocked, tileAt } from '../src/sim/worldmap';

const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds * 30; t++) w.tick();
};

describe('World generation', () => {
  const map = generateWorld(1337);

  it('is deterministic', () => {
    const b = generateWorld(1337);
    expect(Array.from(b.tiles)).toEqual(Array.from(map.tiles));
    expect(b.resources.length).toBe(map.resources.length);
  });

  it('places the spawn and checkpoints on walkable ground', () => {
    expect(isBlocked(map, map.spawn.x, map.spawn.z)).toBe(false);
    for (const c of map.checkpoints) expect(isBlocked(map, c.respawnX, c.respawnZ)).toBe(false);
  });

  it('has enough content of every kind', () => {
    const count = (t: string) => map.resources.filter((r) => r.type === t).length;
    expect(count('tree')).toBeGreaterThan(30);
    expect(count('oak')).toBeGreaterThan(5);
    expect(count('copper_rock')).toBeGreaterThan(3);
    expect(count('tin_rock')).toBeGreaterThan(3);
    expect(count('iron_rock')).toBeGreaterThan(3);
    expect(map.enemySpawns.filter((e) => e.type === 'slime').length).toBe(10);
    expect(map.tiles.some((t) => t === T.Bridge)).toBe(true);
  });

  it('connects the village to every enemy, resource cluster and NPC', () => {
    const s = map.spawn;
    for (const e of map.enemySpawns) {
      expect(findPath(map, s.x, s.z, e.x, e.z, 20000), `enemy ${e.type} at ${e.x},${e.z}`).not.toBeNull();
    }
    for (const n of map.npcs) expect(findPath(map, s.x, s.z, n.x, n.z, 20000), n.id).not.toBeNull();
    for (const c of map.checkpoints) expect(findPath(map, s.x, s.z, c.respawnX, c.respawnZ, 20000), c.id).not.toBeNull();
    let unreachable = 0;
    for (const r of map.resources) if (!findPath(map, s.x, s.z, r.x + 0.5, r.z + 0.5, 20000)) unreachable++;
    expect(unreachable / map.resources.length).toBeLessThan(0.05);
  });

  it('crosses the river by bridge to the west meadow', () => {
    const slime = map.enemySpawns.find((e) => e.type === 'slime')!;
    const path = findPath(map, map.spawn.x, map.spawn.z, slime.x, slime.z, 20000)!;
    expect(path.some((p) => tileAt(map, p.x, p.z) === T.Bridge)).toBe(true);
  });
});

describe('Simulation', () => {
  it('moves the player with the joystick and collides with scenery', () => {
    const w = new GameWorld();
    const p = w.player;
    const x0 = p.x;
    w.issue({ type: 'joystick', dx: 1, dz: 0 });
    run(w, 0.5);
    expect(p.x).toBeGreaterThan(x0 + 1);
    w.issue({ type: 'joystick', dx: 0, dz: 0 });
    // Walk into the fountain for a while; we must never end up inside a blocked tile.
    for (let i = 0; i < 120; i++) {
      w.issue({ type: 'joystick', dx: 0, dz: -1 });
      w.tick();
      expect(isBlocked(w.map, p.x, p.z)).toBe(false);
    }
  });

  it('walks to a tapped location', () => {
    const w = new GameWorld();
    const p = w.player;
    w.issue({ type: 'moveTo', x: 60.5, z: 68.5 });
    run(w, 4);
    expect(Math.hypot(p.x - 60.5, p.z - 68.5)).toBeLessThan(0.1);
  });

  it('chops a tree automatically, gaining logs and woodcutting xp', () => {
    const w = new GameWorld();
    const tree = w.nodes
      .filter((n) => n.def.id === 'tree')
      .sort((a, b) => Math.hypot(a.x - 56, a.z - 66) - Math.hypot(b.x - 56, b.z - 66))[0];
    w.issue({ type: 'interact', target: tree.id });
    run(w, 40);
    expect(w.player.inventory.count('logs')).toBeGreaterThan(0);
    expect(w.player.skills.xp.woodcutting).toBeGreaterThan(0);
  });

  it('completes the introductory quest end to end', () => {
    const w = new GameWorld();
    const p = w.player;
    const elder = w.npcs.find((n) => n.def.id === 'elder')!;
    expect(w.npcMarker('elder')).toBe('available');
    w.issue({ type: 'interact', target: elder.id });
    run(w, 6);
    const events = w.drainEvents();
    const dlg = events.find((e) => e.type === 'dialogue');
    expect(dlg && dlg.type === 'dialogue' && dlg.dialogue.offer?.quest).toBe('elders_request');
    w.issue({ type: 'acceptQuest', quest: 'elders_request' });
    expect(w.questProgress('elders_request')?.stage).toBe(1);
    expect(w.npcMarker('elder')).toBe('progress');

    p.inventory.add('logs', 5);
    expect(w.npcMarker('elder')).toBe('ready');
    w.issue({ type: 'interact', target: elder.id });
    run(w, 3);
    expect(w.questProgress('elders_request')?.stage).toBe(2);
    expect(p.inventory.count('logs')).toBe(0);

    // Fight slimes: teleport near each one and attack until 3 are dead.
    p.skills.addXp('attack', 50000);
    p.skills.addXp('strength', 50000);
    let guard = 0;
    while ((w.questProgress('elders_request')?.kills ?? 0) < 3 && guard++ < 10) {
      const s = w.enemies.find((e) => e.def.id === 'slime' && e.alive)!;
      p.x = p.prevX = s.x + 1;
      p.z = p.prevZ = s.z;
      if (isBlocked(w.map, p.x, p.z)) {
        p.x = s.x;
        p.z = s.z + 1;
      }
      w.issue({ type: 'interact', target: s.id });
      run(w, 20);
    }
    expect(w.questProgress('elders_request')?.kills).toBe(3);
    expect(w.npcMarker('elder')).toBe('ready');
    p.x = elder.x;
    p.z = elder.z + 1.5;
    const coinsBefore = p.inventory.count('coins');
    w.issue({ type: 'interact', target: elder.id });
    run(w, 3);
    expect(w.questProgress('elders_request')?.done).toBe(true);
    expect(p.inventory.count('coins')).toBe(coinsBefore + 250);
    expect(w.npcMarker('elder')).toBeNull();
  });

  it('kills the player, keeps 3 items with the rest in a gravestone, and respawns at a chosen checkpoint', () => {
    const w = new GameWorld();
    const p = w.player;
    const boss = w.enemies.find((e) => e.def.id === 'goblin_warlord')!;
    const arrowsBefore = p.equipment.ammoQty + p.inventory.count('bronze_arrow');
    p.x = boss.x + 1;
    p.z = boss.z;
    p.hp = 5;
    run(w, 10);
    expect(p.dead).toBe(true);
    w.issue({ type: 'respawn', at: 'home' });
    expect(p.dead).toBe(false);
    expect(p.hp).toBe(p.maxHp);
    const inGrave = w.graves.reduce((n, g) => n + (g.items.find((i) => i.item === 'bronze_arrow')?.qty ?? 0), 0);
    expect(p.equipment.ammoQty + p.inventory.count('bronze_arrow') + inGrave).toBe(arrowsBefore);
    expect(w.graves.length).toBe(1);
    expect(Math.hypot(p.x - w.map.checkpoints[0].respawnX, p.z - w.map.checkpoints[0].respawnZ)).toBeLessThan(0.01);
  });

  it('offers respawn at the nearest attuned waystone', () => {
    const w = new GameWorld();
    const p = w.player;
    const meadow = w.map.checkpoints.find((c) => c.id === 'meadow')!;
    p.x = meadow.respawnX;
    p.z = meadow.respawnZ;
    w.tick();
    expect(p.checkpoints.has('meadow')).toBe(true);
    const slime = w.enemies.find((e) => e.def.id === 'slime')!;
    p.x = slime.x + 1;
    p.z = slime.z;
    p.hp = 1;
    w.issue({ type: 'interact', target: slime.id });
    for (let i = 0; i < 30 * 15 && !p.dead; i++) w.tick();
    expect(p.dead).toBe(true);
    expect(w.nearestCheckpoint().id).toBe('meadow');
    w.issue({ type: 'respawn', at: 'checkpoint' });
    expect(Math.hypot(p.x - meadow.respawnX, p.z - meadow.respawnZ)).toBeLessThan(0.01);
  });

  it('uses ranged ammo and grants ranged xp', () => {
    const w = new GameWorld();
    const p = w.player;
    w.issue({ type: 'setStyle', style: 'ranged' });
    const s = w.enemies.find((e) => e.def.id === 'slime')!;
    p.x = s.x + 3;
    p.z = s.z;
    if (isBlocked(w.map, p.x, p.z)) p.x = s.x - 3;
    // Bows fire from the worn ammo slot.
    const arrows = p.equipment.ammoQty;
    expect(arrows).toBe(60);
    w.issue({ type: 'interact', target: s.id });
    run(w, 8);
    expect(p.equipment.ammoQty).toBeLessThan(arrows);
    expect(p.skills.xp.ranged).toBeGreaterThan(0);
    expect(p.skills.xp.attack).toBe(0);
  });

  it('saves and restores progress', () => {
    const w = new GameWorld({ name: 'Rowan' });
    w.player.inventory.add('iron_ore', 4);
    w.grantXp('mining', 500);
    const data = JSON.parse(JSON.stringify(w.save()));
    const w2 = new GameWorld({ save: data });
    expect(w2.player.name).toBe('Rowan');
    expect(w2.player.inventory.count('iron_ore')).toBe(4);
    expect(w2.player.skills.xp.mining).toBe(500);
  });
});

describe('NPC patrols', () => {
  it('walks the guard along a fully walkable route and back', () => {
    const w = new GameWorld();
    const guard = w.npcs.find((n) => n.def.id === 'guard')!;
    expect(guard.patrol).not.toBeNull();
    const route = guard.patrol!;
    for (let i = 0; i < route.length; i++) {
      const a = route[i];
      const b = route[(i + 1) % route.length];
      for (let t = 0; t <= 1; t += 0.05) {
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        for (const [ox, oz] of [[0.28, 0], [-0.28, 0], [0, 0.28], [0, -0.28]]) expect(isBlocked(w.map, x + ox, z + oz)).toBe(false);
      }
    }
    // Keep the player far away so the guard is not distracted.
    w.player.x = w.player.prevX = 56.5;
    w.player.z = w.player.prevZ = 90.5;
    const seen = new Set<number>();
    let moved = 0;
    for (let i = 0; i < 30 * 40; i++) {
      const bx = guard.x;
      w.tick();
      if (guard.x !== bx) moved++;
      seen.add(guard.waypoint);
    }
    expect(moved).toBeGreaterThan(100);
    expect(seen.size).toBe(route.length);
  });

  it('stops patrolling to face the player during a conversation', () => {
    const w = new GameWorld();
    const guard = w.npcs.find((n) => n.def.id === 'guard')!;
    w.player.x = w.player.prevX = guard.x + 1.2;
    w.player.z = w.player.prevZ = guard.z;
    guard.waitTimer = 0;
    w.issue({ type: 'interact', target: guard.id });
    for (let i = 0; i < 30 * 3; i++) w.tick();
    const events = w.drainEvents();
    expect(events.some((e) => e.type === 'dialogue')).toBe(true);
    const x = guard.x;
    for (let i = 0; i < 30; i++) w.tick();
    expect(guard.x).toBe(x);
    expect(Math.abs(Math.atan2(w.player.x - guard.x, w.player.z - guard.z) - guard.facing) % (Math.PI * 2)).toBeLessThan(0.3);
  });
});
