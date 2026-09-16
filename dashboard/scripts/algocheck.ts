/* Correctness tests for the PIBT planner and the ORCA filter, independent of the fleet engine.
   Run: npx tsx scripts/algocheck.ts */
import type { Cell } from "../lib/types";
import type { WarehouseMap } from "../lib/sim/map";
import { DistanceTable, pibtStep, type PibtAgent } from "../lib/sim/pibt";
import { orcaLines, orcaVelocity, safeSpeedAlong, satisfies, type OrcaAgent, type OrcaNeighbour, type Vec2 } from "../lib/sim/orca";

let failures = 0;
const ok = (cond: boolean, msg: string, extra = "") => {
  console.log(`${cond ? "OK " : "BAD"} ${msg}${extra ? `  ${extra}` : ""}`);
  if (!cond) failures++;
};
const section = (s: string) => console.log(`\n── ${s} ──`);

/** Build a grid from ASCII art: '.' free, '#' wall. */
function gridFromArt(rows: string[]): WarehouseMap {
  const h = rows.length;
  const w = rows[0].length;
  const free = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) free[y * w + x] = rows[y][x] === "#" ? 0 : 1;
  return { width: w, height: h, free } as unknown as WarehouseMap;
}

const NO_BLOCK: ReadonlySet<number> = new Set<number>();
const key = (m: WarehouseMap, c: Cell) => c[1] * m.width + c[0];
const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];

/** Assert PIBT's two structural guarantees on one round's output. */
function checkRound(m: WarehouseMap, before: Map<string, Cell>, next: Map<string, Cell>): string | null {
  const seen = new Map<number, string>();
  for (const [id, c] of next) {
    const k = key(m, c);
    const prev = seen.get(k);
    if (prev) return `vertex conflict at ${c} between ${prev} and ${id}`;
    seen.set(k, id);
  }
  for (const [id, to] of next) {
    const from = before.get(id)!;
    for (const [oid, oto] of next) {
      if (oid === id) continue;
      const ofrom = before.get(oid)!;
      if (same(to, ofrom) && same(oto, from)) return `swap conflict between ${id} and ${oid}`;
    }
  }
  for (const [id, to] of next) {
    const from = before.get(id)!;
    const md = Math.abs(to[0] - from[0]) + Math.abs(to[1] - from[1]);
    if (md > 1) return `${id} teleported ${from} -> ${to}`;
  }
  return null;
}

/** Run a whole scenario to completion (or until maxSteps), checking every round. */
function simulate(m: WarehouseMap, starts: Record<string, Cell>, goals: Record<string, Cell | null>, maxSteps = 400) {
  const dist = new DistanceTable(m);
  const base: Record<string, number> = {};
  const ids = Object.keys(starts);
  ids.forEach((id, i) => (base[id] = i * 1e-3));
  const agents: PibtAgent[] = ids.map((id) => ({ id, cell: starts[id], goal: goals[id], committed: null, priority: base[id] }));

  let violation: string | null = null;
  let steps = 0;
  let pushCount = 0;
  const everArrived = new Set<string>();
  for (; steps < maxSteps; steps++) {
    for (const a of agents) if (!a.goal || same(a.cell, a.goal)) everArrived.add(a.id);
    if (agents.every((a) => !a.goal || same(a.cell, a.goal))) break;
    const before = new Map(agents.map((a) => [a.id, a.cell] as const));
    const out = pibtStep(agents, { map: m, blocked: NO_BLOCK, obstacles: new Set(), dist });
    pushCount += out.pushes.length;
    const bad = checkRound(m, before, out.next);
    if (bad && !violation) violation = `step ${steps}: ${bad}`;
    for (const a of agents) {
      const nc = out.next.get(a.id);
      if (nc) a.cell = nc;
      const atGoal = !a.goal || same(a.cell, a.goal);
      a.priority = atGoal ? base[a.id] : a.priority + 1;
    }
  }
  for (const a of agents) if (!a.goal || same(a.cell, a.goal)) everArrived.add(a.id);
  const arrived = agents.filter((a) => !a.goal || same(a.cell, a.goal)).length;
  return { violation, steps, arrived, reached: everArrived.size, total: agents.length, pushCount, agents };
}

// ───────────────────────────────── PIBT ─────────────────────────────────
section("PIBT · head-on in a one-lane corridor with a side pocket");
{
  //  the pocket at (3,0) is the only place to step aside
  const m = gridFromArt([
    "###.###",
    ".......",
    "#######",
  ]);
  const r = simulate(m, { A: [1, 1], B: [5, 1] }, { A: [5, 1], B: [1, 1] });
  ok(r.violation === null, "no vertex/swap conflict", r.violation ?? "");
  ok(r.reached === 2, "both agents got through the pocket to the far end", `${r.reached}/2 in ${r.steps} steps`);
  ok(r.pushCount > 0, "priority inheritance fired", `${r.pushCount} pushes`);
}

