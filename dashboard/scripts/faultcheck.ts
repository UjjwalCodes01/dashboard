/* Fault-injection matrix for the PIBT + ORCA stack.
 *
 * Every case asserts the same non-negotiable property — zero collisions — plus liveness, so a
 * "safe" engine that simply parks every robot cannot pass. Run: npx tsx scripts/faultcheck.ts */
import fs from "node:fs";
import path from "node:path";
import { analyseMap, buildMapMsg, cellIdx, type MapConfig, type WarehouseMap } from "../lib/sim/map";
import { FleetEngine } from "../lib/sim/engine";
import type { Cell, ClientMsg, ServerMsg } from "../lib/types";

const root = path.resolve(__dirname, "..");
const text = fs.readFileSync(path.join(root, "public/maps/warehouse-10-20-10-2-1.map"), "utf8");
const cfg = JSON.parse(fs.readFileSync(path.join(root, "public/maps/map_config.json"), "utf8")) as MapConfig;
const map: WarehouseMap = analyseMap(buildMapMsg(text, cfg));

let failures = 0;
const ok = (cond: boolean, msg: string, extra = "") => {
  console.log(`${cond ? "OK " : "BAD"} ${msg}${extra ? `  ${extra}` : ""}`);
  if (!cond) failures++;
};

interface Case {
  name: string;
  robots?: number;
  seed?: number;
  scenario?: import("../lib/sim/scenarios").ScenarioName;
  /** faults to fire, keyed by sim-second */
  at: Record<number, ClientMsg[]>;
  seconds?: number;
  /** minimum tasks that must still complete, to prove the fleet did not just freeze */
  minDone?: number;
}

/** A one-lane choke cell, the nastiest place to strand a robot. */
const chokeCell: Cell = map.chokes.length ? map.chokes[Math.floor(map.chokes.length / 2)] : [21, 7];

const kill = (id: string): ClientMsg => ({ type: "fault", action: "disable_robot", target: id, value: true });
const link = (id: string, up: boolean): ClientMsg => ({ type: "fault", action: "toggle_link", target: id, value: up });
const blockCell = (cell: Cell): ClientMsg => ({ type: "fault", action: "block_cell", cell });
const partition = (on: boolean): ClientMsg => ({ type: "fault", action: "partition", value: on });
const loss = (pct: number): ClientMsg => ({ type: "fault", action: "set_loss", value: pct });
const latency = (ms: number): ClientMsg => ({ type: "fault", action: "set_latency", value: ms });
const unblock = (): ClientMsg => ({ type: "fault", action: "unblock_all" });
const worker = (cell?: Cell): ClientMsg => ({ type: "fault", action: "pedestrian", cell });
const blackout = (seconds: number): ClientMsg => ({ type: "fault", action: "blackout", seconds });
const surge = (mult: number, seconds: number): ClientMsg => ({ type: "fault", action: "task_surge", value: mult, seconds });
const drain = (id: string): ClientMsg => ({ type: "fault", action: "set_battery", target: id, value: 22 });

