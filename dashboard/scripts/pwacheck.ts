/* PWA verification against a *production* server (the worker does not register in dev).
   Run: npm run build && npx next start -p 3111 &  then  npx tsx scripts/pwacheck.ts http://localhost:3111 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3111";
let failures = 0;
const ok = (cond: boolean, msg: string, extra = "") => {
  console.log(`${cond ? "OK " : "BAD"} ${msg}${extra ? `  ${extra}` : ""}`);
  if (!cond) failures++;
};

(async () => {
  // --- static checks over HTTP -------------------------------------------------------------
  const mf = await fetch(`${base}/manifest.webmanifest`);
  ok(mf.ok, "manifest served", `${mf.status} ${mf.headers.get("content-type")}`);
  const manifest = (await mf.json()) as { name: string; display: string; start_url: string; icons: { src: string; sizes: string; purpose?: string }[] };
  ok(manifest.display === "standalone" && manifest.start_url === "/", "manifest display/start_url", `${manifest.display} ${manifest.start_url}`);
  const has192 = manifest.icons.some((i) => i.sizes === "192x192");
  const has512 = manifest.icons.some((i) => i.sizes === "512x512" && !i.purpose);
  const hasMask = manifest.icons.some((i) => i.purpose === "maskable");
  ok(has192 && has512 && hasMask, "manifest icons 192 + 512 + maskable");
  for (const i of manifest.icons) {
    const r = await fetch(`${base}${i.src}`);
    ok(r.ok && (r.headers.get("content-type") ?? "").includes("image/png"), `icon ${i.src}`, `${r.status} ${r.headers.get("content-type")}`);
  }
  const sw = await fetch(`${base}/sw.js`);
  ok(sw.ok, "sw.js served", `${sw.status}`);
  ok((sw.headers.get("cache-control") ?? "").includes("no-cache"), "sw.js not cacheable", sw.headers.get("cache-control") ?? "");
  ok((sw.headers.get("content-type") ?? "").includes("javascript"), "sw.js content-type", sw.headers.get("content-type") ?? "");

  const html = await (await fetch(`${base}/`)).text();
  ok(/rel="manifest"/.test(html), "<link rel=manifest> injected");
  ok(/name="theme-color"/.test(html), "<meta theme-color> present");
  ok(/name="mobile-web-app-capable"/.test(html) && /apple-mobile-web-app-title/.test(html), "web-app-capable + apple title metas present");
  ok(/apple-touch-icon/.test(html), "apple-touch-icon present");

  // --- behaviour in a real browser --------------------------------------------------------
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  let offline = false; // while offline, failed network requests are expected, not errors
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (offline && /ERR_INTERNET_DISCONNECTED|Failed to fetch|Load failed/.test(text)) return;
    errors.push(`console: ${text.slice(0, 160)}`);
  });

  /** wait until the first canvas has painted (or the page has real text if it has no map) */
  const waitPainted = async (ms: number) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const painted = await page
        .evaluate(() => {
          const c = document.querySelector("canvas") as HTMLCanvasElement | null;
          if (!c) return document.body.innerText.length > 200;
          const ctx = c.getContext("2d");
          if (!ctx || !c.width) return false;
          const d = ctx.getImageData(0, 0, Math.min(c.width, 400), Math.min(c.height, 300)).data;
          for (let k = 3; k < d.length; k += 4) if (d[k]) return true;
          return false;
        })
        .catch(() => false);
      if (painted) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };

  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return { scope: r.scope, script: r.active?.scriptURL ?? "" };
  });
  ok(reg.script.includes("/sw.js?v="), "service worker registered with build id", reg.script.replace(base, ""));

  // precache runs during install; give it a moment, then inspect the cache
  await page.waitForTimeout(4000);
  const cacheInfo = await page.evaluate(async () => {
    const keys = await caches.keys();
    const name = keys.find((k) => k.startsWith("chakraview-"));
    if (!name) return { name: null, urls: [] as string[] };
    const c = await caches.open(name);
    const reqs = await c.keys();
    return { name, urls: reqs.map((r) => new URL(r.url).pathname) };
  });
  ok(!!cacheInfo.name, "cache created", cacheInfo.name ?? "");
  const want = ["/", "/hub", "/network", "/tasks", "/offline", "/maps/map_config.json", "/maps/warehouse-10-20-10-2-1.map"];
  for (const w of want) ok(cacheInfo.urls.includes(w), `precached ${w}`);
  const chunks = cacheInfo.urls.filter((u) => u.startsWith("/_next/static/")).length;
  ok(chunks > 10, "precached _next/static assets referenced by the routes", `${chunks} files`);

  // reload so the page is controlled by the worker
  await page.reload({ waitUntil: "networkidle" });
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  ok(controlled, "page controlled by the worker after reload");

  // --- offline -----------------------------------------------------------------------------
  await context.setOffline(true);
  offline = true;
  for (const path of ["/hub", "/tasks", "/network"]) {
    const t0 = Date.now();
    const resp = await page.goto(`${base}${path}`, { waitUntil: "load", timeout: 20000 }).catch(() => null);
    const painted = await waitPainted(10000);
    ok(!!resp && painted, `offline navigation ${path} renders`, `${Date.now() - t0} ms to first paint`);
  }
  const badge = await page.evaluate(() => document.body.innerText.toLowerCase().includes("offline"));
  ok(badge, "offline badge shown in top bar");

  // a robot page warmed after activation
  await page.goto(`${base}/robots/AMR-03`, { waitUntil: "load", timeout: 20000 }).catch(() => null);
  const robotOk = await page.evaluate(() => document.body.innerText.includes("AMR-03"));
  ok(robotOk, "offline robot page (warmed) renders");

  // a page that was never cached falls back to /offline
  await page.goto(`${base}/robots/AMR-99/health?x=1`, { waitUntil: "load", timeout: 20000 }).catch(() => null);
  const fallback = await page.evaluate(() => document.body.innerText.includes("You're offline") || document.body.innerText.includes("You’re offline"));
  ok(fallback, "uncached route falls back to /offline page");

  await context.setOffline(false);
  offline = false;
  ok(errors.length === 0, "no page errors", errors.join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nall PWA checks passed");
  process.exit(failures ? 1 : 0);
})();
