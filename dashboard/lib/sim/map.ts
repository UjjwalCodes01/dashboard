import type { Cell, ChargerDef, MapMsg, StationDef } from "../types";

export interface ShelfRect {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}
export interface VAisle {
  name: string;
  x: number;
  y0: number;
  y1: number;
}
export interface HAisle {
  name: string;
  y: number;
  x0: number;
  x1: number;
}

export interface WarehouseMap {
  name: string;
  source: string;
  width: number;
  height: number;
  fullWidth: number;
  fullHeight: number;
  window: { x0: number; y0: number; w: number; h: number };
  rows: string[];
  free: Uint8Array;
  shelves: ShelfRect[];
  vAisles: VAisle[];
  hAisles: HAisle[];
  chokes: Cell[];
  chokeName: Map<number, string>;
  stations: StationDef[];
  chargers: ChargerDef[];
  parking: Cell[];
  stationByCell: Map<number, StationDef>;
  chargerByCell: Map<number, ChargerDef>;
  /** x of the first shelf column; everything left of it is the open staging strip */
  stagingRight: number;
  /** boundary of the walkable warehouse floor, as cell-space line segments [x1,y1,x2,y2] */
  outline: [number, number, number, number][];
}

export interface MapConfig {
  name: string;
  source: string;
  file: string;
  window: { x0: number; y0: number; w: number; h: number };
  stations: StationDef[];
  chargers: ChargerDef[];
  parking: Cell[];
}

/** Parse a MovingAI .map file: header (type/height/width/map) then rows; '.' free, '@'/'T' obstacle. */
export function parseMovingAI(text: string): {
  width: number;
  height: number;
  rows: string[];
} {
  const lines = text.split(/\r?\n/);
  let width = 0,
    height = 0,
    start = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith("height")) height = parseInt(l.split(/\s+/)[1], 10);
    else if (l.startsWith("width")) width = parseInt(l.split(/\s+/)[1], 10);
    else if (l === "map") {
      start = i + 1;
      break;
    }
  }
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    const raw = lines[start + y] ?? "";
    let r = "";
    for (let x = 0; x < width; x++) r += raw[x] === "." ? "." : "@";
    rows.push(r);
  }
  return { width, height, rows };
}

