import { describe, it, expect } from "vitest";
import type { LinearDimension, PageDimensions } from "@/lib/measurement-lab/baselines/engine-9ac1f71/linearDimensions";
import { buildLedger, buildLedgerRow, matchReferences, parseReferenceEnds, type ReferenceDimension } from "./ledger";
import { checkAccounting, computeMetrics, metric } from "./metrics";

// SYNTHETIC records only: a horizontal 1000 mm dimension at y = 100 from x = 0 to x = 50.
const SHA = "a".repeat(64);
const ref = (id: string, over: Partial<ReferenceDimension> = {}): ReferenceDimension => ({
  gold_id: id, kind: "linear_dimension", file: "T/test.pdf", sha256: SHA, page: 1, view: "p1 PLAN", view_scale: "1:100",
  printed_text: "1000", value: 1000, unit: "mm", orientation: "horizontal", text_center_pt: [25, 98],
  endpoints_pt: [[0, 100], [50, 100]], associated_element: "grid 1 -> grid 2", reference_status: "OK",
  verification: "DEVELOPER-VERIFIED (synthetic)", ...over,
});
const gridEnd = (l: string) => ({ kind: "grid" as const, labels: [l], evidence: "" });
const dim = (id: string, over: Partial<LinearDimension> = {}): LinearDimension => ({
  id, page: 1, text: "1000", parsed: { text: "1000", value: 1000, unit: null, notation: "unitless" } as LinearDimension["parsed"],
  unit: "mm", unitBasis: "page-note", statedMm: 1000, textAnchor: [25, 98], textHeight: 2,
  line: { a: [0, 100], b: [50, 100] }, span: { start: [0, 100], end: [50, 100], length: 50, ends: ["filled-tick", "filled-tick"] },
  endpoints: { decision: "valid-pair", reason: "pair", start: [0, 100], end: [50, 100], length: 50, ends: [{ at: 0, kind: "filled-tick", shapes: [1], evidence: "e" }, { at: 50, kind: "filled-tick", shapes: [2], evidence: "e" }], textPosition: 0, left: [], right: [] },
  association: { decision: "associated", measures: "grid-to-grid", ends: [gridEnd("1"), gridEnd("2")], reason: "grid to grid" },
  scaleCheck: { region: "S1", valuePerPoint: 20, basedOn: 5, measured: 1000, deviation: 0, tolerance: 15 }, measured: { value: 1000, mm: 1000 },
  status: "consistent", decisions: { text: "detected", parse: "parsed", unit: "page-note", line: "found", endpoints: "valid-pair", association: "associated", scale: "consistent", overall: "acceptable" },
  reasons: [], role: "single", ...over,
});
const page = (dims: LinearDimension[]): PageDimensions[] => [{ page: 1, dimensions: dims, scale: null, regions: [], unitNote: null, scaleNotes: [], excluded: [] }];
const held = (over: Partial<LinearDimension["decisions"]>, reasons = ["held because"]) =>
  ({ decisions: { ...dim("x").decisions, ...over }, reasons, status: "ambiguous" as const });

describe("reference parsing", () => {
  it("reads grid and edge ends; a face located on a grid is an edge", () => {
    expect(parseReferenceEnds("grid 6 -> grid 7")).toEqual([{ kind: "grid", label: "6" }, { kind: "grid", label: "7" }]);
    expect(parseReferenceEnds("face on grid 6 -> grid 7")).toEqual([{ kind: "edge" }, { kind: "grid", label: "7" }]);
    expect(parseReferenceEnds("wall thickness")).toEqual([{ kind: "edge" }, { kind: "edge" }]);
    expect(parseReferenceEnds("a -> b -> c")).toBeNull();
  });
});

describe("matching", () => {
  it("matches each engine dimension at most once, nearest first, same value only", () => {
    const m = matchReferences([ref("R1"), ref("R2", { text_center_pt: [26, 98] }), ref("R3", { value: 2000, printed_text: "2000" })],
      page([dim("D1"), dim("D2", { textAnchor: [30, 98] })]));
    expect(m.get("R1")?.id).toBe("D1");
    expect(m.get("R2")?.id).toBe("D2");
    expect(m.get("R3")).toBeNull();
  });
  it("does not match beyond 12 pt", () => {
    expect(matchReferences([ref("R1")], page([dim("D1", { textAnchor: [25, 120] })])).get("R1")).toBeNull();
  });
});

