"use client";

import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui";
import { MapCanvas } from "@/components/map/MapCanvas";
import { StatTiles } from "@/components/overview/StatTiles";
import { WorkProgressChart } from "@/components/overview/WorkProgressChart";
import { UrgentTaskTable } from "@/components/overview/UrgentTaskTable";
import { SafetyTiles } from "@/components/overview/SafetyTiles";
import { ChargingStrip } from "@/components/overview/ChargingStrip";
import { LegendInline } from "@/components/Legend";
import { EventLog } from "@/components/EventLog";
import { useFleetStore } from "@/lib/store";

export default function OverviewPage() {
  const router = useRouter();
  const phase = useFleetStore((s) => s.clock?.scenario_phase);
  const mapName = useFleetStore((s) => s.map?.name);

  return (
    <main className="page-dark dash-main">
      <div className="relative flex items-center justify-center pt-2 pb-1">
        <div className="absolute inset-x-0 top-1/2 h-px bg-linear-to-r from-transparent via-accent/40 to-transparent" />
        <h1 className="relative px-4 sm:px-6 text-[15px] sm:text-[20px] font-semibold tracking-wide text-[#bfefff] bg-[#0b1220] drop-shadow-[0_0_12px_rgba(34,211,238,0.55)] text-center">
          AMR Fleet Coordination Monitor
        </h1>
      </div>

      <div className="flex-1 lg:min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_460px] gap-3 px-3 pb-3">
        {/* left column */}
        <div className="flex flex-col gap-3 lg:min-h-0">
          <Panel title="Task Statistics" right={<span className="hidden sm:inline text-[11px] text-text-2">allocation by on-robot auction</span>}>
            <StatTiles />
          </Panel>
          <Panel
            className="h-[62vw] min-h-[400px] max-h-[540px] lg:max-h-none lg:h-auto lg:flex-1 lg:min-h-0"
            title="Real-time AMR Fleet Map"
            right={
              <div className="flex items-center gap-3">
                <div className="hidden md:block">
                  <LegendInline />
                </div>
                <span className="text-[10px] text-text-3 mono hidden 2xl:inline">
                  {mapName ?? "loading map"} · {phase ?? ""}
                </span>
              </div>
            }
            bodyClassName="relative"
          >
            <MapCanvas className="absolute inset-0" onOpenRobot={(id) => router.push(`/robots/${id}`)} />
          </Panel>
          <div className="md:hidden px-1">
            <LegendInline />
          </div>
          <Panel className="h-[170px] lg:h-[132px] shrink-0" title="Live event log" bodyClassName="min-h-0">
            <EventLog compact showFilters={false} limit={40} />
          </Panel>
        </div>

        {/* right column */}
        <div className="flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto hide-scrollbar">
          <Panel className="h-[230px] lg:h-[250px] shrink-0" title="Active AMR Work Progress" right={<span className="text-[11px] text-text-2">hover for status · battery</span>}>
            <WorkProgressChart />
          </Panel>
          <Panel className="max-h-[380px] lg:max-h-none lg:flex-1 lg:min-h-[220px]" title="Urgent Task List" right={<span className="hidden xl:inline text-[11px] text-text-2">assigned by auction — never by this screen</span>} bodyClassName="overflow-auto">
            <UrgentTaskTable limit={8} />
          </Panel>
          <Panel title="Safety" className="shrink-0">
            <SafetyTiles compact />
          </Panel>
          <Panel title="Charging Station Status" className="shrink-0">
            <ChargingStrip />
          </Panel>
        </div>
      </div>
    </main>
  );
}