/** Build the wire-format map message (what a backend would send) from the file + config. */
export function buildMapMsg(text: string, cfg: MapConfig): MapMsg {
  const parsed = parseMovingAI(text);
  const { x0, y0, w, h } = cfg.window;
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    const src = parsed.rows[y0 + y] ?? "";
    rows.push((src.slice(x0, x0 + w) + "@".repeat(w)).slice(0, w));
  }
  return {
    type: "map",
    name: cfg.name,
    source: cfg.source,
    full_width: parsed.width,
    full_height: parsed.height,
    window: cfg.window,
    rows,
    stations: cfg.stations,
    chargers: cfg.chargers,
    parking: cfg.parking,
  };
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Analyse a map message into render/pathing structures (shelf rects, aisles, chokes, labels). */
export function analyseMap(msg: MapMsg): WarehouseMap {
  const w = msg.window.w;
  const h = msg.window.h;
  const free = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) free[y * w + x] = msg.rows[y][x] === "." ? 1 : 0;
  const isFree = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && free[y * w + x] === 1;

  // --- merge obstacle cells into rectangles (greedy: extend right, then down) ---
  const seen = new Uint8Array(w * h);
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (free[i] || seen[i]) continue;
      let rw = 1;
      while (x + rw < w && !free[i + rw] && !seen[i + rw]) rw++;
      let rh = 1;
      outer: while (y + rh < h) {
        for (let k = 0; k < rw; k++) {
          const j = (y + rh) * w + x + k;
          if (free[j] || seen[j]) break outer;
        }
        rh++;
      }
      for (let yy = 0; yy < rh; yy++)
        for (let xx = 0; xx < rw; xx++) seen[(y + yy) * w + x + xx] = 1;
      rects.push({ x, y, w: rw, h: rh });
    }
  }
  // shelves = interior rectangles (not touching the window edge as a wall band)
  const shelfRects = rects.filter(
    (r) => !(r.w >= w || r.h >= h) && !(r.y === 0 && r.h === 1 && r.w > 4),
  );
  const colXs = Array.from(new Set(shelfRects.map((r) => r.x))).sort((a, b) => a - b);
  const rowYs = Array.from(new Set(shelfRects.map((r) => r.y))).sort((a, b) => a - b);
  // ForwardX-style three-letter rack codes: zone B + column letter + row letter (BAB, BCD, BKB…)
  const shelves: ShelfRect[] = shelfRects.map((r) => {
    const c = colXs.indexOf(r.x);
    const rw = rowYs.indexOf(r.y);
    return { ...r, label: `B${LETTERS[c % 26]}${LETTERS[rw % 26]}` };
  });
  const stagingRight = colXs.length ? colXs[0] : w;

  // --- warehouse outline: the border between the enclosed floor and the outside ---
  // Everything reachable from the window edge through obstacle cells is "outside"; the rest
  // (free floor plus the shelves it encloses) is the warehouse. Draw the edges between them.
  const exterior = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (free[i] || exterior[i]) return;
    exterior[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    seed(0, y);
    seed(w - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i - x) / w;
    seed(x - 1, y);
    seed(x + 1, y);
    seed(x, y - 1);
    seed(x, y + 1);
  }
  const isOutside = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h || exterior[y * w + x] === 1;
  const outline: [number, number, number, number][] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (exterior[y * w + x]) continue;
      if (isOutside(x, y - 1)) outline.push([x, y, x + 1, y]);
      if (isOutside(x, y + 1)) outline.push([x, y + 1, x + 1, y + 1]);
      if (isOutside(x - 1, y)) outline.push([x, y, x, y + 1]);
      if (isOutside(x + 1, y)) outline.push([x + 1, y, x + 1, y + 1]);
    }

  // --- aisles: one-lane corridors bounded by obstacles on both sides ---
  const vAisles: VAisle[] = [];
  for (let x = 0; x < w; x++) {
    let count = 0,
      y0 = -1,
      y1 = -1;
    for (let y = 0; y < h; y++) {
      if (isFree(x, y) && !isFree(x - 1, y) && !isFree(x + 1, y)) {
        count++;
        if (y0 < 0) y0 = y;
        y1 = y;
      }
    }
    if (count > h / 4) {
      // extend to the full free extent of the column
      while (y0 > 0 && isFree(x, y0 - 1)) y0--;
      while (y1 < h - 1 && isFree(x, y1 + 1)) y1++;
      vAisles.push({ name: LETTERS[vAisles.length % 26], x, y0, y1 });
    }
  }
  const hAisles: HAisle[] = [];
  for (let y = 0; y < h; y++) {
    let count = 0,
      x0 = -1,
      x1 = -1;
    for (let x = 0; x < w; x++) {
      if (isFree(x, y) && !isFree(x, y - 1) && !isFree(x, y + 1)) {
        count++;
        if (x0 < 0) x0 = x;
        x1 = x;
      }
    }
    if (count > w / 4) {
      while (x0 > 0 && isFree(x0 - 1, y)) x0--;
      while (x1 < w - 1 && isFree(x1 + 1, y)) x1++;
      hAisles.push({ name: String(hAisles.length + 1), y, x0, x1 });
    }
  }

  // --- chokes: one-lane intersections ---
  const chokes: Cell[] = [];
  const chokeName = new Map<number, string>();
  for (const v of vAisles)
    for (const hh of hAisles)
      if (isFree(v.x, hh.y) && v.x >= stagingRight) {
        chokes.push([v.x, hh.y]);
        chokeName.set(hh.y * w + v.x, `${v.name}${hh.name}`);
      }

  const stationByCell = new Map<number, StationDef>();
  for (const s of msg.stations) stationByCell.set(s.cell[1] * w + s.cell[0], s);
  const chargerByCell = new Map<number, ChargerDef>();
  for (const c of msg.chargers) chargerByCell.set(c.cell[1] * w + c.cell[0], c);

  return {
    name: msg.name,
    source: msg.source,
    width: w,
    height: h,
    fullWidth: msg.full_width,
    fullHeight: msg.full_height,
    window: msg.window,
    rows: msg.rows,
    free,
    shelves,
    vAisles,
    hAisles,
    chokes,
    chokeName,
    stations: msg.stations,
    chargers: msg.chargers,
    parking: msg.parking,
    stationByCell,
    chargerByCell,
    stagingRight,
    outline,
  };
}

