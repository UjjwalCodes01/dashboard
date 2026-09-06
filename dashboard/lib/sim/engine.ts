/**
 * Mock fleet engine — Round 1 scripted telemetry on the final schema.
 *
 * Every robot decides its own next step from the shared intent picture (mock of PIBT):
 *   • cells are reserved before entry, so two robots can never share a cell (collisions = 0 by construction)
 *   • head-on in a one-lane aisle: lower priority (longer remaining path, ties by ID) yields —
 *     it re-routes if a short detour exists, otherwise backs up to the last intersection and side-steps
 *   • blocked aisle → local re-plan; if the cost jumps past the threshold the task is released and re-auctioned
 *   • task allocation = Contract Net Protocol auction: every idle robot bids dist + 0.5·queue + battery penalty,
 *     the lowest bid self-assigns. The dashboard never picks the robot.
 * `mode: "baseline"` switches to stop-and-wait: no intent sharing, no yielding — a robot simply stops when the
 * next cell is occupied and only re-plans after a deadlock timeout. Used by the Benchmark page.
 */
import type {
  Cell,
  ChargerDef,
  ClientMsg,
  EventCategory,
  EventLevel,
  EventMsg,
  FleetStatsMsg,
  HealthGroup,
  HealthItem,
  HealthReportMsg,
  NetworkMsg,
  RobotInfo,
  RobotState,
  RobotStateMsg,
  RobotTaskRef,
  ServerMsg,
  TaskMsg,
  TaskPhase,
  TaskPriority,
  TaskTemplate,
  TargetSpec,
  Block,
  BlockKind,
  CheckResult,
} from "../types";
import { astar } from "./pathfinding";
import { Rng } from "./rng";
import {
  cellIdx,
  cellLabel,
  isFreeCell,
  neighbours4,
  shortLabel,
  type WarehouseMap,
} from "./map";
import { SCENARIOS, type Injection, type ScenarioName, type ScriptedLeg } from "./scenarios";
import { defaultTemplates, expandBlocks } from "./templates";

export type EngineMode = "ours" | "baseline";

export interface EngineOptions {
  map: WarehouseMap;
  seed: number;
  scenario: ScenarioName;
  robotCount?: number;
  mode?: EngineMode;
  onMessage: (m: ServerMsg) => void;
  /** finite task set (benchmark runs). `overlapping` draws tasks from stations that share the same aisles. */
  benchmark?: { taskCount: number; overlapping?: boolean };
  /** sim seconds to pre-run silently so the dashboard opens mid-shift */
  warmupSeconds?: number;
  /** baseline only: central zone lock instead of naive stop-and-wait */
  zoneLock?: boolean;
}

interface RStep {
  kind: BlockKind;
  targetCell?: Cell;
  targetId?: string;
  targetSpec?: TargetSpec;
  seconds?: number;
  lift?: "up" | "down";
  threshold?: number;
  label?: string;
  message?: string;
}

interface Task {
  id: string;
  templateId: string;
  templateName: string;
  priority: TaskPriority;
  blocks: Block[];
  steps: RStep[];
  stepIndex: number;
  phase: TaskPhase;
  bids: Record<string, number>;
  winner: string | null;
  robot: string | null;
  rebids: number;
  createdTs: number;
  assignedTs: number | null;
  doneTs: number | null;
  from: string;
  to: string;
  announceAt: number;
  assignAt: number;
  excluded: Set<string>;
  allowRebid: boolean;
  batteryFloor: number;
  carrying: boolean;
  pathLenAtStep: number;
  shortestTotal: number;
  note?: string;
}

type Mode =
  | "normal"
  | "retreat"
  | "to_charger"
  | "charging"
  | "parking"
  | "offline"
  | "scripted_wait";

interface Robot {
  id: string;
  index: number;
  info: RobotInfo;
  cell: Cell;
  next: Cell | null;
  progress: number;
  heading: number;
  speed: number;
  path: Cell[];
  goal: Cell | null;
  goalLabel: string | null;
  history: Cell[];
  battery: number;
  lift: "up" | "down";
  task: Task | null;
  leg: ScriptedLeg | null;
  legs: ScriptedLeg[];
  dwellUntil: number;
  dwelling: boolean;
  linkOk: boolean;
  neighbours: string[];
  plannerMs: number;
  msgsPerSec: number;
  yieldCount: number;
  tasksDone: number;
  mode: Mode;
  retreat: { waitingFor: string; hub: Cell; until: number; savedGoal: Cell | null } | null;
  waitSince: number;
  lastReplan: number;
  yieldUntil: number;
  noPath: boolean;
  charger: ChargerDef | null;
  chargeAfterTask: boolean;
  resumeTask: boolean;
  seq: number;
  idleSince: number;
  lastHealth: number;
  healthOverall: CheckResult;
  healthFailed: string[];
  stopTime: number;
  distTravelled: number;
  conflictUntil: number;
  clockSkew: number;
  offlineByFault: boolean;
}

const COMMS_RANGE = 12;
const BATTERY_FLOOR = 20;
const CHARGE_TO = 88;

const cellEq = (a: Cell | null | undefined, b: Cell | null | undefined) =>
  !!a && !!b && a[0] === b[0] && a[1] === b[1];

function headingOf(from: Cell, to: Cell): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (dx > 0) return 0;
  if (dx < 0) return 180;
  if (dy > 0) return 270; // screen down
  return 90;
}

export class FleetEngine {
  readonly map: WarehouseMap;
  readonly mode: EngineMode;
  readonly seed: number;
  readonly scenario: ScenarioName;
  private rng: Rng;
  private taskRng: Rng;
  private onMessage: (m: ServerMsg) => void;
  private robots: Robot[] = [];
  private robotById = new Map<string, Robot>();
  private tasks: Task[] = [];
  private taskSeq = 100;
  private eventSeq = 0;
  t = 0;
  private lastStats = -10;
  private lastNetwork = -10;
  private networkDirty = true;
  private injections: Injection[] = [];
  private injectionCursor = 0;
  private phaseLabel = "steady state";
  blocked = new Set<number>();
  private blockedNotes = new Map<number, string>();
  private partitions: string[][] = [];
  private lossPct = 0;
  private latencyMs = 0;
  private collisions = 0;
  private deadlocks = 0;
  private rebidsTotal = 0;
  private doneTimestamps: number[] = [];
  private conflictCooldown = new Map<string, number>();
  private quiet = false;
  private benchmark?: { taskCount: number; overlapping?: boolean };
  private templates: TaskTemplate[];
  private tasksTotal = 0;
  private resolutionTimes: number[] = [];
  private chokePasses = 0;
  private plannerSamples: number[] = [];
  private finished = false;
  /** one-lane aisle segment id per cell (−1 = open area / intersection). Baseline locks whole segments. */
  private segmentOf: Int32Array;
  private segCount = 0;
  /** baseline variant: true = central zone lock (traffic controller), false = naive stop-and-wait */
  private zoneLock: boolean;

  constructor(opts: EngineOptions) {
    this.map = opts.map;
    this.mode = opts.mode ?? "ours";
    this.seed = opts.seed;
    this.scenario = opts.scenario;
    this.rng = new Rng(opts.seed);
    this.taskRng = new Rng(opts.seed ^ 0x5bd1e995);
    this.onMessage = opts.onMessage;
    this.benchmark = opts.benchmark;
    this.zoneLock = opts.zoneLock ?? false;
    this.templates = defaultTemplates();
    this.segmentOf = this.buildSegments();
    const count = Math.max(3, Math.min(12, opts.robotCount ?? 6));
    this.spawnRobots(count);
    this.applyScenario();
    this.emit({ type: "robot_info", robots: this.robots.map((r) => r.info) });
    if (this.benchmark) this.seedBenchmarkTasks(this.benchmark.taskCount);
    if (opts.warmupSeconds && opts.warmupSeconds > 0) {
      this.quiet = true;
      const ticks = Math.floor(opts.warmupSeconds / 0.2);
      for (let i = 0; i < ticks; i++) this.tick(0.2);
      this.quiet = false;
      // reset the scenario clock so injections (if any) are relative to "now"
    }
    this.emitSnapshot();
  }

  // ------------------------------------------------------------------ setup

  /** Flood-fill one-lane corridor cells (exactly two free neighbours, inside the shelf band, not a crossing) into segments. */
  private buildSegments(): Int32Array {
    const m = this.map;
    const seg = new Int32Array(m.width * m.height).fill(-1);
    const isCorridor = (x: number, y: number) =>
      isFreeCell(m, x, y) && x >= m.stagingRight && neighbours4(m, x, y).length === 2 && !m.chokeName.has(cellIdx(m, x, y));
    let id = 0;
    for (let y = 0; y < m.height; y++)
      for (let x = 0; x < m.width; x++) {
        const i = cellIdx(m, x, y);
        if (seg[i] >= 0 || !isCorridor(x, y)) continue;
        const stack: Cell[] = [[x, y]];
        seg[i] = id;
        while (stack.length) {
          const [cx, cy] = stack.pop()!;
          for (const [nx, ny] of neighbours4(m, cx, cy)) {
            const ni = cellIdx(m, nx, ny);
            if (seg[ni] < 0 && isCorridor(nx, ny)) {
              seg[ni] = id;
              stack.push([nx, ny]);
            }
          }
        }
        id++;
      }
    this.segCount = id;
    return seg;
  }

