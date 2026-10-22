import { GameWorld, Player, type Appearance } from '../sim/world';
import { Equipment } from '../sim/equipment';
import type { EquipSlot } from '../data/items';
import type { ItemId } from '../data/items';
import type { PrayerId } from '../data/prayers';
import type { ItemStack } from '../sim/inventory';
import { mergeSave, type CharacterRecord } from '../sim/records';

/**
 * World replication for network play (docs/MULTIPLAYER.md 3A.2).
 *
 * The server's world is the truth. The client keeps a *replica* `GameWorld` with the same shape, so
 * the renderer and HUD work unchanged; it never runs the game rules itself. Two kinds of update
 * keep the replica in step:
 *
 * - `captureState` / `applyState`: the fast-changing state (about 10 times a second): the player's
 *   runtime fields, creatures, NPCs, depleted nodes, ground piles, wisps and fires.
 * - the `CharacterRecord` (skills, bag, bank, gear, quests, house, allotments, …), sent only when
 *   it changes, applied with `applyCharacter`.
 *
 * Positions are handed back to the caller rather than written directly, so the client can
 * interpolate other entities and predict its own movement.
 */

type Fields = Record<string, unknown>;

export interface EntityState {
  id: number;
  x: number;
  z: number;
  f: Fields;
}

/** Another player as others see them: looks, worn gear, position and what they are doing. */
export interface OtherPlayerState {
  id: number;
  name: string;
  appearance: Appearance;
  x: number;
  z: number;
  /** facing, moving, `@swingAge` (see `restoreAges`), dead, style, hp. */
  f: Fields;
  /** Combat level and health fraction, for the name plate. */
  combat: number;
  health: number;
  /** The kind of action (attack, gather, craft, …) and, when gathering, the skill. */
  act: string | null;
  skill: string | null;
  gear: Partial<Record<EquipSlot, ItemId>>;
}

export interface WorldState {
  /** Server tick number. */
  tick: number;
  time: number;
  /** The last movement input the server applied (for prediction and reconciliation). */
  ack: number;
  player: { x: number; z: number; f: Fields; prayers: string[] };
  /** Other players within the interest radius. */
  others: OtherPlayerState[];
  enemies: EntityState[];
  npcs: EntityState[];
  /** Depleted resource nodes, and nodes hit recently (id, seconds since the hit) for the shake. */
  depleted: number[];
  hits: [number, number][];
  ground: { id: number; item: ItemId; qty: number; x: number; z: number; owner: number | null; age: number }[];
  graves: { id: number; x: number; z: number; owner: number; items: ItemStack[]; age: number }[];
  fires: { id: number; x: number; z: number; life: number; age: number }[];
}

/** Player fields carried by the character record instead of snapshots. */
const CHARACTER_FIELDS = ['name', 'appearance', 'skills', 'inventory', 'overflow', 'bank', 'equipment', 'toolbelt', 'grants', 'autoGather', 'shrineHeld', 'furniture', 'laps', 'quests', 'checkpoints'] as const;
/** Never copied by snapshots: identity, and positions handled by interpolation and prediction. */
const PLAYER_SKIP = new Set<string>(['id', 'x', 'z', 'prevX', 'prevZ', 'joy', 'prayers', 'patches', 'remote', ...CHARACTER_FIELDS]);
/** Creature and NPC fields only their AI uses (the client never runs it). */
const ENEMY_SKIP = new Set(['id', 'def', 'spawnX', 'spawnZ', 'x', 'z', 'prevX', 'prevZ', 'attackTimer', 'idleTimer', 'wander', 'hitBy']);
const NPC_SKIP = new Set(['id', 'def', 'baseFacing', 'patrol', 'x', 'z', 'prevX', 'prevZ', 'waitTimer', 'waypoint']);

const NO_SKIP = new Set<string>();
const round = (n: number) => Math.round(n * 1000) / 1000;
/** Positions and headings: a hundredth of a tile or radian is plenty to draw by. */
const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Fields that count up every tick (`swingAge`, `deadAge`, …) would change in every snapshot. They
 * are sent as `@name`: the world time they started from, which stays the same until the thing
 * happens again (null once it is long past, false for an age held at zero), and turned back into ages when applied.
 */
