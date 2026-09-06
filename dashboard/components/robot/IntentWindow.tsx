"use client";

import { useFleetStore } from "@/lib/store";
import { shortLabel } from "@/lib/sim/map";
import { STATE_COLORS } from "@/lib/theme";
import { EmptyState } from "../ui";

export function IntentWindow({ robotId }: { robotId: string }) {
  const r = useFleetStore((s) => s.robots[robotId]);
  const map = useFleetStore((s) => s.map);
  const robots = useFleetStore((s) => s.robots);
  if (!r) return <EmptyState text="waiting for telemetry" />;
  if (!r.intent.length) return <EmptyState text={r.state === "offline" ? "robot offline — no intent broadcast" : "stationary — no cells claimed"} />;
  const v = Math.max(0.15, r.speed || 0.6);
  const acks = r.intent_acked_by;
  // which peers' intents overlap ours (visible conflict picture)
  const overlaps = new Map<string, string[]>();
  for (const nid of r.neighbours) {
    const n = robots[nid];
    if (!n) continue;
    for (const c of n.intent) {
      const k = `${c[0]},${c[1]}`;
      if (r.intent.some((m) => m[0] === c[0] && m[1] === c[1])) overlaps.set(k, [...(overlaps.get(k) ?? []), nid]);
    }
  }
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-1 px-3 pt-2 pb-1">
        {r.intent.map((c, i) => {
          const k = `${c[0]},${c[1]}`;
          const conflict = overlaps.has(k);
          return (
            <div
              key={k + i}
              className="flex-1 h-2 rounded-sm"
              style={{
                background: conflict ? "#F59E0B" : STATE_COLORS[r.state],
                opacity: 1 - i * 0.09,
                boxShadow: conflict ? "0 0 6px #F59E0B" : undefined,
              }}
              title={`${shortLabel(map!, c[0], c[1])}${conflict ? " — overlaps " + overlaps.get(k)!.join(", ") : ""}`}
            />
          );
        })}
        <span className="text-[10px] text-text-3 ml-1">{r.intent.length} cells claimed</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-[12px]">
          <thead className="text-text-2 text-left">
            <tr>
              <th className="font-medium px-3 py-1">#</th>
              <th className="font-medium px-2 py-1">Cell</th>
              <th className="font-medium px-2 py-1">Where</th>
              <th className="font-medium px-2 py-1">ETA</th>
              <th className="font-medium px-2 py-1">Acked by</th>
              <th className="font-medium px-3 py-1">Overlap</th>
            </tr>
          </thead>
          <tbody>
            {r.intent.map((c, i) => {
              const k = `${c[0]},${c[1]}`;
              const ov = overlaps.get(k);
              return (
                <tr key={k + i} className="border-t border-panel-border/50">
                  <td className="px-3 py-1 mono text-text-2">{i + 1}</td>
                  <td className="px-2 py-1 mono">({c[0]}, {c[1]})</td>
                  <td className="px-2 py-1 text-text-2">{map ? shortLabel(map, c[0], c[1]) : "—"}</td>
                  <td className="px-2 py-1 mono">+{((i + 1) / v).toFixed(1)} s</td>
                  <td className="px-2 py-1">
                    {acks.length ? (
                      <span className="flex gap-1 flex-wrap">
                        {acks.map((a) => (
                          <span key={a} className="mono text-[10px] rounded bg-charging/15 border border-charging/40 px-1 text-charging">
                            {a.replace("AMR-", "")}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-text-3 text-[11px]">{r.link_ok ? "no peers in range" : "link down · cached"}</span>
                    )}
                  </td>
                  <td className="px-3 py-1">
                    {ov ? (
                      <span className="text-blocked text-[11px]">⚠ {ov.map((x) => x.replace("AMR-", "")).join(", ")}</span>
                    ) : (
                      <span className="text-text-3">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
