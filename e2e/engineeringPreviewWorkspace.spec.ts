// Plan v1.2 I2/I3 — the engineering-preview workspace in a REAL browser.
// SYNTHETIC data only (mock backend, synthetic drawing); this checks
// behaviour and layout, never accuracy. The dev server runs in DEV, so the
// preview flag is on; the route is reached through the real ops role gate.
import { test, expect } from "../playwright-fixture";
import { installMockBackend, seedAuthSession, E2E_FAKE_SUPABASE_URL } from "./support/mockBackend";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

for (const vp of VIEWPORTS) {
  test.describe(`engineering preview workspace — ${vp.name} ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await seedAuthSession(page, E2E_FAKE_SUPABASE_URL);
      await installMockBackend(page);
      await page.goto("/ops/engineering-preview");
      await expect(page.getByTestId("workspace-shell")).toBeVisible({ timeout: 20_000 });
    });

    test("no horizontal page overflow; the grid scrolls inside its own region", async ({ page }) => {
      const { scroll, inner } = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollWidth, inner: window.innerWidth }));
      expect(scroll).toBeLessThanOrEqual(inner);
    });

    test("the grid is operable from the keyboard, with a visible focus ring", async ({ page }) => {
      const grid = page.getByRole("grid", { name: "Demo BOQ grid" });
      const first = grid.locator('[data-cell="0:0"]');
      await first.click();
      await page.keyboard.press("ArrowRight");
      const qty = grid.locator('[data-cell="0:1"]');
      await expect(qty).toBeFocused();
      const outline = await qty.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
      });
      expect(outline.style).toBe("solid");
      expect(outline.width).toBeGreaterThanOrEqual(2);

      await page.keyboard.press("F2");
      const input = page.getByRole("textbox", { name: "Quantity for L-01 (m³)" });
      await expect(input).toBeFocused();
      await input.fill("30");
      await page.keyboard.press("Enter");
      await expect(grid.locator('[data-cell="1:1"]')).toBeFocused();
      await expect(qty).toContainText("30.00");
      await expect(qty).toContainText("edited · demo");

      await page.keyboard.press("Tab");
      await expect(grid.locator('[data-cell="1:2"]')).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(grid.locator('[data-cell="1:1"]')).toBeFocused();
    });

    test("drawing regions and grid lines are linked both ways; regions meet the 24px target", async ({ page }) => {
      const grid = page.getByRole("grid", { name: "Demo BOQ grid" });
      await grid.locator('[data-cell="4:0"]').click(); // L-05
      await expect(page.locator('[data-region="R-WALL"]')).toHaveAttribute("data-highlighted", "true");

      const footing = page.locator('[data-region="R-FOOTING"]');
      await footing.focus();
      await page.keyboard.press("Enter");
      await expect(grid.locator('[data-line="L-02"]')).toHaveAttribute("aria-selected", "true");
      await expect(grid.locator('[data-line="L-04"]')).toHaveAttribute("aria-selected", "true");

      for (const id of ["R-TRENCH", "R-FOOTING", "R-WALL", "R-BARS"]) {
        const box = (await page.locator(`[data-region="${id}"] rect`).boundingBox())!;
        expect.soft(Math.min(box.width, box.height), id).toBeGreaterThanOrEqual(24);
      }
      const bg = await page.locator(".ds-drawing").evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe("rgb(255, 255, 255)");
    });
  });
}
