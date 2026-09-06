"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, EyeOff } from "lucide-react";
import { drawCameraFrame, sceneDetections, type CameraKind } from "@/lib/sim/camera";
import { useFleetStore } from "@/lib/store";
import { fmtSimTime } from "@/lib/format";

const CAMS: { kind: CameraKind; label: string }[] = [
  { kind: "front", label: "Front fish-eye camera" },
  { kind: "left", label: "Left marker camera" },
  { kind: "right", label: "Right marker camera" },
  { kind: "rgbd", label: "Front RGBD (depth)" },
];

export function CameraView({
  robotId,
  kind,
  label,
  main = false,
  onSelect,
}: {
  robotId: string;
  kind: CameraKind;
  label: string;
  main?: boolean;
  onSelect?: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);
  const seed = robotId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const ts = useFleetStore((s) => s.robots[robotId]?.ts ?? 0);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 80) return; // ~12 fps is plenty for a mock feed
      last = now;
      const c = ref.current;
      const wrap = wrapRef.current;
      if (!c || !wrap) return;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        c.style.width = `${w}px`;
        c.style.height = `${h}px`;
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const r = useFleetStore.getState().robots[robotId];
      drawCameraFrame(ctx, w, h, {
        kind,
        seed,
        t: now / 1000,
        heading: r?.pose.heading ?? 0,
        speed: r?.speed ?? 0,
        neighbours: r?.neighbours ?? [],
        lift: r?.lift ?? "down",
        offline: !r || r.state === "offline" || hidden,
      });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [robotId, kind, seed, hidden]);

  return (
    <div
      ref={wrapRef}
      className={`relative overflow-hidden rounded-md border border-panel-border bg-black ${main ? "" : "cursor-pointer hover:border-accent/50"}`}
      onClick={onSelect}
    >
      <canvas ref={ref} className="absolute inset-0" />
      <div className="absolute left-0 top-0 right-0 flex items-center justify-between px-2 py-1 text-[10px] bg-gradient-to-b from-black/60 to-transparent">
        <span className="flex items-center gap-1 text-white/90">
          <Camera className="h-3 w-3" /> {label}
        </span>
        <span className="mono text-white/70">{fmtSimTime(ts)}</span>
      </div>
      <div className="absolute bottom-1 left-2 text-[9px] uppercase tracking-widest text-white/50">simulated feed</div>
      {main && (
        <button
          className="absolute bottom-1 right-2 text-white/60 hover:text-white"
          onClick={(e) => {
            e.stopPropagation();
            setHidden((v) => !v);
          }}
          title="Toggle feed"
        >
          <EyeOff className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function CameraGrid({ robotId }: { robotId: string }) {
  const [mainKind, setMainKind] = useState<CameraKind>("front");
  const [nowS, setNowS] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowS(performance.now() / 1000), 500);
    return () => clearInterval(id);
  }, []);
  const robot = useFleetStore((s) => s.robots[robotId]);
  const main = CAMS.find((c) => c.kind === mainKind)!;
  const others = CAMS.filter((c) => c.kind !== mainKind);
  const dets = robot
    ? sceneDetections({
        kind: "front",
        seed: robotId.split("").reduce((a, c) => a + c.charCodeAt(0), 0),
        t: nowS,
        heading: robot.pose.heading,
        speed: robot.speed,
        neighbours: robot.neighbours,
        lift: robot.lift,
      })
    : [];

  return (
    <div className="flex flex-col gap-2 h-full min-h-0">
      <div className="flex items-center justify-between text-[11px] text-text-2 px-0.5">
        <span>
          Main view: <span className="text-text">{main.label}</span>
        </span>
        <span className="flex items-center gap-2">
          {dets.map((d) => (
            <span key={d.label} className="mono" style={{ color: d.color }}>
              {d.label} {(d.conf * 100).toFixed(0)}%
            </span>
          ))}
        </span>
      </div>
      <div className="flex-1 min-h-[220px]">
        <CameraView robotId={robotId} kind={main.kind} label={main.label} main />
      </div>
      <div className="grid grid-cols-3 gap-2 h-[110px]">
        {others.map((c) => (
          <CameraView key={c.kind} robotId={robotId} kind={c.kind} label={c.label} onSelect={() => setMainKind(c.kind)} />
        ))}
      </div>
    </div>
  );
}
