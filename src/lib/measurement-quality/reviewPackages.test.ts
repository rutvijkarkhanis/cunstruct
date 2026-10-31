import { describe, it, expect } from "vitest";
import {
  blindIds, cohensKappa, decisionOutcome, mulberry32, resolveItems, REVIEW_RESPONSE_SCHEMA, ReviewResponse, stratifiedSample, verdict,
  type AnswerKeyEntry,
} from "./reviewPackages";

// SYNTHETIC records only. No review verdict here comes from a real reviewer.
const key = (over: Partial<AnswerKeyEntry> = {}): AnswerKeyEntry => ({
  item_id: "RV-AAAAAA", package: "A", engine_id: "D1-1", gold_id: null, page: 1, view: "p1", scale_region: "S1", orientation: "horizontal",
  measures: "grid-to-grid", engine_status: "acceptable", primary_reason: null, engine_value: 1730, engine_span: [[0, 100], [50, 100]],
  engine_ends: [{ kind: "grid", labels: ["6"] }, { kind: "grid", labels: ["7"] }], developer_verdict: null, ...over,
});
const resp = (over: Partial<ReviewResponse> = {}): ReviewResponse => ReviewResponse.parse({
  schema: REVIEW_RESPONSE_SCHEMA, item_id: "RV-AAAAAA", reviewer_id: "R1", reviewed_at: "2026-11-01T10:00", is_dimension: "yes", printed_value: 1730, unit: "mm",
  line: null, endpoints: [[50.5, 100], [0.4, 100.2]], measured_element: { kind: "grid-to-grid", end1: "grid 6", end2: "grid 7" },
  evidence_sufficient: "yes", ambiguous: "no", confidence: "high", ...over,
});

describe("deterministic sampling", () => {
  const pool = Array.from({ length: 60 }, (_, i) => ({ id: i, reason: i < 40 ? "a" : i < 55 ? "b" : "c", page: i % 3 }));
  it("same seed, same sample; different seed, different sample", () => {
    const s1 = stratifiedSample(pool, 12, 7, (t) => t.reason, [(t) => String(t.page)]);
    expect(stratifiedSample(pool, 12, 7, (t) => t.reason, [(t) => String(t.page)]).items).toEqual(s1.items);
    expect(stratifiedSample(pool, 12, 8, (t) => t.reason, [(t) => String(t.page)]).items).not.toEqual(s1.items);
  });
  it("allocates proportionally with every stratum represented, and reports inclusion probabilities", () => {
    const s = stratifiedSample(pool, 12, 7, (t) => t.reason);
    expect(s.items).toHaveLength(12);
    expect(new Set(s.items.map((t) => t.id)).size).toBe(12);
    expect(s.strata.map((x) => [x.key, x.sampled])).toEqual([["a", 8], ["b", 3], ["c", 1]]);
    expect(s.strata.find((x) => x.key === "c")!.inclusionProbability).toBeCloseTo(0.2);
    // a tiny stratum still gets one item
    const t = stratifiedSample([...pool.slice(0, 55), { id: 99, reason: "z", page: 0 }], 5, 7, (x) => x.reason);
    expect(t.strata.find((x) => x.key === "z")!.sampled).toBe(1);
  });
  it("spreads picks across secondary attributes", () => {
    const s = stratifiedSample(pool, 6, 1, (t) => t.reason, [(t) => String(t.page)]);
    const a = s.items.filter((t) => t.reason === "a").map((t) => t.page);
    expect(new Set(a).size).toBe(Math.min(3, a.length));
  });
  it("blind ids are unique, unrevealing tokens", () => {
    const ids = blindIds(200, mulberry32(3));
    expect(new Set(ids).size).toBe(200);
    expect(ids.every((i) => /^RV-[2-9A-HJ-NP-Z]{6}$/.test(i))).toBe(true);
  });
});

describe("scoring a review against the engine record", () => {
  it("matching value, endpoints (either order, within 2 pt) and element confirms the engine", () => {
    expect(verdict(resp(), key()).verdict).toBe("engine-confirmed");
    expect(decisionOutcome("engine-confirmed", key())).toBe("accepted-confirmed");
  });
  it("a different grid label or endpoint disputes an acceptance: an accepted-measurement error", () => {
    const v = verdict(resp({ measured_element: { kind: "grid-to-grid", end1: "grid 6", end2: "grid 8" } }), key());
    expect(v).toEqual({ verdict: "engine-disputed", mismatches: ["grid label"] });
    expect(decisionOutcome(v.verdict, key())).toBe("accepted-error");
    expect(verdict(resp({ endpoints: [[0, 100], [55, 100]] }), key()).mismatches).toEqual(["endpoints"]);
  });
  it("a held item the reviewer confirms is unnecessarily held; one the reviewer finds ambiguous is correctly held", () => {
    const k = key({ engine_status: "hold", package: "C" });
    expect(decisionOutcome(verdict(resp(), k).verdict, k)).toBe("held-unnecessarily");
    expect(decisionOutcome(verdict(resp({ ambiguous: "yes" }), k).verdict, k)).toBe("held-correctly");
  });
  it("a rejected item the reviewer can determine is recoverable; one with insufficient evidence was correctly rejected", () => {
    const k = key({ engine_status: "reject", engine_span: null, measures: null, engine_ends: null });
    expect(decisionOutcome(verdict(resp(), k).verdict, k)).toBe("rejected-recoverable");
    expect(decisionOutcome(verdict(resp({ evidence_sufficient: "no" }), k).verdict, k)).toBe("rejected-correctly");
  });
});

describe("agreement and adjudication", () => {
  it("agreeing reviewers resolve; disagreeing ones wait for adjudication, never for the engine", () => {
    const a = resp(), b = resp({ reviewer_id: "R2" }), c = resp({ reviewer_id: "R2", item_id: "RV-BBBBBB", ambiguous: "yes" }), d = resp({ item_id: "RV-BBBBBB" });
    const res = resolveItems([a, b, c, d]);
    expect(res.find((r) => r.item_id === "RV-AAAAAA")!.state).toBe("agreed");
    const x = res.find((r) => r.item_id === "RV-BBBBBB")!;
    expect(x).toMatchObject({ state: "needs-adjudication", disagreements: ["ambiguous"], final: null });
  });
  it("an adjudication resolves a disagreement, but not by one of the item's own reviewers", () => {
    const a = resp(), b = resp({ reviewer_id: "R2", printed_value: 1780 });
    const adj = { ...resp({ reviewer_id: "R3" }), adjudicates: ["R1", "R2"], note: "re-read at 600 dpi" };
    expect(resolveItems([a, b], [adj])[0].state).toBe("adjudicated");
    expect(() => resolveItems([a, b], [{ ...adj, reviewer_id: "R2" }])).toThrow(/adjudicator/);
  });
  it("Cohen's kappa: perfect agreement 1, chance-level agreement ≈ 0", () => {
    expect(cohensKappa([["x", "x"], ["y", "y"]])).toBe(1);
    expect(cohensKappa([["x", "x"], ["x", "y"], ["y", "x"], ["y", "y"]])).toBeCloseTo(0);
    expect(cohensKappa([])).toBeNull();
  });
  it("rejects malformed responses (unknown item id format, missing fields)", () => {
    expect(ReviewResponse.safeParse({ ...resp(), item_id: "D1-1" }).success).toBe(false);
    expect(ReviewResponse.safeParse({ ...resp(), confidence: undefined }).success).toBe(false);
  });
});
