"use client";

import { useThrottled } from "@/lib/hooks";
import { TILE_COLORS } from "@/lib/theme";

const TILES: { key: keyof typeof TILE_COLORS; label: string; hint: string }[] = [
  { key: "urgent", label: "Urgent", hint: "urgent-priority tasks not yet done" },
  { key: "inProgress", label: "In Progress", hint: "self-assigned by a robot, running" },
  { key: "unassigned", label: "Unassigned", hint: "announced — bids open" },
  { key: "completed", label: "Completed", hint: "delivered this shift" },
  { key: "rebid", label: "Re-bid", hint: "re-auctioned after a blockage / release — only exists in a decentralised fleet" },
  { key: "total", label: "Total", hint: "all tasks published this shift" },
];

export function StatTiles() {
  const fleet = useThrottled((s) => s.fleet, 600);
  const values: Record<string, number> = {
    urgent: fleet?.tasks_urgent ?? 0,
    inProgress: fleet?.tasks_in_progress ?? 0,
    unassigned: fleet?.tasks_unassigned ?? 0,
    completed: fleet?.tasks_done ?? 0,
    rebid: fleet?.tasks_rebid ?? 0,
    total: fleet?.tasks_total ?? 0,
  };
  return (
    <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 lg:gap-3 p-3">
      {TILES.map((t) => {
        const c = TILE_COLORS[t.key];
        return (
          <div
            key={t.key}
            className="rounded-md overflow-hidden border"
            style={{ borderColor: `${c.strip}66`, background: `${c.bg}cc` }}
            title={t.hint}
          >
            <div
              className="px-3 py-1.5 text-[13px] font-medium text-white/95"
              style={{ background: `linear-gradient(90deg, ${c.strip}, ${c.strip}aa)` }}
            >
              {t.label}
            </div>
            <div className="px-3 py-2 mono text-[26px] lg:text-[34px] leading-none font-semibold text-white text-center">
              {fleet ? values[t.key] : "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}
