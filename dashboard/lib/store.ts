import { create } from "zustand";
import type {
  BenchmarkMsg,
  ClientMsg,
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
}

const MAX_EVENTS = 400;
const MAX_TASKS = 240;
const MAX_HISTORY = 120;

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
  view: { trails: true, comms: false, grid: false, labels: true, lanes: true, chokes: true, links: true },
  templates: [],
  conflictPulses: {},
  tickCount: 0,
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
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();

      for (const m of msgs) {
        switch (m.type) {
          case "robot_state": {
            if (!robotsCloned) {
              robots = { ...robots };
              robotsCloned = true;
            }
            robots[m.robot_id] = m;
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
            break;
          case "event": {
            if (!eventsCloned) {
              events = events.slice(-(MAX_EVENTS - 1));
              eventsCloned = true;
            }
            events.push(m);
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
          case "map":
            map = analyseMap(m);
            break;
        }
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
    get().send({ type: "time_scale", value: k });
  },
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