const AGE_HORIZON = 30;
const isAge = (k: string) => k.endsWith('Age');
function restoreAges(f: Fields, time: number): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(f)) {
    if (k.startsWith('@')) out[k.slice(1)] = v === null ? 99 : v === false ? 0 : round(time - (v as number));
    else out[k] = v;
  }
  return out;
}

function isPlain(v: unknown): boolean {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isPlain);
  if (typeof v === 'object') return Object.getPrototypeOf(v) === Object.prototype && Object.values(v as object).every(isPlain);
  return false;
}

/** The JSON-safe own fields of an object (numbers rounded, ages as start times), skipping class instances and `skip`. */
function fieldsOf(obj: object, skip: Set<string>, time: number): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (skip.has(k) || !isPlain(v)) continue;
    if (typeof v === 'number' && isAge(k)) out[`@${k}`] = v === 0 ? false : v >= AGE_HORIZON ? null : round2(time - v);
    // Timers below zero mean "ready" however far below; headings to a tenth (the renderer eases turns).
    else if (typeof v === 'number') out[k] = k === 'facing' ? round1(v) : k.endsWith('Timer') ? round(Math.max(0, v)) : round(v);
    else out[k] = v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  }
  return out;
}

/** Creatures and NPCs further than this from the player (tiles) are left out of snapshots. */
export const INTEREST_RADIUS = 32;

/**
 * How other players, creatures and NPCs look is the same for every viewer, so on a server with many
 * players each is captured once per tick and shared by all the snapshots of that tick.
 */
const shared = new WeakMap<GameWorld, { time: number; views: Map<number, OtherPlayerState | EntityState> }>();
function viewOf<T extends OtherPlayerState | EntityState>(world: GameWorld, id: number, make: () => T): T {
  let c = shared.get(world);
  if (!c || c.time !== world.time) shared.set(world, (c = { time: world.time, views: new Map() }));
  let v = c.views.get(id);
  if (!v) c.views.set(id, (v = make()));
  return v as T;
}

export function captureState(world: GameWorld, tick: number, ack: number, radius = INTEREST_RADIUS): WorldState {
  const p = world.player;
  const near = (e: { x: number; z: number }) => Math.abs(e.x - p.x) <= radius && Math.abs(e.z - p.z) <= radius;
  const time = round(world.time);
  return {
    tick,
    time: round(world.time),
    ack,
    player: { x: round(p.x), z: round(p.z), f: fieldsOf(p, PLAYER_SKIP, time), prayers: [...p.prayers] },
    others: [...world.players.values()].filter((q) => q !== p && near(q)).map((q) => viewOf(world, q.id, () => {
      const node = q.action?.type === 'gather' ? world.get(q.action.node) : undefined;
      return {
        id: q.id,
        name: q.name,
        appearance: q.appearance,
        x: round2(q.x),
        z: round2(q.z),
        f: fieldsOf({ facing: q.facing, moving: q.moving, swingAge: q.swingAge, dead: q.dead, style: q.style, hp: q.hp }, NO_SKIP, time),
        combat: q.skills.combatLevel(),
        health: round(q.hp / q.maxHp),
        act: q.action?.type ?? null,
        skill: node && 'def' in node && 'skill' in node.def ? node.def.skill : null,
        gear: q.equipment.toJSON(),
      };
    })),
    enemies: world.enemies.filter(near).map((e) => viewOf(world, e.id, () => ({ id: e.id, x: round2(e.x), z: round2(e.z), f: fieldsOf(e, ENEMY_SKIP, time) }))),
    npcs: world.npcs.filter(near).map((n) => viewOf(world, n.id, () => ({ id: n.id, x: round2(n.x), z: round2(n.z), f: fieldsOf(n, NPC_SKIP, time) }))),
    depleted: world.nodes.filter((n) => n.depleted).map((n) => n.id),
    hits: world.nodes.filter((n) => n.hitAge < 1).map((n) => [n.id, round(n.hitAge)] as [number, number]),
    // Only what this player may see: their own private loot and their own wisps. Ages are sent to
    // the second (the client only uses them for timers and fading), so piles don't change every snapshot.
    ground: world.groundItems.filter((g) => !g.expired && g.visibleTo(p.id) && near(g)).map((g) => ({ id: g.id, item: g.item, qty: g.qty, x: g.x, z: g.z, owner: g.owner, age: Math.floor(g.age) })),
    graves: world.graves.filter((g) => !g.expired && g.owner === p.id).map((g) => ({ id: g.id, x: g.x, z: g.z, owner: g.owner, items: g.items.map((i) => ({ ...i })), age: Math.floor(g.age) })),
    fires: world.fires.filter((f) => !f.expired && near(f)).map((f) => ({ id: f.id, x: f.x, z: f.z, life: f.life, age: Math.floor(f.age) })),
  };
}

