// Offline preflight for the inventory-guided experiment arm: what the model
// would be given, and how a response is scored — before any paid call. Runs on
// the invented plan in __fixtures__/syntheticPlanText.ts.
import { describe, it, expect } from "vitest";
import {
  guidanceCandidates, guidanceHasNoDimensions, inventoryGuidance, screeningMetrics, splitCandidateOutcomes,
} from "./inventoryGuidedExtraction";
import { buildObservationPrompt } from "./analysisPrompt";
import { parseObservationsV1, type ObservationV1 } from "./observationSchemaV1";
import { syntheticPlanText, SYNTHETIC_PLAN_REFERENCE as REF } from "./__fixtures__/syntheticPlanText";

const candidates = guidanceCandidates(syntheticPlanText("plan"));
const guidance = inventoryGuidance(candidates);

describe("what the model is given", () => {
  it("11 room candidates from the drawing text (circulation excluded), each with an id, page, floor and approximate position", () => {
    expect(candidates).toHaveLength(11);
    expect(new Set(candidates.map((c) => c.id)).size).toBe(11);
    expect(candidates.some((c) => c.label === "CORRIDOR")).toBe(false);
    expect(candidates.find((c) => c.label === "LIFT" && c.page === 2)).toMatchObject({ floor: "Second Floor", acrossPct: 55, downPct: 10 });
  });

  it("repeated labels are separate candidates at different positions", () => {
    const wr = candidates.filter((c) => c.page === 1 && c.label === "W.R");
    expect(wr).toHaveLength(3);
    expect(new Set(wr.map((c) => `${c.acrossPct},${c.downPct}`)).size).toBe(3);
  });

  it("leaks no answers: no dimensions, no reference ids, no exact coordinates, nothing from a stored output", () => {
    expect(guidanceHasNoDimensions(guidance)).toBe(true);
    expect(guidance).not.toMatch(/\bs-\d|\d+\.\d+/);
    for (const stored of ["Building Lift", "Dining Room", "Plasma", "12'"]) expect(guidance).not.toContain(stored);
    for (const c of candidates) expect(guidance).toContain(`${c.id} · p.${c.page} · `);
  });

  it("the production prompt is untouched: the arm only appends guidance", () => {
    const base = buildObservationPrompt();
    expect(buildObservationPrompt({ extra: guidance }).startsWith(base)).toBe(true);
  });

  it("guidanceHasNoDimensions catches a dimension if one slipped in", () => {
    expect(guidanceHasNoDimensions(`${guidance}\nC99 · p.1 · First Floor · W.R 6' X 5'`)).toBe(false);
  });
});

