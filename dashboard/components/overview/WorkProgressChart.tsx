"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useThrottled } from "@/lib/hooks";
import { selectRobotList } from "@/lib/store";
import { STATE_COLORS, STATE_LABELS } from "@/lib/theme";
import type { RobotState } from "@/lib/types";

interface Row {
  id: string;
  short: string;
  progress: number;
  state: RobotState;
  battery: number;
  task: string;
  step: string;
}

function ChartTip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-md border border-panel-border bg-[#0d1528]/95 px-3 py-2 text-[11px] shadow-xl">
      <div className="mono font-semibold text-[12px] mb-1">{r.id}</div>
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATE_COLORS[r.state] }} />
        Status: {STATE_LABELS[r.state]}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-charging" />
        Battery: {r.battery.toFixed(0)}%
      </div>
      {r.task && (
        <div className="text-text-2 mt-0.5">
          {r.task} · {r.step} · {r.progress.toFixed(0)}%
        </div>
      )}
    </div>
  );
}

export function WorkProgressChart() {
  const robots = useThrottled(selectRobotList, 700);
  const data: Row[] = robots.map((r) => ({
    id: r.robot_id,
    short: r.robot_id.replace("AMR-", "AMR"),
    progress: r.task ? Math.round(r.task.progress * 100) : 0,
    state: r.state,
    battery: r.battery_pct,
    task: r.task?.id ?? "",
    step: r.task?.step ?? "",
  }));
  return (
    <div className="h-full w-full px-2 pt-2 pb-1 relative">
      <div className="absolute left-3 top-1 text-[10px] text-text-2">Progress %</div>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 16, right: 8, left: -22, bottom: 14 }} barCategoryGap="28%">
          <XAxis
            dataKey="short"
            tick={{ fill: "#94A3B8", fontSize: 9, fontFamily: "var(--font-jetbrains)" }}
            axisLine={{ stroke: "#1E2A45" }}
            tickLine={false}
            interval={0}
            label={{ value: "AMR ID", position: "insideBottom", offset: -8, fill: "#94A3B8", fontSize: 10 }}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 20, 40, 60, 80, 100]}
            tick={{ fill: "#94A3B8", fontSize: 9 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<ChartTip />} />
          <Bar dataKey="progress" radius={[2, 2, 0, 0]} isAnimationActive={false} minPointSize={2}>
            {data.map((d) => (
              <Cell key={d.id} fill={STATE_COLORS[d.state]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
