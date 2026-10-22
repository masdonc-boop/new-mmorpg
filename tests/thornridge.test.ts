import { describe, expect, it } from 'vitest';
import { GameWorld, type Enemy, type SaveData } from '../src/sim/world';
import { isBlocked, tileAt, T } from '../src/sim/worldmap';
import { findPath } from '../src/sim/pathfinding';
import { xpForLevel } from '../src/data/skills';
import { itemDef, type ItemId } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { SHOPS } from '../src/data/shops';
import { ENEMIES } from '../src/data/enemies';
import { EAST } from '../src/sim/eastreach';

const run = (w: GameWorld, s: number) => {
  for (let t = 0; t < s * 30; t++) w.tick();
};
const setRng = (w: GameWorld, v: number) => ((w as unknown as { rng: () => number }).rng = () => v);
const stand = (w: GameWorld, x: number, z: number) => {
  w.player.x = w.player.prevX = x;
  w.player.z = w.player.prevZ = z;
};
const slotOf = (w: GameWorld, item: ItemId) => w.player.inventory.slots.findIndex((s) => s?.item === item);
const SIDES = [[1.1, 0], [-1.1, 0], [0, 1.1], [0, -1.1]];
/** Stand on an open side of something and interact with it. */
function use(w: GameWorld, target: { id: number; x: number; z: number }) {
  const [a, b] = SIDES.find(([x, z]) => !isBlocked(w.map, target.x + x, target.z + z))!;
  stand(w, target.x + a, target.z + b);
  w.drainEvents();
  w.issue({ type: 'interact', target: target.id });
  run(w, 0.3);
  return w.drainEvents();
}
const npc = (w: GameWorld, id: string) => w.npcs.find((n) => n.def.id === id)!;
const kill = (w: GameWorld, e: Enemy) => (w as unknown as { damageEnemy: (e: Enemy, d: number, hit: boolean, s: string) => void }).damageEnemy(e, e.hp, true, 'melee');
const reachableFromSpawn = (w: GameWorld, x: number, z: number) =>
  SIDES.some(([a, b]) => !isBlocked(w.map, x + a, z + b) && !!findPath(w.map, w.map.spawn.x, w.map.spawn.z, x + a, z + b, 200_000));

describe('4A.3 Cairnhold: a working outpost', () => {
  const w = new GameWorld();

  it('the warden, silversmith, banker and shepherd are in Cairnhold and can be reached on foot', () => {
    for (const id of ['warden', 'silversmith', 'cairn_banker', 'shepherd']) {
      const n = npc(w, id);
      expect(n, id).toBeTruthy();
      expect(Math.hypot(n.x - EAST.cairnhold.x, n.z - EAST.cairnhold.z), id).toBeLessThan(14);
      expect(reachableFromSpawn(w, n.x, n.z), id).toBe(true);
    }
  });

  it('the banker opens the bank, the silversmith her shop; the furnace and waystone work', () => {
    expect(use(w, npc(w, 'cairn_banker')).some((e) => e.type === 'bankOpen')).toBe(true);
    w.issue({ type: 'bankClose' });
    expect(use(w, npc(w, 'silversmith')).find((e) => e.type === 'shopOpen')).toMatchObject({ shop: 'cairnhold' });
    w.issue({ type: 'shopClose' });
    expect(SHOPS.cairnhold.stock.map((s) => s.item)).toContain('chisel');
    const furnace = w.stations.find((s) => s.kind === 'furnace' && Math.hypot(s.x - EAST.cairnhold.x, s.z - EAST.cairnhold.z) < 10)!;
    expect(reachableFromSpawn(w, furnace.x, furnace.z)).toBe(true);
    const cp = w.map.checkpoints.find((c) => c.id === 'cairnhold')!;
    stand(w, cp.respawnX, cp.respawnZ);
    run(w, 0.2);
    expect(w.player.checkpoints.has('cairnhold')).toBe(true);
  });
});

