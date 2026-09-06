"use client";

import { ShieldAlert, ShieldCheck, Split, Undo2 } from "lucide-react";
import { useThrottled } from "@/lib/hooks";

export function SafetyTiles({ compact = false }: { compact?: boolean }) {
  const fleet = useThrottled((s) => s.fleet, 600);
  const collisions = fleet?.collisions ?? 0;
  const bad = collisions > 0;
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 ${compact ? "" : ""}`}>
      <div
        className="rounded-md border-2 px-3 py-2 flex items-center gap-3"
        style={{
          borderColor: bad ? "#EF4444" : "#22C55E",
          background: bad ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.08)",
          boxShadow: bad ? "0 0 18px rgba(239,68,68,0.35)" : "0 0 14px rgba(34,197,94,0.12)",
        }}
        title="Inter-robot collisions since start. Must stay 0 — cells are reserved before entry."
      >
        {bad ? <ShieldAlert className="h-7 w-7 text-offline" /> : <ShieldCheck className="h-7 w-7 text-charging" />}
        <div>
          <div className="text-[11px] uppercase tracking-wider text-text-2">Collisions</div>
          <div className={`mono text-[30px] leading-none font-semibold ${bad ? "text-offline" : "text-charging"}`}>
            {fleet ? collisions : "—"}
          </div>
        </div>
      </div>
      <div className="rounded-md border border-panel-border px-3 py-2 flex items-center gap-3 bg-white/[0.02]" title="Head-on / intersection conflicts resolved locally (priority inheritance, re-route, back-up)">
        <Split className="h-6 w-6 text-yielding" />
        <div>
          <div className="text-[11px] uppercase tracking-wider text-text-2">Deadlocks resolved</div>
          <div className="mono text-[26px] leading-none font-semibold">{fleet ? fleet.deadlocks_resolved : "—"}</div>
        </div>
      </div>
      <div className="rounded-md border border-panel-border px-3 py-2 flex items-center gap-3 bg-white/[0.02]" title="Total yield decisions made by robots">
        <Undo2 className="h-6 w-6 text-accent" />
        <div>
          <div className="text-[11px] uppercase tracking-wider text-text-2">Yields · msgs/s</div>
          <div className="mono text-[26px] leading-none font-semibold">
            {fleet ? fleet.yields_total : "—"}
            <span className="text-[13px] text-text-2 ml-2">{fleet ? fleet.msgs_per_sec_total.toFixed(0) : "—"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
