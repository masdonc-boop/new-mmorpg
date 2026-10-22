import { isBlocked, type WorldMap } from './worldmap';

export interface PathPoint {
  x: number;
  z: number;
}

/** Binary min-heap keyed by f-score. */
class Heap {
  private items: number[] = [];
  private scores: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, score: number) {
    this.items.push(item);
    this.scores.push(score);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.scores[p] <= this.scores[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastScore = this.scores.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.scores[0] = lastScore;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.scores[l] < this.scores[m]) m = l;
        if (r < this.items.length && this.scores[r] < this.scores[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.scores[a], this.scores[b]] = [this.scores[b], this.scores[a]];
  }
}

const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

/**
 * 8-directional A* on the tile grid (no corner cutting). Returns tile-centre waypoints
 * excluding the start tile, or null if unreachable. If the goal is blocked, the path
 * ends on the closest reachable tile adjacent to it (used for trees, rocks, NPCs).
 */
export function findPath(map: WorldMap, sx: number, sz: number, gx: number, gz: number, maxNodes = 14000): PathPoint[] | null {
  const W = map.width;
  const start = Math.floor(sz) * W + Math.floor(sx);
  const gtx = Math.floor(gx);
  const gtz = Math.floor(gz);
  const goalBlocked = isBlocked(map, gx, gz);
  // A goal in a part of the map that can't be walked to from here (off the map, across the sea,
  // in Glimmer Hollow) is known at once, without searching everything reachable first.
  if (!reachable(map, Math.floor(sx), Math.floor(sz), gtx, gtz, goalBlocked)) return null;
  const isGoal = (x: number, z: number) =>
    goalBlocked ? Math.max(Math.abs(x - gtx), Math.abs(z - gtz)) === 1 : x === gtx && z === gtz;

  const gScore = new Map<number, number>();
  const came = new Map<number, number>();
  const open = new Heap();
  gScore.set(start, 0);
  open.push(start, 0);
  const h = (x: number, z: number) => {
    const dx = Math.abs(x - gtx);
    const dz = Math.abs(z - gtz);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  let expanded = 0;
  let found = -1;
  const closed = new Set<number>();
  while (open.size > 0 && expanded < maxNodes) {
    const cur = open.pop();
    if (closed.has(cur)) continue;
    closed.add(cur);
    expanded++;
    const cx = cur % W;
    const cz = Math.floor(cur / W);
    if (isGoal(cx, cz)) {
      found = cur;
      break;
    }
    const g = gScore.get(cur)!;
    for (const [dx, dz, cost] of DIRS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (isBlocked(map, nx + 0.5, nz + 0.5)) continue;
      if (dx !== 0 && dz !== 0 && (isBlocked(map, cx + dx + 0.5, cz + 0.5) || isBlocked(map, cx + 0.5, cz + dz + 0.5))) continue;
      const n = nz * W + nx;
      const ng = g + cost;
      if (ng < (gScore.get(n) ?? Infinity)) {
        gScore.set(n, ng);
        came.set(n, cur);
        open.push(n, ng + h(nx, nz));
      }
    }
  }
  if (found < 0) return null;
  const out: PathPoint[] = [];
  let c = found;
  while (c !== start) {
    out.push({ x: (c % W) + 0.5, z: Math.floor(c / W) + 0.5 });
    const p = came.get(c);
    if (p === undefined) break;
    c = p;
  }
  out.reverse();
  return out;
}

/** Remove intermediate waypoints that lie on a straight grid line, for smoother motion. */
export function simplifyPath(path: PathPoint[]): PathPoint[] {
  if (path.length < 3) return path;
  const out: PathPoint[] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1];
    const b = path[i];
    const c = path[i + 1];
    const d1x = Math.sign(b.x - a.x);
    const d1z = Math.sign(b.z - a.z);
    const d2x = Math.sign(c.x - b.x);
    const d2z = Math.sign(c.z - b.z);
    if (d1x !== d2x || d1z !== d2z) out.push(b);
  }
  out.push(path[path.length - 1]);
  return out;
}

/** Connected walkable areas of a map (worked out once per map): tile → area number, or -1 if blocked. */
const AREAS = new WeakMap<WorldMap, Int32Array>();
function areas(map: WorldMap): Int32Array {
  let a = AREAS.get(map);
  if (a) return a;
  const W = map.width;
  const H = map.height;
  a = new Int32Array(W * H).fill(-1);
  let next = 0;
  const stack: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (a[i] !== -1 || isBlocked(map, (i % W) + 0.5, Math.floor(i / W) + 0.5)) continue;
    a[i] = next;
    stack.push(i);
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % W;
      const cz = Math.floor(c / W);
      for (const [dx, dz] of DIRS) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const n = nz * W + nx;
        if (a[n] !== -1 || isBlocked(map, nx + 0.5, nz + 0.5)) continue;
        if (dx !== 0 && dz !== 0 && (isBlocked(map, cx + dx + 0.5, cz + 0.5) || isBlocked(map, cx + 0.5, cz + dz + 0.5))) continue;
        a[n] = next;
        stack.push(n);
      }
    }
    next++;
  }
  AREAS.set(map, a);
  return a;
}

/** Whether a goal tile (or, if it is blocked, a tile next to it) is in the start tile's walkable area. */
function reachable(map: WorldMap, sx: number, sz: number, gx: number, gz: number, goalBlocked: boolean): boolean {
  const W = map.width;
  const inside = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < map.height;
  if (!inside(sx, sz) || !inside(gx, gz)) return false;
  const a = areas(map);
  const home = a[sz * W + sx];
  // Standing somewhere the grid calls blocked (e.g. mid-obstacle): let the search decide.
  if (home === -1) return true;
  if (!goalBlocked) return a[gz * W + gx] === home;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && inside(gx + dx, gz + dz) && a[(gz + dz) * W + gx + dx] === home) return true;
  return false;
}