  private spawnRobots(count: number) {
    for (let i = 0; i < count; i++) {
      const id = `AMR-${String(i + 1).padStart(2, "0")}`;
      const lift = i % 2 === 0;
      const info: RobotInfo = {
        id,
        model: lift ? "AMR-L600 lift" : "AMR-P1200 pallet",
        board: i % 3 === 1 ? "Jetson Orin Nano Super" : "Raspberry Pi 5 (8 GB)",
        firmware: i % 4 === 3 ? "edge-1.4.1" : "edge-1.4.2",
        ip: `10.42.0.${11 + i}`,
        max_speed: Math.round(this.rng.range(0.6, 1.0) * 100) / 100,
      };
      const start: Cell = [3 + (i % 3) * 3, 6 + Math.floor(i / 3) * 6];
      const r: Robot = {
        id,
        index: i,
        info,
        cell: start,
        next: null,
        progress: 0,
        heading: 0,
        speed: 0,
        path: [],
        goal: null,
        goalLabel: null,
        history: [],
        battery: Math.round((95 - i * (50 / Math.max(1, count - 1)) + this.rng.range(-3, 3)) * 10) / 10,
        lift: "down",
        task: null,
        leg: null,
        legs: [],
        dwellUntil: 0,
        dwelling: false,
        linkOk: true,
        neighbours: [],
        plannerMs: 3,
        msgsPerSec: 5,
        yieldCount: 0,
        tasksDone: 0,
        mode: "normal",
        retreat: null,
        waitSince: -1,
        lastReplan: -10,
        yieldUntil: -1,
        noPath: false,
        charger: null,
        chargeAfterTask: false,
        resumeTask: false,
        seq: 0,
        idleSince: 0,
        lastHealth: -100 + i * 1.3,
        healthOverall: "PASS",
        healthFailed: [],
        stopTime: 0,
        distTravelled: 0,
        conflictUntil: -1,
        clockSkew: Math.round(this.rng.range(2, 38)),
        offlineByFault: false,
      };
      this.robots.push(r);
      this.robotById.set(id, r);
    }
  }

  private applyScenario() {
    const def = SCENARIOS[this.scenario];
    for (const p of def.placements) {
      const r = this.robotById.get(p.id);
      if (!r) continue;
      if (isFreeCell(this.map, p.start[0], p.start[1])) r.cell = p.start;
      r.legs = (p.legs ?? []).slice().sort((a, b) => a.at - b.at);
      if (r.legs.length) r.mode = "scripted_wait";
    }
    this.injections = def.injections.slice().sort((a, b) => a.at - b.at);
    this.injectionCursor = 0;
  }

  private seedBenchmarkTasks(n: number) {
    for (let i = 0; i < n; i++) {
      const tpl = this.templates[0];
      this.createTask(tpl, "normal", 0, "benchmark set");
    }
  }

  // ------------------------------------------------------------------ public API

  step(dt = 0.2) {
    this.tick(dt);
  }

  get isFinished() {
    return this.finished;
  }

  handleClient(msg: ClientMsg) {
    switch (msg.type) {
      case "fault":
        this.handleFault(msg);
        break;
      case "issue_task": {
        const blocks = expandBlocks(msg.template.blocks);
        const tpl: TaskTemplate = { ...msg.template, blocks };
        for (let i = 0; i < Math.max(1, Math.min(20, msg.count)); i++)
          this.createTask(tpl, msg.priority, i * 0.4, "issued from template");
        this.event(
          "info",
          "task",
          null,
          `${msg.count} × "${msg.template.name}" published to the fleet task topic — auction open (${msg.priority})`,
        );
        break;
      }
      default:
        break;
    }
  }

  private handleFault(msg: Extract<ClientMsg, { type: "fault" }>) {
    switch (msg.action) {
      case "toggle_link": {
        const r = msg.target ? this.robotById.get(msg.target) : null;
        if (!r) return;
        const up = typeof msg.value === "boolean" ? msg.value : !r.linkOk;
        if (up === r.linkOk) return;
        r.linkOk = up;
        this.networkDirty = true;
        if (!up)
          this.event(
            "warn",
            "network",
            r.id,
            `${r.id} link lost — running on cached intent + local safety filter (ORCA)`,
          );
        else
          this.event(
            "info",
            "network",
            r.id,
            `${r.id} link restored — intent re-synced with ${this.countPeers(r)} neighbour(s)`,
          );
        break;
      }
      case "block_cell": {
        if (!msg.cell) return;
        const i = cellIdx(this.map, msg.cell[0], msg.cell[1]);
        if (this.blocked.has(i)) {
          this.blocked.delete(i);
          this.blockedNotes.delete(i);
          this.event(
            "info",
            "system",
            null,
            `${cellLabel(this.map, msg.cell[0], msg.cell[1])} cleared`,
          );
          this.networkDirty = true;
          this.replanBlockedRobots();
        } else if (this.map.free[i]) {
          this.blockCells([msg.cell], "manual block");
        }
        break;
      }
      case "unblock_all":
        this.clearBlocks();
        break;
      case "disable_robot": {
        const r = msg.target ? this.robotById.get(msg.target) : null;
        if (!r) return;
        const off = typeof msg.value === "boolean" ? msg.value : r.mode !== "offline";
        if (off) this.setOffline(r, true);
        else this.setOnline(r);
        r.offlineByFault = off;
        break;
      }
      case "partition": {
        if (Array.isArray(msg.value)) this.setPartition(msg.value as string[][]);
        else if (msg.value === false) this.setPartition([]);
        else {
          const half = Math.ceil(this.robots.length / 2);
          this.setPartition([
            this.robots.slice(0, half).map((r) => r.id),
            this.robots.slice(half).map((r) => r.id),
          ]);
        }
        break;
      }
      case "set_loss":
        this.lossPct = Math.max(0, Math.min(90, Number(msg.value) || 0));
        this.networkDirty = true;
        break;
      case "set_latency":
        this.latencyMs = Math.max(0, Math.min(1000, Number(msg.value) || 0));
        this.networkDirty = true;
        break;
    }
  }

  /** Read-only stats for the benchmark page. */
  stats() {
    const done = this.tasks.filter((t) => t.phase === "done");
    const shortest = done.reduce((s, t) => s + t.shortestTotal, 0);
    const travelled = this.robots.reduce((s, r) => s + r.distTravelled, 0);
    const sorted = [...this.plannerSamples].sort((a, b) => a - b);
    const q = (p: number) => (sorted.length ? sorted[Math.floor((sorted.length - 1) * p)] : 0);
    const stop = this.robots.reduce((s, r) => s + r.stopTime, 0);
    return {
      elapsed_s: this.t,
      tasks_done: done.length,
      tasks_total: this.tasksTotal,
      stop_time_s: stop,
      collisions: this.collisions,
      deadlocks: this.deadlocks,
      mean_resolution_s: this.resolutionTimes.length
        ? this.resolutionTimes.reduce((a, b) => a + b, 0) / this.resolutionTimes.length
        : 0,
      sum_costs: travelled,
      path_deviation_pct: shortest > 0 ? Math.max(0, (travelled / shortest - 1) * 100) : 0,
      choke_flow_per_min: this.t > 0 ? (this.chokePasses / this.t) * 60 : 0,
      planner_p50_ms: q(0.5),
      planner_p95_ms: q(0.95),
      msgs_per_robot:
        this.robots.reduce((s, r) => s + r.msgsPerSec, 0) / Math.max(1, this.robots.length),
      progress: this.tasksTotal ? done.length / this.tasksTotal : 0,
      finished: this.finished,
    };
  }

  /** Snapshot of robot poses for a renderer that bypasses the store (benchmark mini-maps). */
  snapshot(): RobotStateMsg[] {
    return this.robots.map((r) => this.robotMsg(r));
  }

  // ------------------------------------------------------------------ tick

  private tick(dt: number) {
    if (this.finished) return;
    this.t += dt;
    this.runInjections();
    this.startScriptedLegs();
    if (!this.benchmark) this.generateTasks();
    this.runAuctions();
    this.updateBattery(dt);
    this.decideIdle();
    this.moveRobots(dt);
    this.checkCollisions();
    this.updateComms();
    this.updateHealth();
    if (!this.quiet) for (const r of this.robots) this.emit(this.robotMsg(r));
    if (this.t - this.lastStats >= 1 - 1e-6) {
      this.lastStats = this.t;
      if (!this.quiet) {
        this.emit(this.fleetStats());
        this.emit({
          type: "clock",
          ts: this.t,
          scenario: this.scenario,
          seed: this.seed,
          time_scale: 1,
          scenario_phase: this.phaseLabel,
        });
      }
    }
    if (this.networkDirty || this.t - this.lastNetwork >= 2) {
      this.lastNetwork = this.t;
      this.networkDirty = false;
      if (!this.quiet) this.emit(this.networkMsg());
    }
    if (this.benchmark && this.tasksTotal > 0) {
      const done = this.tasks.filter((t) => t.phase === "done").length;
      if (done >= this.tasksTotal) this.finished = true;
    }
  }

  private emitSnapshot() {
    this.emit({ type: "robot_info", robots: this.robots.map((r) => r.info) });
    for (const task of this.tasks) this.emit(this.taskMsg(task));
    for (const r of this.robots) this.emit(this.robotMsg(r));
    this.emit(this.fleetStats());
    this.emit(this.networkMsg());
    this.emit({
      type: "clock",
      ts: this.t,
      scenario: this.scenario,
      seed: this.seed,
      time_scale: 1,
      scenario_phase: this.phaseLabel,
    });
    for (const r of this.robots) this.emit(this.healthReport(r));
  }

  private emit(m: ServerMsg) {
    this.onMessage(m);
  }

  private event(
    level: EventLevel,
    category: EventCategory,
    robot: string | null,
    text: string,
    cell?: Cell,
  ) {
    const e: EventMsg = {
      type: "event",
      id: ++this.eventSeq,
      ts: this.t,
      level,
      category,
      robot_id: robot,
      cell,
      text,
    };
    this.emit(e);
  }

  // ------------------------------------------------------------------ scenario injections

  private runInjections() {
    while (
      this.injectionCursor < this.injections.length &&
      this.injections[this.injectionCursor].at <= this.t
    ) {
      const inj = this.injections[this.injectionCursor++];
      switch (inj.kind) {
        case "phase":
          this.phaseLabel = inj.label;
          break;
        case "block_ahead":
          this.blockAhead(inj.note);
          break;
        case "block_cells":
          this.blockCells(inj.cells, inj.note);
          break;
        case "clear_blocks":
          this.clearBlocks();
          break;
        case "offline": {
          const r = this.robotById.get(inj.robot);
          if (r) this.setOffline(r, false);
          break;
        }
        case "online": {
          const r = this.robotById.get(inj.robot);
          if (r) this.setOnline(r);
          break;
        }
        case "partition":
          this.setPartition(inj.groups);
          break;
        case "heal":
          this.setPartition([]);
          break;
      }
    }
  }

