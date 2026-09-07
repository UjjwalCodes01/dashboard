"use client";

import { useCallback, useSyncExternalStore } from "react";

// ---------------------------------------------------------------- online / offline

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** Browser connectivity. Server snapshot is "online" so SSR and the first client render agree. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

// ---------------------------------------------------------------- install prompt

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();
function notify() {
  for (const l of promptListeners) l();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep it for our own button
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
}

function subscribePrompt(cb: () => void) {
  promptListeners.add(cb);
  return () => {
    promptListeners.delete(cb);
  };
}

const STANDALONE_MQ = "(display-mode: standalone)";
function subscribeStandalone(cb: () => void) {
  const mq = window.matchMedia(STANDALONE_MQ);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function readStandalone() {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia(STANDALONE_MQ).matches || nav.standalone === true;
}
const noSubscribe = () => () => {};
const readIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);

/**
 * Install affordance. `canInstall` is true only where the browser offers a programmatic prompt
 * (Chromium). iOS never fires it, so `isIOS` lets the UI show the Share → Add to Home Screen hint.
 */
export function useInstallPrompt() {
  const canInstall = useSyncExternalStore(
    subscribePrompt,
    () => deferredPrompt !== null,
    () => false,
  );
  // server snapshots say "not standalone / not iOS" so hydration matches; the client corrects on mount
  const isStandalone = useSyncExternalStore(subscribeStandalone, readStandalone, () => false);
  const isIOS = useSyncExternalStore(noSubscribe, readIOS, () => false);

  const install = useCallback(async () => {
    const p = deferredPrompt;
    if (!p) return "unavailable" as const;
    await p.prompt();
    const { outcome } = await p.userChoice;
    if (outcome === "accepted") {
      deferredPrompt = null;
      notify();
    }
    return outcome;
  }, []);

  return { canInstall: canInstall && !isStandalone, install, isStandalone, isIOS };
}