/**
 * Applies a snapshot to a replica. Positions are not written (see the module note): the caller
 * gets them in `state.player`, `state.enemies` and `state.npcs`.
 */
export function applyState(world: GameWorld, state: WorldState) {
  const p = world.player;
  Object.assign(p, restoreAges(state.player.f, state.time));
  p.prayers = new Set(state.player.prayers as PrayerId[]);
  const enemies = new Map(state.enemies.map((e) => [e.id, e]));
  for (const e of world.enemies) {
    const s = enemies.get(e.id);
    if (s) Object.assign(e, restoreAges(s.f, state.time));
  }
  const npcs = new Map(state.npcs.map((n) => [n.id, n]));
  for (const n of world.npcs) {
    const s = npcs.get(n.id);
    if (s) Object.assign(n, restoreAges(s.f, state.time));
  }
  world.offstage = new Set([...world.enemies.filter((e) => !enemies.has(e.id)), ...world.npcs.filter((n) => !npcs.has(n.id))].map((e) => e.id));
  const depleted = new Set(state.depleted);
  const hits = new Map(state.hits);
  for (const n of world.nodes) {
    n.depleted = depleted.has(n.id);
    n.hitAge = hits.get(n.id) ?? 99;
  }
  world.syncDynamicEntities(state);
  world.time = state.time;
  syncOthers(world, state.others, state.time);
}

/**
 * Keeps the replica's other players in step: lightweight characters with the right name, looks, worn
 * gear and pose (positions are interpolated by the client). Players out of range are removed.
 */
function syncOthers(world: GameWorld, others: OtherPlayerState[], time: number) {
  const seen = new Set<number>();
  for (const o of others) {
    seen.add(o.id);
    let q = world.players.get(o.id);
    if (!q) {
      q = new Player(o.name, o.appearance, o.x, o.z, o.id);
      world.players.set(o.id, q);
    }
    q.name = o.name;
    q.appearance = o.appearance;
    Object.assign(q, restoreAges(o.f, time));
    q.remote = { act: o.act, skill: o.skill, combat: o.combat, health: o.health };
    const gear = JSON.stringify(o.gear);
    if (JSON.stringify(q.equipment.toJSON()) !== gear) q.equipment = Equipment.restore(o.gear, 1).equipment;
  }
  for (const id of [...world.players.keys()]) if (id !== world.player.id && !seen.has(id)) world.players.delete(id);
}

/**
 * Applies a character record to a replica's player (and their allotments). The record is restored
 * through the normal save path on a throwaway world that shares the replica's map and practice
 * market, then its parts are moved across.
 */
export function applyCharacter(world: GameWorld, record: CharacterRecord) {
  const temp = new GameWorld({ save: mergeSave({ character: record }), map: world.map, market: world.market, playerId: world.player.id, clock: world.clock });
  const src = temp.player as unknown as Record<string, unknown>;
  const dst = world.player as unknown as Record<string, unknown>;
  for (const k of CHARACTER_FIELDS) dst[k] = src[k];
  temp.patches.forEach((f, i) => {
    const t = world.patches[i];
    if (!t) return;
    t.weeds = f.weeds;
    t.crop = f.crop;
    t.plantedAt = f.plantedAt;
    t.lives = f.lives;
    t.bareSince = f.bareSince;
  });
}
