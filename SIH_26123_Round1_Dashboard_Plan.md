# SIH 2026 — PS 26123 · Round 1 Plan
## Edge-AI Based Distributed Fleet Coordination for AMRs in Smart Warehouses

**Organisation:** Bharat Electronics Limited (BEL) · **Category:** Software · **Theme:** Smart Automation
**Round 1 scope:** Backend + React fleet dashboard driven by mock telemetry on a MovingAI warehouse map.
**Companion doc:** `SIH_26123_Master_Reference.md` (algorithms, citations, benchmark methodology).

---

## 1. The Problem Statement, decoded

### 1.1 What BEL is asking for
Warehouses run fleets of Autonomous Mobile Robots (AMRs). Today, path planning usually happens on a central server. That creates three failure modes: network latency, Wi-Fi dead-zones, and a single point of failure. BEL wants a **decentralised** alternative where each robot runs its own intelligence on edge hardware (Raspberry Pi / Jetson) and coordinates with peers directly.

### 1.2 The three functional pillars

| Pillar | Requirement | What it means in practice |
|---|---|---|
| **P1 — Decentralised communication** | Robots share position + intent with no central server | Peer-to-peer pub/sub. Every robot broadcasts its pose and the next N cells it intends to occupy. No broker, no coordinator node. |
| **P2 — Dynamic conflict resolution** | Resolve deadlocks and avoid collisions at narrow aisles / intersections in real time | Each robot decides its own next step from the shared intent picture. Deadlocks (head-on aisle, 4-way intersection, circular wait) must resolve without a referee. |
| **P3 — Task allocation & re-routing** | Re-assign pickups / change paths when an aisle is blocked | Local re-plan on blockage; if the task is now better served by another robot, it is re-auctioned among peers. |

### 1.3 Expected deliverables (verbatim from PS, mapped to our build)

| PS deliverable | Our implementation |
|---|---|
| Decentralised network stack (P2P localisation sharing) | Intent-broadcast protocol; ROS 2 + Zenoh in final build, simulated message bus in Round 1 |
| Multi-agent path planning for edge hardware | PIBT (per-step, on-robot) + ORCA safety filter; A* only as the distance heuristic inside PIBT |
| **Fleet dashboard** — lightweight UI, real-time positions + battery | **This document.** FastAPI + WebSocket → React + Canvas |
| Simulation with ≥3 AMRs | 6 AMRs on a MovingAI warehouse grid |

### 1.4 The two hard success criteria

1. **Zero inter-robot collisions.** Binary. A live collision counter must exist and stay at 0.
2. **≥20% reduction in total task completion time vs stop-and-wait.** We must build the stop-and-wait baseline ourselves and run both systems on the same map, same tasks, same seed. The dashboard shows both timers side by side.

### 1.5 Why BEL cares (pitch lens)
BEL is a defence PSU. Their evaluation lens is **continuity of operations when infrastructure fails** — jammed comms, damaged networks, remote depots. Lead the pitch with resilience, not with throughput. The dashboard's "kill link" demo is the single most important moment.

---

## 2. Solution approach (summary)

### 2.1 Layered architecture

