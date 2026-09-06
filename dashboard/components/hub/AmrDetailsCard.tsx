"use client";

import Link from "next/link";
import { ChevronsUp, Eye, X } from "lucide-react";
import { useFleetStore } from "@/lib/store";
import { cellLabel, locationCode } from "@/lib/sim/map";
import { STATE_COLORS, STATE_LABELS } from "@/lib/theme";
import { fmtSimTime } from "@/lib/format";
import { BatteryBar, KV, StateChip } from "../ui";

export function AmrDetailsCard({
  robotId,
  onClose,
  extended = false,
  className = "",
}: {
  robotId: string;
  onClose?: () => void;
  extended?: boolean;
  className?: string;
}) {
  const r = useFleetStore((s) => s.robots[robotId]);
  const info = useFleetStore((s) => s.robotInfo[robotId]);
  const map = useFleetStore((s) => s.map);
  const simNow = useFleetStore((s) => s.clock?.ts ?? 0);
  if (!r) return null;
  const age = Math.max(0, simNow - r.ts);
  const loc = map ? locationCode(map, r.cell[0], r.cell[1]) : "—";
  const where = map ? cellLabel(map, r.cell[0], r.cell[1]) : "—";

  return (
    <div className={`w-full lg:w-[300px] rounded-md border border-panel-border bg-[#0d1528]/95 backdrop-blur shadow-2xl slide-in-left ${className}`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border">
        <div className="font-semibold text-[13px]">AMR Details</div>
        <div className="flex items-center gap-1 text-text-2">
          <span className="inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent mr-1" title="No remote-control actions exist on this dashboard">
            <Eye className="h-3 w-3" /> Observe only
          </span>
          <ChevronsUp className="h-3.5 w-3.5 opacity-60" />
          {onClose && (
            <button onClick={onClose} className="hover:text-text" aria-label="Close">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="px-3 py-2">
        <KV k="AMR Number" v={<span className="mono font-semibold text-[13px]">{r.robot_id}</span>} />
        <KV k="Battery" v={<BatteryBar pct={r.battery_pct} width={70} />} />
        <KV k="AMR Status" v={<StateChip state={r.state} />} />
        <KV k="Mode" v={<span>{r.link_ok ? "Online / Coordinating" : r.state === "offline" ? "Offline" : "Link lost / local safety"}</span>} />
        <KV k="Coordinate" v={`(${r.pose.x.toFixed(2)}, ${r.pose.y.toFixed(2)}, ${r.pose.heading.toFixed(0)}°)`} mono />
        <KV k="Location" v={<span title={where}>{loc}</span>} mono />
        <KV k="Linear velocity" v={`${r.speed.toFixed(2)} m/s`} mono />
        <KV k="Angular velocity" v={`${r.ang_speed.toFixed(0)} °/s`} mono />
        <KV k="Lift" v={r.lift === "up" ? "Raised (carrying)" : "Lowered"} />
        <KV k="Destination" v={r.destination ?? "—"} mono />
        <div className="h-px bg-panel-border my-1.5" />
        {r.task ? (
          <>
            <KV k="Task" v={<span className="mono">{r.task.id}</span>} />
            <KV k="Template" v={r.task.template} />
            <KV k="Step" v={<span className="mono">{r.task.step}</span>} />
            <div className="flex items-center gap-2 py-1">
              <div className="flex-1 h-1.5 rounded bg-white/10 overflow-hidden">
                <div className="h-full rounded" style={{ width: `${(r.task.progress * 100).toFixed(0)}%`, background: STATE_COLORS.working }} />
              </div>
              <span className="mono text-[11px] text-text-2">{(r.task.progress * 100).toFixed(0)}%</span>
            </div>
          </>
        ) : (
          <KV k="Task" v={<span className="text-text-2">none · bidding when idle</span>} />
        )}
        <div className="h-px bg-panel-border my-1.5" />
        <KV
          k="Peers in range"
          v={
            <span className="flex flex-wrap justify-end gap-1">
              <span className="mono">{r.neighbours.length}</span>
              {r.neighbours.map((n) => (
                <Link key={n} href={`/robots/${n}`} className="mono text-[10px] rounded bg-accent/10 border border-accent/30 px-1 text-accent hover:bg-accent/20">
                  {n.replace("AMR-", "")}
                </Link>
              ))}
            </span>
          }
        />
        <KV
          k="Link"
          v={
            <span className={`inline-flex items-center gap-1.5 ${r.link_ok ? "text-charging" : "text-offline"}`}>
              <span className={`h-2 w-2 rounded-full ${r.link_ok ? "bg-charging" : "bg-offline"}`} />
              {r.link_ok ? "up" : "down"}
            </span>
          }
        />
        <KV k="Planner latency" v={`${r.planner_latency_ms.toFixed(1)} ms`} mono />
        <KV k="Intent broadcast" v={`${r.msgs_per_sec.toFixed(1)} msg/s`} mono />
        <KV k="Yields" v={r.yield_count} mono />
        <KV k="Tasks done" v={r.tasks_done} mono />
        <KV k="Last updated" v={`${fmtSimTime(r.ts)} · ${age < 1 ? "<1" : age.toFixed(0)} s`} mono />
        {extended && info && (
          <>
            <div className="h-px bg-panel-border my-1.5" />
            <KV k="Model" v={info.model} />
            <KV k="Edge board" v={info.board} />
            <KV k="Firmware" v={info.firmware} mono />
            <KV k="Address" v={info.ip} mono />
            <KV k="Health" v={<span className={r.health.overall === "PASS" ? "text-charging" : r.health.overall === "WARN" ? "text-blocked" : "text-offline"}>{r.health.overall}{r.health.failed.length ? ` · ${r.health.failed.length} flagged` : ""}</span>} />
          </>
        )}
      </div>
      {!extended && (
        <div className="flex gap-2 px-3 pb-3">
          <Link href={`/robots/${r.robot_id}`} className="dark-btn flex-1 justify-center">
            Open detail →
          </Link>
          <Link href={`/robots/${r.robot_id}/health`} className="dark-btn flex-1 justify-center">
            Health
          </Link>
        </div>
      )}
      <div className="px-3 pb-2 text-[10px] text-text-3">
        {STATE_LABELS[r.state]} · decisions made on-robot · this card only listens
      </div>
    </div>
  );
}
