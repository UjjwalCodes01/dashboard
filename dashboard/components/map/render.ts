import type { Cell, RobotState, RobotStateMsg } from "@/lib/types";
import type { WarehouseMap } from "@/lib/sim/map";
import { COLORS, STATE_COLORS, batteryColor } from "@/lib/theme";

export interface Viewport {
  /** pixels per cell */
  cs: number;
  /** screen offset of world origin (cell 0,0 top-left), in CSS px */
  ox: number;
  oy: number;
  width: number;
  height: number;
}

export interface StaticOptions {
  grid: boolean;
  labels: boolean;
  lanes: boolean;
  chokes: boolean;
  compact: boolean;
  monoFont: string;
  sansFont: string;
}

export const toScreen = (vp: Viewport, x: number, y: number): [number, number] => [
  vp.ox + x * vp.cs,
  vp.oy + y * vp.cs,
];
export const toWorld = (vp: Viewport, sx: number, sy: number): [number, number] => [
  (sx - vp.ox) / vp.cs,
  (sy - vp.oy) / vp.cs,
];

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  // At phone cell sizes an inset like `cs - 4` can go negative; arcTo throws on a negative radius
  // in browsers (node-canvas does not), which would abort the whole frame. Clamp instead.
  if (w <= 0 || h <= 0) {
    ctx.beginPath();
    ctx.rect(x, y, Math.max(0, w), Math.max(0, h));
    return;
  }
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

