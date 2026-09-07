"use client";

import { useRouter } from "next/navigation";
import { MapCanvas } from "@/components/map/MapCanvas";
import { AmrDetailsCard } from "@/components/hub/AmrDetailsCard";
import { LegendCard } from "@/components/Legend";
import { ViewToggles } from "@/components/hub/ViewToggles";
import { BatteryChart, TasksCompletedChart } from "@/components/hub/RailCharts";
import { ChargingList } from "@/components/hub/ChargingList";
import { NeighbourGraph } from "@/components/hub/NeighbourGraph";
import { Panel } from "@/components/ui";
import { useFleetStore } from "@/lib/store";
import { useThrottled } from "@/lib/hooks";
import { SCENARIOS } from "@/lib/sim/scenarios";

export default function HubPage() {
  const router = useRouter();
  const selected = useFleetStore((s) => s.selectedRobotId);
  const select = useFleetStore((s) => s.select);
  const scenario = useFleetStore((s) => s.scenario);
  const phase = useFleetStore((s) => s.clock?.scenario_phase);
  const fleet = useThrottled((s) => s.fleet, 800);
  const def = SCENARIOS[scenario];
  const collisions = fleet?.collisions ?? 0;

  return (
    <main className="page-dark dash-main relative">
      {/* map stage: fixed height on mobile, fills the area left of the rail on desktop */}
      <div className="relative h-[52vh] min-h-[320px] lg:h-auto lg:min-h-0 lg:absolute lg:inset-y-0 lg:left-0 lg:right-[345px]">
        <MapCanvas className="absolute inset-0" onOpenRobot={(id) => router.push(`/robots/${id}`)} />

        {/* top centre: scenario + safety pins */}
        <div className="absolute top-2 lg:top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-none max-w-[calc(100%-16px)]">
          <div className="hidden sm:block rounded-md border border-panel-border bg-[#0d1528]/90 backdrop-blur px-3 py-1.5 text-[12px] whitespace-nowrap">
            <span className="text-text-2">Scenario</span> <span className="font-medium">{def.label}</span>
            {phase && <span className="text-text-3 hidden xl:inline"> · {phase}</span>}
          </div>
          <div
            className="rounded-md border px-3 py-1.5 text-[12px] backdrop-blur whitespace-nowrap"
            style={{
              borderColor: collisions > 0 ? "#EF4444" : "rgba(34,197,94,0.5)",
              background: collisions > 0 ? "rgba(239,68,68,0.15)" : "rgba(13,21,40,0.9)",
            }}
          >
            <span className="text-text-2">Collisions</span>{" "}
            <span className={`mono font-semibold ${collisions > 0 ? "text-offline" : "text-charging"}`}>{collisions}</span>
            <span className="text-text-3 hidden sm:inline"> · deadlocks resolved </span>
            <span className="mono hidden sm:inline">{fleet?.deadlocks_resolved ?? 0}</span>
          </div>
        </div>

        {/* details: side card on desktop, bottom sheet on mobile */}
        {selected ? (
          <div className="absolute inset-x-2 bottom-2 max-h-[64%] overflow-y-auto rounded-md lg:inset-x-auto lg:bottom-auto lg:top-3 lg:left-3 lg:max-h-[calc(100%-24px)]">
            <AmrDetailsCard robotId={selected} onClose={() => select(null)} />
          </div>
        ) : (
          <div className="hidden lg:block absolute top-3 left-3 rounded-md border border-panel-border bg-[#0d1528]/90 backdrop-blur px-3 py-2 text-[12px] text-text-2 max-w-[260px]">
            Click a robot for its details. Double-click to open the robot page. Scroll to zoom, drag to pan.
          </div>
        )}

        {/* bottom-left: legend + toggles */}
        {/* right-16 on phones keeps the toggle strip clear of the map's ⤢ fit button */}
        <div className={`absolute bottom-2 left-2 right-16 lg:right-auto lg:bottom-3 lg:left-3 items-end gap-2 ${selected ? "hidden lg:flex" : "flex"}`}>
          <LegendCard className="hidden lg:block w-[210px]" />
          <div className="max-w-full overflow-x-auto hide-scrollbar">
            <ViewToggles className="whitespace-nowrap" />
          </div>
        </div>
      </div>

      {/* right rail: stacked cards below the map on mobile, floating rail on desktop */}
      <aside className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 lg:p-0 lg:flex lg:flex-col lg:absolute lg:top-3 lg:right-3 lg:bottom-3 lg:w-[330px] lg:overflow-y-auto hide-scrollbar">
        <Panel title="Tasks (Completed)" right={<span className="text-[10px] text-text-3">per robot · this shift</span>}>
          <TasksCompletedChart />
        </Panel>
        <Panel title="Battery Status">
          <BatteryChart />
        </Panel>
        <Panel title="Charging">
          <ChargingList />
        </Panel>
        <Panel title="Neighbour graph" right={<span className="text-[10px] text-text-3">who hears whom · 12 m</span>}>
          <NeighbourGraph size={190} />
        </Panel>
        <div className="sm:col-span-2 lg:hidden">
          <LegendCard />
        </div>
      </aside>
    </main>
  );
}
