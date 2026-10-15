// End-to-end BOQ harness: is the SCORER right? A perfect run must score
// perfectly, and each injected fault must show up as exactly its own kind of
// error. The reference below is SYNTHETIC — written for these tests only, it
// is not a benchmark and says nothing about any real drawing.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", async () => await import("./inMemorySupabase"));

import { runEndToEnd, parseCsv, type RunOptions } from "./pipeline";
import { scoreEndToEnd, normalizeItemName, NO_REFERENCE, type EndToEndReport } from "./boqEndToEndScorer";
import { validateReferenceBoq, defaultTolerance, allowedDifference, convertQuantity, REFERENCE_BOQ_SCHEMA, type ReferenceBoq } from "./boqReference";
import { simulatedDecision } from "./reviewPolicy";
import { buildDrawingInventory } from "@/lib/review/drawingInventory";
import { reconcileRoomDimensions } from "@/lib/review/roomDimensionReconciliation";
import { measuredQuantitiesFor, toAnalysisPayload } from "@/lib/review/measuredQuantities";
import { syntheticPlanText } from "@/lib/review/__fixtures__/syntheticPlanText";
import { queriesIssued } from "./inMemorySupabase";

const DOC = "doc-synthetic";
const DOC_NAME = "Synthetic plan";
const SHA = "a".repeat(64);

const SYNTHETIC_REFERENCE: ReferenceBoq = {
  schema_version: REFERENCE_BOQ_SCHEMA,
  project: "Synthetic harness test (not a real project)",
  drawing: { sha256: SHA, pages: [1, 2] },
  preparedBy: "harness test fixture",
  preparedAt: "2026-10-13",
  preparedWithoutCunstructOutput: true,
  measurementConventions: "Gross floor area from printed room size.",
  lines: [
    { id: "R1", item: "Floor area — Kitchen", unit: "sqm", quantity: 12.5, floor: "First Floor", measurementRule: "gross" },
    { id: "R2", item: "Floor area — Bedroom", aliases: ["Floor area — Bed Room"], unit: "sqm", quantity: 14, floor: "First Floor", measurementRule: "gross" },
    { id: "R3", item: "Floor area — Lift", unit: "sqm", quantity: 4.23, floor: "Second Floor", measurementRule: "gross" },
  ],
};
const loaded = validateReferenceBoq(SYNTHETIC_REFERENCE, SHA);

type Item = { key: string; name: string; qty: number | null; floor: string; page: number; evidence?: boolean; unit?: string };
const PERFECT: Item[] = [
  { key: "k1", name: "Kitchen", qty: 12.5, floor: "First Floor", page: 1 },
  { key: "k2", name: "Bed Room", qty: 14, floor: "First Floor", page: 1 },
  { key: "k3", name: "Lift", qty: 4.23, floor: "Second Floor", page: 2 },
];
const payload = (items: Item[]) => JSON.stringify({
  schema_version: "cunstruct.analysis.v1",
  items: items.map((i) => ({
    key: i.key, item: `Floor area — ${i.name} (${i.floor})`, quantity: i.qty, unit: i.unit ?? "sqm", location: i.floor,
    status: i.qty == null ? "PENDING" : "MEASURED", confidence: null,
    source: { document_id: DOC, page: i.page, evidence: i.evidence === false ? [] : [{ bbox: [10, 10, 40, 20], page: i.page }] },
  })),
});

async function score(items: Item[], extra: Partial<RunOptions> = {}): Promise<EndToEndReport> {
  const run = await runEndToEnd({ analysisJson: payload(items), documentId: DOC, documentName: DOC_NAME, policy: "accept-evidenced-measurements", ...extra });
  return scoreEndToEnd(run, loaded, DOC_NAME);
}

