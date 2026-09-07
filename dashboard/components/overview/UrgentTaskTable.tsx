"use client";

import Link from "next/link";
import { useThrottled } from "@/lib/hooks";
import { locationCode } from "@/lib/sim/map";
import { STATE_COLORS } from "@/lib/theme";
import type { TaskMsg } from "@/lib/types";
import { EmptyState } from "../ui";

function RobotGlyph({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-3 w-3 rounded-[3px] border border-black/40"
      style={{ background: color, boxShadow: `0 0 6px ${color}88` }}
    />
  );
}

export function UrgentTaskTable({ limit = 7 }: { limit?: number }) {
  const rows = useThrottled((s) => {
    const list = s.taskIds
      .map((id) => s.tasks[id])
      .filter((t): t is TaskMsg => !!t && t.priority === "urgent" && t.phase !== "done");
    const order = (t: TaskMsg) =>
      t.phase === "in_progress" || t.phase === "assigned" ? 0 : t.phase === "bidding" ? 1 : t.phase === "rebid" ? 2 : 3;
    list.sort((a, b) => order(a) - order(b) || a.created_ts - b.created_ts);
    return list.slice(0, limit).map((t) => {
      const r = t.robot ? s.robots[t.robot] : undefined;
      return {
        task: t,
        robot: r,
        loc: r && s.map ? locationCode(s.map, r.cell[0], r.cell[1]) : null,
        target: t.robot ? (r?.task?.step.replace("Navigate → ", "") ?? t.to) : t.to,
        stops: Math.max(0, t.steps_total - t.steps_done),
        bid: t.winner && t.bids[t.winner] != null ? t.bids[t.winner] : null,
        bidders: Object.keys(t.bids).length,
      };
    });
  }, 700);

  if (!rows.length) return <EmptyState text="No urgent tasks in the queue" />;
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="text-text-2 text-left">
          <th className="font-medium px-3 py-1.5">Vehicle</th>
          <th className="hidden sm:table-cell font-medium px-2 py-1.5">Current location</th>
          <th className="font-medium px-2 py-1.5">Target</th>
          <th className="font-medium px-2 py-1.5 text-right">Stops</th>
          <th className="font-medium px-3 py-1.5 text-right">Assigned by</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ task, robot, loc, target, stops, bid, bidders }) => (
          <tr key={task.task_id} className="border-t border-panel-border/60 hover:bg-white/[0.03]">
            <td className="px-3 py-2 whitespace-nowrap">
              {robot ? (
                <Link href={`/robots/${robot.robot_id}`} className="flex items-center gap-2 hover:text-accent">
                  <RobotGlyph color={STATE_COLORS[robot.state]} />
                  <span className="mono">{robot.robot_id}</span>
                </Link>
              ) : (
                <span className="flex items-center gap-2 text-text-2">
                  <RobotGlyph color="#475569" />
                  <span className="mono">{task.task_id}</span>
                </span>
              )}
            </td>
            <td className="hidden sm:table-cell px-2 py-2 mono text-text-2">{loc ?? (task.phase === "bidding" ? "bids open" : "announced")}</td>
            <td className="px-2 py-2 mono">{target}</td>
            <td className="px-2 py-2 mono text-right">{stops}</td>
            <td className="px-3 py-2 text-right text-text-2">
              {bid != null ? (
                <span title={`${bidders} bid(s) received`}>
                  auction · <span className="mono text-accent">{bid.toFixed(1)}</span>
                </span>
              ) : (
                <span className="text-text-3">auction · pending</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
