/* Render docs/user-flow.html (an artifact fragment) to PNGs for slides. Run: npx tsx scripts/render-flow.ts */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(__dirname, "..");
const frag = fs.readFileSync(path.join(root, "docs/user-flow.html"), "utf8");
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0">${frag}</body></html>`;
(async () => {
  const browser = await chromium.launch();
  for (const scheme of ["light", "dark"] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready);
    const fig = page.locator("figure .frame").first();
    const out = path.join(root, `docs/chakraview-user-flow${scheme === "dark" ? "-dark" : ""}.png`);
    await fig.screenshot({ path: out });
    const box = await fig.boundingBox();
    console.log(`${path.relative(root, out)}  ${Math.round(box!.width)}x${Math.round(box!.height)} css px @2x`);
    await ctx.close();
  }
  await browser.close();
})();
