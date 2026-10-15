// Reference-backed evaluation: synthetic controls for the matcher and the
// reference format. The reference here is SYNTHETIC — written for these tests
// only; it is not a benchmark and says nothing about any real drawing.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", async () => await import("./inMemorySupabase"));

import { runEndToEnd } from "./pipeline";
import { scoreEndToEnd, NO_REFERENCE, type EndToEndReport } from "./boqEndToEndScorer";
import { validateReferenceBoq, REFERENCE_BOQ_SCHEMA, type ReferenceBoq, type ReferenceBoqLine } from "./boqReference";
import { matchReference, locate, placement } from "./referenceMatching";

const DOC = "doc-synthetic";
const SHA = "c".repeat(64);
const PAGE = { width: 595, height: 842 };
const box = (x: number, y: number): [number, number, number, number] => [x, y, x + 30, y + 8];
const ev = (x: number, y: number, page = 1) => ({ page, bbox: box(x, y), pageSize: PAGE });

// Three W.R on the First Floor at different places, a Kitchen (no location),
// and one line of each non-measured kind.
const LINES: ReferenceBoqLine[] = [
  { id: "WR-A", item: "Floor area — W.R", unit: "sqm", quantity: 6.06, floor: "First Floor", evidence: ev(100, 100), sourcePage: 1, measurementRule: "gross" },
  { id: "WR-B", item: "Floor area — W.R", unit: "sqm", quantity: 4.34, floor: "First Floor", evidence: ev(300, 100), sourcePage: 1, measurementRule: "gross" },
  { id: "WR-C", item: "Floor area — W.R", unit: "sqm", quantity: 6.77, floor: "First Floor", evidence: ev(300, 500), sourcePage: 1, measurementRule: "gross" },
  { id: "KIT", item: "Floor area — Kitchen", unit: "sqm", quantity: 20.6, floor: "Second Floor", sourcePage: 2, measurementRule: "gross" },
  { id: "COR", status: "unmeasurable", item: "Floor area — Corridor", unit: "sqm", floor: "First Floor", evidence: ev(200, 300), measurementRule: "gross", note: "No size printed for the corridor." },
  { id: "BAL", status: "ambiguous", item: "Floor area — Balcony", unit: "sqm", floor: "Second Floor", evidence: ev(400, 150, 2), measurementRule: "gross", note: "Size text illegible." },
  { id: "PLA", status: "out_of_scope", item: "Plastering", unit: "sqm", floor: null, measurementRule: "needs wall heights", note: "Needs sections; not in the agreed sheets." },
];
const REFERENCE: ReferenceBoq = {
  schema_version: REFERENCE_BOQ_SCHEMA, project: "Synthetic evaluation control (not a real project)",
  drawing: { sha256: SHA, pages: [1, 2] }, preparedBy: "test fixture", preparedAt: "2026-10-13",
  preparedWithoutCunstructOutput: true, measurementConventions: "Gross areas from printed sizes.", lines: LINES,
};
const loaded = validateReferenceBoq(REFERENCE, SHA);

