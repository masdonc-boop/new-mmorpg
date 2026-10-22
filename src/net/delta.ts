import type { WorldState } from './replica';

/**
 * Change-only snapshots (docs/MULTIPLAYER.md 3A.5). The server remembers the last state it sent
 * each client and sends only what changed since; the client rebuilds the full state from its own
 * copy, so everything after this works on whole snapshots. A WebSocket delivers messages in order
 * and without loss, so no acknowledgement is needed: a new connection always starts from a full
 * state (the welcome).
 *
 * Lists of things with ids (other players, creatures, NPCs, piles, wisps, fires) are sent as the
 * entries that are new or changed, holding only the changed fields (and nested `f` fields), plus
 * the ids that went away. Other parts are sent whole when they change.
 */

type Obj = Record<string, unknown>;
type Keyed = Obj & { id: number };

const LISTS = ['others', 'enemies', 'npcs', 'ground', 'graves', 'fires'] as const;
type ListKey = (typeof LISTS)[number];

export interface ListDelta {
  /** New entries in full, changed entries as their id and the fields that changed. */
  set?: Keyed[];
  /** Entries that only moved, packed as id, x, z, id, x, z, … (the commonest change by far). */
  mv?: number[];
  del?: number[];
}

export interface StateDelta {
  tick: number;
  time: number;
  ack: number;
  /** Changed player fields (x and z always; `f` holds only the fields that changed). */
  player: Obj;
  lists?: Partial<Record<ListKey, ListDelta>>;
  depleted?: number[];
  hits?: [number, number][];
}

const same = (a: unknown, b: unknown) => a === b || (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && JSON.stringify(a) === JSON.stringify(b));

/** The fields of `next` that differ from `prev`; `f` is compared field by field. Null if nothing changed. */
function diffObj(prev: Obj, next: Obj): Obj | null {
  let out: Obj | null = null;
  for (const k of Object.keys(next)) {
    if (k === 'f' && prev.f && next.f) {
      const pf = prev.f as Obj;
      const nf = next.f as Obj;
      // A field going away can't be said as a change, so then the whole `f` is sent.
      const gone = Object.keys(pf).some((x) => !(x in nf));
      const df = gone ? nf : diffObj(pf, nf);
      if (df) (out ??= {}).f = gone ? { $all: true, ...nf } : df;
    } else if (!same(prev[k], next[k])) (out ??= {})[k] = next[k];
  }
  return out;
}

function applyObj(prev: Obj, d: Obj): Obj {
  const out = { ...prev };
  for (const [k, v] of Object.entries(d)) {
    if (k === 'f') {
      const df = v as Obj;
      if (df.$all) {
        const { $all: _, ...rest } = df;
        out.f = rest;
      } else out.f = { ...(prev.f as Obj), ...df };
    } else out[k] = v;
  }
  return out;
}

function diffList(prev: Keyed[], next: Keyed[]): ListDelta | null {
  const before = new Map(prev.map((e) => [e.id, e]));
  const set: Keyed[] = [];
  const mv: number[] = [];
  for (const e of next) {
    const old = before.get(e.id);
    before.delete(e.id);
    if (!old) set.push(e);
    else {
      const d = diffObj(old, e);
      if (!d) continue;
      const keys = Object.keys(d);
      if (keys.every((k) => k === 'x' || k === 'z')) mv.push(e.id, e.x as number, e.z as number);
      else set.push({ ...d, id: e.id });
    }
  }
  const del = [...before.keys()];
  if (!set.length && !mv.length && !del.length) return null;
  return { ...(set.length ? { set } : {}), ...(mv.length ? { mv } : {}), ...(del.length ? { del } : {}) };
}

function applyList(prev: Keyed[], d: ListDelta | undefined): Keyed[] {
  if (!d) return prev;
  const gone = new Set(d.del ?? []);
  const changes = new Map((d.set ?? []).map((e) => [e.id, e]));
  const mv = d.mv ?? [];
  for (let i = 0; i + 2 < mv.length; i += 3) changes.set(mv[i], { ...changes.get(mv[i]), id: mv[i], x: mv[i + 1], z: mv[i + 2] });
  const out: Keyed[] = [];
  for (const e of prev) {
    if (gone.has(e.id)) continue;
    const c = changes.get(e.id);
    changes.delete(e.id);
    out.push(c ? (applyObj(e, c) as Keyed) : e);
  }
  // Whatever is left is new (sent in full).
  for (const c of changes.values()) out.push(c);
  return out;
}

