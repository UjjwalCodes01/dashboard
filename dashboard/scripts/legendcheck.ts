/* Verify the Legend card's collapse toggle actually works. Run against a dev/prod server:
   npx tsx scripts/legendcheck.ts http://localhost:3111 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3111";
let failures = 0;
const ok = (cond: boolean, msg: string, extra = "") => {
  console.log(`${cond ? "OK " : "BAD"} ${msg}${extra ? `  ${extra}` : ""}`);
  if (!cond) failures++;
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

  await page.goto(`${base}/hub`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);

  const btn = page.getByRole("button", { name: "Legend" }).first();
  ok(await btn.isVisible(), "legend header is a button (has an accessible role)");
  ok((await btn.getAttribute("aria-expanded")) === "true", "starts expanded", `aria-expanded=${await btn.getAttribute("aria-expanded")}`);

  const bodyId = await btn.getAttribute("aria-controls");
  ok(!!bodyId, "aria-controls points at the body", bodyId ?? "");
  const body = page.locator(`[id="${bodyId}"]`);
  ok(await body.isVisible(), "body visible while expanded");
  const openH = (await btn.locator("xpath=..").boundingBox())!.height;

  await btn.click();
  await page.waitForTimeout(250);
  ok((await btn.getAttribute("aria-expanded")) === "false", "collapses on click");
  ok(!(await body.isVisible()), "body hidden after collapse");
  const shutH = (await btn.locator("xpath=..").boundingBox())!.height;
  ok(shutH < openH - 40, "card actually shrinks", `${Math.round(openH)}px → ${Math.round(shutH)}px`);

  await btn.click();
  await page.waitForTimeout(250);
  ok((await btn.getAttribute("aria-expanded")) === "true", "expands again on second click");
  ok(await body.isVisible(), "body visible again");

  // keyboard: a real button must respond to Enter
  await btn.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  ok((await btn.getAttribute("aria-expanded")) === "false", "keyboard Enter toggles it");
  await btn.click();

  // the robot page's own legend instance collapses independently
  await page.goto(`${base}/robots/AMR-01`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
  const rBtn = page.getByRole("button", { name: "Legend" }).first();
  if (await rBtn.isVisible()) {
    await rBtn.click();
    await page.waitForTimeout(250);
    ok((await rBtn.getAttribute("aria-expanded")) === "false", "robot-page legend collapses too");
  } else ok(true, "robot-page legend not shown at this width (skipped)");

  ok(errors.length === 0, "no page errors", errors.join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nlegend toggle works");
  process.exit(failures ? 1 : 0);
})();