type Sys = { key: string; name: string; qty: number | null; floor: string; page: number; at?: [number, number] | null; unit?: string; item?: string };
const PERFECT: Sys[] = [
  { key: "a", name: "W.R", qty: 6.06, floor: "First Floor", page: 1, at: [100, 100] },
  { key: "b", name: "W.R", qty: 4.34, floor: "First Floor", page: 1, at: [300, 100] },
  { key: "c", name: "W.R", qty: 6.77, floor: "First Floor", page: 1, at: [300, 500] },
  { key: "k", name: "Kitchen", qty: 20.6, floor: "Second Floor", page: 2, at: [50, 60] },
  { key: "corr", name: "Corridor", qty: null, floor: "First Floor", page: 1, at: [200, 300] },
];
const payload = (items: Sys[]) => JSON.stringify({
  schema_version: "cunstruct.analysis.v1",
  items: items.map((i) => ({
    key: i.key, item: i.item ?? `Floor area — ${i.name} (${i.floor})`, quantity: i.qty, unit: i.unit ?? "sqm", location: i.floor,
    status: i.qty == null ? "PENDING" : "MEASURED", confidence: null,
    source: { document_id: DOC, page: i.page, evidence: i.at ? [{ bbox: box(...i.at), page: i.page }] : [] },
  })),
});
async function evaluate(items: Sys[], reference = loaded): Promise<EndToEndReport> {
  // accept-everything so every item reaches the BOQ; these controls test matching, not review.
  const run = await runEndToEnd({ analysisJson: payload(items), documentId: DOC, documentName: "Synthetic", policy: "accept-everything" });
  return scoreEndToEnd(run, reference, "Synthetic", { drawingPageSizes: { 1: PAGE, 2: PAGE } });
}
const errors = (r: EndToEndReport) => {
  const a = r.accuracy!;
  return {
    missed: a.scope.missed, ambiguous: a.scope.ambiguous, quantityIncorrect: a.quantities.incorrect, floorWrong: a.identity.floor.wrong.length,
    falsePositives: a.falsePositives.inBoq + a.falsePositives.heldOnly, duplicate: a.unmatched.duplicate.length,
    locationDisagrees: a.unmatched.locationDisagrees.length, unmatchedAmbiguous: a.unmatched.ambiguous.length,
    measuredAnyway: a.nonMeasurable.measuredAnyway.length,
  };
};
const NONE = { missed: 0, ambiguous: 0, quantityIncorrect: 0, floorWrong: 0, falsePositives: 0, duplicate: 0, locationDisagrees: 0, unmatchedAmbiguous: 0, measuredAnyway: 0 };

describe("control: a perfect, located run", () => {
  it("every measured line is found at its own location, with its own quantity", async () => {
    const r = await evaluate(PERFECT);
    expect(errors(r)).toEqual(NONE);
    expect(r.accuracy!.scope).toMatchObject({ found: 4, of: 4 });
    expect(r.accuracy!.quantities).toMatchObject({ correct: 4, of: 4 });
    // W.R ×3 and the corridor pair by location; the Kitchen line has no evidence, and its name is unique.
    expect(r.accuracy!.pairing).toMatchObject({ byLocation: 4, byUniqueName: 1 });
    expect(r.accuracy!.matches.filter((m) => m.status === "measured").map((m) => [m.referenceId, m.method])).toEqual([
      ["WR-A", "location"], ["WR-B", "location"], ["WR-C", "location"], ["KIT", "unique_name"],
    ]);
  });

  it("non-measurable and out-of-scope lines are kept apart from scope and quantity scoring", async () => {
    const r = await evaluate(PERFECT);
    expect(r.accuracy!.scope.of).toBe(4); // only measured lines
    expect(r.accuracy!.nonMeasurable).toEqual({ lines: 2, identified: 1, heldForReview: 1, ambiguous: 0, notIdentified: 1, measuredAnyway: [] });
    expect(r.accuracy!.outOfScope).toEqual({ lines: 1, producedBySystem: [] });
    expect(r.accuracy!.quantities.of).toBe(4); // no quantity scored for COR/BAL/PLA
  });

  it("states that floor came from the stored BOQ line, and that zone scope is not scored", async () => {
    const r = await evaluate(PERFECT);
    expect(r.accuracy!.identity.floor).toMatchObject({ n: 4, of: 4, sources: { boqLineScope: 4, analysisLocation: 0 } });
    expect(r.accuracy!.identity.scope).toMatchObject({ scored: false, referenceLinesWithScope: 0 });
  });
});

