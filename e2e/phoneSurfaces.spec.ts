// Plan B10 (preview lane) — the phone views in a REAL browser at 360×740.
// Illustrative fixtures; the preview must make no Supabase request beyond the
// Ops layout's own session checks, write nothing, scroll no wider than the
// viewport, and log no console error.
import type { Request } from "@playwright/test";
import { test, expect } from "../playwright-fixture";
import { installMockBackend, seedAuthSession, E2E_FAKE_SUPABASE_URL } from "./support/mockBackend";

const isSupabase = (r: Request) => /supabase\.co/.test(new URL(r.url()).host);
// Reads by the Ops layout (session, role, badge counts) are allowed; writes are not.
const isWrite = (r: Request) => !["GET", "HEAD", "OPTIONS"].includes(r.method()) && !/\/auth\/v1\//.test(r.url());

test.describe("engineering preview — phone views at 360×740", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("sign-off, call-offs, measurement and share work offline-first with nothing sent", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => consoleErrors.push(e.message));
    const popups: string[] = [];
    page.on("popup", (p) => popups.push(p.url()));
    await installMockBackend(page);
    await seedAuthSession(page, E2E_FAKE_SUPABASE_URL);
    await page.goto("/ops/engineering-preview");
    await page.getByRole("tab", { name: "Phone views" }).click({ timeout: 20_000 });
    const supabaseRequests: Request[] = [];
    page.on("request", (r) => { if (isSupabase(r)) supabaseRequests.push(r); });

    const frame = page.getByTestId("phone-frame");
    await expect(frame).toBeVisible();
    expect((await frame.boundingBox())!.width).toBeLessThanOrEqual(360);

    // (a) sign-off → queued, pending sync shown
    await expect(page.getByTestId("signoff-range")).toHaveText("₹38.2 L – ₹44.2 L");
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("sync-state")).toContainText("Pending sync — preview, nothing is sent");

    // (b) call-offs
    await frame.getByRole("button", { name: "Call-offs" }).click();
    await page.getByRole("button", { name: "Queue call-off" }).first().click();
    await expect(page.getByTestId("sync-state")).toContainText("2 action(s) queued");

    // (c) measurement
    await frame.getByRole("button", { name: "Measure" }).click();
    for (const [label, value] of [["Row 1 No", "2"], ["Row 1 L (m)", "1.5"], ["Row 1 B (m)", "1.2"], ["Row 1 D (m)", "0.1"]]) {
      const input = page.getByRole("textbox", { name: label });
      await input.fill(value);
      await input.press("Enter");
    }
    await expect(page.getByTestId("measure-total")).toHaveText("0.36 m³");

    // (d) share link is built, not opened
    await frame.getByRole("button", { name: "Share" }).click();
    await expect(page.getByTestId("share-url")).toContainText("https://wa.me/?text=Call-off%20CO-W2");

    // Reload: the queue survives (localStorage), still nothing sent.
    await page.reload();
    await page.getByRole("tab", { name: "Phone views" }).click({ timeout: 20_000 });
    await expect(page.getByTestId("sync-state")).toContainText("2 action(s) queued");

    // Hindi stub with English fallback.
    await page.getByRole("button", { name: "हिं" }).click();
    await expect(frame.getByRole("button", { name: "स्वीकृत करें" })).toBeVisible();
    await expect(frame.getByText("Estimated range")).toBeVisible();

    const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(docWidth).toBeLessThanOrEqual(360);
    expect(popups).toEqual([]);
    expect(supabaseRequests.filter(isWrite).map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
