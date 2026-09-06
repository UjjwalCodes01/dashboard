"use client";

export function Sparkline({
  values,
  width = 160,
  height = 40,
  color = "#22D3EE",
  min,
  max,
  refLine,
  fill = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  min?: number;
  max?: number;
  refLine?: number;
  fill?: boolean;
}) {
  if (!values.length) return <svg width={width} height={height} />;
  const lo = min ?? Math.min(...values);
  const hi = Math.max(max ?? Math.max(...values), lo + 1e-6);
  const pad = 2;
  const pts = values.map((v, i) => {
    const x = pad + (i / Math.max(1, values.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - lo) / (hi - lo)) * (height - pad * 2);
    return [x, y] as const;
  });
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${d} L${pts[pts.length - 1][0].toFixed(1)},${height - pad} L${pts[0][0].toFixed(1)},${height - pad} Z`;
  const refY = refLine != null ? height - pad - ((refLine - lo) / (hi - lo)) * (height - pad * 2) : null;
  return (
    <svg width={width} height={height} className="overflow-visible">
      {fill && <path d={area} fill={color} opacity={0.12} />}
      {refY != null && refY >= 0 && refY <= height && (
        <line x1={0} x2={width} y1={refY} y2={refY} stroke="#EF4444" strokeDasharray="3 3" opacity={0.7} />
      )}
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.2} fill={color} />
    </svg>
  );
}
