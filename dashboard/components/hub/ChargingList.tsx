"use client";

import { Plug, Zap } from "lucide-react";
import { useChargerBays } from "../overview/ChargingStrip";

export function ChargingList() {
  const bays = useChargerBays();
  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-3 text-[10px] text-text-2 mb-1">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#475569]" />Idle</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-charging" />Charging</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-blocked" />Inbound</span>
      </div>
      {bays.map((b) => (
        <div key={b.id} className="grid grid-cols-[1fr_auto] items-center gap-2">
          <div className="rounded bg-white/[0.04] border border-panel-border px-2 py-1 text-[11px] text-text-2">
            Charging Stn <span className="mono text-text">{b.id}</span>
          </div>
          <div className="flex items-center gap-2 min-w-[120px]">
            <span
              className="grid h-6 w-6 place-items-center rounded"
              style={{ background: b.robot ? "rgba(34,197,94,0.2)" : b.incoming ? "rgba(245,158,11,0.2)" : "rgba(71,85,105,0.3)" }}
            >
              {b.robot ? <Zap className="h-3.5 w-3.5 text-charging" /> : <Plug className="h-3.5 w-3.5 text-text-2" />}
            </span>
            {b.robot ? (
              <div className="leading-tight">
                <div className="mono text-[12px]">{b.robot.robot_id}</div>
                <div className="text-[10px] text-charging">⚡ {b.robot.battery_pct.toFixed(0)}%</div>
              </div>
            ) : b.incoming ? (
              <div className="leading-tight">
                <div className="mono text-[12px]">{b.incoming.robot_id}</div>
                <div className="text-[10px] text-blocked">inbound · {b.incoming.battery_pct.toFixed(0)}%</div>
              </div>
            ) : (
              <div className="leading-tight">
                <div className="text-[12px] text-text-2">Idle</div>
                <div className="text-[10px] text-text-3">(free)</div>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
