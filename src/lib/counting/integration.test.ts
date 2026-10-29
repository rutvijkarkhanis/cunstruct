// SYNTHETIC INTEGRATION — a counting result taken through the existing
// contracts and review layer, unchanged: parseAnalysisV1 → buildReviewItems
// → classifyReviewItem / buildApplyPlan, and parseObservationsV1 →
// typeInstances → reconcileInstances. Controlled fixtures only; no database,
// no network. The database write (applyReviewPlan) and the export path are
// not exercised here — they are unchanged and covered by their own tests.

import { describe, it, expect } from "vitest";
import { countInstances } from "./engine";
import { scheduleFromAnalysis } from "./normalize";
import { toCountingPayloads } from "./toContracts";
import { groundFloor, SCHEDULE, door, run } from "./__fixtures__/syntheticPlans";
import { parseAnalysisV1, type AnalysisV1 } from "../review/analysisSchemaV1";
import { parseObservationsV1 } from "../review/observationSchemaV1";
import { buildReviewItems } from "../review/reviewQueue";
import { classifyReviewItem, buildApplyPlan, type BoqLineForApply } from "../review/applyReview";
import type { StoredReviewItem } from "../review/reviewStore";
import type { LocationObservation } from "../review/locationObservations";
import { physicalInstancesForType, hasScheduleEntryForType } from "../review/typeInstances";
import { reconcileInstances } from "../review/instanceReconciliation";
import { buildReconciliationInput } from "../review/reconciliationInput";

const SHA = "a".repeat(64);
function run1() {
  const s = groundFloor("doc-ground");
  s.shapes.push(...door(1000, 300)); // one door with no tag near it
  return s;
}

describe("synthetic: counting result → cunstruct.analysis.v1 → review → apply plan", () => {
  const result = countInstances({ sheets: [groundFloor("doc-ground")], schedule: SCHEDULE, expectedSheets: [{ sheetNumber: "A-101" }] });
  const payloads = toCountingPayloads(result, [{ documentId: "doc-ground", name: "ground.pdf", sha256: SHA }]);
  const parsed = parseAnalysisV1(JSON.stringify(payloads.analysis));

  it("parses with the existing importer, tied to the source drawing", () => {
    expect(parsed.ok).toBe(true);
    expect(parsed.analysis!.sourceDrawing).toMatchObject({ sha256: SHA, extractor: expect.stringMatching(/instance-counting/) });
  });

  it("resolved counts arrive MEASURED with their quantity, unit and evidence", () => {
    const d1 = parsed.analysis!.items.find((i) => i.key === "D1")!;
    expect(d1).toMatchObject({ quantity: 2, unit: "nos", aiStatus: "MEASURED", location: "Ground Floor", confidence: null });
    expect(d1.source!.evidence.length).toBe(4); // 2 symbols + 2 tags
    expect(d1.source!.documentId).toBe("doc-ground");
  });

  it("unresolved counts arrive PENDING with a null quantity, never 0", () => {
    const w1 = parsed.analysis!.items.find((i) => i.key === "W1")!;
    expect(w1.quantity).toBeNull();
    expect(w1.aiStatus).toBe("PENDING");
    expect(w1.notes).toMatch(/Unresolved/);
  });

  it("every imported item needs a human decision before Apply", () => {
    const review = buildReviewItems(parsed.analysis!.items);
    const stored: StoredReviewItem[] = review.map((r, i) => ({ ...r, id: `ri-${i}` }));
    expect(stored.every((s) => s.reviewStatus === "PENDING_REVIEW")).toBe(true);
    for (const c of buildApplyPlan(stored, [])) expect(c.classification).toBe("NOT_ELIGIBLE");
  });

  it("a pending count stays pending even when a reviewer verifies it unedited", () => {
    const w1 = parsed.analysis!.items.find((i) => i.key === "W1")!;
    const item: StoredReviewItem = { id: "w1", ai: w1, reviewStatus: "VERIFIED" };
    const c = classifyReviewItem(item, []);
    expect(c.classification).toBe("NEW_LINE");
    expect(c.newLine).toMatchObject({ pending: true });
    // Against an existing measured line: Apply proposes "pending", never a number.
    const line: BoqLineForApply = { id: "l1", external_key: "W1", qty: 4, unit: "nos", quantity_status: "MEASURED", scope_name: null };
    const m = classifyReviewItem(item, [line]);
    expect(m.changes.find((x) => x.field === "qty")).toEqual({ field: "qty", from: "4", to: "pending" });
  });
});

