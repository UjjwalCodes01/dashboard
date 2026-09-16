"use client";

import { Download } from "lucide-react";
import { useFleetStore } from "@/lib/store";
import { fmtSimTime } from "@/lib/format";

/** One file a judge can take away: what ran, what happened, and the numbers, straight from the store. */
export function ExportRunButton({ className = "" }: { className?: string }) {
  const onExport = () => {
    const s = useFleetStore.getState();
    const report = {
      exported_at: new Date().toISOString(),
      dashboard: "Chakraview",
      scenario: s.scenario,
      seed: s.seed,
      sim_time_s: s.clock?.ts ?? 0,
      phase: s.clock?.scenario_phase ?? null,
      fleet: s.fleet,
      network: s.network,
      fleet_history: s.fleetHistory,
      robots: s.robotIds.map((id) => s.robots[id]).filter(Boolean),
      tasks: s.taskIds.map((id) => s.tasks[id]).filter(Boolean),
      events: s.events,
      health: s.health,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chakraview-${s.scenario}-seed${s.seed}-${fmtSimTime(s.clock?.ts ?? 0).replace(/:/g, "")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button className={`dark-btn ${className}`} onClick={onExport} title="Download this run: stats, per-robot state, tasks, events and the fault timeline as JSON">
      <Download className="h-3.5 w-3.5" /> Export run
    </button>
  );
}
