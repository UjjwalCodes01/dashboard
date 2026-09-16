import { create } from "zustand";
import type {
  BenchmarkMsg,
  ClientMsg,
  CoordinationMsg,
  EventMsg,
  FleetStatsMsg,
  HealthReportMsg,
  NetworkMsg,
  RobotInfo,
  RobotStateMsg,
  ServerMsg,
  SimClockMsg,
  TaskMsg,
  TaskPriority,
  TaskTemplate,
} from "./types";
import { analyseMap, type WarehouseMap } from "./sim/map";
import type { ScenarioName } from "./sim/scenarios";
import { loadTemplates, saveTemplates } from "./sim/templates";

export interface HistorySample {
  ts: number;
  speed: number;
  battery: number;
  planner: number;
  msgs: number;
}

export interface ViewToggles {
  trails: boolean;
  comms: boolean;
  grid: boolean;
  labels: boolean;
  lanes: boolean;
  chokes: boolean;
  links: boolean;
  /** congestion heatmap: where robots have been, hot where they stood still */
  heat: boolean;
  /** PIBT priority-inheritance arrows as they fire */
  pushes: boolean;
  /** message packets animating along peer links */
  packets: boolean;
}

/** One recorded tick, for the replay scrubber. Robot messages are fresh objects per tick, so sharing refs is safe. */
export interface Frame {
  ts: number;
  robots: Record<string, RobotStateMsg>;
  coordination: CoordinationMsg | null;
  fleet: FleetStatsMsg | null;
  network: NetworkMsg | null;
  clock: SimClockMsg | null;
  /** this tick carried a conflict event — a jump target for the scrubber */
  conflict: boolean;
}

export interface FleetSample {
  ts: number;
  throughput: number;
  collisions: number;
  deadlocks: number;
  msgs: number;
  blocked: number;
  contacts: number;
}

export interface HeatField {
  occ: Float32Array;
  wait: Float32Array;
  w: number;
  h: number;
}

export type TransportKind = "mock" | "ws";

export interface FleetStore {
  connected: boolean;
  transport: TransportKind;
  map: WarehouseMap | null;
  robots: Record<string, RobotStateMsg>;
  robotIds: string[];
  robotInfo: Record<string, RobotInfo>;
  fleet: FleetStatsMsg | null;
  events: EventMsg[];
  tasks: Record<string, TaskMsg>;
  taskIds: string[];
  network: NetworkMsg | null;
  health: Record<string, HealthReportMsg>;
  benchmark: BenchmarkMsg | null;
  history: Record<string, HistorySample[]>;
  clock: SimClockMsg | null;
  scenario: ScenarioName;
  seed: number;
  timeScale: number;
  selectedRobotId: string | null;
  hoverRobotId: string | null;
  view: ViewToggles;
  templates: TaskTemplate[];
  /** wall-clock (performance.now) of the last conflict event per cell key "x,y" — used for choke pulses */
  conflictPulses: Record<string, number>;
  tickCount: number;
  coordination: CoordinationMsg | null;
  /** priority-inheritance arrows still worth drawing, with the wall-clock they fired at */
  recentPushes: { from: string; to: string; at: number }[];
  heat: HeatField | null;
  fleetHistory: FleetSample[];
  /** ring buffer of ticks for the replay scrubber; mutated in place, capped */
  recording: Frame[];
  /** null = live; otherwise the frame index being shown */
  replayIndex: number | null;
  paused: boolean;
  /** robot the Hub camera is locked onto */
  follow: string | null;
  paletteOpen: boolean;

