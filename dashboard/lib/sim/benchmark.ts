"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FleetEngine } from "./engine";
import type { ScenarioName } from "./scenarios";
import type { WarehouseMap } from "./map";
import type { BenchmarkMsg, BenchmarkSide, Cell, RobotStateMsg } from "../types";
import { useFleetStore } from "../store";

export interface BenchmarkConfig {
  scenario: ScenarioName;
  seed: number;
  taskCount: number;
  speed: number; // sim seconds per real second
  runs: number; // consecutive seeds seed, seed+1, …
  overlapping: boolean; // tasks drawn from stations that share aisles (the PS success criterion)
  robotCount: number;
  /** baseline variant: false = naive stop-and-wait (the PS baseline), true = central zone-lock controller */
  zoneLock: boolean;
}

export interface SideState {
  robots: RobotStateMsg[];
  blocked: Cell[];
  stats: ReturnType<FleetEngine["stats"]>;
}

export interface RunResult {
  seed: number;
  baseline: BenchmarkSide;
  ours: BenchmarkSide;
  improvement_pct: number;
  baselineTimedOut: boolean;
  oursTimedOut: boolean;
}

export interface Aggregate {
  n: number;
  mean_pct: number;
  std_pct: number;
  baselineTimeouts: number;
  oursTimeouts: number;
  /** per metric mean and std for both sides */
  metrics: Record<string, { b: number; bStd: number; o: number; oStd: number }>;
}

export const MAX_SIM_S = 1500;

function emptySide(): BenchmarkSide {
  return {
    elapsed_s: 0,
    tasks_done: 0,
    tasks_total: 0,
    stop_time_s: 0,
    collisions: 0,
    deadlocks: 0,
    mean_resolution_s: 0,
    sum_costs: 0,
    path_deviation_pct: 0,
    choke_flow_per_min: 0,
    planner_p50_ms: 0,
    planner_p95_ms: 0,
    msgs_per_robot: 0,
    progress: 0,
    finished: false,
  };
}

function emptyStats(): ReturnType<FleetEngine["stats"]> {
  return { ...emptySide() };
}

function snap(e: FleetEngine): SideState {
  const blocked: Cell[] = [];
  for (const i of e.blocked) blocked.push([i % e.map.width, Math.floor(i / e.map.width)]);
  return { robots: e.snapshot(), blocked, stats: e.stats() };
}

function meanStd(xs: number[]) {
  const n = xs.length || 1;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { mean, std };
}

export function aggregate(results: RunResult[]): Aggregate | null {
  if (!results.length) return null;
  const imp = meanStd(results.map((r) => r.improvement_pct));
  const metrics: Aggregate["metrics"] = {};
  const keys = Object.keys(emptySide()) as (keyof BenchmarkSide)[];
  for (const k of keys) {
    if (k === "finished") continue;
    const b = meanStd(results.map((r) => Number(r.baseline[k])));
    const o = meanStd(results.map((r) => Number(r.ours[k])));
    metrics[k] = { b: b.mean, bStd: b.std, o: o.mean, oStd: o.std };
  }
  return {
    n: results.length,
    mean_pct: imp.mean,
    std_pct: imp.std,
    baselineTimeouts: results.filter((r) => r.baselineTimedOut).length,
    oursTimeouts: results.filter((r) => r.oursTimedOut).length,
    metrics,
  };
}

/**
 * Runs two engines in lockstep from the same seed: zone-lock stop-and-wait baseline vs ours.
 * Same map, same tasks, same seed — only the coordination rules differ. Optionally repeats
 * over consecutive seeds and reports mean ± std.
 */
