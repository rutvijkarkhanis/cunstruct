import { describe, it, expect } from "vitest";
import {
  buildReviewItems, orderQueue, matchesFilter, reviewSummary,
  diffItem, quantityDelta, isCritical, criticalReasons, effectiveQuantity,
  type ReviewItem,
} from "./reviewQueue";
import type { AnalysisItemV1 } from "./analysisSchemaV1";

const ai = (o: Partial<AnalysisItemV1>): AnalysisItemV1 => ({
  key: o.key ?? o.item ?? "x", item: o.item ?? "Item", quantity: o.quantity ?? 1,
  confidence: o.confidence ?? 0.9, aiStatus: o.aiStatus ?? "MEASURED", ...o,
});

describe("buildReviewItems — duplicate detection", () => {
  it("tags a later identical item as a duplicate of the first", () => {
    const items = buildReviewItems([
      ai({ key: "W1", item: "Window", location: "First Floor" }),
      ai({ key: "W2", item: "Window", location: "First Floor" }), // same name+location
    ]);
    expect(items[0].duplicateOf).toBeUndefined();
    expect(items[1].duplicateOf).toBe("W1");
  });

  it("does NOT flag the same mark code reused across different floors as a duplicate", () => {
    // Stilt / W1, Ground / W1, Typical / W1 — same key, three distinct real
    // items. This is the exact false-positive the unscoped key check produced.
    const items = buildReviewItems([
      ai({ key: "W1", item: "Window", location: "Stilt" }),
      ai({ key: "W1", item: "Window", location: "Ground" }),
      ai({ key: "W1", item: "Window", location: "Typical Floor 1" }),
    ]);
    expect(items[0].duplicateOf).toBeUndefined();
    expect(items[1].duplicateOf).toBeUndefined();
    expect(items[2].duplicateOf).toBeUndefined();
  });

  it("still flags the same key in the same location as a duplicate", () => {
    const items = buildReviewItems([
      ai({ key: "W1", item: "Window", location: "Ground" }),
      ai({ key: "W1", item: "Window", location: "Ground" }),
    ]);
    expect(items[0].duplicateOf).toBeUndefined();
    expect(items[1].duplicateOf).toBe("W1");
  });

  it("still flags the same key as a duplicate when location is blank on both", () => {
    const items = buildReviewItems([
      ai({ key: "W1", item: "Window" }),
      ai({ key: "W1", item: "Window" }),
    ]);
    expect(items[0].duplicateOf).toBeUndefined();
    expect(items[1].duplicateOf).toBe("W1");
  });

  it("location comparison is case/whitespace insensitive, like the existing item+location check", () => {
    const items = buildReviewItems([
      ai({ key: "W1", item: "Window", location: "Ground" }),
      ai({ key: "W1", item: "Window", location: "  GROUND  " }),
    ]);
    expect(items[1].duplicateOf).toBe("W1");
  });
});