describe("controls: each fault is its own error", () => {
  it("a dropped room is a miss of that specific room", async () => {
    const r = await evaluate(PERFECT.filter((s) => s.key !== "b"));
    expect(errors(r)).toEqual({ ...NONE, missed: 1 });
    expect(r.accuracy!.scope.missedIds).toEqual(["WR-B"]);
  });

  it("swapped quantities between two same-name rooms are two quantity errors — never credited for being similar", async () => {
    const swapped = PERFECT.map((s) => (s.key === "a" ? { ...s, qty: 4.34 } : s.key === "b" ? { ...s, qty: 6.06 } : s));
    const r = await evaluate(swapped);
    expect(errors(r)).toEqual({ ...NONE, quantityIncorrect: 2 });
    expect(r.accuracy!.quantities.incorrectDetails.map((d) => [d.referenceId, d.expected, d.actual])).toEqual([["WR-A", 6.06, 4.34], ["WR-B", 4.34, 6.06]]);
  });

  it("a wrong floor at the right place is a floor error, not a miss", async () => {
    const r = await evaluate(PERFECT.map((s) => (s.key === "c" ? { ...s, floor: "Second Floor" } : s)));
    expect(errors(r)).toEqual({ ...NONE, floorWrong: 1 });
    expect(r.accuracy!.identity.floor.wrong).toEqual([{ referenceId: "WR-C", expected: "First Floor", actual: "Second Floor" }]);
  });

  it("a duplicate of a room at the same place is reported as a duplicate, not a second find", async () => {
    const r = await evaluate([...PERFECT, { key: "a2", name: "W.R", qty: 6.06, floor: "First Floor", page: 1, at: [102, 101] }]);
    expect(errors(r)).toEqual({ ...NONE, duplicate: 1 });
    expect(r.accuracy!.scope.found).toBe(4);
  });

  it("a room reported where no such room is: location disagrees, and the real one is missed", async () => {
    const r = await evaluate(PERFECT.map((s) => (s.key === "c" ? { ...s, at: [50, 700] as [number, number] } : s)));
    expect(errors(r)).toEqual({ ...NONE, missed: 1, locationDisagrees: 1 });
    expect(r.accuracy!.scope.missedIds).toEqual(["WR-C"]);
  });

  it("repeated rooms with no location are ambiguous — not credited, and no quantity is scored for them", async () => {
    const r = await evaluate(PERFECT.map((s) => (s.name === "W.R" ? { ...s, at: null } : s)));
    expect(errors(r)).toEqual({ ...NONE, ambiguous: 3, unmatchedAmbiguous: 3 });
    expect(r.accuracy!.scope).toMatchObject({ found: 1, of: 4, ambiguousIds: ["WR-A", "WR-B", "WR-C"] });
    expect(r.accuracy!.quantities.of).toBe(1);
  });

  it("an extra item with no reference line is a false positive", async () => {
    const r = await evaluate([...PERFECT, { key: "g", name: "Gym", qty: 12, floor: "First Floor", page: 1, at: [500, 700] }]);
    expect(errors(r)).toEqual({ ...NONE, falsePositives: 1 });
  });

  it("a number put in the BOQ for an item the reference says cannot be measured is reported", async () => {
    const r = await evaluate(PERFECT.map((s) => (s.key === "corr" ? { ...s, qty: 9.5 } : s)));
    expect(errors(r)).toEqual({ ...NONE, measuredAnyway: 1 });
    expect(r.accuracy!.nonMeasurable.measuredAnyway).toEqual(["COR"]);
  });

  it("an item for an out-of-scope line is reported as such — not a false positive, not scope", async () => {
    const r = await evaluate([...PERFECT, { key: "p", name: "Plastering", item: "Plastering", qty: 300, floor: "First Floor", page: 1, at: null }]);
    expect(r.accuracy!.outOfScope.producedBySystem).toEqual(["PLA"]);
    expect(errors(r)).toEqual(NONE);
  });
});