export function drawStatic(
  ctx: CanvasRenderingContext2D,
  map: WarehouseMap,
  vp: Viewport,
  o: StaticOptions,
) {
  const { cs } = vp;
  ctx.clearRect(0, 0, vp.width, vp.height);
  const [mx, my] = toScreen(vp, 0, 0);
  const mw = map.width * cs;
  const mh = map.height * cs;

  // floor
  const grad = ctx.createLinearGradient(mx, my, mx, my + mh);
  grad.addColorStop(0, "rgba(14, 22, 42, 0.92)");
  grad.addColorStop(1, "rgba(10, 17, 32, 0.92)");
  ctx.fillStyle = grad;
  ctx.fillRect(mx, my, mw, mh);

  // staging strip tint
  const [sx0] = toScreen(vp, 0, 0);
  ctx.fillStyle = "rgba(34, 211, 238, 0.035)";
  ctx.fillRect(sx0, my, map.stagingRight * cs, mh);

  // ambient hall lighting — soft pools over the floor, as in the reference floor plan
  ctx.save();
  ctx.beginPath();
  ctx.rect(mx, my, mw, mh);
  ctx.clip();
  for (const [fx, fy, fr, col] of [
    [0.18, 0.3, 0.42, "rgba(56, 189, 248, 0.075)"],
    [0.12, 0.72, 0.34, "rgba(34, 211, 238, 0.055)"],
    [0.62, 0.18, 0.36, "rgba(59, 130, 246, 0.045)"],
    [0.85, 0.75, 0.32, "rgba(34, 211, 238, 0.04)"],
  ] as [number, number, number, string][]) {
    const cxp = mx + mw * fx;
    const cyp = my + mh * fy;
    const rad = Math.max(mw, mh) * fr;
    const g = ctx.createRadialGradient(cxp, cyp, 0, cxp, cyp, rad);
    g.addColorStop(0, col);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(mx, my, mw, mh);
  }
  ctx.restore();

  // grid
  if (o.grid && cs >= 7) {
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.globalAlpha = cs < 10 ? 0.45 : 0.75;
    ctx.beginPath();
    for (let x = 0; x <= map.width; x++) {
      const px = Math.round(mx + x * cs) + 0.5;
      ctx.moveTo(px, my);
      ctx.lineTo(px, my + mh);
    }
    for (let y = 0; y <= map.height; y++) {
      const py = Math.round(my + y * cs) + 0.5;
      ctx.moveTo(mx, py);
      ctx.lineTo(mx + mw, py);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // wall row(s): any obstacle cell not part of a shelf rect
  const shelfCells = new Set<number>();
  for (const s of map.shelves)
    for (let yy = 0; yy < s.h; yy++)
      for (let xx = 0; xx < s.w; xx++) shelfCells.add((s.y + yy) * map.width + s.x + xx);
  ctx.fillStyle = "#131c31";
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      if (map.free[i] || shelfCells.has(i)) continue;
      const [px, py] = toScreen(vp, x, y);
      ctx.fillRect(px, py, cs + 0.5, cs + 0.5);
    }

  // lanes
  if (o.lanes) {
    ctx.strokeStyle = COLORS.lane;
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = Math.max(1, cs * 0.09);
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const v of map.vAisles) {
      const [px, py0] = toScreen(vp, v.x + 0.5, v.y0 + 0.5);
      const [, py1] = toScreen(vp, v.x + 0.5, v.y1 + 0.5);
      ctx.moveTo(px, py0);
      ctx.lineTo(px, py1);
    }
    for (const h of map.hAisles) {
      const [px0, py] = toScreen(vp, h.x0 + 0.5, h.y + 0.5);
      const [px1] = toScreen(vp, h.x1 + 0.5, h.y + 0.5);
      ctx.moveTo(px0, py);
      ctx.lineTo(px1, py);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    // small lane nodes at intersections
    if (cs >= 8) {
      ctx.fillStyle = COLORS.lane;
      ctx.globalAlpha = 0.35;
      for (const c of map.chokes) {
        const [px, py] = toScreen(vp, c[0] + 0.5, c[1] + 0.5);
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1.5, cs * 0.12), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  // shelves — drawn as racking seen from above: a stack of horizontal beams per block
  for (const s of map.shelves) {
    const [px, py] = toScreen(vp, s.x, s.y);
    const w = s.w * cs;
    const h = s.h * cs;
    // block shadow so the racks lift off the floor
    ctx.fillStyle = "rgba(4, 8, 18, 0.5)";
    rr(ctx, px + 1.5, py + 2, w - 3, h - 2, Math.min(3, cs * 0.25));
    ctx.fill();

    const beams = Math.max(2, Math.min(6, Math.round(h / 5)));
    const gap = h > 14 ? 1.5 : 1;
    const beamH = (h - 2 - gap * (beams - 1)) / beams;
    for (let k = 0; k < beams; k++) {
      const by = py + 1 + k * (beamH + gap);
      const g = ctx.createLinearGradient(px, by, px, by + beamH);
      g.addColorStop(0, "#3b4870");
      g.addColorStop(0.45, "#2d3959");
      g.addColorStop(1, "#222d4b");
      ctx.fillStyle = g;
      rr(ctx, px + 1.5, by, w - 3, Math.max(1.2, beamH), Math.min(2, beamH * 0.4));
      ctx.fill();
      // lit top edge
      if (beamH >= 3) {
        ctx.fillStyle = "rgba(148, 176, 224, 0.22)";
        ctx.fillRect(px + 2.5, by, w - 5, 1);
      }
    }
    // pallet divisions across the beams
    if (cs >= 8) {
      ctx.strokeStyle = "rgba(11, 18, 32, 0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 1; k < s.w; k++) {
        const tx = Math.round(px + k * cs) + 0.5;
        ctx.moveTo(tx, py + 1);
        ctx.lineTo(tx, py + h - 1);
      }
      ctx.stroke();
    }
    // upright frame
    ctx.strokeStyle = "rgba(96, 122, 176, 0.4)";
    ctx.lineWidth = 1;
    rr(ctx, px + 1.5, py + 1, w - 3, h - 2, Math.min(3, cs * 0.25));
    ctx.stroke();

    if (o.labels && cs >= (o.compact ? 6 : 5)) {
      const fs = Math.max(9, Math.min(o.compact ? 15 : 19, h * 0.82, (w / Math.max(3, s.label.length)) * 1.15));
      ctx.font = `600 ${fs}px ${o.sansFont}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const tx = px + w / 2;
      const ty = py + h / 2 + 0.5;
      // knock the racking back behind the code so it stays legible
      ctx.fillStyle = "rgba(13, 21, 40, 0.72)";
      const tw = ctx.measureText(s.label).width;
      rr(ctx, tx - tw / 2 - 3, ty - fs * 0.6, tw + 6, fs * 1.2, 2);
      ctx.fill();
      ctx.fillStyle = "rgba(203, 216, 240, 0.9)";
      ctx.fillText(s.label, tx, ty);
    }
  }

  // aisle labels: letters in the top wall row, numbers just outside the left edge
  if (o.labels && cs >= 6) {
    const fs = Math.max(9, Math.min(13, cs * 0.85));
    ctx.font = `700 ${fs}px ${o.monoFont}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(34, 211, 238, 0.85)";
    for (const v of map.vAisles) {
      const [px, py] = toScreen(vp, v.x + 0.5, 0.5);
      ctx.fillText(v.name, px, py);
    }
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(148, 163, 184, 0.8)";
    for (const h of map.hAisles) {
      const [px, py] = toScreen(vp, 0, h.y + 0.5);
      ctx.fillText(h.name, px - 4, py);
    }
  }

  // chokes
  if (o.chokes) {
    ctx.strokeStyle = "rgba(34, 211, 238, 0.28)";
    ctx.lineWidth = 1;
    for (const c of map.chokes) {
      const [px, py] = toScreen(vp, c[0] + 0.5, c[1] + 0.5);
      ctx.beginPath();
      ctx.arc(px, py, cs * 0.46, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // stations / chargers / parking
  const fsS = Math.max(7, Math.min(11, cs * 0.6));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const p of map.parking) {
    const [px, py] = toScreen(vp, p[0], p[1]);
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
    ctx.lineWidth = 1;
    rr(ctx, px + 2, py + 2, cs - 4, cs - 4, 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (cs >= 10) {
      ctx.font = `600 ${fsS}px ${o.sansFont}`;
      ctx.fillStyle = "rgba(148, 163, 184, 0.6)";
      ctx.fillText("P", px + cs / 2, py + cs / 2 + 0.5);
    }
  }
  for (const s of map.stations) {
    const [px, py] = toScreen(vp, s.cell[0], s.cell[1]);
    const c = s.type === "pickup" ? COLORS.pickup : COLORS.drop;
    ctx.fillStyle = `${c}33`;
    ctx.strokeStyle = c;
    ctx.lineWidth = 1.5;
    rr(ctx, px + 1.5, py + 1.5, cs - 3, cs - 3, 3);
    ctx.fill();
    ctx.stroke();
    if (cs >= 9) {
      ctx.font = `700 ${fsS}px ${o.monoFont}`;
      ctx.fillStyle = "#fff";
      ctx.fillText(s.id, px + cs / 2, py + cs / 2 + 0.5);
    }
  }
  // charging bays: empty slots here, live state drawn on the dynamic layer
  for (const ch of map.chargers) {
    const [px, py] = toScreen(vp, ch.cell[0], ch.cell[1]);
    ctx.fillStyle = "rgba(15, 23, 42, 0.65)";
    ctx.strokeStyle = "rgba(100, 116, 139, 0.7)";
    ctx.lineWidth = 1.2;
    rr(ctx, px + 1.5, py + 1.5, cs - 3, cs - 3, 2);
    ctx.fill();
    ctx.stroke();
  }
  // (no caption here — the map header legend names the charging bays)

  // warehouse outline — the border of the enclosed floor
  if (map.outline.length) {
    ctx.strokeStyle = "rgba(148, 178, 224, 0.75)";
    ctx.lineWidth = 1.5;
    ctx.lineCap = "square";
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of map.outline) {
      const [ax, ay] = toScreen(vp, x1, y1);
      const [bx, by] = toScreen(vp, x2, y2);
      ctx.moveTo(Math.round(ax) + 0.5, Math.round(ay) + 0.5);
      ctx.lineTo(Math.round(bx) + 0.5, Math.round(by) + 0.5);
    }
    ctx.stroke();
  }
}

export interface RobotVisual {
  id: string;
  x: number; // interpolated cell coords (centre = +0.5)
  y: number;
  heading: number;
  state: RobotState;
  battery: number;
  msg: RobotStateMsg;
}

export interface DynamicOptions {
  trails: boolean;
  comms: boolean;
  links: boolean;
  compact: boolean;
  selectedId: string | null;
  hoverId: string | null;
  blocked: Cell[];
  pulses: { cell: Cell; age: number }[];
  nowMs: number;
  monoFont: string;
  sansFont: string;
  commsRange: number;
  destinations: Map<string, Cell>;
  partitions?: string[][];
}

function hatch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = "rgba(239, 68, 68, 0.85)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const step = 4;
  for (let d = -h; d < w; d += step) {
    ctx.moveTo(x + d, y + h);
    ctx.lineTo(x + d + h, y);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawDynamic(
  ctx: CanvasRenderingContext2D,
  map: WarehouseMap,
  vp: Viewport,
  robots: RobotVisual[],
  o: DynamicOptions,
) {
  const { cs } = vp;
  ctx.clearRect(0, 0, vp.width, vp.height);

  // charging bays: live state (green charging · amber reserved · grey idle)
  for (const ch of map.chargers) {
    const [px, py] = toScreen(vp, ch.cell[0], ch.cell[1]);
    const docked = robots.find(
      (r) => r.state === "charging" && r.msg.cell[0] === ch.cell[0] && r.msg.cell[1] === ch.cell[1],
    );
    const inbound = docked ? undefined : robots.find((r) => r.msg.destination === ch.id);
    const col = docked ? "#22C55E" : inbound ? "#F59E0B" : null;
    if (!col) continue;
    ctx.fillStyle = `${col}2e`;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    rr(ctx, px + 1.5, py + 1.5, cs - 3, cs - 3, 2);
    ctx.fill();
    ctx.stroke();
    if (docked) {
      // charge level as a fill rising inside the bay
      const f = Math.max(0, Math.min(1, docked.battery / 100));
      const ih = (cs - 5) * f;
      ctx.fillStyle = "rgba(34, 197, 94, 0.55)";
      ctx.fillRect(px + 2.5, py + cs - 2.5 - ih, cs - 5, ih);
    }
  }

  // blocked cells
  for (const c of o.blocked) {
    const [px, py] = toScreen(vp, c[0], c[1]);
    ctx.fillStyle = "rgba(239, 68, 68, 0.22)";
    ctx.fillRect(px + 1, py + 1, cs - 2, cs - 2);
    hatch(ctx, px + 1, py + 1, cs - 2, cs - 2);
    ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 1, py + 1, cs - 2, cs - 2);
  }

  // conflict pulses at chokes / cells
  for (const p of o.pulses) {
    const t = Math.min(1, p.age / 2200);
    const [px, py] = toScreen(vp, p.cell[0] + 0.5, p.cell[1] + 0.5);
    ctx.strokeStyle = `rgba(167, 139, 250, ${(1 - t) * 0.8})`;
    ctx.lineWidth = 2 - t;
    ctx.beginPath();
    ctx.arc(px, py, cs * (0.5 + t * 1.6), 0, Math.PI * 2);
    ctx.stroke();
  }

  const byId = new Map(robots.map((r) => [r.id, r]));
  const sel = o.selectedId ? byId.get(o.selectedId) : null;

  // comms range + links of the selected robot
  if (sel && o.comms) {
    const [px, py] = toScreen(vp, sel.x + 0.5, sel.y + 0.5);
    ctx.beginPath();
    ctx.arc(px, py, o.commsRange * cs, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(34, 211, 238, 0.05)";
    ctx.fill();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(34, 211, 238, 0.45)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = `500 10px ${o.sansFont}`;
    ctx.fillStyle = "rgba(34, 211, 238, 0.7)";
    ctx.textAlign = "center";
    ctx.fillText(`comms range ${o.commsRange} m`, px, py - o.commsRange * cs - 6);
  }

  // peer links
  if (o.links || (sel && o.comms)) {
    ctx.lineWidth = 1;
    const drawn = new Set<string>();
    for (const r of robots) {
      if (!o.links && r !== sel) continue;
      for (const nid of r.msg.neighbours) {
        const n = byId.get(nid);
        if (!n) continue;
        const key = r.id < nid ? `${r.id}|${nid}` : `${nid}|${r.id}`;
        if (drawn.has(key)) continue;
        drawn.add(key);
        const [ax, ay] = toScreen(vp, r.x + 0.5, r.y + 0.5);
        const [bx, by] = toScreen(vp, n.x + 0.5, n.y + 0.5);
        const strong = sel && (r === sel || n === sel);
        ctx.strokeStyle = strong ? "rgba(34, 211, 238, 0.75)" : "rgba(34, 211, 238, 0.14)";
        ctx.lineWidth = strong ? 1.4 : 1;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        if (strong) {
          // little "ack" dot travelling along the link
          const ph = ((o.nowMs / 900) + r.id.length) % 1;
          ctx.fillStyle = "#67e8f9";
          ctx.beginPath();
          ctx.arc(ax + (bx - ax) * ph, ay + (by - ay) * ph, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // intent trails
  if (o.trails) {
    for (const r of robots) {
      const intent = r.msg.intent;
      if (!intent.length || r.state === "offline") continue;
      const color = STATE_COLORS[r.state];
      const degraded = !r.msg.link_ok;
      ctx.setLineDash(degraded ? [3, 4] : [Math.max(2.5, cs * 0.2), Math.max(2.5, cs * 0.18)]);
      ctx.lineCap = "butt";
      ctx.lineWidth = Math.max(1.8, cs * 0.14);
      let [px, py] = toScreen(vp, r.x + 0.5, r.y + 0.5);
      for (let i = 0; i < intent.length; i++) {
        const [nx, ny] = toScreen(vp, intent[i][0] + 0.5, intent[i][1] + 0.5);
        const a = 0.95 - (i / (intent.length + 1)) * 0.5;
        ctx.strokeStyle = hexA(color, a);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        px = nx;
        py = ny;
      }
      ctx.setLineDash([]);
      // claimed-cell squares
      for (let i = 0; i < intent.length; i++) {
        const [cx, cy] = toScreen(vp, intent[i][0], intent[i][1]);
        ctx.fillStyle = hexA(color, 0.16 * (1 - i / (intent.length + 2)));
        ctx.fillRect(cx + 1, cy + 1, cs - 2, cs - 2);
      }
      // arrow head at the end
      if (intent.length && cs >= 8) {
        const last = intent[intent.length - 1];
        const prev = intent.length > 1 ? intent[intent.length - 2] : [r.x, r.y];
        const [lx, ly] = toScreen(vp, last[0] + 0.5, last[1] + 0.5);
        const ang = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
        ctx.fillStyle = hexA(color, 0.7);
        ctx.beginPath();
        ctx.moveTo(lx + Math.cos(ang) * cs * 0.28, ly + Math.sin(ang) * cs * 0.28);
        ctx.lineTo(lx + Math.cos(ang + 2.5) * cs * 0.22, ly + Math.sin(ang + 2.5) * cs * 0.22);
        ctx.lineTo(lx + Math.cos(ang - 2.5) * cs * 0.22, ly + Math.sin(ang - 2.5) * cs * 0.22);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // destination marker of the selected robot
  if (sel) {
    const d = o.destinations.get(sel.id);
    if (d) {
      const [px, py] = toScreen(vp, d[0] + 0.5, d[1] + 0.5);
      const ph = (o.nowMs / 1200) % 1;
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * (1 - ph)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, cs * (0.35 + ph * 0.5), 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.arc(px, py, cs * 0.3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // robots
  const size = Math.max(11, cs * 0.9);
  const fsId = o.compact ? Math.max(8, Math.min(10, cs * 0.6)) : Math.max(9, Math.min(11, cs * 0.62));
  for (const r of robots) {
    const [px, py] = toScreen(vp, r.x + 0.5, r.y + 0.5);
    const color = STATE_COLORS[r.state];
    const isSel = r.id === o.selectedId;
    const isHover = r.id === o.hoverId;

    // glow / selection
    if (isSel || isHover) {
      ctx.beginPath();
      ctx.arc(px, py, size * 0.95, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.06)";
      ctx.fill();
      ctx.strokeStyle = isSel ? "#ffffff" : "rgba(255,255,255,0.6)";
      ctx.lineWidth = isSel ? 1.5 : 1;
      ctx.stroke();
    }
    if (r.state === "yielding") {
      const ph = (o.nowMs / 700) % 1;
      ctx.beginPath();
      ctx.arc(px, py, size * (0.7 + ph * 0.6), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(167, 139, 250, ${0.8 * (1 - ph)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    if (r.state === "degraded") {
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(px, py, size * 0.8, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(251, 146, 60, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // battery arc
    ctx.beginPath();
    ctx.arc(px, py, size * 0.68, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * r.battery) / 100);
    ctx.strokeStyle = batteryColor(r.battery);
    ctx.lineWidth = Math.max(1.5, cs * 0.12);
    ctx.lineCap = "butt";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, size * 0.68, -Math.PI / 2 + (Math.PI * 2 * r.battery) / 100, Math.PI * 1.5);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.stroke();

    // body (rounded square with heading notch)
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate((-r.heading * Math.PI) / 180);
    const s = size * 0.68;
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(11, 18, 32, 0.9)";
    ctx.lineWidth = 1.5;
    rr(ctx, -s * 0.55, -s * 0.55, s * 1.1, s * 1.1, s * 0.25);
    ctx.fill();
    ctx.stroke();
    // heading notch
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.moveTo(s * 0.62, 0);
    ctx.lineTo(s * 0.25, -s * 0.3);
    ctx.lineTo(s * 0.25, s * 0.3);
    ctx.closePath();
    ctx.fill();
    // lift indicator
    if (r.msg.lift === "up") {
      ctx.fillStyle = "rgba(11,18,32,0.85)";
      ctx.fillRect(-s * 0.25, -s * 0.12, s * 0.5, s * 0.24);
    }
    ctx.restore();

    if (r.state === "offline") {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px - s * 0.5, py - s * 0.5);
      ctx.lineTo(px + s * 0.5, py + s * 0.5);
      ctx.moveTo(px + s * 0.5, py - s * 0.5);
      ctx.lineTo(px - s * 0.5, py + s * 0.5);
      ctx.stroke();
    }

    // ID pill
    const label = o.compact ? r.id.replace("AMR-", "") : r.id;
    ctx.font = `700 ${fsId}px ${o.monoFont}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tw = ctx.measureText(label).width;
    const ph = fsId + 4;
    const pw = tw + 8;
    const ly = py - size * 0.95 - ph / 2;
    ctx.fillStyle = isSel ? "#fff" : color;
    rr(ctx, px - pw / 2, ly - ph / 2, pw, ph, 3);
    ctx.fill();
    // pointer
    ctx.beginPath();
    ctx.moveTo(px - 3, ly + ph / 2);
    ctx.lineTo(px + 3, ly + ph / 2);
    ctx.lineTo(px, ly + ph / 2 + 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = isSel ? "#0B1220" : r.state === "idle" || r.state === "blocked" ? "#1a1a1a" : "#fff";
    ctx.fillText(label, px, ly + 0.5);
  }
}

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}