// ── Fix B: a bare mark code with NO location is never, by itself, proof that
// two occurrences are the same physical instance. The scoping above (Fix A)
// already protects an EXPLICIT location mismatch; this closes the gap Fix A
// left open — the same mark code reused across floors looks IDENTICAL to a
// genuine repeat once location drops out of both sides. Requires the item's
// own measured facts (quantity/dimension/specification) to ALSO agree before
// linking two blank-location occurrences; any disagreement is treated as
// evidence they are different instances, never guessed past. ────────────────
describe("buildReviewItems — Fix B: blank-location duplicates require agreeing measured facts", () => {
  it("three same-key items, all blank location, three DIFFERENT quantities -> none linked to one another", () => {
    const items = buildReviewItems([
      ai({ key: "W1", item: "Window W1", quantity: 1 }),  // Stilt, in reality
      ai({ key: "W1", item: "Window W1", quantity: 7 }),  // Ground, in reality
      ai({ key: "W1", item: "Window W1", quantity: 3 }),  // a Typical floor, in reality
    ]);
    expect(items[0].duplicateOf).toBeUndefined();
    expect(items[1].duplicateOf).toBeUndefined();
    expect(items[2].duplicateOf).toBeUndefined();
  });

  it("a genuine same-floor repeat (identical quantity/dimension/specification) is still linked, even with location blank on both", () => {
    const items = buildReviewItems([
      ai({ key: "W1", item: "Window W1", quantity: 7, dimension: "6'x6'9\"", specification: "UPVC" }),
      ai({ key: "W1", item: "Window W1", quantity: 7, dimension: "6'x6'9\"", specification: "UPVC" }),
    ]);
    expect(items[0].duplicateOf).toBeUndefined();
    expect(items[1].duplicateOf).toBe("W1");
  });

  it("the repeat still links correctly even when an EARLIER, differently-fingerprinted occurrence of the same bare key comes first — not dependent on processing order", () => {
    const items = buildReviewItems([
      ai({ key: "W1", item: "Window W1", quantity: 1, dimension: "4'x5'3\"", specification: "UPVC" }),  // Stilt
      ai({ key: "W1", item: "Window W1", quantity: 7, dimension: "6'x6'9\"", specification: "UPVC" }),  // Ground
      ai({ key: "W1", item: "Window W1", quantity: null, aiStatus: "PENDING" }),                        // Typical (uncertain)
      ai({ key: "W1", item: "Window W1", quantity: 7, dimension: "6'x6'9\"", specification: "UPVC" }),  // Ground, repeated
    ]);
    expect(items[0].duplicateOf).toBeUndefined();
    expect(items[1].duplicateOf).toBeUndefined();
    expect(items[2].duplicateOf).toBeUndefined();
    expect(items[3].duplicateOf).toBe("W1"); // links to the Ground occurrence's fingerprint, not Stilt's
  });

  it("a differing dimension alone (same quantity) still prevents linking — any disagreement is evidence, not just quantity", () => {
    const items = buildReviewItems([
      ai({ key: "W1", item: "Window W1", quantity: 7, dimension: "6'x6'9\"" }),
      ai({ key: "W1", item: "Window W1", quantity: 7, dimension: "4'x5'3\"" }), // same qty, different size
    ]);
    expect(items[1].duplicateOf).toBeUndefined();
  });

  it("a missing location item is never confused with an explicit-location item sharing the same key — distinct bucket spaces, never cross-matched", () => {
    const items = buildReviewItems([
      ai({ key: "W1", item: "Window W1", quantity: 7, location: "Ground" }),
      ai({ key: "W1", item: "Window W1", quantity: 7 }), // same key/quantity, but no location at all
    ]);
    expect(items[0].duplicateOf).toBeUndefined();
    expect(items[1].duplicateOf).toBeUndefined(); // never linked to the Ground item, missing != agreeing
  });
});

