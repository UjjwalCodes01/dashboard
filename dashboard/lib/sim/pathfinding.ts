import type { Cell } from "../types";

/** Minimal binary heap keyed on f-score. */
class Heap {
  private a: { i: number; f: number }[] = [];
  get size() {
    return this.a.length;
  }
  push(i: number, f: number) {
    const a = this.a;
    a.push({ i, f });
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (a[p].f <= a[k].f) break;
      [a[p], a[k]] = [a[k], a[p]];
      k = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1,
          r = l + 1;
        let m = k;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        k = m;
      }
    }
    return top.i;
  }
}

export interface PathOptions {
  /** cells that cannot be entered (index = y*w+x) */
  blocked?: Set<number>;
  /** cells that are discouraged (extra cost) */
  avoid?: Map<number, number>;
  /** maximum expansions before giving up */
  maxExpand?: number;
}

/**
 * 4-connected A* on a boolean grid. Returns the path excluding the start cell,
 * or null when unreachable. Manhattan heuristic (admissible on a 4-grid).
 */
export function astar(
  free: Uint8Array,
  w: number,
  h: number,
  start: Cell,
  goal: Cell,
  opts: PathOptions = {},
): Cell[] | null {
  const [sx, sy] = start;
  const [gx, gy] = goal;
  if (sx === gx && sy === gy) return [];
  const n = w * h;
  const sIdx = sy * w + sx;
  const gIdx = gy * w + gx;
  const blocked = opts.blocked;
  if (!free[gIdx] || (blocked && blocked.has(gIdx) && gIdx !== sIdx)) return null;
  const g = new Float32Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new Heap();
  g[sIdx] = 0;
  heap.push(sIdx, Math.abs(sx - gx) + Math.abs(sy - gy));
  const maxExpand = opts.maxExpand ?? n * 2;
  let expanded = 0;
  const dx = [1, -1, 0, 0];
  const dy = [0, 0, 1, -1];
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === gIdx) break;
    if (++expanded > maxExpand) return null;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (let d = 0; d < 4; d++) {
      const nx = cx + dx[d];
      const ny = cy + dy[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (!free[ni] || closed[ni]) continue;
      if (blocked && blocked.has(ni) && ni !== gIdx) continue;
      let cost = 1;
      if (opts.avoid) {
        const extra = opts.avoid.get(ni);
        if (extra) cost += extra;
      }
      const ng = g[cur] + cost;
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = cur;
        heap.push(ni, ng + Math.abs(nx - gx) + Math.abs(ny - gy));
      }
    }
  }
  if (came[gIdx] === -1) return null;
  const path: Cell[] = [];
  let cur = gIdx;
  while (cur !== sIdx) {
    path.push([cur % w, Math.floor(cur / w)]);
    cur = came[cur];
  }
  path.reverse();
  return path;
}

/** BFS distance map from a cell (for bids / heuristics). */
export function bfsDistance(
  free: Uint8Array,
  w: number,
  h: number,
  from: Cell,
  to: Cell,
): number {
  const p = astar(free, w, h, from, to);
  return p ? p.length : Infinity;
}
