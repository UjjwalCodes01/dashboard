"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Boxes, Cog, LayoutGrid, ListTree, Map as MapIcon, PlaySquare } from "lucide-react";
import { useFleetStore } from "@/lib/store";

interface NavItem {
  label: string;
  href: string;
  tab?: string;
}
interface NavGroup {
  label: string;
  icon: ReactNode;
  items?: NavItem[];
  href?: string;
  tab?: string;
}

const GROUPS: NavGroup[] = [
  {
    label: "Resource",
    icon: <Boxes className="h-4 w-4" />,
    items: [
      { label: "Robot", href: "/resources?tab=robots", tab: "robots" },
      { label: "Charging Station", href: "/resources?tab=chargers", tab: "chargers" },
      { label: "Pick / Drop Station", href: "/resources?tab=stations", tab: "stations" },
    ],
  },
  { label: "Map", icon: <MapIcon className="h-4 w-4" />, href: "/resources?tab=map", tab: "map" },
  { label: "Task Templates", icon: <ListTree className="h-4 w-4" />, href: "/tasks" },
  { label: "Scenarios", icon: <PlaySquare className="h-4 w-4" />, href: "/resources?tab=scenarios", tab: "scenarios" },
  { label: "System", icon: <Cog className="h-4 w-4" />, href: "/resources?tab=system", tab: "system" },
];

const FLAT: NavItem[] = GROUPS.flatMap((g) => (g.items ? g.items : [{ label: g.label, href: g.href!, tab: g.tab }]));

function useActive() {
  const pathname = usePathname() ?? "";
  const sp = useSearchParams();
  const tab = sp?.get("tab") ?? (pathname.startsWith("/resources") ? "robots" : "");
  return (it: { href: string; tab?: string }) => {
    const [path] = it.href.split("?");
    if (path !== pathname) return false;
    if (it.tab) return tab === it.tab;
    return true;
  };
}

function SidebarInner() {
  const isActive = useActive();
  return (
    <aside className="hidden lg:flex w-[190px] shrink-0 bg-[#2b3340] text-[#cbd5e1] flex-col">
      <div className="px-4 py-3 text-[11px] uppercase tracking-wider text-[#94a3b8] flex items-center gap-2">
        <LayoutGrid className="h-3.5 w-3.5" /> Deployment platform
      </div>
      <nav className="flex-1 text-[13px]">
        {GROUPS.map((g) => (
          <div key={g.label}>
            {g.href ? (
              <Link href={g.href} className={`flex items-center gap-2 px-4 py-2.5 hover:bg-white/5 ${isActive({ href: g.href, tab: g.tab }) ? "bg-[#16a34a] text-white" : ""}`}>
                {g.icon} {g.label}
              </Link>
            ) : (
              <>
                <div className="flex items-center gap-2 px-4 py-2.5 text-[#e2e8f0]">
                  {g.icon} {g.label}
                </div>
                {g.items?.map((it) => (
                  <Link key={it.href} href={it.href} className={`block pl-10 pr-4 py-2 hover:bg-white/5 ${isActive(it) ? "bg-[#16a34a] text-white" : "text-[#cbd5e1]"}`}>
                    {it.label}
                  </Link>
                ))}
              </>
            )}
          </div>
        ))}
      </nav>
      <div className="px-4 py-3 text-[10px] text-[#94a3b8] border-t border-white/10">Robots join by peer discovery — they are not provisioned from this UI.</div>
    </aside>
  );
}

function MobileNavInner() {
  const isActive = useActive();
  return (
    <nav className="lg:hidden flex items-center gap-1 px-2 py-1.5 bg-[#2b3340] overflow-x-auto hide-scrollbar text-[12px]">
      {FLAT.map((it) => (
        <Link key={it.href} href={it.href} className={`shrink-0 rounded px-2.5 py-1 ${isActive(it) ? "bg-[#16a34a] text-white" : "text-[#cbd5e1]"}`}>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

export function AdminShell({ children, title, actions }: { children: ReactNode; title?: ReactNode; actions?: ReactNode }) {
  const mapName = useFleetStore((s) => s.map?.name);
  const transport = useFleetStore((s) => s.transport);
  return (
    <div className="page-admin dash-main !flex-row flex-wrap lg:flex-nowrap">
      <Suspense fallback={<aside className="hidden lg:flex w-[190px] shrink-0 bg-[#2b3340]" />}>
        <SidebarInner />
      </Suspense>
      <div className="flex-1 min-w-0 flex flex-col basis-full lg:basis-auto">
        <Suspense fallback={<nav className="lg:hidden h-9 bg-[#2b3340]" />}>
          <MobileNavInner />
        </Suspense>
        {(title || actions) && (
          <div className="flex flex-wrap items-center gap-2 lg:gap-3 px-3 lg:px-6 pt-3 lg:pt-4 pb-2">
            <div className="text-[16px] font-semibold text-admin-text">{title}</div>
            <div className="flex-1" />
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          </div>
        )}
        <div className="flex-1 lg:min-h-0 lg:overflow-auto px-3 lg:px-6 pb-4">{children}</div>
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 lg:px-6 py-1.5 border-t border-admin-line bg-white text-[11px] text-admin-text-2">
          <span>Dashboard v0.1 · Schema v1</span>
          <span>Map {mapName ?? "—"}</span>
          <span>Telemetry: {transport === "ws" ? "WebSocket" : "in-browser mock (final schema)"}</span>
          <span className="flex-1" />
          <span className="hidden md:inline">Firmware target: edge-1.4.2 · Coordination: PIBT + ORCA · Allocation: CNP</span>
        </footer>
      </div>
    </div>
  );
}