describe("reference validation", () => {
  const withLine = (patch: Partial<ReferenceBoqLine>, i = 0) => ({ ...REFERENCE, lines: REFERENCE.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const errorsOf = (raw: unknown) => {
    const v = validateReferenceBoq(raw, SHA);
    return v.status === "invalid" ? v.errors : [];
  };

  it("accepts the synthetic reference, with measured and non-measured lines", () => {
    expect(loaded.status).toBe("loaded");
  });

  it("rejects a malformed or mismatched checksum, and a missing independence declaration", () => {
    expect(errorsOf({ ...REFERENCE, drawing: { sha256: "abc", pages: [1, 2] } })).toEqual([expect.stringContaining("64-character")]);
    expect(errorsOf({ ...REFERENCE, drawing: { sha256: "d".repeat(64), pages: [1, 2] } })).toEqual([expect.stringContaining("not the analysed drawing")]);
    expect(errorsOf({ ...REFERENCE, preparedWithoutCunstructOutput: false })).toEqual([expect.stringContaining("independent")]);
    expect(errorsOf({ ...REFERENCE, preparedBy: "" })).toEqual(["preparedBy is required."]);
  });

  it("a measured line needs a quantity; any other line must have none, and must say why", () => {
    expect(errorsOf(withLine({ quantity: null }))).toEqual([expect.stringContaining("quantity must be a non-negative number for a measured line")]);
    expect(errorsOf(withLine({ quantity: 3 }, 4))).toEqual([expect.stringContaining("must be absent for a unmeasurable line")]);
    expect(errorsOf(withLine({ note: "" }, 5))).toEqual([expect.stringContaining("note must say why")]);
    expect(errorsOf(withLine({ status: "guess" as never }))).toEqual([expect.stringContaining("status must be one of")]);
  });

  it("evidence must be on a covered page, a real box, and agree with sourcePage", () => {
    expect(errorsOf(withLine({ evidence: { ...ev(1, 1), page: 3 }, sourcePage: null }))).toEqual([expect.stringContaining("evidence.page 3")]);
    expect(errorsOf(withLine({ evidence: { page: 1, bbox: [50, 50, 40, 60], pageSize: PAGE } }))).toEqual([expect.stringContaining("x2 > x1")]);
    expect(errorsOf(withLine({ evidence: ev(1, 1, 2) }))).toEqual([expect.stringContaining("disagrees with sourcePage")]);
  });

  it("an invalid reference is never scored", async () => {
    const run = await runEndToEnd({ analysisJson: payload(PERFECT), documentId: DOC, documentName: "Synthetic", policy: "accept-everything" });
    const r = scoreEndToEnd(run, validateReferenceBoq(withLine({ quantity: null }), SHA), "Synthetic");
    expect(r.accuracy).toBeNull();
    expect(r.reference.message).toBe(`Reference rejected — ${NO_REFERENCE}`);
  });
});

describe("the matcher on its own", () => {
  it("places by containment or a short distance, on the same page only", () => {
    const a = locate(1, [100, 100, 130, 108], PAGE)!, b = locate(1, [110, 101, 140, 109], PAGE)!, far = locate(1, [400, 600, 430, 608], PAGE)!;
    expect(placement(a, b)).not.toBeNull();
    expect(placement(a, far)).toBeNull();
    expect(placement(a, locate(2, [100, 100, 130, 108], PAGE)!)).toBeNull();
  });

  it("never pairs by quantity: with no locations, two same-name lines stay unpaired", () => {
    const refs = [0, 1].map(() => ({ names: new Set(["wr"]), floor: "ff", located: null }));
    const sys = [0, 1].map(() => ({ name: "wr", floor: "ff", located: null }));
    const m = matchReference(refs, sys);
    expect(m.pairs).toEqual([]);
    expect(m.refOutcomes).toEqual(["ambiguous", "ambiguous"]);
    expect(m.sysOutcomes).toEqual(["ambiguous", "ambiguous"]);
  });
});