describe("stage outcomes", () => {
  it("a fully correct accepted dimension is correctly accepted, with its gates as the reason", () => {
    const r = buildLedgerRow(ref("R"), dim("D"));
    expect(r.outcomes).toMatchObject({ detection: "found", parse: "correct", line: "correct", endpoints: "correct-pair", association: "correct", overall: "acceptable", final: "correctly-accepted" });
    expect(r.final_reason).toMatch(/association associated/);
  });
  it("an accepted dimension whose association is wrong is an incorrect acceptance", () => {
    const r = buildLedgerRow(ref("R", { associated_element: "grid 1 -> grid 3" }), dim("D"));
    expect(r.outcomes.association).toBe("incorrect");
    expect(r.outcomes.final).toBe("incorrectly-accepted");
  });
  it("an accepted dimension on a reference conflict is an incorrect acceptance", () => {
    expect(buildLedgerRow(ref("R", { reference_status: "CONFLICT" }), dim("D")).outcomes.final).toBe("incorrectly-accepted");
  });
  it("an ambiguous line is 'multiple-plausible' even when the reported line lies on the reference axis", () => {
    const r = buildLedgerRow(ref("R"), dim("D", { span: null, ...held({ line: "ambiguous", endpoints: "not-attempted", association: "not-attempted", overall: "hold" }) }));
    expect(r.outcomes.line).toBe("multiple-plausible");
    expect(r.line_on_reference_axis).toBe(true);
    expect(r.outcomes.endpoints).toBe("not-attempted");
    expect(r.outcomes.final).toBe("unnecessarily-held");
  });
  it("a span whose end is more than 1 pt off is a wrong pair; association is then not scored", () => {
    const r = buildLedgerRow(ref("R"), dim("D", { span: { start: [0, 100], end: [53, 100], length: 53, ends: ["filled-tick", "filled-tick"] } }));
    expect(r.outcomes.endpoints).toBe("wrong-pair");
    expect(r.outcomes.association).toBe("associated-unscored");
    expect(r.fully_correct).toBe(false);
  });
  it("a held conflict is correctly held; a rejected determined item is incorrectly rejected", () => {
    expect(buildLedgerRow(ref("R", { reference_status: "CONFLICT" }), dim("D", held({ overall: "hold" }))).outcomes.final).toBe("correctly-held");
    expect(buildLedgerRow(ref("R"), dim("D", { line: null, span: null, ...held({ line: "not-found", endpoints: "not-attempted", association: "not-attempted", overall: "reject" }) })).outcomes.final).toBe("incorrectly-rejected");
  });
  it("a missed reference has no engine record and a missed outcome", () => {
    const r = buildLedgerRow(ref("R"), null);
    expect(r.engine).toBeNull();
    expect(r.outcomes.final).toBe("missed");
  });
  it("an amended reference keeps its original value alongside the amended one", () => {
    const r = buildLedgerRow(ref("R", { associated_element: "face -> grid 2", amendments: [{ date: "d", field: "associated_element", from: "grid 1 -> grid 2", to: "face -> grid 2", why: "w" }] }), dim("D"));
    expect(r.reference.associated_element).toBe("face -> grid 2");
    expect(r.reference.associated_element_original).toBe("grid 1 -> grid 2");
  });
});

