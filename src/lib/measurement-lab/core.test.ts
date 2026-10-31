import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { ReferenceDimension } from "@/lib/measurement-quality/ledger";
import {
  appendVerdict, buildLabReport, freezeRun, GENESIS, labMetrics, latestVerdicts, pairEngines, runEngineOn, scoreAgainstReference, sha256Hex, stableStringify, verifyLog, verifyRun,
  type LabMeasurement,
} from "./core";
import { memoryStore } from "./labStore";

// SYNTHETIC data and the repository's synthetic PDF fixtures only.
const require = createRequire(import.meta.url);
const FIX = path.resolve(process.cwd(), "src/lib/review/__fixtures__");
let pdfjs: { getDocument: (o: object) => { promise: Promise<import("pdfjs-dist").PDFDocumentProxy> }; GlobalWorkerOptions: { workerSrc: string } };
beforeAll(async () => {
  pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
});

const m = (over: Partial<LabMeasurement> = {}): LabMeasurement => ({
  id: "D1-1", page: 1, text: "1000", value: 1000, unit: "mm", textAnchor: [25, 98], line: { a: [0, 100], b: [50, 100] },
  span: { start: [0, 100], end: [50, 100], length: 50 }, decision: "accepted", status: "acceptable", reasons: [],
  association: { decision: "associated", measures: "grid-to-grid", ends: [{ kind: "grid", labels: ["1"] }, { kind: "grid", labels: ["2"] }] }, ...over,
});
const ref = (over: Partial<ReferenceDimension> = {}): ReferenceDimension => ({
  gold_id: "R1", kind: "linear_dimension", file: "t.pdf", sha256: "a".repeat(64), page: 1, view: "p1", view_scale: "1:100", printed_text: "1000", value: 1000, unit: "mm",
  orientation: "horizontal", text_center_pt: [25, 98], endpoints_pt: [[0, 100], [50, 100]], associated_element: "grid 1 -> grid 2", reference_status: "OK", verification: "synthetic", ...over,
});
const input = { name: "t.pdf", sha256: "a".repeat(64), pages: [1] };

describe("both engines run unchanged in the lab", () => {
  it("each engine runs on a synthetic PDF fixture and its frozen output is reproducible", async () => {
    const data = new Uint8Array(readFileSync(path.join(FIX, "transformed-geometry.pdf")));
    for (const id of ["engine-1de95f6", "engine-9ac1f71"] as const) {
      const doc = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false }).promise;
      const r1 = await freezeRun(id, input, await runEngineOn(id, doc, [1]));
      const r2 = await freezeRun(id, input, await runEngineOn(id, doc, [1]));
      expect(r2.output_sha256).toBe(r1.output_sha256);
      expect(r2.raw_output_sha256).toBe(r1.raw_output_sha256);
      expect(r1.engine.id).toBe(id);
    }
  });
});

describe("frozen runs", () => {
  it("are deep-frozen and verified by their output hash; a tampered run fails verification", async () => {
    const r = await freezeRun("engine-9ac1f71", input, { measurements: [m()], raw: { x: 1 } });
    expect(Object.isFrozen(r)).toBe(true);
    expect(Object.isFrozen(r.measurements[0].span!.start)).toBe(true);
    expect(() => { (r.measurements[0] as { value: number }).value = 2000; }).toThrow();
    expect(await verifyRun(r)).toBe(true);
    const tampered = JSON.parse(JSON.stringify(r)); tampered.measurements[0].value = 2000;
    expect(await verifyRun(tampered)).toBe(false);
    expect(r.output_sha256).toBe(await sha256Hex(stableStringify([m()])));
    expect(r.counts).toEqual({ accepted: 1, held: 0, rejected: 0 });
  });
  it("the store refuses to replace a frozen run with different output", async () => {
    const s = memoryStore();
    const r = await freezeRun("engine-9ac1f71", input, { measurements: [m()], raw: {} });
    await s.putRun(r);
    await s.putRun(r); // identical: fine
    await expect(s.putRun({ ...JSON.parse(JSON.stringify(r)), measurements: [m({ value: 9 })] })).rejects.toThrow(/output hash/);
  });
});

