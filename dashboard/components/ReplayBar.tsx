"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Radio, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react";
import { useFleetStore } from "@/lib/store";
import { fmtSimTime } from "@/lib/format";

/**
 * Time-travel over the last five minutes of the simulation.
 *
 * Collapsed to a thin timeline strip at the bottom of every page; expands on hover, and stays
 * open while paused or scrubbing. Scrubbing pauses the engine (time_scale 0) so the picture holds
 * still — this is a video scrubber, not a second clock. Keys: Space pause · ← → step ·
 * Shift+← → previous / next conflict · L back to live.
 */
export function ReplayBar() {
  const recLen = useFleetStore((s) => s.recording.length);
  const replayIndex = useFleetStore((s) => s.replayIndex);
  const paused = useFleetStore((s) => s.paused);
  const liveTs = useFleetStore((s) => s.clock?.ts ?? 0);
  const scrubTo = useFleetStore((s) => s.scrubTo);
  const stepReplay = useFleetStore((s) => s.stepReplay);
  const jumpConflict = useFleetStore((s) => s.jumpConflict);
  const goLive = useFleetStore((s) => s.goLive);
  const setPaused = useFleetStore((s) => s.setPaused);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === " ") {
        e.preventDefault();
        const st = useFleetStore.getState();
        if (st.replayIndex !== null) st.goLive();
        else st.setPaused(!st.paused);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (e.shiftKey) jumpConflict(-1);
        else stepReplay(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) jumpConflict(1);
        else stepReplay(1);
      } else if (e.key === "l" || e.key === "L") {
        goLive();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jumpConflict, stepReplay, goLive]);

  if (recLen < 10) return null;
  const live = replayIndex === null;
  const idx = replayIndex ?? recLen - 1;
  const rec = useFleetStore.getState().recording;
  const shownTs = live ? liveTs : (rec[idx]?.ts ?? liveTs);
  const oldest = rec[0]?.ts ?? 0;
  const newest = rec[recLen - 1]?.ts ?? 0;
  const expanded = hover || paused || !live;

  // conflict markers along the track, thinned so a busy run does not become a solid bar
  const markers: number[] = [];
  const stride = Math.max(1, Math.floor(recLen / 400));
  for (let i = 0; i < recLen; i += stride) if (rec[i]?.conflict) markers.push(i);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 transition-all duration-200 ${expanded ? "h-11" : "h-2.5"}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role="region"
      aria-label="Replay timeline"
    >
      <div className={`absolute inset-x-0 bottom-0 border-t backdrop-blur-md ${expanded ? "h-11 border-panel-border bg-[#0a1020]/95" : "h-2.5 border-transparent bg-[#0a1020]/70"}`}>
        {/* collapsed: just the track */}
        <div className={`absolute inset-x-0 top-0 h-0.5 ${expanded ? "opacity-0" : "opacity-100"}`}>
          <div className="h-full bg-accent/60" style={{ width: `${((idx + 1) / recLen) * 100}%` }} />
        </div>

        <div className={`h-full flex items-center gap-2 px-3 text-[11px] ${expanded ? "opacity-100" : "opacity-0 pointer-events-none"} transition-opacity`}>
          {/* status pill */}
          <button
            onClick={() => (live ? setPaused(!paused) : goLive())}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 mono uppercase tracking-wider shrink-0 ${
              live && !paused ? "border-charging/50 bg-charging/10 text-charging" : "border-blocked/50 bg-blocked/10 text-blocked"
            }`}
            title={live ? (paused ? "Resume (Space)" : "Pause (Space)") : "Back to live (L)"}
          >
            {live && !paused ? <Radio className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {live ? (paused ? "paused" : "live") : "replay"}
          </button>

          <div className="hidden sm:flex items-center gap-1 shrink-0">
            <button className="dark-btn !px-1.5 !py-1" onClick={() => jumpConflict(-1)} title="Previous conflict (Shift+←)">
              <SkipBack className="h-3.5 w-3.5" />
            </button>
            <button className="dark-btn !px-1.5 !py-1" onClick={() => stepReplay(-5)} title="Back 1 s (←)">
              <StepBack className="h-3.5 w-3.5" />
            </button>
            <button className="dark-btn !px-1.5 !py-1" onClick={() => (live ? setPaused(!paused) : goLive())} title={live && !paused ? "Pause" : "Play live"}>
              {live && !paused ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <button className="dark-btn !px-1.5 !py-1" onClick={() => stepReplay(5)} title="Forward 1 s (→)">
              <StepForward className="h-3.5 w-3.5" />
            </button>
            <button className="dark-btn !px-1.5 !py-1" onClick={() => jumpConflict(1)} title="Next conflict (Shift+→)">
              <SkipForward className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* track */}
          <div className="relative flex-1 min-w-[80px] h-6 flex items-center">
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded bg-white/10 overflow-hidden">
              <div className="h-full bg-accent/50" style={{ width: `${((idx + 1) / recLen) * 100}%` }} />
            </div>
            {markers.map((i) => (
              <span key={i} className="absolute top-1/2 -translate-y-1/2 h-3 w-px bg-yielding/80" style={{ left: `${(i / Math.max(1, recLen - 1)) * 100}%` }} title={`conflict at ${fmtSimTime(rec[i].ts)}`} />
            ))}
            <input
              type="range"
              min={0}
              max={Math.max(0, recLen - 1)}
              value={idx}
              onChange={(e) => scrubTo(Number(e.target.value))}
              className="absolute inset-0 w-full opacity-0 cursor-pointer"
              aria-label="Scrub simulation time"
            />
          </div>

          <div className="mono text-text-2 shrink-0 whitespace-nowrap">
            <span className="text-text">{fmtSimTime(shownTs)}</span>
            <span className="hidden md:inline text-text-3"> · buffer {fmtSimTime(oldest)}–{fmtSimTime(newest)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