/** Every kind of error the report can show, in one place. */
const errors = (r: EndToEndReport) => ({
  missed: r.accuracy!.scope.missed,
  quantityIncorrect: r.accuracy!.quantities.incorrect,
  floorWrong: r.accuracy!.identity.floor.wrong.length,
  falsePositivesInBoq: r.accuracy!.falsePositives.inBoq,
  falsePositivesHeld: r.accuracy!.falsePositives.heldOnly,
  integrity: r.integrity.violationCount,
  unsupported: r.unsupportedMeasurements.unsupported.length,
});
const NONE = { missed: 0, quantityIncorrect: 0, floorWrong: 0, falsePositivesInBoq: 0, falsePositivesHeld: 0, integrity: 0, unsupported: 0 };

describe("reference handling", () => {
  it("the synthetic reference is accepted; it names its preparer and drawing", () => {
    expect(loaded.status).toBe("loaded");
  });

  it("no reference: accuracy is not computed, never zero", async () => {
    const run = await runEndToEnd({ analysisJson: payload(PERFECT), documentId: DOC, documentName: DOC_NAME, policy: "accept-evidenced-measurements" });
    const r = scoreEndToEnd(run, validateReferenceBoq(undefined, SHA), DOC_NAME);
    expect(r.reference).toEqual({ status: "absent", message: NO_REFERENCE });
    expect(r.accuracy).toBeNull();
    expect(r.notComputable[0]).toContain("no accepted reference BOQ");
    expect(r.integrity.violationCount).toBe(0); // still reported: it needs no reference
  });

  it("a reference for another drawing, or one not declared independent, is rejected", () => {
    const wrongDrawing = validateReferenceBoq({ ...SYNTHETIC_REFERENCE, drawing: { sha256: "b".repeat(64), pages: [1] } }, SHA);
    expect(wrongDrawing.status).toBe("invalid");
    const notIndependent = validateReferenceBoq({ ...SYNTHETIC_REFERENCE, preparedWithoutCunstructOutput: false }, SHA);
    expect(notIndependent).toMatchObject({ status: "invalid", errors: [expect.stringContaining("independent")] });
    const noLines = validateReferenceBoq({ ...SYNTHETIC_REFERENCE, lines: [] }, SHA);
    expect(noLines.status).toBe("invalid");
  });
});

describe("perfect-run control", () => {
  it("scores 100% on every applicable metric, with no errors of any kind", async () => {
    const r = await score(PERFECT);
    expect(errors(r)).toEqual(NONE);
    expect(r.accuracy!.scope).toMatchObject({ found: 3, of: 3 });
    expect(r.accuracy!.quantities).toMatchObject({ correct: 3, of: 3 });
    expect(r.accuracy!.identity.item).toEqual({ n: 3, of: 3 });
    expect(r.accuracy!.identity.floor).toMatchObject({ n: 3, of: 3 });
    expect(r.accuracy!.held.total).toBe(0);
    expect(r.integrity.appliedItems).toBe(3);
    expect(r.pipeline.exportedRows).toBe(3);
  });

  it("is labelled as simulated review, never as human review", async () => {
    const r = await score(PERFECT);
    expect(r.harness.review).toBe("SIMULATED");
    expect(r.harness.notes[0]).toContain("No human reviewed");
  });

  it("states what the export cannot carry instead of counting it as correct, and what 'PDF' covers", async () => {
    const r = await score(PERFECT);
    expect(r.integrity.notCarried.floorInExport).toEqual({ n: 0, of: 3 });
    expect(r.integrity.pdfScope).toContain("not exercised");
  });

  it("every export is checked against the saved lines, all four present and complete", async () => {
    const r = await score(PERFECT);
    expect(r.integrity.exports.map((x) => [x.path, x.expected, x.found, x.refused])).toEqual(
      (["live CSV", "live PDF", "revision CSV", "revision PDF"] as const).map((p) => [p, { measured: 3, pending: 0 }, { measured: 3, pending: 0 }, false]),
    );
  });
});

