import { describe, expect, it } from 'vitest';
import { GameWorld, type Enemy, type SaveData } from '../src/sim/world';
import { isBlocked, tileAt, T } from '../src/sim/worldmap';
import { findPath } from '../src/sim/pathfinding';
import { xpForLevel } from '../src/data/skills';
import { itemDef, type ItemId } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { FIRE_LOGS } from '../src/data/firemaking';
import { SHOPS } from '../src/data/shops';
import { ENEMIES } from '../src/data/enemies';
import { QUESTS } from '../src/data/quests';
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

describe('4A.2 Heronwick: a working village', () => {
  const w = new GameWorld();

  it('the reeve, provisioner, banker and fisher stand in Heronwick and can be reached on foot', () => {
    for (const id of ['reeve', 'provisioner', 'heron_banker', 'fisher']) {
      const n = npc(w, id);
      expect(n, id).toBeTruthy();
      expect(Math.hypot(n.x - EAST.heronwick.x, n.z - EAST.heronwick.z), id).toBeLessThan(14);
      expect(reachableFromSpawn(w, n.x, n.z), id).toBe(true);
    }
  });

  it('the banker opens the same bank; the provisioner opens Tull’s Provisions', () => {
    expect(use(w, npc(w, 'heron_banker')).some((e) => e.type === 'bankOpen')).toBe(true);
    w.issue({ type: 'bankClose' });
    const shop = use(w, npc(w, 'provisioner')).find((e) => e.type === 'shopOpen');
    expect(shop).toMatchObject({ shop: 'heronwick' });
    expect(SHOPS.heronwick.stock.map((s) => s.item)).toContain('fishing_rod');
    w.issue({ type: 'shopClose' });
  });

  it('the waystone attunes as you walk past it, and you can respawn there', () => {
    const cp = w.map.checkpoints.find((c) => c.id === 'heronwick')!;
    expect(cp).toBeTruthy();
    expect(isBlocked(w.map, cp.respawnX, cp.respawnZ)).toBe(false);
    stand(w, cp.respawnX, cp.respawnZ);
    run(w, 0.2);
    expect(w.player.checkpoints.has('heronwick')).toBe(true);
  });

  it('the village fire is a cooking station that can be reached', () => {
    const fire = w.stations.find((s) => s.kind === 'fire' && Math.hypot(s.x - EAST.heronwick.x, s.z - EAST.heronwick.z) < 10)!;
    expect(fire).toBeTruthy();
    expect(reachableFromSpawn(w, fire.x, fire.z)).toBe(true);
  });
});

describe('4A.2 Mirefen Marsh: nothing in walls or water, everything reachable', () => {
  const w = new GameWorld();
  const inMarsh = (x: number, z: number) => x > 112 && z > 70;

  it('creatures spawn on open marsh ground (not in water, walls, roads or the village)', () => {
    const marsh = w.enemies.filter((e) => inMarsh(e.spawnX, e.spawnZ));
    const count = (id: string) => marsh.filter((e) => e.def.id === id).length;
    expect(count('bog_croaker')).toBe(8);
    expect(count('mire_leech')).toBe(6);
    expect(count('bog_mother')).toBe(1);
    for (const e of marsh) {
      expect(isBlocked(w.map, e.spawnX, e.spawnZ), `${e.def.id} at ${e.spawnX},${e.spawnZ}`).toBe(false);
      expect([T.Water, T.Bridge, T.Path, T.Plaza]).not.toContain(tileAt(w.map, e.spawnX, e.spawnZ));
      expect(Math.hypot(e.spawnX - EAST.heronwick.x, e.spawnZ - EAST.heronwick.z)).toBeGreaterThan(8);
      expect(reachableFromSpawn(w, e.spawnX, e.spawnZ), `${e.def.id} reachable`).toBe(true);
    }
  });

  it('willows stand on the banks and mire pools sit in the water, each with somewhere to stand', () => {
    const willows = w.nodes.filter((n) => n.def.id === 'willow');
    const pools = w.nodes.filter((n) => n.def.id === 'mire_pool');
    expect(willows.length).toBeGreaterThanOrEqual(10);
    expect(pools.length).toBeGreaterThanOrEqual(5);
    for (const n of willows) {
      expect(tileAt(w.map, n.x, n.z)).toBe(T.Marsh);
      expect(reachableFromSpawn(w, n.x, n.z), `willow at ${n.x},${n.z}`).toBe(true);
    }
    for (const n of pools) {
      expect(tileAt(w.map, n.x, n.z)).toBe(T.Water);
      expect(reachableFromSpawn(w, n.x, n.z), `pool at ${n.x},${n.z}`).toBe(true);
    }
  });
});

