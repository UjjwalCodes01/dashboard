# Chakraview — AMR Fleet Coordination Monitor

Round 1 fleet dashboard for **SIH 2026 · PS 26123 — Edge-AI Based Distributed Fleet Coordination for AMRs in Smart Warehouses** (Bharat Electronics Limited).

The dashboard is a **read-only subscriber**. It never commands a robot. Its only interactive controls are view toggles, fault injection, and task *authoring* (which publishes a task into the fleet's auction and lets the robots decide who takes it).

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
```

No backend is required: the fleet runs in the browser — real PIBT + ORCA coordination emitting the **final schema**. To swap in the FastAPI backend later, set one environment variable and rebuild, with no page changes:

```bash
NEXT_PUBLIC_TELEMETRY_WS=ws://localhost:8000/ws/telemetry npm run dev
```

Verify it headlessly — algorithms, scenarios and faults:

```bash
npx tsx scripts/algocheck.ts    # PIBT + ORCA correctness on their own
npx tsx scripts/simcheck.ts     # 13 scenarios + the seeded benchmark sweep
npx tsx scripts/faultcheck.ts   # 28 fault cases, all asserting zero collisions and zero worker contacts
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
| `/network` | Fault injection — per-robot link kill, packet loss / latency sliders, block aisle, partition fleet, **comms blackout, worker in an aisle, order surge, battery drain**, fault timeline, messages-per-second chart |

## Architecture

```
app/                     Next.js App Router pages (one per screen above)
components/
  map/MapCanvas.tsx      two stacked canvases: cached static layer + 30 fps dynamic layer
  map/render.ts          all drawing (shelves, lanes, chokes, robots, intent trails, peer links)
  blocks/BlockEditor.tsx drag-and-drop block editor with undo/redo
  hub/DecisionInspector  PIBT's candidates and verdicts for one robot, live or replayed
  ReplayBar.tsx          five-minute scrubber; pauses the engine while scrubbing
  CommandPalette.tsx     ⌘K over pages, robots, scenarios, faults, layers, replay
  network/FaultTimeline  throughput vs injected faults, collisions and contacts flat on zero
  hub/ robot/ overview/  panel components per page
lib/
  types.ts               the telemetry contract (mirrors backend/schema.py)
  store.ts               zustand store, batched message application
  telemetry/transport.ts MockTransport (in-browser engine) and WsTransport (real backend)
  sim/engine.ts          the fleet: PIBT + sensor veto + ORCA, auction, battery, health
  sim/pibt.ts            PIBT planner + cached BFS distance-to-goal fields
  sim/orca.ts            ORCA half-planes + the 2D linear program (RVO2 formulation)
  sim/map.ts             MovingAI .map parser, shelf merging, aisle labelling, choke detection
  sim/pathfinding.ts     A* on the grid (used for bids and the baseline engine)
  sim/scenarios.ts       thirteen seeded scenarios with timed injections
  sim/benchmark.ts       lockstep baseline-vs-ours runner with mean ± std over seeds
public/maps/             warehouse-10-20-10-2-1.map (MovingAI) + map_config.json
scripts/algocheck.ts     PIBT + ORCA correctness, independent of the engine
scripts/simcheck.ts      headless verification of every scenario and the benchmark
scripts/faultcheck.ts    28 fault-injection cases, all asserting zero collisions
```

### Map

`warehouse-10-20-10-2-1.map` from the [MovingAI MAPF benchmarks](https://movingai.com/benchmarks/mapf/index.html) (Stern et al., SoCS 2019), 63 × 161, corridor width one. Round 1 renders a 99 × 41 window (8 aisles A–H, 117 rack blocks) with a fleet of 10, which fills a wide dashboard panel and keeps the floor visibly busy. The parser merges obstacles into rectangles, labels aisles A–H and 1–14, detects 112 choke points, and traces the outline of the enclosed floor. Stations, chargers and parking are declared in `public/maps/map_config.json`.

The map is drawn as a warehouse floor plan in the ForwardX visual language: each of the 117 shelf blocks is racking seen from above (stacked beams with pallet divisions) carrying a three-letter code (BAA…BHM), with the floor outline traced, ambient hall lighting, lane centre-lines, choke rings, and charging bays that fill green as a docked robot charges. Robots carry a heading notch, a battery arc and an ID pill, and trail the dashed cells they have claimed.

### Coordination: PIBT + ORCA

The `ours` engine is a three-layer stack. The split is deliberate and is the whole argument of the
project: each layer is defined by **what it needs in order to work**, so losing the network degrades
coordination without ever degrading safety.

| Layer | What it decides | What it needs | Where |
|---|---|---|---|
| 1 · PIBT | which cell each robot enters next | peers must agree, so it needs the radio | `lib/sim/pibt.ts` |
| 2 · sensor veto | refuses a cell another robot still occupies | lidar only | `moveRobotsPibt` |
| 3 · ORCA | how fast to cross, for real physical clearance | lidar only | `lib/sim/orca.ts` |

**PIBT** (Priority Inheritance with Backtracking, Okumura et al., IJCAI 2019) gives each robot a next
cell such that vertex conflicts and swap conflicts are impossible *by construction*, not by checking
afterwards. When a robot's best cell is occupied it recursively pushes the occupant, and backtracks
if that fails. Priorities are dynamic: a robot short of its goal gains priority every tick until it
outranks everyone and is pushed through, which is what makes the algorithm live rather than merely
safe. The heuristic is an exact BFS distance-to-goal field, cached per goal and invalidated whenever
an aisle is blocked.

The published algorithm assumes one planner that sees every agent, which would contradict the point
of this project. So PIBT here runs **once per communication group** — the connected components of
the peer graph. Full connectivity behaves as classic PIBT; a partition becomes two independent
planners; a killed link makes that robot a group of one that the others treat as an unpredictable
body rather than a teammate.

**ORCA** (Optimal Reciprocal Collision Avoidance, van den Berg et al., ISRR 2011) builds one
half-plane of safe velocities per neighbour and solves the resulting 2D linear program, exactly as
the reference RVO2 library does. Because the robots are grid-constrained — PIBT has already chosen
*which* cell — the solved constraints are projected onto that one axis to cap crossing speed. That
keeps the grid guarantees intact while enforcing genuine continuous-space separation. ORCA needs no
agreement with anyone, so it is what covers encounters between robots that cannot hear each other.

Around that stack:

- Robots broadcast pose plus the next 8 cells they intend to occupy, read straight off the same
  distance field PIBT descends, so published intent is genuinely what the robot will do.
- A blocked aisle triggers a local re-plan; if the detour costs more than 40 % the task is released
  and re-auctioned.
- Task allocation is a Contract Net Protocol auction: every idle robot computes
  `dist + 0.5·queue + max(0, 50 − battery)·0.25` on-board and the lowest bid self-assigns. Bids are
  published so the UI can show the dashboard did not pick the robot.

### Verifying it

Three suites, all runnable without a browser:

```bash
npx tsx scripts/algocheck.ts    # PIBT and ORCA in isolation
npx tsx scripts/simcheck.ts     # all 7 scenarios + the benchmark sweep
npx tsx scripts/faultcheck.ts   # 16 fault-injection cases
```

`algocheck` asserts the properties the algorithms actually promise, including two that are easy to
get wrong:

- PIBT guarantees **reachability** — every agent visits its goal in finite time — not that all
  agents sit on their goals simultaneously at the end. An arrived agent drops to lowest priority and
  gets pushed aside by agents still travelling. That is correct for lifelong warehouse MAPF, where
  arriving at a pickup immediately earns a new goal.
- ORCA **deadlocks on a perfectly symmetric start**, because every agent picks the mirror-image
  evasion. This is a documented property of the algorithm, not a defect; the reference samples add
  the same symmetry-breaking perturbation. Both the symmetric and perturbed cases are asserted so
  the limitation stays visible.

`faultcheck` runs 28 cases: kill-a-link, kill-every-link, flapping links, kill-a-robot (including inside a
one-lane choke point), kill three robots, block an aisle, block-then-clear, partition, partition-then-heal,
60 % packet loss with 400 ms latency, everything-at-once, 12-robot density, workers in busy aisles, three
workers at once, a 30 s blackout, a blackout *while* workers are in the aisles, an order surge, six
batteries drained at once, and every one of the six new scenarios. Every case asserts
**zero collisions** — checked by an independent referee that re-reads every robot's cell, not just
the engine's own counter — **and zero robot–worker contacts and** a minimum task count, so an engine that stayed safe by parking
the whole fleet would fail.

### Seeing the algorithms work

The point of the UI is to make the coordination *visible*, not just to report its results.

| Feature | What it shows | Where |
|---|---|---|
| **Decision inspector** | For the selected robot, this tick: every cell PIBT weighed, its exact distance-to-goal, and why each was rejected — *claimed by AMR-07*, *would swap with AMR-02*, *AMR-05 couldn't move*, *aisle blocked*, *body it can't talk to*. Plus the speed the route asked for versus what ORCA allowed. | details card on the Hub and the robot page |
| **PIBT push arrows** | Priority inheritance as it fires: an amber arrow from the robot that pushed to the one that gave way, fading over 1.6 s. | map layer `PIBT pushes` |
| **Congestion heatmap** | Where robots have been (cyan) shading to amber and red where they stood still. Decays with a ~28 s half-life so it shows the last minute, not the whole shift. | map layer `heatmap` |
| **Message packets** | Intent broadcasts animating both ways along every peer link — the gossip bus made visible. | map layer `packets` |
| **Time-travel replay** | The last five minutes at 5 Hz. Pause with Space, scrub with the bar or ← →, jump between conflicts with Shift+← →, back to live with L. Scrubbing pauses the engine so the picture holds still. The inspector and every panel read the scrubbed frame. | thin strip at the bottom of every page; expands on hover |
| **Follow mode** | Lock the Hub camera onto one robot. | `follow` in the details card, or ⌘K → "Follow AMR-03" |
| **Command palette** | ⌘K / Ctrl+K: pages, robots, scenarios, every fault, every layer, replay controls. | anywhere |
| **Export run** | One JSON file with the stats, per-robot state, tasks, events and the fault timeline. | Overview title row |

### Thirteen simulation types

Seven original scenarios plus six added for Round 2, all seeded and repeatable:

| Scenario | What it exercises |
|---|---|
| Normal operations | steady-state auction and coordination |
| Head-on corridor | priority inheritance in one-lane aisles |
| 4-way intersection | emergent passage order with no referee |
| Choke point convoy | one robot against a platoon |
| Blocked aisle | local re-plan and re-auction |
| Robot failure | dead robot as a static obstacle, task re-bid |
| Network partition | two comms groups, each running its own PIBT |
| **Rush hour surge** | task arrivals ×4 for 100 s — the on-board auction under load |
| **Total comms blackout** | every radio dark for 45 s: PIBT has nobody to coordinate with, the sensor veto and ORCA keep it safe, then the network returns |
| **Battery crisis** | seven robots at the 20 % floor, six chargers |
| **Convoy** | six robots nose-to-tail down one aisle with one coming the other way |
| **Cascading failure** | dead robot → blocked aisle → partition → second dead robot, repaired only at 150 s |
| **Workers in the aisles** | people walking the aisles. A worker is a body the fleet can *see* but cannot *negotiate with*: PIBT treats them as obstacles, ORCA keeps clearance, and a robot sharing a cell with a worker is counted as a contact that must never happen. Workers also stop rather than walk into a robot. |

The worker model is the most instructive of the six, because it is exactly the case the three-layer
split exists for. A worker is not in any comms group, so layer 1 cannot help; layers 2 and 3 are the
only thing between the robot and the person, and `faultcheck` asserts zero contacts across every
worker case, including a blackout while workers are in the aisles.

### Benchmark honesty

The benchmark page runs two engines in lockstep from the same seed, same map, same tasks. Only the
coordination rules differ.

- **Baseline (default): naive stop-and-wait** — no intent sharing; a robot freezes when the next
  cell is occupied and only takes a detour after a 6 s deadlock timeout. On some seeds it deadlocks
  and does not finish inside the 1500 s cap; the page marks those runs.
- **Baseline (alternative): central zone-lock controller** — one robot per one-lane aisle segment,
  waiting at the entrance. A stronger, *centralised* comparison, closer to a commercial traffic
  controller.

Five seeds, 8 robots, 18 overlapping-path tasks, mean improvement in makespan:

| Scenario | vs naive stop-and-wait | vs central zone-lock |
|---|---|---|
| normal | **+28.9 %** | +4.4 % |
| head-on | +18.7 % | −12.1 % |
| intersection | +9.7 % | −2.1 % |
| choke | +9.4 % | +1.7 % |
| blocked aisle | +14.5 % | +2.2 % |

Read this honestly. Against the naive baseline the PS's ≥ 20 % criterion is **met on two of five
scenarios and missed on three**, with wide seed-to-seed variance — some individual seeds are
negative. Against a *centralised* controller with global knowledge the decentralised planner is
roughly at parity, winning three scenarios and losing head-on clearly. That trade is the actual
claim worth making: near-parity throughput with no coordinator at all, and no collisions through
partitions, blackouts and robot deaths that a central controller would not survive.

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
| Coordination | PIBT (Okumura et al., IJCAI 2019) | `lib/sim/pibt.ts` | Multi-agent path planning; conflict-free by construction, run per comms group |
| | ORCA (van den Berg et al., ISRR 2011) | `lib/sim/orca.ts` | Reciprocal collision avoidance; half-planes + 2D LP, sensor-only so it survives a blackout |
| Simulation | In-browser fleet engine | `lib/sim` | Intent broadcast, CNP auction, battery, health, fault injection |
| Telemetry | Transport abstraction | mock · ws | `MockTransport` now; `WsTransport` via `NEXT_PUBLIC_TELEMETRY_WS`, no page changes |
| PWA | Web App Manifest + Service Worker | hand-written | Installable, precaches routes + chunks + map, offline, versioned by commit SHA |
| Quality | ESLint + eslint-config-next | 9.39.5 | Lint incl. hooks / compiler rules, zero warnings |
| Verification | Playwright (Chromium shell) | 1.63.0 | Desktop / phone screenshots, canvas-paint checks, offline PWA check |
| | @napi-rs/canvas | 1.0.8 | Headless map render, icon generation |
| | tsx | 4.23.13 | Runs `scripts/*.ts` |
| Delivery | GitHub · Vercel | — | `UjjwalCodes01/dashboard`; Vercel builds `dashboard/` on every push |
| Round 2 (planned) | FastAPI backend | — | WebSocket telemetry fan-out `WsTransport` already speaks; `/api/templates` |
| | ROS 2 + Zenoh | — | On-robot middleware and peer-to-peer intent transport |
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
