"use client";

import { useEffect } from "react";
import { useFleetStore } from "../store";
import { MockTransport, WsTransport, type Transport } from "./transport";

let transport: Transport | null = null;
let refs = 0;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

function acquire() {
  refs++;
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  if (transport) return transport;
  const store = useFleetStore.getState();
  const sink = (msgs: Parameters<typeof store.applyMessages>[0]) =>
    useFleetStore.getState().applyMessages(msgs);
  const wsUrl = process.env.NEXT_PUBLIC_TELEMETRY_WS;
  if (wsUrl) {
    transport = new WsTransport(wsUrl, sink, (ok) => useFleetStore.getState().setConnected(ok, "ws"));
  } else {
    transport = new MockTransport(sink, (ok) => useFleetStore.getState().setConnected(ok, "mock"), {
      scenario: store.scenario,
      seed: store.seed,
      timeScale: store.timeScale,
    });
  }
  const t = transport;
  useFleetStore.getState().setSender((m) => t.send(m));
  void t.start();
  return t;
}

function release() {
  refs--;
  if (refs > 0) return;
  // debounce so React strict-mode remounts don't restart the engine
  releaseTimer = setTimeout(() => {
    if (refs === 0 && transport) {
      transport.stop();
      transport = null;
      useFleetStore.getState().setSender(null);
    }
  }, 800);
}

/** Starts the telemetry transport once for the whole app (root layout). */
export function TelemetryProvider({ children }: { children: React.ReactNode }) {
  const initTemplates = useFleetStore((s) => s.initTemplates);
  useEffect(() => {
    initTemplates();
    acquire();
    return () => release();
  }, [initTemplates]);
  return <>{children}</>;
}
