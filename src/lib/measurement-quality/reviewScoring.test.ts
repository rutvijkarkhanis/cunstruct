import { describe, it, expect } from "vitest";
import { cohensKappa, REVIEW_RESPONSE_SCHEMA, ReviewResponse, resolveItems, verdict, elementKind, namedGrids, type AnswerKeyEntry } from "./reviewPackages";
import { adjudicationBlockers, fromFormRow, ingest, parseCsv, rawAgreement, Roster, stratifiedEstimate, exactStratumBounds, wilson } from "./reviewScoring";

// SYNTHETIC PIPELINE TESTS ONLY — no value here is, or stands for, a real review result.
const resp = (over: Partial<ReviewResponse> = {}): ReviewResponse => ReviewResponse.parse({
  schema: REVIEW_RESPONSE_SCHEMA, item_id: "RV-AAAAAA", reviewer_id: "R1", reviewed_at: "2026-11-01T10:00", is_dimension: "yes", printed_value: 1730, unit: "mm",
  line: null, endpoints: [[0, 100], [50, 100]], measured_element: { kind: "grid-to-grid", end1: "grid 6", end2: "grid 7" },
  evidence_sufficient: "yes", ambiguous: "no", confidence: "high", ...over,
});
const roster: Roster = Roster.parse({ schema: "cunstruct.review-roster.v1", reviewers: [
  { id: "R1", role: "reviewer-1", independent: true, assigned: ["RV-AAAAAA", "RV-BBBBBB", "RV-CCCCCC"] },
  { id: "R2", role: "reviewer-2", independent: true, assigned: ["RV-AAAAAA"] },
  { id: "ADJ", role: "adjudicator", independent: true, assigned: [] },
] });

describe("Cohen's kappa and raw agreement against hand-calculated examples", () => {
  it("2×2: 50 items, both yes 20, both no 15, yes/no 5, no/yes 10 → po 0.70, pe 0.50, κ 0.40", () => {
    const pairs: [string, string][] = [...Array(20).fill(["y", "y"]), ...Array(15).fill(["n", "n"]), ...Array(5).fill(["y", "n"]), ...Array(10).fill(["n", "y"])];
    expect(rawAgreement(pairs)).toBeCloseTo(0.7, 10);
    expect(cohensKappa(pairs)).toBeCloseTo(0.4, 10);
  });
  it("3×3: rows A[10,2,0] B[1,8,1] C[0,2,6] (n 30) → po 0.8, pe 308/900, κ 0.695946", () => {
    const m = [["A", ["A", 10], ["B", 2], ["C", 0]], ["B", ["A", 1], ["B", 8], ["C", 1]], ["C", ["A", 0], ["B", 2], ["C", 6]]] as const;
    const pairs: [string, string][] = m.flatMap(([r, ...cells]) => cells.flatMap(([c, n]) => Array(n).fill([r, c])));
    expect(pairs).toHaveLength(30);
    expect(rawAgreement(pairs)).toBeCloseTo(0.8, 10);
    expect(cohensKappa(pairs)).toBeCloseTo((0.8 - 308 / 900) / (1 - 308 / 900), 10);
    expect(cohensKappa(pairs)).toBeCloseTo(0.695946, 5);
  });
  it("one category only: agreement is total and κ is reported as 1 by convention (po = pe = 1); one disagreement gives 0", () => {
    expect(rawAgreement([["x", "x"], ["x", "x"]])).toBe(1);
    expect(cohensKappa([["x", "x"], ["x", "x"]])).toBe(1); // po = pe = 1: reported as perfect, by convention
    expect(cohensKappa([["x", "y"]])).toBe(0);
  });
});

