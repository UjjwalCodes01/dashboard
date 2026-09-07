import type { MetadataRoute } from "next";

/** Served at /manifest.webmanifest; Next injects the <link rel="manifest"> automatically. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "EdgeFleet — AMR Fleet Coordination Monitor",
    short_name: "EdgeFleet",
    description:
      "Read-only monitor for a decentralised AMR fleet. Robots decide; the dashboard listens. Runs fully offline — like the fleet it watches.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0B1220",
    theme_color: "#0A1020",
    lang: "en",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Performance Hub", short_name: "Hub", url: "/hub", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Task Templates", short_name: "Tasks", url: "/tasks", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Fault injection", short_name: "Faults", url: "/network", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
