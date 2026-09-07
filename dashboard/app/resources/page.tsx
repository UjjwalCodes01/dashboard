"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Filter, Plus, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { BatteryBar } from "@/components/ui";
import { useThrottled } from "@/lib/hooks";
import { selectRobotList, useFleetStore } from "@/lib/store";
import { SCENARIO_LIST } from "@/lib/sim/scenarios";
import { STATE_COLORS, STATE_LABELS, STATE_SEVERITY } from "@/lib/theme";
import { cellLabel, locationCode } from "@/lib/sim/map";
import { fmtSimTime } from "@/lib/format";
import type { RobotState } from "@/lib/types";

type Tab = "robots" | "chargers" | "stations" | "scenarios" | "system";
const TABS: { key: Tab; label: string }[] = [
  { key: "robots", label: "Robot" },
  { key: "chargers", label: "Charging Station" },
  { key: "stations", label: "Pick / Drop Station" },
  { key: "scenarios", label: "Scenarios" },
  { key: "system", label: "System" },
];
const TITLES: Record<Tab, string> = {
  robots: "Resource · Robot",
  chargers: "Resource · Charging Station",
  stations: "Resource · Pick / Drop Station",
  scenarios: "Scenarios",
  system: "System",
};

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full mr-1.5 align-middle" style={{ background: color }} />;
}

function Notice({ text }: { text: string | null }) {
  if (!text) return null;
  return <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 fade-in">{text}</div>;
}

