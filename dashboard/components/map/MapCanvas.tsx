"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Cell, RobotStateMsg } from "@/lib/types";
import type { WarehouseMap } from "@/lib/sim/map";
import { useFleetStore } from "@/lib/store";
import { STATE_LABELS } from "@/lib/theme";
import { drawDynamic, drawStatic, toWorld, type RobotVisual, type Viewport } from "./render";

export interface MapSource {
  map: () => WarehouseMap | null;
  robots: () => RobotStateMsg[];
  blocked: () => Cell[];
  /** changes whenever new robot data arrived */
  version: () => number;
  selectedId?: () => string | null;
}

export interface MapCanvasProps {
  className?: string;
  compact?: boolean;
  interactive?: boolean;
  /** clicking a robot selects it in the store (default true) */
  selectable?: boolean;
  onOpenRobot?: (id: string) => void;
  onSelectRobot?: (id: string | null) => void;
  /** keep the view centred on this robot */
  focusRobotId?: string | null;
  focusZoom?: number;
  source?: MapSource;
  /** clicking an empty cell reports it (fault injection: block aisle) */
  onCellClick?: (cell: Cell) => void;
  padding?: number;
  showLinks?: boolean;
}

interface Interp {
  ax: number;
  ay: number;
  ah: number;
  at: number;
  bx: number;
  by: number;
  bh: number;
  bt: number;
  seq: number;
}

function lerpAngle(a: number, b: number, t: number) {
  const d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}

