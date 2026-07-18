import { describe, it, expect } from "vitest";
import { mapCategoryToStage, STAGE_NAMES } from "./stageMapping";

describe("mapCategoryToStage", () => {
  it("maps known catalog categories to a real stage", () => {
    expect(mapCategoryToStage("Building Materials")).toBe("Foundation");
    expect(mapCategoryToStage("Structural")).toBe("RCC Structure");
    expect(mapCategoryToStage("Electrical")).toBe("Electrical Rough-In");
    expect(mapCategoryToStage("Plumbing & Sanitary")).toBe("Plumbing Rough-In");
    expect(mapCategoryToStage("Doors & Windows Hardware")).toBe("Doors & Windows");
  });

  it("falls back to name keywords when the category is unknown", () => {
    expect(mapCategoryToStage(null, "UltraTech Cement PPC 50kg")).toBe("Foundation");
    expect(mapCategoryToStage(null, "TMT Bar Fe500 12mm")).toBe("RCC Structure");
    expect(mapCategoryToStage(null, "CPVC Pipe 1 inch")).toBe("Plumbing Rough-In");
    expect(mapCategoryToStage(null, "Asian Paints Emulsion")).toBe("Painting");
    expect(mapCategoryToStage("", "Vitrified Floor Tile 600x600")).toBe("Flooring & Tiling");
  });

  it("returns null when nothing matches", () => {
    expect(mapCategoryToStage(null, "Mystery Widget XYZ")).toBeNull();
    expect(mapCategoryToStage("Unknown Category", "")).toBeNull();
  });

  it("only ever returns a valid stage_master name", () => {
    const out = mapCategoryToStage("Electrical", "wire");
    expect(out && (STAGE_NAMES as readonly string[]).includes(out)).toBe(true);
  });
});
