"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Activity, Eye } from "lucide-react";
import { useFleetStore } from "@/lib/store";
import { MapCanvas } from "../map/MapCanvas";
import { AmrDetailsCard } from "../hub/AmrDetailsCard";
import { EventLog } from "../EventLog";
import { Panel, Pill } from "../ui";
import { CameraGrid } from "./CameraGrid";
import { IntentWindow } from "./IntentWindow";
import { TelemetryStrip } from "./TelemetryStrip";
import { LegendCard } from "../Legend";

export function RobotDetail({ id }: { id: string }) {
  const router = useRouter();
  const robotIds = useFleetStore((s) => s.robotIds);
  const robot = useFleetStore((s) => s.robots[id]);
  const mapName = useFleetStore((s) => s.map?.name);
  const health = useFleetStore((s) => s.health[id]);
  const select = useFleetStore((s) => s.select);

  useEffect(() => {
    select(id);
  }, [id, select]);

  const pills = health?.pills ?? [
    { label: "Localized", ok: !!robot && robot.state !== "offline" },
    { label: "Autonomous", ok: !!robot && robot.state !== "offline" },
    { label: `Peers: ${robot?.neighbours.length ?? 0}`, ok: (robot?.neighbours.length ?? 0) > 0 },
  ];

  return (
    <main className="page-dark dash-main">
      <div className="flex flex-wrap items-center gap-2 lg:gap-3 px-3 py-2 border-b border-panel-border/70 text-[12px]">
        <span className="hidden md:inline text-text-2">Map:</span>
        <span className="hidden md:inline dark-input mono">{mapName ?? "…"}</span>
        <span className="text-text-2">AMR:</span>
        <select className="dark-input mono" value={id} onChange={(e) => router.push(`/robots/${e.target.value}`)}>
          {(robotIds.length ? robotIds : [id]).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar max-w-full">
          {pills.map((p) => (
            <Pill key={p.label} ok={p.ok} tone={p.ok ? "green" : "red"} className="shrink-0">
              {p.label}
            </Pill>
          ))}
        </div>
        <div className="flex-1" />
        <Link href={`/robots/${id}/health`} className="dark-btn">
          <Activity className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Health & diagnostics</span>
          <span className="sm:hidden">Health</span>
        </Link>
        <div
          className="inline-flex items-center gap-1.5 rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1.5 text-accent"
          title="ForwardX puts Relocate · Restart · System Reset · Forced Pause · Control here. A decentralised fleet has none of them: the robot decides."
        >
          <Eye className="h-3.5 w-3.5" /> Observe only<span className="hidden sm:inline"> — no remote control</span>
        </div>
      </div>

      <div className="flex-1 lg:min-h-0 grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_420px] 2xl:grid-cols-[300px_minmax(0,1fr)_460px] gap-3 p-3">
        {/* left: details + decision log */}
        <div className="flex flex-col gap-3 lg:min-h-0 order-1">
          <div className="lg:overflow-auto hide-scrollbar shrink-0 lg:max-h-[62%]">
            <AmrDetailsCard robotId={id} extended className="!w-full" />
          </div>
          <Panel className="h-[300px] lg:h-auto lg:flex-1 lg:min-h-0" title="Decision log" right={<span className="text-[10px] text-text-3">why this robot did what it did</span>}>
            <EventLog robotId={id} compact limit={80} />
          </Panel>
        </div>

        {/* middle: focused map + intent window */}
        <div className="flex flex-col gap-3 lg:min-h-0 order-2">
          <Panel className="h-[55vh] min-h-[320px] lg:h-auto lg:flex-[3] lg:min-h-0" title="Map (focused on robot)" right={<span className="hidden sm:inline text-[10px] text-text-3">navigation path = intent · scroll / pinch to zoom</span>} bodyClassName="relative">
            <MapCanvas className="absolute inset-0" focusRobotId={id} focusZoom={2.6} onOpenRobot={(rid) => router.push(`/robots/${rid}`)} />
            <LegendCard className="hidden md:block absolute bottom-2 left-2 w-[190px] scale-90 origin-bottom-left" />
          </Panel>
          <Panel className="h-[320px] lg:h-auto lg:flex-[2] lg:min-h-0" title="Intent window" right={<span className="hidden sm:inline text-[10px] text-text-3">next cells broadcast to peers · acks</span>}>
            <IntentWindow robotId={id} />
          </Panel>
        </div>

        {/* right: cameras + telemetry */}
        <div className="flex flex-col gap-3 lg:min-h-0 order-3">
          <Panel className="h-[440px] lg:h-auto lg:flex-1 lg:min-h-0" title="Cameras" right={<span className="hidden sm:inline text-[10px] text-text-3">detections drawn on-robot · read-only</span>} bodyClassName="p-2">
            <CameraGrid robotId={id} />
          </Panel>
          <Panel title="Telemetry (last 2 min)" className="shrink-0">
            <TelemetryStrip robotId={id} />
          </Panel>
        </div>
      </div>
    </main>
  );
}
