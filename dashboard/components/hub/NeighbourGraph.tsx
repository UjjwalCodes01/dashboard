"use client";

import { useThrottled } from "@/lib/hooks";
import { selectRobotList, useFleetStore } from "@/lib/store";
import { STATE_COLORS } from "@/lib/theme";

/**
 * Who hears whom: robots on a ring, an edge for every pair within comms range.
 * Deterministic layout (no force sim) so it reads at a glance.
 */
export function NeighbourGraph({ size = 200 }: { size?: number }) {
  const { robots, partitions } = useThrottled(
    (s) => ({ robots: selectRobotList(s), partitions: s.network?.partitions ?? [] }),
    700,
  );
  const selected = useFleetStore((s) => s.selectedRobotId);
  const select = useFleetStore((s) => s.select);
  const n = robots.length;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 26;
  const pos = new Map<string, { x: number; y: number }>();
  robots.forEach((r, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
    pos.set(r.robot_id, { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R });
  });
  const edges: { a: string; b: string }[] = [];
  const seen = new Set<string>();
  for (const r of robots)
    for (const nb of r.neighbours) {
      const key = r.robot_id < nb ? `${r.robot_id}|${nb}` : `${nb}|${r.robot_id}`;
      if (seen.has(key) || !pos.has(nb)) continue;
      seen.add(key);
      edges.push({ a: r.robot_id, b: nb });
    }
  const groupOf = (id: string) => partitions.findIndex((g) => g.includes(id));
  const groupColors = ["#22D3EE", "#F59E0B", "#A78BFA"];
  const totalPairs = (n * (n - 1)) / 2;

  return (
    <div className="flex items-center gap-3 px-2 py-1">
      <svg width={size} height={size} className="shrink-0">
        {edges.map((e) => {
          const a = pos.get(e.a)!;
          const b = pos.get(e.b)!;
          const strong = selected === e.a || selected === e.b;
          return (
            <line
              key={`${e.a}${e.b}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={strong ? "#67e8f9" : "rgba(34,211,238,0.35)"}
              strokeWidth={strong ? 2 : 1.2}
            />
          );
        })}
        {robots.map((r) => {
          const p = pos.get(r.robot_id)!;
          const g = groupOf(r.robot_id);
          const isSel = selected === r.robot_id;
          return (
            <g key={r.robot_id} onClick={() => select(isSel ? null : r.robot_id)} className="cursor-pointer">
              {g >= 0 && <circle cx={p.x} cy={p.y} r={15} fill="none" stroke={groupColors[g % 3]} strokeDasharray="3 2" />}
              <circle
                cx={p.x}
                cy={p.y}
                r={11}
                fill={STATE_COLORS[r.state]}
                stroke={isSel ? "#fff" : r.link_ok ? "#0B1220" : "#EF4444"}
                strokeWidth={isSel ? 2.5 : 1.5}
                strokeDasharray={r.link_ok ? undefined : "2 2"}
              />
              <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill={r.state === "idle" || r.state === "blocked" ? "#111" : "#fff"} fontFamily="var(--font-jetbrains)">
                {r.robot_id.replace("AMR-", "")}
              </text>
              <text x={p.x} y={p.y + 24} textAnchor="middle" fontSize={8} fill="#94A3B8" fontFamily="var(--font-jetbrains)">
                {r.neighbours.length}p
              </text>
            </g>
          );
        })}
      </svg>
      <div className="text-[11px] text-text-2 space-y-1">
        <div>
          <span className="mono text-text">{edges.length}</span> / {totalPairs} pairs in range
        </div>
        <div>
          links up: <span className="mono text-text">{robots.filter((r) => r.link_ok).length}</span> / {n}
        </div>
        {partitions.length > 0 && (
          <div className="text-blocked">
            {partitions.length} partitions
            <div className="text-[10px] text-text-3">dashed ring = group</div>
          </div>
        )}
        <div className="text-[10px] text-text-3 pt-1">
          Every robot plans from what it can hear. No node is special.
        </div>
      </div>
    </div>
  );
}
