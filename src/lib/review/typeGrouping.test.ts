import { describe, it, expect } from "vitest";
import { categorize, isCountableUnit, buildTypeCard, groupByCategory } from "./typeGrouping";
import type { StoredReviewItem } from "./reviewStore";

function item(overrides: Partial<StoredReviewItem["ai"]> & { key: string; item: string }): StoredReviewItem {
  return {
    id: overrides.key,
    reviewStatus: "PENDING_REVIEW",
    ai: {
      quantity: 1, confidence: 0.9, aiStatus: "MEASURED",
      ...overrides,
    },
  };
}

describe("isCountableUnit", () => {
  it("treats nos/each/pieces as countable", () => {
    expect(isCountableUnit("nos")).toBe(true);
    expect(isCountableUnit("Nos")).toBe(true);
    expect(isCountableUnit("each")).toBe(true);
    expect(isCountableUnit("pieces")).toBe(true);
  });
  it("treats area/length/volume units as NOT countable", () => {
    expect(isCountableUnit("sq ft")).toBe(false);
    expect(isCountableUnit("sqm")).toBe(false);
    expect(isCountableUnit("m")).toBe(false);
    expect(isCountableUnit("cum")).toBe(false);
  });
  it("treats missing unit as not countable", () => {
    expect(isCountableUnit(undefined)).toBe(false);
    expect(isCountableUnit(null)).toBe(false);
    expect(isCountableUnit("")).toBe(false);
  });
});

describe("categorize", () => {
  it("derives category from a mark-style key prefix", () => {
    expect(categorize({ key: "W1", item: "Window W1" })).toBe("Windows");
    expect(categorize({ key: "D2", item: "Door D2" })).toBe("Doors");
    expect(categorize({ key: "C-1", item: "Column C-1" })).toBe("Columns");
    expect(categorize({ key: "B4", item: "Beam B4" })).toBe("Beams");
  });
  it("falls back to a keyword match against the item name when the key isn't mark-style", () => {
    expect(categorize({ key: "EXT-WALL-01", item: "External wall — 230mm brick" })).toBe("Walls");
    expect(categorize({ key: "FLOORING-GF", item: "Ground floor flooring" })).toBe("Finishes");
  });
  it("never guesses a category it can't support — falls back to Other", () => {
    expect(categorize({ key: "XYZ-9", item: "Miscellaneous scope item" })).toBe("Other");
  });
});

describe("buildTypeCard", () => {
  it("uses the real, already-extracted quantity as the instance count for a countable unit", () => {
    const it1 = item({ key: "W1", item: "Window W1", quantity: 6, unit: "nos" });
    const card = buildTypeCard(it1);
    expect(card.countable).toBe(true);
    expect(card.instanceCount).toBe(6);
    expect(card.category).toBe("Windows");
  });
  it("never reports an instance count for a continuous/measured unit", () => {
    const wall = item({ key: "WALL-EXT", item: "External wall", quantity: 128.4, unit: "sq ft" });
    const card = buildTypeCard(wall);
    expect(card.countable).toBe(false);
    expect(card.instanceCount).toBeNull();
  });
  it("surfaces the same exception reasons reviewQueue.criticalReasons already computes", () => {
    const lowConf = item({ key: "W2", item: "Window W2", quantity: 4, unit: "nos", confidence: 0.3 });
    const card = buildTypeCard(lowConf);
    expect(card.needsAttention).toBe(true);
    expect(card.reasons).toContain("Low confidence");
  });
  it("a routine, confident, evidenced item needs no attention", () => {
    const routine = item({ key: "W3", item: "Window W3", quantity: 2, unit: "nos", confidence: 0.9, source: { document: "d", evidence: [{ bbox: [0, 0, 1, 1] }] } });
    const card = buildTypeCard(routine);
    expect(card.needsAttention).toBe(false);
    expect(card.reasons).toEqual([]);
  });
});

describe("groupByCategory", () => {
  it("groups distinct review items into their categories without merging them", () => {
    const items = [
      item({ key: "W1", item: "Window W1", quantity: 6, unit: "nos" }),
      item({ key: "W2", item: "Window W2", quantity: 4, unit: "nos" }),
      item({ key: "D1", item: "Door D1", quantity: 2, unit: "nos" }),
    ];
    const groups = groupByCategory(items);
    const windows = groups.find((g) => g.category === "Windows");
    const doors = groups.find((g) => g.category === "Doors");
    expect(windows?.types).toHaveLength(2);
    expect(doors?.types).toHaveLength(1);
    // Never merged into one type — each stays its own review/Apply identity.
    expect(windows?.types.map((t) => t.reviewItem.id)).toEqual(["W1", "W2"]);
  });
  it("orders known categories before Other, and omits empty categories", () => {
    const items = [
      item({ key: "XYZ", item: "Misc scope" }),
      item({ key: "D1", item: "Door D1" }),
    ];
    const groups = groupByCategory(items);
    expect(groups.map((g) => g.category)).toEqual(["Doors", "Other"]);
  });
  it("counts needs-attention types per category without double-counting reviewed ones", () => {
    const items = [
      item({ key: "W1", item: "Window W1", quantity: 6, unit: "nos", confidence: 0.9, source: { document: "d", evidence: [{ bbox: [0, 0, 1, 1] }] } }),
      item({ key: "W2", item: "Window W2", quantity: 4, unit: "nos", confidence: 0.3, source: { document: "d", evidence: [{ bbox: [0, 0, 1, 1] }] } }),
    ];
    const groups = groupByCategory(items);
    const windows = groups.find((g) => g.category === "Windows")!;
    expect(windows.needsAttentionCount).toBe(1);
  });
});
