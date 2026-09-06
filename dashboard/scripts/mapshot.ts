/* Render the fleet map to a PNG so the floor-plan styling can be checked without a browser.
   Run: npx tsx scripts/mapshot.ts [outfile] */
import fs from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { analyseMap, buildMapMsg, type MapConfig } from "../lib/sim/map";
import { FleetEngine } from "../lib/sim/engine";
import { drawDynamic, drawStatic, type RobotVisual, type Viewport } from "../components/map/render";
import type { Cell, RobotStateMsg } from "../lib/types";

const root = path.resolve(__dirname, "..");
const out = process.argv[2] ?? path.join(root, "scripts/_mapshot.png");
const text = fs.readFileSync(path.join(root, "public/maps/warehouse-10-20-10-2-1.map"), "utf8");
const cfg = JSON.parse(fs.readFileSync(path.join(root, "public/maps/map_config.json"), "utf8")) as MapConfig;
const map = analyseMap(buildMapMsg(text, cfg));

// run the engine a while so robots are mid-task with real intent trails
const eng = new FleetEngine({ map, seed: 42, scenario: "normal", onMessage: () => {}, warmupSeconds: 0 });
for (let i = 0; i < 5 * 240; i++) eng.step(0.2);
const states: RobotStateMsg[] = eng.snapshot();

const W = 1180;
const H = 720;
// the app stacks two canvases; do the same here and composite at the end
const canvas = createCanvas(W, H);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = canvas.getContext("2d") as any as CanvasRenderingContext2D;
const dynCanvas = createCanvas(W, H);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dctx = dynCanvas.getContext("2d") as any as CanvasRenderingContext2D;

const pad = 18;
const leftPad = pad + 14;
const availW = W - leftPad - pad;
const availH = H - pad * 2;
const cs = Math.min(availW / map.width, availH / map.height);
const vp: Viewport = {
  cs,
  ox: leftPad + (availW - map.width * cs) / 2,
  oy: pad + (availH - map.height * cs) / 2,
  width: W,
  height: H,
};

ctx.fillStyle = "#0b1220";
ctx.fillRect(0, 0, W, H);

drawStatic(ctx, map, vp, {
  grid: false,
  labels: true,
  lanes: true,
  chokes: true,
  compact: false,
  monoFont: "monospace",
  sansFont: "sans-serif",
});

const visuals: RobotVisual[] = states.map((r) => ({
  id: r.robot_id,
  x: r.pose.x,
  y: r.pose.y,
  heading: r.pose.heading,
  state: r.state,
  battery: r.battery_pct,
  msg: r,
}));
const blocked: Cell[] = [];
for (const i of eng.blocked) blocked.push([i % map.width, Math.floor(i / map.width)]);

drawDynamic(dctx, map, vp, visuals, {
  trails: true,
  comms: false,
  links: true,
  compact: false,
  selectedId: states[0]?.robot_id ?? null,
  hoverId: null,
  blocked,
  pulses: [],
  nowMs: 0,
  monoFont: "monospace",
  sansFont: "sans-serif",
  commsRange: 12,
  destinations: new Map(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
ctx.drawImage(dynCanvas as any, 0, 0);
fs.writeFileSync(out, canvas.toBuffer("image/png"));
console.log(
  `wrote ${out}  cs=${cs.toFixed(2)}px  shelves=${map.shelves.length} (${map.shelves
    .slice(0, 4)
    .map((s) => s.label)
    .join(",")}…)  outlineSegs=${map.outline.length}  robots=${states.map((r) => `${r.robot_id}:${r.state}`).join(" ")}`,
);
