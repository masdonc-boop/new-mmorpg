import { describe, expect, it } from 'vitest';
import { GameWorld, type Player, type PlayerId, type SaveData } from '../src/sim/world';
import { generateWorld, isBlocked } from '../src/sim/worldmap';
import { mergeSave } from '../src/sim/records';
import { mulberry32 } from '../src/core/rng';
import { COMMAND_TYPES, validateCommand } from '../src/net/validate';
import { GRAVE_SECONDS } from '../src/sim/death';

const map = generateWorld(1337);
const zone = () => new GameWorld({ noPlayer: true, map, clock: () => 1_790_000_000_000 });
const run = (w: GameWorld, seconds: number) => {
  for (let t = 0; t < seconds * 30; t++) w.tick();
};
const place = (p: Player, x: number, z: number) => {
  p.x = p.prevX = x;
  p.z = p.prevZ = z;
};
const beside = (w: GameWorld, x: number, z: number, nth = 0) =>
  [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => ({ x: x + a, z: z + b })).filter((s) => !isBlocked(w.map, s.x, s.z))[nth];
const setRng = (w: GameWorld, v: number) => ((w as unknown as { rng: () => number }).rng = () => v);

/** Everything a player owns, including their wisps and private loot piles in the world. */
function owned(w: GameWorld, p: Player): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (item: string, n: number) => (out[item] = (out[item] ?? 0) + n);
  for (const s of p.inventory.slots) if (s) add(s.item, s.qty);
  for (const s of p.overflow) add(s.item, s.qty);
  for (const s of p.bank.toJSON()) if (s.qty > 0) add(s.item, s.qty);
  for (const s of p.shrineHeld) add(s.item, s.qty);
  for (const [slot, it] of Object.entries(p.equipment.slots)) if (it) add(it, slot === 'ammo' ? p.equipment.ammoQty : 1);
  for (const it of Object.values(p.toolbelt.slots)) if (it) add(it, 1);
  for (const g of w.graves) if (g.owner === p.id && !g.expired) for (const s of g.items) add(s.item, s.qty);
  for (const g of w.groundItems) if (g.owner === p.id && g.isPrivate) add(g.item, g.qty);
  return out;
}

/** Picks the random arguments a command kind takes (the validator decides); none if nothing fits. */
function fitFields(kind: string, cmd: Record<string, unknown>): Record<string, unknown> {
  for (const combo of [['x', 'z'], ['dx', 'dz'], ['slot', 'qty'], ['a', 'b'], ['target'], ['slot']]) {
    const trial: Record<string, unknown> = { type: kind };
    for (const k of combo) trial[k] = cmd[k];
    if (validateCommand(trial)) return trial;
  }
  return { type: kind };
}

