"use client";

import { useThrottled } from "@/lib/hooks";
import { Sparkline } from "../Sparkline";

export function TelemetryStrip({ robotId }: { robotId: string }) {
  const hist = useThrottled((s) => s.history[robotId] ?? [], 1000);
  const last = hist[hist.length - 1];
  const items = [
    { label: "Speed", unit: "m/s", key: "speed" as const, color: "#3B82F6", min: 0, max: 1.05, digits: 2 },
    { label: "Battery", unit: "%", key: "battery" as const, color: "#22C55E", min: 0, max: 100, digits: 0 },
    { label: "Planner", unit: "ms", key: "planner" as const, color: "#A78BFA", min: 0, max: 22, ref: 20, digits: 1 },
    { label: "Intent msgs", unit: "/s", key: "msgs" as const, color: "#22D3EE", min: 0, max: 8, digits: 1 },
  ];
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 p-2">
      {items.map((it) => (
        <div key={it.key} className="rounded border border-panel-border bg-white/[0.02] px-2 py-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-wider text-text-2">{it.label}</span>
            <span className="mono text-[13px]" style={{ color: it.color }}>
              {last ? last[it.key].toFixed(it.digits) : "—"}
              <span className="text-[9px] text-text-3 ml-0.5">{it.unit}</span>
            </span>
          </div>
          <Sparkline values={hist.map((h) => h[it.key])} width={150} height={34} color={it.color} min={it.min} max={it.max} refLine={it.ref} />
          {it.ref && <div className="text-[9px] text-text-3">target &lt; {it.ref} ms on Pi 5</div>}
        </div>
      ))}
    </div>
  );
}
