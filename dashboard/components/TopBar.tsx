"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { CalendarDays, Clock3, Download, Radio, ShieldCheck, SlidersHorizontal, WifiOff, X } from "lucide-react";
import { useFleetStore } from "@/lib/store";
import { SCENARIO_LIST, type ScenarioName } from "@/lib/sim/scenarios";
import { fmtDate, fmtSimTime, fmtWall } from "@/lib/format";
import { useWallClock } from "@/lib/hooks";
import { useInstallPrompt, useOnline } from "@/lib/pwa";
import { Logo } from "./Logo";

/** "Install app" — shown only where the browser offers a programmatic prompt and the app isn't already installed. */
function InstallButton({ className = "" }: { className?: string }) {
  const { canInstall, install } = useInstallPrompt();
  if (!canInstall) return null;
  return (
    <button className={`dark-btn !border-accent/50 !text-accent ${className}`} onClick={() => install()} title="Install Chakraview as an app — it runs fully offline">
      <Download className="h-3.5 w-3.5" /> Install app
    </button>
  );
}

const TABS: { href: string; label: string; match: (p: string) => boolean }[] = [
  { href: "/", label: "Overview", match: (p) => p === "/" },
  { href: "/hub", label: "Hub", match: (p) => p.startsWith("/hub") || p.startsWith("/robots") },
  { href: "/resources", label: "Resources", match: (p) => p.startsWith("/resources") },
  { href: "/tasks", label: "Tasks", match: (p) => p.startsWith("/tasks") },
  // Benchmark is hidden for Round 1 (route redirects to / in next.config.ts); restore the tab here to bring it back.
  { href: "/network", label: "Network", match: (p) => p.startsWith("/network") },
];

