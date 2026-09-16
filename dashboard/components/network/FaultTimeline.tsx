"use client";

import { useMemo } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useThrottled } from "@/lib/hooks";
import { fmtSimTime } from "@/lib/format";

/**
 * What happened to the fleet while faults were being injected. Throughput dips and recovers;
 * the collision and worker-contact lines are supposed to stay flat on zero — that flat line *is*
 * the result.
 */
export function FaultTimeline() {
  const history = useThrottled((s) => s.fleetHistory, 1000);
  const events = useThrottled((s) => s.events, 1000);

  const data = useMemo(
    () => history.slice(-240).map((h) => ({ ts: h.ts, throughput: h.throughput, collisions: h.collisions, contacts: h.contacts, deadlocks: h.deadlocks })),
    [history],
  );
  const t0 = data.length ? data[0].ts : 0;
  const faults = useMemo(
    () =>
      events
        .filter((e) => e.ts >= t0 && e.level !== "info" && (e.category === "network" || e.category === "system" || e.category === "battery"))
        .slice(-12)
        .map((e) => ({ ts: e.ts, text: e.text })),
    [events, t0],
  );

  if (!data.length) return <div className="p-3 text-[11px] text-text-3">Collecting samples…</div>;
  return (
    <div className="h-full w-full p-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 14, right: 10, left: -22, bottom: 0 }}>
          <XAxis dataKey="ts" tickFormatter={(v) => fmtSimTime(Number(v))} tick={{ fill: "#94A3B8", fontSize: 9 }} axisLine={{ stroke: "#1E2A45" }} tickLine={false} minTickGap={40} />
          <YAxis tick={{ fill: "#94A3B8", fontSize: 9 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: "#0d1528", border: "1px solid #1E2A45", fontSize: 11 }}
            labelFormatter={(v) => `t = ${fmtSimTime(Number(v))}`}
            formatter={(val, name) => [val as number, name === "throughput" ? "tasks/min" : name === "collisions" ? "collisions" : name === "contacts" ? "worker contacts" : "conflicts resolved"]}
          />
          {faults.map((f, i) => (
            <ReferenceLine key={`${f.ts}-${i}`} x={f.ts} stroke="#F59E0B" strokeDasharray="3 3" label={{ value: "⚡", position: "top", fill: "#F59E0B", fontSize: 10 }} />
          ))}
          <Line type="monotone" dataKey="throughput" stroke="#22D3EE" dot={false} strokeWidth={1.6} isAnimationActive={false} />
          <Line type="stepAfter" dataKey="deadlocks" stroke="#A78BFA" dot={false} strokeWidth={1} isAnimationActive={false} />
          <Line type="stepAfter" dataKey="collisions" stroke="#EF4444" dot={false} strokeWidth={2} isAnimationActive={false} />
          <Line type="stepAfter" dataKey="contacts" stroke="#FB923C" dot={false} strokeWidth={1.4} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