export function useBenchmarkRun(map: WarehouseMap | null) {
  const baseRef = useRef<FleetEngine | null>(null);
  const oursRef = useRef<FleetEngine | null>(null);
  const baseSide = useRef<SideState>({ robots: [], blocked: [], stats: emptyStats() });
  const oursSide = useRef<SideState>({ robots: [], blocked: [], stats: emptyStats() });
  const versionRef = useRef(0);
  const cfgRef = useRef<BenchmarkConfig | null>(null);
  const runIndexRef = useRef(0);
  const resultsRef = useRef<RunResult[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [running, setRunning] = useState(false);
  const [tick, setTick] = useState(0);
  const [sides, setSides] = useState<{ baseline: SideState; ours: SideState }>({
    baseline: { robots: [], blocked: [], stats: emptyStats() },
    ours: { robots: [], blocked: [], stats: emptyStats() },
  });
  const [config, setConfig] = useState<BenchmarkConfig | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);
  const [currentSeed, setCurrentSeed] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const [nextSeed, setNextSeed] = useState<number | null>(null);

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const stop = useCallback(() => {
    clearTimer();
    setRunning(false);
  }, []);

  const launch = useCallback(
    (cfg: BenchmarkConfig, seed: number) => {
      if (!map) return;
      clearTimer();
      setCurrentSeed(seed);
      const mk = (mode: "baseline" | "ours") =>
        new FleetEngine({
          map,
          seed,
          scenario: cfg.scenario,
          mode,
          robotCount: cfg.robotCount,
          zoneLock: cfg.zoneLock,
          onMessage: () => {},
          benchmark: { taskCount: cfg.taskCount, overlapping: cfg.overlapping },
        });
      baseRef.current = mk("baseline");
      oursRef.current = mk("ours");
      baseSide.current = snap(baseRef.current);
      oursSide.current = snap(oursRef.current);
      versionRef.current++;
      setSides({ baseline: baseSide.current, ours: oursSide.current });
      setTick((t) => t + 1);
      const intervalMs = 50;
      const ticksPerInterval = Math.max(1, Math.round((cfg.speed * intervalMs) / 1000 / 0.2));
      timer.current = setInterval(() => {
        const b = baseRef.current;
        const o = oursRef.current;
        if (!b || !o) return;
        for (let i = 0; i < ticksPerInterval; i++) {
          if (!b.isFinished && b.t < MAX_SIM_S) b.step(0.2);
          if (!o.isFinished && o.t < MAX_SIM_S) o.step(0.2);
        }
        baseSide.current = snap(b);
        oursSide.current = snap(o);
        versionRef.current++;
        setSides({ baseline: baseSide.current, ours: oursSide.current });
        setTick((t) => t + 1);
        const bDone = b.isFinished || b.t >= MAX_SIM_S;
        const oDone = o.isFinished || o.t >= MAX_SIM_S;
        if (bDone && oDone) {
          clearTimer();
          const bs = b.stats();
          const os = o.stats();
          const res: RunResult = {
            seed,
            baseline: { ...emptySide(), ...bs, finished: b.isFinished },
            ours: { ...emptySide(), ...os, finished: o.isFinished },
            improvement_pct: bs.elapsed_s > 0 ? ((bs.elapsed_s - os.elapsed_s) / bs.elapsed_s) * 100 : 0,
            baselineTimedOut: !b.isFinished,
            oursTimedOut: !o.isFinished,
          };
          resultsRef.current = [...resultsRef.current, res];
          setResults(resultsRef.current);
          runIndexRef.current++;
          if (runIndexRef.current < cfg.runs) {
            setNextSeed(cfg.seed + runIndexRef.current);
          } else {
            setRunning(false);
            setFinished(true);
            const agg = aggregate(resultsRef.current);
            const last = resultsRef.current[resultsRef.current.length - 1];
            if (agg && last) {
              const msg: BenchmarkMsg = {
                type: "benchmark",
                scenario: cfg.scenario,
                seed: cfg.seed,
                baseline: last.baseline,
                ours: last.ours,
                improvement_pct: Math.round(agg.mean_pct * 10) / 10,
                runs: agg.n,
                std_pct: Math.round(agg.std_pct * 10) / 10,
                running: false,
              };
              useFleetStore.getState().applyMessages([msg]);
            }
          }
        }
      }, intervalMs);
    },
    [map],
  );

  const start = useCallback(
    (cfg: BenchmarkConfig) => {
      if (!map) return;
      cfgRef.current = cfg;
      runIndexRef.current = 0;
      resultsRef.current = [];
      setConfig(cfg);
      setResults([]);
      setFinished(false);
      setRunning(true);
      launch(cfg, cfg.seed);
    },
    [map, launch],
  );

  // chain consecutive seeds without recursing inside the interval callback
  useEffect(() => {
    if (nextSeed == null || !cfgRef.current) return;
    const cfg = cfgRef.current;
    const seed = nextSeed;
    setNextSeed(null);
    launch(cfg, seed);
  }, [nextSeed, launch]);

  useEffect(() => () => clearTimer(), []);

  const sources = useMemo(
    () => ({
      baseline: {
        map: () => map,
        robots: () => baseSide.current.robots,
        blocked: () => baseSide.current.blocked,
        version: () => versionRef.current,
        selectedId: () => null,
      },
      ours: {
        map: () => map,
        robots: () => oursSide.current.robots,
        blocked: () => oursSide.current.blocked,
        version: () => versionRef.current,
        selectedId: () => null,
      },
    }),
    [map],
  );

  const agg = useMemo(() => aggregate(results), [results]);

  return {
    start,
    stop,
    running,
    finished,
    tick,
    results,
    aggregate: agg,
    currentSeed,
    runIndex: results.length,
    sources,
    baseline: sides.baseline,
    ours: sides.ours,
    config,
  };
}