describe('4A.3 Thornridge: landmarks, spawns and resources', () => {
  const w = new GameWorld();
  const inHighlands = (x: number, z: number) => x > 112 && z < 56;

  it('nine standing stones ring the high road at the Ninefold Stones; the Old Watchtower stands barred', () => {
    const stones = w.map.decor.filter((d) => d.kind === 'standing_stone');
    expect(stones.length).toBe(9);
    for (const s of stones) expect(Math.hypot(s.x - EAST.ninefold.x - 0.5, s.z - EAST.ninefold.z - 0.5)).toBeCloseTo(3.6, 1);
    // The road through the ring stays open.
    expect(findPath(w.map, w.map.spawn.x, w.map.spawn.z, EAST.ninefold.x + 0.5, EAST.ninefold.z + 0.5, 200_000)).not.toBeNull();
    const tower = w.map.decor.find((d) => d.kind === 'watchtower')!;
    expect(isBlocked(w.map, tower.x, tower.z)).toBe(true);
    expect(reachableFromSpawn(w, tower.x + 1, tower.z + 1.5)).toBe(true);
  });

  it('creatures spawn on open ground (not in water, rock walls, roads or the outpost) and can be reached', () => {
    const here = w.enemies.filter((e) => inHighlands(e.spawnX, e.spawnZ));
    const count = (id: string) => here.filter((e) => e.def.id === id).length;
    expect(count('bristleback')).toBe(8);
    expect(count('ridge_stalker')).toBe(6);
    expect(count('greymane')).toBe(1);
    for (const e of here) {
      expect(isBlocked(w.map, e.spawnX, e.spawnZ), `${e.def.id} at ${e.spawnX},${e.spawnZ}`).toBe(false);
      expect([T.Water, T.Bridge, T.Path, T.Plaza]).not.toContain(tileAt(w.map, e.spawnX, e.spawnZ));
      expect(Math.hypot(e.spawnX - EAST.cairnhold.x, e.spawnZ - EAST.cairnhold.z)).toBeGreaterThan(8);
      expect(reachableFromSpawn(w, e.spawnX, e.spawnZ), `${e.def.id} reachable`).toBe(true);
    }
  });

  it('silver veins sit in the crags and clear pools at the tarn, each with somewhere to stand', () => {
    const veins = w.nodes.filter((n) => n.def.id === 'silver_vein');
    expect(veins.length).toBeGreaterThanOrEqual(8);
    for (const n of veins) {
      expect(tileAt(w.map, n.x, n.z)).toBe(T.Rocky);
      expect(reachableFromSpawn(w, n.x, n.z), `vein at ${n.x},${n.z}`).toBe(true);
    }
    const tarn = w.nodes.filter((n) => n.def.id === 'rod_spot' && n.x > 112);
    expect(tarn.length).toBe(2);
    for (const n of tarn) expect(reachableFromSpawn(w, n.x, n.z)).toBe(true);
  });
});

describe('4A.3 the silver chain, joining the two regions', () => {
  it('silver ore (Mining 30) → silver bar at Cairnhold’s furnace (Smithing 30) → band (Crafting 30) and, with a marsh pearl, the Mirepearl amulet (Crafting 34)', () => {
    const w = new GameWorld();
    const p = w.player;
    setRng(w, 0.01);
    const vein = w.nodes.find((n) => n.def.id === 'silver_vein')!;
    use(w, vein);
    run(w, 3);
    expect(p.inventory.count('silver_ore')).toBe(0);
    p.skills.addXp('mining', xpForLevel(30));
    use(w, vein);
    run(w, 3);
    expect(p.inventory.count('silver_ore')).toBeGreaterThan(0);
    w.issue({ type: 'moveTo', x: p.x, z: p.z });

    p.inventory.remove('silver_ore', 99);
    p.inventory.add('silver_ore', 3);
    p.inventory.add('marsh_pearl', 1);
    p.skills.addXp('smithing', xpForLevel(30));
    p.skills.addXp('crafting', xpForLevel(34));
    use(w, w.stations.find((s) => s.kind === 'furnace' && Math.hypot(s.x - EAST.cairnhold.x, s.z - EAST.cairnhold.z) < 10)!);
    w.issue({ type: 'craft', recipe: 'silver_bar', count: 3 });
    run(w, 7);
    expect(p.inventory.count('silver_bar')).toBe(3);
    w.issue({ type: 'craft', recipe: 'silver_ring', count: 1 });
    run(w, 3);
    w.issue({ type: 'craft', recipe: 'mirepearl_amulet', count: 1 });
    run(w, 3);
    expect(p.inventory.count('silver_ring')).toBe(1);
    expect(p.inventory.count('mirepearl_amulet')).toBe(1);
    expect(p.inventory.count('marsh_pearl')).toBe(0);
    w.issue({ type: 'equip', slot: slotOf(w, 'silver_ring') });
    w.issue({ type: 'equip', slot: slotOf(w, 'mirepearl_amulet') });
    expect(p.equipment.get('ring')).toBe('silver_ring');
    expect(p.equipment.get('neck')).toBe('mirepearl_amulet');
    expect(RECIPES.mirepearl_amulet.inputs.map((i) => i.item)).toEqual(['silver_bar', 'marsh_pearl']);
    for (const id of ['silver_ore', 'silver_bar', 'silver_ring', 'mirepearl_amulet'] as ItemId[]) expect(itemDef(id).value).toBeGreaterThan(0);
  });
});

