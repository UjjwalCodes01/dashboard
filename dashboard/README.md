# Chakraview — AMR Fleet Coordination Monitor

Round 1 fleet dashboard for **SIH 2026 · PS 26123 — Edge-AI Based Distributed Fleet Coordination for AMRs in Smart Warehouses** (Bharat Electronics Limited).

The dashboard is a **read-only subscriber**. It never commands a robot. Its only interactive controls are view toggles, fault injection, and task *authoring* (which publishes a task into the fleet's auction and lets the robots decide who takes it).

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

No backend is required: telemetry comes from an in-browser mock engine that emits the **final schema**. To swap in the real FastAPI backend later, set one environment variable and rebuild — no page changes:

```bash
NEXT_PUBLIC_TELEMETRY_WS=ws://localhost:8000/ws/telemetry npm run dev
```

Verify the simulation headlessly (all scenarios + a seeded benchmark sweep):

```bash
npx tsx scripts/simcheck.ts
```

Render the fleet map to a PNG without a browser, to check the floor-plan styling:

```bash
npx tsx scripts/mapshot.ts        # writes scripts/_mapshot.png
```

Screenshot the running app in a real browser (needs `npx playwright install --only-shell chromium` once):

```bash
npx tsx scripts/shoot.ts http://localhost:3000
```

It reports each map canvas's measured size and whether anything is actually painted, which is how the
zero-height canvas bug below was caught.

## Installable, works offline (PWA)

The dashboard is a Progressive Web App. Because the telemetry engine runs in the browser, an installed
copy keeps working with no network at all — the same property as the fleet it monitors. On Chromium
browsers an **Install app** button appears in the top bar; on iOS use Share → Add to Home Screen.

| Piece | Where | Notes |
|---|---|---|
| Manifest | `app/manifest.ts` | served at `/manifest.webmanifest`; standalone display, shortcuts to Hub / Benchmark / Faults |
| Icons | `public/icons/` | generated from the logo by `npx tsx scripts/icons.ts` (192, 512, maskable 512, Apple touch 180) |
| Service worker | `public/sw.js` | hand-written, no build plugin. Precaches the six static routes **and the `/_next/static` assets they reference**, the map files and icons; warms the ten robot pages after activation |
| Registration | `components/pwa/PwaRegister.tsx` | production only; in dev it unregisters any leftover worker. Shows a "newer build is ready → Reload" toast |
| Hooks | `lib/pwa.ts` | `useOnline()` drives the amber *offline · running locally* badge; `useInstallPrompt()` drives the install button |
| Offline fallback | `app/offline/page.tsx` | served for a route that was never cached |

Caching strategy: `/_next/static` cache-first (hashed, immutable); navigations network-first with a
4 s timeout, then cache, then `/offline`; map files and icons stale-while-revalidate; Next's RSC
payload requests are left alone so the router falls back to a full navigation offline.

Versioning: the page registers `/sw.js?v=<build id>` where the id is the Vercel commit SHA (a
timestamp locally, set in `next.config.ts`). A new deploy is a new worker URL, so it re-installs and
deletes every cache from the previous build on activation. `/sw.js` is served with `no-cache`.

Verify the whole thing in a real browser — the worker only registers in production, so build first:

```bash
npm run build && npx next start -p 3111 &
npx tsx scripts/pwacheck.ts http://localhost:3111
```

It checks the manifest and icons, the worker's headers, what got precached, that the page becomes
controlled, and then takes the browser offline and confirms `/hub`, `/benchmark`, `/network` and a
robot page still render, the offline badge appears, and an uncached URL gets the fallback page.

## Pages

| Route | What it is |
|---|---|
| `/` | Fleet Overview — task statistic tiles, live map, per-robot work progress, urgent task list, safety tiles, charging bays, event log |
| `/hub` | Performance Hub — full-bleed map, click a robot for its details card, right rail with charts, charging list and the neighbour (who-hears-whom) graph |
| `/robots/[id]` | Robot Detail — details card, decision log, focused map, intent window, camera grid, telemetry sparklines |
| `/robots/[id]/health` | Health & Diagnostics — grouped PASS/WARN/FAIL checklist with an extra **Coordination** group, detail table, camera preview, JSON report download |
| `/resources` | Deployment-platform admin — Robot / Charging Station / Pick-Drop Station tables, Map, Scenarios, System (tabs via `?tab=`) |
| `/tasks` | Task Templates — Scratch-style block editor, template list, live task queue showing per-robot bids |
| `/benchmark` | **Hidden for Round 1** (no tab; the route redirects to `/`). Baseline vs ours — two synchronised maps from the same seed, metrics table, mean ± std over n runs. Restore by deleting the redirect in `next.config.ts` and the tab in `components/TopBar.tsx` |
| `/network` | Fault injection — per-robot link kill, packet loss / latency sliders, block aisle, partition fleet, messages-per-second chart |

## Architecture

```
app/                     Next.js App Router pages (one per screen above)
components/
  map/MapCanvas.tsx      two stacked canvases: cached static layer + 30 fps dynamic layer
  map/render.ts          all drawing (shelves, lanes, chokes, robots, intent trails, peer links)
  blocks/BlockEditor.tsx drag-and-drop block editor with undo/redo
  hub/ robot/ overview/  panel components per page
lib/
  types.ts               the telemetry contract (mirrors backend/schema.py)
  store.ts               zustand store, batched message application
  telemetry/transport.ts MockTransport (in-browser engine) and WsTransport (real backend)
  sim/engine.ts          the mock fleet: movement, conflicts, auction, battery, health
  sim/map.ts             MovingAI .map parser, shelf merging, aisle labelling, choke detection
  sim/pathfinding.ts     A* on the grid (the distance heuristic, not the coordinator)
  sim/scenarios.ts       seven seeded scenarios with timed injections
  sim/benchmark.ts       lockstep baseline-vs-ours runner with mean ± std over seeds
public/maps/             warehouse-10-20-10-2-1.map (MovingAI) + map_config.json
scripts/simcheck.ts      headless verification of every scenario and the benchmark
```

### Map

`warehouse-10-20-10-2-1.map` from the [MovingAI MAPF benchmarks](https://movingai.com/benchmarks/mapf/index.html) (Stern et al., SoCS 2019), 63 × 161, corridor width one. Round 1 renders a 99 × 41 window (8 aisles A–H, 117 rack blocks) with a fleet of 10, which fills a wide dashboard panel and keeps the floor visibly busy. The parser merges obstacles into rectangles, labels aisles A–H and 1–14, detects 112 choke points, and traces the outline of the enclosed floor. Stations, chargers and parking are declared in `public/maps/map_config.json`.

The map is drawn as a warehouse floor plan in the ForwardX visual language: each of the 117 shelf blocks is racking seen from above (stacked beams with pallet divisions) carrying a three-letter code (BAA…BHM), with the floor outline traced, ambient hall lighting, lane centre-lines, choke rings, and charging bays that fill green as a docked robot charges. Robots carry a heading notch, a battery arc and an ID pill, and trail the dashed cells they have claimed.

### What the mock engine actually does

Round 1 is **scripted telemetry on the final schema**, not the real planner. Within that:

- Cells are reserved before entry, so two robots can never occupy one cell. Collisions are 0 by construction, and a collision checker runs every tick to prove it.
- Robots broadcast pose plus the next 8 intended cells (3 when the link is down). Peers within 12 m read that intent.
- Head-on in a one-lane aisle resolves by priority inheritance: the robot with the longer remaining path yields, ties broken by ID, with a right-of-way rule for a robot standing on the other's destination. It re-routes if a short detour exists, otherwise backs up to the last intersection and side-steps.
- Reading a peer's oncoming intent before entering an aisle lets a robot take another aisle or wait at the entrance instead of meeting head-on inside.
- A blocked aisle triggers a local re-plan; if the cost jumps more than 40 % the task is released and re-auctioned.
- Task allocation is a Contract Net Protocol auction: every idle robot computes `dist + 0.5·queue + max(0, 50 − battery)·0.25` on-board and the lowest bid self-assigns. Bids are published so the UI can show that the dashboard did not pick the robot.

### Benchmark honesty

The benchmark page runs two engines in lockstep from the same seed, same map, same tasks. Only the coordination rules differ.

- **Baseline (default): naive stop-and-wait** — no intent sharing; a robot freezes when the next cell is occupied and only takes a detour after a 6 s deadlock timeout. On some seeds it deadlocks and does not finish inside the 1500 s cap; the page marks those runs.
- **Baseline (alternative): central zone-lock controller** — one robot per one-lane aisle segment, waiting at the entrance. This is a stronger, centralised comparison, closer to what a commercial traffic controller does.

Measured over five seeds with 8 robots, 18 overlapping-path tasks, the mean improvement against naive stop-and-wait ranges roughly from +8 % to +43 % depending on scenario, with high variance and some individual seeds negative. **The ≥ 20 % success criterion is not yet met consistently by the Round 1 mock movement model.** The harness, metrics and statistics are real and final; the planner behind them is scripted. Round 2 swaps `sim/engine.ts` for PIBT + ORCA on ROS 2 + Zenoh and re-runs the same harness with n = 30.

## Tech stack

Versions are what is installed in this build (`node -e` over `package.json`). The last four rows are Round 2 targets the current interfaces were shaped for; none of them run yet.

| Layer | Technology | Version | Used for |
|---|---|---|---|
| Runtime | Node.js · npm | 24.20.0 · 11.19.0 | Build and script runtime |
| Framework | Next.js (App Router, Turbopack) | 16.3.4 | Pages, metadata, manifest route, server-rendered robot pages, Vercel target |
| | React / React DOM | 19.2.8 | UI; React Compiler lint rules enforced |
| | TypeScript | 5.9.3 | Whole codebase; `lib/types.ts` is the telemetry contract |
| UI | Tailwind CSS (`@tailwindcss/postcss`) | 4.3.3 | Dark operational pages, light admin pages |
| | lucide-react | 1.41.0 | Icons |
| | Recharts | 3.10.1 | Bar, line and error-bar charts |
| | Canvas 2D API | browser | Map renderer: two stacked canvases, cached static + 30 fps dynamic layer, no library |
| | Inter · JetBrains Mono | `next/font` | Self-hosted; mono for IDs, timers, coordinates |
| State | Zustand | 5.0.15 | Fleet store, batched telemetry application |
| Data | MovingAI MAPF map | warehouse-10-20-10-2-1 | Real 161 × 63 warehouse grid; a 99 × 41 window is rendered |
| Simulation | In-browser fleet engine | `lib/sim` | Cell reservation, intent broadcast, priority-inheritance yielding, A* re-plan, CNP auction, battery, health |
| Telemetry | Transport abstraction | mock · ws | `MockTransport` now; `WsTransport` via `NEXT_PUBLIC_TELEMETRY_WS`, no page changes |
| PWA | Web App Manifest + Service Worker | hand-written | Installable, precaches routes + chunks + map, offline, versioned by commit SHA |
| Quality | ESLint + eslint-config-next | 9.39.5 | Lint incl. hooks / compiler rules, zero warnings |
| Verification | Playwright (Chromium shell) | 1.63.0 | Desktop / phone screenshots, canvas-paint checks, offline PWA check |
| | @napi-rs/canvas | 1.0.8 | Headless map render, icon generation |
| | tsx | 4.23.13 | Runs `scripts/*.ts` |
| Delivery | GitHub · Vercel | — | `UjjwalCodes01/dashboard`; Vercel builds `dashboard/` on every push |
| Round 2 (planned) | FastAPI backend | — | WebSocket telemetry fan-out `WsTransport` already speaks; `/api/templates` |
| | ROS 2 + Zenoh | — | On-robot middleware and peer-to-peer intent transport |
| | PIBT + ORCA | — | Decentralised planning and local avoidance replacing the scripted engine |
| | Raspberry Pi 5 / Jetson edge boards | — | Per-robot compute the health checks already report against |

Every runtime dependency is MIT or Apache-2.0 licensed; the map data is a public research benchmark.

A user-flow diagram (three lanes: person, Chakraview screens, fleet; only Tasks and Network send anything to the fleet) lives at `docs/user-flow.html`, exported to `docs/chakraview-user-flow.png` by `npx tsx scripts/render-flow.ts`.

## Design

Dark operational pages (`--bg #0B1220`, panels `#111A2E`, cyan accent `#22D3EE`) for Overview, Hub, Robot Detail, Benchmark and Network; light admin pages for Resources, Tasks and Health, mirroring the ForwardX information architecture without its centralised control model. Inter for UI, JetBrains Mono for IDs, timers and coordinates.

Every screen is responsive: below 1024 px the page scrolls, panels take explicit heights, the top bar collapses into a scrollable tab strip with a controls drawer, the Hub's details card becomes a bottom sheet, admin sidebars become horizontal nav, and the map supports pinch-zoom and drag-pan.

## A layout trap worth knowing

`MapCanvas` sets its own `position` inline rather than with a class. Tailwind emits `.relative` after
`.absolute`, so a component that hardcodes `relative` on its root silently overrides the `absolute
inset-0` a caller passes in. Because both canvases inside are absolutely positioned, the wrapper then
collapses to zero height and the render loop exits at its size guard — every map renders blank with no
error in the console. The wrapper also falls back to measuring its parent if it ever measures zero.

## Deliberately absent

No relocate, restart, system reset, forced pause, remote control toggle, or "assign task to robot" dropdown exists anywhere in the UI. If the dashboard could command robots, it would be the central server the problem statement sets out to eliminate.