describe("injected faults — each shows up as its own error only", () => {
  it("a dropped item is a scope miss", async () => {
    const r = await score(PERFECT.filter((i) => i.key !== "k2"));
    expect(errors(r)).toEqual({ ...NONE, missed: 1 });
    expect(r.accuracy!.scope.missedIds).toEqual(["R2"]);
  });

  it("a quantity outside tolerance is a quantity error; one inside it is not", async () => {
    const outside = await score(PERFECT.map((i) => (i.key === "k1" ? { ...i, qty: 13 } : i))); // 4% over
    expect(errors(outside)).toEqual({ ...NONE, quantityIncorrect: 1 });
    expect(outside.accuracy!.quantities.incorrectDetails[0]).toMatchObject({ referenceId: "R1", expected: 12.5, actual: 13 });
    const inside = await score(PERFECT.map((i) => (i.key === "k1" ? { ...i, qty: 12.6 } : i))); // 0.8%
    expect(errors(inside)).toEqual(NONE);
  });

  it("a wrong floor is an identity error, not a miss or a quantity error", async () => {
    const r = await score(PERFECT.map((i) => (i.key === "k1" ? { ...i, floor: "Second Floor" } : i)));
    expect(errors(r)).toEqual({ ...NONE, floorWrong: 1 });
    expect(r.accuracy!.identity.floor.wrong).toEqual([{ referenceId: "R1", expected: "First Floor", actual: "Second Floor" }]);
  });

  it("an extra item is a false positive in the BOQ", async () => {
    const r = await score([...PERFECT, { key: "k9", name: "Gym", qty: 20, floor: "First Floor", page: 1 }]);
    expect(errors(r)).toEqual({ ...NONE, falsePositivesInBoq: 1 });
  });

  it("a pending line in the BOQ is exported as pending in all four exports — held, not a quantity, not a violation", async () => {
    const r = await score(PERFECT.map((i) => (i.key === "k2" ? { ...i, qty: null } : i)), { policy: "accept-everything" });
    expect(errors(r)).toEqual(NONE);
    expect(r.integrity.exports.map((x) => [x.path, x.found])).toEqual([
      ["live CSV", { measured: 2, pending: 1 }], ["live PDF", { measured: 2, pending: 1 }],
      ["revision CSV", { measured: 2, pending: 1 }], ["revision PDF", { measured: 2, pending: 1 }],
    ]);
    expect(r.accuracy!.held).toMatchObject({ total: 1, pendingInBoq: 1, noProposedQuantity: 1 });
    expect(r.accuracy!.quantities).toMatchObject({ correct: 2, of: 2 });
  });

  const PENDING_K2 = PERFECT.map((i) => (i.key === "k2" ? { ...i, qty: null } : i));
  const tampered = (tamper: RunOptions["tamper"]) => score(PENDING_K2, { policy: "accept-everything", tamper });
  const livePdf = (r: EndToEndReport) => r.integrity.exports.find((x) => x.path === "live PDF")!;
  const liveCsv = (r: EndToEndReport) => r.integrity.exports.find((x) => x.path === "live CSV")!;

  it("a pending line shown as a measured 0 is caught", async () => {
    const r = await tampered({
      pdfPayload: (p) => ({
        ...p, pendingItems: [],
        subheads: [...p.subheads, { no: 9, name: "x", subtotal: 0, lines: (p.pendingItems ?? []).map((x) => ({ no: "9.01", code: null, spec: x.spec, qty: 0, unit: x.unit, rate: null, amount: null, sourceDocument: x.sourceDocument, sourcePage: x.sourcePage })) }],
      }),
    });
    expect(errors(r)).toEqual({ ...NONE, integrity: 1 });
    expect(livePdf(r).pendingAsZero).toEqual(["Floor area — Bed Room (First Floor)"]);
    expect(r.integrity.pendingExportedAsZero).toBe(1);
  });

  it("a pending line silently dropped from the PDF is caught", async () => {
    const r = await tampered({ pdfPayload: (p) => ({ ...p, pendingItems: [] }) });
    expect(errors(r)).toEqual({ ...NONE, integrity: 1 });
    expect(livePdf(r).dropped).toEqual(["Floor area — Bed Room (First Floor)"]);
  });

  it("a duplicated row, a changed unit and a changed quantity are each caught", async () => {
    const dup = await tampered({ csv: (csv) => { const rows = csv.split("\r\n"); rows.splice(5, 0, rows[4]); return rows.join("\r\n"); } });
    expect(errors(dup)).toEqual({ ...NONE, integrity: 1 });
    expect(liveCsv(dup).duplicatedOrExtra).toHaveLength(1);
    const unit = await tampered({ csv: (csv) => csv.replace(/,sqm,12\.5,/, ",sqft,12.5,") });
    expect(errors(unit)).toEqual({ ...NONE, integrity: 1 });
    expect(liveCsv(unit).valueChanged[0]).toContain("expected measured 12.5 sqm");
    const qty = await tampered({ csv: (csv) => csv.replace(/,12\.5,/, ",15,") });
    expect(errors(qty)).toEqual({ ...NONE, integrity: 1 });
    expect(liveCsv(qty).valueChanged[0]).toContain("found measured 15 sqm");
  });

  it("a measured row dropped from the CSV is caught", async () => {
    const r = await tampered({ csv: (csv) => csv.split("\r\n").filter((row) => !row.includes("Kitchen")).join("\r\n") });
    expect(errors(r)).toEqual({ ...NONE, integrity: 1 });
    expect(liveCsv(r).dropped).toEqual(["Floor area — Kitchen (First Floor)"]);
  });

  it("a persisted value that differs from the accepted one is caught", async () => {
    const r = await score(PERFECT, { tamper: { persistedLines: (ls) => ls.map((l) => (l.qty === 14 ? { ...l, qty: 41 } : l)) } });
    expect(r.integrity.persistence.persistedValueChanged).toHaveLength(1);
  });
});

