// Plan v1.2, I4 — the owner-only engineering preview in a REAL browser, at a
// desktop and a phone viewport. The Ops layout around it needs a signed-in
// staff session, served by the suite's mock backend; the preview itself must
// then work without a single request to Supabase, and nothing may write at
// any point. Fails on console errors.
import type { Page, Request } from "@playwright/test";
import { test, expect } from "../playwright-fixture";
import { installMockBackend, seedAuthSession, E2E_FAKE_SUPABASE_URL } from "./support/mockBackend";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const isSupabase = (r: Request) => /supabase\.co/.test(new URL(r.url()).host);
const isWrite = (r: Request) => !["GET", "HEAD", "OPTIONS"].includes(r.method()) && !/\/auth\/v1\//.test(r.url());

async function openPreview(page: Page) {
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  const supabaseRequests: Request[] = [];
  page.on("request", (r) => { if (isSupabase(r)) supabaseRequests.push(r); });
  await installMockBackend(page);
  await seedAuthSession(page, E2E_FAKE_SUPABASE_URL);
  await page.goto("/ops/engineering-preview");
  await expect(page.getByRole("tab").first()).toBeVisible({ timeout: 20_000 });
  // Let the Ops layout's own start-up requests (session, roles, its
  // pending-review count) settle, so the "before" snapshot callers take
  // includes them and only the preview's own requests are compared after.
  await page.waitForLoadState("networkidle");
  return { consoleErrors, supabaseRequests };
}

for (const vp of VIEWPORTS) {
  test.describe(`engineering preview — ${vp.name} ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("every tab opens with no Supabase request, no write and no console error", async ({ page }) => {
      const { consoleErrors, supabaseRequests } = await openPreview(page);
      const before = supabaseRequests.length; // the Ops layout's own session and role checks
      const tabs = page.getByRole("tab");
      const count = await tabs.count();
      expect(count).toBeGreaterThanOrEqual(5);
      for (let i = 0; i < count; i++) {
        await tabs.nth(i).click();
        await expect(tabs.nth(i)).toHaveAttribute("aria-selected", "true");
        // Press the enabled, non-tab controls of this tab once each.
        const buttons = page.locator("main button:not([role=tab]):not([disabled])");
        const n = Math.min(await buttons.count(), 30);
        for (let j = 0; j < n; j++) {
          const b = buttons.nth(j);
          if (await b.isVisible() && await b.isEnabled()) await b.click();
        }
      }
      await page.waitForLoadState("networkidle");
      expect(supabaseRequests.slice(before).map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
      expect(supabaseRequests.filter(isWrite).map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });

    test("integrated flow: a measurement edit and a queue check update the other surfaces, with no request", async ({ page }) => {
      const { consoleErrors, supabaseRequests } = await openPreview(page);
      const before = supabaseRequests.length;
      await page.getByRole("tab", { name: "Integrated flow" }).click();
      const fl1 = page.getByTestId("flow-line-FL-1");
      await page.getByTestId("flow-queue-FL-1").getByRole("button", { name: /^Accept/ }).click();
      await expect(fl1).toContainText("Accepted · demo");
      const depth = page.getByLabel("Footing trenches, grid B: D (m)");
      await depth.fill("1.35");
      await depth.press("Enter");
      await expect(fl1).toContainText("29.16");
      await expect(fl1).toContainText("Reset: inputs changed");
      // The pending line never shows an amount.
      await expect(page.getByTestId("flow-line-FL-6")).toContainText("Not priced — quantity pending");
      await expect(page.getByRole("button", { name: "Certification unavailable" })).toBeDisabled();
      if (vp.name === "mobile") {
        const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
        expect(scroll).toBeLessThanOrEqual(inner);
      }
      expect(supabaseRequests.slice(before).map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
      expect(consoleErrors).toEqual([]);
    });
  });
}
