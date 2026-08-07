import { describe, it, expect } from "vitest";
import { generateForDiscipline, DISCIPLINES, disciplineByKey } from "./disciplines";
import { defaultSpec } from "./boqSpec";

const project = { area_sqft: 1500, floors: 2 };

describe("disciplines", () => {
  it("registers civil + the four MEP disciplines", () => {
    expect(DISCIPLINES.map((d) => d.key)).toEqual(["civil", "plumbing", "electrical", "hvac", "fire"]);
    expect(disciplineByKey("electrical").name).toBe("Electrical Works");
    expect(disciplineByKey("nope").key).toBe("civil");   // fallback
  });

  it("civil routes to the DSR engine (coded lines)", () => {
    const lines = generateForDiscipline("civil", defaultSpec(), project);
    expect(lines.some((l) => l.code === "5.3")).toBe(true);
  });

  it("electrical produces manual (no-code) lines sized from rooms", () => {
    const lines = generateForDiscipline("electrical", defaultSpec({ bedrooms: 3, living: 1, kitchens: 1 }), project);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.code === null && l.ns)).toBe(true);
    expect(lines.every((l) => l.qty > 0)).toBe(true);
  });

  it("plumbing carries DSR codes where the schedule covers the item", () => {
    const lines = generateForDiscipline("plumbing", defaultSpec({ bathrooms: 2 }), project);
    expect(lines.some((l) => l.code === "17.2.1")).toBe(true);   // WC is scheduled
    expect(lines.some((l) => l.code === null)).toBe(true);        // tanks/pumps are NS
  });

  it("gates HVAC/fire quantities and never emits zero-qty lines", () => {
    const fire = generateForDiscipline("fire", defaultSpec(), project);
    expect(fire.every((l) => l.qty > 0)).toBe(true);
  });
});
