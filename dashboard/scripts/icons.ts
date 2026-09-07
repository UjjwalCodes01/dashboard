/* Generate PWA icons from the Chakraview logo (three peer nodes in a mesh, no centre node).
   Run: npx tsx scripts/icons.ts  → public/icons/{icon-192,icon-512,maskable-512,apple-touch-icon}.png */
import fs from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";

const out = path.resolve(__dirname, "../public/icons");
fs.mkdirSync(out, { recursive: true });

function draw(size: number, opts: { maskable?: boolean; opaque?: boolean }) {
  const c = createCanvas(size, size);
  const ctx = c.getContext("2d");

  // background: full-bleed for maskable / iOS, rounded square otherwise
  const radius = opts.maskable || opts.opaque ? 0 : size * 0.22;
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, "#111A2E");
  bg.addColorStop(1, "#0B1220");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.arcTo(size, 0, size, size, radius);
  ctx.arcTo(size, size, 0, size, radius);
  ctx.arcTo(0, size, 0, 0, radius);
  ctx.arcTo(0, 0, size, 0, radius);
  ctx.closePath();
  ctx.fill();

  // soft cyan glow behind the mesh
  const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.5);
  glow.addColorStop(0, "rgba(34,211,238,0.18)");
  glow.addColorStop(1, "rgba(34,211,238,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // the logo lives in a 40×40 box centred on (20,17); maskable icons keep a 20 % safe zone
  const scale = (size * (opts.maskable ? 0.5 : 0.64)) / 40;
  ctx.translate(size / 2 - 20 * scale, size / 2 - 17 * scale);
  ctx.scale(scale, scale);

  const stroke = ctx.createLinearGradient(0, 0, 40, 40);
  stroke.addColorStop(0, "#22D3EE");
  stroke.addColorStop(1, "#3B82F6");
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.4;
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(20, 6);
  ctx.lineTo(33, 28);
  ctx.lineTo(7, 28);
  ctx.closePath();
  ctx.stroke();
  ctx.globalAlpha = 1;

  const node = (x: number, y: number, r: number, fill: string) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  node(20, 6, 4.4, "#22D3EE");
  node(33, 28, 4.4, "#3B82F6");
  node(7, 28, 4.4, "#22C55E");
  // hollow centre: deliberately no central node
  ctx.beginPath();
  ctx.arc(20, 21, 2.2, 0, Math.PI * 2);
  ctx.fillStyle = "#0B1220";
  ctx.fill();
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = "rgba(34,211,238,0.7)";
  ctx.stroke();

  return c.toBuffer("image/png");
}

const files: [string, number, { maskable?: boolean; opaque?: boolean }][] = [
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, {}],
  ["maskable-512.png", 512, { maskable: true }],
  ["apple-touch-icon.png", 180, { opaque: true }],
];
for (const [name, size, o] of files) {
  const buf = draw(size, o);
  fs.writeFileSync(path.join(out, name), buf);
  console.log(`${name.padEnd(22)} ${size}×${size}  ${(buf.length / 1024).toFixed(1)} kB`);
}