// ── Adversarial-review follow-up: quantity/dimension/specification agreeing
// is NOT proof of physical identity — three genuinely distinct floors can
// legitimately share an identical count/size/spec (e.g. "every floor has 10
// Type-D1 doors, 900x2100, flush panel"), and the measured-facts fingerprint
// alone cannot tell that apart from one floor's row re-parsed three times.
// `source.documentId`/`source.page` (a different drawing page is real,
// direct evidence of a different physical instance) narrows this for
// occurrences that actually track it — WITHOUT it, the limitation is
// unresolved and stated as such below, not silently accepted. ─────────────
describe("buildReviewItems — Fix B refinement: source page/document disambiguates when measured facts alone cannot", () => {
  it("three same-key items, blank location, IDENTICAL quantity/dimension/specification, but three DIFFERENT source pages -> none linked to one another", () => {
    const items = buildReviewItems([
      ai({ key: "D1", item: "Door D1", quantity: 10, dimension: "900x2100", specification: "Flush panel", source: { documentId: "doc-1", page: 7, evidence: [] } }),
      ai({ key: "D1", item: "Door D1", quantity: 10, dimension: "900x2100", specification: "Flush panel", source: { documentId: "doc-1", page: 8, evidence: [] } }),
      ai({ key: "D1", item: "Door D1", quantity: 10, dimension: "900x2100", specification: "Flush panel", source: { documentId: "doc-1", page: 9, evidence: [] } }),
    ]);
    expect(items[0].duplicateOf).toBeUndefined();
    expect(items[1].duplicateOf).toBeUndefined();
    expect(items[2].duplicateOf).toBeUndefined();
  });

  it("a genuine repeat with IDENTICAL measured facts AND the same source page is still linked", () => {
    const items = buildReviewItems([
      ai({ key: "D1", item: "Door D1", quantity: 10, dimension: "900x2100", specification: "Flush panel", source: { documentId: "doc-1", page: 7, evidence: [] } }),
      ai({ key: "D1", item: "Door D1", quantity: 10, dimension: "900x2100", specification: "Flush panel", source: { documentId: "doc-1", page: 7, evidence: [] } }),
    ]);
    expect(items[0].duplicateOf).toBeUndefined();
    expect(items[1].duplicateOf).toBe("D1");
  });

  it("the same document but a DIFFERENT page still prevents linking, even with every other field identical", () => {
    const items = buildReviewItems([
      ai({ key: "D1", item: "Door D1", quantity: 10, source: { documentId: "doc-1", page: 7, evidence: [] } }),
      ai({ key: "D1", item: "Door D1", quantity: 10, source: { documentId: "doc-1", page: 8, evidence: [] } }),
    ]);
    expect(items[1].duplicateOf).toBeUndefined();
  });

  it("source info present on only ONE side never silently matches the other, even with identical measured facts — asymmetric tracking is treated as insufficient evidence, not agreement", () => {
    const items = buildReviewItems([
      ai({ key: "D1", item: "Door D1", quantity: 10, source: { documentId: "doc-1", page: 7, evidence: [] } }),
      ai({ key: "D1", item: "Door D1", quantity: 10 }), // no source tracked at all
    ]);
    expect(items[1].duplicateOf).toBeUndefined();
  });

  it("matching source (same document+page) is never sufficient on its own — a disagreeing quantity or dimension still blocks linking, exactly like the no-source case", () => {
    // Source metadata is SUPPORTING evidence, never proof of physical
    // identity by itself: two occurrences reported from the exact same page
    // but disagreeing on a measured fact are still two different claims
    // about that page (e.g. a miscount, or two distinct items the AI
    // genuinely found on the same sheet), not one item confirmed twice.
    const differingQty = buildReviewItems([
      ai({ key: "D1", item: "Door D1", quantity: 10, source: { documentId: "doc-1", page: 7, evidence: [] } }),
      ai({ key: "D1", item: "Door D1", quantity: 20, source: { documentId: "doc-1", page: 7, evidence: [] } }),
    ]);
    expect(differingQty[1].duplicateOf).toBeUndefined();

    const differingDimension = buildReviewItems([
      ai({ key: "D1", item: "Door D1", quantity: 10, dimension: "900x2100", source: { documentId: "doc-1", page: 7, evidence: [] } }),
      ai({ key: "D1", item: "Door D1", quantity: 10, dimension: "750x2100", source: { documentId: "doc-1", page: 7, evidence: [] } }),
    ]);
    expect(differingDimension[1].duplicateOf).toBeUndefined();
  });

  it("ACKNOWLEDGED LIMITATION: three genuinely distinct physical instances with identical measured facts and NO source tracking at all are still indistinguishable from a repeat — the schema has no further signal, and this is documented rather than silently accepted", () => {
    const items = buildReviewItems([
      ai({ key: "D1", item: "Door D1", quantity: 10, dimension: "900x2100", specification: "Flush panel" }), // a different floor, in reality
      ai({ key: "D1", item: "Door D1", quantity: 10, dimension: "900x2100", specification: "Flush panel" }), // a different floor, in reality
    ]);
    // This is NOT the desired outcome — it is the documented boundary of
    // what this representation can safely decide. Closing it needs richer
    // identity evidence than this schema carries today (see
    // unlocatedFingerprint's own doc comment) — never invented here.
    expect(items[1].duplicateOf).toBe("D1");
  });
});

