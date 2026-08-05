import { describe, it, expect } from "vitest";
import { specToIntents } from "./boqDsrGenerate";
import { defaultSpec } from "./boqSpec";

describe("specToIntents", () => {
  const project = { area_sqft: 1000, floors: 1 };

  it("produces core structural lines for a default spec", () => {
    const intents = specToIntents(defaultSpec(), project);
    const sections = new Set(intents.map((i) => i.section));
    expect(sections).toContain("RCC");
    expect(sections).toContain("Masonry");
    expect(sections).toContain("Flooring");
    // every emitted line carries a positive starting quantity
    expect(intents.every((i) => i.qty > 0)).toBe(true);
  });

  it("gates optional scope on the questionnaire answers", () => {
    const off = specToIntents(defaultSpec({ compound_wall: false, gate: false, driveway: false }), project);
    expect(off.some((i) => i.label === "Main gate")).toBe(false);

    const on = specToIntents(defaultSpec({ compound_wall: true, gate: true }), project);
    expect(on.some((i) => i.label === "Main gate")).toBe(true);
    expect(on.some((i) => i.section === "External")).toBe(true);
  });

  it("scales quantities with built-up area", () => {
    const small = specToIntents(defaultSpec(), { area_sqft: 1000, floors: 1 });
    const big = specToIntents(defaultSpec(), { area_sqft: 3000, floors: 1 });
    const rcc = (arr: ReturnType<typeof specToIntents>) => arr.find((i) => i.section === "RCC")!.qty;
    expect(rcc(big)).toBeGreaterThan(rcc(small));
  });

  it("swaps flooring keywords to match the chosen material", () => {
    const granite = specToIntents(defaultSpec({ living_floor: "granite" }), project);
    const floorLine = granite.find((i) => i.section === "Flooring" && i.label.includes("flooring"));
    expect(floorLine?.keywords).toContain("granite");
  });
});
