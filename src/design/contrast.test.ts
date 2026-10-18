import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contrastPairs, contrastRatio, REQUIRED } from "./contrast";
import { BRAND, STATES, THEMES, baseVar, stateVar, type BaseColors, type StateColors } from "./tokens";

// Read from disk: Vitest stubs CSS imports (even ?raw) to empty strings.
const tokensCss = readFileSync(resolve(__dirname, "tokens.css"), "utf8");

describe("contrast maths", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("0 0% 0%", "0 0% 100%")).toBeCloseTo(21, 5);
    expect(contrastRatio("0 0% 100%", "0 0% 100%")).toBeCloseTo(1, 5);
    // #767676 on white is the classic 4.54:1 AA threshold grey (L = 46.27%).
    expect(contrastRatio("0 0% 46.27%", "0 0% 100%")).toBeCloseTo(4.54, 1);
  });
});

describe("WCAG contrast — every design-system text/background pair, light and dark", () => {
  const pairs = contrastPairs();

  it("covers both themes and every semantic state", () => {
    for (const theme of ["light", "dark"]) {
      for (const s of STATES) {
        expect(pairs.some((p) => p.theme === theme && p.name.startsWith(s))).toBe(true);
      }
    }
  });

  it.each(pairs.map((p) => [`${p.theme}: ${p.name} (${p.kind}, needs ${REQUIRED[p.kind]}:1)`, p] as const))(
    "%s",
    (_label, p) => {
      const ratio = contrastRatio(p.fg, p.bg);
      expect(ratio, `${p.theme} ${p.name}: ${ratio.toFixed(2)}:1 < ${REQUIRED[p.kind]}:1`).toBeGreaterThanOrEqual(
        REQUIRED[p.kind],
      );
    },
  );
});

describe("tokens.css declares exactly the values in tokens.ts", () => {
  /** Extract `--name: value;` declarations from the first block matching `selector {`. */
  function block(selector: string): Record<string, string> {
    const start = tokensCss.indexOf(selector + " {");
    expect(start, `selector ${selector} missing from tokens.css`).toBeGreaterThanOrEqual(0);
    const body = tokensCss.slice(start, tokensCss.indexOf("}", start));
    const out: Record<string, string> = {};
    for (const m of body.matchAll(/(--ds-[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
    return out;
  }

  it.each([
    ["light", ":root,\n[data-ds-theme=\"light\"],\n.ds-drawing"],
    ["dark", "[data-ds-theme=\"dark\"]"],
  ] as const)("%s theme", (theme, selector) => {
    const decl = block(selector);
    const t = THEMES[theme];
    for (const k of Object.keys(t.base) as (keyof BaseColors)[]) expect(decl[baseVar(k)], baseVar(k)).toBe(t.base[k]);
    for (const s of STATES) {
      for (const k of ["fg", "bg", "border", "text"] as (keyof StateColors)[]) {
        expect(decl[stateVar(s, k)], stateVar(s, k)).toBe(t.states[s][k]);
      }
    }
  });

  it("keeps the existing brand navy and amber unchanged", () => {
    expect(BRAND.primary).toBe("220 25% 14%");
    expect(BRAND.accent).toBe("36 95% 54%");
    expect(THEMES.light.base.primary).toBe(BRAND.primary);
    expect(THEMES.light.states.NEEDS_REVIEW.bg).toBe(BRAND.accent);
  });

  it("renders drawings on the light palette regardless of theme", () => {
    // .ds-drawing shares the light block's selector list, so it always resolves to light values.
    expect(tokensCss).toMatch(/:root,\n\[data-ds-theme="light"\],\n\.ds-drawing \{/);
    expect(tokensCss).toMatch(/\.ds-drawing \{[^}]*color-scheme:\s*light/);
  });

  it("gives numbers a font whose digits are all one width, not just tabular-nums", () => {
    // DM Sans has no tabular figures; the browser check is e2e/designSystem.spec.ts.
    const num = tokensCss.match(/\.ds-num \{([^}]*)\}/)?.[1] ?? "";
    expect(num).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(num).toMatch(/font-family:[^;]*\bmonospace;/);
  });
});
