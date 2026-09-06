/* Headless check of the mock engine: every scenario for 300 sim-seconds + a baseline-vs-ours benchmark.
   Run: npx tsx scripts/simcheck.ts */
import fs from "node:fs";
import path from "node:path";
import { analyseMap, buildMapMsg, type MapConfig } from "../lib/sim/map";
import { FleetEngine } from "../lib/sim/engine";
import { SCENARIO_LIST } from "../lib/sim/scenarios";
import type { ServerMsg } from "../lib/types";

const root = path.resolve(__dirname, "..");
const text = fs.readFileSync(path.join(root, "public/maps/warehouse-10-20-10-2-1.map"), "utf8");
const cfg = JSON.parse(fs.readFileSync(path.join(root, "public/maps/map_config.json"), "utf8")) as MapConfig;
const map = analyseMap(buildMapMsg(text, cfg));

console.log(
  `map ${map.width}x${map.height} shelves=${map.shelves.length} vAisles=${map.vAisles.map((a) => `${a.name}@${a.x}`).join(",")} hAisles=${map.hAisles.map((a) => a.y).join(",")} chokes=${map.chokes.length} staging<${map.stagingRight}`,
);
for (const s of map.stations) if (!map.free[s.cell[1] * map.width + s.cell[0]]) console.log("  !! station on obstacle", s.id);
for (const c of map.chargers) if (!map.free[c.cell[1] * map.width + c.cell[0]]) console.log("  !! charger on obstacle", c.id);

let failures = 0;
for (const sc of SCENARIO_LIST) {
  const counts: Record<string, number> = {};
  const errors: string[] = [];
  const conflicts: string[] = [];
  const eng = new FleetEngine({
    map,
    seed: 42,
    scenario: sc.name,
    onMessage: (m: ServerMsg) => {
      counts[m.type] = (counts[m.type] ?? 0) + 1;
      if (m.type === "event" && m.level === "error") errors.push(m.text);
      if (m.type === "event" && m.category === "conflict" && conflicts.length < 3) conflicts.push(m.text);
    },
  });
  const t0 = Date.now();
  const travelled = new Map<string, number>();
  let stuck = 0;
  for (let i = 0; i < 5 * 300; i++) {
    eng.step(0.2);
    if (i % (5 * 60) === 0 && i > 0) {
      // any robot that has a task but hasn't moved for 60 s counts as stuck
      for (const r of eng.snapshot()) {
        const key = r.robot_id;
        const d = (r.pose.x * 1000 + r.pose.y) | 0;
        if (travelled.get(key) === d && r.task && r.state !== "charging") stuck++;
        travelled.set(key, d);
      }
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fleet = (eng as any).fleetStats();
  const ok = fleet.collisions === 0 && errors.filter((e) => e.startsWith("COLLISION")).length === 0;
  if (!ok) failures++;
  console.log(
    `${ok ? "OK " : "BAD"} ${sc.name.padEnd(14)} done=${String(fleet.tasks_done).padStart(3)} rebid=${fleet.tasks_rebid} coll=${fleet.collisions} deadlocks=${fleet.deadlocks_resolved} yields=${fleet.yields_total} blocked=${fleet.blocked} idle=${fleet.idle} charging=${fleet.charging} offline=${fleet.offline} stuckChecks=${stuck} events=${counts.event ?? 0} tasks=${counts.task ?? 0} ${Date.now() - t0}ms`,
  );
  for (const c of conflicts) console.log(`      · ${c}`);
  for (const e of errors.slice(0, 3)) console.log(`      ! ${e}`);
}

const SEEDS = [42, 43, 44, 45, 46];
for (const zoneLock of [false, true]) {
const overlapping = true;
console.log(`\nbenchmark (18 tasks, 8 robots, overlapping, baseline=${zoneLock ? "zone-lock controller" : "naive stop-and-wait"}, seeds ${SEEDS.join(",")}):`);
for (const sc of ["normal", "head_on", "intersection", "choke", "blocked_aisle"] as const) {
  const imps: number[] = [];
  let line = "";
  for (const seed of SEEDS) {
    const res: Record<string, ReturnType<FleetEngine["stats"]>> = {};
    for (const mode of ["baseline", "ours"] as const) {
      const eng = new FleetEngine({ map, seed, scenario: sc, mode, robotCount: 8, zoneLock, onMessage: () => {}, benchmark: { taskCount: 18, overlapping } });
      while (!eng.isFinished && eng.t < 1500) eng.step(0.2);
      res[mode] = eng.stats();
    }
    const b = res.baseline;
    const o = res.ours;
    const imp = ((b.elapsed_s - o.elapsed_s) / b.elapsed_s) * 100;
    imps.push(imp);
    line += ` ${b.elapsed_s.toFixed(0)}/${o.elapsed_s.toFixed(0)}s(${imp >= 0 ? "+" : ""}${imp.toFixed(0)}%${b.collisions + o.collisions ? " COLL" : ""})`;
  }
  const mean = imps.reduce((a, b) => a + b, 0) / imps.length;
  const std = Math.sqrt(imps.reduce((a, b) => a + (b - mean) ** 2, 0) / imps.length);
  console.log(`  ${sc.padEnd(13)} mean ${mean >= 0 ? "+" : ""}${mean.toFixed(1)}% ± ${std.toFixed(1)} |${line}`);
}
}
process.exit(failures ? 1 : 0);
