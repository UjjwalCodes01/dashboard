# SIH 2026 · PS 26123 — Fleet Dashboard Build Documentation
## Edge-AI Based Distributed Fleet Coordination for AMRs in Smart Warehouses

**Organisation:** Bharat Electronics Limited · **Category:** Software · **Theme:** Smart Automation
**Scope of this document:** everything needed to build the multi-page fleet dashboard for Round 1 (backend + React, mock telemetry, MovingAI warehouse map).
**Companion docs:** `SIH_26123_Master_Reference.md` (algorithms, citations, benchmarks) · `SIH_26123_Round1_Dashboard_Plan.md` (Round 1 strategy, telemetry contract, demo script).

---

## Table of contents
1. [Problem statement in one page](#1-problem-statement-in-one-page)
2. [How we solve it](#2-how-we-solve-it)
3. [The golden rule for every page](#3-the-golden-rule-for-every-page)
4. [Reference screens (ForwardX) and what we take from each](#4-reference-screens-forwardx-and-what-we-take-from-each)
5. [Site map and navigation](#5-site-map-and-navigation)
6. [Page 1 — Fleet Overview (landing)](#6-page-1--fleet-overview-landing)
7. [Page 2 — Performance Hub (live warehouse)](#7-page-2--performance-hub-live-warehouse)
8. [Page 3 — Robot Detail](#8-page-3--robot-detail)
9. [Page 4 — Robot Health & Diagnostics](#9-page-4--robot-health--diagnostics)
10. [Page 5 — Resources (robots, chargers, stations)](#10-page-5--resources-robots-chargers-stations)
11. [Page 6 — Task Templates (block editor)](#11-page-6--task-templates-block-editor)
12. [Page 7 — Benchmark](#12-page-7--benchmark)
13. [Page 8 — Network & Fault Injection](#13-page-8--network--fault-injection)
14. [Data contract](#14-data-contract)
15. [Map: MovingAI warehouse](#15-map-movingai-warehouse)
16. [Tech stack and project structure](#16-tech-stack-and-project-structure)
17. [Design system](#17-design-system)
18. [Mock data engine](#18-mock-data-engine)
19. [Build order and checklist](#19-build-order-and-checklist)
20. [Demo script](#20-demo-script)
21. [Pitfalls](#21-pitfalls)

---

## 1. Problem statement in one page

**Background.** Warehouses use fleets of Autonomous Mobile Robots (AMRs). Planning everything on a central server causes network latency, Wi-Fi dead-zone failures, and a single point of failure.

**Ask.** A **decentralised** coordination and collision-avoidance framework for ≥3 AMRs on edge hardware (Raspberry Pi / Jetson), covering:

| # | Pillar | Plain meaning |
|---|---|---|
| P1 | Decentralised communication | Robots share position + intent peer-to-peer; no server, no broker |
| P2 | Dynamic conflict resolution | Deadlocks at one-lane aisles / intersections resolved locally in real time |
| P3 | Task allocation & re-routing | Blocked aisle → robot re-plans; task may be re-assigned to a better-placed peer |

**Deliverables.** Decentralised network stack · multi-agent path planning for edge hardware · **fleet dashboard (real-time positions + battery)** · simulation.

**Success criteria.** (1) **Zero** inter-robot collisions. (2) **≥20% faster** total task completion vs a stop-and-wait baseline on overlapping paths — which means we must build and show the baseline too.

**Why BEL cares.** BEL is a defence PSU. Their lens is continuity of operations when infrastructure fails. Lead with resilience.

---

## 2. How we solve it

```
L7  DASHBOARD  — passive subscriber (this document)      FastAPI + WS → React
L6  TASKS      — Contract Net Protocol auction, no auctioneer
L5  PLANNING   — PIBT: per-step, on-robot, priority inheritance + backtracking
L4  DEADLOCK   — built into PIBT; deterministic tie-break fallback
L3  SAFETY     — ORCA velocity filter, works with zero communication
L2  MIDDLEWARE — ROS 2 + Zenoh (peer-to-peer, no master)
L1  SIM        — grid world on MovingAI map (Round 1) / Gazebo (later)
L0  HARDWARE   — Raspberry Pi 5 / Jetson Orin Nano Super
```

- **Why not A\*/D\* Lite:** they are single-agent shortest-path algorithms. They answer "what is my route", not "who moves when routes conflict". We use A\* only as the distance heuristic inside PIBT. PIBT is the coordinator.
- **Data flow:** robot broadcasts pose + intent → neighbours run PIBT on the shared picture → chosen step passes through ORCA → blocked aisle triggers local re-plan and, if the cost jumps, a CNP re-bid → all of it is also streamed to the dashboard, which only listens.

---

## 3. The golden rule for every page

> **The dashboard never commands a robot.** It is a read-only subscriber. The only interactive controls are (a) *view* controls, (b) *fault injection* (kill link, block aisle, disable robot), and (c) *task template definition*, which publishes a task into the fleet's auction and lets the robots decide who takes it.

If a judge sees a "send robot here" or "forced pause" button, the decentralisation claim collapses. Every page below has a **"What we deliberately leave out"** line for this reason.

---

## 4. Reference screens (ForwardX) and what we take from each

ForwardX f(x) Fleet Manager is a mature, **centralised** commercial product. We borrow its visual language and information architecture, not its control model.

### 4.1 Landing — AMR Picking & Sorting Dashboard
![Landing page reference](images/01_landing_picking_sorting.png)

**Take:** dark theme, order-statistics tiles, map-dominant left column, right column of charts + urgent list + charging bays, aisle labels (BAB, BCD…), colour legend in the map header.
**Leave out:** nothing here is a control; this page is safe to mirror almost 1:1.

### 4.2 Performance Hub — live warehouse with AMR Details side panel
![Performance hub reference](images/02_performance_hub.png)

**Take:** clickable robots opening a left **AMR Details** card (number, battery, status, coordinate, linear/angular velocity, destination, last updated), legend at bottom-left, right rail with Tasks Completed / Battery Status bar charts and a charging-station list, lane network drawn on the floor.
**Leave out:** the bottom toolbar's control icons.

### 4.3 Resource management — Charging Station table
![Resource table reference](images/03_resource_management.png)

**Take:** the platform-level navigation (Dashboard / Deployment / System), the left sidebar (Resource → Robot / Charging Station / Docking Device), a clean data table with filters, status dots, and a version footer.
**Leave out:** Edit/Delete/Create on robots (robots aren't provisioned from the UI in a decentralised fleet). Keep Create/Edit only for **static infrastructure** (chargers, stations) and mock robots.

### 4.4 Robot health — Historical Detection Results
![Robot diagnostics reference](images/04_robot_health_diagnostics.png)

**Take:** the status-pill header (Network Connected · Localized · Autonomous · Node Healthy), the grouped PASS/FAIL checklist (Basic / Lidar / Camera / Navigation), a detection table with detection value vs standard value, a camera preview.
**Leave out:** nothing — diagnostics are read-only. We add *edge-specific* checks (planner latency, message rate, peer count).

### 4.5 Robot detail — map + multi-camera view
![Robot detail reference](images/05_robot_detail_cameras.png)

**Take:** map-plus-cameras split, AMR details card, the richer legend (navigation path vs job path, docking target, QR/reflector tags), multi-camera grid with detection overlays (Person / AMR bounding boxes).
**Leave out:** **Relocate · Restart · System Reset · Forced Pause · Control toggle.** These are remote-control commands. Our equivalent is an *Observe-only* badge in the same spot.

### 4.6 Task template — block-based job editor
![Block editor reference](images/06_block_task_editor.png)

**Take:** the Scratch-style block palette (Navigation, Working Point, Rack, Pallet, Lift, Confirm, Sleep…), vertical stacking canvas, right-hand property panel, Undo/Redo/Reset/Save.
**Reframe:** a template defines *what a task is*, not *which robot does it*. Saving a template + issuing it publishes a task to the fleet; the robots bid (CNP) and the winner self-assigns. The editor is a task *authoring* tool, never a dispatch tool.

Additional references (earlier uploads):
![ForwardX CN dashboard](images/ref_forwardx_cn_dashboard.png)
![ForwardX hub small](images/ref_forwardx_hub_small.png)

---

## 5. Site map and navigation

```
/                    Fleet Overview (landing)
/hub                 Performance Hub — live map, click robot → side panel
/robots/:id          Robot Detail — map focus + cameras + telemetry
/robots/:id/health   Robot Health & Diagnostics
/resources           Resources — tabs: Robots · Charging Stations · Pick/Drop Stations
/tasks               Task Templates — block editor + template list + live task queue
/benchmark           Baseline vs Ours
/network             Network health + Fault Injection
```

**Top bar (all pages):** logo · page tabs (Overview · Hub · Resources · Tasks · Benchmark · Network) · scenario selector · sim clock · permanent badge **"Read-only monitor · No central server"** · WebSocket status dot.

**Left sidebar** appears only on Resources and Tasks (ForwardX Deployment-Platform style). Overview and Hub are full-bleed dashboards.

---

## 6. Page 1 — Fleet Overview (landing)

Purpose: the first screen judges see. Everything moving, everything green, collisions 0.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ LOGO   AMR Fleet Coordination Monitor         [Scenario ▾]  2026-09-06 …  │
├──────────────────────────────────────────────┬───────────────────────────┤
│ TASK STATISTICS                              │ ACTIVE AMR WORK PROGRESS  │
│ Urgent 4 │ In progress 6 │ Unassigned 9 │    │ bar per robot, hover →    │
│ Completed 118 │ Re-bid 3 │ Total 140         │ status + battery tooltip  │
├──────────────────────────────────────────────┼───────────────────────────┤
│ REAL-TIME FLEET MAP  ● In task ● Charging    │ URGENT TASK LIST          │
│ ● Idle ● Yielding ● Degraded  P Parking      │ robot · from · to · stops │
│                                              │ · assigned by (auction)   │
│      [MovingAI warehouse, aisle labels,      ├───────────────────────────┤
│       robots, intent trails, stations]       │ COLLISIONS   0            │
│                                              │ DEADLOCKS RESOLVED  7     │
│                                              ├───────────────────────────┤
│                                              │ CHARGING STATION STATUS   │
│                                              │ CH-01 idle · CH-02 AMR-04 │
└──────────────────────────────────────────────┴───────────────────────────┘
```

**Components**
- `StatTiles` — six tiles, colours as in the ForwardX reference (red / blue / amber / green / teal / white). Tile "Re-bid" replaces "Manual Handover": it counts tasks re-auctioned after a blockage — a number that only exists in a decentralised system.
- `FleetMap` (shared with Hub, see §7) in compact mode.
- `WorkProgressChart` — Recharts bar chart, one bar per robot, colour = state, tooltip = status + battery.
- `UrgentTaskTable` — sorted by deadline; column *assigned by* always reads "auction" with the winning bid value.
- `SafetyTiles` — Collisions (large, green border, turns red if ever >0) and Deadlocks resolved.
- `ChargingStrip` — one chip per bay: idle / charging (robot + %) / fault.

**What we deliberately leave out:** manual handover, any dispatch action.

---

## 7. Page 2 — Performance Hub (live warehouse)

Purpose: the demo stage. Full-height map, click a robot for its details, right rail for fleet charts.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ┌AMR DETAILS──────┐                                     ┌TASKS COMPLETED┐  │
│ │ AMR-03          │                                     │ bar per robot │  │
│ │ Battery ▓▓▓ 63% │           LIVE MAP                  ├BATTERY STATUS─┤  │
│ │ State working   │   robots · intent trails ·          │ bar per robot │  │
│ │ Pose (17,42,90°)│   comms range · choke rings ·       ├CHARGING───────┤  │
│ │ v 0.8 m/s ω 0°/s│   lanes · stations · blocked cells  │ bay list      │  │
│ │ Task T-118 → D1 │                                     ├NEIGHBOURS─────┤  │
│ │ Peers 2 · link ●│                                     │ who hears whom│  │
│ │ Planner 3.1 ms  │                                     │ (P2P graph)   │  │
│ │ Yields 2        │                                     └───────────────┘  │
│ │ Updated 0.2 s   │                                                        │
│ │ [Open detail →] │                                                        │
│ └─────────────────┘                                                        │
│ ┌LEGEND──────────┐  ┌VIEW TOGGLES──────────────────────────────────┐       │
│ │ ● idle ● tasking│  │ intent trails · comms range · grid · labels  │       │
│ │ ● charging …    │  │ lanes · choke points                         │       │
│ └────────────────┘  └──────────────────────────────────────────────┘       │
└────────────────────────────────────────────────────────────────────────────┘
```

**Map rendering spec (`FleetMap` component)**

| Layer | Content | Canvas |
|---|---|---|
| 0 static | shelves (merged rectangles), aisle labels, stations, chargers, lane centre-lines | drawn once, cached |
| 1 overlay | blocked cells (hatched red), choke rings, comms-range circle of selected robot | redrawn on change |
| 2 dynamic | robots, heading arrows, intent trails, peer link lines, ID labels | 30 fps, interpolated between 5 Hz ticks |

Robot glyph: rounded square (ForwardX-style) with heading notch, ID pill above, thin battery arc. State colours in §17.

**Interactions:** click robot → AMR Details card slides in (left); click empty map → deselect; scroll = zoom, drag = pan; double-click robot → `/robots/:id`.

**Right rail:** Tasks Completed (bar), Battery Status (bar), Charging (list with bolt icons), **Neighbour graph** — a small force graph of who is currently within comms range of whom. This last one is unique to us and makes P2P visible.

**What we deliberately leave out:** the bottom control toolbar.

---

## 8. Page 3 — Robot Detail

Purpose: everything about one robot, ForwardX-style map + cameras split, without control buttons.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Map: warehouse-10-20-10-2-1   AMR: [AMR-03 ▾]        ● Observe only      │
├──────────────────────────┬───────────────────────────────────────────────┤
│ AMR DETAILS              │ AMR-03  [Localized] [Autonomous] [Peers: 2]   │
│ (same card as Hub +      │ ┌ Front camera (mock feed + detection boxes) ┐│
│  lift status, job name,  │ │  Person 0.61 · AMR 0.49 · pallet 0.88       ││
│  last 5 decisions)       │ └────────────────────────────────────────────┘│
│                          │ ┌Left marker┐ ┌Right marker┐ ┌RGBD / no data┐ │
│ DECISION LOG (this robot)│ └───────────┘ └────────────┘ └──────────────┘ │
│ 12:04:31 yielded to AMR-1│ TELEMETRY STRIP                                │
│ 12:04:12 won bid T-118   │ speed sparkline · battery sparkline ·          │
│ 12:03:50 replanned +6    │ planner ms sparkline · msgs/s sparkline        │
├──────────────────────────┤                                                │
│ MAP (focused on robot)   │ INTENT WINDOW                                  │
│ navigation path (own)    │ next 8 cells with timestamps + which peers     │
│ job path (task)          │ have acknowledged them                         │
│ docking target           │                                                │
└──────────────────────────┴───────────────────────────────────────────────┘
```

**Cameras.** Round 1 uses looping mock clips or still frames with drawn detection boxes (Person / AMR / obstacle). Label them clearly as *simulated feed*. Final build: MJPEG/WebRTC from the robot's onboard camera, still read-only.

**Decision log.** The per-robot slice of the event log: yields, bids won/lost, re-plans, link changes. This is where a judge can trace *why* a robot did something — the core of an explainable decentralised system.

**What we deliberately leave out:** Relocate · Restart · System Reset · Forced Pause · Control toggle. Replace with a fixed **"Observe only"** badge in the same header position.

---

## 9. Page 4 — Robot Health & Diagnostics

Purpose: mirror the ForwardX detection-results page, extended with edge-coordination checks.

**Header pills:** Scheduling mode → replaced by **Coordination: PIBT** · Network Connected · Localized · Robot Connected · Autonomous · Node Healthy · **Peers: N**.

**Grouped checklist (PASS / WARN / FAIL):**

| Group | Items |
|---|---|
| Basic | software version, firmware, edge board (Pi 5 / Orin), Wi-Fi, battery health |
| Lidar | front, rear |
| Camera | front fisheye, marker cameras, RGBD |
| Navigation | IMU, odometry drift estimate, lift |
| **Coordination (ours)** | planner latency < 20 ms · intent broadcast rate ≥ 5 Hz · peer discovery ok · ORCA filter active · clock skew vs peers < 50 ms |

**Detail table** for the selected item: Detection item · Detection value · Standard value · Result · Note. Camera items show a preview image.

**Actions:** Download report (JSON/PDF). No "run check now" that commands the robot — reports arrive when the robot self-publishes them.

---

## 10. Page 5 — Resources (robots, chargers, stations)

Purpose: the "Deployment Platform" style admin table.

Sidebar: **Resource** (Robot · Charging Station · Pick/Drop Station) · **Map** · **Task Templates** · **Scenarios** · **System**.

**Robot tab columns:** Name · ID · Model · Edge board · Firmware · Status (● online / degraded / offline) · Battery · Current task · Peers · Last seen · *View*.
**Charging Station tab columns:** Name · SN · Type · Model · Working mode · Status · Charging status · Charging AMR · Edit · Delete.
**Pick/Drop Station tab columns:** Name · Aisle · Cell · Type (pickup / drop) · Queue length · Edit · Delete.

Table features: search, column filters (ForwardX-style funnel icons), status dots, expandable rows, refresh, version footer (`Dashboard v0.1 · Schema v1 · Map warehouse-10-20-10-2-1`).

**What we deliberately leave out:** Create/Delete on robots in the final build (robots join by peer discovery). Round 1 keeps a "Add mock robot" action for demo flexibility, labelled as such.

---

## 11. Page 6 — Task Templates (block editor)

Purpose: make task authoring easy for a floor manager using Scratch-style blocks, while keeping assignment decentralised.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ✕ Edit Task Template                    Undo  Redo  Reset  [Save] [Issue]│
├──────────┬───────────────────────────────────┬───────────────────────────┤
│ PALETTE  │ CANVAS (vertical stacking)        │ PROPERTIES                │
│ Navigate │ ┌Start┐                           │ Navigate                  │
│ Pickup   │ ┌Navigate → P2┐                   │  Target type: Station     │
│ Drop     │ ┌Pickup  rack R-14┐               │  Station: P2              │
│ Rack     │ ┌Navigate → D1┐                   │  Priority: normal ▾       │
│ Lift     │ ┌Drop┐                            │  Battery floor: 20 %      │
│ Wait     │ ┌Wait 5 s┐                        │  Allow re-bid on block: ☑ │
│ Confirm  │ ┌Charge if < 20 %┐                │                           │
│ Charge   │                                   │ ALLOCATION (read-only)    │
│ Repeat   │                                   │  Method: CNP auction      │
│          │                                   │  Bid = dist + 0.5·queue   │
│          │                                   │        + battery penalty  │
└──────────┴───────────────────────────────────┴───────────────────────────┘
```

**Blocks:** Navigate (to station / aisle cell) · Pickup · Drop · Rack · Lift · Wait · Confirm · Charge-if · Repeat · Sleep. Colour by family like the reference (navigation = pink, handling = green, control = yellow).

**Implementation:** Blockly (Google) is the fastest path; it gives the palette, snapping, undo/redo and JSON serialisation for free. Alternative: a lightweight custom stacker with dnd-kit if Blockly's look clashes with the dark theme (Blockly themes are customisable — try that first).

**Save** stores the template (JSON block tree). **Issue** creates N task instances from the template and publishes them to the fleet's task topic. Then the **Live Task Queue** panel below the editor shows each task moving through: *announced → bids received (with values per robot) → winner self-assigned → in progress → done / re-bid*. Showing the bids is the proof that the dashboard didn't pick the robot.

**Template list** (right side, like the reference): name, steps, last issued, Export / Delete.

**What we deliberately leave out:** an "assign to robot" dropdown. There is none, on purpose.

---

## 12. Page 7 — Benchmark

Purpose: the 20% claim, live.

- Scenario picker (Head-on · 4-way · Choke · Blocked aisle · Robot failure · Partition) + seed field + **Run both**.
- Two synchronised mini-maps: **Stop-and-wait (baseline)** left, **Decentralised (ours)** right, same seed.
- Two timers, two progress bars, then the metrics table:

| Metric | Baseline | Ours |
|---|---|---|
| Makespan (s) | 212.4 | 164.9 |
| Sum of individual costs | | |
| Throughput (tasks/min) | | |
| Collisions | 0 | 0 |
| Deadlocks / mean resolution (s) | | |
| Total stop time (s) | 71.2 | 19.8 |
| Path deviation vs shortest (%) | | |
| Choke-point flow rate | | |
| Planner latency p50 / p95 (ms) | | |
| Msgs/s per robot | | |

- Improvement percentage in large type. A "Runs: n = 30 · mean ± std" line and an error-bar chart per metric (Round 1: placeholder values, real layout).

---

## 13. Page 8 — Network & Fault Injection

Purpose: the money shot. Titled **"Fault injection — the only controls on this system"**.

- Per-robot row: link toggle · msgs/s · last-seen age · peers · discovery traffic.
- Global sliders: packet loss % · added latency ms (mock in Round 1; `tc netem` later).
- Buttons: **Block aisle** (click a cell on the small map) · **Disable robot** · **Partition fleet** (split into two groups).
- Live chart: messages/sec per robot and total; a second chart of discovery traffic labelled "DDS vs Zenoh" for the final build.
- Right side: the fleet map in miniature so the judge sees robots keep moving as they break things, with the Collisions tile pinned beside it.

---

## 14. Data contract

All messages over one WebSocket: `ws://host/ws/telemetry`. Server → client only, except the two fault-injection and task-issue messages listed at the end.

```jsonc
// 5 Hz per robot
{ "type": "robot_state", "robot_id": "AMR-03", "seq": 4821, "ts": 1757164800.212,
  "pose": { "x": 17.0, "y": 42.0, "heading": 90 }, "speed": 0.8, "ang_speed": 0.0,
  "state": "working",              // idle|working|charging|blocked|yielding|degraded|offline
  "battery_pct": 63.4, "lift": "down",
  "task": { "id": "T-118", "template": "pick-drop", "step": "Navigate → D1", "progress": 0.42 },
  "intent": [[17,43],[17,44],[17,45],[18,45]],
  "intent_acked_by": ["AMR-01"],
  "neighbours": ["AMR-01","AMR-05"], "link_ok": true,
  "planner_latency_ms": 3.1, "msgs_per_sec": 5.2, "yield_count": 2,
  "health": { "overall": "PASS", "failed": [] } }

// 1 Hz
{ "type": "fleet_stats", "ts": 0, "active": 4, "idle": 1, "charging": 1, "blocked": 0,
  "tasks_urgent": 4, "tasks_in_progress": 6, "tasks_unassigned": 9, "tasks_done": 118,
  "tasks_rebid": 3, "collisions": 0, "deadlocks_resolved": 7, "msgs_per_sec_total": 31 }

// on change
{ "type": "event", "ts": 0, "level": "info|warn|error", "category": "conflict|task|network|battery|health",
  "robot_id": "AMR-03", "text": "AMR-03 yielded to AMR-01 at choke B4 (priority inheritance)" }

{ "type": "task", "task_id": "T-121", "phase": "announced|bidding|assigned|in_progress|done|rebid",
  "bids": { "AMR-02": 14.2, "AMR-05": 21.7 }, "winner": "AMR-02", "template": "pick-drop" }

{ "type": "network", "ts": 0, "links": { "AMR-01": true, "AMR-03": false },
  "loss_pct": 0, "latency_ms": 0, "partitions": [["AMR-01","AMR-02"],["AMR-03"]] }

{ "type": "benchmark", "scenario": "head_on", "seed": 42,
  "baseline": { "elapsed_s": 212.4, "tasks_done": 18, "stop_time_s": 71.2, "collisions": 0 },
  "ours":     { "elapsed_s": 164.9, "tasks_done": 18, "stop_time_s": 19.8, "collisions": 0 },
  "improvement_pct": 22.4, "runs": 30, "std_pct": 3.1 }

{ "type": "health_report", "robot_id": "AMR-03", "ts": 0,
  "groups": [{ "name": "Coordination", "items": [
     { "item": "Planner latency", "value": "3.1 ms", "standard": "< 20 ms", "result": "PASS" } ] }] }

{ "type": "map", "name": "warehouse-10-20-10-2-1", "width": 60, "height": 40,
  "obstacles": "<run-length-encoded>", "aisles": { "B4": [[12,7],[12,20]] },
  "stations": [{ "id": "P2", "type": "pickup", "cell": [3,10] }],
  "chargers": [{ "id": "CH-02", "cell": [58,2] }], "chokes": [[12,7],[24,7]] }

// client → server (the only allowed ones)
{ "type": "fault", "action": "toggle_link|block_cell|disable_robot|partition|set_loss|set_latency", "target": "AMR-03", "value": false }
{ "type": "issue_task", "template_id": "pick-drop", "count": 3, "priority": "urgent" }
{ "type": "scenario", "name": "head_on", "seed": 42 }
```

Pydantic models in `backend/schema.py` are the single source of truth; the frontend types are generated from them (`datamodel-codegen` → TS, or hand-mirrored in `types.ts`).

---

## 15. Map: MovingAI warehouse

- Source: https://movingai.com/benchmarks/mapf/index.html — Stern et al., SoCS 2019.
- File: `warehouse-10-20-10-2-1.map` (63 × 161, corridor width one). Crop to a 40 × 60 window for Round 1 so six robots read well on a laptop; keep full map for a "scales" screenshot.
- Format: header (`type`, `height`, `width`, `map`) then rows; `.` free, `@`/`T` obstacle.
- `map_loader.py` responsibilities: parse → boolean grid → merge obstacle cells into rectangles → auto-label aisles (column letters × row numbers, ForwardX style) → detect choke points (free cells with exactly two free neighbours forming a corridor that joins a wider region) → load `map_config.json` for stations, chargers, parking.
- Lane centre-lines (the green network in the ForwardX hub) are just the aisle mid-lines; draw them as thin lines with small direction chevrons at intersections.

---

## 16. Tech stack and project structure

**Backend:** Python 3.11 · FastAPI · `websockets` · pydantic v2 · numpy. Mock engine runs in an asyncio task; one broadcaster fans out to all clients.
**Frontend:** Vite · React 18 · TypeScript · Tailwind · Zustand (store) · Recharts (charts) · Blockly (task editor) · react-router. Map on raw Canvas (two stacked canvases). Icons: lucide-react.
**Dev:** `uvicorn backend.main:app --reload` and `npm run dev`; a `docker-compose.yml` for one-command demo start.

```
fleet-dashboard/
├── backend/
│   ├── main.py                 # FastAPI, /ws/telemetry, /api/map, /api/templates
│   ├── schema.py               # pydantic models (contract)
│   ├── map_loader.py           # MovingAI parser, aisle labels, choke detection
│   ├── mock_fleet.py           # robots, movement, yielding, battery, tasks
│   ├── auction.py              # mock CNP: announce → bids → winner
│   ├── baseline.py             # stop-and-wait rules
│   ├── scenarios/              # normal, head_on, intersection, choke, blocked_aisle,
│   │                           # robot_failure, network_partition
│   ├── health.py               # mock health reports
│   ├── maps/                   # .map files + map_config.json
│   └── templates/              # saved block-editor JSON
├── frontend/src/
│   ├── App.tsx  routes.tsx  store.ts  types.ts
│   ├── ws/useTelemetry.ts
│   ├── map/  MapCanvas.tsx  layers/  interpolate.ts  aisleLabels.ts
│   ├── pages/ Overview  Hub  RobotDetail  RobotHealth  Resources  Tasks  Benchmark  Network
│   ├── components/ TopBar  Sidebar  StatTiles  AmrDetailsCard  Legend  EventLog
│   │               RobotTable  ChargingStrip  WorkProgressChart  BatteryChart
│   │               NeighbourGraph  CameraGrid  HealthChecklist  BlockEditor
│   │               TaskQueue  BenchmarkPanel  FaultPanel
│   └── theme/ tokens.css
├── docs/                       # this file + images
└── docker-compose.yml
```

---

## 17. Design system

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0B1220` | page (Overview/Hub) |
| `--bg-light` | `#F7F8FA` | page (Resources/Tasks/Health — ForwardX admin pages are light; keep that contrast) |
| `--panel` | `#111A2E` | cards on dark pages |
| `--panel-border` | `#1E2A45` with 1-px cyan glow on hover | |
| `--grid` | `#1C2740` | map grid |
| `--shelf` | `#2A3550` | obstacles |
| `--lane` | `#2ED37A` at 40% | lane lines |
| `--accent` | `#22D3EE` | headers, links, selected |
| `--idle` | `#FACC15` (yellow, as ForwardX) | |
| `--working` | `#3B82F6` (blue "Tasking", as ForwardX) | |
| `--charging` | `#22C55E` | |
| `--yielding` | `#A78BFA` | |
| `--blocked` | `#F59E0B` | |
| `--degraded` | `#FB923C` | |
| `--offline` / `--exception` | `#EF4444` | |
| `--text` / `--text-2` | `#E5E7EB` / `#94A3B8` | |

Fonts: Inter (UI), JetBrains Mono (IDs, timers, coordinates, log). Tile numbers 32–40 px semibold. Card radius 8 px. Dark pages get the subtle "starfield" background from the ForwardX landing (a static PNG, very low opacity).

Stat-tile colours (landing): urgent `#B91C1C`, in-progress `#1D4ED8`, unassigned `#B45309`, completed `#15803D`, re-bid `#0F766E`, total `#374151` — each with a lighter top strip like the reference.

---

## 18. Mock data engine

- **Fleet:** AMR-01…AMR-06 (allow up to 12 via config). Start batteries spread 45–95%. Drain 0.15 %/s moving, 0.03 %/s idle; charge +1 %/s docked. Below 20% → `Charge` step inserted, event emitted.
- **Movement:** cell-to-cell along BFS/A\* paths at 0.6–1.0 m/s; slow to 0.3 m/s when a neighbour's intent overlaps own intent; priority rule = lower remaining distance wins, ties by ID; one-step backtrack for head-on. Every yield emits an event and increments `yield_count`.
- **Comms model:** neighbours = robots within R cells (default 12). A killed link removes the robot from everyone's neighbour lists; the robot enters `degraded`, shortens its intent to 3 cells, and keeps moving on ORCA-like local avoidance (mocked as slow-and-sidestep).
- **Tasks:** continuous generator from templates; 8–12 pending at all times. Each task runs the mock auction: bids = dist + 0.5·queue + battery penalty; winner assigned; bids stored on the task message so the UI can show them.
- **Scenarios:** seeded; injections at t+10 s and t+40 s; all clear by t+70 s. Same seed → identical replay.
- **Benchmark:** two engine instances (baseline rules vs ours) stepping in lockstep from the same seed; stream both to the Benchmark page.
- **Health reports:** generated every 60 s per robot; occasionally emit a WARN (e.g. planner latency 18 ms) so the page isn't all green.
- **Cameras:** 3–4 looping clips/stills per robot with pre-drawn detection boxes.

---

## 19. Build order and checklist

Order chosen so the map and contract exist before any page.

**Week 1 — foundation**
- [ ] `schema.py` — every message type above
- [ ] `map_loader.py` + `map_config.json` + `/api/map`
- [ ] `mock_fleet.py` — robots, movement, yielding, battery, events
- [ ] `main.py` — WebSocket broadcaster at 5 Hz; scenario switch
- [ ] Frontend scaffold, router, store, `useTelemetry`, `types.ts`
- [ ] `MapCanvas` with static + dynamic layers, intent trails, selection

**Week 2 — pages**
- [ ] Overview page (stat tiles, map, progress chart, urgent table, charging strip)
- [ ] Hub page (AMR Details card, legend, right rail, neighbour graph)
- [ ] Robot Detail (details, decision log, camera grid, intent window)
- [ ] Resources (three tabs, tables, filters, footer)
- [ ] Event log component shared across pages

**Week 3 — story pages**
- [ ] `auction.py` + Task Templates page (Blockly editor, template list, live task queue with bids)
- [ ] `baseline.py` + Benchmark page (dual maps, timers, metrics table)
- [ ] Network & Fault Injection page (toggles, sliders, block-aisle, charts)
- [ ] Robot Health page + `health.py`

**Week 4 — polish + demo**
- [ ] Six scenarios scripted and paced; seeds fixed
- [ ] Theme pass: dark hub pages, light admin pages, glow borders, starfield
- [ ] `docker-compose up` one-command start
- [ ] Rehearse demo twice with the same seed; capture screenshots for PPT

---

## 20. Demo script (6 minutes)

| t | Page | Action / line |
|---|---|---|
| 0:00 | Overview | "Six robots, every decision made on-robot. Note the badge: this screen is read-only." |
| 0:40 | Hub | Click AMR-03 → details card. Toggle *comms range* → peers light up. "This is the peer-to-peer picture each robot plans from." |
| 1:30 | Hub | Scenario → Head-on. Two robots meet in B4; one yields; log explains "priority inheritance". |
| 2:20 | Tasks | Issue 3 tasks from the pick-drop template. Watch bids arrive per robot, winner self-assigns. "We never chose the robot." |
| 3:10 | Network | Kill AMR-03's link. Robot turns orange, keeps moving, Collisions stays 0. Restore. |
| 4:10 | Benchmark | Run head-on with seed 42. Baseline freezes; ours flows. Show improvement %. "Same map, same tasks, same seed, 30 runs." |
| 5:10 | Robot Detail / Health | Cameras + decision log + coordination checks. "Everything a floor manager needs, nothing that overrides the robots." |
| 5:40 | Overview | Close on the architecture line: "Round 1 is mock telemetry on the final schema; Round 2 swaps the mock for PIBT on ROS 2 + Zenoh. This screen doesn't change." |

---

## 21. Pitfalls

1. Any control that commands a robot (relocate, pause, reset, assign). Only fault injection and task *authoring* are allowed.
2. Collision counter not visible, or visible and non-zero.
3. Benchmark shown without "same map, same tasks, same seed".
4. Robots gliding through shelves — the mock must respect the map.
5. Dead air: nothing happening for 30 s. Scenarios must be paced.
6. Calling the mock the real algorithm. Say "scripted telemetry, final schema".
7. Copying ForwardX branding or their exact assets. Take the layout and colour logic; make your own logo, icons and starfield.
8. Blockly's default light theme on a dark page — theme it or put the Tasks page on the light admin layout (recommended, matches the reference).
