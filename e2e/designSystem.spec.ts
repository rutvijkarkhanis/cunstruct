// D1 — the design-system reference page (/design-system) verified in a REAL
// browser, at a desktop (1440×900) and a phone (390×844) viewport, with the
// OS colour scheme emulated as both light and dark. jsdom has no layout or
// cascade, so these are the checks src/pages/DesignSystem.test.tsx cannot
// make: rendered target sizes, computed contrast, the drawing's resolved
// background inside the dark theme, focus rings, keyboard operation of the
// non-drag controls, horizontal overflow and console errors.
//
// The page needs no backend. Every Supabase request is aborted and counted;
// the suite fails if the page makes one.
import type { Page } from "@playwright/test";
import { test, expect } from "../playwright-fixture";

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;
const SCHEMES = ["light", "dark"] as const;
const STATE_COUNT = 7;

type Rgb = [number, number, number];

/** Opens the page with Supabase blocked; returns the console errors and blocked requests seen so far. */
async function openDesignSystem(page: Page) {
  const consoleErrors: string[] = [];
  const supabaseRequests: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  await page.route(/supabase\.co/, (route) => {
    supabaseRequests.push(`${route.request().method()} ${route.request().url()}`);
    return route.abort();
  });
  await page.goto("/design-system");
  await expect(page.getByRole("heading", { level: 1, name: "Cunstruct design system" })).toBeVisible();
  return { consoleErrors, supabaseRequests };
}

