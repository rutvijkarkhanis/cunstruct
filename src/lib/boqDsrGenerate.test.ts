import { describe, it, expect } from "vitest";
import { generateLines } from "./boqDsrGenerate";
import { defaultSpec } from "./boqSpec";

describe("generateLines", () => {
  const project = { area_sqft: 1000, floors: 1 };

  it("produces core structural lines with exact DSR codes", () => {
    const lines = generateLines(defaultSpec(), project);
    const codes = new Set(lines.map((l) => l.code));
    expect(codes.has("5.3")).toBe(true);    // RCC M-20
    expect(codes.has("6.4.2")).toBe(true);  // 230mm brick masonry
    expect(lines.every((l) => l.qty > 0)).toBe(true);
    expect(lines.every((l) => !!l.code)).toBe(true);
  });

  it("gates optional scope on the questionnaire answers", () => {
    const off = generateLines(defaultSpec({ gate: false, driveway: false, compound_wall: false }), project);
    expect(off.some((l) => l.code === "10.2")).toBe(false);      // no gate
    const on = generateLines(defaultSpec({ gate: true }), project);
    expect(on.some((l) => l.code === "10.2")).toBe(true);
  });

  it("scales structural quantity with built-up area", () => {
    const rcc = (a: number) => generateLines(defaultSpec(), { area_sqft: a, floors: 1 }).find((l) => l.code === "5.3")!.qty;
    expect(rcc(3000)).toBeGreaterThan(rcc(1000));
  });

  it("picks the flooring code from the chosen material", () => {
    expect(generateLines(defaultSpec({ living_floor: "ceramic" }), project).find((l) => l.section === "Flooring" && l.label.includes("Living"))?.code).toBe("11.37");
    expect(generateLines(defaultSpec({ living_floor: "vitrified" }), project).find((l) => l.section === "Flooring" && l.label.includes("Living"))?.code).toBe("11.41.2");
  });

  it("switches window code + unit by material", () => {
    const alu = generateLines(defaultSpec({ windows: "aluminium" }), project);
    expect(alu.some((l) => l.code === "21.1.2.2" && l.unit === "kg")).toBe(true);
    expect(alu.some((l) => l.code === "9.147")).toBe(false);
    const upvc = generateLines(defaultSpec({ windows: "upvc" }), project);
    expect(upvc.some((l) => l.code === "9.147" && l.unit === "sqm")).toBe(true);
    expect(upvc.some((l) => l.code === "21.1.2.2")).toBe(false);
  });
});