describe('4A.2 Mirefen resource chains', () => {
  it('willow: Woodcutting 25 → willow shortbow (Fletching 30, wield at Ranged 25) and fires (Firemaking 25)', () => {
    const w = new GameWorld();
    const p = w.player;
    setRng(w, 0.01);
    const tree = w.nodes.find((n) => n.def.id === 'willow')!;
    use(w, tree);
    run(w, 3);
    expect(p.inventory.count('willow_logs')).toBe(0);
    p.skills.addXp('woodcutting', xpForLevel(25));
    use(w, tree);
    run(w, 3);
    expect(p.inventory.count('willow_logs')).toBeGreaterThan(0);
    w.issue({ type: 'moveTo', x: p.x, z: p.z });

    p.skills.addXp('fletching', xpForLevel(30));
    p.inventory.add('willow_logs', 1);
    p.inventory.add('bowstring', 1);
    w.issue({ type: 'craft', recipe: 'willow_shortbow_u', count: 1 });
    run(w, 2);
    w.issue({ type: 'craft', recipe: 'willow_shortbow', count: 1 });
    run(w, 2);
    expect(p.inventory.count('willow_shortbow')).toBe(1);
    w.issue({ type: 'equip', slot: slotOf(w, 'willow_shortbow') });
    expect(p.equipment.get('weapon')).not.toBe('willow_shortbow');
    p.skills.addXp('ranged', xpForLevel(25));
    w.issue({ type: 'equip', slot: slotOf(w, 'willow_shortbow') });
    expect(p.equipment.get('weapon')).toBe('willow_shortbow');
    expect(FIRE_LOGS.willow_logs).toEqual({ level: 25, xp: 70 });
  });

  it('silverpike: a mire pool, a rod and Fishing 28; cooked over Heronwick’s fire it heals 32', () => {
    const w = new GameWorld();
    const p = w.player;
    setRng(w, 0.01);
    const pool = w.nodes.find((n) => n.def.id === 'mire_pool')!;
    p.skills.addXp('fishing', xpForLevel(28));
    use(w, pool);
    run(w, 4);
    expect(p.inventory.count('raw_silverpike')).toBeGreaterThan(0);
    w.issue({ type: 'moveTo', x: p.x, z: p.z });

    p.skills.addXp('cooking', xpForLevel(46));
    const fire = w.stations.find((s) => s.kind === 'fire' && Math.hypot(s.x - EAST.heronwick.x, s.z - EAST.heronwick.z) < 10)!;
    use(w, fire);
    const raw = p.inventory.count('raw_silverpike');
    w.issue({ type: 'craft', recipe: 'silverpike', count: raw });
    run(w, raw * 2.5 + 1);
    expect(p.inventory.count('silverpike')).toBe(raw);
    expect(itemDef('silverpike').heal).toBe(32);
    expect(RECIPES.silverpike).toMatchObject({ level: 26, station: 'range' });
    p.hp = 10;
    w.issue({ type: 'useItem', slot: slotOf(w, 'silverpike') });
    expect(p.hp).toBe(42);
  });

  it('new items are ordinary tradeable items with a value (shops buy them; the Exchange can list them)', () => {
    for (const id of ['willow_logs', 'willow_shortbow', 'raw_silverpike', 'silverpike', 'marsh_pearl', 'mire_oil'] as ItemId[]) {
      expect(itemDef(id).value, id).toBeGreaterThan(0);
    }
  });
});

