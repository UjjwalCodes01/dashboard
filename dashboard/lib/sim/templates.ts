import type { Block, BlockKind, TargetSpec, TaskTemplate } from "../types";

export type BlockFamily = "navigation" | "handling" | "control";

export interface BlockDef {
  kind: BlockKind;
  label: string;
  family: BlockFamily;
  description: string;
  defaults: Partial<Block>;
}

export const BLOCK_DEFS: BlockDef[] = [
  {
    kind: "navigate",
    label: "Navigate",
    family: "navigation",
    description: "Drive to a station or cell. The robot plans its own route on-board.",
    defaults: { target: { kind: "any_pickup" } },
  },
  {
    kind: "pickup",
    label: "Pickup",
    family: "handling",
    description: "Load at the current station (lift up, dwell).",
    defaults: { seconds: 2.5 },
  },
  {
    kind: "drop",
    label: "Drop",
    family: "handling",
    description: "Unload at the current station (lift down, dwell).",
    defaults: { seconds: 2 },
  },
  {
    kind: "rack",
    label: "Rack",
    family: "handling",
    description: "Engage a rack / shelf face by label.",
    defaults: { label: "B04", seconds: 1.5 },
  },
  {
    kind: "lift",
    label: "Lift",
    family: "handling",
    description: "Raise or lower the lift.",
    defaults: { lift: "up", seconds: 1 },
  },
  {
    kind: "confirm",
    label: "Confirm",
    family: "handling",
    description: "Wait for an on-robot confirmation (button / scan).",
    defaults: { message: "Scan tote", seconds: 1.5 },
  },
  {
    kind: "wait",
    label: "Wait",
    family: "control",
    description: "Hold position for N seconds.",
    defaults: { seconds: 5 },
  },
  {
    kind: "charge_if",
    label: "Charge if",
    family: "control",
    description: "Divert to a free charger if battery is below the threshold.",
    defaults: { threshold: 20 },
  },
  {
    kind: "repeat",
    label: "Repeat",
    family: "control",
    description: "Repeat all blocks above this one N more times.",
    defaults: { count: 1 },
  },
  {
    kind: "sleep",
    label: "Sleep",
    family: "control",
    description: "Low-power hold (no motion, keeps broadcasting).",
    defaults: { seconds: 10 },
  },
];

export const BLOCK_DEF_MAP: Record<BlockKind, BlockDef> = Object.fromEntries(
  BLOCK_DEFS.map((d) => [d.kind, d]),
) as Record<BlockKind, BlockDef>;

export const FAMILY_STYLE: Record<
  BlockFamily,
  { bg: string; border: string; text: string; name: string }
> = {
  navigation: { bg: "#FDF2F8", border: "#F472B6", text: "#9D174D", name: "Navigation" },
  handling: { bg: "#F0FDF4", border: "#4ADE80", text: "#166534", name: "Handling" },
  control: { bg: "#FEFCE8", border: "#FACC15", text: "#854D0E", name: "Control" },
};

let uidCounter = 0;
export function newUid(): string {
  uidCounter += 1;
  return `b${Date.now().toString(36)}${uidCounter.toString(36)}`;
}

