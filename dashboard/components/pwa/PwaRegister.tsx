"use client";

import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";

const SW_URL = `/sw.js?v=${process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"}`;

/**
 * Registers the service worker in production and offers a one-click reload when a new build is
 * waiting. In development it unregisters any worker left over from a production run so hot reload
 * never fights a cached chunk.
 */
export function PwaRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
      if ("caches" in window) caches.keys().then((keys) => keys.filter((k) => k.startsWith("edgefleet-")).forEach((k) => caches.delete(k)));
      return;
    }

    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register(SW_URL, { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        const watch = (sw: ServiceWorker | null) => {
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            // "installed" with an existing controller means a newer build is ready but waiting
            if (sw.state === "installed" && navigator.serviceWorker.controller) setWaiting(sw);
          });
        };
        if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
        watch(reg.installing);
        reg.addEventListener("updatefound", () => watch(reg.installing));
        // look for a new build whenever the tab comes back to the foreground
        const onVisible = () => {
          if (document.visibilityState === "visible") reg.update().catch(() => {});
        };
        document.addEventListener("visibilitychange", onVisible);
      })
      .catch(() => {
        /* registration failure (e.g. insecure context) degrades to a normal website */
      });

    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  if (!waiting || dismissed) return null;
  return (
    <div role="status" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 rounded-lg border border-accent/40 bg-[#0d1528]/95 backdrop-blur px-3 py-2 text-[12px] text-text shadow-lg fade-in">
      <span>A newer build of EdgeFleet is ready.</span>
      <button
        className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2 py-1 text-accent hover:bg-accent/25"
        onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}
      >
        <RefreshCw className="h-3.5 w-3.5" /> Reload
      </button>
      <button className="text-text-3 hover:text-text" onClick={() => setDismissed(true)} aria-label="Dismiss">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
