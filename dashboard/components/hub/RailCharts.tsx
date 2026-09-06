"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useThrottled } from "@/lib/hooks";
import { selectRobotList } from "@/lib/store";
import { batteryColor } from "@/lib/theme";

const tick = { fill: "#94A3B8", fontSize: 9, fontFamily: "var(--font-jetbrains)" };

function Tip({ active, payload, label, unit }: { active?: boolean; payload?: { value: number }[]; label?: string; unit: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-panel-border bg-[#0d1528]/95 px-2 py-1 text-[11px]">
      <span className="mono">{label}</span>: <span className="mono">{payload[0].value}</span> {unit}
    </div>
  );
}

export function TasksCompletedChart({ height = 150 }: { height?: number }) {
  const data = useThrottled(
    (s) => selectRobotList(s).map((r) => ({ id: r.robot_id.replace("AMR-", "AMR"), v: r.tasks_done })).sort((a, b) => b.v - a.v),
    1000,
  );
  return (
    <div style={{ height }} className="px-1 pt-1">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 6, left: -26, bottom: 0 }} barCategoryGap="30%">
          <XAxis dataKey="id" tick={tick} axisLine={{ stroke: "#1E2A45" }} tickLine={false} interval={0} />
          <YAxis tick={tick} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<Tip unit="tasks" />} />
          <Bar dataKey="v" fill="#3B82F6" radius={[2, 2, 0, 0]} isAnimationActive={false} minPointSize={1} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BatteryChart({ height = 150 }: { height?: number }) {
  const data = useThrottled(
    (s) => selectRobotList(s).map((r) => ({ id: r.robot_id.replace("AMR-", "AMR"), v: Math.round(r.battery_pct) })).sort((a, b) => a.v - b.v),
    1000,
  );
  return (
    <div style={{ height }} className="px-1 pt-1">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 6, left: -26, bottom: 0 }} barCategoryGap="30%">
          <XAxis dataKey="id" tick={tick} axisLine={{ stroke: "#1E2A45" }} tickLine={false} interval={0} />
          <YAxis domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} tick={tick} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<Tip unit="%" />} />
          <Bar dataKey="v" radius={[2, 2, 0, 0]} isAnimationActive={false} minPointSize={1}>
            {data.map((d) => (
              <Cell key={d.id} fill={batteryColor(d.v)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
