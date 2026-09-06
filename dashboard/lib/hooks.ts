"use client";

import { useEffect, useRef, useState } from "react";
import { useFleetStore, type FleetStore } from "./store";

/**
 * Sample a store selector at a fixed interval instead of on every 5 Hz tick.
 * Use for charts and tables where 2 Hz is plenty.
 */
export function useThrottled<T>(selector: (s: FleetStore) => T, ms = 500): T {
  const selRef = useRef(selector);
  useEffect(() => {
    selRef.current = selector;
  });
  const [value, setValue] = useState<T>(() => selector(useFleetStore.getState()));
  useEffect(() => {
    const id = setInterval(() => setValue(selRef.current(useFleetStore.getState())), ms);
    return () => clearInterval(id);
  }, [ms]);
  return value;
}

/** Wall clock that ticks once a second (for the top bar). */
export function useWallClock(): Date | null {
  const [d, setD] = useState<Date | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setD(new Date()), 0);
    const id = setInterval(() => setD(new Date()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  return d;
}

/** Element size via ResizeObserver (fires an initial observation on observe). */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setM(true), 0);
    return () => clearTimeout(id);
  }, []);
  return m;
}