  sender: ((m: ClientMsg) => void) | null;
  applyMessages: (msgs: ServerMsg[]) => void;
  setConnected: (ok: boolean, kind?: TransportKind) => void;
  setSender: (fn: ((m: ClientMsg) => void) | null) => void;
  send: (m: ClientMsg) => void;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setView: (patch: Partial<ViewToggles>) => void;
  setScenario: (name: ScenarioName, seed?: number) => void;
  setTimeScale: (k: number) => void;
  resetSim: () => void;
  initTemplates: () => void;
  upsertTemplate: (t: TaskTemplate) => void;
  deleteTemplate: (id: string) => void;
  issueTemplate: (id: string, count: number, priority: TaskPriority) => void;
  setPaused: (paused: boolean) => void;
  scrubTo: (index: number) => void;
  stepReplay: (delta: number) => void;
  jumpConflict: (dir: 1 | -1) => void;
  goLive: () => void;
  setFollow: (id: string | null) => void;
  setPalette: (open: boolean) => void;
}

const MAX_EVENTS = 400;
const MAX_TASKS = 240;
const MAX_HISTORY = 120;
/** 5 minutes at 5 Hz */
const MAX_FRAMES = 1500;
const MAX_FLEET_SAMPLES = 360;
/** per-tick decay of the heat field; half-life ≈ 28 s at 5 Hz */
const HEAT_DECAY = 0.9955;