export function makeBlock(kind: BlockKind, overrides: Partial<Block> = {}): Block {
  const def = BLOCK_DEF_MAP[kind];
  return { uid: newUid(), kind, ...structuredCloneSafe(def.defaults), ...overrides };
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export function describeTarget(t?: TargetSpec): string {
  if (!t) return "—";
  switch (t.kind) {
    case "station":
      return t.id;
    case "any_pickup":
      return "nearest pickup";
    case "any_drop":
      return "nearest drop";
    case "cell":
      return `(${t.x},${t.y})`;
  }
}

export function describeBlock(b: Block): string {
  switch (b.kind) {
    case "navigate":
      return `Navigate → ${describeTarget(b.target)}`;
    case "pickup":
      return `Pickup (${b.seconds ?? 2.5}s)`;
    case "drop":
      return `Drop (${b.seconds ?? 2}s)`;
    case "rack":
      return `Rack ${b.label ?? ""}`.trim();
    case "lift":
      return `Lift ${b.lift ?? "up"}`;
    case "confirm":
      return `Confirm: ${b.message ?? ""}`.trim();
    case "wait":
      return `Wait ${b.seconds ?? 5}s`;
    case "charge_if":
      return `Charge if < ${b.threshold ?? 20}%`;
    case "repeat":
      return `Repeat ×${b.count ?? 1}`;
    case "sleep":
      return `Sleep ${b.seconds ?? 10}s`;
  }
}

/** Expand "repeat" blocks: each repeats every block above it N more times. */
export function expandBlocks(blocks: Block[]): Block[] {
  let out: Block[] = [];
  for (const b of blocks) {
    if (b.kind === "repeat") {
      const n = Math.max(0, Math.min(10, Math.floor(b.count ?? 1)));
      const chunk = out.slice();
      for (let i = 0; i < n; i++) out = out.concat(chunk);
    } else out.push(b);
  }
  return out;
}

export function templateSummary(t: TaskTemplate): string {
  return t.blocks.map(describeBlock).join(" · ");
}

export function defaultTemplates(): TaskTemplate[] {
  const now = 0;
  return [
    {
      id: "pick-drop",
      name: "Pick & Drop",
      priority: "normal",
      battery_floor: 20,
      allow_rebid: true,
      builtin: true,
      updated_at: now,
      last_issued: null,
      blocks: [
        makeBlock("navigate", { target: { kind: "any_pickup" } }),
        makeBlock("pickup"),
        makeBlock("navigate", { target: { kind: "any_drop" } }),
        makeBlock("drop"),
      ],
    },
    {
      id: "urgent-pick",
      name: "Urgent Pick",
      priority: "urgent",
      battery_floor: 15,
      allow_rebid: true,
      builtin: true,
      updated_at: now,
      last_issued: null,
      blocks: [
        makeBlock("navigate", { target: { kind: "any_pickup" } }),
        makeBlock("confirm", { message: "Scan tote", seconds: 1 }),
        makeBlock("pickup", { seconds: 2 }),
        makeBlock("navigate", { target: { kind: "station", id: "D1" } }),
        makeBlock("drop", { seconds: 1.5 }),
      ],
    },
    {
      id: "replenish",
      name: "Replenish Rack",
      priority: "normal",
      battery_floor: 25,
      allow_rebid: true,
      builtin: true,
      updated_at: now,
      last_issued: null,
      blocks: [
        makeBlock("navigate", { target: { kind: "any_drop" } }),
        makeBlock("pickup", { seconds: 2 }),
        makeBlock("navigate", { target: { kind: "any_pickup" } }),
        makeBlock("rack", { label: "shelf face", seconds: 1.5 }),
        makeBlock("drop", { seconds: 2 }),
        makeBlock("charge_if", { threshold: 25 }),
      ],
    },
    {
      id: "milk-run",
      name: "Milk Run ×2",
      priority: "normal",
      battery_floor: 30,
      allow_rebid: false,
      builtin: true,
      updated_at: now,
      last_issued: null,
      blocks: [
        makeBlock("navigate", { target: { kind: "any_pickup" } }),
        makeBlock("pickup"),
        makeBlock("navigate", { target: { kind: "any_drop" } }),
        makeBlock("drop"),
        makeBlock("wait", { seconds: 3 }),
        makeBlock("repeat", { count: 1 }),
      ],
    },
  ];
}

export const TEMPLATE_STORAGE_KEY = "amr-fleet.templates.v1";

export function loadTemplates(): TaskTemplate[] {
  const defaults = defaultTemplates();
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as TaskTemplate[];
    if (!Array.isArray(parsed) || !parsed.length) return defaults;
    // keep builtins present even if the user deleted them from storage
    const ids = new Set(parsed.map((t) => t.id));
    return [...parsed, ...defaults.filter((d) => !ids.has(d.id))];
  } catch {
    return defaults;
  }
}

export function saveTemplates(list: TaskTemplate[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}
