import type { NextConfig } from "next";

/** Stable per-deploy id: the commit on Vercel, a timestamp locally. The service worker URL carries it. */
const buildId = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 8) || Date.now().toString(36);

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
  async redirects() {
    return [
      // Benchmark page hidden for Round 1. Delete this entry (and restore the TopBar tab) to bring it back.
      { source: "/benchmark", destination: "/", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        // the worker must never be served stale, or an update could take a day to reach a device
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
