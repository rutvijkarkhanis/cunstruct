import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DSR_CATALOG, buildContext, stageForCode, STAGE_ORDER } from "./boqDsrCatalog";
import type { Spec } from "./boqSpec";

// Read the DSR seed and assert every code the catalog references really exists.
// This is the guardrail that stops a mistyped code (the whole class of bug that
// produced raised-access-floor materials) from ever shipping.
const seed = readFileSync(resolve(process.cwd(), "supabase/migrations/20260731001000_dsr_seed_civil.sql"), "utf8");
const seedHasCode = (code: string) => seed.includes(`'DSR','2023','${code}',`);

// Cover both branches of any code chooser.
const SPECS: Spec[] = [
  {}, { living_floor: "ceramic" }, { living_floor: "vitrified" },
  { windows: "aluminium" }, { windows: "upvc" },
];

function allCatalogCodes(): string[] {
  const codes = new Set<string>();
  for (const item of DSR_CATALOG) {
    if (typeof item.code === "string") codes.add(item.code);
    else for (const s of SPECS) codes.add(item.code(s));
  }
  return [...codes];
}

describe("DSR catalog", () => {
  it("references only codes that exist in the DSR seed", () => {
    const missing = allCatalogCodes().filter((c) => !seedHasCode(c));
    expect(missing).toEqual([]);
  });

  it("has unique item keys", () => {
    const keys = DSR_CATALOG.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("maps catalog codes to their construction stage, with a chapter fallback", () => {
    expect(stageForCode("5.3")).toBe("RCC Superstructure");       // catalog
    expect(stageForCode("6.4.2")).toBe("Masonry");
    expect(stageForCode("11.41.2")).toBe("Flooring & Tiling");
    expect(stageForCode("17.2.1")).toBe("Sanitary & Fixtures");
    expect(stageForCode("13.1.2")).toBe("Plastering");            // catalog wins over ch-13 fallback
    expect(stageForCode("13.999")).toBe("Painting");              // ch-13 fallback for a non-catalog code
    expect(stageForCode("99.9")).toBe("Other Works");             // unknown chapter
    expect(stageForCode(null)).toBe("Other Works");
    expect(STAGE_ORDER).toContain("RCC Superstructure");
  });

  it("every enabled line yields a positive quantity for a typical house", () => {
    const spec: Spec = { bedrooms: 3, bathrooms: 2, kitchens: 1, living: 1, balconies: 2 };
    const ctx = buildContext(spec, { area_sqft: 1500, floors: 2 });
    for (const item of DSR_CATALOG) {
      if (item.when && !item.when(spec)) continue;
      expect(item.qty(ctx, spec)).toBeGreaterThan(0);
    }
  });
});
