"use client";

import { useState } from "react";
import { Bar, BarChart, ErrorBar, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Play, Square, Timer } from "lucide-react";
import { MapCanvas } from "@/components/map/MapCanvas";
import { Panel } from "@/components/ui";
import { useFleetStore } from "@/lib/store";
import { useBenchmarkRun } from "@/lib/sim/benchmark";
import { SCENARIO_LIST, type ScenarioName } from "@/lib/sim/scenarios";
import { fmtMMSS } from "@/lib/format";

type Stats = ReturnType<typeof useBenchmarkRun>["baseline"]["stats"];

const METRICS: { key: keyof Stats; label: string; unit: string; digits: number; lowerBetter: boolean }[] = [
  { key: "elapsed_s", label: "Makespan", unit: "s", digits: 1, lowerBetter: true },
  { key: "sum_costs", label: "Sum of individual costs", unit: "cells", digits: 0, lowerBetter: true },
  { key: "tasks_done", label: "Tasks completed", unit: "", digits: 0, lowerBetter: false },
  { key: "collisions", label: "Collisions", unit: "", digits: 0, lowerBetter: true },
  { key: "deadlocks", label: "Conflicts resolved", unit: "", digits: 0, lowerBetter: true },
  { key: "mean_resolution_s", label: "Mean resolution time", unit: "s", digits: 1, lowerBetter: true },
  { key: "stop_time_s", label: "Total stop time", unit: "s", digits: 1, lowerBetter: true },
  { key: "path_deviation_pct", label: "Path deviation vs shortest", unit: "%", digits: 1, lowerBetter: true },
  { key: "choke_flow_per_min", label: "Choke-point flow rate", unit: "/min", digits: 1, lowerBetter: false },
  { key: "planner_p50_ms", label: "Planner latency p50", unit: "ms", digits: 1, lowerBetter: true },
  { key: "planner_p95_ms", label: "Planner latency p95", unit: "ms", digits: 1, lowerBetter: true },
  { key: "msgs_per_robot", label: "Msgs/s per robot", unit: "", digits: 1, lowerBetter: true },
];

function SideCard({ title, sub, stats, color, source, taskCount }: { title: string; sub: string; stats: Stats; color: string; source: Parameters<typeof MapCanvas>[0]["source"]; taskCount: number }) {
  const throughput = stats.elapsed_s > 0 ? (stats.tasks_done / stats.elapsed_s) * 60 : 0;
  return (
    <Panel
      className="min-h-0 flex-1"
      title={
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          {title}
        </span>
      }
      right={<span className="text-[10px] text-text-3">{sub}</span>}
      bodyClassName="flex flex-col"
    >
      <div className="flex items-center gap-4 px-3 py-2 border-b border-panel-border/60">
        <div className="flex items-center gap-1.5">
          <Timer className="h-4 w-4" style={{ color }} />
          <span className="mono text-[26px] font-semibold leading-none">{fmtMMSS(stats.elapsed_s)}</span>
          {stats.finished && <span className="text-[10px] rounded bg-charging/20 text-charging px-1.5 py-px ml-1">done</span>}
        </div>
        <div className="flex-1">
          <div className="flex justify-between text-[11px] text-text-2">
            <span>
              tasks {stats.tasks_done} / {taskCount}
            </span>
            <span>
              stop {stats.stop_time_s.toFixed(0)} s · {throughput.toFixed(1)} tasks/min
            </span>
          </div>
          <div className="h-2 rounded bg-white/10 overflow-hidden mt-1">
            <div className="h-full rounded transition-[width] duration-300" style={{ width: `${(stats.progress * 100).toFixed(1)}%`, background: color }} />
          </div>
        </div>
      </div>
      <div className="relative flex-1 min-h-[300px]">
        <MapCanvas className="absolute inset-0" compact interactive={false} selectable={false} source={source} showLinks={false} />
      </div>
    </Panel>
  );
}

