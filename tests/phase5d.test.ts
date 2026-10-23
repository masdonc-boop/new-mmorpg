import { describe, expect, it } from 'vitest';
import { GameWorld, PLAYER_SPEED, type Enemy, type GameEvent, type Player } from '../src/sim/world';
import { ENEMIES, type EnemyType } from '../src/data/enemies';
import { itemDef } from '../src/data/items';
import { xpForLevel } from '../src/data/skills';
import { combatXp } from '../src/sim/combat';
import { DROP_LOG_KEYS } from '../src/data/collection';
import { captureState } from '../src/net/replica';

/** Phase 5D: enemy variety and combat depth (docs/COMBAT.md). */

const run = (w: GameWorld, s: number) => {
  for (let t = 0; t < Math.round(s * 30); t++) w.tick();
};
const setRng = (w: GameWorld, f: () => number) => ((w as unknown as { rng: () => number }).rng = f);
const hit = (w: GameWorld, e: Enemy, dmg: number) => (w as unknown as { damageEnemy: (e: Enemy, d: number, hit: boolean, s: string) => void }).damageEnemy(e, dmg, true, 'melee');
const kill = (w: GameWorld, e: Enemy) => (w as unknown as { killEnemy: (e: Enemy) => void }).killEnemy(e);
const at = (m: { x: number; z: number; prevX?: number; prevZ?: number }, x: number, z: number) => {
  m.x = x;
  m.z = z;
  if ('prevX' in m) {
    m.prevX = x;
    m.prevZ = z;
  }
};
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const train = (p: Player, level: number) => {
  for (const s of ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic'] as const) p.skills.addXp(s, xpForLevel(level));
  p.hp = p.skills.maxHp();
};
const all = (w: GameWorld, id: EnemyType) => w.enemies.filter((e) => e.def.id === id);
/** A creature fighting the player, with its special ready. */
function engaged(w: GameWorld, e: Enemy, p = w.player) {
  e.state = 'chase';
  e.target = p.id;
  e.specialTimer = 0;
  e.attackTimer = 5;
}
function open(w: GameWorld, near: { x: number; z: number }, r = 2): { x: number; z: number } {
  for (let k = 0; k < 64; k++) {
    const a = k * 0.7;
    const q = { x: near.x + Math.cos(a) * r, z: near.z + Math.sin(a) * r };
    if (!w.map.blocked[Math.floor(q.z) * w.map.width + Math.floor(q.x)]) return q;
  }
  throw new Error('no open ground');
}

describe('5D who gets which behaviour', () => {
  it('early creatures stay simple; the demanding behaviours appear from the marsh and highlands on', () => {
    for (const e of Object.values(ENEMIES)) {
      if (e.level < 20 && !e.boss) {
        // Below level 20: at most a gentle pack call or a retreat, never a special, a slow or kiting.
        expect(e.special, e.id).toBeUndefined();
        expect(e.slowOnHit, e.id).toBeUndefined();
        expect(e.kite, e.id).toBeUndefined();
        if (e.pack) expect(e.pack.max, e.id).toBeLessThanOrEqual(1);
      }
      if (e.elite) {
        expect(e.level, e.id).toBeGreaterThanOrEqual(30);
        expect(e.boss, e.id).toBeFalsy();
        expect(e.special, e.id).toBeTruthy();
      }
      // Nobody gets everything.
      const n = [e.pack, e.kite, e.retreat, e.slowOnHit, e.special].filter(Boolean).length;
      expect(n, e.id).toBeLessThanOrEqual(2);
      // Every special gives time to react: at least 1.3 s, and a ring a person can walk out of in less than half of it.
      if (e.special) {
        expect(e.special.windup, e.id).toBeGreaterThanOrEqual(1.3);
        expect((e.special.radius + 0.5) / (PLAYER_SPEED * (e.special.slow ? e.special.slow.factor : 1)), e.id).toBeLessThan(e.special.windup * 0.75);
      }
    }
    expect(ENEMIES.slime.pack ?? ENEMIES.slime.special ?? ENEMIES.slime.retreat).toBeUndefined();
    for (const b of ['goblin_warlord', 'bog_mother', 'greymane', 'shrinekeeper', 'watchcaptain'] as EnemyType[]) expect(ENEMIES[b].special, b).toBeTruthy();
  });

  it('elites are their base creature, tougher and rarer, with richer but not better-per-minute rewards', () => {
    const value = (id: EnemyType) => ENEMIES[id].drops.reduce((a, d) => a + d.chance * ((d.min + d.max) / 2) * itemDef(d.item).value, 0);
    for (const e of Object.values(ENEMIES).filter((x) => x.elite)) {
      const base = ENEMIES[e.elite!.of];
      expect(e.model).toBe(base.model);
      expect(e.maxHp).toBeGreaterThan(base.maxHp * 1.5);
      expect(e.respawnSeconds).toBe(base.respawnSeconds * 3);
      expect(e.aggressive).toBe(base.aggressive);
      expect(value(e.id)).toBeGreaterThan(value(base.id));
      // Per minute of respawn the elite is worth no more than its base creature.
      expect(value(e.id) / e.respawnSeconds).toBeLessThanOrEqual(value(base.id) / base.respawnSeconds);
      for (const d of e.drops) if (itemDef(d.item).equip && !itemDef(d.item).stackable) expect(d.chance).toBeLessThanOrEqual(0.06);
    }
  });

  it('there is one elite in Thornridge and one in each dungeon, none on the island or in Glimmer Hollow', () => {
    const w = new GameWorld();
    const elites = w.enemies.filter((e) => e.def.elite);
    expect(elites.map((e) => e.def.id).sort()).toEqual(['drowned_tidecaller', 'forsworn_marksman', 'ironhide_bristleback']);
    for (const e of elites) expect(e.spawnX, e.def.id).toBeGreaterThan(30);
    // Never in a boss's room: at least 12 tiles from any boss.
    for (const e of elites) for (const b of w.enemies.filter((x) => x.def.boss)) expect(dist(e, b), `${e.def.id} near ${b.def.id}`).toBeGreaterThan(12);
  });
});

describe('5D pack help', () => {
  it('a wolf brings one packmate; a ridge stalker up to two; the called ones don’t call more', () => {
    const w = new GameWorld();
    const wolves = all(w, 'wolf');
    const lead = wolves[0];
    // Gather three more wolves round the lead (and push the rest far away).
    wolves.slice(1).forEach((o, i) => at(o, i < 3 ? lead.x + 1 + i * 0.5 : lead.x + 40, lead.z + (i < 3 ? 1 : 40)));
    hit(w, lead, 1);
    expect(wolves.filter((o) => o.state === 'chase').length).toBe(2);
    const s = new GameWorld();
    const st = all(s, 'ridge_stalker');
    st.slice(1).forEach((o, i) => at(o, st[0].x + 1 + i * 0.4, st[0].z + 1));
    hit(s, st[0], 1);
    expect(st.filter((o) => o.state === 'chase').length).toBe(Math.min(3, st.length));
    for (const o of st) if (o.state === 'chase') expect(o.target).toBe(s.player.id);
  });

  it('goblins don’t pack, but one low on health breaks off once and calls a friend', () => {
    const w = new GameWorld();
    const [g, friend, other, ...rest] = all(w, 'goblin');
    for (const o of rest) at(o, o.x + 60, o.z + 60);
    // Both within its call (7 tiles) but beyond their own notice of the player (6 tiles).
    at(w.player, g.x - 1, g.z);
    for (const [o, dx, dz] of [[friend, 5.6, 0], [other, 5.8, 1.2]] as const) {
      at(o, g.x + dx, g.z + dz);
      o.spawnX = o.x;
      o.spawnZ = o.z;
    }
    hit(w, g, 1);
    expect([friend.state, other.state]).not.toContain('chase');
    w.drainEvents();
    g.hp = Math.floor(g.def.maxHp * 0.2);
    run(w, 0.1);
    expect(g.fled).toBe(true);
    expect(g.fleeTimer).toBeGreaterThan(2.5);
    expect([friend, other].filter((o) => o.state === 'chase').length).toBe(1);
    expect(w.drainEvents().some((e) => e.type === 'telegraph' && e.source === g.id && /help/.test(e.text))).toBe(true);
    // It moves away, stays on its leash, then comes back to fight, and never runs a second time.
    // (The player auto-retaliates and follows, so measure the goblin's own ground covered.)
    const from = { x: g.x, z: g.z };
    const away = { x: g.x - w.player.x, z: g.z - w.player.z };
    run(w, 1);
    expect(dist(g, from)).toBeGreaterThan(1);
    expect((g.x - from.x) * away.x + (g.z - from.z) * away.z).toBeGreaterThan(0);
    run(w, 2.5);
    expect(g.fleeTimer).toBeLessThanOrEqual(0);
    expect(dist(g, { x: g.spawnX, z: g.spawnZ })).toBeLessThan(g.def.leashRange);
    g.hp = 1;
    run(w, 0.2);
    expect(g.fleeTimer).toBeLessThanOrEqual(0);
    // A fresh life can retreat again.
    kill(w, g);
    g.respawnTimer = 0;
    run(w, 0.1);
    expect(g.fled).toBe(false);
  });
});

describe('5D ranged creatures keep their distance', () => {
  it('an archer backs off from a player who closes in (still shooting), but never off its leash or into a wall', () => {
    const w = new GameWorld();
    const a = all(w, 'forsworn_archer')[0];
    train(w.player, 40);
    const spot = open(w, a, 1.2);
    at(w.player, spot.x, spot.z);
    a.state = 'chase';
    a.target = w.player.id;
    a.attackTimer = 0;
    w.drainEvents();
    const d0 = dist(a, w.player);
    run(w, 1.5);
    expect(dist(a, w.player)).toBeGreaterThan(d0);
    expect(w.drainEvents().some((e) => e.type === 'attack' && e.source === a.id)).toBe(true);
    for (let i = 0; i < 20; i++) {
      run(w, 0.5);
      expect(dist(a, { x: a.spawnX, z: a.spawnZ })).toBeLessThan(a.def.leashRange * 0.8 + 0.2);
      expect(w.map.blocked[Math.floor(a.z) * w.map.width + Math.floor(a.x)]).toBe(0);
    }
  });

  it('melee creatures never kite', () => {
    for (const e of Object.values(ENEMIES)) if ((e.attackStyle ?? 'melee') === 'melee') expect(e.kite, e.id).toBeUndefined();
  });
});

describe('5D slows', () => {
  it('a mire leech’s hit can slow you: 70% speed for 3 s, then back to normal; death clears it', () => {
    const w = new GameWorld();
    const p = w.player;
    train(p, 30);
    const leech = all(w, 'mire_leech')[0];
    const normal = w.playerSpeed();
    setRng(w, () => 0.01);
    w.drainEvents();
    (w as unknown as { landEnemyHit: (e: Enemy, d: number, h: boolean) => void }).landEnemyHit(leech, 5, true);
    expect(p.slowTimer).toBeCloseTo(3, 5);
    expect(w.playerSpeed()).toBeCloseTo(normal * 0.7, 6);
    const ev = w.drainEvents();
    expect(ev.find((e) => e.type === 'status')).toMatchObject({ target: p.id, status: 'slow' });
    expect(ev.some((e) => e.type === 'message' && /slows you/.test(e.text))).toBe(true);
    // Client prediction uses the same speed (moves 70% as far).
    const x0 = p.x;
    w.predictMove(1, 0, 0.1);
    expect(Math.abs(p.x - x0)).toBeCloseTo(normal * 0.7 * 0.1, 3);
    run(w, 3.1);
    expect(p.slowTimer).toBe(0);
    expect(w.playerSpeed()).toBeCloseTo(normal, 6);
    // A miss or a dodge never slows; nor does the roll going the other way.
    setRng(w, () => 0.9);
    (w as unknown as { landEnemyHit: (e: Enemy, d: number, h: boolean) => void }).landEnemyHit(leech, 5, true);
    expect(p.slowTimer).toBe(0);
    setRng(w, () => 0.01);
    (w as unknown as { landEnemyHit: (e: Enemy, d: number, h: boolean) => void }).landEnemyHit(leech, 0, false);
    expect(p.slowTimer).toBe(0);
    (w as unknown as { landEnemyHit: (e: Enemy, d: number, h: boolean) => void }).landEnemyHit(leech, 5, true);
    expect(p.slowTimer).toBeGreaterThan(0);
    (w as unknown as { killPlayer: () => void }).killPlayer();
    expect(p.slowTimer).toBe(0);
    expect(p.slowFactor).toBe(1);
  });

  it('the stronger of two slows wins; a fresh one restarts the clock without stacking', () => {
    const w = new GameWorld();
    const slow = (f: number, s: number) => (w as unknown as { slowPlayer: (f: number, s: number, by: string) => void }).slowPlayer(f, s, 'Test');
    slow(0.7, 3);
    slow(0.6, 2);
    expect(w.player.slowFactor).toBe(0.6);
    expect(w.player.slowTimer).toBe(3);
    slow(0.8, 4);
    expect(w.player.slowFactor).toBe(0.6);
    expect(w.player.slowTimer).toBe(4);
  });
});

describe('5D telegraphed specials', () => {
  function bossFight(id: EnemyType) {
    const w = new GameWorld();
    const p = w.player;
    train(p, 45);
    const b = all(w, id)[0];
    const spot = open(w, b, 1.4);
    at(p, spot.x, spot.z);
    engaged(w, b);
    w.drainEvents();
    return { w, p, b };
  }

  it('a slam marks the ground under its target, waits its wind-up, then hits whoever is still inside', () => {
    const { w, p, b } = bossFight('goblin_warlord');
    const sp = b.def.special!;
    w.tick();
    expect(b.special).toMatchObject({ kind: 'slam', name: 'Club slam', radius: sp.radius });
    expect(dist(b.special!, p)).toBeLessThan(0.01);
    const tele = w.drainEvents().find((e): e is Extract<GameEvent, { type: 'telegraph' }> => e.type === 'telegraph');
    expect(tele).toMatchObject({ source: b.id, text: 'Club slam', seconds: sp.windup, radius: sp.radius });
    // No damage, and no ordinary swings, during the wind-up.
    const hp = p.hp;
    b.attackTimer = 0;
    run(w, sp.windup - 0.1);
    expect(p.hp).toBe(hp);
    expect(w.drainEvents().some((e) => e.type === 'attack' && e.source === b.id)).toBe(false);
    run(w, 0.2);
    const dmg = w.drainEvents().filter((e): e is Extract<GameEvent, { type: 'damage' }> => e.type === 'damage' && e.target === p.id);
    expect(dmg.length).toBe(1);
    expect(dmg[0].outcome).toBe('special');
    expect(dmg[0].amount).toBeGreaterThanOrEqual(Math.round(b.def.maxHit * sp.damage * 0.75));
    expect(dmg[0].amount).toBeLessThanOrEqual(Math.round(b.def.maxHit * sp.damage));
    expect(b.special).toBeNull();
    expect(b.specialTimer).toBeGreaterThan(sp.cooldown - 1);
  });

  it('stepping out in time avoids it entirely, and the game says "dodged"', () => {
    const { w, p, b } = bossFight('goblin_warlord');
    w.tick();
    const ring = b.special!;
    const out = open(w, ring, ring.radius + 1);
    w.issue({ type: 'moveTo', x: out.x, z: out.z });
    const hp = p.hp;
    run(w, b.def.special!.windup + 0.2);
    expect(dist(p, ring)).toBeGreaterThan(ring.radius);
    expect(p.hp).toBe(hp);
    expect(w.drainEvents().find((e) => e.type === 'damage' && e.target === p.id)).toMatchObject({ outcome: 'dodged', amount: 0 });
  });

  it('a sweep is centred on the creature itself (back away to dodge); a charge rushes to the marked spot', () => {
    const sweep = bossFight('watchcaptain');
    sweep.w.tick();
    expect(sweep.b.special!.kind).toBe('sweep');
    expect(dist(sweep.b.special!, sweep.b)).toBeLessThan(0.01);
    const charge = bossFight('greymane');
    const p = charge.p;
    const far = open(charge.w, charge.b, 5);
    at(p, far.x, far.z);
    charge.w.tick();
    expect(charge.b.special!.kind).toBe('charge');
    const mark = { x: charge.b.special!.x, z: charge.b.special!.z };
    run(charge.w, charge.b.def.special!.windup + 1);
    expect(dist(charge.b, mark)).toBeLessThan(1.2);
    expect(charge.w.drainEvents().some((e) => e.type === 'damage' && e.target === p.id && e.outcome === 'special')).toBe(true);
  });

  it('a special starts only with its target in range, and is cleared when the creature dies', () => {
    const { w, p, b } = bossFight('bog_mother');
    const far = open(w, b, b.def.special!.range + 2.5);
    at(p, far.x, far.z);
    b.attackTimer = 99;
    w.tick();
    expect(b.special).toBeNull();
    const near = open(w, b, 1.3);
    at(p, near.x, near.z);
    w.tick();
    expect(b.special).not.toBeNull();
    kill(w, b);
    b.respawnTimer = 0;
    w.tick();
    expect(b.special).toBeNull();
    expect(b.dash).toBeNull();
  });

  it('the Bog Mother’s burst slows those it hits; Hearth’s Bulwark halves it as it does any creature hit', () => {
    const { w, p, b } = bossFight('bog_mother');
    setRng(w, () => 1);
    w.tick();
    run(w, b.def.special!.windup + 0.1);
    expect(p.slowTimer).toBeGreaterThan(2.5);
    const full = p.skills.maxHp() - p.hp;
    const v = bossFight('bog_mother');
    setRng(v.w, () => 1);
    v.p.prayers.add('hearth_bulwark');
    v.p.prayerPoints = 99;
    v.w.tick();
    run(v.w, v.b.def.special!.windup + 0.1);
    expect(v.p.skills.maxHp() - v.p.hp).toBe(Math.max(1, Math.round(full * 0.5)));
  });

  it('auto-approach waits at the edge of a ring instead of walking into it; the joystick still goes anywhere', () => {
    const { w, p, b } = bossFight('goblin_warlord');
    const far = open(w, b, 4.5);
    at(p, far.x, far.z);
    b.special = { kind: 'slam', name: 'Club slam', x: b.x, z: b.z, radius: 1.8, left: 1.5, total: 1.6 };
    b.specialTimer = 99;
    const d = dist(p, b.special);
    if (d > 1.8 + 1.6) at(p, b.x + (p.x - b.x) * (2.6 / d), b.z + (p.z - b.z) * (2.6 / d));
    w.issue({ type: 'interact', target: b.id });
    const before = dist(p, b.special);
    run(w, 0.5);
    expect(dist(p, b.special!)).toBeGreaterThanOrEqual(Math.min(before, 1.8));
    expect(w.ringAhead(p.x, p.z)).toBe(true);
  });

  it('two players in the ring are both hit; one who stepped out is not (each from the server’s own positions)', () => {
    const w = new GameWorld();
    const a = w.player;
    const bId = 1_000_001;
    const bp = w.addPlayer({ playerId: bId, name: 'Bea' });
    train(a, 45);
    train(bp, 45);
    const boss = all(w, 'goblin_warlord')[0];
    const s1 = open(w, boss, 1.3);
    at(a, s1.x, s1.z);
    at(bp, s1.x + 0.3, s1.z);
    engaged(w, boss, a);
    w.tick();
    const ring = boss.special!;
    const hpA = a.hp;
    const hpB = bp.hp;
    run(w, boss.def.special!.windup + 0.1);
    expect(a.hp).toBeLessThan(hpA);
    expect(bp.hp).toBeLessThan(hpB);
    // Again, with Bea stepping out.
    a.hp = hpA;
    bp.hp = hpB;
    boss.specialTimer = 0;
    boss.attackTimer = 99;
    w.tick();
    const out = open(w, boss.special!, boss.special!.radius + 1.5);
    at(bp, out.x, out.z);
    run(w, boss.def.special!.windup + 0.1);
    expect(bp.hp).toBe(hpB);
    expect(a.hp).toBeLessThan(hpA);
    void ring;
  });
});

describe('5D replication, xp and loot', () => {
  it('a special winding up and a slow travel in the snapshot, so a phone that joins mid wind-up sees the ring', () => {
    const w = new GameWorld();
    const p = w.player;
    train(p, 45);
    const boss = all(w, 'goblin_warlord')[0];
    const s = open(w, boss, 1.3);
    at(p, s.x, s.z);
    engaged(w, boss);
    w.tick();
    p.slowTimer = 2;
    p.slowFactor = 0.6;
    const state = captureState(w, 1, 0);
    const view = state.enemies.find((e) => e.id === boss.id)!;
    expect((view.f as { special?: { name: string; radius: number } }).special).toMatchObject({ name: 'Club slam', radius: 1.8 });
    expect((state.player as { slowTimer?: number; slowFactor?: number }).slowFactor ?? (state.player as unknown as { f: Record<string, number> }).f?.slowFactor).toBe(0.6);
  });

  it('killing an elite gives the usual xp per damage and its table’s drops; its rare gear is a collection log entry', () => {
    const w = new GameWorld();
    const e = all(w, 'ironhide_bristleback')[0];
    const before = w.player.skills.xp.attack + w.player.skills.xp.strength + w.player.skills.xp.defence + w.player.skills.xp.hitpoints;
    e.hp = 1e6;
    hit(w, e, 40);
    const after = w.player.skills.xp.attack + w.player.skills.xp.strength + w.player.skills.xp.defence + w.player.skills.xp.hitpoints;
    expect(after - before).toBeCloseTo(combatXp('melee', 40).reduce((a, x) => a + x.amount, 0), 6);
    setRng(w, () => 0);
    kill(w, e);
    expect(w.groundItems.some((g) => g.item === 'boarhide_boots')).toBe(true);
    expect(DROP_LOG_KEYS.has('ironhide_bristleback:boarhide_boots')).toBe(true);
    expect(w.player.dropLog.has('ironhide_bristleback:boarhide_boots')).toBe(true);
  });
});