describe("orderQueue — attention first, nothing discarded", () => {
  it("puts pending/low-confidence/duplicate/inferred before normal measured, and reviewed last", () => {
    const items = buildReviewItems([
      ai({ key: "A", item: "Measured", quantity: 5, confidence: 0.95, aiStatus: "MEASURED" }),
      ai({ key: "B", item: "PendingQty", quantity: null, aiStatus: "PENDING" }),
      ai({ key: "C", item: "LowConf", quantity: 2, confidence: 0.3 }),
      ai({ key: "D", item: "Inferred", quantity: 1, aiStatus: "INFERRED" }),
    ]);
    items[0].reviewStatus = "VERIFIED"; // reviewed measured → should sink to the end
    const order = orderQueue(items).map((i) => i.ai.key);
    expect(order.indexOf("B")).toBeLessThan(order.indexOf("D"));   // pending before inferred
    expect(order.indexOf("C")).toBeLessThan(order.indexOf("D"));   // low-conf before inferred
    expect(order[order.length - 1]).toBe("A");                     // reviewed kept, at the end
  });
});

describe("isCritical", () => {
  it("flags pending, low confidence, no evidence, or duplicate", () => {
    expect(isCritical({ ai: ai({ quantity: null, aiStatus: "PENDING" }), reviewStatus: "PENDING_REVIEW" })).toBe(true);
    expect(isCritical({ ai: ai({ confidence: 0.4 }), reviewStatus: "PENDING_REVIEW" })).toBe(true);
    expect(isCritical({ ai: ai({ confidence: 0.95, quantity: 3, aiStatus: "MEASURED", source: { document: "d", evidence: [{ bbox: [0, 0, 1, 1] }] } }), reviewStatus: "PENDING_REVIEW" })).toBe(false);
  });
});

describe("criticalReasons — factual, named reasons behind isCritical", () => {
  const measured = (o: Partial<AnalysisItemV1> = {}): ReviewItem => ({ ai: ai({ confidence: 0.95, quantity: 3, aiStatus: "MEASURED", source: { document: "d", evidence: [{ bbox: [0, 0, 1, 1] }] }, ...o }), reviewStatus: "PENDING_REVIEW" });

  it("returns no reasons for a routine, high-confidence, measured item with evidence", () => {
    expect(criticalReasons(measured())).toEqual([]);
  });
  it("names a duplicate", () => {
    expect(criticalReasons({ ...measured(), duplicateOf: "W1" })).toEqual(["Possible duplicate"]);
  });
  it("names a pending/no-quantity item", () => {
    expect(criticalReasons(measured({ quantity: null, aiStatus: "PENDING" }))).toEqual(["Pending — no quantity"]);
  });
  it("names an inferred item", () => {
    expect(criticalReasons(measured({ aiStatus: "INFERRED" }))).toEqual(["Inferred"]);
  });
  it("names low confidence", () => {
    expect(criticalReasons(measured({ confidence: 0.4 }))).toEqual(["Low confidence"]);
  });
  it("names missing evidence", () => {
    expect(criticalReasons(measured({ source: { document: "d", evidence: [] } }))).toEqual(["No evidence"]);
  });
  it("combines every applicable reason, in a stable order", () => {
    const it_: ReviewItem = { ...measured({ aiStatus: "INFERRED", confidence: 0.3, source: { document: "d", evidence: [] } }), duplicateOf: "W1" };
    expect(criticalReasons(it_)).toEqual(["Possible duplicate", "Inferred", "Low confidence", "No evidence"]);
  });
  it("isCritical(it) is exactly criticalReasons(it).length > 0", () => {
    for (const it_ of [measured(), { ...measured(), duplicateOf: "W1" }, measured({ confidence: 0.4 })]) {
      expect(isCritical(it_)).toBe(criticalReasons(it_).length > 0);
    }
  });
});

