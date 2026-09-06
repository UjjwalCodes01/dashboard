"use client";

import { useThrottled } from "@/lib/hooks";
import { selectRobotList } from "@/lib/store";
import { STATE_COLORS, STATE_LABELS, STATE_ORDER } from "@/lib/theme";
import type { RobotState } from "@/lib/types";

/** Inline legend for a map header: coloured dot + label (count). */
export function LegendInline({ showCounts = true }: { showCounts?: boolean }) {
  const counts = useThrottled((s) => {
    const c: Partial<Record<RobotState, number>> = {};
    for (const r of selectRobotList(s)) c[r.state] = (c[r.state] ?? 0) + 1;
    return c;
  }, 800);
  return (
    <div className="flex items-center gap-3 text-[11px] text-text-2 flex-wrap">
      {STATE_ORDER.map((st) => (
        <span key={st} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: STATE_COLORS[st] }} />
          {STATE_LABELS[st]}
          {showCounts && <span className="mono">({counts[st] ?? 0})</span>}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-grid place-items-center h-3 w-3 rounded-[2px] border border-text-3 text-[8px] text-text-2">P</span>
        Parking
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-grid place-items-center h-3 w-3 rounded-[2px] border border-accent text-[8px] text-accent">⚡</span>
        Charger
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-[2px] bg-working/40 border border-working" />
        Pickup
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-[2px] bg-[#A855F7]/40 border border-[#A855F7]" />
        Drop
      </span>
    </div>
  );
}

/** Floating legend card (Hub bottom-left, ForwardX style). */
export function LegendCard({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-md border border-panel-border bg-[#0d1528]/92 backdrop-blur px-3 py-2 text-[11px] ${className}`}>
      <div className="flex items-center justify-between text-text-2 mb-1.5">
        <span className="font-medium text-text">Legend</span>
        <span>⌄</span>
      </div>
      <div className="grid grid-cols-1 gap-[3px]">
        {STATE_ORDER.map((st) => (
          <div key={st} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: STATE_COLORS[st] }} />
            <span className="text-text-2">{STATE_LABELS[st]}</span>
          </div>
        ))}
        <div className="h-px bg-panel-border my-1" />
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-4 border-t-2 border-dotted border-working" />
          <span className="text-text-2">Intent trail (claimed cells)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-4 border-t border-accent" />
          <span className="text-text-2">Peer link (in comms range)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-4 border-t-2 border-lane/60" />
          <span className="text-text-2">Lane centre-line</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full border border-accent/60" />
          <span className="text-text-2">Choke point (one-lane crossing)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 bg-offline/30 border border-offline" />
          <span className="text-text-2">Blocked cell</span>
        </div>
      </div>
    </div>
  );
}