  private startScriptedLegs() {
    for (const r of this.robots) {
      if (r.mode !== "scripted_wait" || !r.legs.length) continue;
      const leg = r.legs[0];
      if (leg.at > this.t) continue;
      r.legs.shift();
      r.leg = leg;
      r.mode = "normal";
      r.goal = leg.to;
      r.goalLabel = leg.label;
      r.path = this.plan(r, leg.to) ?? [];
      r.noPath = r.path.length === 0 && !cellEq(r.cell, leg.to);
      r.idleSince = this.t;
    }
  }

  private blockAhead(note: string) {
    // choose the robot with the longest remaining path that crosses a shelf-band corridor
    let best: Robot | null = null;
    let bestLen = 0;
    for (const r of this.robots) {
      if (r.mode !== "normal" || r.path.length < 8) continue;
      const seg = r.path.slice(4, 6);
      if (seg.every((c) => c[0] >= this.map.stagingRight) && r.path.length > bestLen) {
        best = r;
        bestLen = r.path.length;
      }
    }
    if (best) {
      this.blockCells(best.path.slice(4, 6), note);
      return;
    }
    // fallback: a fixed corridor segment on aisle 3 between A and B
    const h = this.map.hAisles[2];
    const a = this.map.vAisles[0];
    if (h && a) this.blockCells([[a.x + 4, h.y], [a.x + 5, h.y]], note);
  }

  private blockCells(cells: Cell[], note: string) {
    const added: Cell[] = [];
    for (const c of cells) {
      const i = cellIdx(this.map, c[0], c[1]);
      if (!this.map.free[i] || this.blocked.has(i)) continue;
      this.blocked.add(i);
      this.blockedNotes.set(i, note);
      added.push(c);
    }
    if (!added.length) return;
    this.networkDirty = true;
    const lbl = cellLabel(this.map, added[0][0], added[0][1]);
    this.event("warn", "system", null, `${cap(lbl)} blocked — ${note}`, added[0]);
    this.replanBlockedRobots();
  }

  private clearBlocks() {
    if (!this.blocked.size) return;
    this.blocked.clear();
    this.blockedNotes.clear();
    this.networkDirty = true;
    this.event("info", "system", null, "All blocked cells cleared — robots re-plan to shortest routes");
    for (const r of this.robots) {
      if (r.goal && r.mode !== "offline" && !r.dwelling) {
        const p = this.plan(r, r.goal);
        if (p && p.length < r.path.length) {
          r.path = p;
          r.noPath = false;
        }
      }
    }
  }

  private replanBlockedRobots() {
    for (const r of this.robots) {
      if (r.mode === "offline" || !r.goal) continue;
      const crosses = r.path.some((c) => this.blocked.has(cellIdx(this.map, c[0], c[1])));
      if (!crosses) continue;
      this.replanForBlock(r);
    }
  }

  private replanForBlock(r: Robot) {
    if (!r.goal) return;
    const oldLen = r.path.length + (r.next ? 1 : 0);
    const p = this.plan(r, r.goal);
    const blockedCell = r.path.find((c) => this.blocked.has(cellIdx(this.map, c[0], c[1])));
    const where = blockedCell ? cellLabel(this.map, blockedCell[0], blockedCell[1]) : "route";
    r.lastReplan = this.t;
    if (!p) {
      r.path = [];
      r.noPath = true;
      this.event("warn", "conflict", r.id, `${r.id}: no route to ${r.goalLabel ?? "goal"} — ${where} blocked, holding position`);
      return;
    }
    r.noPath = false;
    const extra = p.length - oldLen;
    const via = p[Math.floor(p.length / 2)];
    r.path = p;
    const pct = oldLen > 0 ? Math.round((extra / oldLen) * 100) : 0;
    this.event(
      "info",
      "task",
      r.id,
      `${cap(where)} blocked — ${r.id} re-planned via ${shortLabel(this.map, via[0], via[1])}, +${Math.max(0, extra)} cells`,
    );
    const task = r.task;
    if (
      this.mode === "ours" &&
      task &&
      task.allowRebid &&
      !task.carrying &&
      extra > 6 &&
      pct > 40
    ) {
      this.releaseTask(r, `cost +${pct}%`);
    }
  }

  private setOffline(r: Robot, byFault: boolean) {
    if (r.mode === "offline") return;
    if (r.charger) {
      r.charger = null;
    }
    if (r.task) this.releaseTask(r, byFault ? "robot disabled" : "robot failure");
    r.mode = "offline";
    r.next = null;
    r.progress = 0;
    r.path = [];
    r.goal = null;
    r.goalLabel = null;
    r.leg = null;
    r.speed = 0;
    r.dwelling = false;
    r.linkOk = false;
    r.neighbours = [];
    this.networkDirty = true;
    this.event(
      "error",
      "health",
      r.id,
      `${r.id} offline at ${cellLabel(this.map, r.cell[0], r.cell[1])} — peers treat it as a static obstacle`,
      r.cell,
    );
  }

  private setOnline(r: Robot) {
    if (r.mode !== "offline") return;
    r.mode = "normal";
    r.linkOk = true;
    r.idleSince = this.t;
    r.offlineByFault = false;
    this.networkDirty = true;
    this.event("info", "health", r.id, `${r.id} back online — re-discovered ${this.countPeers(r)} peer(s), rejoining auctions`);
  }

  private setPartition(groups: string[][]) {
    this.partitions = groups;
    this.networkDirty = true;
    if (groups.length)
      this.event(
        "warn",
        "network",
        null,
        `Network partitioned: ${groups.map((g) => `{${g.map((x) => x.replace("AMR-", "")).join(",")}}`).join(" | ")} — groups coordinate internally, cross-group encounters use the local safety filter`,
      );
    else this.event("info", "network", null, "Partition healed — full peer discovery restored");
  }

  private countPeers(r: Robot) {
    return this.robots.filter((o) => o !== r && this.canHear(r, o)).length;
  }

  // ------------------------------------------------------------------ tasks & auction

  private generateTasks() {
    const pending = this.tasks.filter((t) => t.phase !== "done" && t.robot === null).length;
    const target = 8 + Math.floor(this.taskRng.next() * 5);
    if (pending >= target) return;
    const need = Math.min(3, target - pending);
    for (let i = 0; i < need; i++) {
      const roll = this.taskRng.next();
      const tpl =
        roll < 0.62
          ? this.templates[0]
          : roll < 0.8
            ? this.templates[1]
            : roll < 0.92
              ? this.templates[2]
              : this.templates[3];
      const prio: TaskPriority = tpl.priority === "urgent" || this.taskRng.chance(0.12) ? "urgent" : "normal";
      this.createTask(tpl, prio, i * 0.8);
    }
  }

  /**
   * Station choice for "nearest pickup / drop" is made once per task at creation (seeded, load-balanced
   * over pending tasks) so the same seed yields the same task routes in every engine mode.
   */
  private resolveTaskBlocks(blocks: Block[]): Block[] {
    const m = this.map;
    const pendingLoad = new Map<string, number>();
    for (const t of this.tasks) {
      if (t.phase === "done") continue;
      for (const b of t.blocks) if (b.kind === "navigate" && b.target?.kind === "station") pendingLoad.set(b.target.id, (pendingLoad.get(b.target.id) ?? 0) + 1);
    }
    let prev: Cell | null = null;
    return blocks.map((b) => {
      if (b.kind !== "navigate" || !b.target) return b;
      if (b.target.kind === "station") {
        prev = m.stations.find((s) => s.id === (b.target as { id: string }).id)?.cell ?? prev;
        return b;
      }
      if (b.target.kind === "cell") {
        prev = [b.target.x, b.target.y];
        return b;
      }
      const type = b.target.kind === "any_pickup" ? "pickup" : "drop";
      let list = m.stations.filter((s) => s.type === type);
      if (this.benchmark?.overlapping) {
        // overlapping-paths benchmark: every route shares the left aisles (pickups in the first two shelf columns)
        const near = list.filter((s) => s.cell[0] < m.stagingRight + 22);
        if (near.length) list = near;
      }
      if (!list.length) return b;
      const scored = list
        .map((s) => ({
          s,
          d: (prev ? Math.abs(s.cell[0] - prev[0]) + Math.abs(s.cell[1] - prev[1]) : 0) + (pendingLoad.get(s.id) ?? 0) * 6 + this.taskRng.range(0, prev ? 6 : 12),
        }))
        .sort((a, b2) => a.d - b2.d);
      const st = scored[0].s;
      pendingLoad.set(st.id, (pendingLoad.get(st.id) ?? 0) + 1);
      prev = st.cell;
      return { ...b, target: { kind: "station", id: st.id } };
    });
  }

  private createTask(tpl: TaskTemplate, priority: TaskPriority, delay: number, note?: string): Task {
    const blocks = this.resolveTaskBlocks(expandBlocks(tpl.blocks));
    const navs = blocks.filter((b) => b.kind === "navigate");
    const first = navs[0]?.target;
    const last = navs[navs.length - 1]?.target;
    const task: Task = {
      id: `T-${++this.taskSeq}`,
      templateId: tpl.id,
      templateName: tpl.name,
      priority,
      blocks,
      steps: [],
      stepIndex: 0,
      phase: "announced",
      bids: {},
      winner: null,
      robot: null,
      rebids: 0,
      createdTs: this.t,
      assignedTs: null,
      doneTs: null,
      from: targetLabel(first),
      to: targetLabel(last),
      announceAt: this.t + delay,
      assignAt: 0,
      excluded: new Set(),
      allowRebid: tpl.allow_rebid,
      batteryFloor: tpl.battery_floor,
      carrying: false,
      pathLenAtStep: 0,
      shortestTotal: 0,
      note,
    };
    this.tasks.push(task);
    this.tasksTotal++;
    if (this.tasks.length > 400) {
      const cut = this.tasks.findIndex((t) => t.phase !== "done");
      if (cut > 100) {
        this.tasks.splice(0, cut - 100);
        this.prunedDone += cut - 100;
      }
    }
    this.emit(this.taskMsg(task));
    return task;
  }