```
┌──────────────────────────────────────────────────────────────┐
│ L7  DASHBOARD — passive subscriber, never commands robots    │
│     FastAPI + WebSocket  →  React + Canvas                   │
└───────────────────────────▲──────────────────────────────────┘
                            │ telemetry only (one-way)
┌───────────────────────────┴──────────────────────────────────┐
│ L6  TASK ALLOCATION — Contract Net Protocol (auction)        │
│ L5  PATH PLANNING     — PIBT, per-step, on each robot        │
│ L4  DEADLOCK          — priority inheritance + backtracking  │
│ L3  SAFETY FILTER     — ORCA velocity clamp (needs no comms) │
│ L2  MIDDLEWARE        — ROS 2 + Zenoh (P2P, no master)       │
│ L1  SIMULATION        — grid world (Round 1) / Gazebo (later)│
│ L0  EDGE HARDWARE     — Raspberry Pi 5 / Jetson Orin Nano    │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Why not just A* / D* Lite
A* and D* Lite are **single-agent** shortest-path algorithms. They answer "what is my route" but say nothing about **who moves when two routes conflict**. Multi-robot coordination is a MAPF (Multi-Agent Path Finding) problem. We use A* only as the distance table inside PIBT; PIBT does the actual coordination. Never tell a judge "A* doesn't work" — say "A* is the heuristic, PIBT is the coordinator."

### 2.3 Data-flow story (memorise)
1. Each robot broadcasts `pose + velocity + intent (next N cells) + battery + task`.
2. Neighbours subscribe. Each robot runs PIBT locally on the received intent picture and picks its own next step. Priority inheritance decides who yields — no negotiation round-trip.
3. The chosen step passes through an ORCA safety filter before becoming a velocity command. ORCA needs no communication, so it still protects the robot when the link drops.
4. Blocked aisle → local re-plan. If the cost jumps past a threshold, the robot releases the task and peers bid on it (CNP). Same deterministic bid function on every robot → same winner, no auctioneer.
5. All of the above is also pushed to the dashboard, which only listens.

**The one line that wins the architecture question:** *"The dashboard is a read-only subscriber. If it could command robots, we would have rebuilt the central server we're trying to eliminate."*

---

## 3. Round 1 strategy

### 3.1 What Round 1 must achieve
Round 1 is an idea + feasibility evaluation. The goal is a dashboard that looks and behaves like a production fleet monitor, fed by mock telemetry that is **shaped exactly like the real telemetry will be**. Nothing built in Round 1 should be thrown away — only the mock generator gets swapped for real robot nodes later.

### 3.2 What is real vs mocked in Round 1

| Component | Round 1 | Final |
|---|---|---|
| Map | Real MovingAI warehouse map file, parsed and rendered | Same |
| Telemetry schema | Real, final | Same |
| WebSocket transport | Real | Same |
| Dashboard UI | Real, final layout | Polished |
| Robot movement | Mock: scripted paths + simple priority yielding on the grid | PIBT + ORCA |
| Task allocation | Mock: scripted re-bid events | CNP |
| Baseline vs Ours timer | Mock: two scripted runs with plausible numbers | Real seeded runs, 30+ trials |
| Kill-link toggle | Real toggle → mock robot switches to "degraded" behaviour | Real network partition |

### 3.3 Reference: ForwardX f(x) Fleet Manager
We borrow ForwardX's **visual language** — dark theme, map-first layout, colour-coded robot states, order-stats strip, per-robot table, charging-station panel, emergency-wave list. We deliberately **do not** replicate its Traffic Controller, Remote Control, or Task Deployment features: those are centralised command paths, which is exactly what our PS eliminates. Say this out loud in the demo.

---

## 4. Warehouse map — MovingAI

### 4.1 Map choice
Use the MovingAI MAPF benchmark warehouse family (Stern et al., SoCS 2019): https://movingai.com/benchmarks/mapf/index.html

| Map | Size | Why |
|---|---|---|
| `warehouse-10-20-10-2-1` | 63 × 161 | Corridor width **one** — ideal for head-on and choke-point demos |
| `warehouse-10-20-10-2-2` | 84 × 170 | Wider corridors, more forgiving for early demos |
| `warehouse-20-40-10-2-1` | 123 × 321 | Large; use only for "scales to this" screenshots |

**Round 1 recommendation:** `warehouse-10-20-10-2-1`, optionally cropped to a 40 × 60 window so 6 robots are visually dense enough on a laptop screen. Keep the full map loadable for the "scale" slide.

### 4.2 File format
```
type octile
height 63
width 161
map
@@@@@@@@@@@@...
@..........@...
@..@@@@@@..@...
```
`.` = free cell, `@` / `T` = obstacle. Parse into a 2-D boolean grid. Shelf blocks are contiguous `@` regions; aisles are the `.` corridors between them.

### 4.3 Rendering rules
- Shelves: filled dark-grey rectangles (merge adjacent obstacle cells into rectangles for performance).
- Aisles: dark background with a faint 1-px grid.
- Label aisles automatically (A1, A2 … / B1, B2 …) like the ForwardX floor plan so the event log can say "R3 yielded to R1 in aisle B4".
- Mark pickup stations, drop stations and charging bays as coloured cells on the perimeter (we choose their positions; document them in `map_config.json`).
- Choke points (intersections of one-wide corridors) drawn with a subtle highlight ring — they are where the demo action happens.

---

## 5. Telemetry contract (the schema everything depends on)

One message type per robot, broadcast every 200 ms. The dashboard subscribes and never publishes.

```json
{
  "type": "robot_state",
  "robot_id": "AMR-03",
  "seq": 4821,
  "ts": 1757164800.212,
  "pose": { "x": 17.0, "y": 42.0, "heading": 90 },
  "speed": 0.8,
  "state": "working",
  "battery_pct": 63.4,
  "task": { "id": "T-118", "type": "pickup", "from": "P2", "to": "D1", "progress": 0.42 },
  "intent": [[17,43],[17,44],[17,45],[18,45]],
  "neighbours": ["AMR-01", "AMR-05"],
  "link_ok": true,
  "planner_latency_ms": 3.1,
  "yield_count": 2
}
```

**state enum:** `idle` · `working` · `charging` · `blocked` · `yielding` · `degraded` · `offline`

Fleet-level and event messages:

```json
{ "type": "fleet_stats", "ts": ..., "active": 4, "idle": 1, "charging": 1, "blocked": 0,
  "tasks_done": 118, "tasks_pending": 9, "collisions": 0, "deadlocks_resolved": 7,
  "msgs_per_sec": 31 }

