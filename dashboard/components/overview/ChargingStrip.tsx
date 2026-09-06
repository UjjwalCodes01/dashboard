"use client";

import { Zap } from "lucide-react";
import { useThrottled } from "@/lib/hooks";
import type { RobotStateMsg } from "@/lib/types";

export interface BayInfo {
  id: string;
  robot: RobotStateMsg | null;
  incoming: RobotStateMsg | null;
  offline: boolean;
}

export function useChargerBays(): BayInfo[] {
  return useThrottled((s) => {
    const map = s.map;
    if (!map) return [];
    const robots = s.robotIds.map((id) => s.robots[id]).filter(Boolean);
    return map.chargers.map((c) => {
      const docked =
        robots.find((r) => r.state === "charging" && r.cell[0] === c.cell[0] && r.cell[1] === c.cell[1]) ?? null;
      const incoming = docked ? null : robots.find((r) => r.destination === c.id && r.state !== "charging") ?? null;
      return { id: c.id, robot: docked, incoming, offline: false };
    });
  }, 800);
}

export function ChargingStrip({ vertical = false }: { vertical?: boolean }) {
  const bays = useChargerBays();
  return (
    <div className={`flex ${vertical ? "flex-col" : "flex-row flex-wrap"} gap-2 p-3`}>
      {bays.map((b) => {
        const charging = !!b.robot;
        const color = charging ? "#22C55E" : b.incoming ? "#F59E0B" : "#94A3B8";
        return (
          <div
            key={b.id}
            className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 min-w-[150px] flex-1"
            style={{ borderColor: `${color}55`, background: `${color}12` }}
          >
            <span
              className="mono text-[12px] font-semibold px-1.5 py-0.5 rounded"
              style={{ background: `${color}33`, color }}
            >
              {b.id}
            </span>
            {charging && b.robot ? (
              <span className="flex items-center gap-1 text-[12px]">
                <Zap className="h-3.5 w-3.5 text-charging" />
                <span className="mono">{b.robot.robot_id}</span>
                <span className="text-charging mono">{b.robot.battery_pct.toFixed(0)}%</span>
              </span>
            ) : b.incoming ? (
              <span className="text-[12px] text-blocked">
                ← <span className="mono">{b.incoming.robot_id}</span> inbound
              </span>
            ) : (
              <span className="text-[12px] text-text-2">- Idle</span>
            )}
          </div>
        );
      })}
      {!bays.length && <div className="text-text-3 text-[12px]">Loading chargers…</div>}
    </div>
  );
}