describe("scoring a mocked inventory-guided response through the real parser", () => {
  const ref = (mark: string, floor: string, i = 0) => REF.filter((e) => e.mark === mark && e.scopeHint === floor)[i];
  const cand = (label: string, page: number, i = 0) => candidates.filter((c) => c.label === label && c.page === page)[i];
  const confirmed = (c: string, mark: string, floor: string, page: number, dimension: string | null, bbox: number[]) => ({
    observation_type: "room_or_space", mark, scope_hint: floor, location_text: `[${c}] confirmed`, evidence_completeness: "FULL",
    attributes: { dimension, specification: null, material: null }, source: { document_id: null, document: null, page, evidence: [{ bbox, page, label: null, claim: null }] },
  });
  const verdict = (c: string, v: string) => ({
    observation_type: v === "rejected" ? "other_construction_fact" : "room_or_space", mark: null, scope_hint: null,
    location_text: `[${c}] ${v}: test`, evidence_completeness: "LIMITED", attributes: { dimension: null, specification: null, material: null },
    source: { document_id: null, document: null, page: 1, evidence: [] },
  });
  const wr0 = ref("W.R", "First Floor", 0), wr2 = ref("W.R", "First Floor", 2);
  const raw = JSON.stringify({ schema_version: "cunstruct.observation.v1", observations: [
    confirmed(cand("W.R", 1, 0).id, "W.R", "First Floor", 1, `6' X 5'`, wr0.expectedBox!.bbox),                // right place, right size
    confirmed(cand("W.R", 1, 2).id, "W.R", "First Floor", 1, `9' X 9'`, wr2.expectedBox!.bbox),                // right place, wrong size
    confirmed(cand("LIFT", 2).id, "Lift", "Building Lift", 2, `8' X 6'`, [10, 10, 40, 30]),                    // right size, wrong floor, box misplaced
    verdict(cand("STORE", 1).id, "rejected"),
    verdict(cand("STUDY", 1).id, "unresolved"),
    { ...confirmed("C999", "Gym", "First Floor", 1, null, [500, 500, 520, 510]), location_text: "" },          // untagged discovery, not a reference room
    { ...confirmed(cand("DINING", 1).id, "Dining", "First Floor", 1, null, [1, 1, 2, 2]), evidence_completeness: "FULL", source: { document_id: null, document: null, page: 1, evidence: [] } }, // claims FULL with no box
  ] });
  const parsed = parseObservationsV1(raw);
  const outcomes = splitCandidateOutcomes(parsed.observations!, candidates);
  const m = screeningMetrics(REF, outcomes.claims, parsed.diagnostics!, outcomes);

  it("the parser rejects the box-less FULL claim; the schema and parser are unchanged", () => {
    expect(parsed.ok).toBe(true);
    expect(parsed.diagnostics!.rejected.map((r) => [r.mark, r.reason])).toEqual([["Dining", "no_valid_evidence"]]);
  });

  it("verdicts are separated: rejections and unresolved are not room claims; missing verdicts are counted", () => {
    expect(outcomes.confirmed).toHaveLength(3);
    expect(outcomes.rejected).toEqual([cand("STORE", 1).id]);
    expect(outcomes.unresolved).toEqual([cand("STUDY", 1).id]);
    expect(outcomes.claims.map((c) => c.mark)).toEqual(["W.R", "W.R", "Lift", "Gym"]);
    expect(outcomes.missingVerdict).toHaveLength(11 - 5); // the rejected Dining never reached the split
  });

  it("scores matches, precision, sizes, floors, evidence placement and review load", () => {
    expect(m).toMatchObject({
      matched: 3, referenceRooms: 10,
      falsePositives: [{ mark: "Gym", page: 1 }],
      dimensions: { correct: 2, of: 3 },
      floorLabels: { correct: 3, of: 4 },
      duplicates: 0,
      evidencePlacement: { placed: 2, of: 3 },
      parserRejections: 1,
    });
    expect(m.precision).toBe(3 / 4);
    // 1 FP + 1 wrong size + 1 wrong floor + 1 unresolved + 6 missing verdicts + 1 parser rejection
    expect(m.reviewItems).toBe(11);
  });
});

describe("a box-less stored output under the same rules", () => {
  const stored: ObservationV1[] = [
    { observationType: "room_or_space", mark: "W.R", scopeHint: "Bedroom", attributes: { dimension: `12'x10'` }, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
    { observationType: "room_or_space", mark: "Dining", scopeHint: "Dining Room", attributes: { dimension: `14'x12'` }, evidenceCompleteness: "FULL", source: { page: 1, evidence: [] } },
    { observationType: "room_or_space", mark: "Kitchen", scopeHint: "Kitchen", attributes: { dimension: `11'x9'` }, evidenceCompleteness: "FULL", source: { page: 2, evidence: [] } },
    { observationType: "finish_or_material", mark: "Plasma", scopeHint: "Living Room", attributes: {}, evidenceCompleteness: "LIMITED", source: { page: 1, evidence: [] } },
    { observationType: "equipment", mark: "Lift", scopeHint: "Building Lift", attributes: { dimension: `8'x6'` }, evidenceCompleteness: "FULL", source: { page: 2, evidence: [] } },
  ];
  const m = screeningMetrics(REF, splitCandidateOutcomes(stored, []).claims, null);

  it("4/10 matched, no room false positives, 3/4 sizes, 0/5 floors; evidence and parser metrics not computable", () => {
    expect(m).toMatchObject({ matched: 4, referenceRooms: 10, precision: 1, falsePositives: [], dimensions: { correct: 3, of: 4 }, floorLabels: { correct: 0, of: 5 }, evidencePlacement: null, parserRejections: null });
    expect(m.notComputable).toContain("evidence placement (no matched claim carries a box)");
  });
});
