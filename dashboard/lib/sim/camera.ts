/**
 * Procedural "camera feeds" for Round 1 — a perspective warehouse corridor with
 * drawn detection boxes. Clearly labelled as a simulated feed; the final build
 * replaces this with MJPEG/WebRTC from the robot, still read-only.
 */
import { Rng } from "./rng";

export type CameraKind = "front" | "left" | "right" | "rgbd" | "reader";

export interface Detection {
  label: string;
  conf: number;
  x: number; // 0..1
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface CameraScene {
  kind: CameraKind;
  seed: number;
  t: number; // seconds
  heading: number;
  speed: number;
  neighbours: string[];
  lift: "up" | "down";
  offline?: boolean;
}

function hash(n: number) {
  return new Rng(n).next();
}

export function sceneDetections(s: CameraScene): Detection[] {
  if (s.kind !== "front" && s.kind !== "rgbd") return [];
  const out: Detection[] = [];
  const cyc = (s.t / 18 + hash(s.seed)) % 1;
  // a person walking across, sometimes
  if (cyc < 0.55) {
    const px = 0.08 + cyc * 0.5;
    out.push({
      label: "Person",
      conf: 0.55 + 0.12 * Math.sin(s.t * 1.3 + s.seed),
      x: px,
      y: 0.36,
      w: 0.07,
      h: 0.34,
      color: "#f59e0b",
    });
  }
  // AMRs for neighbours in range
  s.neighbours.slice(0, 2).forEach((n, i) => {
    const drift = Math.sin(s.t * 0.4 + i * 2 + s.seed) * 0.06;
    out.push({
      label: `AMR ${n.replace("AMR-", "")}`,
      conf: 0.42 + 0.1 * ((i + 1) % 2) + 0.05 * Math.cos(s.t + i),
      x: 0.48 + i * 0.16 + drift,
      y: 0.5 + i * 0.03,
      w: 0.09 - i * 0.02,
      h: 0.12 - i * 0.02,
      color: "#22d3ee",
    });
  });
  // static-ish pallet / fire hydrant box
  out.push({
    label: hash(s.seed + 7) > 0.5 ? "pallet" : "fire_hydrant_box",
    conf: 0.86 + 0.04 * Math.sin(s.t * 0.7),
    x: 0.8,
    y: 0.47,
    w: 0.15,
    h: 0.32,
    color: "#a3e635",
  });
  return out;
}

export function drawCameraFrame(ctx: CanvasRenderingContext2D, w: number, h: number, s: CameraScene) {
  ctx.clearRect(0, 0, w, h);
  if (s.offline) {
    ctx.fillStyle = "#0b0f19";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#475569";
    ctx.font = `600 ${Math.max(11, h * 0.08)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("No camera data", w / 2, h / 2);
    return;
  }
  const rgbd = s.kind === "rgbd";
  const marker = s.kind === "left" || s.kind === "right" || s.kind === "reader";
  const vx = w * (0.5 + 0.02 * Math.sin(s.t * 0.9)); // vanishing point sways with motion
  const vy = h * 0.46;
  const bob = Math.sin(s.t * 6) * s.speed * 1.2;

  // background gradient (ceiling → floor)
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  if (rgbd) {
    bg.addColorStop(0, "#1e1b4b");
    bg.addColorStop(1, "#7f1d1d");
  } else {
    bg.addColorStop(0, "#5b6470");
    bg.addColorStop(0.45, "#8b949e");
    bg.addColorStop(0.5, "#a3a9b1");
    bg.addColorStop(1, "#6b7280");
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  if (marker) {
    drawMarkerScene(ctx, w, h, s);
    return;
  }

  // floor
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(vx, vy + bob);
  ctx.lineTo(w, h);
  ctx.closePath();
  const fl = ctx.createLinearGradient(0, vy, 0, h);
  if (rgbd) {
    fl.addColorStop(0, "#312e81");
    fl.addColorStop(0.5, "#0e7490");
    fl.addColorStop(1, "#dc2626");
  } else {
    fl.addColorStop(0, "#9aa3ad");
    fl.addColorStop(1, "#5c6670");
  }
  ctx.fillStyle = fl;
  ctx.fill();

  // shelves left/right (receding)
  const shelfCount = 7;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < shelfCount; i++) {
      const z0 = i / shelfCount;
      const z1 = (i + 0.8) / shelfCount;
      const scale0 = 1 - z0 * 0.92;
      const scale1 = 1 - z1 * 0.92;
      const x0 = vx + side * w * 0.55 * scale0;
      const x1 = vx + side * w * 0.55 * scale1;
      const top0 = vy - h * 0.38 * scale0 + bob;
      const top1 = vy - h * 0.38 * scale1 + bob;
      const bot0 = vy + h * 0.5 * scale0 + bob;
      const bot1 = vy + h * 0.5 * scale1 + bob;
      ctx.beginPath();
      ctx.moveTo(x0, top0);
      ctx.lineTo(x1, top1);
      ctx.lineTo(x1, bot1);
      ctx.lineTo(x0, bot0);
      ctx.closePath();
      if (rgbd) {
        const d = z0;
        ctx.fillStyle = `hsl(${250 - d * 230}, 80%, ${45 + d * 10}%)`;
      } else {
        const shade = 70 + i * 12;
        ctx.fillStyle = `rgb(${shade * 0.9}, ${shade * 0.95}, ${shade})`;
      }
      ctx.fill();
      ctx.strokeStyle = rgbd ? "rgba(0,0,0,0.25)" : "rgba(30,41,59,0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (!rgbd) {
        // rack beams
        ctx.strokeStyle = "rgba(15,23,42,0.35)";
        for (let k = 1; k < 3; k++) {
          const f = k / 3;
          ctx.beginPath();
          ctx.moveTo(x0, top0 + (bot0 - top0) * f);
          ctx.lineTo(x1, top1 + (bot1 - top1) * f);
          ctx.stroke();
        }
        // green post accents (racking uprights)
        ctx.fillStyle = "rgba(34,197,94,0.55)";
        ctx.fillRect(x0 - 1.5, top0, 3, bot0 - top0);
      }
    }
  }

  // ceiling lights
  if (!rgbd) {
    for (let i = 0; i < 6; i++) {
      const z = (i + 0.5) / 6;
      const sc = 1 - z * 0.92;
      const y = vy - h * 0.42 * sc + bob;
      const lw = w * 0.16 * sc;
      ctx.fillStyle = `rgba(255,255,255,${0.75 - z * 0.4})`;
      ctx.fillRect(vx - lw / 2, y, lw, Math.max(2, 5 * sc));
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(vx - lw, y - 2, lw * 2, 8 * sc + 4);
    }
    // wall at the end
    const sc = 0.08;
    ctx.fillStyle = "#cbd5e1";
    ctx.fillRect(vx - w * 0.55 * sc, vy - h * 0.38 * sc + bob, w * 1.1 * sc, h * 0.88 * sc);
  }

  // fisheye vignette + barrel hint
  if (s.kind === "front") {
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }

  // detections
  const dets = sceneDetections(s);
  const fs = Math.max(9, Math.min(15, w * 0.03));
  for (const d of dets) {
    const x = d.x * w;
    const y = d.y * h;
    const bw = d.w * w;
    const bh = d.h * h;
    if (d.label === "Person" && !rgbd) {
      // simple silhouette
      ctx.fillStyle = "#1f2937";
      ctx.beginPath();
      ctx.ellipse(x + bw / 2, y + bh * 0.12, bw * 0.22, bh * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x + bw * 0.25, y + bh * 0.22, bw * 0.5, bh * 0.45);
      ctx.fillRect(x + bw * 0.28, y + bh * 0.65, bw * 0.18, bh * 0.35);
      ctx.fillRect(x + bw * 0.54, y + bh * 0.65, bw * 0.18, bh * 0.35);
    }
    if (d.label.startsWith("AMR") && !rgbd) {
      ctx.fillStyle = "#e5e7eb";
      ctx.fillRect(x + bw * 0.1, y + bh * 0.3, bw * 0.8, bh * 0.6);
      ctx.fillStyle = "#22c55e";
      ctx.fillRect(x + bw * 0.1, y + bh * 0.3, bw * 0.8, bh * 0.12);
    }
    if ((d.label === "pallet" || d.label === "fire_hydrant_box") && !rgbd) {
      ctx.fillStyle = d.label === "pallet" ? "#14532d" : "#b91c1c";
      ctx.fillRect(x + bw * 0.1, y + bh * 0.35, bw * 0.8, bh * 0.6);
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(x + bw * 0.1, y + bh * 0.35, bw * 0.8, bh * 0.08);
    }
    ctx.strokeStyle = d.color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, bw, bh);
    ctx.font = `700 ${fs}px ui-monospace, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    const txt = `${d.label}:${(d.conf * 100).toFixed(1)}%`;
    const tw = ctx.measureText(txt).width;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x, y - fs - 4, tw + 6, fs + 4);
    ctx.fillStyle = d.color;
    ctx.fillText(txt, x + 3, y - 2);
  }

