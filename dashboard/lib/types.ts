/**
 * Telemetry contract — mirrors backend/schema.py (see DASHBOARD_BUILD_DOCS.md §14).
 * The dashboard is a read-only subscriber. The only client → server messages are
 * fault injection, task issue (publishes into the fleet auction) and scenario selection.
 */

export type RobotState =
  | "idle"
  | "working"
  | "charging"
  | "blocked"
  | "yielding"
  | "degraded"
  | "offline";

export type Cell = [number, number];

export interface Pose {
  x: number;
  y: number;
  heading: number; // degrees, 0 = east, 90 = north (screen up)
}

export type TaskPriority = "normal" | "urgent";

export interface RobotTaskRef {
  id: string;
  template: string;
  step: string;
  step_index: number;
  step_count: number;
  progress: number; // 0..1
  from: string;
  to: string;
  priority: TaskPriority;
}

export interface RobotStateMsg {
  type: "robot_state";
  robot_id: string;
  seq: number;
  ts: number; // sim seconds
  pose: Pose;
  cell: Cell;
  speed: number; // m/s
  ang_speed: number; // deg/s
  state: RobotState;
  battery_pct: number;
  lift: "up" | "down";
  task: RobotTaskRef | null;
  intent: Cell[];
  intent_acked_by: string[];
  neighbours: string[];
  link_ok: boolean;
  planner_latency_ms: number;
  msgs_per_sec: number;
  yield_count: number;
  tasks_done: number;
  destination: string | null;
  health: { overall: "PASS" | "WARN" | "FAIL"; failed: string[] };
}

export interface RobotInfo {
  id: string;
  model: string;
  board: string;
  firmware: string;
  ip: string;
  max_speed: number;
}

export interface RobotInfoMsg {
  type: "robot_info";
  robots: RobotInfo[];
}

export interface FleetStatsMsg {
  type: "fleet_stats";
  ts: number;
  active: number;
  idle: number;
  charging: number;
  blocked: number;
  degraded: number;
  offline: number;
  tasks_urgent: number;
  tasks_in_progress: number;
  tasks_unassigned: number;
  tasks_done: number;
  tasks_rebid: number;
  tasks_total: number;
  collisions: number;
  deadlocks_resolved: number;
  yields_total: number;
  msgs_per_sec_total: number;
  throughput_per_min: number;
}

export type EventLevel = "info" | "warn" | "error";
export type EventCategory =
  | "conflict"
  | "task"
  | "network"
  | "battery"
  | "health"
  | "system";

export interface EventMsg {
  type: "event";
  id: number;
  ts: number;
  level: EventLevel;
  category: EventCategory;
  robot_id: string | null;
  cell?: Cell;
  text: string;
}

export type TaskPhase =
  | "announced"
  | "bidding"
  | "assigned"
  | "in_progress"
  | "done"
  | "rebid";

export interface TaskMsg {
  type: "task";
  task_id: string;
  ts: number;
  phase: TaskPhase;
  template: string;
  template_name: string;
  priority: TaskPriority;
  from: string;
  to: string;
  bids: Record<string, number>;
  winner: string | null;
  robot: string | null;
  rebids: number;
  created_ts: number;
  assigned_ts: number | null;
  done_ts: number | null;
  steps_total: number;
  steps_done: number;
  note?: string;
}

export interface NetworkMsg {
  type: "network";
  ts: number;
  links: Record<string, boolean>;
  loss_pct: number;
  latency_ms: number;
  partitions: string[][];
  blocked_cells: Cell[];
  disabled: string[];
  discovery_msgs_per_sec: number;
}

export interface BenchmarkSide {
  elapsed_s: number;
  tasks_done: number;
  tasks_total: number;
  stop_time_s: number;
  collisions: number;
  deadlocks: number;
  mean_resolution_s: number;
  sum_costs: number;
  path_deviation_pct: number;
  choke_flow_per_min: number;
  planner_p50_ms: number;
  planner_p95_ms: number;
  msgs_per_robot: number;
  progress: number; // 0..1
  finished: boolean;
}

export interface BenchmarkMsg {
  type: "benchmark";
  scenario: string;
  seed: number;
  baseline: BenchmarkSide;
  ours: BenchmarkSide;
  improvement_pct: number;
  runs: number;
  std_pct: number;
  running: boolean;
}

export type CheckResult = "PASS" | "WARN" | "FAIL";

export interface HealthItem {
  item: string;
  value: string;
  standard: string;
  result: CheckResult;
  note?: string;
  camera?: "front" | "left" | "right" | "rgbd" | "reader";
}

export interface HealthGroup {
  name: string;
  items: HealthItem[];
}

export interface HealthReportMsg {
  type: "health_report";
  robot_id: string;
  ts: number;
  overall: CheckResult;
  groups: HealthGroup[];
  pills: { label: string; ok: boolean }[];
}

export interface StationDef {
  id: string;
  type: "pickup" | "drop";
  cell: Cell;
}
export interface ChargerDef {
  id: string;
  cell: Cell;
}

export interface MapMsg {
  type: "map";
  name: string;
  source: string;
  full_width: number;
  full_height: number;
  window: { x0: number; y0: number; w: number; h: number };
  rows: string[]; // cropped grid rows: '.' free, '@' obstacle
  stations: StationDef[];
  chargers: ChargerDef[];
  parking: Cell[];
}

export interface SimClockMsg {
  type: "clock";
  ts: number;
  scenario: string;
  seed: number;
  time_scale: number;
  scenario_phase: string;
}

export type ServerMsg =
  | RobotStateMsg
  | RobotInfoMsg
  | FleetStatsMsg
  | EventMsg
  | TaskMsg
  | NetworkMsg
  | BenchmarkMsg
  | HealthReportMsg
  | MapMsg
  | SimClockMsg;

// ---- client → server (the only allowed ones) ----

export type FaultAction =
  | "toggle_link"
  | "block_cell"
  | "unblock_all"
  | "disable_robot"
  | "partition"
  | "set_loss"
  | "set_latency";

export interface FaultMsg {
  type: "fault";
  action: FaultAction;
  target?: string;
  cell?: Cell;
  value?: boolean | number | string[][];
}

export interface IssueTaskMsg {
  type: "issue_task";
  template: TaskTemplate;
  count: number;
  priority: TaskPriority;
}

export interface ScenarioMsg {
  type: "scenario";
  name: string;
  seed: number;
}

export interface TimeScaleMsg {
  type: "time_scale";
  value: number;
}

export type ClientMsg = FaultMsg | IssueTaskMsg | ScenarioMsg | TimeScaleMsg;

// ---- task templates (block editor JSON) ----

export type BlockKind =
  | "navigate"
  | "pickup"
  | "drop"
  | "rack"
  | "lift"
  | "wait"
  | "confirm"
  | "charge_if"
  | "repeat"
  | "sleep";

export type TargetSpec =
  | { kind: "station"; id: string }
  | { kind: "any_pickup" }
  | { kind: "any_drop" }
  | { kind: "cell"; x: number; y: number };

export interface Block {
  uid: string;
  kind: BlockKind;
  target?: TargetSpec;
  seconds?: number;
  lift?: "up" | "down";
  threshold?: number;
  count?: number;
  label?: string;
  message?: string;
}

export interface TaskTemplate {
  id: string;
  name: string;
  priority: TaskPriority;
  battery_floor: number;
  allow_rebid: boolean;
  blocks: Block[];
  updated_at: number;
  last_issued: number | null;
  builtin?: boolean;
}
