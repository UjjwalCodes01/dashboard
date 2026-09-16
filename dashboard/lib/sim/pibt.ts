/**
 * PIBT — Priority Inheritance with Backtracking.
 *
 * Okumura, Machida, Défago, Tamura, "Priority Inheritance with Backtracking for Iterative
 * Multi-agent Path Finding" (IJCAI 2019). One timestep of PIBT gives every agent a next vertex
 * with three guarantees, by construction rather than by checking afterwards:
 *
 *   1. no two agents are assigned the same vertex   (vertex conflict)
 *   2. no two agents exchange vertices              (edge / swap conflict)
 *   3. an agent that cannot improve holds its cell instead of stepping into trouble
 *
 * The published algorithm assumes a single planner that sees every agent. That would contradict
 * the point of this project, so the engine calls this once per *communication group* — the
 * connected components of the peer graph. Robots outside the group are passed in `obstacles` and
 * are avoided as unpredictable bodies instead of being coordinated with; the continuous-space
 * ORCA filter in ./orca.ts is what keeps those encounters safe.
 *
 * Priorities are dynamic, which is what makes PIBT live rather than merely safe: an agent that has
 * not reached its goal accumulates priority every tick, so it eventually outranks everyone and is
 * pushed through. Reaching the goal resets it. The engine owns that counter; see `bumpPriority`.
 */
import type { Cell } from "../types";
import type { WarehouseMap } from "./map";
import { cellIdx, isFreeCell } from "./map";

/** Exact 4-connected distance-to-goal, BFS'd backwards from the goal and cached per goal cell. */
export class DistanceTable {
  private cache = new Map<number, Int32Array>();
  private order: number[] = [];

  constructor(
    private map: WarehouseMap,
    private limit = 64,
  ) {}

  /** Blocked cells changed, so every cached table is stale. */
  invalidate() {
    this.cache.clear();
    this.order.length = 0;
  }

  /** Distance from each cell to `goal`; -1 where the goal cannot be reached. */
  table(goal: Cell, blocked: ReadonlySet<number>): Int32Array {
    const gi = cellIdx(this.map, goal[0], goal[1]);
    const hit = this.cache.get(gi);
    if (hit) return hit;
    const t = this.bfs(gi, blocked);
    this.cache.set(gi, t);
    this.order.push(gi);
    if (this.order.length > this.limit) {
      const evict = this.order.shift();
      if (evict !== undefined) this.cache.delete(evict);
    }
    return t;
  }

  private bfs(goalIdx: number, blocked: ReadonlySet<number>): Int32Array {
    const m = this.map;
    const w = m.width;
    const n = w * m.height;
    const d = new Int32Array(n).fill(-1);
    if (!m.free[goalIdx]) return d;
    // a robot may be *sitting* on a blocked cell when an aisle is blocked under it; the goal itself
    // is always expandable so it can still be driven to once the block clears
    const q = new Int32Array(n);
    let head = 0;
    let tail = 0;
    d[goalIdx] = 0;
    q[tail++] = goalIdx;
    while (head < tail) {
      const cur = q[head++];
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const nd = d[cur] + 1;
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (!isFreeCell(m, nx, ny)) continue;
        const ni = ny * w + nx;
        if (d[ni] !== -1) continue;
        if (blocked.has(ni)) continue;
        d[ni] = nd;
        q[tail++] = ni;
      }
    }
    return d;
  }
}

export interface PibtAgent {
  id: string;
  cell: Cell;
  /** null while idle; PIBT then prefers holding but will still yield when pushed */
  goal: Cell | null;
  /** already mid-transit into this cell — the reservation is locked for this round */
  committed: Cell | null;
  /** higher decides first; the engine raises it while an agent is short of its goal */
  priority: number;
}

export interface PibtOptions {
  map: WarehouseMap;
  /** cells no robot may enter (blocked aisles) */
  blocked: ReadonlySet<number>;
  /** cells held by bodies this group cannot coordinate with (offline, or another comms group) */
  obstacles: ReadonlySet<number>;
  dist: DistanceTable;
}

/** What one agent considered this round, in the order it tried them, and how each ended. */
export interface PibtTrace {
  candidates: { cell: Cell; dist: number; verdict: string }[];
  chosen: Cell | null;
  pushedBy?: string;
  pushed?: string;
}

export interface PibtOutcome {
  /** agent id -> next cell. Equal to its current cell means "hold". */
  next: Map<string, Cell>;
  /** per-agent reasoning, for the decision inspector */
  trace: Map<string, PibtTrace>;
  /** priority inheritance that actually fired: [pusher, pushed] */
  pushes: [string, string][];
  /** agents that found no improving move and are holding */
  held: string[];
  /** agents whose goal is unreachable from where they stand — the engine should re-plan or re-bid */
  stranded: string[];
}

/** Stable per-agent jitter so symmetric ties break consistently instead of oscillating. */
function jitter(id: string, ci: number): number {
  let h = 2166136261 ^ ci;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 8) & 0xffff) / 0x10000; // [0,1)
}

/**
 * One PIBT round over a set of mutually-aware agents.
 *
 * Every agent ends up in `next`, so the caller can apply the whole round atomically.
 */