export function MapCanvas({
  className = "",
  compact = false,
  interactive = true,
  selectable = true,
  onOpenRobot,
  onSelectRobot,
  focusRobotId = null,
  focusZoom = 2.4,
  source,
  onCellClick,
  padding,
  showLinks,
}: MapCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement>(null);
  const dynRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number } | null>(null);
  const interpRef = useRef(new Map<string, Interp>());
  const staticKeyRef = useRef("");
  const lastVersionRef = useRef(-1);
  const hoverRef = useRef<string | null>(null);
  const focusRef = useRef<{ x: number; y: number } | null>(null);

  const storeSource = useMemo<MapSource>(
    () => ({
      map: () => useFleetStore.getState().map,
      robots: () => {
        const s = useFleetStore.getState();
        return s.robotIds.map((id) => s.robots[id]).filter(Boolean);
      },
      blocked: () => useFleetStore.getState().network?.blocked_cells ?? [],
      version: () => useFleetStore.getState().tickCount,
      selectedId: () => useFleetStore.getState().selectedRobotId,
    }),
    [],
  );
  const src = source ?? storeSource;

  // resize observer
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Measure the wrapper; if it has collapsed (both canvases are absolutely positioned, so they
    // contribute no height), fall back to the parent box so the map still gets a viewport.
    const measure = () => {
      let w = el.clientWidth;
      let h = el.clientHeight;
      if ((w < 10 || h < 10) && el.parentElement) {
        const r = el.parentElement.getBoundingClientRect();
        w = Math.round(r.width);
        h = Math.round(r.height);
      }
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    measure();
    return () => ro.disconnect();
  }, []);

  const fonts = useMemo(() => {
    if (typeof document === "undefined") return { mono: "monospace", sans: "sans-serif" };
    const cs = getComputedStyle(document.documentElement);
    const mono = cs.getPropertyValue("--font-jetbrains").trim() || "ui-monospace, monospace";
    const sans = cs.getPropertyValue("--font-inter").trim() || "system-ui, sans-serif";
    return { mono: `${mono}, ui-monospace, monospace`, sans: `${sans}, system-ui, sans-serif` };
  }, []);

  const computeViewport = useCallback(
    (map: WarehouseMap): Viewport => {
      const pad = padding ?? (compact ? 10 : 18);
      const leftPad = pad + (compact ? 6 : 14); // room for aisle numbers
      const availW = Math.max(10, size.w - leftPad - pad);
      const availH = Math.max(10, size.h - pad * 2);
      const base = Math.min(availW / map.width, availH / map.height);
      const cs = base * zoomRef.current;
      const mapW = map.width * cs;
      const mapH = map.height * cs;
      let ox = leftPad + (availW - mapW) / 2 + panRef.current.x;
      let oy = pad + (availH - mapH) / 2 + panRef.current.y;
      if (focusRef.current) {
        ox = size.w / 2 - (focusRef.current.x + 0.5) * cs + panRef.current.x;
        oy = size.h / 2 - (focusRef.current.y + 0.5) * cs + panRef.current.y;
      }
      return { cs, ox, oy, width: size.w, height: size.h };
    },
    [size.w, size.h, compact, padding],
  );

  // main render loop
  useEffect(() => {
    let raf = 0;
    const dpr = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
    const setup = (c: HTMLCanvasElement | null) => {
      if (!c) return null;
      if (c.width !== Math.round(size.w * dpr) || c.height !== Math.round(size.h * dpr)) {
        c.width = Math.round(size.w * dpr);
        c.height = Math.round(size.h * dpr);
        c.style.width = `${size.w}px`;
        c.style.height = `${size.h}px`;
        staticKeyRef.current = "";
      }
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const map = src.map();
      if (!map || size.w < 10 || size.h < 10) return;
      const store = useFleetStore.getState();
      const view = store.view;
      const now = performance.now();

      // ingest new samples
      const version = src.version();
      const robots = src.robots();
      if (version !== lastVersionRef.current) {
        lastVersionRef.current = version;
        for (const r of robots) {
          const cur = interpRef.current.get(r.robot_id);
          if (!cur) {
            interpRef.current.set(r.robot_id, {
              ax: r.pose.x,
              ay: r.pose.y,
              ah: r.pose.heading,
              at: now,
              bx: r.pose.x,
              by: r.pose.y,
              bh: r.pose.heading,
              bt: now,
              seq: r.seq,
            });
          } else if (cur.seq !== r.seq) {
            // current interpolated position becomes the new start → no jumps when ticks are irregular
            const dtb = Math.max(1, cur.bt - cur.at);
            const tt = Math.min(1, (now - cur.bt) / dtb);
            cur.ax = cur.ax + (cur.bx - cur.ax) * tt;
            cur.ay = cur.ay + (cur.by - cur.ay) * tt;
            cur.ah = lerpAngle(cur.ah, cur.bh, tt);
            cur.at = now;
            cur.bx = r.pose.x;
            cur.by = r.pose.y;
            cur.bh = r.pose.heading;
            cur.bt = now + Math.min(400, Math.max(60, dtb)); // arrive at the new sample after ~one tick
            cur.seq = r.seq;
          }
        }
      }

      // focus
      if (focusRobotId) {
        const it = interpRef.current.get(focusRobotId);
        if (it) {
          const dtb = Math.max(1, it.bt - it.at);
          const tt = Math.min(1, (now - it.at) / dtb);
          const fx = it.ax + (it.bx - it.ax) * tt;
          const fy = it.ay + (it.by - it.ay) * tt;
          const prev = focusRef.current;
          focusRef.current = prev
            ? { x: prev.x + (fx - prev.x) * 0.15, y: prev.y + (fy - prev.y) * 0.15 }
            : { x: fx, y: fy };
          if (zoomRef.current === 1) zoomRef.current = focusZoom;
        }
      } else focusRef.current = null;

      const vp = computeViewport(map);

      // static layer
      const sctx = setup(staticRef.current);
      const staticKey = [
        map.name,
        size.w,
        size.h,
        vp.cs.toFixed(3),
        vp.ox.toFixed(1),
        vp.oy.toFixed(1),
        view.grid,
        view.labels,
        view.lanes,
        view.chokes,
        compact,
      ].join("|");
      if (sctx && staticKey !== staticKeyRef.current) {
        staticKeyRef.current = staticKey;
        drawStatic(sctx, map, vp, {
          grid: view.grid,
          labels: view.labels,
          lanes: view.lanes,
          chokes: view.chokes,
          compact,
          monoFont: fonts.mono,
          sansFont: fonts.sans,
        });
      }

      // dynamic layer
      const dctx = setup(dynRef.current);
      if (!dctx) return;
      const visuals: RobotVisual[] = [];
      for (const r of robots) {
        const it = interpRef.current.get(r.robot_id);
        let x = r.pose.x;
        let y = r.pose.y;
        let h = r.pose.heading;
        if (it) {
          const dtb = Math.max(1, it.bt - it.at);
          const tt = Math.min(1, (now - it.at) / dtb);
          x = it.ax + (it.bx - it.ax) * tt;
          y = it.ay + (it.by - it.ay) * tt;
          h = lerpAngle(it.ah, it.bh, tt);
        }
        visuals.push({ id: r.robot_id, x, y, heading: h, state: r.state, battery: r.battery_pct, msg: r });
      }
      const pulses: { cell: Cell; age: number }[] = [];
      for (const [k, ts] of Object.entries(store.conflictPulses)) {
        const age = now - ts;
        if (age < 2200) {
          const [cx, cy] = k.split(",").map(Number);
          pulses.push({ cell: [cx, cy], age });
        }
      }
      const destinations = new Map<string, Cell>();
      const selectedId = src.selectedId ? src.selectedId() : store.selectedRobotId;
      if (selectedId) {
        const r = robots.find((x) => x.robot_id === selectedId);
        const d = r?.destination;
        if (d) {
          const st = map.stations.find((s) => s.id === d) ?? null;
          const ch = map.chargers.find((c) => c.id === d) ?? null;
          const cell = st?.cell ?? ch?.cell ?? null;
          if (cell) destinations.set(selectedId, cell);
        }
      }
      drawDynamic(dctx, map, vp, visuals, {
        trails: view.trails,
        comms: view.comms,
        links: showLinks ?? view.links,
        compact,
        selectedId,
        hoverId: hoverRef.current,
        blocked: src.blocked(),
        pulses,
        nowMs: now,
        monoFont: fonts.mono,
        sansFont: fonts.sans,
        commsRange: 12,
        destinations,
      });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size.w, size.h, computeViewport, compact, fonts, src, focusRobotId, focusZoom, showLinks]);

  // ---- interaction ----
  const hitTest = useCallback(
    (sx: number, sy: number): string | null => {
      const map = src.map();
      if (!map) return null;
      const vp = computeViewport(map);
      const [wx, wy] = toWorld(vp, sx, sy);
      let best: string | null = null;
      let bestD = Infinity;
      const thresh = Math.max(0.6, 8 / vp.cs);
      for (const [id, it] of interpRef.current) {
        const now = performance.now();
        const dtb = Math.max(1, it.bt - it.at);
        const tt = Math.min(1, (now - it.at) / dtb);
        const x = it.ax + (it.bx - it.ax) * tt + 0.5;
        const y = it.ay + (it.by - it.ay) * tt + 0.5;
        const d = Math.hypot(x - wx, y - wy);
        if (d < thresh && d < bestD) {
          bestD = d;
          best = id;
        }
      }
      return best;
    },
    [src, computeViewport],
  );

  const cellAt = useCallback(
    (sx: number, sy: number): Cell | null => {
      const map = src.map();
      if (!map) return null;
      const vp = computeViewport(map);
      const [wx, wy] = toWorld(vp, sx, sy);
      const cx = Math.floor(wx);
      const cy = Math.floor(wy);
      if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) return null;
      return [cx, cy];
    },
    [src, computeViewport],
  );

  /** zoom by `factor` keeping the screen point (sx, sy) fixed on the same world point */
  const zoomAt = (sx: number, sy: number, factor: number) => {
    const map = src.map();
    if (!map) return;
    const vpBefore = computeViewport(map);
    const [wx, wy] = toWorld(vpBefore, sx, sy);
    zoomRef.current = Math.max(1, Math.min(7, zoomRef.current * factor));
    const vpAfter = computeViewport(map);
    const nsx = vpAfter.ox + wx * vpAfter.cs;
    const nsy = vpAfter.oy + wy * vpAfter.cs;
    panRef.current = { x: panRef.current.x + (sx - nsx), y: panRef.current.y + (sy - nsy) };
    if (zoomRef.current === 1 && !focusRobotId) panRef.current = { x: 0, y: 0 };
    staticKeyRef.current = "";
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    const rect = wrapRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    pointersRef.current.set(e.pointerId, { x: sx, y: sy });
    if (pointersRef.current.size === 2) {
      // second finger: switch from drag to pinch
      const [a, b] = Array.from(pointersRef.current.values());
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
      dragRef.current = null;
      return;
    }
    dragRef.current = { x: sx, y: sy, px: panRef.current.x, py: panRef.current.y, moved: false };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, { x: sx, y: sy });
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const [a, b] = Array.from(pointersRef.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchRef.current.dist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / pinchRef.current.dist);
      pinchRef.current.dist = dist;
      return;
    }
    const d = dragRef.current;
    if (d && interactive) {
      const dx = sx - d.x;
      const dy = sy - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
      if (d.moved) {
        panRef.current = { x: d.px + dx, y: d.py + dy };
        staticKeyRef.current = "";
        return;
      }
    }
    const id = hitTest(sx, sy);
    if (id !== hoverRef.current) {
      hoverRef.current = id;
      setHoverId(id);
      if (selectable) useFleetStore.getState().hover(id);
    }
    if (tipRef.current) {
      tipRef.current.style.transform = `translate(${sx + 14}px, ${sy + 14}px)`;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pinchRef.current) {
      if (pointersRef.current.size < 2) pinchRef.current = null;
      dragRef.current = null;
      return;
    }
    const d = dragRef.current;
    dragRef.current = null;
    if (d && d.moved) return;
    const rect = wrapRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const id = hitTest(sx, sy);
    if (id) {
      if (selectable) useFleetStore.getState().select(id);
      onSelectRobot?.(id);
      return;
    }
    const cell = cellAt(sx, sy);
    if (cell && onCellClick) {
      onCellClick(cell);
      return;
    }
    if (selectable) useFleetStore.getState().select(null);
    onSelectRobot?.(null);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    const id = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (id && onOpenRobot) onOpenRobot(id);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!interactive) return;
    const rect = wrapRef.current!.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  const resetView = () => {
    zoomRef.current = focusRobotId ? focusZoom : 1;
    panRef.current = { x: 0, y: 0 };
    staticKeyRef.current = "";
  };

  // tooltip content
  const hoverRobot = useFleetStore((s) => (hoverId ? s.robots[hoverId] : undefined));
  const tipRobot = hoverRobot ?? (hoverId ? src.robots().find((r) => r.robot_id === hoverId) : undefined);

  return (
    <div
      ref={wrapRef}
      className={`overflow-hidden select-none ${className}`}
      // position is set inline: a `relative` class here would lose to nothing and beat the
      // caller's `absolute inset-0` (Tailwind emits .relative after .absolute), collapsing the
      // wrapper to zero height and stopping the render loop at its size guard.
      style={{
        position: "absolute",
        inset: 0,
        cursor: interactive ? (hoverId ? "pointer" : "grab") : hoverId ? "pointer" : "default",
        touchAction: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => {
        pointersRef.current.delete(e.pointerId);
        if (pointersRef.current.size < 2) pinchRef.current = null;
        dragRef.current = null;
      }}
      onPointerLeave={(e) => {
        pointersRef.current.delete(e.pointerId);
        if (pointersRef.current.size < 2) pinchRef.current = null;
        dragRef.current = null;
        if (hoverRef.current) {
          hoverRef.current = null;
          setHoverId(null);
          if (selectable) useFleetStore.getState().hover(null);
        }
      }}
      onDoubleClick={onDoubleClick}
      onWheel={onWheel}
    >
      <canvas ref={staticRef} className="absolute inset-0" />
      <canvas ref={dynRef} className="absolute inset-0" />
      {tipRobot && (
        <div
          ref={tipRef}
          className="pointer-events-none absolute left-0 top-0 z-10 rounded-md border border-panel-border bg-[#0d1528]/95 px-2.5 py-1.5 text-[11px] shadow-lg"
        >
          <div className="mono font-semibold text-[12px]">{tipRobot.robot_id}</div>
          <div className="text-text-2">
            Status: <span className="text-text">{STATE_LABELS[tipRobot.state]}</span>
          </div>
          <div className="text-text-2">
            Battery: <span className="text-text mono">{tipRobot.battery_pct.toFixed(0)}%</span>
            {tipRobot.task && (
              <>
                {" · "}
                <span className="text-text mono">{tipRobot.task.id}</span>
              </>
            )}
          </div>
          {!compact && <div className="text-text-3 mt-0.5">click · details — double-click · open</div>}
        </div>
      )}
      {interactive && (
        <button
          type="button"
          onClick={resetView}
          className="absolute bottom-2 right-2 z-10 dark-btn !py-1 !px-2 text-[10px] opacity-70 hover:opacity-100"
          title="Reset view"
        >
          ⤢ fit
        </button>
      )}
    </div>
  );
}