describe("ingestion: roster, assignment, duplicates, missing", () => {
  it("rejects unknown reviewer ids, unassigned items and the adjudicator answering as a reviewer", () => {
    const r = ingest([resp({ reviewer_id: "R9" }), resp({ reviewer_id: "R2", item_id: "RV-BBBBBB" }), resp({ reviewer_id: "ADJ" })], roster);
    expect(r.accepted).toEqual([]);
    expect(r.errors.join("\n")).toMatch(/unknown reviewer id "R9"/);
    expect(r.errors.join("\n")).toMatch(/RV-BBBBBB: not assigned to R2/);
    expect(r.errors.join("\n")).toMatch(/ADJ is the adjudicator/);
  });
  it("rejects every copy of a duplicate answer, and reports missing answers without filling them", () => {
    const r = ingest([resp(), resp({ printed_value: 1780 }), resp({ item_id: "RV-BBBBBB" })], roster);
    expect(r.accepted.map((x) => x.item_id)).toEqual(["RV-BBBBBB"]);
    expect(r.errors[0]).toMatch(/answered more than once/);
    expect(r.missing).toEqual({ R1: ["RV-AAAAAA", "RV-CCCCCC"], R2: ["RV-AAAAAA"] });
  });
  it("parses a completed CSV form row, including structured end types; skips unanswered rows", () => {
    const csv = "item_id,reviewer_id,reviewed_at,page,marker_x,marker_y,is_dimension,printed_value,unit,line_a_x,line_a_y,line_b_x,line_b_y,end1_x,end1_y,end2_x,end2_y,element_kind,end1_type,element_end1,end2_type,element_end2,evidence_sufficient,ambiguous,ambiguity_note,confidence,explanation\n" +
      'RV-AAAAAA,R1,2026-11-01T10:00,1,25,98,yes,1730,mm,0,100,50,100,0,100,50,100,,grid,6,wall-face,"outer face, wall",yes,no,,high,"said ""ok"""\n' +
      "RV-BBBBBB,R1,,1,25,98,,,,,,,,,,,,,,,,,,,,,\n";
    const rows = parseCsv(csv).map(fromFormRow);
    expect(rows[1]).toBeNull();
    expect(rows[0]).toMatchObject({ printed_value: 1730, endpoints: [[0, 100], [50, 100]], explanation: 'said "ok"' });
    expect(elementKind(rows[0]!.measured_element)).toBe("grid-to-edge");
    expect(namedGrids(rows[0]!.measured_element)).toEqual(["6"]);
  });
  it("a malformed row is refused, not guessed", () => {
    expect(() => fromFormRow({ item_id: "RV-AAAAAA", reviewer_id: "R1", reviewed_at: "2026-11-01T10:00", is_dimension: "maybe", evidence_sufficient: "yes", ambiguous: "no", confidence: "high" })).toThrow();
  });
});

describe("adjudication", () => {
  it("cannot start until both submissions are locked with matching hashes", () => {
    const H = "a".repeat(64);
    expect(adjudicationBlockers(roster, null, {})).toEqual(["no submission register: reviewer submissions are not locked"]);
    const reg = { schema: "cunstruct.review-submissions.v1" as const, submissions: [{ reviewer_id: "R1", file: "r1.csv", sha256: H, locked_at: "2026-11-03T09:00" }] };
    expect(adjudicationBlockers(roster, reg, { "r1.csv": H })).toEqual(["R2: submission not locked"]);
    reg.submissions.push({ reviewer_id: "R2", file: "r2.csv", sha256: H, locked_at: "2026-11-03T09:00" });
    expect(adjudicationBlockers(roster, reg, { "r1.csv": H, "r2.csv": "b".repeat(64) })).toEqual(["R2: r2.csv differs from its locked hash"]);
    expect(adjudicationBlockers(roster, reg, { "r1.csv": H, "r2.csv": H })).toEqual([]);
  });
  it("keeps both original answers and uses the adjudicator's record as final", () => {
    const a = resp(), b = resp({ reviewer_id: "R2", ambiguous: "yes" });
    const res = resolveItems([a, b], [{ ...resp({ reviewer_id: "ADJ" }), adjudicates: ["R1", "R2"], note: "tick is on the grid line at 600 dpi" }]);
    expect(res[0]).toMatchObject({ state: "adjudicated", reviewers: ["R1", "R2"], disagreements: ["ambiguous"] });
    expect(res[0].final!.reviewer_id).toBe("ADJ");
    expect(a.ambiguous).toBe("no"); expect(b.ambiguous).toBe("yes");
  });
  it("structured end types score like an explicit element kind", () => {
    const k: AnswerKeyEntry = { item_id: "RV-AAAAAA", package: "A", engine_id: "D", gold_id: null, page: 1, view: "p1", scale_region: null, orientation: "horizontal", measures: "grid-to-grid",
      engine_status: "acceptable", primary_reason: null, engine_value: 1730, engine_span: [[0, 100], [50, 100]], engine_ends: [{ kind: "grid", labels: ["6"] }, { kind: "grid", labels: ["7"] }], developer_verdict: null };
    const r = resp({ measured_element: { end1: "6", end2: "grid 7", end1_type: "grid", end2_type: "grid" } });
    expect(verdict(r, k).verdict).toBe("engine-confirmed");
    expect(verdict(resp({ measured_element: { end1: "8", end2: "7", end1_type: "grid", end2_type: "grid" } }), k).mismatches).toEqual(["grid label"]);
  });
});