export function pibtStep(agents: PibtAgent[], o: PibtOptions): PibtOutcome {
  const m = o.map;
  const key = (c: Cell) => cellIdx(m, c[0], c[1]);

  const claimed = new Map<number, PibtAgent>(); // next-step reservations
  const next = new Map<string, Cell>();
  const occupiedNow = new Map<number, PibtAgent>();
  const pushes: [string, string][] = [];
  const stranded: string[] = [];
  const held: string[] = [];

  for (const a of agents) occupiedNow.set(key(a.cell), a);

  // agents already crossing into a cell keep that reservation; they are not re-decided this round
  for (const a of agents) {
    if (a.committed) {
      claimed.set(key(a.committed), a);
      next.set(a.id, a.committed);
    }
  }

  const tableOf = new Map<string, Int32Array | null>();
  for (const a of agents) tableOf.set(a.id, a.goal ? o.dist.table(a.goal, o.blocked) : null);

  const traceOf = new Map<string, Map<number, { cell: Cell; dist: number; verdict: string }>>();
  const traceFor = (a: PibtAgent) => {
    let t = traceOf.get(a.id);
    if (!t) {
      t = new Map();
      traceOf.set(a.id, t);
    }
    return t;
  };

  /** Reachable moves from an agent's cell, best-first by true distance to its goal. */
  function candidates(a: PibtAgent): Cell[] {
    const [x, y] = a.cell;
    const d = tableOf.get(a.id) ?? null;
    const here = d ? d[key(a.cell)] : -1;
    const tr = traceFor(a);
    const around: Cell[] = [
      [x, y],
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    const raw: Cell[] = [];
    for (const c of around) {
      if (!isFreeCell(m, c[0], c[1])) continue; // walls are not worth listing
      const ci = cellIdx(m, c[0], c[1]);
      const dist = d ? d[ci] : -1;
      if (o.blocked.has(ci)) {
        tr.set(ci, { cell: c, dist, verdict: "blocked" });
        continue;
      }
      if (o.obstacles.has(ci)) {
        tr.set(ci, { cell: c, dist, verdict: "obstacle" });
        continue;
      }
      if (d && dist < 0) {
        tr.set(ci, { cell: c, dist, verdict: "unreachable" });
        continue;
      }
      tr.set(ci, { cell: c, dist, verdict: "open" });
      raw.push(c);
    }
    const score = (c: Cell) => {
      const ci = cellIdx(m, c[0], c[1]);
      const staying = ci === key(a.cell);
      if (!d) return staying ? 0 : 1; // idle: hold unless pushed
      const dv = d[ci];
      // holding is only attractive when it is genuinely no worse; the +0.001 keeps a moving agent
      // moving rather than dithering on an equal-cost cell
      return staying ? dv + 0.001 : dv;
    };
    if (d && here < 0) stranded.push(a.id);
    return raw
      .map((c) => ({ c, s: score(c) + jitter(a.id, cellIdx(m, c[0], c[1])) * 1e-3 }))
      .sort((p, q) => p.s - q.s)
      .map((e) => e.c);
  }

  /**
   * Secure a vertex for `ai`. `aj` is the agent that pushed it, whose cell `ai` must not take
   * (that would be a swap). Returns false when `ai` can only hold, which tells `aj` to back up
   * and try elsewhere.
   */
  function secure(ai: PibtAgent, aj: PibtAgent | null): boolean {
    const tr = traceFor(ai);
    const mark = (v: Cell, verdict: string) => {
      const e = tr.get(key(v));
      if (e) e.verdict = verdict;
    };
    for (const v of candidates(ai)) {
      const vi = key(v);
      if (claimed.has(vi)) {
        mark(v, `claimed:${claimed.get(vi)!.id}`); // vertex conflict
        continue;
      }
      if (aj && vi === key(aj.cell)) {
        mark(v, `swap:${aj.id}`); // swap conflict
        continue;
      }
      claimed.set(vi, ai);
      next.set(ai.id, v);
      const ak = occupiedNow.get(vi);
      if (ak && ak !== ai && !next.has(ak.id)) {
        pushes.push([ai.id, ak.id]);
        if (!secure(ak, ai)) {
          // ak could not vacate and now owns its own cell; drop only our own claim and back up
          if (claimed.get(vi) === ai) claimed.delete(vi);
          next.delete(ai.id);
          pushes.pop();
          mark(v, `push-failed:${ak.id}`);
          continue;
        }
      }
      mark(v, vi === key(ai.cell) ? "hold" : "chosen");
      return true;
    }
    // nothing better than standing still. The agent physically occupies this cell, so its claim
    // wins over a pusher that was hoping to move in.
    claimed.set(key(ai.cell), ai);
    next.set(ai.id, ai.cell);
    mark(ai.cell, "hold");
    return false;
  }

  const order = agents
    .filter((a) => !a.committed)
    .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const a of order) {
    if (next.has(a.id)) continue;
    if (!secure(a, null)) held.push(a.id);
  }

  const trace = new Map<string, PibtTrace>();
  for (const a of agents) {
    const entries = Array.from(traceFor(a).values());
    const chosen = next.get(a.id) ?? null;
    trace.set(a.id, {
      candidates: entries.sort((p, q) => {
        const pd = p.dist < 0 ? Number.POSITIVE_INFINITY : p.dist;
        const qd = q.dist < 0 ? Number.POSITIVE_INFINITY : q.dist;
        return pd - qd;
      }),
      chosen,
    });
  }
  for (const [pusher, pushed] of pushes) {
    const a = trace.get(pusher);
    const b = trace.get(pushed);
    if (a) a.pushed = pushed;
    if (b) b.pushedBy = pusher;
  }
  return { next, trace, pushes, held, stranded: Array.from(new Set(stranded)) };
}

/**
 * PIBT's liveness rule. An agent short of its goal gains priority every tick until it outranks
 * everyone and gets pushed through; arriving resets it. Without this, a low-priority agent in a
 * busy aisle can be deferred forever.
 */
export function bumpPriority(current: number, atGoal: boolean, base: number): number {
  return atGoal ? base : current + 1;
}
