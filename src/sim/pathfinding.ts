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
