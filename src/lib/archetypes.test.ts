import { describe, it, expect } from "vitest";
import { ARCHETYPES, archetypeSpec } from "./archetypes";
import { generateForDiscipline } from "./disciplines";

describe("archetypes", () => {
  it("seeds a full spec with area + floors from the archetype", () => {
    const twobhk = ARCHETYPES.find((a) => a.key === "2bhk")!;
    const spec = archetypeSpec(twobhk);
    expect(spec.bedrooms).toBe(2);
    expect(spec._area_sqft).toBe(1000);
    expect(spec._floors).toBe(1);
    expect(spec.quality_tier).toBe("standard");     // still carries questionnaire defaults
  });

  it("honours quick-lever overrides", () => {
    const villa = ARCHETYPES.find((a) => a.key === "villa")!;
    const spec = archetypeSpec(villa, { area: 3000, floors: 3, tier: "economy" });
    expect(spec._area_sqft).toBe(3000);
    expect(spec._floors).toBe(3);
    expect(spec.quality_tier).toBe("economy");
  });

  it("an archetype spec generates a real draft BOQ", () => {
    const spec = archetypeSpec(ARCHETYPES.find((a) => a.key === "3bhk")!);
    const lines = generateForDiscipline("civil", spec, { area_sqft: Number(spec._area_sqft), floors: Number(spec._floors) });
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.some((l) => l.code === "5.3")).toBe(true);
  });
});