/** What changed from `prev` to `next`. */
export function diffState(prev: WorldState, next: WorldState): StateDelta {
  const d: StateDelta = { tick: next.tick, time: next.time, ack: next.ack, player: { x: next.player.x, z: next.player.z } };
  const pf = diffObj({ f: prev.player.f }, { f: next.player.f });
  if (pf) d.player.f = pf.f;
  if (!same(prev.player.prayers, next.player.prayers)) d.player.prayers = next.player.prayers;
  for (const k of LISTS) {
    const ld = diffList(prev[k] as unknown as Keyed[], next[k] as unknown as Keyed[]);
    if (ld) (d.lists ??= {})[k] = ld;
  }
  if (!same(prev.depleted, next.depleted)) d.depleted = next.depleted;
  if (!same(prev.hits, next.hits)) d.hits = next.hits;
  return d;
}

/** Rebuilds the full state from the previous one and a delta. */
export function patchState(prev: WorldState, d: StateDelta): WorldState {
  const player = applyObj(prev.player as unknown as Obj, d.player) as unknown as WorldState['player'];
  const out = { ...prev, tick: d.tick, time: d.time, ack: d.ack, player, depleted: d.depleted ?? prev.depleted, hits: d.hits ?? prev.hits } as WorldState;
  for (const k of LISTS) (out as unknown as Record<ListKey, Keyed[]>)[k] = applyList(prev[k] as unknown as Keyed[], d.lists?.[k]);
  return out;
}

/** Position updates per snapshot (see `limitMoves`): about 3 KB/s at most, however crowded. */
export const MOVES_PER_SNAPSHOT = 12;

/** Lists whose entries move about and are shown by interpolation. */
const MOVERS = ['others', 'enemies', 'npcs'] as const;

/**
 * Keeps a snapshot within a movement budget (docs/MULTIPLAYER.md 3A.5): of everything that moved
 * since the client last heard, only the `max` most out-of-date get their new position this time,
 * the rest keep the position the client already has. "Out of date" is how far the client's copy is
 * from the truth, weighted towards things close to the viewer, so whatever is skipped gets more
 * urgent and is sent soon after. Everything else in the snapshot is untouched.
 *
 * Returns the state to send (and to remember as what the client now has).
 */
export function limitMoves(prev: WorldState, next: WorldState, max: number): WorldState {
  const vx = next.player.x;
  const vz = next.player.z;
  const moved: { list: (typeof MOVERS)[number]; i: number; score: number }[] = [];
  const held = new Map<(typeof MOVERS)[number], Map<number, Keyed>>();
  for (const list of MOVERS) {
    const before = new Map((prev[list] as unknown as Keyed[]).map((e) => [e.id, e]));
    held.set(list, before);
    (next[list] as unknown as Keyed[]).forEach((e, i) => {
      const old = before.get(e.id);
      if (!old) return;
      const err = Math.hypot((e.x as number) - (old.x as number), (e.z as number) - (old.z as number));
      if (err === 0) return;
      moved.push({ list, i, score: err / Math.max(3, Math.hypot((e.x as number) - vx, (e.z as number) - vz)) });
    });
  }
  if (moved.length <= max) return next;
  moved.sort((a, b) => b.score - a.score);
  const out = { ...next } as WorldState;
  for (const list of MOVERS) (out as unknown as Record<string, Keyed[]>)[list] = [...(next[list] as unknown as Keyed[])];
  for (const m of moved.slice(max)) {
    const arr = (out as unknown as Record<string, Keyed[]>)[m.list];
    const e = arr[m.i];
    const old = held.get(m.list)!.get(e.id)!;
    arr[m.i] = { ...e, x: old.x, z: old.z };
  }
  return out;
}