describe("held items", () => {
  it("separates held-and-unmeasured, held-but-would-be-wrong and held-but-would-be-right", async () => {
    const r = await score([
      { ...PERFECT[0], qty: null },                    // no quantity → held, unmeasured
      { ...PERFECT[1], qty: 20, evidence: false },     // wrong, no evidence → held (correctly)
      { ...PERFECT[2], evidence: false },              // right, no evidence → held although right
    ]);
    expect(r.accuracy!.held).toEqual({
      total: 3, inReviewOrNotApplied: 3, pendingInBoq: 0, noProposedQuantity: 1, proposedWouldBeWrong: 1, proposedWouldBeRight: 1,
    });
    expect(r.accuracy!.quantities.of).toBe(0);
    expect(errors(r)).toEqual(NONE);
  });

  it("the simulated policy holds an unevidenced measurement and gives its rule", async () => {
    const run = await runEndToEnd({ analysisJson: payload([{ ...PERFECT[0], evidence: false }]), documentId: DOC, documentName: DOC_NAME, policy: "accept-evidenced-measurements" });
    expect(run.reviewItems[0].decision).toEqual({ kind: "SIMULATED", policy: "accept-evidenced-measurements", status: "PENDING_REVIEW", rule: "Held: no evidence box." });
    expect(simulatedDecision(run.reviewItems[0].review, "accept-everything").status).toBe("VERIFIED");
  });
});

describe("the simulated reviewer sees what production shows after save and reload", () => {
  it("the review queue's duplicate flag is recorded but not shown: two same-name rooms are both reviewed on their merits", async () => {
    const twoRooms: Item[] = [
      { key: "w1", name: "W.R", qty: 6.06, floor: "First Floor", page: 1 },
      { key: "w2", name: "W.R", qty: 4.34, floor: "First Floor", page: 1 },
    ];
    const run = await runEndToEnd({ analysisJson: payload(twoRooms), documentId: DOC, documentName: DOC_NAME, policy: "accept-evidenced-measurements" });
    expect(run.reviewItems.map((r) => [r.queueDuplicateOf ?? null, "duplicateOf" in r.review, r.decision.status])).toEqual([
      [null, false, "VERIFIED"],
      ["w1", false, "VERIFIED"], // production never saves the flag, so no reviewer sees it
    ]);
    expect(run.persistedLines).toHaveLength(2);
  });
});