describe('4A.2 Mirefen creatures', () => {
  it('croakers leave you alone; leeches hunt the unwary; the Bog Mother fights anyone who comes close', () => {
    const w = new GameWorld();
    const p = w.player;
    for (const s of ['attack', 'strength', 'defence', 'hitpoints'] as const) p.skills.addXp(s, xpForLevel(60));
    const croaker = w.enemies.find((e) => e.def.id === 'bog_croaker')!;
    const leech = w.enemies.find((e) => e.def.id === 'mire_leech')!;
    const mother = w.enemies.find((e) => e.def.id === 'bog_mother')!;
    expect(ENEMIES.bog_croaker.aggressive).toBe(false);
    expect(ENEMIES.bog_mother.boss).toBe(true);
    stand(w, croaker.x + 1, croaker.z);
    run(w, 1);
    expect(croaker.state).not.toBe('chase');
    // A strong hero walks past the leeches unbothered, but never past the Bog Mother.
    stand(w, leech.x + 1.5, leech.z);
    run(w, 1);
    expect(leech.state).not.toBe('chase');
    stand(w, mother.x + 2, mother.z);
    run(w, 1);
    expect(mother.state).toBe('chase');
    // A newcomer gets the leeches' attention.
    const fresh = new GameWorld();
    const l2 = fresh.enemies.find((e) => e.def.id === 'mire_leech')!;
    stand(fresh, l2.x + 1.5, l2.z);
    run(fresh, 1);
    expect(l2.state).toBe('chase');
  });

  it('leeches drop mire oil and the Bog Mother drops marsh pearls', () => {
    expect(ENEMIES.mire_leech.drops.find((d) => d.item === 'mire_oil')!.chance).toBeGreaterThan(0.5);
    expect(ENEMIES.bog_mother.drops.find((d) => d.item === 'marsh_pearl')!.chance).toBeGreaterThan(0.5);
  });
});

describe('4A.2 Lanterns of Heronwick', () => {
  it('runs end to end, and its progress survives a save', () => {
    const w = new GameWorld();
    const p = w.player;
    const reeve = npc(w, 'reeve');
    const offer = use(w, reeve).find((e) => e.type === 'dialogue');
    expect(offer && offer.type === 'dialogue' && offer.dialogue.offer?.quest).toBe('lanterns_of_heronwick');
    w.issue({ type: 'acceptQuest', quest: 'lanterns_of_heronwick' });
    expect(w.questProgress('lanterns_of_heronwick')?.stage).toBe(1);
    expect(w.npcMarker('reeve')).toBe('progress');

    p.inventory.add('willow_logs', 4);
    expect(w.npcMarker('reeve')).toBe('ready');
    use(w, reeve);
    expect(p.inventory.count('willow_logs')).toBe(0);
    expect(w.questProgress('lanterns_of_heronwick')?.stage).toBe(2);

    const leeches = w.enemies.filter((e) => e.def.id === 'mire_leech');
    for (const e of leeches.slice(0, 5)) kill(w, e);
    expect(w.questProgress('lanterns_of_heronwick')?.kills).toBe(5);
    use(w, reeve);
    expect(w.questProgress('lanterns_of_heronwick')?.stage).toBe(3);

    // Save and load mid-quest: the stage and the oil carry over.
    p.inventory.add('mire_oil', 4);
    const save = JSON.parse(JSON.stringify(w.save())) as SaveData;
    const w2 = new GameWorld({ save, map: w.map });
    expect(w2.questProgress('lanterns_of_heronwick')?.stage).toBe(3);
    expect(w2.player.inventory.count('mire_oil')).toBe(4);

    use(w2, npc(w2, 'reeve'));
    expect(w2.questProgress('lanterns_of_heronwick')?.stage).toBe(4);
    kill(w2, w2.enemies.find((e) => e.def.id === 'bog_mother')!);
    const coins = w2.player.inventory.count('coins');
    const done = use(w2, npc(w2, 'reeve')).find((e) => e.type === 'dialogue');
    expect(w2.questProgress('lanterns_of_heronwick')?.done).toBe(true);
    expect(done && done.type === 'dialogue' && done.dialogue.rewards?.length).toBeGreaterThan(0);
    expect(w2.player.inventory.count('coins')).toBe(coins + 1500);
    expect(w2.player.inventory.count('marsh_pearl')).toBeGreaterThanOrEqual(1);
    expect(w2.player.inventory.count('mire_oil')).toBe(0);
    expect(QUESTS.lanterns_of_heronwick.giver).toBe('reeve');
  });
});
