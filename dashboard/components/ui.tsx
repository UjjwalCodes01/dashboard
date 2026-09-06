"use client";

import type { ReactNode } from "react";
import type { RobotState } from "@/lib/types";
import { STATE_COLORS, STATE_LABELS } from "@/lib/theme";

export function Panel({
  title,
  right,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`panel flex flex-col ${className}`}>
      {title !== undefined && (
        <div className="panel-header">
          <div className="panel-title">{title}</div>
          <div className="flex-1" />
          {right}
        </div>
      )}
      <div className={`flex-1 min-h-0 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function StateDot({ state, size = 8 }: { state: RobotState; size?: number }) {
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{
        width: size,
        height: size,
        background: STATE_COLORS[state],
        boxShadow: `0 0 6px ${STATE_COLORS[state]}88`,
      }}
    />
  );
}

export function StateChip({ state, compact = false }: { state: RobotState; compact?: boolean }) {
  const c = STATE_COLORS[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded ${compact ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]"} font-medium`}
      style={{ color: c, background: `${c}1f`, border: `1px solid ${c}55` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {STATE_LABELS[state]}
    </span>
  );
}

export function BatteryBar({
  pct,
  width = 64,
  showText = true,
  dark = true,
}: {
  pct: number;
  width?: number;
  showText?: boolean;
  dark?: boolean;
}) {
  const color = pct <= 20 ? "#EF4444" : pct <= 40 ? "#F59E0B" : "#22C55E";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="relative inline-block h-3 rounded-[3px] border"
        style={{
          width,
          borderColor: dark ? "#3b4a6b" : "#9ca3af",
          background: dark ? "#0b1220" : "#f3f4f6",
        }}
      >
        <span
          className="absolute inset-y-[1px] left-[1px] rounded-[2px]"
          style={{ width: `calc(${Math.max(0, Math.min(100, pct))}% - 2px)`, background: color }}
        />
        <span
          className="absolute -right-[3px] top-[3px] h-[5px] w-[2px] rounded-r"
          style={{ background: dark ? "#3b4a6b" : "#9ca3af" }}
        />
      </span>
      {showText && <span className="mono text-[12px]">{pct.toFixed(0)}%</span>}
    </span>
  );
}

export function Pill({
  children,
  ok = true,
  tone,
  className = "",
}: {
  children: ReactNode;
  ok?: boolean;
  tone?: "green" | "amber" | "red" | "blue" | "grey" | "cyan";
  className?: string;
}) {
  const t = tone ?? (ok ? "green" : "red");
  const map = {
    green: "bg-[#16a34a] text-white",
    amber: "bg-[#d97706] text-white",
    red: "bg-[#dc2626] text-white",
    blue: "bg-[#2563eb] text-white",
    grey: "bg-[#6b7280] text-white",
    cyan: "bg-[#0891b2] text-white",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-[3px] text-[11px] font-medium ${map[t]} ${className}`}>
      {children}
    </span>
  );
}

export function KV({
  k,
  v,
  mono = false,
  className = "",
}: {
  k: ReactNode;
  v: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-[3px] ${className}`}>
      <span className="text-text-2 text-[12px] shrink-0">{k}</span>
      <span className={`text-[12px] text-right truncate ${mono ? "mono" : ""}`}>{v}</span>
    </div>
  );
}

export function Toggle({
  on,
  onChange,
  danger = false,
  label,
  title,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  danger?: boolean;
  label?: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 text-[12px]"
      onClick={() => onChange(!on)}
      title={title}
    >
      <span className="toggle" data-on={on} data-danger={danger} />
      {label}
    </button>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="h-full min-h-[80px] flex items-center justify-center text-text-3 text-[12px]">
      {text}
    </div>
  );
}

export function ResultBadge({ result }: { result: "PASS" | "WARN" | "FAIL" }) {
  const c = result === "PASS" ? "#16a34a" : result === "WARN" ? "#d97706" : "#dc2626";
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold text-[12px]" style={{ color: c }}>
      <span className="h-2 w-2 rounded-full" style={{ background: c }} />
      {result}
    </span>
  );
}