describe("intervals and stratified weights", () => {
  it("Wilson 95% for 0/116 and 5/10 match hand calculation", () => {
    const w0 = wilson(0, 116)!;
    expect(w0.low).toBe(0);
    expect(w0.high).toBeCloseTo(3.841459 / (116 + 3.841459), 6); // z²/(n+z²) when x = 0
    const w = wilson(5, 10)!;
    expect(w.low).toBeCloseTo(0.236593, 5);
    expect(w.high).toBeCloseTo(0.763407, 5);
    expect(wilson(0, 0)).toBeNull();
  });
  it("stratified estimate: N_h-weighted total and the unbiased design variance with fpc", () => {
    const e = stratifiedEstimate([
      { key: "a", population: 40, reviewed: 4, positive: 2 },
      { key: "b", population: 10, reviewed: 3, positive: 1 },
      { key: "c", population: 20, reviewed: 0, positive: 0 },
    ]);
    expect(e.estimate).toBeCloseTo(40 * 0.5 + 10 / 3, 10);
    expect(e.covered_population).toBe(50);
    expect(e.uncovered_strata).toEqual(["c"]);
    // V = 40²·(1−4/40)·0.25/3 + 10²·(1−3/10)·(1/3·2/3)/2 = 120 + 70/9
    const V = 120 + 70 / 9;
    expect(e.design_variance).toBeCloseTo(V, 8);
    expect(e.normal_interval![0]).toBeCloseTo(e.estimate - 1.959964 * Math.sqrt(V), 6);
    // the exact simultaneous interval contains the point estimate
    expect(e.exact_interval[0]).toBeLessThanOrEqual(e.estimate);
    expect(e.exact_interval[1]).toBeGreaterThanOrEqual(e.estimate);
  });
  it("all-or-none and single-review strata: no normal interval, no pseudo-counts; the exact interval stays valid", () => {
    const e = stratifiedEstimate([{ key: "d", population: 61, reviewed: 10, positive: 0 }]);
    expect(e.estimate).toBe(0);
    expect(e.design_variance).toBe(0);
    expect(e.normal_interval).toBeNull();
    expect(e.normal_interval_withheld_because).toMatch(/all-or-none strata \(d\)/);
    // brute-force exact upper bound: the largest K with P(X = 0 | K) = C(61−K,10)/C(61,10) ≥ 0.025
    const p0 = (K: number) => { let r = 1; for (let i = 0; i < 10; i++) r *= (61 - K - i) / (61 - i); return r; };
    let K = 0; while (p0(K + 1) >= 0.025) K++;
    expect(e.exact_interval).toEqual([0, K]);
    expect(K).toBe(17); // 0 of 10 sampled is compatible with up to 17 of 61 (checked independently with math.comb)
    const one = stratifiedEstimate([{ key: "s", population: 7, reviewed: 1, positive: 1 }]);
    expect(one.design_variance).toBeNull();
    expect(one.normal_interval).toBeNull();
    expect(one.exact_interval[1]).toBe(7);
  });
  it("exact stratum bounds: census is exact; bounds respect what was observed", () => {
    expect(exactStratumBounds(116, 116, 3, 0.05)).toEqual([3, 3]);
    const [l, h] = exactStratumBounds(40, 4, 2, 0.05);
    expect(l).toBeGreaterThanOrEqual(2); expect(h).toBeLessThanOrEqual(38); expect(l).toBeLessThan(20); expect(h).toBeGreaterThan(20);
  });
  it("a census stratum (all items reviewed) has no sampling variance", () => {
    const e = stratifiedEstimate([{ key: "A", population: 116, reviewed: 116, positive: 116 }]);
    expect([e.estimate, e.design_variance, ...e.exact_interval]).toEqual([116, 0, 116, 116]);
  });
});
