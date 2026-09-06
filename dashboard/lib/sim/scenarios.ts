import type { Cell } from "../types";

export type ScenarioName =
  | "normal"
  | "head_on"
  | "intersection"
  | "choke"
  | "blocked_aisle"
  | "robot_failure"
  | "partition";

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
  | { at: number; kind: "phase"; label: string };

export interface ScenarioDef {
  name: ScenarioName;
  label: string;
  short: string;
  description: string;
  placements: ScenarioRobotPlacement[];
  injections: Injection[];
}

// Window coordinates (66 × 41 crop of warehouse-10-20-10-2-1).
// Vertical aisles: A=21 B=32 C=43 D=54 E=65. Horizontal aisles: 1..14 at y = 1,4,7,…,40.

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
};

export const SCENARIO_LIST: ScenarioDef[] = Object.values(SCENARIOS);
