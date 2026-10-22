import { GameWorld } from '../sim/world';
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

export interface WorldState {
  /** Server tick number. */
  tick: number;
  time: number;
  /** The last movement input the server applied (for prediction and reconciliation). */
  ack: number;
  player: { x: number; z: number; f: Fields; prayers: string[] };
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
const PLAYER_SKIP = new Set<string>(['id', 'x', 'z', 'prevX', 'prevZ', 'joy', 'prayers', ...CHARACTER_FIELDS]);
const ENEMY_SKIP = new Set(['id', 'def', 'spawnX', 'spawnZ', 'x', 'z', 'prevX', 'prevZ']);
const NPC_SKIP = new Set(['id', 'def', 'baseFacing', 'patrol', 'x', 'z', 'prevX', 'prevZ']);

const round = (n: number) => Math.round(n * 1000) / 1000;

function isPlain(v: unknown): boolean {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isPlain);
  if (typeof v === 'object') return Object.getPrototypeOf(v) === Object.prototype && Object.values(v as object).every(isPlain);
  return false;
}

/** The JSON-safe own fields of an object (numbers rounded), skipping class instances and `skip`. */
function fieldsOf(obj: object, skip: Set<string>): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (skip.has(k) || !isPlain(v)) continue;
    out[k] = typeof v === 'number' ? round(v) : v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  }
  return out;
}

/** Creatures and NPCs further than this from the player (tiles) are left out of snapshots. */
export const INTEREST_RADIUS = 32;

export function captureState(world: GameWorld, tick: number, ack: number, radius = INTEREST_RADIUS): WorldState {
  const p = world.player;
  const near = (e: { x: number; z: number }) => Math.abs(e.x - p.x) <= radius && Math.abs(e.z - p.z) <= radius;
  return {
    tick,
    time: round(world.time),
    ack,
    player: { x: round(p.x), z: round(p.z), f: fieldsOf(p, PLAYER_SKIP), prayers: [...p.prayers] },
    enemies: world.enemies.filter(near).map((e) => ({ id: e.id, x: round(e.x), z: round(e.z), f: fieldsOf(e, ENEMY_SKIP) })),
    npcs: world.npcs.filter(near).map((n) => ({ id: n.id, x: round(n.x), z: round(n.z), f: fieldsOf(n, NPC_SKIP) })),
    depleted: world.nodes.filter((n) => n.depleted).map((n) => n.id),
    hits: world.nodes.filter((n) => n.hitAge < 1).map((n) => [n.id, round(n.hitAge)] as [number, number]),
    ground: world.groundItems.filter((g) => !g.expired).map((g) => ({ id: g.id, item: g.item, qty: g.qty, x: g.x, z: g.z, owner: g.owner, age: round(g.age) })),
    graves: world.graves.filter((g) => !g.expired).map((g) => ({ id: g.id, x: g.x, z: g.z, owner: g.owner, items: g.items.map((i) => ({ ...i })), age: round(g.age) })),
    fires: world.fires.filter((f) => !f.expired).map((f) => ({ id: f.id, x: f.x, z: f.z, life: f.life, age: round(f.age) })),
  };
}

/**
 * Applies a snapshot to a replica. Positions are not written (see the module note): the caller
 * gets them in `state.player`, `state.enemies` and `state.npcs`.
 */
export function applyState(world: GameWorld, state: WorldState) {
  const p = world.player;
  Object.assign(p, state.player.f);
  p.prayers = new Set(state.player.prayers as PrayerId[]);
  const enemies = new Map(state.enemies.map((e) => [e.id, e]));
  for (const e of world.enemies) {
    const s = enemies.get(e.id);
    if (s) Object.assign(e, s.f);
  }
  const npcs = new Map(state.npcs.map((n) => [n.id, n]));
  for (const n of world.npcs) {
    const s = npcs.get(n.id);
    if (s) Object.assign(n, s.f);
  }
  const depleted = new Set(state.depleted);
  const hits = new Map(state.hits);
  for (const n of world.nodes) {
    n.depleted = depleted.has(n.id);
    n.hitAge = hits.get(n.id) ?? 99;
  }
  world.syncDynamicEntities(state);
  world.time = state.time;
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