describe("metrics and accounting", () => {
  const refs = [ref("A"), ref("B", { text_center_pt: [125, 98] }), ref("C", { text_center_pt: [225, 98] }), ref("M", { value: 7, printed_text: "7" })];
  const dims = [
    dim("D1"),
    dim("D2", { textAnchor: [125, 98], association: { decision: "ambiguous", measures: null, ends: [gridEnd("1"), { kind: "ambiguous", candidates: ["a", "b"], reason: "r" }], reason: "r" }, ...held({ association: "ambiguous", overall: "hold" }) }),
    dim("D3", { textAnchor: [225, 98], line: null, span: null, endpoints: null, association: null, ...held({ line: "not-found", endpoints: "not-attempted", association: "not-attempted", scale: "not-attempted", overall: "reject" }) }),
  ];
  const L = buildLedger(refs, page(dims));
  const ms = computeMetrics(L);

  it("every stage's categories are mutually exclusive and sum to their denominators", () => {
    expect(checkAccounting(L, refs.map((r) => r.gold_id), ms)).toEqual([]);
    expect(metric(ms, "decision.acceptable").numerator! + metric(ms, "decision.hold").numerator! + metric(ms, "decision.reject").numerator! + metric(ms, "decision.missed").numerator!).toBe(4);
  });
  it("conditional and end-to-end metrics have different denominators", () => {
    expect(metric(ms, "endpoints.correct-pair")).toMatchObject({ numerator: 2, denominator: 4, basis: "end-to-end" });
    expect(metric(ms, "endpoints.correct-pair|line-correct")).toMatchObject({ numerator: 2, denominator: 2, basis: "conditional" });
    expect(metric(ms, "operational.false_acceptances")).toMatchObject({ numerator: 0, denominator: 1 });
    expect(metric(ms, "operational.missed_automation.evidence_correct").ids).toEqual([]);
    expect(metric(ms, "detection.false_detections").numerator).toBeNull();
  });
  it("flags a missing row, a duplicate row and an unknown row", () => {
    const v = checkAccounting([L[0], L[0], L[1]], ["A", "B", "Z"]);
    expect(v.join("\n")).toMatch(/A: more than one result row/);
    expect(v.join("\n")).toMatch(/Z: reference has no result row/);
  });
  it("flags an accepted row that failed a gate, and a hold without a reason", () => {
    const bad = buildLedger([ref("A"), ref("B", { text_center_pt: [125, 98] })], page([
      dim("D1", { decisions: { ...dim("x").decisions, scale: "unavailable" } }),
      dim("D2", { textAnchor: [125, 98], ...held({ overall: "hold" }, []) }),
    ]));
    const v = checkAccounting(bad, ["A", "B"]).join("\n");
    expect(v).toMatch(/A: accepted but failed gates: scale/);
    expect(v).toMatch(/B: hold without an explicit reason/);
  });
  it("flags an untraceable reference", () => {
    const L2 = buildLedger([ref("A", { sha256: "" })], page([dim("D1")]));
    expect(checkAccounting(L2, ["A"]).join("\n")).toMatch(/not traceable/);
  });
  it("is deterministic: the same input gives identical ledgers", () => {
    expect(JSON.stringify(buildLedger(refs, page(dims)))).toBe(JSON.stringify(L));
  });
});

describe("reference adapters", () => {
  it("restates an R0 record without inventing a unit or association; association is not scored", async () => {
    const { fromR0 } = await import("./referenceAdapters");
    const refs = fromR0({ case: "C-09", page: 2, split: "dev", grade: "R0 synthetic", dimensions: [{ gid: "G16", value: 1000, axis: "h", across: 100, span: [0, 50], anchor: [25, 98] }],
      amendments: [{ gids: "G16-G22", field: "across", from: 94, to: 100, reason: "re-read" }] }, { name: "x.pdf", sha256: SHA });
    expect(refs[0]).toMatchObject({ gold_id: "C-09-G16", unit: null, associated_element: "", endpoints_pt: [[0, 100], [50, 100]] });
    expect(refs[0].amendments).toHaveLength(1);
    const r = buildLedgerRow(refs[0], dim("D", { unit: null, unitBasis: "none" }));
    expect(r.outcomes.parse).toBe("correct");
    expect(r.outcomes.association).toBe("associated-unscored");
    // acceptance is judged on what the reference can score, and says so
    expect(r).toMatchObject({ association_scorable: false, fully_correct: true });
    expect(r.outcomes.final).toBe("correctly-accepted");
    expect(metric(computeMetrics([r]), "final.correctly-accepted.association-unscored").numerator).toBe(1);
  });
});