describe("immutable verdicts", () => {
  it("append-only: a new log is returned, the old one is untouched, and a later verdict supersedes without erasing", async () => {
    const l0 = Object.freeze([]) as readonly never[];
    const l1 = await appendVerdict(l0, { run_id: "engine-9ac1f71:aaaaaaaaaaaa:x", measurement_id: "D1-1", verdict: "correct", reviewer_id: "user-a", reviewer_label: "a@x" });
    const l2 = await appendVerdict(l1, { run_id: "engine-9ac1f71:aaaaaaaaaaaa:x", measurement_id: "D1-1", verdict: "incorrect", note: "wrong end", reviewer_id: "user-a", reviewer_label: "a@x" });
    expect(l0).toHaveLength(0); expect(l1).toHaveLength(1); expect(l2).toHaveLength(2);
    expect(Object.isFrozen(l2) && Object.isFrozen(l2[0])).toBe(true);
    expect(l2[0].prev_hash).toBe(GENESIS); expect(l2[1].prev_hash).toBe(l2[0].hash);
    expect(latestVerdicts(l2, "engine-9ac1f71:aaaaaaaaaaaa:x").get("D1-1")!.verdict).toBe("incorrect");
    expect(await verifyLog(l2)).toBeNull();
    expect(l2.every((e) => e.blind === false)).toBe(true);
  });
  it("a changed or reordered event breaks the chain", async () => {
    let log = await appendVerdict([], { run_id: "r:aaaaaaaaaaaa:x", measurement_id: "A", verdict: "correct", reviewer_id: "user-a" });
    log = await appendVerdict(log, { run_id: "r:aaaaaaaaaaaa:x", measurement_id: "B", verdict: "unclear", note: "faint", reviewer_id: "user-a" });
    const edited = log.map((e) => ({ ...e })); edited[0].verdict = "incorrect";
    expect(await verifyLog(edited)).toBe(0);
    expect(await verifyLog([log[1], log[0]])).toBe(0);
  });
  it("a corrected measurement is recorded with an 'incorrect' verdict only", async () => {
    const l = await appendVerdict([], { run_id: "r:aaaaaaaaaaaa:x", measurement_id: "A", verdict: "incorrect", note: "value misread", reviewer_id: "u", correction: { value: 1050 } });
    expect(l[0].correction).toEqual({ value: 1050 });
    await expect(appendVerdict([], { run_id: "r", measurement_id: "A", verdict: "correct", reviewer_id: "u", correction: { value: 1 } })).rejects.toThrow(/incorrect/);
  });
  it("needs a reviewer, and a reason for incorrect or unclear", async () => {
    await expect(appendVerdict([], { run_id: "r", measurement_id: "A", verdict: "correct", reviewer_id: " " })).rejects.toThrow(/authenticated reviewer/);
    await expect(appendVerdict([], { run_id: "r", measurement_id: "A", verdict: "unclear", reviewer_id: "user-a" })).rejects.toThrow(/say why/);
  });
  it("the store only accepts events that extend the stored chain", async () => {
    const s = memoryStore();
    const l1 = await appendVerdict([], { run_id: "r:aaaaaaaaaaaa:x", measurement_id: "A", verdict: "correct", reviewer_id: "user-a" });
    await s.appendEvent(l1[0]);
    await expect(s.appendEvent(l1[0])).rejects.toThrow(/append-only/);
    const fork = await appendVerdict([], { run_id: "r:aaaaaaaaaaaa:x", measurement_id: "B", verdict: "correct", reviewer_id: "user-a" });
    await expect(s.appendEvent(fork[0])).rejects.toThrow(/append-only/);
    expect(await s.getLog("a".repeat(64))).toHaveLength(1);
  });
});