  private runAuctions() {
    // one auction per tick keeps each robot winning at most one task per round
    const open = this.tasks.filter(
      (t) => (t.phase === "announced" || t.phase === "rebid") && t.announceAt <= this.t,
    );
    open.sort((a, b) => (a.priority === b.priority ? a.createdTs - b.createdTs : a.priority === "urgent" ? -1 : 1));
    const biddingNow = new Set(
      this.tasks.filter((t) => t.phase === "bidding").map((t) => t.winner ?? ""),
    );
    for (const task of open) {
      const bidders = this.robots.filter(
        (r) =>
          r.mode === "normal" &&
          !r.task &&
          !r.leg &&
          !r.dwelling &&
          r.battery > task.batteryFloor + 5 &&
          !task.excluded.has(r.id) &&
          !biddingNow.has(r.id) &&
          (this.mode === "baseline" || r.linkOk),
      );
      if (!bidders.length) continue;
      const bids: Record<string, number> = {};
      let best: Robot | null = null;
      let bestBid = Infinity;
      for (const r of bidders) {
        const target = this.resolveTarget(task.blocks.find((b) => b.kind === "navigate")?.target, r.cell);
        const d = target ? this.pathLen(r.cell, target.cell) : 0;
        if (!isFinite(d)) continue;
        const queue = 0;
        const penalty = Math.max(0, 50 - r.battery) * 0.25;
        const bid = Math.round((d + 0.5 * queue + penalty) * 10) / 10;
        bids[r.id] = bid;
        if (bid < bestBid || (bid === bestBid && best && r.index < best.index)) {
          bestBid = bid;
          best = r;
        }
      }
      if (!best) continue;
      task.bids = bids;
      task.winner = best.id;
      task.phase = "bidding";
      task.assignAt = this.t + 0.6;
      biddingNow.add(best.id);
      this.emit(this.taskMsg(task));
      break;
    }
    // finalise assignments
    for (const task of this.tasks) {
      if (task.phase !== "bidding" || task.assignAt > this.t) continue;
      const r = task.winner ? this.robotById.get(task.winner) : null;
      if (!r || r.task || r.mode !== "normal") {
        task.phase = "announced";
        task.winner = null;
        task.announceAt = this.t + 0.4;
        continue;
      }
      this.assignTask(task, r);
    }
  }

  private assignTask(task: Task, r: Robot) {
    task.phase = "assigned";
    task.robot = r.id;
    task.assignedTs = this.t;
    task.excluded.clear();
    // resolve station targets sequentially from the robot's position
    let pos = r.cell;
    task.steps = [];
    task.shortestTotal = 0;
    for (const b of task.blocks) {
      const s: RStep = {
        kind: b.kind,
        seconds: b.seconds,
        lift: b.lift,
        threshold: b.threshold,
        label: b.label,
        message: b.message,
        targetSpec: b.target,
      };
      if (b.kind === "navigate") {
        const tgt = this.resolveTarget(b.target, pos);
        if (tgt) {
          s.targetCell = tgt.cell;
          s.targetId = tgt.id;
          task.shortestTotal += this.pathLen(pos, tgt.cell);
          pos = tgt.cell;
        }
      }
      task.steps.push(s);
    }
    const navs = task.steps.filter((s) => s.kind === "navigate");
    task.from = navs[0]?.targetId ?? task.from;
    task.to = navs[navs.length - 1]?.targetId ?? task.to;
    task.stepIndex = 0;
    r.task = task;
    r.mode = "normal";
    r.idleSince = this.t;
    const bidTxt = Object.entries(task.bids)
      .sort((a, b) => a[1] - b[1])
      .map(([id, v]) => `${id.replace("AMR-", "")}:${v}`)
      .join(" ");
    this.event(
      "info",
      "task",
      r.id,
      `${task.id}${task.rebids ? " (re-bid)" : ""} won by ${r.id} — bid ${task.bids[r.id]} [${bidTxt}] → ${task.from} → ${task.to}`,
    );
    this.emit(this.taskMsg(task));
    this.startStep(r);
  }

  private resolveTarget(spec: TargetSpec | undefined, from: Cell): { id: string; cell: Cell } | null {
    if (!spec) return null;
    const m = this.map;
    switch (spec.kind) {
      case "station": {
        const st = m.stations.find((s) => s.id === spec.id);
        return st ? { id: st.id, cell: st.cell } : null;
      }
      case "cell":
        return isFreeCell(m, spec.x, spec.y)
          ? { id: shortLabel(m, spec.x, spec.y), cell: [spec.x, spec.y] }
          : null;
      case "any_pickup":
      case "any_drop": {
        const type = spec.kind === "any_pickup" ? "pickup" : "drop";
        // nearest by manhattan, penalised by the queue already heading there (the 0.5·queue term), plus a seeded tie-break
        const list = m.stations.filter((s) => s.type === type);
        if (!list.length) return null;
        const scored = list
          .map((s) => {
            const queue = this.robots.filter((o) => o.goalLabel === s.id || (o.task && o.task.steps.some((st, i) => i >= o.task!.stepIndex && st.targetId === s.id))).length;
            return {
              s,
              d: Math.abs(s.cell[0] - from[0]) + Math.abs(s.cell[1] - from[1]) + queue * 7 + this.taskRng.range(0, 5),
            };
          })
          .sort((a, b) => a.d - b.d);
        const st = scored[0].s;
        return { id: st.id, cell: st.cell };
      }
    }
  }

  private startStep(r: Robot) {
    const task = r.task;
    if (!task) return;
    if (task.stepIndex >= task.steps.length) {
      this.completeTask(r);
      return;
    }
    if (task.phase === "assigned") {
      task.phase = "in_progress";
      this.emit(this.taskMsg(task));
    }
    const s = task.steps[task.stepIndex];
    switch (s.kind) {
      case "navigate": {
        if (!s.targetCell) {
          task.stepIndex++;
          this.startStep(r);
          return;
        }
        r.goal = s.targetCell;
        r.goalLabel = s.targetId ?? null;
        if (cellEq(r.cell, s.targetCell)) {
          task.stepIndex++;
          this.startStep(r);
          return;
        }
        const p = this.plan(r, s.targetCell);
        r.path = p ?? [];
        r.noPath = !p;
        task.pathLenAtStep = r.path.length;
        r.lastReplan = this.t;
        return;
      }
      case "pickup":
        r.lift = "up";
        task.carrying = true;
        this.dwell(r, s.seconds ?? 2.5);
        return;
      case "drop":
        r.lift = "down";
        task.carrying = false;
        this.dwell(r, s.seconds ?? 2);
        return;
      case "rack":
        this.dwell(r, s.seconds ?? 1.5);
        return;
      case "lift":
        r.lift = s.lift ?? "up";
        this.dwell(r, s.seconds ?? 1);
        return;
      case "confirm":
        this.dwell(r, s.seconds ?? 1.5);
        return;
      case "wait":
      case "sleep":
        this.dwell(r, s.seconds ?? 5);
        return;
      case "charge_if": {
        const th = s.threshold ?? 20;
        if (r.battery < th) {
          r.resumeTask = true;
          this.event("info", "battery", r.id, `${r.id} battery ${r.battery.toFixed(0)}% < ${th}% (template rule) → charging before continuing ${task.id}`);
          this.goCharge(r);
        } else {
          task.stepIndex++;
          this.startStep(r);
        }
        return;
      }
      case "repeat":
        task.stepIndex++;
        this.startStep(r);
        return;
    }
  }

  private dwell(r: Robot, seconds: number) {
    r.dwellUntil = this.t + seconds;
    r.dwelling = true;
    r.goal = null;
    r.path = [];
  }

  private completeTask(r: Robot) {
    const task = r.task;
    if (!task) return;
    task.phase = "done";
    task.doneTs = this.t;
    r.tasksDone++;
    this.doneTimestamps.push(this.t);
    if (this.doneTimestamps.length > 500) this.doneTimestamps.shift();
    this.emit(this.taskMsg(task));
    this.event(
      "info",
      "task",
      r.id,
      `${task.id} done by ${r.id} in ${(this.t - (task.assignedTs ?? task.createdTs)).toFixed(0)} s (${task.from} → ${task.to})`,
    );
    r.task = null;
    r.goal = null;
    r.goalLabel = null;
    r.path = [];
    r.idleSince = this.t;
    r.lift = "down";
    if (r.chargeAfterTask) {
      r.chargeAfterTask = false;
      this.goCharge(r);
    }
  }

  private releaseTask(r: Robot, reason: string) {
    const task = r.task;
    if (!task) return;
    task.phase = "rebid";
    task.rebids++;
    this.rebidsTotal++;
    task.robot = null;
    task.winner = null;
    task.bids = {};
    task.excluded = new Set([r.id]);
    task.stepIndex = 0;
    task.carrying = false;
    task.announceAt = this.t + 0.6;
    this.emit(this.taskMsg(task));
    this.event(
      "warn",
      "task",
      r.id,
      `${task.id} released by ${r.id} (${reason}) → re-bid among peers`,
    );
    r.task = null;
    r.goal = null;
    r.goalLabel = null;
    r.path = [];
    r.dwelling = false;
    r.lift = "down";
    r.idleSince = this.t;
  }

  // ------------------------------------------------------------------ battery & charging