export const useFleetStore = create<FleetStore>((set, get) => ({
  connected: false,
  transport: "mock",
  map: null,
  robots: {},
  robotIds: [],
  robotInfo: {},
  fleet: null,
  events: [],
  tasks: {},
  taskIds: [],
  network: null,
  health: {},
  benchmark: null,
  history: {},
  clock: null,
  scenario: "normal",
  seed: 42,
  timeScale: 1,
  selectedRobotId: null,
  hoverRobotId: null,
  view: { trails: true, comms: false, grid: false, labels: true, lanes: true, chokes: true, links: true, heat: false, pushes: true, packets: true },
  templates: [],
  conflictPulses: {},
  tickCount: 0,
  coordination: null,
  recentPushes: [],
  heat: null,
  fleetHistory: [],
  recording: [],
  replayIndex: null,
  paused: false,
  follow: null,
  paletteOpen: false,
  sender: null,

  applyMessages: (msgs) =>
    set((s) => {
      let robots = s.robots;
      let robotsCloned = false;
      let robotIds = s.robotIds;
      let robotInfo = s.robotInfo;
      let fleet = s.fleet;
      let events = s.events;
      let eventsCloned = false;
      let tasks = s.tasks;
      let tasksCloned = false;
      let taskIds = s.taskIds;
      let network = s.network;
      let health = s.health;
      let benchmark = s.benchmark;
      let history = s.history;
      let historyCloned = false;
      let clock = s.clock;
      let map = s.map;
      let conflictPulses = s.conflictPulses;
      let pulsesCloned = false;
      let coordination = s.coordination;
      let recentPushes = s.recentPushes;
      let heat = s.heat;
      let fleetHistory = s.fleetHistory;
      let sawRobot = false;
      let sawConflict = false;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();

      for (const m of msgs) {
        switch (m.type) {
          case "robot_state": {
            if (!robotsCloned) {
              robots = { ...robots };
              robotsCloned = true;
            }
            robots[m.robot_id] = m;
            sawRobot = true;
            if (heat && m.state !== "offline") {
              const hi = m.cell[1] * heat.w + m.cell[0];
              if (hi >= 0 && hi < heat.occ.length) {
                heat.occ[hi] += 1;
                if (m.speed < 0.05 && m.state !== "charging" && m.state !== "idle") heat.wait[hi] += 1;
              }
            }
            if (!robotIds.includes(m.robot_id)) robotIds = [...robotIds, m.robot_id].sort();
            const h = history[m.robot_id];
            const last = h && h.length ? h[h.length - 1] : null;
            if (!last || m.ts - last.ts >= 1 - 1e-6) {
              if (!historyCloned) {
                history = { ...history };
                historyCloned = true;
              }
              const arr = h ? h.slice(-(MAX_HISTORY - 1)) : [];
              arr.push({
                ts: m.ts,
                speed: m.speed,
                battery: m.battery_pct,
                planner: m.planner_latency_ms,
                msgs: m.msgs_per_sec,
              });
              history[m.robot_id] = arr;
            }
            break;
          }
          case "robot_info": {
            const info: Record<string, RobotInfo> = {};
            for (const r of m.robots) info[r.id] = r;
            robotInfo = info;
            robotIds = m.robots.map((r) => r.id).sort();
            break;
          }
          case "fleet_stats":
            fleet = m;
            fleetHistory = fleetHistory.length >= MAX_FLEET_SAMPLES ? fleetHistory.slice(-(MAX_FLEET_SAMPLES - 1)) : fleetHistory.slice();
            fleetHistory.push({
              ts: m.ts,
              throughput: m.throughput_per_min,
              collisions: m.collisions,
              deadlocks: m.deadlocks_resolved,
              msgs: m.msgs_per_sec_total,
              blocked: m.blocked,
              contacts: m.pedestrian_contacts ?? 0,
            });
            break;
          case "coordination": {
            coordination = m;
            const kept = recentPushes.filter((p) => now - p.at < 2500);
            if (m.pushes.length || kept.length !== recentPushes.length) {
              recentPushes = kept;
              for (const [from, to] of m.pushes) recentPushes.push({ from, to, at: now });
            }
            break;
          }
          case "event": {
            if (!eventsCloned) {
              events = events.slice(-(MAX_EVENTS - 1));
              eventsCloned = true;
            }
            events.push(m);
            if (m.category === "conflict") sawConflict = true;
            if (m.category === "conflict" && m.cell) {
              if (!pulsesCloned) {
                conflictPulses = { ...conflictPulses };
                pulsesCloned = true;
              }
              conflictPulses[`${m.cell[0]},${m.cell[1]}`] = now;
            }
            break;
          }
          case "task": {
            if (!tasksCloned) {
              tasks = { ...tasks };
              tasksCloned = true;
            }
            if (!tasks[m.task_id]) taskIds = [...taskIds, m.task_id];
            tasks[m.task_id] = m;
            break;
          }
          case "network":
            network = m;
            break;
          case "health_report":
            health = { ...health, [m.robot_id]: m };
            break;
          case "benchmark":
            benchmark = m;
            break;
          case "clock":
            clock = m;
            break;
          case "map": {
            map = analyseMap(m);
            heat = { occ: new Float32Array(map.width * map.height), wait: new Float32Array(map.width * map.height), w: map.width, h: map.height };
            break;
          }
        }
      }
      if (sawRobot && heat) {
        const { occ, wait } = heat;
        for (let i = 0; i < occ.length; i++) {
          occ[i] *= HEAT_DECAY;
          wait[i] *= HEAT_DECAY;
        }
      }
      if (sawRobot && s.replayIndex === null) {
        const rec = s.recording;
        rec.push({ ts: clock?.ts ?? 0, robots, coordination, fleet, network, clock, conflict: sawConflict });
        if (rec.length > MAX_FRAMES) rec.splice(0, rec.length - MAX_FRAMES);
      }
      if (taskIds.length > MAX_TASKS) {
        // drop the oldest finished tasks
        const keep: string[] = [];
        const drop = new Set<string>();
        let excess = taskIds.length - MAX_TASKS;
        for (const id of taskIds) {
          const t = tasks[id];
          if (excess > 0 && t && t.phase === "done") {
            drop.add(id);
            excess--;
          } else keep.push(id);
        }
        if (drop.size) {
          const next: Record<string, TaskMsg> = {};
          for (const id of keep) next[id] = tasks[id];
          tasks = next;
          taskIds = keep;
        }
      }
      return {
        robots,
        robotIds,
        robotInfo,
        fleet,
        events,
        tasks,
        taskIds,
        network,
        health,
        benchmark,
        history,
        clock,
        map,
        conflictPulses,
        coordination,
        recentPushes,
        heat,
        fleetHistory,
        tickCount: s.tickCount + 1,
      };
    }),

  setConnected: (ok, kind) => set((s) => ({ connected: ok, transport: kind ?? s.transport })),
  setSender: (fn) => set({ sender: fn }),
  send: (m) => {
    const fn = get().sender;
    if (fn) fn(m);
  },
  select: (id) => set({ selectedRobotId: id }),
  hover: (id) => set({ hoverRobotId: id }),
  setView: (patch) => set((s) => ({ view: { ...s.view, ...patch } })),
  setScenario: (name, seed) => {
    const sd = seed ?? get().seed;
    get().resetSim();
    set({ scenario: name, seed: sd });
    get().send({ type: "scenario", name, seed: sd });
  },
  setTimeScale: (k) => {
    set({ timeScale: k });
    if (!get().paused) get().send({ type: "time_scale", value: k });
  },
  setPaused: (paused) => {
    if (get().paused === paused) return;
    set({ paused });
    get().send({ type: "time_scale", value: paused ? 0 : get().timeScale });
  },
  scrubTo: (index) => {
    const st = get();
    const i = Math.max(0, Math.min(st.recording.length - 1, Math.round(index)));
    const f = st.recording[i];
    if (!f) return;
    if (!st.paused) st.setPaused(true);
    set({
      replayIndex: i,
      robots: f.robots,
      coordination: f.coordination,
      fleet: f.fleet ?? st.fleet,
      network: f.network ?? st.network,
      clock: f.clock ? { ...f.clock, ts: f.ts } : st.clock,
      recentPushes: f.coordination ? f.coordination.pushes.map(([from, to]) => ({ from, to, at: performance.now() })) : [],
    });
  },
  stepReplay: (delta) => {
    const st = get();
    const cur = st.replayIndex ?? st.recording.length - 1;
    st.scrubTo(cur + delta);
  },
  jumpConflict: (dir) => {
    const st = get();
    const rec = st.recording;
    let i = st.replayIndex ?? rec.length - 1;
    for (let k = 0; k < rec.length; k++) {
      i += dir;
      if (i < 0 || i >= rec.length) return;
      if (rec[i].conflict) {
        st.scrubTo(i);
        return;
      }
    }
  },
  goLive: () => {
    const st = get();
    const last = st.recording[st.recording.length - 1];
    if (last)
      set({
        robots: last.robots,
        coordination: last.coordination,
        fleet: last.fleet ?? st.fleet,
        network: last.network ?? st.network,
        clock: last.clock ?? st.clock,
      });
    set({ replayIndex: null, recentPushes: [] });
    st.setPaused(false);
  },
  setFollow: (id) => set({ follow: id }),
  setPalette: (open) => set({ paletteOpen: open }),
  resetSim: () =>
    set({
      robots: {},
      fleet: null,
      events: [],
      tasks: {},
      taskIds: [],
      network: null,
      health: {},
      history: {},
      clock: null,
      conflictPulses: {},
      selectedRobotId: null,
      coordination: null,
      recentPushes: [],
      heat: get().heat ? { ...get().heat!, occ: new Float32Array(get().heat!.occ.length), wait: new Float32Array(get().heat!.wait.length) } : null,
      fleetHistory: [],
      recording: [],
      replayIndex: null,
      paused: false,
      follow: null,
    }),
  initTemplates: () => {
    if (get().templates.length) return;
    set({ templates: loadTemplates() });
  },
  upsertTemplate: (t) => {
    const list = get().templates.slice();
    const i = list.findIndex((x) => x.id === t.id);
    if (i >= 0) list[i] = t;
    else list.unshift(t);
    saveTemplates(list);
    set({ templates: list });
  },
  deleteTemplate: (id) => {
    const list = get().templates.filter((t) => t.id !== id);
    saveTemplates(list);
    set({ templates: list });
  },
  issueTemplate: (id, count, priority) => {
    const t = get().templates.find((x) => x.id === id);
    if (!t) return;
    const updated = { ...t, last_issued: Date.now() };
    get().upsertTemplate(updated);
    get().send({ type: "issue_task", template: updated, count, priority });
  },
}));

/** Stable, sorted list of robot states. */
export const selectRobotList = (s: FleetStore): RobotStateMsg[] =>
  s.robotIds.map((id) => s.robots[id]).filter(Boolean);