export default function BenchmarkPage() {
  const map = useFleetStore((s) => s.map);
  const run = useBenchmarkRun(map);
  const [scenario, setScenario] = useState<ScenarioName>("normal");
  const [seed, setSeed] = useState(42);
  const [taskCount, setTaskCount] = useState(18);
  const [speed, setSpeed] = useState(8);
  const [runs, setRuns] = useState(3);
  const [overlapping, setOverlapping] = useState(true);
  const [robotCount, setRobotCount] = useState(8);
  const [zoneLock, setZoneLock] = useState(false);
  const b = run.baseline.stats;
  const o = run.ours.stats;
  const started = run.running || run.finished || b.elapsed_s > 0;
  const liveImprovement = b.elapsed_s > 0 && o.elapsed_s > 0 ? ((b.elapsed_s - o.elapsed_s) / b.elapsed_s) * 100 : null;
  const agg = run.aggregate;
  const shown = agg && (run.finished || agg.n > 0) ? agg.mean_pct : liveImprovement;
  const good = (shown ?? 0) >= 20;

  const errData = [
    { name: "Makespan (s)", key: "elapsed_s" },
    { name: "Stop time (s)", key: "stop_time_s" },
    { name: "Sum costs (cells)", key: "sum_costs" },
  ].map((d) => {
    const m = agg?.metrics[d.key];
    return {
      name: d.name,
      baseline: m ? m.b : Number(b[d.key as keyof Stats] ?? 0),
      ours: m ? m.o : Number(o[d.key as keyof Stats] ?? 0),
      bErr: m ? m.bStd : 0,
      oErr: m ? m.oStd : 0,
    };
  });

  return (
    <main className="page-dark dash-main">
      <div className="flex flex-wrap items-center gap-2 lg:gap-3 px-3 lg:px-4 py-2 border-b border-panel-border/70 text-[12px]">
        <h1 className="text-[15px] font-semibold mr-2">Benchmark — baseline vs ours</h1>
        <label className="flex items-center gap-1.5 text-text-2">
          Scenario
          <select className="dark-input" value={scenario} onChange={(e) => setScenario(e.target.value as ScenarioName)} disabled={run.running}>
            {SCENARIO_LIST.map((s) => (
              <option key={s.name} value={s.name}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-text-2">
          Seed
          <input className="dark-input w-[70px] mono" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} disabled={run.running} />
        </label>
        <label className="flex items-center gap-1.5 text-text-2">
          Tasks
          <input className="dark-input w-[60px] mono" type="number" min={4} max={60} value={taskCount} onChange={(e) => setTaskCount(Math.max(4, Math.min(60, Number(e.target.value) || 18)))} disabled={run.running} />
        </label>
        <label className="flex items-center gap-1.5 text-text-2">
          Runs
          <select className="dark-input" value={runs} onChange={(e) => setRuns(Number(e.target.value))} disabled={run.running}>
            {[1, 3, 5, 10].map((k) => (
              <option key={k} value={k}>
                n = {k}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-text-2">
          Traffic
          <select className="dark-input" value={overlapping ? "overlap" : "spread"} onChange={(e) => setOverlapping(e.target.value === "overlap")} disabled={run.running} title="Overlapping paths = tasks drawn from stations that share the same aisles (the PS success criterion)">
            <option value="overlap">overlapping paths</option>
            <option value="spread">spread out</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-text-2">
          Baseline
          <select className="dark-input" value={zoneLock ? "zone" : "naive"} onChange={(e) => setZoneLock(e.target.value === "zone")} disabled={run.running} title="Naive stop-and-wait is the baseline the problem statement names. The zone-lock controller is a stronger, centralised comparison.">
            <option value="naive">stop-and-wait</option>
            <option value="zone">zone-lock controller</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-text-2">
          Robots
          <select className="dark-input" value={robotCount} onChange={(e) => setRobotCount(Number(e.target.value))} disabled={run.running}>
            {[4, 6, 8, 10, 12].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-text-2">
          Speed
          <select className="dark-input" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} disabled={run.running}>
            {[2, 4, 8, 16, 32].map((k) => (
              <option key={k} value={k}>
                {k}×
              </option>
            ))}
          </select>
        </label>
        {!run.running ? (
          <button className="dark-btn !border-charging/60 !text-charging" onClick={() => run.start({ scenario, seed, taskCount, speed, runs, overlapping, robotCount, zoneLock })} disabled={!map}>
            <Play className="h-3.5 w-3.5" /> Run both
          </button>
        ) : (
          <button className="dark-btn dark-btn-danger" onClick={run.stop}>
            <Square className="h-3.5 w-3.5" /> Stop
          </button>
        )}
        <div className="flex-1" />
        <span className="hidden 2xl:inline text-text-2">
          Same map · same {taskCount} tasks · {robotCount} robots · seeds {seed}–{seed + runs - 1}. Only the coordination rules differ.
        </span>
      </div>

      <div className="flex-1 lg:min-h-0 lg:overflow-y-auto flex flex-col gap-3 p-3">
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_300px] gap-3 lg:min-h-[520px] lg:flex-1">
          <SideCard title={zoneLock ? "Zone-lock controller (baseline)" : "Stop-and-wait (baseline)"} sub={zoneLock ? "central zone lock · one robot per aisle · re-plan after timeout" : "no intent sharing · freezes when the next cell is taken · detour only after a 6 s deadlock timeout"} stats={b} color="#F59E0B" source={run.sources.baseline} taskCount={taskCount} />
          <SideCard title="Decentralised (ours)" sub="intent broadcast · aisle negotiation · priority inheritance · local re-plan · CNP re-bid" stats={o} color="#22D3EE" source={run.sources.ours} taskCount={taskCount} />
          <div className="grid grid-cols-1 sm:grid-cols-2 2xl:flex 2xl:flex-col gap-3 lg:col-span-2 2xl:col-span-1 min-h-0">
            <Panel title="Improvement" bodyClassName="p-4 flex flex-col items-center justify-center">
              <div className="mono text-[56px] font-semibold leading-none" style={{ color: good ? "#22C55E" : (shown ?? 0) > 0 ? "#FACC15" : "#94A3B8" }}>
                {shown != null ? `${shown >= 0 ? "+" : ""}${shown.toFixed(1)}%` : "—"}
              </div>
              <div className="text-[12px] text-text-2 mt-2 text-center">
                {run.finished ? "faster total task completion" : run.running ? `run ${run.runIndex + 1} / ${run.config?.runs ?? 1} · seed ${run.currentSeed ?? seed}` : "run to compare"}
              </div>
              <div className="text-[11px] text-text-3 mt-3 text-center">
                Target ≥ 20 % vs stop-and-wait on overlapping paths.
                {agg && agg.baselineTimeouts > 0 && (
                  <>
                    <br />
                    <span className="text-blocked">
                      baseline did not finish in {agg.baselineTimeouts} / {agg.n} run(s) — counted at the {1500} s cap
                    </span>
                  </>
                )}
                <br />
                {agg && agg.n > 1 ? (
                  <span className="mono text-text-2">
                    n = {agg.n} · mean {agg.mean_pct.toFixed(1)} % ± {agg.std_pct.toFixed(1)}
                  </span>
                ) : (
                  <span>Runs: n = {runs} · mean ± std shown when done</span>
                )}
              </div>
              {run.results.length > 0 && (
                <div className="mt-3 flex flex-wrap justify-center gap-1">
                  {run.results.map((r) => (
                    <span key={r.seed} className="mono text-[10px] rounded border border-panel-border px-1.5 py-px text-text-2" title={`seed ${r.seed}: baseline ${r.baseline.elapsed_s.toFixed(0)} s${r.baselineTimedOut ? " (did not finish)" : ""} · ours ${r.ours.elapsed_s.toFixed(0)} s${r.oursTimedOut ? " (did not finish)" : ""}`}>
                      #{r.seed} {r.improvement_pct >= 0 ? "+" : ""}
                      {r.improvement_pct.toFixed(0)}%{r.baselineTimedOut ? " ⚠" : ""}
                    </span>
                  ))}
                </div>
              )}
            </Panel>
            <Panel className="min-h-[220px] 2xl:flex-1" title={agg && agg.n > 1 ? `Spread · n = ${agg.n} · mean ± std` : "Spread (single run)"} right={<span className="text-[10px] text-text-3">amber baseline · cyan ours</span>}>
              <div className="h-full min-h-[200px] p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={errData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barCategoryGap="25%">
                    <XAxis dataKey="name" tick={{ fill: "#94A3B8", fontSize: 9 }} axisLine={{ stroke: "#1E2A45" }} tickLine={false} />
                    <YAxis tick={{ fill: "#94A3B8", fontSize: 9 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: "#0d1528", border: "1px solid #1E2A45", fontSize: 11 }} />
                    <Bar dataKey="baseline" fill="#F59E0B" isAnimationActive={false}>
                      <ErrorBar dataKey="bErr" stroke="#fde68a" width={4} />
                    </Bar>
                    <Bar dataKey="ours" fill="#22D3EE" isAnimationActive={false}>
                      <ErrorBar dataKey="oErr" stroke="#a5f3fc" width={4} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>
        </div>

        <Panel title="Metrics" right={<span className="text-[10px] text-text-3">{started ? `${scenario} · ${agg && agg.n > 1 ? `mean of ${agg.n} runs` : `seed ${run.currentSeed ?? seed}`}` : "not started"}</span>}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-6 px-3 py-2">
            {METRICS.map((m) => {
              const am = agg?.metrics[m.key];
              const bv = am && agg && agg.n > 1 ? am.b : Number(b[m.key] ?? 0);
              const ov = am && agg && agg.n > 1 ? am.o : Number(o[m.key] ?? 0);
              const better = m.lowerBetter ? ov < bv : ov > bv;
              const same = Math.abs(ov - bv) < 1e-9;
              return (
                <div key={m.key} className="flex items-center justify-between py-1 border-b border-panel-border/40 text-[12px]">
                  <span className="text-text-2">{m.label}</span>
                  <span className="flex items-center gap-3 mono">
                    <span className="text-blocked w-[74px] text-right">
                      {bv.toFixed(m.digits)}
                      <span className="text-[9px] text-text-3 ml-0.5">{m.unit}</span>
                    </span>
                    <span className={`w-[74px] text-right ${same ? "text-text" : better ? "text-charging" : "text-offline"}`}>
                      {ov.toFixed(m.digits)}
                      <span className="text-[9px] text-text-3 ml-0.5">{m.unit}</span>
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="px-3 pb-2 text-[10px] text-text-3">
            Baseline column amber · ours cyan/green. Both engines respect the same map and reserve cells before entry, so collisions are 0 for both; the difference is how conflicts are resolved and how long robots stand still. Round 1 runs the scripted movement model; Round 2 swaps in PIBT on the same harness.
          </div>
        </Panel>
      </div>
    </main>
  );
}