{ "type": "event", "ts": ..., "level": "info",
  "text": "AMR-03 yielded to AMR-01 at choke B4 (priority inheritance)" }

{ "type": "benchmark", "ts": ...,
  "baseline": { "elapsed_s": 212.4, "tasks_done": 18, "stop_time_s": 71.2 },
  "ours":     { "elapsed_s": 164.9, "tasks_done": 18, "stop_time_s": 19.8 },
  "improvement_pct": 22.4 }

{ "type": "network", "ts": ..., "links": { "AMR-01": true, "AMR-02": true, "AMR-03": false, ... } }
```

The only client → server message allowed:
```json
{ "type": "toggle_link", "robot_id": "AMR-03", "up": false }
```
This is a *fault injection* control, not a robot command. It is the one button on the dashboard and it must be labelled as such.

---

## 6. Dashboard — panel by panel

Layout mirrors ForwardX: stat strip on top, map dominant on the left (~65% width), stacked panels on the right, event log along the bottom.

```
┌────────────────────────────────────────────────────────────────────────┐
│ LOGO   Fleet Coordination Monitor         ● No central server   ⏱ time │
├────────────────────────────────────────────────────────────────────────┤
│ ACTIVE 4 │ IDLE 1 │ CHARGING 1 │ BLOCKED 0 │ TASKS DONE 118 │ COLLISIONS 0 │
├──────────────────────────────────────────┬─────────────────────────────┤
│                                          │ BASELINE vs OURS            │
│                                          │  stop-and-wait  212.4 s     │
│         LIVE MAP (Canvas)                │  decentralised  164.9 s     │
│   shelves · aisles · robots · intent     │  ▲ 22.4% faster             │
│   trails · choke rings · stations        ├─────────────────────────────┤
│                                          │ ROBOT TABLE                 │
│                                          │ id state batt task link ms  │
│                                          ├─────────────────────────────┤
│                                          │ NETWORK HEALTH + KILL LINK  │
│                                          ├─────────────────────────────┤
│                                          │ CHARGING BAYS               │
├──────────────────────────────────────────┴─────────────────────────────┤
│ EVENT LOG  12:04:31 AMR-03 yielded to AMR-01 at choke B4 …             │
└────────────────────────────────────────────────────────────────────────┘
```

### 6.1 Header
- Title, current time, elapsed sim time.
- A permanent badge: **"No central server — dashboard is read-only"**. Judges should see this before they ask.
- Scenario selector (dropdown): Normal ops · Head-on corridor · 4-way intersection · Blocked aisle · Robot failure · Network partition. Selecting a scenario tells the mock generator which script to play. This is scenario *selection*, not robot control.

### 6.2 Stat strip
Six tiles, ForwardX style: Active, Idle, Charging, Blocked, Tasks done, **Collisions**. The Collisions tile is visually distinct (green border, large 0). If it ever goes non-zero it turns red — it never should.

### 6.3 Live map (the centrepiece)
Canvas rendering at 30 fps, interpolated between 200 ms telemetry ticks so motion is smooth.

| Element | Rendering |
|---|---|
| Robot | Circle with heading arrow, ID label, thin battery arc around it |
| Robot colour | idle = grey · working = green · charging = cyan · blocked = amber · yielding = yellow · degraded = orange · offline = red |
| Intent trail | Dotted line through the next N claimed cells, robot's own colour, fading with distance. This is the visible proof of P2P intent sharing. |
| Comms range | Faint translucent circle around the selected robot; peers inside it get a thin link line drawn to them |
| Choke points | Subtle ring; pulses briefly when a yield event happens there |
| Blocked aisle | Hatched red overlay on the cells (blocked-aisle scenario) |
| Stations | Pickup = blue square, Drop = purple square, Charger = cyan bolt |
| Selection | Click a robot → highlights it, shows detail card (full telemetry JSON, readable) |

Toggles (view-only): show intent trails · show comms range · show grid · show aisle labels.

### 6.4 Baseline vs Ours panel
Two horizontal progress bars and two timers running the same scenario. Below them: tasks done, total stop time, deadlocks, and the improvement percentage in large type. In Round 1 both are scripted; the panel design is final. Add a small "n = 30 runs · mean ± std" line as a placeholder to show we know the methodology.

### 6.5 Robot table
Columns: ID · State (colour chip) · Battery (bar + %) · Speed (m/s) · Task (id + progress) · Link (● up / ● down) · Planner (ms) · Yields.
Sorted by state severity (offline / degraded / blocked first). Row click = select on map.

### 6.6 Network health + kill-link panel
One row per robot: link indicator, messages/sec, last-seen age, and a toggle switch. Toggling a link off:
- robot's `link_ok` → false, state → `degraded`
- intent trail on the map turns dashed and shortens (running on cached intent + ORCA)
- neighbours' link lines to it disappear
- fleet keeps moving, collisions stay 0
- event log: "AMR-03 link lost — running on cached intent + local safety filter"

Panel title: **"Fault injection (only control on this screen)"**.

### 6.7 Charging bays
Small strip like ForwardX: each bay shows occupied/free and which robot is docked with its charge %. Robots below 20% battery trigger a "seeking charger" state change and an event.

### 6.8 Event log
Scrolling, newest on top, colour by level. Filters: All · Conflicts · Tasks · Network. Every message uses aisle labels and robot IDs so it reads like an operations log. Example entries:
- `AMR-03 yielded to AMR-01 at choke B4 (priority inheritance)`
- `Aisle C2 blocked — AMR-05 re-planned via C3, +6 cells`
- `Task T-121 released by AMR-05 (cost +48%) → re-bid → AMR-02 won (bid 14.2)`
- `AMR-04 battery 18% → heading to charger CH-2`
- `AMR-03 link lost — running on cached intent + ORCA`
- `AMR-03 link restored — intent re-synced with 2 neighbours`

### 6.9 Optional panels (only if time permits)
- Throughput sparkline (tasks/min over last 5 min).
- Messages/sec per robot bar chart (proves we think about network load).
- Planner latency histogram with a "Pi 5 target: < 20 ms" line.

---

## 7. Tech stack

### 7.1 Backend — Python
- **FastAPI** with a single WebSocket endpoint `/ws/telemetry`.
- **Mock fleet generator** (`mock_fleet.py`): loads the `.map` file, spawns 6 robots, plays scripted scenarios, emits telemetry at 5 Hz. Robots move cell-to-cell along precomputed paths (BFS/A* on the grid) with simple priority yielding at conflicts so the head-on demo *visibly* resolves.
- **Scenario scripts** (`scenarios/*.py`): each scenario is a function that seeds tasks, injects obstacles/failures at fixed times, and emits the matching events.
- **Baseline runner**: same script executed with stop-and-wait rules; both runs stream to the benchmark panel.
- Later swap: `mock_fleet.py` → a ROS 2 subscriber node. The WebSocket layer and schema stay identical.

### 7.2 Frontend — React
- Vite + React + TypeScript.
- Map: HTML Canvas (not SVG — thousands of grid cells; Canvas stays smooth). One `<canvas>` for the static map layer, one for the dynamic robot layer.
- State: a single WebSocket hook feeding a store (Zustand or plain context). Every panel reads from the store.
- Styling: Tailwind, dark theme. Palette below.
- Charts: Recharts for the small sparklines only.

### 7.3 Visual identity
| Token | Value | Use |
|---|---|---|
| Background | `#0B1220` | Page |
| Panel | `#111A2E` | Cards |
| Grid line | `#1C2740` | Map grid |
| Shelf | `#2A3550` | Obstacles |
| Accent | `#22D3EE` | Headers, links |
| Working | `#22C55E` | Robot state |
| Yielding | `#FACC15` | Robot state |
| Blocked | `#F59E0B` | Robot state |
| Degraded | `#FB923C` | Robot state |
| Offline / Collision | `#EF4444` | Alerts |
| Text | `#E5E7EB` / `#94A3B8` | Primary / secondary |

Font: Inter or IBM Plex Sans; monospace (JetBrains Mono) for IDs, timers and the event log.

### 7.4 Repository layout
```
fleet-dashboard/
├── backend/
│   ├── main.py               # FastAPI app, /ws/telemetry
│   ├── mock_fleet.py         # robots, movement, yielding, battery model
│   ├── map_loader.py         # MovingAI .map parser, aisle labelling
│   ├── scenarios/
│   │   ├── normal.py
│   │   ├── head_on.py
│   │   ├── intersection.py
│   │   ├── blocked_aisle.py
│   │   ├── robot_failure.py
│   │   └── network_partition.py
│   ├── baseline.py           # stop-and-wait rules
│   ├── schema.py             # pydantic models = the telemetry contract
│   └── maps/warehouse-10-20-10-2-1.map
├── frontend/
│   ├── src/
│   │   ├── ws/useTelemetry.ts
│   │   ├── store.ts
│   │   ├── components/
│   │   │   ├── Header.tsx
│   │   │   ├── StatStrip.tsx
│   │   │   ├── MapCanvas.tsx
│   │   │   ├── BenchmarkPanel.tsx
│   │   │   ├── RobotTable.tsx
│   │   │   ├── NetworkPanel.tsx
│   │   │   ├── ChargingPanel.tsx
│   │   │   └── EventLog.tsx
│   │   └── App.tsx
│   └── index.html
└── README.md
```

---

## 8. Mock data design (make it convincing)

- **Robots:** AMR-01 … AMR-06. Start batteries spread 45–95% so the charging story happens naturally within a 5-minute demo. Drain 0.15%/s while moving, 0.03%/s idle, charge +1%/s docked.
- **Speeds:** 0.6–1.0 m/s, one grid cell = 1 m. Slow down to 0.3 m/s when a neighbour's intent overlaps.
- **Tasks:** continuous generator — pickup at a random P-station, drop at a random D-station. 8–12 tasks in the queue at all times.
- **Conflicts:** movement uses a priority rule (lower remaining-distance wins; ties by ID) with a one-step backtrack for the head-on case. Log every yield as an event so the log stays lively.
- **Scenario timing (each ≈ 90 s):** t+10 s conflict appears, t+15 s resolved, t+40 s second injection, t+70 s all clear. Judges never wait more than ~15 s for something to happen.
- **Benchmark numbers:** scripted but internally consistent — baseline stop time should visibly explain the gap (e.g. 71 s stop time vs 20 s → 22% faster overall). Never show a suspiciously round "20.0%".
- **Determinism:** every scenario takes a seed so the same demo replays identically in rehearsal and in front of judges.

---

## 9. Round 1 demo script (5 minutes)

| Time | Action | Line to say |
|---|---|---|
| 0:00 | Dashboard open, Normal ops, 6 robots moving, intent trails on | "Every robot here decides for itself. The dashboard only listens — note the badge." |
| 0:45 | Select Head-on corridor scenario | "Two robots, one-lane aisle. Watch B4." One yields, both continue. Event log explains why. |
| 1:30 | Point at Baseline vs Ours | "Same scenario under stop-and-wait: both freeze. That gap is where our 20% comes from." |
| 2:15 | Blocked aisle scenario | "Aisle C2 just got blocked. AMR-05 re-plans, cost jumps, task gets re-bid, AMR-02 wins." |
| 3:15 | Kill AMR-03's link | "Pick a robot. Kill its link." Robot goes orange, keeps moving, collisions stay 0. |
| 4:00 | Restore link, show robot table & charging | "Battery, task, latency — everything a floor manager needs, and nothing that lets them override the robots." |
| 4:30 | Close on architecture diagram | "Round 1 is mock telemetry on this exact schema. Round 2 swaps the mock for PIBT on ROS 2 + Zenoh. Nothing on this screen changes." |

---

## 10. Round 1 build checklist

- [ ] Download `warehouse-10-20-10-2-1.map`; parser + crop window + aisle labelling
- [ ] `schema.py` — pydantic models for all five message types
- [ ] `mock_fleet.py` — 6 robots, paths, yielding, battery, task generator
- [ ] Six scenario scripts with seeded, timed injections
- [ ] `baseline.py` stop-and-wait rules + benchmark message
- [ ] FastAPI WebSocket broadcasting at 5 Hz; `toggle_link` handling
- [ ] React scaffold, WebSocket hook, store
- [ ] MapCanvas: static layer, dynamic layer, intent trails, selection
- [ ] StatStrip, RobotTable, BenchmarkPanel, NetworkPanel, ChargingPanel, EventLog
- [ ] Header badge + scenario selector
- [ ] Rehearse the 5-minute script twice with the same seed
- [ ] Screenshots for the PPT: normal ops, head-on resolved, kill-link, benchmark panel

---

## 11. Things that will sink the Round 1 demo

1. Any button that looks like it commands a robot. Only fault injection is allowed.
2. A collision counter that isn't on screen — or worse, one that ticks.
3. Showing the benchmark without saying "same map, same tasks, same seed".
4. Robots that glide through shelves (make sure the mock respects the map).
5. Nothing happening for 30 seconds. Scenarios must be paced.
6. Claiming the mock is the real algorithm. Say "scripted telemetry, final schema" — honesty here is a strength.