export const cellIdx = (m: WarehouseMap, x: number, y: number) => y * m.width + x;

export function isFreeCell(m: WarehouseMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < m.width && y < m.height && m.free[y * m.width + x] === 1;
}

export function neighbours4(m: WarehouseMap, x: number, y: number): Cell[] {
  const out: Cell[] = [];
  if (isFreeCell(m, x + 1, y)) out.push([x + 1, y]);
  if (isFreeCell(m, x - 1, y)) out.push([x - 1, y]);
  if (isFreeCell(m, x, y + 1)) out.push([x, y + 1]);
  if (isFreeCell(m, x, y - 1)) out.push([x, y - 1]);
  return out;
}

/** Human label for a cell: "choke B4", "aisle 4 (A–B)", "aisle B (4–5)", "staging", "P2". */
export function cellLabel(m: WarehouseMap, x: number, y: number): string {
  const i = y * m.width + x;
  const st = m.stationByCell.get(i);
  if (st) return st.id;
  const ch = m.chargerByCell.get(i);
  if (ch) return ch.id;
  const ck = m.chokeName.get(i);
  if (ck) return `choke ${ck}`;
  if (x < m.stagingRight) return "staging";
  const v = m.vAisles.find((a) => a.x === x);
  if (v) {
    const above = [...m.hAisles].reverse().find((a) => a.y < y);
    const below = m.hAisles.find((a) => a.y > y);
    return `aisle ${v.name} (${above?.name ?? "top"}–${below?.name ?? "end"})`;
  }
  const hh = m.hAisles.find((a) => a.y === y);
  if (hh) {
    const left = [...m.vAisles].reverse().find((a) => a.x < x);
    const right = m.vAisles.find((a) => a.x > x);
    return `aisle ${hh.name} (${left?.name ?? "staging"}–${right?.name ?? "end"})`;
  }
  return `cell (${x},${y})`;
}

/** Short aisle name only ("B4", "aisle 7", "staging") for compact UI. */
export function shortLabel(m: WarehouseMap, x: number, y: number): string {
  const i = y * m.width + x;
  const st = m.stationByCell.get(i);
  if (st) return st.id;
  const ck = m.chokeName.get(i);
  if (ck) return ck;
  if (x < m.stagingRight) return "staging";
  const v = m.vAisles.find((a) => a.x === x);
  if (v) return `aisle ${v.name}`;
  const hh = m.hAisles.find((a) => a.y === y);
  if (hh) return `aisle ${hh.name}`;
  return `(${x},${y})`;
}

/** Pose formatting helper: window cell → "A-231-324"-style location code. */
export function locationCode(m: WarehouseMap, x: number, y: number): string {
  const v = [...m.vAisles].reverse().find((a) => a.x <= x);
  const hh = [...m.hAisles].reverse().find((a) => a.y <= y);
  return `${v?.name ?? "S"}-${String(hh?.name ?? "0").padStart(2, "0")}-${String(x).padStart(2, "0")}${String(y).padStart(2, "0")}`;
}