function SimControls({ column = false }: { column?: boolean }) {
  const scenario = useFleetStore((s) => s.scenario);
  const seed = useFleetStore((s) => s.seed);
  const timeScale = useFleetStore((s) => s.timeScale);
  const setScenario = useFleetStore((s) => s.setScenario);
  const setTimeScale = useFleetStore((s) => s.setTimeScale);
  return (
    <div className={`flex ${column ? "flex-col items-stretch gap-3" : "items-center gap-2"}`}>
      <label className={`flex items-center gap-1.5 text-[12px] text-text-2 ${column ? "justify-between" : ""}`}>
        <span className={column ? "" : "hidden xl:inline"}>Scenario</span>
        <select className="dark-input min-w-[150px]" value={scenario} onChange={(e) => setScenario(e.target.value as ScenarioName)}>
          {SCENARIO_LIST.map((s) => (
            <option key={s.name} value={s.name}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className={`flex items-center gap-1.5 text-[12px] text-text-2 ${column ? "justify-between" : ""}`}>
        seed
        <input className="dark-input w-[70px] mono" type="number" value={seed} onChange={(e) => setScenario(scenario, Number(e.target.value) || 0)} />
      </label>
      <div className={`flex items-center ${column ? "justify-between" : ""}`}>
        {column && <span className="text-[12px] text-text-2">sim speed</span>}
        <div className="flex items-center rounded-md border border-panel-border overflow-hidden">
          {[1, 2].map((k) => (
            <button key={k} onClick={() => setTimeScale(k)} className={`px-2.5 py-1 text-[11px] mono ${timeScale === k ? "bg-accent/15 text-accent" : "text-text-2 hover:text-text"}`} title="Sim speed (view control only)">
              {k}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TopBar() {
  const pathname = usePathname() ?? "/";
  const connected = useFleetStore((s) => s.connected);
  const transport = useFleetStore((s) => s.transport);
  const simTs = useFleetStore((s) => s.clock?.ts ?? null);
  const phase = useFleetStore((s) => s.clock?.scenario_phase ?? "");
  const wall = useWallClock();
  const online = useOnline();
  const [open, setOpen] = useState(false);

  return (
    <header className="relative z-40 border-b border-panel-border bg-[#0A1020]/95 backdrop-blur text-text">
      <div className="h-[52px] flex items-center gap-2 lg:gap-3 px-3 lg:px-4">
        <Link href="/" className="flex items-center gap-2.5 shrink-0 lg:w-[210px]">
          <Logo className="h-7 w-7" />
          <div className="leading-tight">
            <div className="font-semibold text-[15px] tracking-tight">
              Chakra<span className="text-accent">view</span>
            </div>
            <div className="hidden sm:block text-[10px] text-text-2 -mt-0.5 tracking-wide uppercase">Decentralised AMR monitor</div>
          </div>
        </Link>

        <nav className="hidden lg:flex items-center gap-1 ml-2">
          {TABS.map((t) => {
            const active = t.match(pathname);
            return (
              <Link key={t.href} href={t.href} className={`px-3 py-1.5 rounded-md text-[13px] transition-colors ${active ? "bg-accent/10 text-accent shadow-[inset_0_-2px_0_0_var(--accent)]" : "text-text-2 hover:text-text hover:bg-white/5"}`}>
                {t.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex-1" />

        <div className="hidden min-[1760px]:flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-charging/40 bg-charging/10 text-[11px] text-[#86efac] whitespace-nowrap shrink-0" title="The dashboard is a passive subscriber. It can inject faults and publish task templates into the fleet auction, but it never commands a robot.">
          <ShieldCheck className="h-3.5 w-3.5" />
          Read-only monitor · No central server
        </div>

        <div className="hidden lg:block">
          <SimControls />
        </div>

        <InstallButton className="hidden lg:inline-flex" />

        <div className="flex items-center gap-2 lg:pl-2 lg:border-l border-panel-border">
          <div className="flex items-center gap-1.5 text-[12px]">
            <Clock3 className="h-3.5 w-3.5 text-accent" />
            <span className="mono text-[13px]">{fmtSimTime(simTs)}</span>
            <span className="text-text-3 text-[10px] hidden 2xl:inline">sim · {phase}</span>
          </div>
          <div className="hidden xl:flex items-center gap-1.5 text-[12px] text-text-2">
            <CalendarDays className="h-3.5 w-3.5 text-accent" />
            <span className="mono">{wall ? `${fmtDate(wall)} ${fmtWall(wall)}` : "—"}</span>
          </div>
          {online ? (
            <div className="flex items-center gap-1.5 text-[11px] text-text-2" title={transport === "ws" ? "WebSocket telemetry" : "In-browser mock telemetry (final schema)"}>
              <Radio className="h-3.5 w-3.5 hidden sm:block" />
              <span className={`h-2 w-2 rounded-full ${connected ? "bg-charging pulse" : "bg-offline"}`} />
              <span className="uppercase tracking-wider hidden sm:inline">{transport}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-md border border-blocked/50 bg-blocked/10 px-2 py-0.5 text-[11px] text-blocked" title="No network. The fleet simulation runs on this device, so the monitor keeps working.">
              <WifiOff className="h-3.5 w-3.5" />
              <span className="uppercase tracking-wider hidden sm:inline">offline · running locally</span>
            </div>
          )}
          <button className="lg:hidden dark-btn !px-2" onClick={() => setOpen((v) => !v)} aria-label="Simulation controls" aria-expanded={open}>
            {open ? <X className="h-4 w-4" /> : <SlidersHorizontal className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* mobile tab strip */}
      <nav className="lg:hidden flex items-center gap-1 px-2 pb-1.5 overflow-x-auto hide-scrollbar">
        {TABS.map((t) => {
          const active = t.match(pathname);
          return (
            <Link key={t.href} href={t.href} onClick={() => setOpen(false)} className={`shrink-0 px-3 py-1 rounded-md text-[12px] ${active ? "bg-accent/10 text-accent shadow-[inset_0_-2px_0_0_var(--accent)]" : "text-text-2 hover:text-text"}`}>
              {t.label}
            </Link>
          );
        })}
      </nav>

      {/* mobile controls drawer */}
      {open && (
        <div className="lg:hidden absolute left-0 right-0 top-full z-50 border-b border-panel-border bg-[#0A1020]/98 backdrop-blur px-4 py-3 fade-in">
          <SimControls column />
          <InstallButton className="mt-3 w-full justify-center" />
          <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[#86efac]">
            <ShieldCheck className="h-3.5 w-3.5" /> Read-only monitor · No central server
          </div>
          <div className="mt-1 text-[11px] text-text-3">{wall ? `${fmtDate(wall)} ${fmtWall(wall)}` : ""} · {phase}</div>
        </div>
      )}
    </header>
  );
}
