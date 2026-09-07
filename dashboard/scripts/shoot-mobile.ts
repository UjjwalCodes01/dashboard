/* Full-page phone screenshots of every page, for checking the mobile layout.
   Run: npx tsx scripts/shoot-mobile.ts [baseUrl]  → scripts/_shot_m_*.png */
import { chromium, devices } from "playwright";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
const outDir = path.resolve(__dirname);
const PAGES = ["/", "/hub", "/robots/AMR-01", "/robots/AMR-01/health", "/resources", "/tasks", "/network"];

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  for (const p of PAGES) {
    await page.goto(base + p, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(p === "/" ? 5000 : 2500);
    const overflow = await page.evaluate(() => ({
      docW: document.documentElement.scrollWidth,
      docH: document.documentElement.scrollHeight,
      winW: window.innerWidth,
      wide: Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && el.offsetWidth > 0)
        .slice(0, 6)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")} right=${Math.round(el.getBoundingClientRect().right)}`),
    }));
    const name = p === "/" ? "overview" : p.replace(/^\//, "").replace(/\//g, "_");
    await page.screenshot({ path: path.join(outDir, `_shot_m_${name}.png`), fullPage: overflow.docH < 14000, clip: overflow.docH < 14000 ? undefined : { x: 0, y: 0, width: overflow.winW, height: 3000 } }).catch((e) => console.log(`    screenshot failed: ${String(e).slice(0, 80)}`));
    console.log(`${p.padEnd(24)} scrollHeight=${overflow.docH} scrollWidth=${overflow.docW} innerWidth=${overflow.winW}${overflow.docW > overflow.winW ? "  ← HORIZONTAL OVERFLOW" : ""}`);
    for (const w of overflow.wide) console.log(`    overflowing: ${w}`);
  }
  if (errors.length) console.log("errors:\n  " + Array.from(new Set(errors)).join("\n  "));
  await browser.close();
})();