function RobotsTab() {
  const robots = useThrottled(selectRobotList, 800);
  const info = useFleetStore((s) => s.robotInfo);
  const map = useFleetStore((s) => s.map);
  const simNow = useFleetStore((s) => s.clock?.ts ?? 0);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | RobotState>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rows = robots
    .filter((r) => r.robot_id.toLowerCase().includes(q.toLowerCase()))
    .filter((r) => status === "all" || r.state === status)
    .sort((a, b) => STATE_SEVERITY[a.state] - STATE_SEVERITY[b.state] || a.robot_id.localeCompare(b.robot_id));
  return (
    <>
      <Notice text={notice} />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input className="admin-input w-[180px] sm:w-[220px]" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-1 text-[12px] text-admin-text-2">
          <Filter className="h-3.5 w-3.5" />
          <select className="admin-input" value={status} onChange={(e) => setStatus(e.target.value as "all" | RobotState)}>
            <option value="all">All statuses</option>
            {(Object.keys(STATE_LABELS) as RobotState[]).map((s) => (
              <option key={s} value={s}>
                {STATE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex-1" />
        <button
          className="admin-btn"
          onClick={() => {
            setNotice("Robots are not provisioned from this UI — they join by peer discovery. Round 1: change the fleet size via the scenario seed / engine config.");
            setTimeout(() => setNotice(null), 4000);
          }}
          title="Mock-only action"
        >
          <Plus className="h-4 w-4" /> Add mock robot
        </button>
        <button className="admin-btn" onClick={() => setQ("")}>
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      <div className="rounded-md border border-admin-line bg-white overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              <th></th>
              <th>Name</th>
              <th>ID</th>
              <th>Model</th>
              <th>Edge board</th>
              <th>Firmware</th>
              <th>Status</th>
              <th>Battery</th>
              <th>Current task</th>
              <th>Peers</th>
              <th>Location</th>
              <th>Last seen</th>
              <th>Operation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const i = info[r.robot_id];
              const isOpen = open === r.robot_id;
              return (
                <RowGroup key={r.robot_id}>
                  <tr className="cursor-pointer" onClick={() => setOpen(isOpen ? null : r.robot_id)}>
                    <td className="w-6 text-admin-text-2">{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</td>
                    <td className="font-medium">{r.robot_id.replace("AMR-", "Edge AMR ")}</td>
                    <td className="mono">{r.robot_id}</td>
                    <td>{i?.model ?? "—"}</td>
                    <td>{i?.board ?? "—"}</td>
                    <td className="mono">{i?.firmware ?? "—"}</td>
                    <td>
                      <Dot color={STATE_COLORS[r.state]} />
                      {r.state === "offline" ? "Offline" : r.state === "degraded" ? "Degraded" : "Online"}
                      <span className="text-admin-text-2"> · {STATE_LABELS[r.state]}</span>
                    </td>
                    <td>
                      <BatteryBar pct={r.battery_pct} dark={false} />
                    </td>
                    <td className="mono">{r.task ? `${r.task.id} · ${r.task.step}` : <span className="text-admin-text-2">—</span>}</td>
                    <td className="mono">{r.neighbours.length}</td>
                    <td className="mono">{map ? locationCode(map, r.cell[0], r.cell[1]) : "—"}</td>
                    <td className="text-admin-text-2">{Math.max(0, simNow - r.ts) < 1 ? "just now" : `${(simNow - r.ts).toFixed(0)} s ago`}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Link href={`/robots/${r.robot_id}`} className="admin-link mr-3">
                        View
                      </Link>
                      <Link href={`/robots/${r.robot_id}/health`} className="admin-link">
                        Health
                      </Link>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={13} className="!whitespace-normal bg-gray-50">
                        <pre className="mono text-[11px] leading-snug max-h-[260px] overflow-auto p-2">{JSON.stringify(r, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </RowGroup>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={13} className="text-center text-admin-text-2 py-6">
                  {robots.length ? "No robots match" : "Waiting for robot discovery…"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function ChargersTab() {
  const data = useThrottled((s) => {
    const map = s.map;
    const robots = selectRobotList(s);
    return (map?.chargers ?? []).map((c, i) => {
      const docked = robots.find((r) => r.state === "charging" && r.cell[0] === c.cell[0] && r.cell[1] === c.cell[1]);
      const inbound = robots.find((r) => r.destination === c.id && r.state !== "charging");
      return {
        id: c.id,
        sn: `CLZ${String(2400 + i * 37).padStart(6, "0")}`,
        type: i % 2 ? "v5" : "v4",
        model: i % 2 ? "V5-Reflect-Low" : "V4-Reflect-High",
        mode: docked ? "Charging" : inbound ? "Reserved" : "Idle",
        status: "Online",
        chargingStatus: docked ? `Charging · ${docked.battery_pct.toFixed(0)}%` : "Uncharged",
        robot: docked?.robot_id ?? inbound?.robot_id ?? "—",
        cell: c.cell,
        label: map ? cellLabel(map, c.cell[0], c.cell[1]) : "",
      };
    });
  }, 1000);
  const [notice, setNotice] = useState<string | null>(null);
  const say = (t: string) => {
    setNotice(t);
    setTimeout(() => setNotice(null), 3500);
  };
  return (
    <>
      <Notice text={notice} />
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1" />
        <button className="admin-btn admin-btn-primary" onClick={() => say("Static infrastructure is defined in public/maps/map_config.json in Round 1; the final build exposes /api/infrastructure.")}>
          <Plus className="h-4 w-4" /> Create
        </button>
        <button className="admin-btn">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>
      <div className="rounded-md border border-admin-line bg-white overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>SN</th>
              <th>Type</th>
              <th>Model</th>
              <th>Working mode</th>
              <th>Status</th>
              <th>Charging status</th>
              <th>Charging AMR</th>
              <th>Cell</th>
              <th>Operation</th>
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.id}</td>
                <td className="mono">{c.sn}</td>
                <td>{c.type}</td>
                <td>{c.model}</td>
                <td>{c.mode}</td>
                <td>
                  <Dot color="#16a34a" />
                  {c.status}
                </td>
                <td>
                  <Dot color={c.chargingStatus.startsWith("Charging") ? "#16a34a" : "#9ca3af"} />
                  {c.chargingStatus}
                </td>
                <td className="mono">{c.robot}</td>
                <td className="mono">
                  ({c.cell[0]}, {c.cell[1]})
                </td>
                <td>
                  <button className="admin-link mr-3" onClick={() => say(`Edit ${c.id}: static infrastructure lives in map_config.json (Round 1).`)}>
                    Edit
                  </button>
                  <button className="admin-link" onClick={() => say(`Delete ${c.id}: static infrastructure lives in map_config.json (Round 1).`)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StationsTab() {
  const data = useThrottled((s) => {
    const map = s.map;
    const robots = selectRobotList(s);
    return (map?.stations ?? []).map((st) => ({
      ...st,
      aisle: map ? cellLabel(map, st.cell[0], st.cell[1]) : "",
      queue: robots.filter((r) => r.destination === st.id).length,
      here: robots.filter((r) => r.cell[0] === st.cell[0] && r.cell[1] === st.cell[1]).map((r) => r.robot_id),
    }));
  }, 1000);
  const [notice, setNotice] = useState<string | null>(null);
  const say = (t: string) => {
    setNotice(t);
    setTimeout(() => setNotice(null), 3500);
  };
  return (
    <>
      <Notice text={notice} />
      <div className="rounded-md border border-admin-line bg-white overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Aisle</th>
              <th>Cell</th>
              <th>Queue length</th>
              <th>Robot at station</th>
              <th>Operation</th>
            </tr>
          </thead>
          <tbody>
            {data.map((st) => (
              <tr key={st.id}>
                <td className="font-medium">{st.id}</td>
                <td>
                  <Dot color={st.type === "pickup" ? "#3B82F6" : "#A855F7"} />
                  {st.type}
                </td>
                <td>{st.aisle}</td>
                <td className="mono">
                  ({st.cell[0]}, {st.cell[1]})
                </td>
                <td className="mono">{st.queue}</td>
                <td className="mono">{st.here.join(", ") || "—"}</td>
                <td>
                  <button className="admin-link mr-3" onClick={() => say(`Edit ${st.id}: stations are defined in map_config.json (Round 1).`)}>
                    Edit
                  </button>
                  <button className="admin-link" onClick={() => say(`Delete ${st.id}: stations are defined in map_config.json (Round 1).`)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ScenariosTab() {
  const scenario = useFleetStore((s) => s.scenario);
  const setScenario = useFleetStore((s) => s.setScenario);
  const seed = useFleetStore((s) => s.seed);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {SCENARIO_LIST.map((d) => (
        <div key={d.name} className={`rounded-md border bg-white p-4 ${scenario === d.name ? "border-green-500 shadow-[0_0_0_2px_rgba(22,163,74,0.15)]" : "border-admin-line"}`}>
          <div className="flex items-center justify-between">
            <div className="font-semibold text-[14px]">{d.label}</div>
            <button className={`admin-btn ${scenario === d.name ? "" : "admin-btn-primary"}`} onClick={() => setScenario(d.name, seed)}>
              {scenario === d.name ? "Replay (seed " + seed + ")" : "Load"}
            </button>
          </div>
          <div className="text-[12px] text-admin-text-2 mt-1">{d.description}</div>
          <div className="mt-3 text-[11px]">
            <div className="text-admin-text-2 mb-1">Timeline</div>
            <div className="flex flex-wrap gap-1.5">
              {d.injections.map((inj, i) => (
                <span key={i} className="rounded border border-gray-200 bg-gray-50 px-1.5 py-px mono">
                  t+{inj.at}s · {inj.kind === "phase" ? inj.label : inj.kind.replace("_", " ")}
                </span>
              ))}
              {d.placements.length > 0 && <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-px mono">{d.placements.length} scripted starts</span>}
            </div>
          </div>
        </div>
      ))}
      <div className="md:col-span-2 text-[11px] text-admin-text-2">Scenarios are seeded: the same seed replays identically in rehearsal and in front of judges. Loading a scenario restarts the mock engine — it selects a script, it never commands a robot.</div>
    </div>
  );
}

function SystemTab() {
  const transport = useFleetStore((s) => s.transport);
  const connected = useFleetStore((s) => s.connected);
  const clock = useFleetStore((s) => s.clock);
  const robots = useFleetStore((s) => s.robotIds.length);
  const rows: [string, string][] = [
    ["Dashboard", "v0.1 (Round 1)"],
    ["Telemetry schema", "v1 · see DASHBOARD_BUILD_DOCS.md §14"],
    ["Transport", transport === "ws" ? `WebSocket (${process.env.NEXT_PUBLIC_TELEMETRY_WS})` : "In-browser mock engine (final schema)"],
    ["Connection", connected ? "connected" : "disconnected"],
    ["Sim time", clock ? fmtSimTime(clock.ts) : "—"],
    ["Scenario · seed", clock ? `${clock.scenario} · ${clock.seed}` : "—"],
    ["Robots discovered", String(robots)],
    ["Robot state rate", "5 Hz per robot · fleet stats 1 Hz"],
    ["Comms range (mock)", "12 m"],
    ["Coordination", "PIBT (per-step, on-robot) + ORCA safety filter · A* as heuristic only"],
    ["Allocation", "Contract Net Protocol · bid = dist + 0.5·queue + battery penalty"],
    ["Battery model", "−0.15 %/s moving · −0.03 %/s idle · +1 %/s docked · floor 20 %"],
    ["Backend swap", "set NEXT_PUBLIC_TELEMETRY_WS=ws://host/ws/telemetry and rebuild — no page changes"],
  ];
  return (
    <div className="rounded-md border border-admin-line bg-white overflow-x-auto max-w-[900px]">
      <table className="admin-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="text-admin-text-2 w-[220px]">{k}</td>
              <td className="!whitespace-normal">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResourcesInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = ((sp?.get("tab") as Tab) ?? "robots") as Tab;
  const valid = TABS.some((t) => t.key === tab) ? tab : "robots";
  const groupTabs = useMemo(() => {
    if (["robots", "chargers", "stations"].includes(valid)) return TABS.slice(0, 3);
    return TABS.filter((t) => t.key === valid);
  }, [valid]);
  return (
    <AdminShell title={TITLES[valid]}>
      <div className="flex items-center gap-4 sm:gap-6 border-b border-admin-line mb-4 text-[13px] overflow-x-auto hide-scrollbar">
        {groupTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => router.push(`/resources?tab=${t.key}`)}
            className={`py-2 -mb-px border-b-2 whitespace-nowrap shrink-0 ${valid === t.key ? "border-green-600 text-green-700" : "border-transparent text-admin-text-2 hover:text-admin-text"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {valid === "robots" && <RobotsTab />}
      {valid === "chargers" && <ChargersTab />}
      {valid === "stations" && <StationsTab />}
      {valid === "scenarios" && <ScenariosTab />}
      {valid === "system" && <SystemTab />}
    </AdminShell>
  );
}

export default function ResourcesPage() {
  return (
    <Suspense fallback={<div className="page-admin flex-1" />}>
      <ResourcesInner />
    </Suspense>
  );
}
