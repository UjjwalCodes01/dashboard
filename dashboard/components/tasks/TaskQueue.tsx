"use client";

import Link from "next/link";
import { useState } from "react";
import { useThrottled } from "@/lib/hooks";
import { PHASE_COLORS, PHASE_LABELS } from "@/lib/theme";
import { fmtSimTime } from "@/lib/format";
import type { TaskMsg, TaskPhase } from "@/lib/types";

const STEPS: TaskPhase[] = ["announced", "bidding", "assigned", "in_progress", "done"];
const RANK: Record<TaskPhase, number> = { announced: 0, rebid: 0, bidding: 1, assigned: 2, in_progress: 3, done: 4 };

function Timeline({ t }: { t: TaskMsg }) {
  const rank = RANK[t.phase];
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((s, i) => {
        const reached = rank >= i;
        const current = RANK[t.phase] === i && t.phase !== "done";
        const color = reached ? PHASE_COLORS[s] : "#d1d5db";
        return (
          <div key={s} className="flex items-center">
            <div
              className={`h-2.5 w-2.5 rounded-full ${current ? "pulse" : ""}`}
              style={{ background: color, boxShadow: current ? `0 0 6px ${color}` : undefined }}
              title={PHASE_LABELS[s]}
            />
            {i < STEPS.length - 1 && <div className="h-px w-5" style={{ background: rank > i ? PHASE_COLORS[STEPS[i + 1]] : "#e5e7eb" }} />}
          </div>
        );
      })}
    </div>
  );
}

export function TaskQueue({ light = true, limit = 40 }: { light?: boolean; limit?: number }) {
  const [onlyActive, setOnlyActive] = useState(true);
  const rows = useThrottled((s) => {
    const list = s.taskIds.map((id) => s.tasks[id]).filter(Boolean) as TaskMsg[];
    list.sort((a, b) => b.created_ts - a.created_ts);
    return list;
  }, 600);
  const filtered = (onlyActive ? rows.filter((t) => t.phase !== "done") : rows).slice(0, limit);
  const tx = light ? "text-admin-text" : "text-text";
  const tx2 = light ? "text-admin-text-2" : "text-text-2";

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={`flex items-center gap-3 px-3 py-2 text-[12px] ${tx2} border-b ${light ? "border-admin-line" : "border-panel-border"}`}>
        <span>
          <b className={tx}>{rows.filter((t) => t.phase !== "done").length}</b> open ·{" "}
          <b className={tx}>{rows.filter((t) => t.phase === "done").length}</b> done (recent)
        </span>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> open only
        </label>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <table className={`w-full text-[12px] ${light ? "admin-table" : ""}`}>
          <thead>
            <tr className={light ? "" : "text-text-2 text-left"}>
              <th className="px-3 py-1.5 font-medium">Task</th>
              <th className="px-2 py-1.5 font-medium">Template</th>
              <th className="px-2 py-1.5 font-medium">Route</th>
              <th className="px-2 py-1.5 font-medium">Lifecycle</th>
              <th className="px-2 py-1.5 font-medium">Bids (on-robot)</th>
              <th className="px-2 py-1.5 font-medium">Robot</th>
              <th className="px-3 py-1.5 font-medium">Timing</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const bids = Object.entries(t.bids).sort((a, b) => a[1] - b[1]);
              return (
                <tr key={t.task_id} className={light ? "" : "border-t border-panel-border/50"}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="mono font-semibold">{t.task_id}</span>
                      {t.priority === "urgent" && <span className="rounded bg-red-600 text-white text-[10px] px-1.5 py-px">urgent</span>}
                      {t.rebids > 0 && (
                        <span className="rounded bg-amber-500 text-white text-[10px] px-1.5 py-px" title="re-auctioned after release">
                          re-bid ×{t.rebids}
                        </span>
                      )}
                    </div>
                    {t.note && <div className={`text-[10px] ${tx2}`}>{t.note}</div>}
                  </td>
                  <td className={`px-2 py-2 ${tx2}`}>{t.template_name}</td>
                  <td className="px-2 py-2 mono">
                    {t.from} → {t.to}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <Timeline t={t} />
                      <span className="text-[11px] font-medium" style={{ color: PHASE_COLORS[t.phase] }}>
                        {PHASE_LABELS[t.phase]}
                      </span>
                    </div>
                    {t.steps_total > 0 && t.phase !== "done" && t.robot && (
                      <div className={`text-[10px] ${tx2}`}>
                        step {Math.min(t.steps_done + 1, t.steps_total)} / {t.steps_total}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {bids.length ? (
                      <div className="flex flex-wrap gap-1 max-w-[260px]">
                        {bids.map(([rid, v]) => {
                          const win = rid === t.winner;
                          return (
                            <span
                              key={rid}
                              className={`mono text-[10px] rounded px-1.5 py-px border ${
                                win ? "bg-green-600 text-white border-green-600" : light ? "bg-gray-50 border-gray-200 text-admin-text" : "bg-white/5 border-panel-border text-text"
                              }`}
                              title={win ? "lowest bid → self-assigned" : "bid"}
                            >
                              {rid.replace("AMR-", "")}:{v.toFixed(1)}
                              {win && " ✓"}
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <span className={`text-[11px] ${tx2}`}>{t.phase === "done" ? "—" : "waiting for idle robots…"}</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {t.robot ? (
                      <Link href={`/robots/${t.robot}`} className={`mono ${light ? "admin-link" : "text-accent hover:underline"}`}>
                        {t.robot}
                      </Link>
                    ) : (
                      <span className={tx2}>—</span>
                    )}
                  </td>
                  <td className={`px-3 py-2 mono text-[11px] ${tx2}`}>
                    {fmtSimTime(t.created_ts)}
                    {t.assigned_ts != null && <> · +{(t.assigned_ts - t.created_ts).toFixed(0)}s assign</>}
                    {t.done_ts != null && t.assigned_ts != null && <> · {(t.done_ts - t.assigned_ts).toFixed(0)}s run</>}
                  </td>
                </tr>
              );
            })}
            {!filtered.length && (
              <tr>
                <td colSpan={7} className={`px-3 py-6 text-center ${tx2}`}>
                  No tasks to show
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