describe("synthetic: conflicting values stay conflicting through the importer", () => {
  it("a schedule-count conflict becomes a CHECK item whose candidates force PENDING", () => {
    const sched = SCHEDULE.map((e) => (e.mark === "D1" ? { ...e, scheduledQuantity: 5, unit: "nos" } : e));
    const result = countInstances({ sheets: [groundFloor()], schedule: sched, expectedSheets: [{ sheetNumber: "A-101" }] });
    const parsed = parseAnalysisV1(JSON.stringify(toCountingPayloads(result).analysis));
    const check = parsed.analysis!.items.find((i) => i.key === "CHECK:count:D1")!;
    expect(check.quantity).toBeNull();
    expect(check.aiStatus).toBe("PENDING");
    expect(check.candidates!.map((c) => c.value)).toEqual([2, 5]);
    expect(parsed.analysis!.items.find((i) => i.key === "D1")!.quantity).toBeNull();
  });

  it("two different plans for one floor arrive with both counts as candidates", () => {
    const b = groundFloor("doc-b");
    b.shapes.push(...door(1000, 300));
    b.runs.push(run("D1", 1010, 260));
    const result = countInstances({ sheets: [groundFloor("doc-a"), b], schedule: SCHEDULE });
    const parsed = parseAnalysisV1(JSON.stringify(toCountingPayloads(result).analysis));
    const d1 = parsed.analysis!.items.find((i) => i.key === "D1")!;
    expect(d1.quantity).toBeNull();
    expect(d1.aiStatus).toBe("PENDING");
    expect(d1.candidates!.map((c) => c.value)).toEqual([2, 3]);
    expect(parsed.analysis!.sourceDrawing).toBeUndefined(); // two documents: not tied to one file
  });

  it("an untagged door becomes its own pending item", () => {
    const result = countInstances({ sheets: [run1()], schedule: SCHEDULE });
    const parsed = parseAnalysisV1(JSON.stringify(toCountingPayloads(result).analysis));
    const u = parsed.analysis!.items.find((i) => i.key.startsWith("UNTAGGED:door"))!;
    expect(u).toMatchObject({ quantity: null, aiStatus: "PENDING" });
  });
});

describe("synthetic: observations → existing instance reconciliation", () => {
  const result = countInstances({ sheets: [groundFloor()], schedule: SCHEDULE, expectedSheets: [{ sheetNumber: "A-101" }] });
  const payloads = toCountingPayloads(result);
  const obs = parseObservationsV1(JSON.stringify(payloads.observations));
  const located: LocationObservation[] = obs.observations!.map((o, i) => ({
    id: `obs-${i}`, observationType: o.observationType, mark: o.mark ?? null, scopeHint: o.scopeHint ?? null,
    locationText: o.locationText ?? null, attributes: o.attributes, evidence: o.source, evidenceCompleteness: o.evidenceCompleteness,
    createdAt: "2026-10-29T00:00:00Z",
  }));

  it("parses with the existing observation parser; nothing is dropped", () => {
    expect(obs.ok).toBe(true);
    expect(obs.diagnostics!.rejected).toEqual([]);
  });

  it("per-occurrence observations give the same count the engine gives", () => {
    expect(physicalInstancesForType({ key: "D1" }, located)).toHaveLength(2);
    expect(hasScheduleEntryForType({ key: "D1" }, located)).toBe(true);
  });

  it("GREEN only for the resolved, schedule-backed count; pending stays RED", () => {
    const analysis = parseAnalysisV1(JSON.stringify(payloads.analysis)).analysis!;
    const status = (key: string) => {
      const item: StoredReviewItem = { id: key, ai: analysis.items.find((i) => i.key === key)!, reviewStatus: "PENDING_REVIEW" };
      return reconcileInstances(buildReconciliationInput(item, located, true));
    };
    expect(status("D1")).toBe("GREEN");
    expect(status("W1")).toBe("RED"); // no quantity: unevaluable, never green
  });
});

describe("synthetic: schedule entries from a cunstruct.analysis.v1 schedule payload (PR #230 shape)", () => {
  const schedulePayload: AnalysisV1 = parseAnalysisV1(JSON.stringify({
    schema_version: "cunstruct.analysis.v1",
    items: [
      { key: "D1", item: "Door D1", quantity: 2, unit: "nr", status: "MEASURED", dimension: "900 x 2100 mm" },
      { key: "W1", item: "Window W1 opening area", quantity: 1.44, unit: "m2", status: "MEASURED", dimension: "1200 x 1200 mm" },
      { key: "CHECK:SCHEDULE:QTY", item: "Total mismatch", quantity: null, status: "PENDING" },
      { key: "SCHED:LEGEND", item: "Legend", quantity: null, status: "PENDING" },
    ],
  })).analysis!;

  it("keeps a count only from a count unit; an area is never a count", () => {
    const entries = scheduleFromAnalysis(schedulePayload);
    expect(entries.map((e) => [e.mark, e.scheduledQuantity, e.category])).toEqual([["D1", 2, "door"], ["W1", null, "window"]]);
  });

  it("feeds the engine directly", () => {
    const r = countInstances({ sheets: [groundFloor()], schedule: scheduleFromAnalysis(schedulePayload), expectedSheets: [{ sheetNumber: "A-101" }] });
    expect(r.markTotals.find((m) => m.mark === "D1")).toMatchObject({ comparison: "agree", drawingTotal: 2, scheduledQuantity: 2 });
    expect(r.instances.find((i) => i.proposedType === "D2")!.interpretation.schedule.status).toBe("no_entry");
  });
});
