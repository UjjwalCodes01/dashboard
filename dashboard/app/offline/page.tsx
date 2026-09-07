import Link from "next/link";
import { WifiOff } from "lucide-react";

export const metadata = { title: "Offline · Chakraview" };

/** Served by the service worker when a route that was never cached is opened without a network. */
export default function OfflinePage() {
  return (
    <main className="page-dark flex-1 flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-xl border border-panel-border bg-panel p-6 text-text">
        <div className="flex items-center gap-2 text-blocked">
          <WifiOff className="h-5 w-5" />
          <h1 className="text-[16px] font-semibold">You&apos;re offline</h1>
        </div>
        <p className="mt-3 text-[13px] text-text-2 leading-relaxed">
          This page hasn&apos;t been cached yet. The fleet monitor itself keeps running without a network — the robots are simulated on this
          device — so any page you have opened before is still available.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 text-[12px]">
          {[
            ["/", "Overview"],
            ["/hub", "Hub"],
            ["/tasks", "Tasks"],
            ["/network", "Network"],
            ["/resources", "Resources"],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="rounded-md border border-panel-border px-3 py-2 text-center text-text-2 hover:text-accent hover:border-accent/50">
              {label}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
