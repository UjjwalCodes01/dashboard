import type { Cell } from "../types";

export type ScenarioName =
  | "normal"
  | "head_on"
  | "intersection"
  | "choke"
  | "blocked_aisle"
  | "robot_failure"
  | "partition"
  | "rush_hour"
  | "blackout"
  | "battery_crisis"
  | "convoy"
  | "cascade"
  | "pedestrians";

export interface ScriptedLeg {
  at: number; // sim seconds
  to: Cell;
  label: string;
}

export interface ScenarioRobotPlacement {
  id: string;
  start: Cell;
  legs?: ScriptedLeg[];
}

export type Injection =
  | { at: number; kind: "block_ahead"; note: string }
  | { at: number; kind: "block_cells"; cells: Cell[]; note: string }
  | { at: number; kind: "clear_blocks" }
  | { at: number; kind: "offline"; robot: string }
  | { at: number; kind: "online"; robot: string }
  | { at: number; kind: "partition"; groups: string[][] }
  | { at: number; kind: "heal" }
  | { at: number; kind: "phase"; label: string }
  /** every robot's link down or up at once */
  | { at: number; kind: "all_links"; up: boolean }
  | { at: number; kind: "set_battery"; robot: string; pct: number }
  /** multiply the task arrival rate */
  | { at: number; kind: "task_rate"; mult: number }
  /** a worker walks vertical aisle `x` between rows y0 and y1, `crossings` times */
  | { at: number; kind: "pedestrian"; x: number; y0: number; y1: number; speed?: number; crossings?: number; label?: string };

export interface ScenarioDef {
  name: ScenarioName;
  label: string;
  short: string;
  description: string;
  placements: ScenarioRobotPlacement[];
  injections: Injection[];
}

// Window coordinates (99 × 41 crop of warehouse-10-20-10-2-1).
// Vertical aisles: A=21 B=32 C=43 D=54 E=65 F=76 G=87 H=98. Horizontal aisles: 1..14 at y = 1,4,7,…,40.
// Every cell of a vertical aisle column is free, so (43, y) is walkable for any y.

