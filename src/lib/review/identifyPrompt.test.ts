import { describe, it, expect } from "vitest";
import { buildIdentifyPrompt } from "./identifyPrompt";

describe("buildIdentifyPrompt", () => {
  it("includes the page and rounded point coordinates", () => {
    const prompt = buildIdentifyPrompt({ page: 3, point: { x: 123.6, y: 45.2 }, nearbyText: [] });
    expect(prompt).toContain("page 3");
    expect(prompt).toContain("x=124");
    expect(prompt).toContain("y=45");
  });

  it("includes nearby text when present", () => {
    const prompt = buildIdentifyPrompt({ page: 1, point: { x: 0, y: 0 }, nearbyText: ["W1", "typ."] });
    expect(prompt).toContain("W1");
    expect(prompt).toContain("typ.");
  });

  it("never fabricates nearby text when none was extracted", () => {
    const prompt = buildIdentifyPrompt({ page: 1, point: { x: 0, y: 0 }, nearbyText: [] });
    expect(prompt).not.toContain("Text actually printed");
  });

  it("instructs the model never to report a quantity or BOQ item", () => {
    const prompt = buildIdentifyPrompt({ page: 1, point: { x: 0, y: 0 }, nearbyText: [] });
    expect(prompt.toLowerCase()).toContain("never report a quantity");
  });

  it("instructs an honest empty result when nothing is identifiable", () => {
    const prompt = buildIdentifyPrompt({ page: 1, point: { x: 0, y: 0 }, nearbyText: [] });
    expect(prompt).toContain("EMPTY candidates array");
  });
});