section("PIBT · open-ended corridor: swap solved by pushing, no side pocket needed");
{
  // x = 0..6 all free. A and B want to trade ends of a strictly one-lane corridor. Reachability is
  // still achievable: B touches its goal early, is then pushed to the far end as the lower-priority
  // agent, and A walks through behind it. This is priority inheritance doing the whole job.
  const m = gridFromArt(["#######", ".......", "#######"]);
  const r = simulate(m, { A: [1, 1], B: [5, 1] }, { A: [5, 1], B: [1, 1] }, 200);
  ok(r.violation === null, "no vertex/swap conflict", r.violation ?? "");
  ok(r.reached === 2, "both ends reached without any passing place", `${r.reached}/2 in ${r.steps} steps`);
}

section("PIBT · sealed corridor: genuinely unsolvable, must fail safely");
{
  // walls at both ends, so neither agent can ever step out of the other's way
  const m = gridFromArt(["#######", "#.....#", "#######"]);
  const r = simulate(m, { A: [1, 1], B: [5, 1] }, { A: [5, 1], B: [1, 1] }, 120);
  ok(r.violation === null, "stays conflict-free while deadlocked", r.violation ?? "");
  ok(r.reached === 0, "neither agent teleports through the other", `${r.reached}/2 reached`);
}

section("PIBT · idle agent parked on someone's only route gets pushed");
{
  const m = gridFromArt(["#######", ".......", "#######"]);
  //  B is idle (no goal) sitting mid-corridor; A must get past it
  const r = simulate(m, { A: [1, 1], B: [3, 1] }, { A: [5, 1], B: null }, 80);
  ok(r.violation === null, "no conflict", r.violation ?? "");
  ok(r.reached === 2, "A reached its goal by pushing the idle agent along", `A at ${r.agents[0].cell}`);
  ok(r.pushCount > 0, "the push was priority inheritance, not luck", `${r.pushCount} pushes`);
}

section("PIBT · unreachable goal is reported, not silently retried");
{
  const m = gridFromArt(["....#....", "....#....", "....#...."]);
  const dist = new DistanceTable(m);
  const agents: PibtAgent[] = [{ id: "A", cell: [1, 1], goal: [7, 1], committed: null, priority: 1 }];
  const out = pibtStep(agents, { map: m, blocked: NO_BLOCK, obstacles: new Set(), dist });
  ok(out.stranded.includes("A"), "agent walled off from its goal is flagged stranded");
  ok(same(out.next.get("A")!, [1, 1]), "and holds position instead of wandering");
}

section("PIBT · blocked cells are respected and invalidate the distance cache");
{
  const m = gridFromArt(["#####", ".....", "#####"]);
  const dist = new DistanceTable(m);
  const agents: PibtAgent[] = [{ id: "A", cell: [1, 1], goal: [3, 1], committed: null, priority: 1 }];
  const clear = pibtStep(agents, { map: m, blocked: NO_BLOCK, obstacles: new Set(), dist });
  ok(same(clear.next.get("A")!, [2, 1]), "steps toward the goal when the aisle is clear");
  dist.invalidate();
  const blocked = new Set<number>([key(m, [2, 1])]);
  const out = pibtStep(agents, { map: m, blocked, obstacles: new Set(), dist });
  ok(!same(out.next.get("A")!, [2, 1]), "never enters a blocked cell", `chose ${out.next.get("A")}`);
}

section("PIBT · a body it cannot coordinate with is treated as an obstacle");
{
  const m = gridFromArt(["#####", ".....", "#####"]);
  const dist = new DistanceTable(m);
  const agents: PibtAgent[] = [{ id: "A", cell: [1, 1], goal: [3, 1], committed: null, priority: 1 }];
  const obstacles = new Set<number>([key(m, [2, 1])]); // an unreachable peer stands here
  const out = pibtStep(agents, { map: m, blocked: NO_BLOCK, obstacles, dist });
  ok(same(out.next.get("A")!, [1, 1]), "holds rather than driving into a robot it cannot talk to");
}

