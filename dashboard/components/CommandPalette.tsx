"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Command, CornerDownLeft } from "lucide-react";
import { useFleetStore, type ViewToggles } from "@/lib/store";
import { SCENARIO_LIST } from "@/lib/sim/scenarios";

interface Cmd {
  id: string;
  group: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** ⌘K / Ctrl+K. Everything the dashboard can do — navigation, scenarios, faults, layers, replay — typed. */
export function CommandPalette() {
  const open = useFleetStore((s) => s.paletteOpen);
  const setPalette = useFleetStore((s) => s.setPalette);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPalette(!useFleetStore.getState().paletteOpen);
      } else if (e.key === "Escape" && useFleetStore.getState().paletteOpen) {
        setPalette(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPalette]);

  if (!open) return null;
  // mounting the body per open resets the query and the cursor without any effect-driven setState
  return <PaletteBody close={() => setPalette(false)} />;
}

function PaletteBody({ close }: { close: () => void }) {
  const router = useRouter();
  const robotIds = useFleetStore((s) => s.robotIds);
  const view = useFleetStore((s) => s.view);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);

  const commands = useMemo<Cmd[]>(() => {
    const st = () => useFleetStore.getState();
    const go = (href: string) => () => router.push(href);
    const list: Cmd[] = [
      { id: "p-overview", group: "Go to", label: "Overview", run: go("/") },
      { id: "p-hub", group: "Go to", label: "Performance Hub", run: go("/hub") },
      { id: "p-resources", group: "Go to", label: "Resources", run: go("/resources") },
      { id: "p-tasks", group: "Go to", label: "Task templates", run: go("/tasks") },
      { id: "p-network", group: "Go to", label: "Network & fault injection", run: go("/network") },
    ];
    for (const id of robotIds) {
      list.push({ id: `r-${id}`, group: "Robot", label: `Open ${id}`, hint: "detail page", run: () => { st().select(id); router.push(`/robots/${id}`); } });
      list.push({ id: `f-${id}`, group: "Robot", label: `Follow ${id} on the Hub`, hint: "camera lock", run: () => { st().select(id); st().setFollow(id); router.push("/hub"); } });
    }
    for (const sc of SCENARIO_LIST) list.push({ id: `s-${sc.name}`, group: "Scenario", label: `Run scenario: ${sc.label}`, hint: sc.short, run: () => st().setScenario(sc.name) });
    const send = (m: Parameters<ReturnType<typeof useFleetStore.getState>["send"]>[0]) => () => st().send(m);
    list.push(
      { id: "x-blackout", group: "Fault", label: "Comms blackout for 30 s", hint: "every link down", run: send({ type: "fault", action: "blackout", seconds: 30 }) },
      { id: "x-links-up", group: "Fault", label: "Restore every link", run: send({ type: "fault", action: "all_links", value: true }) },
      { id: "x-partition", group: "Fault", label: "Partition the fleet into two groups", run: send({ type: "fault", action: "partition", value: true }) },
      { id: "x-heal", group: "Fault", label: "Heal the partition", run: send({ type: "fault", action: "partition", value: false }) },
      { id: "x-worker", group: "Fault", label: "Send a worker into an aisle", hint: "unpredictable body", run: send({ type: "fault", action: "pedestrian" }) },
      { id: "x-surge", group: "Fault", label: "Order surge ×4 for 60 s", run: send({ type: "fault", action: "task_surge", value: 4, seconds: 60 }) },
      { id: "x-unblock", group: "Fault", label: "Clear every blocked cell", run: send({ type: "fault", action: "unblock_all" }) },
    );
    for (const id of robotIds) {
      list.push({ id: `k-${id}`, group: "Fault", label: `Kill ${id}`, run: send({ type: "fault", action: "disable_robot", target: id, value: true }) });
      list.push({ id: `l-${id}`, group: "Fault", label: `Cut ${id}'s link`, run: send({ type: "fault", action: "toggle_link", target: id, value: false }) });
      list.push({ id: `b-${id}`, group: "Fault", label: `Drain ${id}'s battery to 22 %`, run: send({ type: "fault", action: "set_battery", target: id, value: 22 }) });
    }
    const layers: { key: keyof ViewToggles; label: string }[] = [
      { key: "heat", label: "congestion heatmap" },
      { key: "pushes", label: "PIBT push arrows" },
      { key: "packets", label: "message packets" },
      { key: "trails", label: "intent trails" },
      { key: "links", label: "peer links" },
      { key: "comms", label: "comms range" },
      { key: "lanes", label: "lanes" },
      { key: "chokes", label: "choke points" },
      { key: "grid", label: "grid" },
      { key: "labels", label: "labels" },
    ];
    for (const l of layers) list.push({ id: `v-${l.key}`, group: "Layer", label: `${view[l.key] ? "Hide" : "Show"} ${l.label}`, run: () => st().setView({ [l.key]: !st().view[l.key] }) });
    list.push(
      { id: "t-pause", group: "Replay", label: st().paused ? "Resume the simulation" : "Pause the simulation", hint: "Space", run: () => st().setPaused(!st().paused) },
      { id: "t-live", group: "Replay", label: "Back to live", hint: "L", run: () => st().goLive() },
      { id: "t-prev", group: "Replay", label: "Jump to the previous conflict", hint: "Shift+←", run: () => st().jumpConflict(-1) },
      { id: "t-1x", group: "Speed", label: "Sim speed 1×", run: () => st().setTimeScale(1) },
      { id: "t-2x", group: "Speed", label: "Sim speed 2×", run: () => st().setTimeScale(2) },
      { id: "t-unfollow", group: "Replay", label: "Stop following", run: () => st().setFollow(null) },
    );
    return list;
  }, [robotIds, router, view]);

  const filtered = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = terms.length ? commands.filter((c) => terms.every((t) => `${c.group} ${c.label} ${c.hint ?? ""}`.toLowerCase().includes(t))) : commands;
    return hits.slice(0, 14);
  }, [q, commands]);

  const active = Math.max(0, Math.min(idx, filtered.length - 1));
  const run = (c: Cmd) => {
    close();
    c.run();
  };
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/55 backdrop-blur-sm px-3 pt-[12vh]" onMouseDown={close}>
      <div className="w-full max-w-[560px] rounded-xl border border-panel-border bg-[#0d1528]/98 shadow-2xl text-text fade-in" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-panel-border">
          <Command className="h-4 w-4 text-accent" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx(Math.min(filtered.length - 1, active + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx(Math.max(0, active - 1));
              } else if (e.key === "Enter" && filtered[active]) run(filtered[active]);
            }}
            placeholder="Type a robot, scenario, fault, layer or page…"
            className="flex-1 bg-transparent outline-none text-[14px] placeholder:text-text-3"
          />
          <kbd className="text-[10px] mono text-text-3 border border-panel-border rounded px-1.5 py-0.5">esc</kbd>
        </div>
        <ul className="max-h-[60vh] overflow-y-auto py-1">
          {filtered.length === 0 && <li className="px-3 py-3 text-[12px] text-text-3">Nothing matches.</li>}
          {filtered.map((c, i) => (
            <li key={c.id}>
              <button
                onMouseEnter={() => setIdx(i)}
                onClick={() => run(c)}
                className={`w-full flex items-center gap-3 px-3 py-1.5 text-left text-[13px] ${i === active ? "bg-accent/12 text-text" : "text-text-2"}`}
              >
                <span className="mono text-[10px] uppercase tracking-wider text-text-3 w-[60px] shrink-0">{c.group}</span>
                <span className="flex-1 truncate">{c.label}</span>
                {c.hint && <span className="text-[10px] text-text-3">{c.hint}</span>}
                {i === active && <CornerDownLeft className="h-3.5 w-3.5 text-accent" />}
              </button>
            </li>
          ))}
        </ul>
        <div className="px-3 py-1.5 border-t border-panel-border text-[10px] text-text-3">Every fault is an injection the robots respond to on their own — nothing here commands a robot.</div>
      </div>
    </div>
  );
}