/** In-page WCAG 2.x relative luminance / contrast helpers, installed once per page. */
async function installContrastHelpers(page: Page) {
  await page.evaluate(() => {
    const parse = (s: string): Rgb => s.match(/[\d.]+/g)!.slice(0, 3).map(Number) as Rgb;
    const lum = ([r, g, b]: Rgb) => {
      const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a: string, b: string) => {
      const x = lum(parse(a));
      const y = lum(parse(b));
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    // The first opaque background at or above el.
    const backdrop = (el: Element | null) => {
      for (let p = el; p; p = p.parentElement) {
        const c = getComputedStyle(p).backgroundColor;
        if (c && c !== "transparent" && !/rgba\(.*,\s*0\)$/.test(c)) return c;
      }
      return "rgb(255, 255, 255)";
    };
    Object.assign(window, { __ds: { parse, lum, ratio, backdrop } });
  });
}

type DsHelpers = {
  parse: (s: string) => Rgb;
  lum: (c: Rgb) => number;
  ratio: (a: string, b: string) => number;
  backdrop: (el: Element | null) => string;
};
declare global {
  interface Window {
    __ds: DsHelpers;
  }
}

for (const vp of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    test.describe(`design system — ${vp.name} ${vp.width}×${vp.height}, OS scheme ${scheme}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme });

      test("loads with no console errors and no backend requests", async ({ page }) => {
        const { consoleErrors, supabaseRequests } = await openDesignSystem(page);
        // Exercise the interactive parts too, so errors they raise are caught.
        await page.getByLabel("Wall length (m)").press("ArrowUp");
        await page.getByRole("button", { name: "Move Ground floor down" }).click();
        await page.locator("summary", { hasText: "State CSS variables" }).first().click();
        expect(consoleErrors).toEqual([]);
        expect(supabaseRequests).toEqual([]);
      });

      test("renders a light and a dark theme panel, and the drawing stays light inside both", async ({ page }) => {
        await openDesignSystem(page);
        await installContrastHelpers(page);
        const panels = await page.$$eval("main [data-ds-theme]", (els) =>
          els.map((el) => ({
            theme: el.getAttribute("data-ds-theme"),
            bgLum: window.__ds.lum(window.__ds.parse(getComputedStyle(el).backgroundColor)),
          })),
        );
        expect(panels.map((p) => p.theme)).toEqual(["light", "dark"]);
        expect(panels[0].bgLum).toBeGreaterThan(0.85);
        expect(panels[1].bgLum).toBeLessThan(0.05);

        const drawings = await page.$$eval(".ds-drawing", (els) =>
          els.map((el) => {
            const cs = getComputedStyle(el);
            return {
              theme: el.closest("[data-ds-theme]")!.getAttribute("data-ds-theme"),
              bg: cs.backgroundColor,
              fgLum: window.__ds.lum(window.__ds.parse(cs.color)),
              colorScheme: cs.colorScheme,
            };
          }),
        );
        expect(drawings.map((d) => d.theme)).toEqual(["light", "dark"]);
        for (const d of drawings) {
          expect(d.bg).toBe("rgb(255, 255, 255)");
          expect(d.fgLum).toBeLessThan(0.05);
          expect(d.colorScheme).toBe("light");
        }
      });

      test("every status shows an icon and a text label, and meets contrast, in both themes", async ({ page }) => {
        await openDesignSystem(page);
        await installContrastHelpers(page);
        const badges = await page.$$eval(".ds-status", (els) =>
          els.map((el) => {
            const cs = getComputedStyle(el);
            const svg = el.querySelector("svg");
            const surface = window.__ds.backdrop(el.parentElement);
            return {
              theme: el.closest("[data-ds-theme]")!.getAttribute("data-ds-theme"),
              state: el.getAttribute("data-state"),
              label: el.querySelector("span")?.textContent?.trim() ?? "",
              icon: svg ? svg.getAttribute("class") ?? "" : null,
              iconVisible: svg ? svg.getBoundingClientRect().width >= 12 : false,
              text: window.__ds.ratio(cs.color, cs.backgroundColor),
              iconOnBadge: svg ? window.__ds.ratio(getComputedStyle(svg).color, cs.backgroundColor) : 0,
              borderOnSurface: window.__ds.ratio(cs.borderTopColor, surface),
            };
          }),
        );
        for (const theme of ["light", "dark"]) {
          const mine = badges.filter((b) => b.theme === theme);
          // Each of the seven states appears in the state list and the grid sample.
          expect(new Set(mine.map((b) => b.state)).size).toBe(STATE_COUNT);
          // Distinct icon and distinct label per state, so neither depends on colour.
          const byState = new Map(mine.map((b) => [b.state, b]));
          expect(new Set([...byState.values()].map((b) => b.icon)).size).toBe(STATE_COUNT);
          expect(new Set([...byState.values()].map((b) => b.label)).size).toBe(STATE_COUNT);
        }
        for (const b of badges) {
          expect.soft(b.icon, `${b.theme} ${b.state} icon`).not.toBeNull();
          expect.soft(b.iconVisible, `${b.theme} ${b.state} icon size`).toBe(true);
          expect.soft(b.label, `${b.theme} ${b.state} label`).not.toBe("");
          expect.soft(b.text, `${b.theme} ${b.state} label text`).toBeGreaterThanOrEqual(4.5);
          expect.soft(b.iconOnBadge, `${b.theme} ${b.state} icon`).toBeGreaterThanOrEqual(3);
          expect.soft(b.borderOnSurface, `${b.theme} ${b.state} border`).toBeGreaterThanOrEqual(3);
        }

        // State-tinted numbers in the grid (e.g. a struck-through excluded amount) are text: 4.5:1.
        const cells = await page.$$eval(".ds-cell", (els) =>
          els
            .filter((el) => el.closest("[data-ds-theme]") && (el.textContent ?? "").trim())
            .map((el) => ({
              where: `${el.closest("[data-ds-theme]")!.getAttribute("data-ds-theme")} ${el.getAttribute("data-state")}`,
              ratio: window.__ds.ratio(getComputedStyle(el).color, window.__ds.backdrop(el)),
            })),
        );
        expect(cells.length).toBeGreaterThan(0);
        for (const c of cells) expect.soft(c.ratio, c.where).toBeGreaterThanOrEqual(4.5);

        // The page's own run of the automated contrast check reports no failures.
        await expect(page.getByRole("heading", { name: /^Automated contrast checks \(\d+ pairs, 0 failing\)$/ })).toBeVisible();
        await expect(page.getByRole("region", { name: "Contrast check results" }).getByText("FAIL", { exact: true })).toHaveCount(0);
      });

      test("money uses en-IN grouping and tabular figures; missing is a dash, never 0; no negative zero", async ({ page }) => {
        await openDesignSystem(page);
        const table = page.getByRole("region", { name: "Money format examples" });
        const row = (input: string) =>
          table.locator("tbody tr").filter({ has: page.locator("td:first-child code", { hasText: new RegExp(`^${input}$`) }) });
        const cellsOf = async (input: string) => (await row(input).locator("td").allTextContents()).slice(1);
        expect(await cellsOf("48200000")).toEqual(["₹4,82,00,000", "₹4.82 Cr", "48,200.00"]);
        expect(await cellsOf("1234567")).toEqual(["₹12,34,567", "₹12.3 L", "1,234.57"]);
        expect(await cellsOf("-1234567")).toEqual(["-₹12,34,567", "-₹12.3 L", "-1,234.57"]);
        expect(await cellsOf("0")).toEqual(["₹0", "₹0", "0.00"]);
        expect(await cellsOf("null")).toEqual(["—", "—", "—"]);

        // In the grid sample: a pending quantity shows "—" and is announced in words, not as 0.
        const lightGrid = page.getByRole("region", { name: "BOQ grid sample" }).first();
        const plaster = lightGrid.locator("tr", { hasText: "Plaster 12 mm internal" });
        const qty = plaster.locator("td").nth(2);
        await expect(qty.locator('[aria-hidden="true"]')).toHaveText("—");
        await expect(qty.locator(".sr-only")).toHaveText("Quantity pending");
        await expect(qty).not.toContainText("0");

        // No "-0", "-0.00" or "-₹0" anywhere on the page.
        const body = await page.locator("main").innerText();
        expect(body).not.toMatch(/(^|[^\d,.])-₹?0(\.0+)?(?![\d,.])/m);

        // Figures are tabular: every numeric cell resolves to tabular-nums, and
        // two strings of different digits really render the same width.
        const fv = await page.$$eval("main .ds-num", (els) => [...new Set(els.map((el) => getComputedStyle(el).fontVariantNumeric))]);
        expect(fv).toEqual(["tabular-nums"]);
        const widths = await page.evaluate(async () => {
          // Measure both in one layout, after web fonts settle: a font swap
          // between two separate measurements would compare different fonts.
          await document.fonts.ready;
          const host = document.querySelector('main [data-ds-theme="light"]')!;
          const spans = ["₹11,11,111.11", "₹88,88,888.88"].map((t) => {
            const s = document.createElement("span");
            s.className = "ds-num";
            s.textContent = t;
            host.appendChild(s);
            return s;
          });
          const out = spans.map((s) => s.getBoundingClientRect().width);
          spans.forEach((s) => s.remove());
          return out;
        });
        expect(Math.abs(widths[0] - widths[1])).toBeLessThan(0.01);
      });

      test("every interactive element is at least 24×24 px and has an accessible name", async ({ page }) => {
        await openDesignSystem(page);
        // Open the disclosure so the swatches inside are measured as well.
        await page.locator("summary", { hasText: "State CSS variables" }).first().click();
        const sel = 'main :is(button, a[href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"]), .ds-target)';
        const sizes = await page.$$eval(sel, (els) =>
          els.map((el) => {
            const b = el.getBoundingClientRect();
            return { el: `${el.tagName.toLowerCase()} ${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30)}`, w: b.width, h: b.height };
          }),
        );
        expect(sizes.length).toBeGreaterThan(10);
        for (const s of sizes) {
          expect.soft(s.w, `${s.el} width`).toBeGreaterThanOrEqual(24);
          expect.soft(s.h, `${s.el} height`).toBeGreaterThanOrEqual(24);
        }
        const controls = page.locator('main :is(button, input, summary, [role="region"], [role="group"])');
        const n = await controls.count();
        expect(n).toBeGreaterThan(10);
        for (let i = 0; i < n; i++) await expect.soft(controls.nth(i)).toHaveAccessibleName(/\S/);
      });

      test("keyboard reaches every control with a visible, contrasting focus ring", async ({ page }) => {
        await openDesignSystem(page);
        await installContrastHelpers(page);
        await page.locator("body").focus();
        const stops: { el: string; focusVisible: boolean; outline: string; width: number; ringContrast: number }[] = [];
        for (let i = 0; i < 60; i++) {
          await page.keyboard.press("Tab");
          const info = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body || !el.closest("main")) return null;
            const cs = getComputedStyle(el);
            return {
              el: `${el.tagName.toLowerCase()} ${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30)}`,
              focusVisible: el.matches(":focus-visible"),
              outline: cs.outlineStyle,
              width: parseFloat(cs.outlineWidth),
              ringContrast: window.__ds.ratio(cs.outlineColor, window.__ds.backdrop(el.parentElement)),
            };
          });
          if (!info) break;
          stops.push(info);
        }
        // Stops that must be reachable: the named scroll regions, the disclosure,
        // both nudges and the enabled reorder buttons.
        const labels = stops.map((s) => s.el);
        for (const want of [
          "div BOQ grid sample",
          "div Money format examples",
          "div Contrast check results",
          "summary State CSS variables",
          "input Wall length (m)",
          "button Increase Wall length by 0.1",
          "input Plaster area (m²)",
          "button Move Ground floor down",
          "button Move Terrace up",
        ]) {
          expect(labels).toContain(want);
        }
        for (const s of stops) {
          expect.soft(s.focusVisible, `${s.el} :focus-visible`).toBe(true);
          expect.soft(s.outline, `${s.el} outline style`).toBe("solid");
          expect.soft(s.width, `${s.el} outline width`).toBeGreaterThanOrEqual(2);
          expect.soft(s.ringContrast, `${s.el} ring contrast`).toBeGreaterThanOrEqual(3);
        }
      });

      test("NumericNudge replaces dragging: type, buttons, arrows; unresolved values cannot be nudged", async ({ page }) => {
        await openDesignSystem(page);
        const input = page.getByLabel("Wall length (m)");
        await expect(page.getByRole("group", { name: "Wall length" })).toBeVisible();
        await expect(input).toHaveValue("4.20");
        await input.press("ArrowUp");
        await expect(input).toHaveValue("4.30");
        await input.press("ArrowDown");
        await expect(input).toHaveValue("4.20");
        await input.press("Shift+ArrowUp");
        await expect(input).toHaveValue("5.20");
        await input.press("Shift+ArrowDown");
        await expect(input).toHaveValue("4.20");
        // A comma typed as a decimal point is rejected, never committed as 45.
        await input.fill("4,5");
        await input.press("Enter");
        await expect(page.getByRole("alert")).toHaveText("Enter a number");
        await input.press("Escape");
        await expect(input).toHaveValue("4.20");
        // Well-formed grouping is accepted and shown back in en-IN form.
        await input.fill("12,345.5");
        await input.press("Enter");
        await expect(input).toHaveValue("12,345.50");
        await input.fill("7.25");
        await input.press("Enter");
        await expect(input).toHaveValue("7.25");
        await input.fill("abc");
        await input.press("Enter");
        await expect(page.getByRole("alert")).toHaveText("Enter a number");
        await expect(input).toHaveAttribute("aria-invalid", "true");
        await input.press("Escape");
        await expect(input).toHaveValue("7.25");
        await expect(page.getByRole("alert")).toHaveCount(0);

        // Tab from the field lands on "+", which works with Enter and Space.
        await input.press("Tab");
        const plus = page.getByRole("button", { name: "Increase Wall length by 0.1" });
        await expect(plus).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(input).toHaveValue("7.35");
        await page.keyboard.press("Space");
        await expect(input).toHaveValue("7.45");
        await page.getByRole("button", { name: "Decrease Wall length by 0.1" }).click();
        await expect(input).toHaveValue("7.35");

        // At the minimum, "−" is disabled.
        await input.fill("0");
        await input.press("Enter");
        await expect(page.getByRole("button", { name: "Decrease Wall length by 0.1" })).toBeDisabled();

        // Unresolved: no value is invented by buttons or arrow keys.
        const pending = page.getByLabel("Plaster area (m²)");
        await expect(pending).toHaveValue("");
        await expect(page.getByRole("button", { name: "Increase Plaster area by 1" })).toBeDisabled();
        await expect(page.getByRole("button", { name: "Decrease Plaster area by 1" })).toBeDisabled();
        await pending.press("ArrowUp");
        await pending.press("Shift+ArrowDown");
        await pending.press("Enter");
        await expect(pending).toHaveValue("");
        await expect(page.getByRole("alert")).toHaveCount(0);
        // Typing a value resolves it, and only then do the buttons work.
        await pending.fill("12");
        await pending.press("Enter");
        await expect(pending).toHaveValue("12.00");
        await expect(page.getByRole("button", { name: "Increase Plaster area by 1" })).toBeEnabled();
      });

      test("ReorderButtons replace drag-to-reorder from the keyboard, keeping focus", async ({ page }) => {
        await openDesignSystem(page);
        const order = () => page.locator("main ol li").allTextContents();
        expect(await order()).toEqual(["Ground floor", "First floor", "Terrace"]);
        await expect(page.getByRole("button", { name: "Move Ground floor up" })).toBeDisabled();
        await expect(page.getByRole("button", { name: "Move Terrace down" })).toBeDisabled();

        const groundDown = page.getByRole("button", { name: "Move Ground floor down" });
        await groundDown.focus();
        await page.keyboard.press("Enter");
        expect(await order()).toEqual(["First floor", "Ground floor", "Terrace"]);
        await expect(groundDown).toBeFocused();

        await page.getByRole("button", { name: "Move Terrace up" }).focus();
        await page.keyboard.press("Space");
        expect(await order()).toEqual(["First floor", "Terrace", "Ground floor"]);
        await expect(page.getByRole("button", { name: "Move First floor up" })).toBeDisabled();
        await expect(page.getByRole("button", { name: "Move Ground floor down" })).toBeDisabled();
      });

      test("no horizontal page scroll and no clipped or truncated text", async ({ page }) => {
        await openDesignSystem(page);
        await page.locator("summary", { hasText: "State CSS variables" }).first().click();
        const scroll = await page.evaluate(() => ({ page: document.scrollingElement!.scrollWidth, viewport: window.innerWidth }));
        expect(scroll.page).toBeLessThanOrEqual(scroll.viewport);

        const clipped = await page.$$eval("main *", (els) =>
          els
            .filter((el) => !el.closest(".sr-only") && !el.classList.contains("sr-only"))
            .filter((el) => {
              const cs = getComputedStyle(el);
              if (cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth) return true;
              const hides = (v: string) => v === "hidden" || v === "clip";
              return (hides(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) || (hides(cs.overflowY) && el.scrollHeight > el.clientHeight + 1);
            })
            .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
        );
        expect(clipped).toEqual([]);

        // Content wider than the screen lives only in the named, keyboard-focusable
        // scroll regions; nothing else is pushed past the main column.
        const escapes = await page.evaluate(() => {
          const main = document.querySelector("main")!.getBoundingClientRect();
          return [...document.querySelectorAll("main *")]
            .filter((el) => !el.closest(".overflow-x-auto") && !el.closest(".sr-only"))
            .filter((el) => {
              const b = el.getBoundingClientRect();
              return b.width > 0 && (b.right > main.right + 1 || b.left < main.left - 1);
            })
            .map((el) => `${el.tagName.toLowerCase()} ${el.textContent?.trim().slice(0, 30)}`);
        });
        expect(escapes).toEqual([]);
      });
    });
  }
}