describe("matching, units and tolerances", () => {
  it("names compare without case, punctuation or the floor in brackets", () => {
    expect(normalizeItemName("Floor area — KITCHEN (First Floor)")).toBe(normalizeItemName("Floor area - Kitchen"));
  });

  it("default tolerances: counts exact, areas 1% or 0.05 m², lengths 1%", () => {
    expect(defaultTolerance("nos")).toEqual({ abs: 0 });
    expect(allowedDifference({ quantity: 2, unit: "sqm" })).toBeCloseTo(0.05, 6);
    expect(allowedDifference({ quantity: 100, unit: "sqm" })).toBeCloseTo(1, 6);
    expect(allowedDifference({ quantity: 50, unit: "rmt" })).toBeCloseTo(0.5, 6);
    expect(allowedDifference({ quantity: 10, unit: "sqm", tolerance: { abs: 0 } })).toBeCloseTo(0, 6);
  });

  it("sqm and sqft are compared after exact conversion; unrelated units never match", async () => {
    expect(convertQuantity(1, "sqm", "sqft")).toBeCloseTo(10.7639104, 6);
    expect(convertQuantity(1, "sqm", "nos")).toBeNull();
    const sqftRef = validateReferenceBoq({ ...SYNTHETIC_REFERENCE, lines: [{ ...SYNTHETIC_REFERENCE.lines[0], unit: "sqft", quantity: 134.55 }] }, SHA);
    const run = await runEndToEnd({ analysisJson: payload([PERFECT[0]]), documentId: DOC, documentName: DOC_NAME, policy: "accept-evidenced-measurements" });
    expect(scoreEndToEnd(run, sqftRef, DOC_NAME).accuracy!.quantities).toMatchObject({ correct: 1, of: 1 });
  });
});

describe("the CSV reader", () => {
  it("reads quoted cells and doubled quotes", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\nd')).toEqual([["a", "b, c", 'say "hi"'], ["d"]]);
  });
});

describe("the drawing engine's output through the same pipeline (no reference present)", () => {
  // Invented plan text → inventory → reconciliation → measured quantities →
  // the analysis payload DrawingCoveragePanel copies: the path a real drawing takes.
  const engineJson = () => JSON.stringify(toAnalysisPayload(measuredQuantitiesFor(
    reconcileRoomDimensions(buildDrawingInventory(syntheticPlanText(DOC))).rooms)));

  it("parses, applies and exports; the 10 ready areas persist as measured, the 2 unsized spaces are held for review; accuracy is not computed", async () => {
    const run = await runEndToEnd({ analysisJson: engineJson(), documentId: DOC, documentName: DOC_NAME, policy: "accept-evidenced-measurements" });
    const report = scoreEndToEnd(run, validateReferenceBoq(undefined, SHA), DOC_NAME);
    expect(run.parse.ok).toBe(true);
    expect(report.reference.message).toBe(NO_REFERENCE);
    expect(report.accuracy).toBeNull();
    expect(report.pipeline.persistedLines).toMatchObject({ measured: 10, pending: 0 });
    expect(run.reviewItems).toHaveLength(12);
    expect(report.pipeline.exportedRows).toBe(report.pipeline.persistedLines.measured + report.pipeline.persistedLines.pending);
    expect(new Set(queriesIssued().map((q) => q.split(" ")[1]))).toEqual(new Set(["boq", "project_scope", "project_document", "document_revision", "boq_line", "boq_line_change_log"]));
  });

  it("repeated labels on one floor stay separate lines through Apply", async () => {
    const run = await runEndToEnd({ analysisJson: engineJson(), documentId: DOC, documentName: DOC_NAME, policy: "accept-everything" });
    expect(run.applyResult!.conflictedReviewItemIds).toEqual([]);
    expect(new Set(run.reviewItems.map((r) => r.review.ai.key)).size).toBe(run.reviewItems.length);
  });
});