describe("comparison and report", () => {
  it("scores against a reference: measurable outcomes, value errors and non-measurable references", () => {
    expect(scoreAgainstReference([m()], [ref()])[0]).toMatchObject({ detected: true, value_ok: true, line_ok: true, endpoints_ok: true, association: "correct", outcome: "correctly-accepted" });
    expect(scoreAgainstReference([m({ span: { start: [0, 100], end: [53, 100], length: 53 } })], [ref()])[0].outcome).toBe("incorrectly-accepted");
    expect(scoreAgainstReference([m()], [ref({ associated_element: "grid 1 -> grid 3" })])[0].outcome).toBe("incorrectly-accepted");
    // a misread value at the right place is detected with a wrong value, not "missed"; accepting it is an error
    expect(scoreAgainstReference([m({ value: 7, text: "7" })], [ref()])[0]).toMatchObject({ detected: true, value_ok: false, outcome: "incorrectly-accepted" });
    expect(scoreAgainstReference([m({ textAnchor: [300, 300] })], [ref()])[0].outcome).toBe("missed");
    // held with correct evidence = unnecessarily held; held with wrong evidence = correctly held
    expect(scoreAgainstReference([m({ decision: "held", association: null })], [ref()])[0]).toMatchObject({ association: "engine-has-none", outcome: "unnecessarily-held" });
    expect(scoreAgainstReference([m({ decision: "rejected", span: null })], [ref()])[0].outcome).toBe("correctly-held");
    // an engine without association is judged on value and endpoints
    expect(scoreAgainstReference([m({ association: null })], [ref()])[0].outcome).toBe("correctly-accepted");
    // non-measurable references are never ordinary failures; accepting one is flagged separately
    expect(scoreAgainstReference([m()], [ref({ reference_status: "AMBIGUOUS" })])[0]).toMatchObject({ measurable: false, outcome: "accepted-non-measurable" });
    expect(scoreAgainstReference([], [ref({ reference_status: "NOT-DERIVABLE" })])[0].outcome).toBe("not-detected-non-measurable");
  });
  it("metrics use explicit denominators: coverage over measurable references, acceptance rates over accepted", async () => {
    const refs = [ref({ gold_id: "R1" }), ref({ gold_id: "R2", text_center_pt: [125, 98], endpoints_pt: [[100, 100], [150, 100]] }), ref({ gold_id: "R3", text_center_pt: [225, 98], endpoints_pt: [[200, 100], [250, 100]] }),
      ref({ gold_id: "R4", text_center_pt: [325, 98], reference_status: "AMBIGUOUS" }), ref({ gold_id: "R5", text_center_pt: [425, 98], endpoints_pt: [[400, 100], [450, 100]] })];
    const ms = [m({ id: "A" }), m({ id: "B", textAnchor: [125, 98], span: { start: [100, 100], end: [160, 100], length: 60 }, line: { a: [100, 100], b: [160, 100] } }),
      m({ id: "C", textAnchor: [225, 98], decision: "held", span: { start: [200, 100], end: [250, 100], length: 50 }, line: { a: [200, 100], b: [250, 100] } }), m({ id: "D", textAnchor: [325, 98] })];
    const run = await freezeRun("engine-9ac1f71", input, { measurements: ms, raw: {} });
    const k = labMetrics(scoreAgainstReference(ms, refs), run);
    expect(k.measurable_references).toBe(4); expect(k.non_measurable_references).toBe(1);
    expect(k.detection_recall).toMatchObject({ n: 3, of: 4, pct: 75 });
    expect(k.missed).toMatchObject({ n: 1, of: 4 });
    expect(k.correct_coverage).toMatchObject({ n: 1, of: 4, pct: 25 });
    expect(k.correct_acceptance_rate).toMatchObject({ n: 1, of: 2 });
    expect(k.incorrect_acceptance_rate).toMatchObject({ n: 1, of: 2, pct: 50 });
    expect(k.unnecessarily_held).toMatchObject({ n: 1, of: 4 });
    expect(k.accepted_on_non_measurable).toMatchObject({ n: 1, of: 1 });
    expect(k.endpoint_accuracy).toMatchObject({ n: 2, of: 3 });
    expect(k.review_burden_drawing).toMatchObject({ n: 1, of: 4 });
    expect(k.incorrect_acceptance_rate.denominator).toMatch(/accepted engine measurements/);
  });
  it("pairs the two engines' measurements and reports old → new outcome changes", async () => {
    const old = [m({ id: "O1", decision: "held", association: null }), m({ id: "O2", value: 5, text: "5" })];
    const now = [m({ id: "N1" }), m({ id: "N3", value: 9, text: "9" })];
    expect(pairEngines(old, now).map((p) => [p.a?.id ?? null, p.b?.id ?? null])).toEqual([["O1", "N1"], ["O2", null], [null, "N3"]]);
    const A = await freezeRun("engine-1de95f6", input, { measurements: old, raw: {} }), B = await freezeRun("engine-9ac1f71", input, { measurements: now, raw: {} });
    const log = await appendVerdict([], { run_id: B.run_id, measurement_id: "N1", verdict: "incorrect", note: "synthetic", reviewer_id: "user-a", correction: { value: 1010 } });
    const r = buildLabReport({ drawing: input, runs: [A, B], reference: { name: "ref.json", sha256: "b".repeat(64), type: "SYNTHETIC", items: [ref()] }, log, logIntact: true });
    expect(r.json.per_reference[0]).toMatchObject({ change: "improved" });
    expect(r.markdown).toMatch(/correct coverage\*\* \| 0\/1 \(0%\) \| 1\/1 \(100%\)/);
    expect(r.json.human_verdicts[1].accepted_marked_incorrect).toEqual(["N1"]);
    expect(r.json.human_verdicts[1].corrections).toBe(1);
    expect(r.markdown).toMatch(/Where each succeeds and fails/);
    expect(r.markdown).toMatch(/not\*\* blind independent reviews/);
    expect(r.markdown).toMatch(/nothing here changes a BOQ/);
  });
});
