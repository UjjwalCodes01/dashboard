"use client";

import { useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Ban, Eraser, GitFork, Power, ShieldAlert, Unplug } from "lucide-react";
import { MapCanvas } from "@/components/map/MapCanvas";
import { EventLog } from "@/components/EventLog";
import { LegendInline } from "@/components/Legend";
import { Panel, StateChip, Toggle } from "@/components/ui";
import { useThrottled } from "@/lib/hooks";
import { selectRobotList, useFleetStore } from "@/lib/store";
import { STATE_COLORS } from "@/lib/theme";

const SERIES_COLORS = ["#22D3EE", "#3B82F6", "#22C55E", "#A78BFA", "#F59E0B", "#FB923C", "#EF4444", "#F472B6", "#84CC16", "#14B8A6", "#E879F9", "#FCD34D"];

export default function NetworkPage() {
  const send = useFleetStore((s) => s.send);
  const robots = useThrottled(selectRobotList, 600);
  const network = useThrottled((s) => s.network, 600);
  const fleet = useThrottled((s) => s.fleet, 800);
  const simNow = useThrottled((s) => s.clock?.ts ?? 0, 600);
  const history = useThrottled((s) => s.history, 1000);
  const [blockMode, setBlockMode] = useState(false);
  const [loss, setLoss] = useState(network?.loss_pct ?? 0);
  const [latency, setLatency] = useState(network?.latency_ms ?? 0);

  const chartData = useMemo(() => {
    const ids = robots.map((r) => r.robot_id);
    const len = Math.max(0, ...ids.map((id) => history[id]?.length ?? 0));
    const rows: Record<string, number>[] = [];
    for (let i = Math.max(0, len - 60); i < len; i++) {
      const row: Record<string, number> = { t: i };
      let total = 0;
      for (const id of ids) {
        const h = history[id];
        const s = h ? h[h.length - (len - i)] : undefined;
        row[id] = s ? s.msgs : 0;
        total += row[id];
      }
      row.total = Math.round(total * 10) / 10;
      rows.push(row);
    }
    return rows;
  }, [robots, history]);

  const partitioned = (network?.partitions.length ?? 0) > 0;
  const blockedCount = network?.blocked_cells.length ?? 0;

  return (
    <main className="page-dark dash-main">
      <div className="flex flex-wrap items-center gap-2 lg:gap-3 px-3 lg:px-4 py-2 border-b border-panel-border/70">
        <ShieldAlert className="h-4 w-4 text-blocked" />
        <h1 className="text-[15px] font-semibold">Fault injection — the only controls on this system</h1>
        <span className="hidden 2xl:inline text-[12px] text-text-2">Break the network, block aisles, kill robots. Watch the fleet keep moving and the collision counter stay at 0.</span>
        <div className="flex-1" />
        <div
          className="rounded-md border px-3 py-1.5 text-[12px]"
          style={{ borderColor: (fleet?.collisions ?? 0) > 0 ? "#EF4444" : "rgba(34,197,94,0.5)", background: (fleet?.collisions ?? 0) > 0 ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.06)" }}
        >
          Collisions <span className={`mono text-[16px] font-semibold ml-1 ${(fleet?.collisions ?? 0) > 0 ? "text-offline" : "text-charging"}`}>{fleet?.collisions ?? 0}</span>
        </div>
      </div>

      <div className="flex-1 lg:min-h-0 lg:overflow-y-auto xl:overflow-visible grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 p-3">
        {/* left */}
        <div className="flex flex-col gap-3 xl:min-h-0">
          <Panel title="Per-robot links" bodyClassName="overflow-x-auto" right={<span className="text-[10px] text-text-3">toggle off = kill link · robot keeps moving on cached intent + ORCA</span>}>
            <table className="w-full text-[12px]">
              <thead className="text-text-2 text-left">
                <tr>
                  <th className="font-medium px-3 py-1.5">Robot</th>
                  <th className="font-medium px-2 py-1.5">State</th>
                  <th className="font-medium px-2 py-1.5">Link</th>
                  <th className="hidden md:table-cell font-medium px-2 py-1.5 text-right">msgs/s</th>
                  <th className="hidden md:table-cell font-medium px-2 py-1.5 text-right">last seen</th>
                  <th className="hidden md:table-cell font-medium px-2 py-1.5 text-right">peers</th>
                  <th className="hidden md:table-cell font-medium px-2 py-1.5 text-right">planner</th>
                  <th className="font-medium px-3 py-1.5 text-right">power</th>
                </tr>
              </thead>
              <tbody>
                {robots.map((r) => {
                  const up = network?.links[r.robot_id] ?? r.link_ok;
                  const disabled = network?.disabled.includes(r.robot_id) ?? false;
                  return (
                    <tr key={r.robot_id} className="border-t border-panel-border/50">
                      <td className="px-3 py-1.5 mono font-semibold whitespace-nowrap">
                        <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ background: STATE_COLORS[r.state] }} />
                        {r.robot_id}
                      </td>
                      <td className="px-2 py-1.5">
                        <StateChip state={r.state} compact />
                      </td>
                      <td className="px-2 py-1.5">
                        <Toggle on={up} danger onChange={(v) => send({ type: "fault", action: "toggle_link", target: r.robot_id, value: v })} label={<span className={up ? "text-charging" : "text-offline"}>{up ? "up" : "down"}</span>} title="Fault injection: kill / restore this robot's link" />
                      </td>
                      <td className="hidden md:table-cell px-2 py-1.5 mono text-right">{r.msgs_per_sec.toFixed(1)}</td>
                      <td className="hidden md:table-cell px-2 py-1.5 mono text-right text-text-2 whitespace-nowrap">{Math.max(0, simNow - r.ts).toFixed(1)} s</td>
                      <td className="hidden md:table-cell px-2 py-1.5 mono text-right">{r.neighbours.length}</td>
                      <td className="hidden md:table-cell px-2 py-1.5 mono text-right whitespace-nowrap">{r.planner_latency_ms.toFixed(1)} ms</td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          className={`dark-btn !py-[3px] ${disabled ? "dark-btn-danger" : ""}`}
                          onClick={() => send({ type: "fault", action: "disable_robot", target: r.robot_id, value: !disabled })}
                          title="Fault injection: simulate a robot failure"
                        >
                          <Power className="h-3 w-3" /> {disabled ? "revive" : "kill"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Panel title="Global conditions" right={<span className="text-[10px] text-text-3">mock now · tc netem later</span>}>
              <div className="p-3 space-y-3 text-[12px]">
                <label className="block">
                  <div className="flex justify-between text-text-2">
                    <span>Packet loss</span>
                    <span className="mono text-text">{loss}%</span>
                  </div>
                  <input type="range" min={0} max={60} value={loss} className="w-full accent-cyan-400" onChange={(e) => setLoss(Number(e.target.value))} onMouseUp={() => send({ type: "fault", action: "set_loss", value: loss })} onTouchEnd={() => send({ type: "fault", action: "set_loss", value: loss })} />
                </label>
                <label className="block">
                  <div className="flex justify-between text-text-2">
                    <span>Added latency</span>
                    <span className="mono text-text">{latency} ms</span>
                  </div>
                  <input type="range" min={0} max={500} step={10} value={latency} className="w-full accent-cyan-400" onChange={(e) => setLatency(Number(e.target.value))} onMouseUp={() => send({ type: "fault", action: "set_latency", value: latency })} onTouchEnd={() => send({ type: "fault", action: "set_latency", value: latency })} />
                </label>
                <div className="text-[10px] text-text-3">Discovery traffic: <span className="mono text-text-2">{network?.discovery_msgs_per_sec ?? 0} msg/s</span> · total <span className="mono text-text-2">{fleet?.msgs_per_sec_total ?? 0} msg/s</span></div>
              </div>
            </Panel>
            <Panel title="Topology faults">
              <div className="p-3 space-y-2">
                <button className="dark-btn w-full justify-start" data-active={blockMode} onClick={() => setBlockMode((v) => !v)} title="Then click cells on the map to block / unblock them">
                  <Ban className="h-3.5 w-3.5" /> Block aisle {blockMode ? "— click cells on the map →" : ""}
                  <span className="ml-auto mono text-text-2">{blockedCount} blocked</span>
                </button>
                <button className="dark-btn w-full justify-start" onClick={() => send({ type: "fault", action: "unblock_all" })} disabled={!blockedCount}>
                  <Eraser className="h-3.5 w-3.5" /> Clear all blocks
                </button>
                <button className="dark-btn w-full justify-start" data-active={partitioned} onClick={() => send({ type: "fault", action: "partition", value: partitioned ? false : true })}>
                  <GitFork className="h-3.5 w-3.5" /> {partitioned ? "Heal partition" : "Partition fleet (two groups)"}
                </button>
                <div className="flex items-center gap-2 text-[10px] text-text-3 pt-1">
                  <Unplug className="h-3 w-3" /> Each control is a fault, not a command. Robots respond on their own.
                </div>
              </div>
            </Panel>
          </div>

          <Panel className="h-[220px] xl:h-auto xl:flex-1 xl:min-h-[180px]" title="Messages per second" right={<span className="text-[10px] text-text-3">intent broadcast per robot · last 60 s</span>}>
            <div className="h-full w-full p-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 6, right: 10, left: -22, bottom: 0 }}>
                  <XAxis dataKey="t" hide />
                  <YAxis tick={{ fill: "#94A3B8", fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "#0d1528", border: "1px solid #1E2A45", fontSize: 11 }} labelFormatter={() => ""} />
                  {robots.map((r, i) => (
                    <Line key={r.robot_id} type="monotone" dataKey={r.robot_id} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} dot={false} strokeWidth={1.5} isAnimationActive={false} />
                  ))}
                  <Line type="monotone" dataKey="total" stroke="#E5E7EB" strokeDasharray="4 3" dot={false} strokeWidth={1} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>

        {/* right */}
        <div className="flex flex-col gap-3 xl:min-h-0">
          <Panel
            className="h-[55vh] min-h-[320px] xl:h-auto xl:flex-[3] xl:min-h-0"
            title={blockMode ? "Fleet map — click a cell to block / unblock" : "Fleet map"}
            right={<LegendInline showCounts={false} />}
            bodyClassName="relative"
          >
            <MapCanvas className="absolute inset-0" compact onCellClick={blockMode ? (cell) => send({ type: "fault", action: "block_cell", cell }) : undefined} showLinks />
            {blockMode && <div className="absolute top-2 left-2 rounded bg-offline/20 border border-offline/60 px-2 py-1 text-[11px] text-[#fecaca]">block mode · click free cells</div>}
          </Panel>
          <Panel className="h-[300px] xl:h-auto xl:flex-[2] xl:min-h-0" title="Network & conflict events">
            <EventLog compact limit={80} />
          </Panel>
        </div>
      </div>
    </main>
  );
}
