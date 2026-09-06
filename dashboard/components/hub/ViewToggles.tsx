"use client";

import { useFleetStore, type ViewToggles as VT } from "@/lib/store";

const ITEMS: { key: keyof VT; label: string; title: string }[] = [
  { key: "trails", label: "intent trails", title: "Next cells each robot has claimed (P2P intent broadcast)" },
  { key: "comms", label: "comms range", title: "Comms radius of the selected robot and its live peer links" },
  { key: "links", label: "peer links", title: "All pairs currently within comms range" },
  { key: "lanes", label: "lanes", title: "Aisle centre-lines" },
  { key: "chokes", label: "choke points", title: "One-lane crossings where conflicts are resolved" },
  { key: "grid", label: "grid", title: "1 m grid" },
  { key: "labels", label: "labels", title: "Shelf and aisle labels" },
];

export function ViewToggles({ className = "" }: { className?: string }) {
  const view = useFleetStore((s) => s.view);
  const setView = useFleetStore((s) => s.setView);
  return (
    <div className={`flex items-center gap-1 rounded-md border border-panel-border bg-[#0d1528]/92 backdrop-blur px-2 py-1.5 ${className}`}>
      <span className="text-[10px] uppercase tracking-wider text-text-3 mr-1">view</span>
      {ITEMS.map((it) => (
        <button
          key={it.key}
          className="dark-btn !py-[3px] !px-2 text-[11px]"
          data-active={view[it.key]}
          onClick={() => setView({ [it.key]: !view[it.key] })}
          title={it.title}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