  private updateBattery(dt: number) {
    for (const r of this.robots) {
      if (r.mode === "offline") continue;
      if (r.mode === "charging") {
        r.battery = Math.min(100, r.battery + 1.0 * dt);
        if (r.battery >= CHARGE_TO) this.finishCharging(r);
        continue;
      }
      const moving = r.next !== null && r.speed > 0;
      r.battery = Math.max(0, r.battery - (moving ? 0.15 : 0.03) * dt);
      if (
        r.battery < BATTERY_FLOOR &&
        r.mode !== "to_charger" &&
        !r.chargeAfterTask &&
        !r.leg &&
        r.mode !== "scripted_wait"
      ) {
        if (r.task && r.task.carrying) {
          r.chargeAfterTask = true;
          this.event("warn", "battery", r.id, `${r.id} battery ${r.battery.toFixed(0)}% — will charge after delivering ${r.task.id}`);
        } else {
          if (r.task) this.releaseTask(r, `battery ${r.battery.toFixed(0)}%`);
          this.goCharge(r);
        }
      }
    }
  }

  private goCharge(r: Robot) {
    const taken = new Set(this.robots.filter((o) => o.charger).map((o) => o.charger!.id));
    const freeChargers = this.map.chargers.filter((c) => !taken.has(c.id));
    if (!freeChargers.length) {
      r.chargeAfterTask = true; // retry later
      return;
    }
    let best = freeChargers[0];
    let bestD = Infinity;
    for (const c of freeChargers) {
      const d = Math.abs(c.cell[0] - r.cell[0]) + Math.abs(c.cell[1] - r.cell[1]);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    r.charger = best;
    r.mode = "to_charger";
    r.goal = best.cell;
    r.goalLabel = best.id;
    r.dwelling = false;
    r.path = this.plan(r, best.cell) ?? [];
    r.noPath = r.path.length === 0 && !cellEq(r.cell, best.cell);
    r.chargeAfterTask = false;
    this.event("info", "battery", r.id, `${r.id} battery ${r.battery.toFixed(0)}% → heading to charger ${best.id}`);
    if (cellEq(r.cell, best.cell)) this.arriveCharger(r);
  }

  private arriveCharger(r: Robot) {
    r.mode = "charging";
    r.goal = null;
    r.path = [];
    this.event("info", "battery", r.id, `${r.id} docked at ${r.charger?.id ?? "charger"} (${r.battery.toFixed(0)}%)`);
  }

  private finishCharging(r: Robot) {
    const id = r.charger?.id;
    r.charger = null;
    r.mode = "normal";
    r.idleSince = this.t;
    this.event("info", "battery", r.id, `${r.id} charged to ${r.battery.toFixed(0)}% — left ${id ?? "charger"}, available for auctions`);
    if (r.resumeTask && r.task) {
      r.resumeTask = false;
      r.task.stepIndex++;
      this.startStep(r);
    }
  }

  // ------------------------------------------------------------------ idle behaviour

  private decideIdle() {
    for (const r of this.robots) {
      if (r.mode !== "normal" || r.task || r.leg || r.dwelling) continue;
      if (r.path.length || r.next) continue;
      if (this.t - r.idleSince < 4) continue;
      const atParking = this.map.parking.some((p) => cellEq(p, r.cell));
      if (atParking) continue;
      const reserved = new Set(
        this.robots.filter((o) => o !== r && o.goal).map((o) => cellIdx(this.map, o.goal![0], o.goal![1])),
      );
      const occupied = new Set(this.robots.map((o) => cellIdx(this.map, o.cell[0], o.cell[1])));
      const spot = this.map.parking.find(
        (p) => !reserved.has(cellIdx(this.map, p[0], p[1])) && !occupied.has(cellIdx(this.map, p[0], p[1])),
      );
      if (!spot) continue;
      r.mode = "parking";
      r.goal = spot;
      r.goalLabel = "parking";
      r.path = this.plan(r, spot) ?? [];
      if (!r.path.length) {
        r.mode = "normal";
        r.goal = null;
        r.goalLabel = null;
      }
    }
  }

  // ------------------------------------------------------------------ movement & conflicts

  private prio(r: Robot): number {
    if (r.mode === "offline") return 1e9;
    if (!r.path.length && !r.next) return 1e8;
    let p = r.path.length + (r.next ? 1 : 0);
    if (r.mode === "retreat") p += 1000;
    if (r.leg || r.task?.priority === "urgent") p -= 0.5;
    return p;
  }

  private plan(r: Robot, goal: Cell, extraBlocked?: Iterable<number>): Cell[] | null {
    const blocked = new Set(this.blocked);
    for (const o of this.robots) {
      if (o === r) continue;
      // stationary robots (offline / charging / dwelling / idle) are obstacles for planning
      const stationary =
        o.mode === "offline" || o.mode === "charging" || o.dwelling || (!o.path.length && !o.next);
      if (stationary) blocked.add(cellIdx(this.map, o.cell[0], o.cell[1]));
    }
    if (extraBlocked) for (const i of extraBlocked) blocked.add(i);
    const gi = cellIdx(this.map, goal[0], goal[1]);
    blocked.delete(gi);
    return astar(this.map.free, this.map.width, this.map.height, r.cell, goal, { blocked });
  }

  private pathLen(a: Cell, b: Cell): number {
    const p = astar(this.map.free, this.map.width, this.map.height, a, b, { blocked: this.blocked });
    return p ? p.length : Infinity;
  }

  private moveRobots(dt: number) {
    const m = this.map;
    const occ = new Map<number, Robot>();
    for (const r of this.robots) {
      occ.set(cellIdx(m, r.cell[0], r.cell[1]), r);
      if (r.next) occ.set(cellIdx(m, r.next[0], r.next[1]), r);
    }
    const order = this.robots
      .filter((r) => r.mode !== "offline")
      .sort((a, b) => this.prio(a) - this.prio(b) || a.index - b.index);

    // baseline: which one-lane segments are currently held (a robot inside or entering)
    const segHeld = new Map<number, Robot>();
    if (this.mode === "baseline" && this.zoneLock) {
      for (const o of this.robots) {
        const s1 = this.segmentOf[cellIdx(m, o.cell[0], o.cell[1])];
        if (s1 >= 0) segHeld.set(s1, o);
        if (o.next) {
          const s2 = this.segmentOf[cellIdx(m, o.next[0], o.next[1])];
          if (s2 >= 0) segHeld.set(s2, o);
        }
      }
    }

    for (const r of order) {
      // dwell handling
      if (r.dwelling) {
        r.speed = 0;
        if (this.t >= r.dwellUntil) {
          r.dwelling = false;
          if (r.task) {
            r.task.stepIndex++;
            this.startStep(r);
          }
        } else continue;
      }
      if (r.mode === "charging" || r.mode === "scripted_wait") {
        r.speed = 0;
        continue;
      }
      if (!r.next) {
        if (!r.path.length) {
          if (r.noPath && this.t - r.lastReplan > 2 && r.goal) {
            const p = this.plan(r, r.goal);
            r.lastReplan = this.t;
            if (p) {
              r.path = p;
              r.noPath = false;
            }
          }
          if (!r.path.length) {
            this.onArrive(r);
            if (!r.path.length) {
              r.speed = 0;
              continue;
            }
          }
        }
        const cand = r.path[0];
        const ci = cellIdx(m, cand[0], cand[1]);
        if (this.blocked.has(ci)) {
          this.replanForBlock(r);
          r.speed = 0;
          continue;
        }
        const other = occ.get(ci);
        if (other && other !== r) {
          this.handleConflict(r, other, occ);
          r.speed = 0;
          r.stopTime += dt;
          continue;
        }
        if (this.mode === "ours" && r.linkOk && r.mode !== "retreat") {
          // intent-aware aisle negotiation: a peer's broadcast intent says it is coming through this
          // one-lane aisle towards us → take another aisle if cheap, else wait at the entrance.
          const segNext = this.segmentOf[ci];
          const segCur = this.segmentOf[cellIdx(m, r.cell[0], r.cell[1])];
          if (segNext >= 0 && segNext !== segCur) {
            const oncoming = this.oncomingInSegment(r, segNext);
            if (oncoming) {
              if (r.waitSince < 0) r.waitSince = this.t;
              const key = `avoid|${r.id}|${oncoming.id}`;
              const fresh = this.t - (this.conflictCooldown.get(key) ?? -100) > 6;
              if (this.t - r.lastReplan > 2 && r.goal) {
                const avoid: number[] = [];
                for (let i = 0; i < this.segmentOf.length; i++) if (this.segmentOf[i] === segNext) avoid.push(i);
                const p = this.plan(r, r.goal, avoid);
                r.lastReplan = this.t;
                if (p && p.length <= r.path.length + 10) {
                  r.path = p;
                  r.waitSince = -1;
                  if (fresh) {
                    this.conflictCooldown.set(key, this.t);
                    r.yieldCount++;
                    this.deadlocks++;
                    this.resolutionTimes.push(0);
                    const via = p[Math.min(p.length - 1, 3)];
                    this.event("info", "conflict", r.id, `${r.id} read ${oncoming.id}'s intent (oncoming in ${cellLabel(m, cand[0], cand[1])}) — took ${shortLabel(m, via[0], via[1])} instead, +${Math.max(0, p.length - (r.path.length))} cells`, r.cell);
                  }
                  r.speed = 0;
                  continue;
                }
              }
              if (this.t - r.waitSince < 5) {
                if (fresh) {
                  this.conflictCooldown.set(key, this.t);
                  this.event("info", "conflict", r.id, `${r.id} read ${oncoming.id}'s intent (oncoming in ${cellLabel(m, cand[0], cand[1])}) — waiting at ${shortLabel(m, r.cell[0], r.cell[1])} for it to clear`, r.cell);
                }
                r.speed = 0;
                r.stopTime += dt;
                continue;
              }
            }
          }
        }
        if (this.mode === "baseline" && this.zoneLock) {
          // zone lock: one robot per one-lane segment; wait at the entrance until it is free
          const segNext = this.segmentOf[ci];
          const segCur = this.segmentOf[cellIdx(m, r.cell[0], r.cell[1])];
          let lockSeg = -1;
          if (segNext >= 0 && segNext !== segCur) lockSeg = segNext;
          else if (segNext < 0 && segCur < 0 && r.path[1]) {
            // about to step onto an intersection: wait here instead of on the crossing if the aisle beyond is held
            const s2 = this.segmentOf[cellIdx(m, r.path[1][0], r.path[1][1])];
            if (s2 >= 0) lockSeg = s2;
          }
          const holder = lockSeg >= 0 ? segHeld.get(lockSeg) : undefined;
          if (holder && holder !== r) {
            if (r.waitSince < 0) r.waitSince = this.t;
            r.speed = 0;
            r.stopTime += dt;
            // central timeout: after 10 s the server re-plans around the locked segment
            if (this.t - r.waitSince > 10 && this.t - r.lastReplan > 10 && r.goal) {
              const avoid: number[] = [];
              for (let i = 0; i < this.segmentOf.length; i++) if (this.segmentOf[i] === lockSeg) avoid.push(i);
              const p = this.plan(r, r.goal, avoid);
              r.lastReplan = this.t;
              if (p) {
                r.path = p;
                r.waitSince = -1;
              }
            }
            continue;
          }
          if (segNext >= 0) segHeld.set(segNext, r);
        }
        // reserve and go
        r.next = cand;
        r.path.shift();
        occ.set(ci, r);
        r.waitSince = -1;
        r.heading = headingOf(r.cell, cand);
        if (this.map.chokeName.has(ci)) this.chokePasses++;
      }
      if (r.next) {
        const v = this.currentSpeed(r);
        r.speed = v;
        r.progress += v * dt;
        if (r.progress >= 1) {
          occ.delete(cellIdx(m, r.cell[0], r.cell[1]));
          r.history.push(r.cell);
          if (r.history.length > 48) r.history.shift();
          r.cell = r.next;
          r.next = null;
          r.progress = 0;
          r.distTravelled += 1;
        }
      }
    }
  }

  /** A peer (within comms range) that is inside `seg` and moving towards this robot's entrance. */
  private oncomingInSegment(r: Robot, seg: number): Robot | null {
    const m = this.map;
    const dist = (a: Cell, b: Cell) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
    for (const id of r.neighbours) {
      const o = this.robotById.get(id);
      if (!o || o.mode === "offline" || o.mode === "charging") continue;
      const inSeg = this.segmentOf[cellIdx(m, o.cell[0], o.cell[1])] === seg || (o.next && this.segmentOf[cellIdx(m, o.next[0], o.next[1])] === seg);
      if (!inSeg) continue;
      const ahead = o.next ?? o.path[0];
      if (!ahead) continue; // stationary peer: handled by the normal re-plan-around logic
      if (dist(o.cell, r.cell) <= 1) continue; // right next to us = same entrance, not oncoming
      if (dist(ahead, r.cell) < dist(o.cell, r.cell)) return o;
    }
    return null;
  }

  private currentSpeed(r: Robot): number {
    let v = r.info.max_speed;
    if (this.mode === "ours") {
      if (!r.linkOk) v *= 0.6;
      if (r.mode === "retreat") v *= 0.8;
      // intent-aware slow-down only for an imminent head-on / crossing: a peer's next cells include
      // our cell or the cell we are entering. Following a peer in the same direction does not slow us.
      const mine: Cell[] = [];
      if (r.next) mine.push(r.next);
      if (r.path[0]) mine.push(r.path[0]);
      mine.push(r.cell);
      for (const id of r.neighbours) {
        const o = this.robotById.get(id);
        if (!o || o.mode === "charging" || o.dwelling) continue;
        const theirs = o.path.slice(0, 2);
        if (o.next) theirs.unshift(o.next);
        if (theirs.some((c) => mine.some((mc) => cellEq(mc, c)))) {
          v = Math.min(v, 0.6);
          break;
        }
      }
    }
    return v;
  }

  private handleConflict(r: Robot, other: Robot, occ: Map<number, Robot>) {
    if (r.waitSince < 0) r.waitSince = this.t;
    const waited = this.t - r.waitSince;
    const otherStationary =
      other.mode === "offline" ||
      other.mode === "charging" ||
      other.mode === "scripted_wait" ||
      other.dwelling ||
      (!other.next && !other.path.length);
    const otherNextCell = other.next ?? other.path[0] ?? null;
    const headOn = cellEq(otherNextCell, r.cell);

    if (this.mode === "baseline") {
      // stop-and-wait: freeze until the cell frees; after a deadlock timeout take a full detour
      if (waited > 6 && this.t - r.lastReplan > 6 && r.goal) {
        const avoid = [cellIdx(this.map, other.cell[0], other.cell[1])];
        if (other.next) avoid.push(cellIdx(this.map, other.next[0], other.next[1]));
        const p = this.plan(r, r.goal, avoid);
        r.lastReplan = this.t;
        if (p) {
          this.deadlocks++;
          this.resolutionTimes.push(waited);
          r.path = p;
          r.waitSince = -1;
          this.event("warn", "conflict", r.id, `[baseline] ${r.id} deadlocked ${waited.toFixed(0)} s with ${other.id} at ${cellLabel(this.map, r.cell[0], r.cell[1])} — timeout detour +${p.length} cells`, r.cell);
        }
      }
      return;
    }

    if (otherStationary) {
      if (waited > 0.6 && this.t - r.lastReplan > 1.5 && r.goal) {
        const p = this.plan(r, r.goal);
        r.lastReplan = this.t;
        if (p && !cellEq(p[0], other.cell)) {
          r.path = p;
          r.waitSince = -1;
          if (other.mode === "offline")
            this.event("info", "conflict", r.id, `${r.id} routed around stopped ${other.id} at ${shortLabel(this.map, other.cell[0], other.cell[1])} (+${Math.max(0, p.length - r.path.length)} cells)`);
        }
      }
      return;
    }

    if (headOn) {
      // right of way: a robot standing on the other's destination must be let out first
      const rWantsOtherCell = !!r.goal && cellEq(r.goal, other.cell);
      const otherWantsRCell = !!other.goal && cellEq(other.goal, r.cell);
      let iWin: boolean;
      if (rWantsOtherCell && !otherWantsRCell) iWin = false;
      else if (otherWantsRCell && !rWantsOtherCell) iWin = true;
      else iWin = this.prio(r) < this.prio(other) || (this.prio(r) === this.prio(other) && r.index < other.index);
      if (iWin) {
        if (waited > 6) this.yieldTo(r, other, occ, true);
        return;
      }
      this.yieldTo(r, other, occ, false);
      return;
    }

    // following / crossing traffic: wait briefly, then look for a detour (longer ones the longer we wait)
    if (waited > 3 && this.t - r.lastReplan > 3 && r.goal) {
      const avoid = [cellIdx(this.map, other.cell[0], other.cell[1])];
      if (other.next) avoid.push(cellIdx(this.map, other.next[0], other.next[1]));
      const p = this.plan(r, r.goal, avoid);
      r.lastReplan = this.t;
      const cap = waited > 9 ? 40 : waited > 6 ? 16 : 8;
      if (p && p.length <= r.path.length + cap && !cellEq(p[0], other.cell) && !cellEq(p[0], other.next)) {
        r.path = p;
        r.waitSince = -1;
      }
    }
  }

  private yieldTo(r: Robot, other: Robot, occ: Map<number, Robot>, forced: boolean) {
    const key = `${r.id}|${other.id}`;
    const last = this.conflictCooldown.get(key) ?? -100;
    if (this.t - last < 4) return; // already resolving this pair
    this.conflictCooldown.set(key, this.t);
    const where = cellLabel(this.map, r.cell[0], r.cell[1]);
    const waited = r.waitSince >= 0 ? this.t - r.waitSince : 0;
    r.yieldCount++;
    r.conflictUntil = this.t + 3;
    other.conflictUntil = this.t + 3;
    r.yieldUntil = this.t + 2.5;

    if (!r.goal) return;
    const oldLen = r.path.length;
    // attempt A — re-route avoiding the other robot's cell + intent
    const avoid: number[] = [cellIdx(this.map, other.cell[0], other.cell[1])];
    if (other.next) avoid.push(cellIdx(this.map, other.next[0], other.next[1]));
    for (const c of other.path.slice(0, 6)) avoid.push(cellIdx(this.map, c[0], c[1]));
    const p0 = this.plan(r, r.goal, avoid);
    r.lastReplan = this.t;
    // a "detour" that still starts by entering the other robot's cell is not a detour
    const p = p0 && !cellEq(p0[0], other.cell) && !cellEq(p0[0], other.next) ? p0 : null;
    if (p && p.length <= oldLen + 14) {
      r.path = p;
      r.waitSince = -1;
      this.deadlocks++;
      this.resolutionTimes.push(waited);
      const via = p[Math.min(p.length - 1, Math.floor(p.length / 3))];
      this.event(
        "info",
        "conflict",
        r.id,
        `${r.id} yielded to ${other.id} at ${where}${forced ? " (tie-break fallback)" : " (priority inheritance)"} — re-routed via ${shortLabel(this.map, via[0], via[1])}, +${Math.max(0, p.length - oldLen)} cells`,
        r.cell,
      );
      return;
    }
    // attempt B — back up to the last intersection and side-step
    const plan = this.planRetreat(r, other, occ);
    if (!plan && p) {
      // attempt C — no side pocket: take the long way round rather than hold the aisle
      r.path = p;
      r.waitSince = -1;
      this.deadlocks++;
      this.resolutionTimes.push(waited);
      const via = p[Math.min(p.length - 1, Math.floor(p.length / 3))];
      this.event(
        "info",
        "conflict",
        r.id,
        `${r.id} yielded to ${other.id} at ${where} — no side pocket, long detour via ${shortLabel(this.map, via[0], via[1])}, +${Math.max(0, p.length - oldLen)} cells`,
        r.cell,
      );
      return;
    }
    if (plan) {
      r.retreat = { waitingFor: other.id, hub: plan.hub, until: this.t + 14, savedGoal: r.goal };
      r.mode = "retreat";
      r.goal = plan.side;
      r.path = plan.path;
      r.waitSince = -1;
      this.deadlocks++;
      this.resolutionTimes.push(waited);
      this.event(
        "info",
        "conflict",
        r.id,
        `${r.id} yielded to ${other.id} at ${where} (priority inheritance) — backing up ${plan.path.length - 1} cell(s) to ${shortLabel(this.map, plan.hub[0], plan.hub[1])} and side-stepping`,
        r.cell,
      );
      return;
    }
    // attempt C — hold; the winner will time out and take its own detour
    this.event("warn", "conflict", r.id, `${r.id} holding at ${where} for ${other.id} — no side pocket reachable`, r.cell);
  }

  private planRetreat(
    r: Robot,
    other: Robot,
    occ: Map<number, Robot>,
  ): { hub: Cell; side: Cell; path: Cell[] } | null {
    const m = this.map;
    const otherCells = new Set<number>();
    otherCells.add(cellIdx(m, other.cell[0], other.cell[1]));
    if (other.next) otherCells.add(cellIdx(m, other.next[0], other.next[1]));
    for (const c of other.path.slice(0, 14)) otherCells.add(cellIdx(m, c[0], c[1]));
    const chain: Cell[] = [r.cell, ...r.history.slice().reverse()];
    for (let k = 0; k < Math.min(chain.length, 16); k++) {
      const hub = chain[k];
      const prev = k > 0 ? chain[k - 1] : null;
      const nbs = neighbours4(m, hub[0], hub[1]);
      if (nbs.length < 3 && k > 0) continue;
      const side = nbs.find((c) => {
        const i = cellIdx(m, c[0], c[1]);
        if (otherCells.has(i) || this.blocked.has(i)) return false;
        const o = occ.get(i);
        if (o && o !== r) return false;
        if (prev && cellEq(c, prev)) return false;
        if (k + 1 < chain.length && cellEq(c, chain[k + 1])) return false;
        return true;
      });
      if (!side) continue;
      const back = chain.slice(1, k + 1);
      const ok = back.every((c) => {
        const i = cellIdx(m, c[0], c[1]);
        const o = occ.get(i);
        return !this.blocked.has(i) && (!o || o === r);
      });
      if (!ok) continue;
      return { hub, side, path: [...back, side] };
    }
    return null;
  }

  private onArrive(r: Robot) {
    switch (r.mode) {
      case "retreat": {
        const rt = r.retreat;
        if (!rt) {
          r.mode = "normal";
          return;
        }
        const other = this.robotById.get(rt.waitingFor);
        const hubDist = other
          ? Math.abs(other.cell[0] - rt.hub[0]) + Math.abs(other.cell[1] - rt.hub[1])
          : 99;
        const otherHeadingToHub =
          !!other &&
          (cellEq(other.next, rt.hub) || other.path.slice(0, 4).some((c) => cellEq(c, rt.hub)));
        const passed = !other || other.mode === "offline" || (hubDist >= 2 && !otherHeadingToHub);
        if (passed || this.t > rt.until) {
          r.mode = "normal";
          r.retreat = null;
          r.goal = rt.savedGoal;
          if (r.goal) {
            r.path = this.plan(r, r.goal) ?? [];
            r.noPath = r.path.length === 0 && !cellEq(r.cell, r.goal);
            r.lastReplan = this.t;
          }
          this.event("info", "conflict", r.id, `${r.id} resumed toward ${r.goalLabel ?? "goal"} after ${rt.waitingFor} passed ${shortLabel(this.map, rt.hub[0], rt.hub[1])}`);
        }
        return;
      }
      case "parking":
        r.mode = "normal";
        r.goal = null;
        r.goalLabel = null;
        return;
      case "to_charger":
        if (r.goal && cellEq(r.cell, r.goal)) this.arriveCharger(r);
        return;
      case "normal": {
        if (r.leg) {
          if (r.goal && cellEq(r.cell, r.goal)) {
            r.leg = null;
            r.goal = null;
            r.goalLabel = null;
            r.idleSince = this.t;
            if (r.legs.length) r.mode = "scripted_wait";
          }
          return;
        }
        const task = r.task;
        if (!task) return;
        const s = task.steps[task.stepIndex];
        if (s && s.kind === "navigate" && s.targetCell && cellEq(r.cell, s.targetCell)) {
          task.stepIndex++;
          this.startStep(r);
        } else if (s && s.kind === "navigate" && s.targetCell && !r.path.length && !r.noPath) {
          // path got consumed without reaching the goal (e.g. cleared by a re-plan) → re-plan
          const p = this.plan(r, s.targetCell);
          r.path = p ?? [];
          r.noPath = !p;
          r.lastReplan = this.t;
        }
        return;
      }
      default:
        return;
    }
  }

  private checkCollisions() {
    const seen = new Map<number, Robot>();
    for (const r of this.robots) {
      const i = cellIdx(this.map, r.cell[0], r.cell[1]);
      const o = seen.get(i);
      if (o) {
        this.collisions++;
        this.event("error", "conflict", r.id, `COLLISION between ${r.id} and ${o.id} at ${cellLabel(this.map, r.cell[0], r.cell[1])}`, r.cell);
      }
      seen.set(i, r);
    }
  }

  // ------------------------------------------------------------------ comms & health

  private canHear(a: Robot, b: Robot): boolean {
    if (a.mode === "offline" || b.mode === "offline") return false;
    if (!a.linkOk || !b.linkOk) return false;
    if (this.partitions.length) {
      const ga = this.partitions.findIndex((g) => g.includes(a.id));
      const gb = this.partitions.findIndex((g) => g.includes(b.id));
      if (ga !== gb) return false;
    }
    const dx = a.cell[0] - b.cell[0];
    const dy = a.cell[1] - b.cell[1];
    return dx * dx + dy * dy <= COMMS_RANGE * COMMS_RANGE;
  }

  private updateComms() {
    for (const r of this.robots) {
      r.neighbours = this.robots.filter((o) => o !== r && this.canHear(r, o)).map((o) => o.id);
      const n = r.neighbours.length;
      if (r.mode === "offline") {
        r.msgsPerSec = 0;
        r.plannerMs = 0;
        continue;
      }
      const base = r.linkOk ? 5 + n * 0.35 : 0;
      r.msgsPerSec = Math.max(0, Math.round((base * (1 - this.lossPct / 100) + this.rng.range(-0.25, 0.25)) * 10) / 10);
      const conflict = this.t < r.conflictUntil ? this.rng.range(5, 11) : 0;
      const planner = 2.2 + n * 0.55 + conflict + this.latencyMs * 0.03 + this.rng.range(-0.4, 0.6);
      r.plannerMs = Math.round(Math.max(0.8, planner) * 10) / 10;
      this.plannerSamples.push(r.plannerMs);
      if (this.plannerSamples.length > 4000) this.plannerSamples.splice(0, 1000);
    }
  }

  private updateHealth() {
    for (const r of this.robots) {
      if (this.t - r.lastHealth < 60) continue;
      r.lastHealth = this.t;
      if (!this.quiet) this.emit(this.healthReport(r));
    }
  }

  private healthReport(r: Robot): HealthReportMsg {
    const rng = new Rng((this.seed * 31 + r.index * 977 + Math.floor(this.t / 60)) >>> 0);
    const offline = r.mode === "offline";
    const res = (ok: boolean, warn = false): CheckResult => (ok ? (warn ? "WARN" : "PASS") : "FAIL");
    const plannerWarn = r.plannerMs > 12;
    const groups: HealthGroup[] = [
      {
        name: "Basic",
        items: [
          { item: "Software version", value: "fleet-edge 0.9.4", standard: "≥ 0.9.0", result: "PASS" },
          { item: "Firmware", value: r.info.firmware, standard: "edge-1.4.x", result: res(true, r.info.firmware.endsWith(".1")), note: r.info.firmware.endsWith(".1") ? "update available" : undefined },
          { item: "Edge board", value: r.info.board, standard: "Pi 5 / Orin Nano", result: "PASS" },
          { item: "Wi-Fi RSSI", value: offline ? "—" : `${Math.round(rng.range(-71, -48))} dBm`, standard: "> -75 dBm", result: res(!offline) },
          { item: "Battery health", value: `${Math.round(rng.range(91, 99))} % SoH · ${r.battery.toFixed(0)} % SoC`, standard: "SoH > 80 %", result: "PASS" },
        ],
      },
      {
        name: "Lidar",
        items: [
          { item: "Front lidar", value: `${Math.round(rng.range(9.8, 10.2) * 10) / 10} Hz · ${Math.round(rng.range(1080, 1440))} pts`, standard: "10 Hz ± 0.5", result: res(!offline) },
          { item: "Rear lidar", value: `${Math.round(rng.range(9.8, 10.2) * 10) / 10} Hz · ${Math.round(rng.range(1080, 1440))} pts`, standard: "10 Hz ± 0.5", result: res(!offline) },
        ],
      },
      {
        name: "Camera",
        items: [
          { item: "Front fish-eye camera", value: "Connected · 30 fps", standard: "Connected", result: res(!offline), camera: "front" },
          { item: "Installation angle", value: `(${rng.range(-0.02, 0.02).toFixed(3)}, ${rng.range(0.1, 0.2).toFixed(3)}, ${rng.range(0.02, 0.05).toFixed(3)})`, standard: "(±0.780, ±0.780, ±0.780)", result: "PASS", camera: "front" },
          { item: "Left marker camera", value: "Connected · marker read 1/1", standard: "Connected", result: res(!offline), camera: "left" },
          { item: "Right marker camera", value: "Connected · marker read 1/1", standard: "Connected", result: res(!offline), camera: "right" },
          { item: "Front RGBD", value: rng.chance(0.8) ? "Connected · depth ok" : "No depth frames", standard: "Connected", result: rng.chance(0.8) ? "PASS" : "WARN", camera: "rgbd" },
          { item: "Centre deviation", value: `(${Math.round(rng.range(1, 9))}, ${Math.round(rng.range(2, 12))}) px`, standard: "≤ 100 px", result: "PASS", camera: "front" },
        ],
      },
      {
        name: "Navigation",
        items: [
          { item: "IMU", value: `bias ${rng.range(0.01, 0.06).toFixed(3)} °/s`, standard: "< 0.1 °/s", result: "PASS" },
          { item: "Odometry drift", value: `${rng.range(0.4, 2.1).toFixed(1)} % / 100 m`, standard: "< 3 %", result: "PASS" },
          { item: "Localisation", value: offline ? "lost" : "Localized (reflector + grid)", standard: "Localized", result: res(!offline) },
          { item: "Lift", value: `${r.lift} · ${Math.round(rng.range(2, 6))} mm play`, standard: "< 10 mm", result: "PASS" },
        ],
      },
      {
        name: "Coordination",
        items: [
          { item: "Planner latency", value: `${r.plannerMs.toFixed(1)} ms`, standard: "< 20 ms", result: res(r.plannerMs < 20, plannerWarn), note: plannerWarn ? "conflict resolution in progress" : undefined },
          { item: "Intent broadcast rate", value: `${r.msgsPerSec.toFixed(1)} Hz`, standard: "≥ 5 Hz", result: res(r.msgsPerSec >= 4.5, r.msgsPerSec < 5) },
          { item: "Peer discovery", value: `${r.neighbours.length} peer(s) in range`, standard: "≥ 1 peer", result: res(r.linkOk, r.neighbours.length === 0), note: r.neighbours.length === 0 && r.linkOk ? "no peers within 12 m" : undefined },
          { item: "ORCA safety filter", value: "active · 20 Hz", standard: "active", result: "PASS" },
          { item: "Clock skew vs peers", value: `${r.clockSkew} ms`, standard: "< 50 ms", result: res(r.clockSkew < 50, r.clockSkew > 35) },
          { item: "Intent ack ratio", value: `${Math.round(rng.range(92, 100))} %`, standard: "> 90 %", result: "PASS" },
        ],
      },
    ];
    const all: HealthItem[] = groups.flatMap((g) => g.items);
    const overall: CheckResult = all.some((i) => i.result === "FAIL")
      ? "FAIL"
      : all.some((i) => i.result === "WARN")
        ? "WARN"
        : "PASS";
    r.healthOverall = overall;
    r.healthFailed = all.filter((i) => i.result !== "PASS").map((i) => i.item);
    return {
      type: "health_report",
      robot_id: r.id,
      ts: this.t,
      overall,
      groups,
      pills: [
        { label: "Coordination: PIBT", ok: true },
        { label: offline ? "Network lost" : "Network connected", ok: !offline && r.linkOk },
        { label: "Localized", ok: !offline },
        { label: "Robot connected", ok: !offline },
        { label: "Autonomous", ok: !offline },
        { label: "Node healthy", ok: overall !== "FAIL" },
        { label: `Peers: ${r.neighbours.length}`, ok: r.neighbours.length > 0 },
      ],
    };
  }

  // ------------------------------------------------------------------ messages

  private publicState(r: Robot): RobotState {
    if (r.mode === "offline") return "offline";
    if (r.mode === "charging") return "charging";
    if (!r.linkOk) return "degraded";
    if (r.mode === "retreat" || this.t < r.yieldUntil) return "yielding";
    if (r.noPath || (r.waitSince >= 0 && this.t - r.waitSince > 1.5)) return "blocked";
    if (r.task || r.leg || r.mode === "to_charger" || r.mode === "parking") return "working";
    return "idle";
  }

  private robotMsg(r: Robot): RobotStateMsg {
    const px = r.next ? r.cell[0] + (r.next[0] - r.cell[0]) * r.progress : r.cell[0];
    const py = r.next ? r.cell[1] + (r.next[1] - r.cell[1]) * r.progress : r.cell[1];
    const intentLen = r.linkOk ? 8 : 3;
    const intent: Cell[] = [];
    if (r.next) intent.push(r.next);
    for (const c of r.path) {
      if (intent.length >= intentLen) break;
      intent.push(c);
    }
    let taskRef: RobotTaskRef | null = null;
    if (r.task) {
      const t = r.task;
      const s = t.steps[t.stepIndex];
      const within =
        s && s.kind === "navigate" && t.pathLenAtStep > 0
          ? 1 - (r.path.length + (r.next ? 1 : 0)) / t.pathLenAtStep
          : r.dwelling && s
            ? 1 - Math.max(0, r.dwellUntil - this.t) / (s.seconds ?? 2)
            : 0;
      const progress = Math.min(1, Math.max(0, (t.stepIndex + Math.max(0, Math.min(1, within))) / Math.max(1, t.steps.length)));
      taskRef = {
        id: t.id,
        template: t.templateName,
        step: s ? describeStep(s) : "done",
        step_index: t.stepIndex,
        step_count: t.steps.length,
        progress,
        from: t.from,
        to: t.to,
        priority: t.priority,
      };
    }
    const stationHere = this.map.stationByCell.get(cellIdx(this.map, r.cell[0], r.cell[1]));
    return {
      type: "robot_state",
      robot_id: r.id,
      seq: ++r.seq,
      ts: this.t,
      pose: { x: px, y: py, heading: r.heading },
      cell: r.cell,
      speed: Math.round(r.speed * 100) / 100,
      ang_speed: 0,
      state: this.publicState(r),
      battery_pct: Math.round(r.battery * 10) / 10,
      lift: r.lift,
      task: taskRef,
      intent,
      intent_acked_by: r.neighbours,
      neighbours: r.neighbours,
      link_ok: r.linkOk,
      planner_latency_ms: r.plannerMs,
      msgs_per_sec: r.msgsPerSec,
      yield_count: r.yieldCount,
      tasks_done: r.tasksDone,
      destination: r.goalLabel ?? (r.mode === "charging" ? r.charger?.id ?? null : stationHere?.id ?? null),
      health: { overall: r.healthOverall, failed: r.healthFailed },
    };
  }

  private taskMsg(t: Task): TaskMsg {
    return {
      type: "task",
      task_id: t.id,
      ts: this.t,
      phase: t.phase,
      template: t.templateId,
      template_name: t.templateName,
      priority: t.priority,
      from: t.from,
      to: t.to,
      bids: { ...t.bids },
      winner: t.winner,
      robot: t.robot,
      rebids: t.rebids,
      created_ts: t.createdTs,
      assigned_ts: t.assignedTs,
      done_ts: t.doneTs,
      steps_total: t.steps.length || t.blocks.length,
      steps_done: t.stepIndex,
      note: t.note,
    };
  }

  private fleetStats(): FleetStatsMsg {
    const states = this.robots.map((r) => this.publicState(r));
    const count = (s: RobotState) => states.filter((x) => x === s).length;
    const live = this.tasks.filter((t) => t.phase !== "done");
    const recent = this.doneTimestamps.filter((ts) => this.t - ts <= 60).length;
    return {
      type: "fleet_stats",
      ts: this.t,
      active: this.robots.filter((r) => r.mode !== "offline" && (r.task || r.leg || r.mode === "to_charger")).length,
      idle: count("idle"),
      charging: count("charging"),
      blocked: count("blocked"),
      degraded: count("degraded"),
      offline: count("offline"),
      tasks_urgent: live.filter((t) => t.priority === "urgent").length,
      tasks_in_progress: live.filter((t) => t.phase === "assigned" || t.phase === "in_progress").length,
      tasks_unassigned: live.filter((t) => t.phase === "announced" || t.phase === "bidding" || t.phase === "rebid").length,
      tasks_done: this.tasks.filter((t) => t.phase === "done").length + this.prunedDone,
      tasks_rebid: this.rebidsTotal,
      tasks_total: this.tasksTotal,
      collisions: this.collisions,
      deadlocks_resolved: this.deadlocks,
      yields_total: this.robots.reduce((s, r) => s + r.yieldCount, 0),
      msgs_per_sec_total: Math.round(this.robots.reduce((s, r) => s + r.msgsPerSec, 0) * 10) / 10,
      throughput_per_min: recent,
    };
  }
  private prunedDone = 0;

  private networkMsg(): NetworkMsg {
    const links: Record<string, boolean> = {};
    for (const r of this.robots) links[r.id] = r.linkOk && r.mode !== "offline";
    const blockedCells: Cell[] = [];
    for (const i of this.blocked) blockedCells.push([i % this.map.width, Math.floor(i / this.map.width)]);
    return {
      type: "network",
      ts: this.t,
      links,
      loss_pct: this.lossPct,
      latency_ms: this.latencyMs,
      partitions: this.partitions,
      blocked_cells: blockedCells,
      disabled: this.robots.filter((r) => r.mode === "offline").map((r) => r.id),
      discovery_msgs_per_sec: Math.round(this.robots.filter((r) => r.linkOk && r.mode !== "offline").length * 1.2 * 10) / 10,
    };
  }
}

function describeStep(s: RStep): string {
  switch (s.kind) {
    case "navigate":
      return `Navigate → ${s.targetId ?? "?"}`;
    case "pickup":
      return "Pickup";
    case "drop":
      return "Drop";
    case "rack":
      return `Rack ${s.label ?? ""}`.trim();
    case "lift":
      return `Lift ${s.lift ?? "up"}`;
    case "confirm":
      return `Confirm ${s.message ?? ""}`.trim();
    case "wait":
      return `Wait ${s.seconds ?? 0}s`;
    case "sleep":
      return `Sleep ${s.seconds ?? 0}s`;
    case "charge_if":
      return `Charge if < ${s.threshold ?? 20}%`;
    case "repeat":
      return "Repeat";
  }
}

function targetLabel(t?: TargetSpec): string {
  if (!t) return "—";
  switch (t.kind) {
    case "station":
      return t.id;
    case "any_pickup":
      return "P*";
    case "any_drop":
      return "D*";
    case "cell":
      return `(${t.x},${t.y})`;
  }
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