describe('4A.3 Thornridge creatures', () => {
  it('boars and stalkers attack newcomers, ignore veterans; Greymane fights anyone', () => {
    const fresh = new GameWorld();
    const boar = fresh.enemies.find((e) => e.def.id === 'bristleback')!;
    stand(fresh, boar.x + 1.5, boar.z);
    run(fresh, 1);
    expect(boar.state).toBe('chase');

    const w = new GameWorld();
    for (const s of ['attack', 'strength', 'defence', 'hitpoints'] as const) w.player.skills.addXp(s, xpForLevel(75));
    const stalker = w.enemies.find((e) => e.def.id === 'ridge_stalker')!;
    stand(w, stalker.x + 1.5, stalker.z);
    run(w, 1);
    expect(stalker.state).not.toBe('chase');
    const grey = w.enemies.find((e) => e.def.id === 'greymane')!;
    stand(w, grey.x + 2, grey.z);
    run(w, 1);
    expect(grey.state).toBe('chase');
    expect(ENEMIES.greymane.boss).toBe(true);
  });
});

describe('4A.3 The Ninefold Watch', () => {
  it('runs end to end, and its progress survives a save', () => {
    const w = new GameWorld();
    const p = w.player;
    const warden = npc(w, 'warden');
    const offer = use(w, warden).find((e) => e.type === 'dialogue');
    expect(offer && offer.type === 'dialogue' && offer.dialogue.offer?.quest).toBe('ninefold_watch');
    w.issue({ type: 'acceptQuest', quest: 'ninefold_watch' });
    for (const e of w.enemies.filter((x) => x.def.id === 'ridge_stalker').slice(0, 4)) kill(w, e);
    expect(w.npcMarker('warden')).toBe('ready');
    use(w, warden);
    expect(w.questProgress('ninefold_watch')?.stage).toBe(2);
    p.inventory.add('silver_bar', 2);
    use(w, warden);
    expect(w.questProgress('ninefold_watch')?.stage).toBe(3);
    expect(p.inventory.count('silver_bar')).toBe(0);

    const save = JSON.parse(JSON.stringify(w.save())) as SaveData;
    const w2 = new GameWorld({ save, map: w.map });
    expect(w2.questProgress('ninefold_watch')?.stage).toBe(3);
    kill(w2, w2.enemies.find((e) => e.def.id === 'greymane')!);
    const coins = w2.player.inventory.count('coins');
    use(w2, npc(w2, 'warden'));
    expect(w2.questProgress('ninefold_watch')?.done).toBe(true);
    expect(w2.player.inventory.count('coins')).toBe(coins + 1800);
    expect(w2.player.inventory.count('silver_ring')).toBe(1);
  });

  it('both regional quests can be in progress at once without crossing wires', () => {
    const w = new GameWorld();
    use(w, npc(w, 'warden'));
    w.issue({ type: 'acceptQuest', quest: 'ninefold_watch' });
    use(w, npc(w, 'reeve'));
    w.issue({ type: 'acceptQuest', quest: 'lanterns_of_heronwick' });
    for (const e of w.enemies.filter((x) => x.def.id === 'ridge_stalker').slice(0, 4)) kill(w, e);
    expect(w.questProgress('ninefold_watch')?.kills).toBe(4);
    expect(w.questProgress('lanterns_of_heronwick')?.kills).toBe(0);
    expect(w.npcMarker('reeve')).toBe('progress');
    expect(w.npcMarker('warden')).toBe('ready');
  });
});
