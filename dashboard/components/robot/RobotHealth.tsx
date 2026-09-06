"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Download } from "lucide-react";
import { useFleetStore } from "@/lib/store";
import { fmtSimTime } from "@/lib/format";
import type { CheckResult, HealthGroup, HealthItem } from "@/lib/types";
import { Pill, ResultBadge } from "../ui";
import { CameraView } from "./CameraGrid";

const GROUP_ORDER = ["Basic", "Lidar", "Camera", "Navigation", "Coordination"];

function groupResult(g: HealthGroup): CheckResult {
  if (g.items.some((i) => i.result === "FAIL")) return "FAIL";
  if (g.items.some((i) => i.result === "WARN")) return "WARN";
  return "PASS";
}

export function RobotHealth({ id }: { id: string }) {
  const report = useFleetStore((s) => s.health[id]);
  const robot = useFleetStore((s) => s.robots[id]);
  const info = useFleetStore((s) => s.robotInfo[id]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<{ group: string; item?: string } | null>(null);

  const groups = useMemo(
    () => (report ? [...report.groups].sort((a, b) => GROUP_ORDER.indexOf(a.name) - GROUP_ORDER.indexOf(b.name)) : []),
    [report],
  );
  const sel = selected ?? (groups.length ? { group: groups[0].name } : null);
  const selGroup = groups.find((g) => g.name === sel?.group);
  const detailItems: HealthItem[] = selGroup ? (sel?.item ? selGroup.items.filter((i) => i.item === sel.item) : selGroup.items) : [];
  const camera = detailItems.find((i) => i.camera)?.camera;

  const download = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${id}-health-${Math.floor(report.ts)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="page-admin dash-main">
      <div className="flex flex-wrap items-center gap-2 px-3 lg:px-4 py-2 bg-white border-b border-admin-line">
        <Pill tone="blue">Coordination: PIBT</Pill>
        <Pill tone={robot?.state === "idle" ? "amber" : "green"}>{robot ? robot.state.toUpperCase() : "—"}</Pill>
        {(report?.pills ?? []).slice(1).map((p) => (
          <Pill key={p.label} ok={p.ok}>
            {p.label}
          </Pill>
        ))}
        <div className="flex-1" />
        <span className="hidden xl:inline text-[11px] text-admin-text-2">reports are self-published by the robot every 60 s · no “run check now” command exists</span>
      </div>

      <div className="flex-1 lg:min-h-0 flex flex-col px-3 lg:px-6 py-3">
        <div className="flex items-center gap-3 mb-3">
          <Link href={`/robots/${id}`} className="text-admin-text-2 hover:text-admin-text">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="text-[16px] font-semibold">Health & Diagnostics — {id}</div>
          <div className="flex-1" />
          <span className="admin-link text-[12px]">View history results</span>
        </div>

        {!report ? (
          <div className="rounded-md border border-admin-line bg-white p-8 text-center text-admin-text-2">Waiting for {id} to publish its first health report…</div>
        ) : (
          <div className="flex-1 lg:min-h-0 grid grid-cols-1 xl:grid-cols-[520px_minmax(0,1fr)] gap-6">
            <div className="flex flex-col xl:min-h-0">
              <div className="flex flex-wrap items-center gap-3 lg:gap-4 mb-3 text-[13px]">
                <span>
                  Result: <ResultBadge result={report.overall} />
                </span>
                <span>
                  Time: <span className="font-semibold mono">{fmtSimTime(report.ts)}</span> <span className="text-admin-text-2">(sim)</span>
                </span>
                <div className="flex-1" />
                <button className="admin-btn admin-btn-primary" onClick={download}>
                  <Download className="h-4 w-4" /> Download
                </button>
              </div>
              <div className="flex-1 xl:min-h-0 xl:overflow-auto pr-1 space-y-3">
                {groups.map((g) => {
                  const res = groupResult(g);
                  const isCollapsed = collapsed[g.name];
                  const ours = g.name === "Coordination";
                  return (
                    <div key={g.name} className={`rounded-md border ${ours ? "border-cyan-200" : "border-admin-line"} bg-white overflow-hidden`}>
                      <button
                        className={`w-full flex items-center gap-3 px-3 py-2.5 ${ours ? "bg-cyan-50/60" : "bg-gray-50"} ${sel?.group === g.name && !sel?.item ? "ring-1 ring-inset ring-green-500" : ""}`}
                        onClick={() => {
                          setSelected({ group: g.name });
                        }}
                      >
                        <span className="h-3 w-3 rounded-full" style={{ background: res === "PASS" ? "#16a34a" : res === "WARN" ? "#d97706" : "#dc2626" }} />
                        <span className="font-semibold text-[14px]">{g.name}</span>
                        {ours && <span className="text-[10px] rounded bg-cyan-600 text-white px-1.5 py-px">edge coordination</span>}
                        <div className="flex-1" />
                        <span className="font-semibold text-[13px]" style={{ color: res === "PASS" ? "#16a34a" : res === "WARN" ? "#d97706" : "#dc2626" }}>
                          {res}
                        </span>
                        <span
                          className="text-admin-text-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCollapsed({ ...collapsed, [g.name]: !isCollapsed });
                          }}
                        >
                          {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                        </span>
                      </button>
                      {!isCollapsed && (
                        <ul>
                          {g.items.map((it) => {
                            const active = sel?.group === g.name && sel?.item === it.item;
                            return (
                              <li
                                key={it.item}
                                className={`flex items-center gap-3 pl-10 pr-3 py-2 border-t border-admin-line cursor-pointer hover:bg-gray-50 ${active ? "bg-gray-100" : ""}`}
                                onClick={() => setSelected({ group: g.name, item: it.item })}
                              >
                                <span className="h-2.5 w-2.5 rounded-full" style={{ background: it.result === "PASS" ? "#16a34a" : it.result === "WARN" ? "#d97706" : "#dc2626" }} />
                                <span className="text-[13px]">{it.item}</span>
                                <div className="flex-1" />
                                <span className="text-[12px] font-semibold" style={{ color: it.result === "PASS" ? "#16a34a" : it.result === "WARN" ? "#d97706" : "#dc2626" }}>
                                  {it.result}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="xl:min-h-0 xl:overflow-auto">
              <div className="font-semibold text-[14px] mb-2">
                {sel?.item ?? sel?.group}
                {sel?.item && <span className="text-admin-text-2 font-normal"> · {sel.group}</span>}
              </div>
              <div className="rounded-md border border-admin-line bg-white overflow-x-auto">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Detection item</th>
                      <th>Detection value</th>
                      <th>Standard value</th>
                      <th>Result</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailItems.map((it) => (
                      <tr key={it.item}>
                        <td>{it.item}</td>
                        <td className="mono">{it.value}</td>
                        <td className="mono">{it.standard}</td>
                        <td>
                          <ResultBadge result={it.result} />
                        </td>
                        <td className="text-admin-text-2 !whitespace-normal">{it.note ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {camera && (
                <div className="mt-4">
                  <div className="h-[340px] max-w-[620px] mx-auto">
                    <CameraView robotId={id} kind={camera} label={detailItems[0]?.item ?? "camera"} main />
                  </div>
                  <div className="text-center text-[11px] text-admin-text-2 mt-1">Image (simulated feed)</div>
                </div>
              )}
              {sel?.group === "Coordination" && (
                <div className="mt-4 rounded-md border border-cyan-200 bg-cyan-50/50 p-3 text-[12px] text-admin-text">
                  These checks are unique to a decentralised fleet: they verify that this robot can plan within its tick budget on the edge board, that its intent broadcast rate is high enough for peers to reserve around it, that it can discover peers, and that the ORCA safety filter is active for the moment the link drops.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <footer className="text-center text-[11px] text-admin-text-2 py-2 border-t border-admin-line bg-white">
        Software Version: fleet-edge 0.9.4 · Firmware: {info?.firmware ?? "—"} · Board: {info?.board ?? "—"} · Schema v1
      </footer>
    </main>
  );
}