const CASES: Case[] = [
  { name: "baseline: no faults at all", at: {}, minDone: 4 },
  { name: "kill one link", at: { 20: [link("AMR-02", false)] }, minDone: 4 },
  { name: "kill every link (total comms blackout)", at: { 20: Array.from({ length: 10 }, (_, i) => link(`AMR-${String(i + 1).padStart(2, "0")}`, false)) }, minDone: 1 },
  { name: "links flap on and off repeatedly", at: { 20: [link("AMR-01", false)], 40: [link("AMR-01", true), link("AMR-03", false)], 60: [link("AMR-03", true), link("AMR-05", false)], 80: [link("AMR-05", true)] }, minDone: 4 },
  { name: "kill a robot", at: { 30: [kill("AMR-03")] }, minDone: 4 },
  { name: "kill a robot inside a one-lane choke point", scenario: "choke", at: { 40: [kill("AMR-02")] }, minDone: 1 },
  { name: "kill three robots", at: { 25: [kill("AMR-02")], 45: [kill("AMR-05")], 65: [kill("AMR-07")] }, minDone: 3 },
  { name: "block an aisle", at: { 30: [blockCell(chokeCell)] }, minDone: 4 },
  { name: "block a choke, then clear it", at: { 30: [blockCell(chokeCell)], 90: [unblock()] }, minDone: 4 },
  { name: "partition the fleet into two groups", at: { 25: [partition(true)] }, minDone: 3 },
  { name: "partition, then heal", at: { 25: [partition(true)], 90: [partition(false)] }, minDone: 4 },
  { name: "heavy packet loss and latency", at: { 20: [loss(60), latency(400)] }, minDone: 3 },
  { name: "everything at once: partition + kills + block + loss", at: { 20: [loss(40), latency(250)], 30: [partition(true)], 45: [kill("AMR-04")], 60: [blockCell(chokeCell)], 75: [kill("AMR-08")] }, minDone: 1 },
  { name: "12 robots, maximum density", robots: 12, at: {}, minDone: 5 },
  { name: "12 robots with a partition and two kills", robots: 12, at: { 30: [partition(true)], 50: [kill("AMR-03")], 70: [kill("AMR-09")] }, minDone: 3 },
  { name: "head-on scenario with the link cut mid-encounter", scenario: "head_on", at: { 35: [link("AMR-01", false), link("AMR-02", false)] }, minDone: 1 },
  // ── new simulation types ──
  { name: "worker walking a busy aisle", at: { 15: [worker([32, 10])], 40: [worker([54, 22])] }, minDone: 3 },
  { name: "three workers at once, 12 robots", robots: 12, at: { 10: [worker([21, 20]), worker([43, 20]), worker([65, 20])] }, minDone: 3 },
  { name: "30 s comms blackout mid-run", at: { 30: [blackout(30)] }, minDone: 3 },
  { name: "blackout while workers are in the aisles", at: { 15: [worker([32, 10])], 30: [blackout(40)] }, minDone: 2 },
  { name: "order surge ×4 for 60 s", at: { 10: [surge(4, 60)] }, minDone: 5 },
  { name: "six batteries drained to 22 % at once", at: { 10: ["AMR-01", "AMR-02", "AMR-03", "AMR-04", "AMR-05", "AMR-06"].map(drain) }, minDone: 2 },
  { name: "scenario: rush hour", scenario: "rush_hour", at: {}, minDone: 5 },
  { name: "scenario: total blackout", scenario: "blackout", at: {}, minDone: 3 },
  { name: "scenario: battery crisis", scenario: "battery_crisis", at: {}, minDone: 2 },
  { name: "scenario: convoy against the flow", scenario: "convoy", at: {}, minDone: 1 },
  { name: "scenario: cascading failure", scenario: "cascade", at: {}, minDone: 2 },
  { name: "scenario: workers in the aisles", scenario: "pedestrians", at: {}, minDone: 3 },
];

/** Independent referee: no two robots may share a cell, ever. */
function refereeCollisions(eng: FleetEngine): number {
  const seen = new Map<number, string>();
  let bad = 0;
  for (const r of eng.snapshot()) {
    const i = cellIdx(map, r.cell[0], r.cell[1]);
    const prev = seen.get(i);
    if (prev && prev !== r.robot_id) bad++;
    seen.set(i, r.robot_id);
  }
  return bad;
}

for (const c of CASES) {
  const seconds = c.seconds ?? 180;
  const errors: string[] = [];
  const eng = new FleetEngine({
    map,
    seed: c.seed ?? 42,
    scenario: c.scenario ?? "normal",
    mode: "ours",
    robotCount: c.robots ?? 10,
    warmupSeconds: 0,
    onMessage: (m: ServerMsg) => {
      if (m.type === "event" && m.level === "error") errors.push(m.text);
    },
  });

  let refereeHits = 0;
  const fired = new Set<number>();
  for (let i = 0; i < seconds * 5; i++) {
    const sec = Math.floor(i / 5);
    if (c.at[sec] && !fired.has(sec)) {
      fired.add(sec);
      for (const msg of c.at[sec]) eng.handleClient(msg);
    }
    eng.step(0.2);
    if (i % 5 === 0) refereeHits += refereeCollisions(eng);
  }

  const st = eng.stats();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contacts = ((eng as any).fleetStats().pedestrian_contacts as number) ?? 0;
  const collisionErrors = errors.filter((e) => e.startsWith("COLLISION") || e.startsWith("CONTACT")).length;
  const clean = st.collisions === 0 && collisionErrors === 0 && refereeHits === 0 && contacts === 0;
  const live = st.tasks_done >= (c.minDone ?? 1);
  ok(clean && live, c.name, `collisions=${st.collisions}/referee=${refereeHits} workerContacts=${contacts} done=${st.tasks_done} (need ${c.minDone ?? 1}) stop=${st.stop_time_s.toFixed(0)}s`);
}

console.log(failures ? `\n${failures} fault case(s) failed` : "\nevery fault case held: zero collisions, zero worker contacts, fleet still working");
process.exit(failures ? 1 : 0);