describe("criticalReasons / priority — conflicting sources (candidates)", () => {
  const withCandidates = (n: number) => ai({
    quantity: null, aiStatus: "PENDING",
    candidates: Array.from({ length: n }, (_, i) => ({ value: i + 1, basis: `source ${i + 1}` })),
  });

  it("names a conflict with its candidate count", () => {
    expect(criticalReasons({ ai: withCandidates(3), reviewStatus: "PENDING_REVIEW" }))
      .toContain("Conflicting sources (3 candidates)");
  });

  it("does not flag a single candidate as a conflict", () => {
    expect(criticalReasons({ ai: withCandidates(1), reviewStatus: "PENDING_REVIEW" }))
      .not.toContain(expect.stringContaining("Conflicting sources"));
  });

  it("does not flag an item with no candidates at all", () => {
    expect(criticalReasons({ ai: ai({ quantity: 5 }), reviewStatus: "PENDING_REVIEW" }))
      .not.toEqual(expect.arrayContaining([expect.stringContaining("Conflicting sources")]));
  });

  it("sorts a conflicting item ahead of a plain pending item, but behind a duplicate", () => {
    const items = buildReviewItems([
      ai({ key: "A", item: "Plain", quantity: null, aiStatus: "PENDING" }),
      ai({ key: "B", item: "Conflict", quantity: null, aiStatus: "PENDING", candidates: [{ value: 1, basis: "x" }, { value: 2, basis: "y" }] }),
      ai({ key: "C", item: "Dup1", location: "Loc" }),
      ai({ key: "D", item: "Dup1", location: "Loc" }), // flagged duplicateOf "Dup1"@"Loc"
    ]);
    const order = orderQueue(items).map((i) => i.ai.key);
    expect(order.indexOf("D")).toBeLessThan(order.indexOf("B")); // duplicate before conflict
    expect(order.indexOf("B")).toBeLessThan(order.indexOf("A")); // conflict before plain pending
  });

  it("combines with other reasons rather than replacing them", () => {
    const it_ = { ai: withCandidates(2), reviewStatus: "PENDING_REVIEW" as const };
    const reasons = criticalReasons(it_);
    expect(reasons).toContain("Conflicting sources (2 candidates)");
    expect(reasons).toContain("Pending — no quantity"); // candidates always leave quantity null
  });
});

describe("filters", () => {
  const base = buildReviewItems([ai({ key: "A" }), ai({ key: "B" })]);
  it("NEEDS_REVIEW excludes reviewed items but keeps them under ALL", () => {
    base[0].reviewStatus = "VERIFIED";
    expect(base.filter((i) => matchesFilter(i, "NEEDS_REVIEW")).map((i) => i.ai.key)).toEqual(["B"]);
    expect(base.filter((i) => matchesFilter(i, "ALL"))).toHaveLength(2);
    expect(base.filter((i) => matchesFilter(i, "VERIFIED")).map((i) => i.ai.key)).toEqual(["A"]);
  });
});

describe("reviewSummary + progress", () => {
  it("counts each status and computes completion %", () => {
    const items = buildReviewItems([ai({ key: "A" }), ai({ key: "B" }), ai({ key: "C" }), ai({ key: "D" })]);
    items[0].reviewStatus = "VERIFIED";
    items[1].reviewStatus = "EDITED";
    items[2].reviewStatus = "MARKED_PENDING";
    const s = reviewSummary(items);
    expect(s).toMatchObject({ total: 4, verified: 1, edited: 1, markedPending: 1, remaining: 1 });
    expect(s.completionPct).toBe(75);
  });
});

describe("AI vs reviewer values are both retained", () => {
  const item: ReviewItem = { ai: ai({ key: "W1", quantity: 3, unit: "nos" }), reviewStatus: "EDITED", reviewer: { quantity: 4 } };
  it("effectiveQuantity uses the reviewer value without erasing the AI value", () => {
    expect(effectiveQuantity(item)).toBe(4);
    expect(item.ai.quantity).toBe(3); // AI value preserved
  });
  it("diffItem exposes the AI→reviewer difference", () => {
    expect(diffItem(item)).toEqual([{ field: "quantity", aiValue: "3", reviewerValue: "4" }]);
  });
  it("quantityDelta shows a signed correction", () => {
    expect(quantityDelta(item)).toBe("+1 correction");
  });
});
