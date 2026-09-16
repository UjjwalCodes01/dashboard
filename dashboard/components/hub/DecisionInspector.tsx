"use client";

import { useFleetStore } from "@/lib/store";
import { shortLabel } from "@/lib/sim/map";

/** Colour and plain-English reading of a PIBT verdict. */
function verdictView(v: string): { label: string; cls: string } {
  if (v === "chosen") return { label: "chosen", cls: "text-charging border-charging/50 bg-charging/10" };
  if (v === "hold") return { label: "hold here", cls: "text-blocked border-blocked/50 bg-blocked/10" };
  if (v === "blocked") return { label: "aisle blocked", cls: "text-offline border-offline/50 bg-offline/10" };
  if (v === "obstacle") return { label: "body it can't talk to", cls: "text-degraded border-degraded/50 bg-degraded/10" };
  if (v === "unreachable") return { label: "goal unreachable", cls: "text-text-3 border-panel-border" };
  if (v === "open") return { label: "considered", cls: "text-text-2 border-panel-border" };
  if (v.startsWith("claimed:")) return { label: `claimed by ${v.slice(8)}`, cls: "text-accent border-accent/50 bg-accent/10" };
  if (v.startsWith("swap:")) return { label: `would swap with ${v.slice(5)}`, cls: "text-yielding border-yielding/50 bg-yielding/10" };
  if (v.startsWith("push-failed:")) return { label: `${v.slice(12)} couldn't move`, cls: "text-offline border-offline/50 bg-offline/10" };
  return { label: v, cls: "text-text-2 border-panel-border" };
}

/**
 * The planner showing its work for one robot, this tick: every cell it weighed, the exact distance
 * to its goal from there, and what happened to each one. Reads the live coordination feed, so it
 * also works while scrubbing a replay.
 */
export function DecisionInspector({ robotId, compact = false }: { robotId: string; compact?: boolean }) {
  const d = useFleetStore((s) => s.coordination?.decisions[robotId]);
  const r = useFleetStore((s) => s.robots[robotId]);
  const map = useFleetStore((s) => s.map);
  if (!r) return null;
  if (!d) {
    return (
      <div className="text-[11px] text-text-3">
        {r.state === "offline" ? "offline — not planning" : r.state === "charging" ? "docked — not planning" : "mid-crossing — reservation already held"}
      </div>
    );
  }
  const where = (c: [number, number]) => (map ? shortLabel(map, c[0], c[1]) : `${c[0]},${c[1]}`);
  const cap = r.orca_cap;
  const want = r.desired_speed;
  const capped = want > 0 && cap < want - 0.02;
  return (
    <div className="text-[11px] space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-text-2">
        <span>
          group <span className="mono text-text">#{d.group + 1}</span>
        </span>
        <span>
          priority <span className="mono text-text">{d.priority.toFixed(2)}</span>
        </span>
        {d.pushed_by && (
          <span className="text-blocked">
            pushed by <span className="mono">{d.pushed_by}</span>
          </span>
        )}
        {d.pushed && (
          <span className="text-charging">
            pushed <span className="mono">{d.pushed}</span>
          </span>
        )}
      </div>
      {d.candidates.length === 0 && (
        <div className="text-text-3">
          mid-crossing into <span className="mono text-text">{d.chosen ? where(d.chosen) : "—"}</span> — reservation already held, nothing to re-decide until it arrives
        </div>
      )}
      <ul className="space-y-0.5">
        {d.candidates.slice(0, compact ? 4 : 6).map((c) => {
          const v = verdictView(c.verdict);
          return (
            <li key={`${c.cell[0]},${c.cell[1]}`} className="flex items-center gap-2">
              <span className="mono w-[72px] shrink-0 text-text truncate" title={`cell ${c.cell[0]},${c.cell[1]}`}>
                {where(c.cell)}
              </span>
              <span className="mono w-9 shrink-0 text-right text-text-2" title="grid distance from that cell to the goal">
                {c.dist < 0 ? "∞" : c.dist}
              </span>
              <span className={`rounded border px-1.5 py-px text-[10px] truncate ${v.cls}`}>{v.label}</span>
            </li>
          );
        })}
      </ul>
      {d.held_reason && <div className="text-blocked">held: {d.held_reason}</div>}
      <div className="flex items-center gap-2 pt-0.5">
        <span className="text-text-2 shrink-0">ORCA</span>
        <div className="relative flex-1 h-1.5 rounded bg-white/10 overflow-hidden" title={`route wanted ${want.toFixed(2)} m/s · ORCA allowed ${cap.toFixed(2)} m/s`}>
          <div className="absolute inset-y-0 left-0 bg-white/15" style={{ width: `${Math.min(100, want * 100)}%` }} />
          <div className={`absolute inset-y-0 left-0 ${capped ? "bg-blocked" : "bg-charging"}`} style={{ width: `${Math.min(100, cap * 100)}%` }} />
        </div>
        <span className="mono text-text shrink-0">
          {cap.toFixed(2)}
          <span className="text-text-3">/{want.toFixed(2)} m/s</span>
        </span>
      </div>
    </div>
  );
}
