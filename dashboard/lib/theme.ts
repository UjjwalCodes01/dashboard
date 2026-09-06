import type { RobotState, TaskPhase } from "./types";

export const STATE_COLORS: Record<RobotState, string> = {
  idle: "#FACC15",
  working: "#3B82F6",
  charging: "#22C55E",
  yielding: "#A78BFA",
  blocked: "#F59E0B",
  degraded: "#FB923C",
  offline: "#EF4444",
};

export const STATE_LABELS: Record<RobotState, string> = {
  idle: "Idle",
  working: "In task",
  charging: "Charging",
  yielding: "Yielding",
  blocked: "Blocked",
  degraded: "Degraded",
  offline: "Offline",
};

export const STATE_ORDER: RobotState[] = [
  "working",
  "charging",
  "idle",
  "yielding",
  "blocked",
  "degraded",
  "offline",
];

/** severity for sorting tables: worst first */
export const STATE_SEVERITY: Record<RobotState, number> = {
  offline: 0,
  degraded: 1,
  blocked: 2,
  yielding: 3,
  charging: 4,
  working: 5,
  idle: 6,
};

export const PHASE_COLORS: Record<TaskPhase, string> = {
  announced: "#94A3B8",
  bidding: "#22D3EE",
  assigned: "#3B82F6",
  in_progress: "#3B82F6",
  done: "#22C55E",
  rebid: "#F59E0B",
};

export const PHASE_LABELS: Record<TaskPhase, string> = {
  announced: "Announced",
  bidding: "Bids in",
  assigned: "Self-assigned",
  in_progress: "In progress",
  done: "Done",
  rebid: "Re-bid",
};

export const COLORS = {
  bg: "#0B1220",
  panel: "#111A2E",
  panelBorder: "#1E2A45",
  grid: "#1C2740",
  shelf: "#2A3550",
  shelfEdge: "#3B4A6B",
  lane: "#2ED37A",
  accent: "#22D3EE",
  text: "#E5E7EB",
  text2: "#94A3B8",
  pickup: "#3B82F6",
  drop: "#A855F7",
  charger: "#22D3EE",
  parking: "#64748B",
  danger: "#EF4444",
};

export const TILE_COLORS = {
  urgent: { bg: "#B91C1C", strip: "#EF4444" },
  inProgress: { bg: "#1D4ED8", strip: "#3B82F6" },
  unassigned: { bg: "#B45309", strip: "#F59E0B" },
  completed: { bg: "#15803D", strip: "#22C55E" },
  rebid: { bg: "#0F766E", strip: "#14B8A6" },
  total: { bg: "#374151", strip: "#9CA3AF" },
};

export function batteryColor(pct: number): string {
  if (pct <= 20) return "#EF4444";
  if (pct <= 40) return "#F59E0B";
  return "#22C55E";
}
