/* Screenshot the running dev server so the map can be checked in a real browser.
   Run: npx tsx scripts/shoot.ts [baseUrl] */
import { chromium } from "playwright";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3111";
const outDir = path.resolve(__dirname);

const PAGES: { path: string; name: string; waitMs: number }[] = [
  { path: "/", name: "overview", waitMs: 6000 },
  { path: "/hub", name: "hub", waitMs: 4000 },
  { path: "/network", name: "network", waitMs: 3000 },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));

  for (const p of PAGES) {
    await page.goto(base + p.path, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(p.waitMs);
    // report the measured size of every map canvas on the page
    const info = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll("canvas").forEach((c, i) => {
        const r = c.getBoundingClientRect();
        const par = c.parentElement;
        const pr = par?.getBoundingClientRect();
        // is anything actually painted?
        let painted = false;
        try {
          const ctx = (c as HTMLCanvasElement).getContext("2d");
          if (ctx && c.width && c.height) {
            const d = ctx.getImageData(0, 0, Math.min(c.width, 600), Math.min(c.height, 400)).data;
            for (let k = 3; k < d.length; k += 4)
              if (d[k] !== 0) {
                painted = true;
                break;
              }
          }
        } catch {
          painted = false;
        }
        out.push(
          `canvas${i} css=${Math.round(r.width)}x${Math.round(r.height)} attr=${c.width}x${c.height} parent=${pr ? Math.round(pr.width) + "x" + Math.round(pr.height) : "?"} parentPos=${par ? getComputedStyle(par).position : "?"} painted=${painted}`,
        );
      });
      return out;
    });
    console.log(`\n${p.path}`);
    for (const l of info) console.log("  " + l);
    await page.screenshot({ path: path.join(outDir, `_shot_${p.name}.png`), fullPage: false });
  }
  if (errors.length) {
    console.log("\nconsole errors:");
    for (const e of Array.from(new Set(errors)).slice(0, 10)) console.log("  ! " + e);
  } else console.log("\nno console errors");
  await browser.close();
})();