describe('3A.5 a shared world', () => {
  it('a zone starts empty; players join and leave', () => {
    const w = zone();
    expect(w.players.size).toBe(0);
    const a = w.addPlayer({ playerId: 1_000_001, name: 'Ash' });
    const b = w.addPlayer({ playerId: 1_000_002, name: 'Brindle' });
    expect(w.players.size).toBe(2);
    expect(() => w.addPlayer({ playerId: 1_000_001, name: 'Again' })).toThrow();
    run(w, 1);
    expect(w.removePlayer(a.id)?.player).toBe(a);
    expect([...w.players.keys()]).toEqual([b.id]);
    expect(w.removePlayer(a.id)).toBeNull();
  });

  it('each player acts for themselves: commands, movement and messages', () => {
    const w = zone();
    const a = w.addPlayer({ playerId: 1_000_001, name: 'Ash' });
    const b = w.addPlayer({ playerId: 1_000_002, name: 'Brindle' });
    w.drainEvents();
    expect(w.issueFor(a.id, { type: 'setStyle', style: 'ranged' })).toBe(true);
    expect(a.style).toBe('ranged');
    expect(b.style).toBe('melee');
    const bx = b.x;
    w.issueFor(a.id, { type: 'joystick', dx: 1, dz: 0 });
    run(w, 0.5);
    expect(b.x).toBe(bx);
    w.drainEvents();
    w.issueFor(b.id, { type: 'reclaimHeld' });
    const ev = w.drainEventsWithActors();
    const msg = ev.find((e) => e.event.type === 'message');
    expect(msg?.actor).toBe(b.id);
    expect(w.issueFor(1_000_099, { type: 'pray' })).toBe(false);
  });

  it('resource nodes are shared: one player depleting a rock depletes it for everyone', () => {
    const w = zone();
    const a = w.addPlayer({ playerId: 1_000_001, name: 'Ash' });
    const b = w.addPlayer({ playerId: 1_000_002, name: 'Brindle' });
    const rock = w.nodes.find((n) => n.def.id === 'copper_rock' && beside(w, n.x, n.z, 1))!;
    const s1 = beside(w, rock.x, rock.z, 0);
    const s2 = beside(w, rock.x, rock.z, 1);
    place(a, s1.x, s1.z);
    place(b, s2.x, s2.z);
    setRng(w, 0.01);
    w.issueFor(a.id, { type: 'interact', target: rock.id });
    run(w, 3);
    expect(rock.depleted).toBe(true);
    w.drainEvents();
    w.issueFor(b.id, { type: 'interact', target: rock.id });
    const said = w.drainEventsWithActors().filter((e) => e.event.type === 'message');
    expect(said[0].actor).toBe(b.id);
    expect((said[0].event as { text: string }).text).toMatch(/depleted/);
  });

  it('creatures chase the nearest player and fight whoever they target; loot belongs to the killer', () => {
    const w = zone();
    const a = w.addPlayer({ playerId: 1_000_001, name: 'Ash' });
    const b = w.addPlayer({ playerId: 1_000_002, name: 'Brindle' });
    const wolf = w.enemies.find((e) => e.def.id === 'wolf')!;
    place(a, wolf.x + 2, wolf.z);
    place(b, w.map.spawn.x, w.map.spawn.z);
    run(w, 0.3);
    expect(wolf.target).toBe(a.id);
    run(w, 3);
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(b.hp).toBe(b.maxHp);
    // B finishes it off: the drop is B's alone.
    wolf.hp = 1;
    place(b, wolf.x + 1, wolf.z);
    setRng(w, 0.01);
    w.issueFor(b.id, { type: 'interact', target: wolf.id });
    run(w, 3);
    expect(wolf.alive).toBe(false);
    const drops = w.groundItems.filter((g) => g.isPrivate);
    expect(drops.length).toBeGreaterThan(0);
    expect(drops.every((g) => g.owner === b.id)).toBe(true);
    expect(w.visibleGroundItems(a.id).filter((g) => g.isPrivate).length).toBe(0);
    expect(w.act(a, () => w.interactable(drops[0].id))).toBeNull();
  });

  it('a creature whose target leaves goes home; one player dying does not cancel another’s attacks', () => {
    const w = zone();
    const a = w.addPlayer({ playerId: 1_000_001, name: 'Ash' });
    const b = w.addPlayer({ playerId: 1_000_002, name: 'Brindle' });
    const wolf = w.enemies.find((e) => e.def.id === 'wolf')!;
    place(a, wolf.x + 1.5, wolf.z);
    run(w, 0.5);
    expect(wolf.target).toBe(a.id);
    w.removePlayer(a.id);
    expect(wolf.target).toBeNull();
    expect(wolf.state).toBe('return');
    // Pending hits survive another player's death.
    const c = w.addPlayer({ playerId: 1_000_003, name: 'Corra' });
    const pend = (w as unknown as { pending: { attacker: PlayerId }[] }).pending;
    pend.push({ attacker: b.id, at: w.time + 5, target: wolf.id, style: 'melee', damage: 1, hit: true } as never);
    c.hp = 0;
    w.act(c, () => (w as unknown as { killPlayer: () => void }).killPlayer());
    expect(pend.some((h) => h.attacker === b.id)).toBe(true);
  });

  it('allotments are personal: the same plot, each player’s own crops', () => {
    const w = zone();
    const a = w.addPlayer({ playerId: 1_000_001, name: 'Ash' });
    const b = w.addPlayer({ playerId: 1_000_002, name: 'Brindle' });
    const patch = a.patches[0];
    patch.weeds = 0;
    a.inventory.add('potato_seed', 4);
    place(a, patch.x + 1, patch.z);
    w.issueFor(a.id, { type: 'interact', target: patch.id });
    run(w, 3);
    expect(a.patches[0].crop).toBe('potato');
    expect(b.patches[0].crop).toBeNull();
    expect(w.act(b, () => w.get(patch.id))).toBe(b.patches[0]);
    expect(w.act(a, () => w.get(patch.id))).toBe(a.patches[0]);
  });

  it('wisps belong to their owner, count down only while the owner is here, and leave with them', () => {
    const w = zone();
    const a = w.addPlayer({ playerId: 1_000_001, name: 'Ash' });
    const b = w.addPlayer({ playerId: 1_000_002, name: 'Brindle' });
    a.inventory.add('logs', 6);
    w.act(a, () => (w as unknown as { killPlayer: () => void }).killPlayer());
    const g = w.graves[0];
    expect(g.owner).toBe(a.id);
    expect(w.act(b, () => w.interactable(g.id))).toBeNull();
    const before = owned(w, a);
    const record = w.act(a, () => w.characterRecord());
    const left = w.removePlayer(a.id)!;
    expect(w.graves.length).toBe(0);
    expect(left.zone.graves?.length).toBe(1);
    run(w, 5);
    // Back again: the wisp comes back with them, with the same age.
    const again = w.addPlayer({ playerId: a.id, save: mergeSave({ character: record, zone: left.zone }), worldItems: true });
    expect(w.graves.length).toBe(1);
    expect(owned(w, again)).toEqual(before);
    w.graves[0].age = GRAVE_SECONDS - 0.5;
    run(w, 1);
    expect(w.graves.length).toBe(0);
    expect(again.shrineHeld.length).toBeGreaterThan(0);
  });

  it('fuzz: three players play randomly and come and go; nobody’s items are duplicated or lost by leaving and rejoining', () => {
    const w = zone();
    const rng = mulberry32(0x3a5);
    const ids = [1_000_001, 1_000_002, 1_000_003];
    for (const id of ids) w.addPlayer({ playerId: id, name: `P${id % 10}` });
    const pick = <T,>(a: readonly T[]) => a[Math.floor(rng() * a.length)];
    const kinds = COMMAND_TYPES.filter((t) => !['discardOverflow', 'exchange', 'exchangeResetPractice'].includes(t));
    let cycles = 0;
    for (let i = 0; i < 3000; i++) {
      const id = pick(ids);
      const p = w.players.get(id);
      if (!p) continue;
      if (rng() < 0.01) {
        // Leave and come back: everything owned must be exactly the same afterwards.
        const before = owned(w, p);
        const record = w.act(p, () => w.characterRecord());
        const left = w.removePlayer(id)!;
        const back = w.addPlayer({ playerId: id, save: JSON.parse(JSON.stringify(mergeSave({ character: record, zone: left.zone }))) as SaveData, worldItems: true });
        expect(owned(w, back)).toEqual(before);
        cycles++;
        continue;
      }
      const kind = pick(kinds);
      const cmd: Record<string, unknown> = { type: kind };
      // Plausible random arguments; the validator decides what is well-formed.
      for (const k of ['slot', 'a', 'b', 'qty', 'count', 'tab']) cmd[k] = Math.floor(rng() * 28);
      cmd.target = pick([...w.nodes.slice(0, 40).map((n) => n.id), ...w.enemies.map((e) => e.id), ...w.npcs.map((n) => n.id)]);
      cmd.x = 50 + rng() * 15;
      cmd.z = 60 + rng() * 15;
      cmd.dx = rng() * 2 - 1;
      cmd.dz = rng() * 2 - 1;
      // Keep only the fields this command kind takes (taken from a well-formed example).
      const ok = validateCommand(fitFields(kind, cmd)) ?? validateCommand({ type: kind });
      if (ok) w.issueFor(id, ok);
      if (i % 5 === 0) run(w, 0.2);
    }
    expect(cycles).toBeGreaterThan(10);
  });
});