  // scanlines / noise
  ctx.fillStyle = "rgba(0,0,0,0.06)";
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
}

function drawMarkerScene(ctx: CanvasRenderingContext2D, w: number, h: number, s: CameraScene) {
  // dark shelf base with a fiducial marker (mono camera look)
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#111827");
  g.addColorStop(0.55, "#1f2937");
  g.addColorStop(1, "#374151");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // floor line
  ctx.fillStyle = "#4b5563";
  ctx.fillRect(0, h * 0.62, w, h * 0.38);
  // tote bins
  const rng = new Rng(s.seed + (s.kind === "left" ? 1 : 2));
  for (let i = 0; i < 3; i++) {
    const bx = w * (0.05 + i * 0.32) + Math.sin(s.t * 0.3 + i) * 3;
    ctx.fillStyle = `hsl(${140 + rng.range(-10, 10)}, 40%, ${18 + i * 4}%)`;
    ctx.fillRect(bx, h * 0.3, w * 0.26, h * 0.34);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(bx, h * 0.3, w * 0.26, h * 0.04);
  }
  // marker
  const mx = w * (s.kind === "left" ? 0.58 : 0.34) + Math.sin(s.t * 0.5) * 2;
  const my = h * 0.38;
  const ms = Math.min(w, h) * 0.22;
  ctx.fillStyle = "#f9fafb";
  ctx.fillRect(mx, my, ms, ms);
  const cells = 6;
  const cs = ms / cells;
  const mr = new Rng(s.seed * 7 + 3);
  ctx.fillStyle = "#111";
  for (let yy = 0; yy < cells; yy++)
    for (let xx = 0; xx < cells; xx++) {
      const border = xx === 0 || yy === 0 || xx === cells - 1 || yy === cells - 1;
      if (border || mr.chance(0.45)) ctx.fillRect(mx + xx * cs, my + yy * cs, cs + 0.5, cs + 0.5);
    }
  ctx.strokeStyle = "#22d3ee";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(mx - 3, my - 3, ms + 6, ms + 6);
  ctx.font = `700 ${Math.max(9, w * 0.035)}px ui-monospace, monospace`;
  ctx.fillStyle = "#22d3ee";
  ctx.textBaseline = "bottom";
  ctx.fillText(`marker M-${(s.seed % 900) + 100} · read 1/1`, mx - 3, my - 6);
  // cross-hair
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w / 2 - 10, h / 2);
  ctx.lineTo(w / 2 + 10, h / 2);
  ctx.moveTo(w / 2, h / 2 - 10);
  ctx.lineTo(w / 2, h / 2 + 10);
  ctx.stroke();
  // mono noise
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
}