section("PIBT · mid-transit reservations are honoured");
{
  const m = gridFromArt(["#####", ".....", "#####"]);
  const dist = new DistanceTable(m);
  const agents: PibtAgent[] = [
    { id: "A", cell: [1, 1], goal: [3, 1], committed: null, priority: 5 },
    { id: "B", cell: [3, 1], goal: [1, 1], committed: [2, 1], priority: 1 }, // already crossing into (2,1)
  ];
  const out = pibtStep(agents, { map: m, blocked: NO_BLOCK, obstacles: new Set(), dist });
  ok(same(out.next.get("B")!, [2, 1]), "the committed agent keeps its reservation");
  ok(!same(out.next.get("A")!, [2, 1]), "the higher-priority agent cannot steal it", `A chose ${out.next.get("A")}`);
}

section("PIBT · determinism");
{
  const m = gridFromArt(["#########", ".........", ".........", "#########"]);
  const run = () => simulate(m, { A: [1, 1], B: [7, 1], C: [1, 2], D: [7, 2] }, { A: [7, 2], B: [1, 2], C: [7, 1], D: [1, 1] });
  const a = run();
  const b = run();
  ok(a.steps === b.steps && a.arrived === b.arrived, "identical input gives an identical run", `${a.steps} vs ${b.steps} steps`);
}

section("PIBT · dense stress, 24 agents shuffling in a warehouse-shaped grid");
{
  const rows: string[] = [];
  for (let y = 0; y < 15; y++) {
    let s = "";
    for (let x = 0; x < 31; x++) s += y % 3 === 1 || x % 5 === 0 ? "." : "#";
    rows.push(s);
  }
  const m = gridFromArt(rows);
  const freeCells: Cell[] = [];
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (m.free[y * m.width + x]) freeCells.push([x, y]);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = () => freeCells[Math.floor(rnd() * freeCells.length)];
  const starts: Record<string, Cell> = {};
  const goals: Record<string, Cell | null> = {};
  const used = new Set<number>();
  for (let i = 0; i < 24; i++) {
    let c = pick();
    while (used.has(key(m, c))) c = pick();
    used.add(key(m, c));
    starts[`R${i}`] = c;
    goals[`R${i}`] = pick();
  }
  const r = simulate(m, starts, goals, 1500);
  ok(r.violation === null, "no vertex or swap conflict across the whole run", r.violation ?? `${r.steps} steps`);
  // PIBT guarantees *reachability* — every agent visits its goal in finite time — not that they all
  // sit on their goals simultaneously at the end. An arrived agent drops to lowest priority and is
  // pushed aside by agents still travelling. That is the right behaviour for lifelong warehouse
  // MAPF, where reaching a pickup immediately earns the robot a new goal anyway.
  ok(r.reached === r.total, "every agent reached its goal at least once (PIBT reachability)", `${r.reached}/${r.total} in ${r.steps} steps`);
  ok(r.pushCount > 50, "priority inheritance carried the congestion", `${r.pushCount} pushes`);
}

// ───────────────────────────────── ORCA ─────────────────────────────────
const mkAgent = (p: Vec2, v: Vec2, r = 0.35, maxSpeed = 1): OrcaAgent => ({ position: p, velocity: v, radius: r, maxSpeed });

section("ORCA · head-on pair");
{
  const a = mkAgent({ x: 0, y: 0 }, { x: 1, y: 0 });
  const b: OrcaNeighbour = { position: { x: 4, y: 0 }, velocity: { x: -1, y: 0 }, radius: 0.35 };
  const lines = orcaLines(a, [b], 2, 0.1);
  const v = orcaVelocity(a, lines, { x: 1, y: 0 });
  ok(lines.length === 1, "one half-plane per neighbour");
  ok(satisfies(lines, v), "chosen velocity satisfies the constraint");
  ok(Math.abs(v.y) > 1e-3 || v.x < 1, "it either steers aside or slows down", `v=(${v.x.toFixed(2)}, ${v.y.toFixed(2)})`);
}

section("ORCA · a clear road is left alone");
{
  const a = mkAgent({ x: 0, y: 0 }, { x: 1, y: 0 });
  const far: OrcaNeighbour = { position: { x: 50, y: 50 }, velocity: { x: 0, y: 0 }, radius: 0.35 };
  const lines = orcaLines(a, [far], 2, 0.1);
  const v = orcaVelocity(a, lines, { x: 1, y: 0 });
  ok(Math.abs(v.x - 1) < 1e-6 && Math.abs(v.y) < 1e-6, "preferred velocity is returned unchanged", `v=(${v.x.toFixed(3)}, ${v.y.toFixed(3)})`);
}