export const SCENARIOS: Record<ScenarioName, ScenarioDef> = {
  normal: {
    name: "normal",
    label: "Normal operations",
    short: "Normal ops",
    description: "Continuous pick & drop from the auction queue. No injections.",
    placements: [],
    injections: [{ at: 0, kind: "phase", label: "steady state" }],
  },
  head_on: {
    name: "head_on",
    label: "Head-on corridor",
    short: "Head-on",
    description:
      "Pairs of robots enter the same one-lane aisle from opposite ends. Priority inheritance decides who yields; the loser re-routes or backs up to the last intersection.",
    placements: [
      {
        id: "AMR-01",
        start: [21, 7],
        legs: [{ at: 4, to: [38, 7], label: "aisle 3 east" }],
      },
      {
        id: "AMR-02",
        start: [32, 7],
        legs: [{ at: 4, to: [16, 7], label: "aisle 3 west → P1" }],
      },
      {
        id: "AMR-03",
        start: [43, 19],
        legs: [{ at: 30, to: [60, 19], label: "aisle 7 east" }],
      },
      {
        id: "AMR-04",
        start: [54, 19],
        legs: [{ at: 30, to: [38, 19], label: "aisle 7 west → P3" }],
      },
      {
        id: "AMR-05",
        start: [32, 25],
        legs: [{ at: 58, to: [32, 37], label: "aisle B south" }],
      },
      {
        id: "AMR-06",
        start: [32, 34],
        legs: [{ at: 58, to: [32, 22], label: "aisle B north" }],
      },
    ],
    injections: [
      { at: 0, kind: "phase", label: "wave 1 · aisle 3" },
      { at: 28, kind: "phase", label: "wave 2 · aisle 7" },
      { at: 56, kind: "phase", label: "wave 3 · aisle B" },
      { at: 80, kind: "phase", label: "steady state" },
    ],
  },
  intersection: {
    name: "intersection",
    label: "4-way intersection",
    short: "4-way",
    description:
      "Four robots converge on choke B3 from N/E/S/W and each turns left. Passage order emerges from priorities; no referee.",
    placements: [
      { id: "AMR-01", start: [26, 7], legs: [{ at: 4, to: [32, 1], label: "W → N" }] },
      { id: "AMR-02", start: [32, 2], legs: [{ at: 4.6, to: [38, 7], label: "N → E" }] },
      { id: "AMR-03", start: [38, 7], legs: [{ at: 5.2, to: [32, 13], label: "E → S" }] },
      { id: "AMR-04", start: [32, 12], legs: [{ at: 5.8, to: [26, 7], label: "S → W" }] },
      {
        id: "AMR-05",
        start: [43, 25],
        legs: [{ at: 40, to: [49, 31], label: "choke C9 → S" }],
      },
      {
        id: "AMR-06",
        start: [49, 31],
        legs: [{ at: 40, to: [43, 25], label: "choke C9 → N" }],
      },
    ],
    injections: [
      { at: 0, kind: "phase", label: "4-way at B3" },
      { at: 38, kind: "phase", label: "crossing at C9/C10" },
      { at: 70, kind: "phase", label: "steady state" },
    ],
  },
  choke: {
    name: "choke",
    label: "Choke point convoy",
    short: "Choke",
    description:
      "A convoy files south through aisle A while one robot comes north. The northbound robot backs up to the last intersection and side-steps.",
    placements: [
      { id: "AMR-01", start: [21, 3], legs: [{ at: 4, to: [21, 19], label: "convoy 1" }] },
      { id: "AMR-02", start: [21, 2], legs: [{ at: 4, to: [21, 22], label: "convoy 2" }] },
      { id: "AMR-03", start: [21, 1], legs: [{ at: 4, to: [21, 25], label: "convoy 3" }] },
      { id: "AMR-04", start: [20, 1], legs: [{ at: 4, to: [27, 13], label: "convoy 4 → P2" }] },
      {
        id: "AMR-05",
        start: [21, 15],
        legs: [{ at: 4, to: [21, 1], label: "northbound" }],
      },
      {
        id: "AMR-06",
        start: [54, 4],
        legs: [{ at: 45, to: [54, 22], label: "aisle D south" }],
      },
    ],
    injections: [
      { at: 0, kind: "phase", label: "convoy through aisle A" },
      { at: 45, kind: "phase", label: "steady state" },
    ],
  },
  blocked_aisle: {
    name: "blocked_aisle",
    label: "Blocked aisle",
    short: "Blocked aisle",
    description:
      "An aisle on a robot's route is blocked. It re-plans locally; if the cost jumps past the threshold the task is re-auctioned to a better-placed peer.",
    placements: [],
    injections: [
      { at: 0, kind: "phase", label: "steady state" },
      { at: 10, kind: "block_ahead", note: "pallet dropped" },
      { at: 10, kind: "phase", label: "aisle blocked" },
      { at: 40, kind: "block_ahead", note: "spill" },
      { at: 70, kind: "clear_blocks" },
      { at: 70, kind: "phase", label: "aisles cleared" },
    ],
  },
  robot_failure: {
    name: "robot_failure",
    label: "Robot failure",
    short: "Robot failure",
    description:
      "AMR-03 drops offline mid-task. Its task is re-auctioned; peers route around the stopped robot.",
    placements: [],
    injections: [
      { at: 0, kind: "phase", label: "steady state" },
      { at: 10, kind: "offline", robot: "AMR-03" },
      { at: 10, kind: "phase", label: "AMR-03 offline" },
      { at: 70, kind: "online", robot: "AMR-03" },
      { at: 70, kind: "phase", label: "AMR-03 recovered" },
    ],
  },
  partition: {
    name: "partition",
    label: "Network partition",
    short: "Partition",
    description:
      "The fleet splits into two groups that cannot hear each other. Each group keeps coordinating internally; cross-group encounters fall back to the local safety filter.",
    placements: [],
    injections: [
      { at: 0, kind: "phase", label: "steady state" },
      {
        at: 10,
        kind: "partition",
        groups: [
          ["AMR-01", "AMR-02", "AMR-03"],
          ["AMR-04", "AMR-05", "AMR-06"],
        ],
      },
      { at: 10, kind: "phase", label: "partitioned" },
      { at: 70, kind: "heal" },
      { at: 70, kind: "phase", label: "healed" },
    ],
  },
  rush_hour: {
    name: "rush_hour",
    label: "Rush hour surge",
    short: "Rush hour",
    description:
      "Order arrivals jump to four times normal for 100 s, then fall back. Every idle robot bids on every task on-board; watch the queue drain without anyone dispatching.",
    placements: [],
    injections: [
      { at: 0, kind: "phase", label: "steady state" },
      { at: 10, kind: "task_rate", mult: 4 },
      { at: 10, kind: "phase", label: "surge ×4 — auction under load" },
      { at: 110, kind: "task_rate", mult: 1 },
      { at: 110, kind: "phase", label: "surge over — backlog clearing" },
    ],
  },
  blackout: {
    name: "blackout",
    label: "Total comms blackout",
    short: "Blackout",
    description:
      "Every radio goes dark for 45 s. No robot can hear any other, so PIBT has nothing to coordinate with; each robot runs on its cached intent with the sensor veto and ORCA keeping it safe. Then the network comes back.",
    placements: [],
    injections: [
      { at: 0, kind: "phase", label: "steady state" },
      { at: 20, kind: "all_links", up: false },
      { at: 20, kind: "phase", label: "blackout — sensors only" },
      { at: 65, kind: "all_links", up: true },
      { at: 65, kind: "phase", label: "network restored — intent re-synced" },
    ],
  },
  battery_crisis: {
    name: "battery_crisis",
    label: "Battery crisis",
    short: "Battery crisis",
    description:
      "Seven robots hit the 20 % floor within seconds of each other with only six chargers. Robots carrying a load finish the delivery first; the rest queue for a bay on their own.",
    placements: [],
    injections: [
      { at: 0, kind: "phase", label: "steady state" },
      { at: 5, kind: "set_battery", robot: "AMR-01", pct: 24 },
      { at: 5, kind: "set_battery", robot: "AMR-02", pct: 23 },
      { at: 5, kind: "set_battery", robot: "AMR-03", pct: 22 },
      { at: 5, kind: "set_battery", robot: "AMR-04", pct: 22 },
      { at: 5, kind: "set_battery", robot: "AMR-05", pct: 21 },
      { at: 5, kind: "set_battery", robot: "AMR-06", pct: 23 },
      { at: 5, kind: "set_battery", robot: "AMR-07", pct: 21 },
      { at: 5, kind: "phase", label: "seven robots near the floor" },
      { at: 60, kind: "phase", label: "charger contention" },
    ],
  },
  convoy: {
    name: "convoy",
    label: "Convoy through one aisle",
    short: "Convoy",
    description:
      "Six robots file south down aisle C nose-to-tail while one comes north against them. PIBT threads the single northbound robot through the platoon by pushing it into the cross-aisles; nobody stops the convoy to do it.",
    placements: [
      { id: "AMR-01", start: [43, 1], legs: [{ at: 4, to: [43, 37], label: "convoy 1" }] },
      { id: "AMR-02", start: [43, 2], legs: [{ at: 4, to: [43, 36], label: "convoy 2" }] },
      { id: "AMR-03", start: [43, 3], legs: [{ at: 4, to: [43, 35], label: "convoy 3" }] },
      { id: "AMR-04", start: [43, 4], legs: [{ at: 4, to: [43, 34], label: "convoy 4" }] },
      { id: "AMR-05", start: [43, 5], legs: [{ at: 4, to: [43, 33], label: "convoy 5" }] },
      { id: "AMR-06", start: [43, 6], legs: [{ at: 4, to: [43, 32], label: "convoy 6" }] },
      { id: "AMR-07", start: [43, 38], legs: [{ at: 6, to: [43, 1], label: "northbound against the flow" }] },
    ],
    injections: [
      { at: 0, kind: "phase", label: "convoy forming in aisle C" },
      { at: 6, kind: "phase", label: "one robot against the flow" },
      { at: 70, kind: "phase", label: "steady state" },
    ],
  },
  cascade: {
    name: "cascade",
    label: "Cascading failure",
    short: "Cascade",
    description:
      "One thing after another: a robot dies, an aisle is blocked, the network splits, a link drops. Nothing is repaired until 150 s. The point is that each failure degrades coordination and none of them touches safety.",
    placements: [],
    injections: [
      { at: 0, kind: "phase", label: "steady state" },
      { at: 20, kind: "offline", robot: "AMR-03" },
      { at: 20, kind: "phase", label: "AMR-03 dead" },
      { at: 45, kind: "block_ahead", note: "pallet dropped" },
      { at: 45, kind: "phase", label: "+ aisle blocked" },
      { at: 70, kind: "partition", groups: [["AMR-01", "AMR-02", "AMR-04", "AMR-05", "AMR-06"], ["AMR-07", "AMR-08", "AMR-09", "AMR-10"]] },
      { at: 70, kind: "phase", label: "+ network split" },
      { at: 95, kind: "offline", robot: "AMR-08" },
      { at: 95, kind: "phase", label: "+ second robot dead" },
      { at: 150, kind: "heal" },
      { at: 150, kind: "clear_blocks" },
      { at: 150, kind: "online", robot: "AMR-03" },
      { at: 150, kind: "online", robot: "AMR-08" },
      { at: 150, kind: "phase", label: "everything repaired" },
    ],
  },
  pedestrians: {
    name: "pedestrians",
    label: "Workers in the aisles",
    short: "Pedestrians",
    description:
      "People walk the aisles. A worker is a body the fleet can see but cannot negotiate with, so PIBT routes around them and ORCA keeps clearance. A robot sharing a cell with a worker counts as a contact and must never happen.",
    placements: [],
    injections: [
      { at: 0, kind: "phase", label: "steady state" },
      { at: 5, kind: "pedestrian", x: 32, y0: 4, y1: 22, crossings: 3, label: "picker in aisle B" },
      { at: 5, kind: "phase", label: "worker in aisle B" },
      { at: 25, kind: "pedestrian", x: 54, y0: 13, y1: 31, crossings: 2, label: "supervisor in aisle D" },
      { at: 25, kind: "phase", label: "two workers on the floor" },
      { at: 45, kind: "pedestrian", x: 21, y0: 19, y1: 37, crossings: 4, speed: 0.9, label: "forklift driver walking aisle A" },
      { at: 45, kind: "phase", label: "three workers on the floor" },
    ],
  },
};

export const SCENARIO_LIST: ScenarioDef[] = Object.values(SCENARIOS);
