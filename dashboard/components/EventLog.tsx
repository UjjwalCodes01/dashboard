"use client";

import { useMemo, useState } from "react";
import { useFleetStore } from "@/lib/store";
import { fmtSimTime } from "@/lib/format";
import type { EventCategory, EventMsg } from "@/lib/types";
import { EmptyState } from "./ui";

const FILTERS: { key: EventCategory | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "conflict", label: "Conflicts" },
  { key: "task", label: "Tasks" },
  { key: "network", label: "Network" },
  { key: "battery", label: "Battery" },
  { key: "health", label: "Health" },
];

const CAT_COLOR: Record<EventCategory, string> = {
  conflict: "#A78BFA",
  task: "#3B82F6",
  network: "#22D3EE",
  battery: "#22C55E",
  health: "#FB923C",
  system: "#94A3B8",
};

export function EventLog({
  robotId,
  limit = 120,
  compact = false,
  light = false,
  showFilters = true,
  className = "",
}: {
  robotId?: string;
  limit?: number;
  compact?: boolean;
  light?: boolean;
  showFilters?: boolean;
  className?: string;
}) {
  const events = useFleetStore((s) => s.events);
  const [filter, setFilter] = useState<EventCategory | "all">("all");
  const rows = useMemo(() => {
    const out: EventMsg[] = [];
    for (let i = events.length - 1; i >= 0 && out.length < limit; i--) {
      const e = events[i];
      if (robotId && e.robot_id !== robotId && !e.text.includes(robotId)) continue;
      if (filter !== "all" && e.category !== filter) continue;
      out.push(e);
    }
    return out;
  }, [events, robotId, filter, limit]);

  return (
    <div className={`flex flex-col h-full min-h-0 ${className}`}>
      {showFilters && (
        <div className={`flex items-center gap-1 px-2 py-1.5 border-b ${light ? "border-admin-line" : "border-panel-border/70"}`}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2 py-0.5 rounded text-[11px] ${
                filter === f.key
                  ? light
                    ? "bg-admin-accent/10 text-admin-accent"
                    : "bg-accent/15 text-accent"
                  : light
                    ? "text-admin-text-2 hover:text-admin-text"
                    : "text-text-2 hover:text-text"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto">
        {!rows.length ? (
          <EmptyState text="No events yet" />
        ) : (
          <ul className={`divide-y ${light ? "divide-admin-line" : "divide-panel-border/50"}`}>
            {rows.map((e) => (
              <li key={e.id} className={`flex gap-2 px-2.5 ${compact ? "py-1" : "py-1.5"} fade-in`}>
                <span className={`mono shrink-0 text-[11px] ${light ? "text-admin-text-2" : "text-text-3"}`}>
                  {fmtSimTime(e.ts)}
                </span>
                <span
                  className="mt-[5px] h-1.5 w-1.5 rounded-full shrink-0"
                  style={{
                    background: e.level === "error" ? "#EF4444" : e.level === "warn" ? "#F59E0B" : CAT_COLOR[e.category],
                  }}
                />
                <span
                  className={`text-[12px] leading-snug ${
                    e.level === "error"
                      ? "text-offline"
                      : e.level === "warn"
                        ? light
                          ? "text-amber-700"
                          : "text-[#FCD34D]"
                        : light
                          ? "text-admin-text"
                          : "text-text"
                  }`}
                >
                  {e.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