section("ORCA · overlapping agents are driven apart");
{
  const a = mkAgent({ x: 0, y: 0 }, { x: 0, y: 0 });
  const b: OrcaNeighbour = { position: { x: 0.3, y: 0 }, velocity: { x: 0, y: 0 }, radius: 0.35 }; // overlapping
  const lines = orcaLines(a, [b], 2, 0.1);
  const v = orcaVelocity(a, lines, { x: 0, y: 0 });
  ok(v.x < -1e-3, "pushed away from the intruder", `v=(${v.x.toFixed(2)}, ${v.y.toFixed(2)})`);
}

section("ORCA · reciprocal circle, 8 agents crossing through the middle");
{
  const N = 8;
  const R = 5;
  const radius = 0.35;
  const dt = 0.05;
  type A = { p: Vec2; v: Vec2; goal: Vec2 };

  /** `jitterAmt` perturbs the preferred velocity. ORCA is reciprocal, so a perfectly symmetric
   *  start makes every agent pick the mirror-image evasion and the group jams in a stable rosette.
   *  That is a documented property of the algorithm, not a bug: the reference RVO2 samples add the
   *  same perturbation. Both cases are asserted below so the limitation stays visible. */
  function circle(jitterAmt: number) {
    const agents: A[] = [];
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      agents.push({ p: { x: Math.cos(th) * R, y: Math.sin(th) * R }, v: { x: 0, y: 0 }, goal: { x: -Math.cos(th) * R, y: -Math.sin(th) * R } });
    }
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5);
    let minSep = Infinity;
    for (let step = 0; step < 1200; step++) {
      const desired = agents.map((a) => {
        const dx = a.goal.x - a.p.x;
        const dy = a.goal.y - a.p.y;
        const d = Math.hypot(dx, dy);
        if (d < 1e-6) return { x: 0, y: 0 };
        return { x: dx / d + rnd() * jitterAmt, y: dy / d + rnd() * jitterAmt };
      });
      const newV = agents.map((a, i) => {
        const nbs: OrcaNeighbour[] = agents.filter((_, j) => j !== i).map((o) => ({ position: o.p, velocity: o.v, radius }));
        const self = mkAgent(a.p, a.v, radius, 1);
        return orcaVelocity(self, orcaLines(self, nbs, 3, dt), desired[i]);
      });
      agents.forEach((a, i) => {
        a.v = newV[i];
        a.p = { x: a.p.x + a.v.x * dt, y: a.p.y + a.v.y * dt };
      });
      for (let i = 0; i < N; i++)
        for (let j = i + 1; j < N; j++) minSep = Math.min(minSep, Math.hypot(agents[i].p.x - agents[j].p.x, agents[i].p.y - agents[j].p.y));
    }
    const arrived = agents.filter((a) => Math.hypot(a.goal.x - a.p.x, a.goal.y - a.p.y) < 0.6).length;
    return { arrived, minSep };
  }

  const sym = circle(0);
  ok(sym.minSep > radius * 2 * 0.95, "perfectly symmetric start: still never overlaps", `closest ${sym.minSep.toFixed(3)} m vs ${(radius * 2).toFixed(2)} m contact`);
  ok(sym.arrived === 0, "perfectly symmetric start deadlocks, as ORCA is known to", `${sym.arrived}/${N} through`);

  const broken = circle(0.1);
  ok(broken.minSep > radius * 2 * 0.95, "with symmetry broken: never overlaps", `closest ${broken.minSep.toFixed(3)} m`);
  ok(broken.arrived === N, "and every agent crosses to the far side", `${broken.arrived}/${N}`);
}

section("ORCA · speed projected onto a fixed heading");
{
  const a = mkAgent({ x: 0, y: 0 }, { x: 1, y: 0 });
  const blocker: OrcaNeighbour = { position: { x: 1.0, y: 0 }, velocity: { x: 0, y: 0 }, radius: 0.35 };
  const lines = orcaLines(a, [blocker], 2, 0.1);
  const s = safeSpeedAlong(lines, { x: 1, y: 0 }, 1);
  ok(s >= 0 && s <= 1, "stays within the speed range", `${s.toFixed(3)} m/s`);
  ok(s < 0.6, "slows hard for a stationary robot directly ahead", `${s.toFixed(3)} m/s`);
  ok(satisfies(lines, { x: s, y: 0 }, 1e-6), "the projected speed satisfies the half-planes");
  const clear = orcaLines(a, [{ position: { x: 40, y: 0 }, velocity: { x: 0, y: 0 }, radius: 0.35 }], 2, 0.1);
  ok(Math.abs(safeSpeedAlong(clear, { x: 1, y: 0 }, 1) - 1) < 1e-6, "full speed when nothing is near");
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall algorithm checks passed");
process.exit(failures ? 1 : 0);
