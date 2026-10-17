// SYNTHETIC CONTROLS for the per-category benchmark metrics and the multi-set
// runner. Every drawing, reference and decision below is SYNTHETIC — written for
// these tests only. This is NOT a benchmark and says nothing about any real
// drawing or about extraction accuracy. DSR rates come from the real DSR 2023
// seed so the pricing path is the one a real run uses.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@/integrations/supabase/client", async () => await import("@/lib/e2e/inMemorySupabase"));

import { runEndToEnd } from "@/lib/e2e/pipeline";
import { scoreEndToEnd, systemItemsOf } from "@/lib/e2e/boqEndToEndScorer";
import { validateReferenceBoq, REFERENCE_BOQ_SCHEMA, type ReferenceBoq, type ReferenceBoqLine } from "@/lib/e2e/boqReference";
import { seedCatalogue } from "@/lib/dsr/seedFixture";
import type { DsrIndex } from "@/lib/dsr/match";
import { buildPricingIndex, categoryOf, median, metricsOf, percentile, priceReferenceLine, recordsOf, type CategoryMetrics, type MetricsBlock } from "./metrics";
import { applyDecisions, runManifest, validateDecisions, DECISIONS_SCHEMA, MANIFEST_SCHEMA, type DecisionsFile } from "./runner";
import { sha256Text } from "./gates";

const DOC = "doc-synthetic";
const SHA = "d".repeat(64);
const PAGE = { width: 595, height: 842 };
const box = (x: number, y: number): [number, number, number, number] => [x, y, x + 30, y + 8];
const ev = (x: number, y: number) => ({ page: 1, bbox: box(x, y), pageSize: PAGE });
const line = (id: string, item: string, unit: string, quantity: number, at: [number, number], extra: Partial<ReferenceBoqLine> & { dsrCode?: string } = {}) =>
  ({ id, item, unit, quantity, floor: "Ground Floor", sourcePage: 1, evidence: ev(...at), measurementRule: "synthetic", ...extra }) as ReferenceBoqLine;

// SYNTHETIC reference: three floor areas (one the system omits), brickwork
// (priced by the matcher), plaster (priced by its stated DSR code), a door count.
const LINES: ReferenceBoqLine[] = [
  line("KIT", "Floor area — Kitchen", "sqm", 20, [50, 50]),
  line("BED", "Floor area — Bedroom", "sqm", 12, [50, 150]),
  line("STO", "Floor area — Store", "sqm", 5, [50, 250]),
  line("BRK", "Brick work with common burnt clay bricks in superstructure", "cum", 10, [300, 50]),
  line("PLA", "Plaster to walls", "sqm", 100, [300, 150], { dsrCode: "13.4.1" }),
  line("DR1", "Door D1", "nos", 4, [300, 250]),
];
const REFERENCE: ReferenceBoq = {
  schema_version: REFERENCE_BOQ_SCHEMA, project: "SYNTHETIC metrics control (not a real project)",
  drawing: { sha256: SHA, pages: [1] }, preparedBy: "test fixture", preparedAt: "2026-10-17",
  preparedWithoutCunstructOutput: true, measurementConventions: "Synthetic.", lines: LINES,
};

type Sys = { key: string; item: string; qty: number; unit: string; at: [number, number] };
// SYNTHETIC extractor output: Kitchen right (within 1 %), Bedroom wrong (+10 %),
// Store omitted, brickwork wrong (−10 %), plaster in the wrong unit family (m
// against sqm), the door right, and a window the reference does not have.
const SYSTEM: Sys[] = [
  { key: "k-kit", item: "Floor area — Kitchen (Ground Floor)", qty: 20.1, unit: "sqm", at: [50, 50] },
  { key: "k-bed", item: "Floor area — Bedroom (Ground Floor)", qty: 13.2, unit: "sqm", at: [50, 150] },
  { key: "k-brk", item: "Brick work with common burnt clay bricks in superstructure", qty: 9, unit: "cum", at: [300, 50] },
  { key: "k-pla", item: "Plaster to walls", qty: 100, unit: "m", at: [300, 150] },
  { key: "k-dr1", item: "Door D1", qty: 4, unit: "nos", at: [300, 250] },
  { key: "k-fp", item: "Window W9", qty: 2, unit: "nos", at: [450, 400] },
];
const ANALYSIS = JSON.stringify({
  schema_version: "cunstruct.analysis.v1",
  items: SYSTEM.map((s) => ({
    key: s.key, item: s.item, quantity: s.qty, unit: s.unit, location: "Ground Floor", status: "MEASURED", confidence: null,
    source: { document_id: DOC, page: 1, evidence: [{ bbox: box(...s.at), page: 1 }] },
  })),
});
const DECISIONS: DecisionsFile = {
  schema_version: DECISIONS_SCHEMA, analysisSha256: sha256Text(ANALYSIS), reviewedBy: "synthetic reviewer", reviewedAt: "2026-10-17",
  reviewedWithoutReference: true,
  decisions: [
    { key: "k-kit", action: "accept" },
    { key: "k-bed", action: "correct", quantity: 12 },
    { key: "k-brk", action: "accept" },
    { key: "k-pla", action: "correct", quantity: 100, unit: "sqm" },
    { key: "k-dr1", action: "accept" },
    { key: "k-fp", action: "reject" },
  ],
};

let ix: DsrIndex;
const rateOf = (code: string) => seedCatalogue().find((i) => i.source === "DSR" && i.rate_year === "2023" && i.code === code)!.rate as number;

async function metricsFor(analysisJson: string): Promise<MetricsBlock> {
  const loaded = validateReferenceBoq(REFERENCE, SHA);
  const run = await runEndToEnd({ analysisJson, documentId: DOC, documentName: "Synthetic", policy: "accept-everything" });
  const report = scoreEndToEnd(run, loaded, "Synthetic", { drawingPageSizes: { 1: PAGE } });
  const r = recordsOf("synthetic", REFERENCE.lines, report.accuracy!, systemItemsOf(run), ix);
  return metricsOf(r.refs, r.systems);
}
const cat = (m: MetricsBlock, c: CategoryMetrics["category"]) => m.byCategory.find((x) => x.category === c)!;

beforeAll(() => { ix = buildPricingIndex(seedCatalogue()); });

describe("category rules (deterministic, from name and unit)", () => {
  it("maps typical item names", () => {
    expect(categoryOf("Floor area — Kitchen", "sqm")).toBe("floor_areas");
    expect(categoryOf("Floor area — Kitchen", "nos")).toBe("other"); // a floor area must be an area
    expect(categoryOf("Carpet area — Flat 2", "sqft")).toBe("floor_areas");
    expect(categoryOf("Door D1", "nos")).toBe("doors_windows");
    expect(categoryOf("Painting of doors", "sqm")).toBe("finishes"); // finishes rule comes first
    expect(categoryOf("Vitrified tile flooring", "sqm")).toBe("finishes");
    expect(categoryOf("R.C.C. slab M25", "cum")).toBe("structural");
    expect(categoryOf("Brick wall 230 mm", "cum")).toBe("masonry");
    expect(categoryOf("Water tank", "nos")).toBe("other");
  });
});

describe("percentiles", () => {
  it("median averages the two middle values; p90 is nearest-rank", () => {
    expect(median([10, 0.5])).toBe(5.25);
    expect(median([3, 1, 2])).toBe(2);
    expect(percentile([0.5, 10], 0.9)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(median([])).toBeNull();
  });
});

describe("DSR pricing of reference lines (real DSR 2023 seed)", () => {
  it("prices by the stated code, by a reliable matcher match, and leaves the rest unpriced", () => {
    const [, bed, , brk, pla, dr1] = LINES;
    expect(priceReferenceLine(pla, ix)).toMatchObject({ priced: true, dsrCode: "13.4.1", basis: "reference_dsr_code", rate: rateOf("13.4.1") });
    expect(priceReferenceLine(brk, ix)).toMatchObject({ priced: true, basis: "matcher_reliable", rate: rateOf("6.9") });
    expect(priceReferenceLine(bed, ix).priced).toBe(false);
    expect(priceReferenceLine(dr1, ix).priced).toBe(false);
  });
  it("never substitutes another item for a stated code that is not in the schedule", () => {
    const p = priceReferenceLine({ ...LINES[3], dsrCode: "99.99.99" } as ReferenceBoqLine, ix);
    expect(p).toMatchObject({ priced: false });
    expect((p as { reason: string }).reason).toMatch(/99\.99\.99 is not an item/);
  });
  it("does not price a stated code whose unit differs from the line's", () => {
    expect(priceReferenceLine({ ...LINES[4], unit: "cum" } as ReferenceBoqLine, ix).priced).toBe(false);
  });
});

describe("raw machine metrics on a SYNTHETIC run (omission, wrong quantity, false positive, unit mismatch, unpriced)", () => {
  let m: MetricsBlock;
  beforeAll(async () => { m = await metricsFor(ANALYSIS); });

  it("floor areas: an omission lowers recall; a wrong quantity shows in the % error; all unpriced", () => {
    const f = cat(m, "floor_areas");
    expect(f.recall).toMatchObject({ n: 2, of: 3, missedIds: ["STO"] });
    expect(f.precision).toMatchObject({ n: 2, of: 2, value: 1 });
    expect(f.quantity).toMatchObject({ compared: 2, withinTolerance: 1, outsideTolerance: 1, withPctError: 2 });
    expect(f.quantity.medianAbsPctError).toBeCloseTo(5.25, 9); // (0.5 % + 10 %) / 2
    expect(f.quantity.p90AbsPctError).toBeCloseTo(10, 9);
    expect(f.rupeeWeighted).toMatchObject({ pricedLines: 0, unpricedLines: 3, unpricedShare: 1 });
    expect(f.rupeeWeighted.matched.value).toBeNull(); // nothing priced: no ₹ figure, never zero
  });

  it("masonry: a −10 % quantity is a 10 % ₹-weighted error at the matcher's DSR rate", () => {
    const b = cat(m, "masonry");
    expect(b.recall).toMatchObject({ n: 1, of: 1 });
    expect(b.quantity.medianAbsPctError).toBeCloseTo(10, 9);
    expect(b.rupeeWeighted.matched.errorRs).toBeCloseTo(1 * rateOf("6.9"), 6);
    expect(b.rupeeWeighted.matched.baseRs).toBeCloseTo(10 * rateOf("6.9"), 6);
    expect(b.rupeeWeighted.matched.value).toBeCloseTo(0.1, 9);
  });

  it("finishes: a unit-family mismatch is counted, gets no % error, and costs the whole line in ₹", () => {
    const p = cat(m, "finishes");
    expect(p.recall).toMatchObject({ n: 1, of: 1 });
    expect(p.quantity).toMatchObject({ compared: 1, withinTolerance: 0, outsideTolerance: 0, unitMismatchIds: ["PLA"], withPctError: 0, medianAbsPctError: null });
    expect(p.rupeeWeighted.matched.value).toBeCloseTo(1, 9);
  });

  it("doors/windows: a false positive lowers precision only", () => {
    const d = cat(m, "doors_windows");
    expect(d.recall).toMatchObject({ n: 1, of: 1 });
    expect(d.precision).toMatchObject({ n: 1, of: 2, value: 0.5 });
    expect(d.precision.measuredInBoqBy.no_reference).toBe(1);
    expect(d.quantity.medianAbsPctError).toBe(0);
    expect(d.rupeeWeighted).toMatchObject({ pricedLines: 0, unpricedShare: 1 });
  });

  it("all: ₹ error with omissions counts every priced line; unpriced share is by line count", () => {
    const a = cat(m, "all");
    const r69 = rateOf("6.9"), r1341 = rateOf("13.4.1");
    expect(a.recall).toMatchObject({ n: 5, of: 6 });
    expect(a.precision).toMatchObject({ n: 5, of: 6 });
    expect(a.rupeeWeighted.withOmissions.value).toBeCloseTo((1 * r69 + 100 * r1341) / (10 * r69 + 100 * r1341), 9);
    expect(a.rupeeWeighted.unpricedShare).toBeCloseTo(4 / 6, 9);
    expect(cat(m, "structural").recall.value).toBeNull(); // empty category: null, never 0
  });
});

describe("human-corrected metrics are computed from a separate run", () => {
  it("validates the decisions file strictly", () => {
    expect(validateDecisions(DECISIONS, ANALYSIS).ok).toBe(true);
    const bad = validateDecisions({ ...DECISIONS, analysisSha256: "0".repeat(64), reviewedWithoutReference: false, decisions: DECISIONS.decisions.slice(1) }, ANALYSIS);
    expect(bad.ok).toBe(false);
    const errs = (bad as { errors: string[] }).errors.join(" ");
    expect(errs).toMatch(/analysisSha256/);
    expect(errs).toMatch(/reviewedWithoutReference/);
    expect(errs).toMatch(/undecided: k-kit/);
  });

  it("corrections fix quantity and unit, a rejection removes the false positive; the omission stays", async () => {
    const corrected = applyDecisions(ANALYSIS, DECISIONS);
    const h = await metricsFor(corrected);
    expect(cat(h, "floor_areas").recall).toMatchObject({ n: 2, of: 3, missedIds: ["STO"] });
    expect(cat(h, "floor_areas").quantity.p90AbsPctError).toBeCloseTo(0.5, 9);
    expect(cat(h, "finishes").quantity).toMatchObject({ withinTolerance: 1, unitMismatchIds: [] });
    expect(cat(h, "doors_windows").precision).toMatchObject({ n: 1, of: 1 });
    // The raw machine figures are unchanged by the human run.
    const raw = await metricsFor(ANALYSIS);
    expect(cat(raw, "doors_windows").precision).toMatchObject({ n: 1, of: 2 });
  });
});

describe("multi-set runner on SYNTHETIC inputs", () => {
  it("writes per-set gates and metrics and an aggregate that keeps roles and raw/human apart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bench-synthetic-"));
    writeFileSync(join(dir, "analysis.json"), ANALYSIS);
    writeFileSync(join(dir, "reference.json"), JSON.stringify(REFERENCE));
    writeFileSync(join(dir, "decisions.json"), JSON.stringify(DECISIONS));
    const contract = Object.fromEntries(LINES.map((l) => [l.id, "in"]));
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({
      schema_version: MANIFEST_SCHEMA,
      sets: [
        { id: "syn-a", role: "acceptance", drawingSha256: SHA, analysis: "analysis.json", analysisSha256: sha256Text(ANALYSIS), reference: "reference.json", contract, pageSizes: { 1: PAGE }, decisions: "decisions.json" },
        { id: "syn-b", role: "development", drawingSha256: SHA, analysis: "analysis.json", reference: "reference.json", contract, pageSizes: { 1: PAGE } },
        { id: "syn-bad", role: "acceptance", drawingSha256: "e".repeat(64), analysis: "analysis.json", reference: "reference.json" },
      ],
    }));
    const out = join(dir, "out");
    const { summary } = await runManifest(join(dir, "manifest.json"), out, ix);

    for (const f of ["gates.json", "metrics.json", "g5-worksheet.json", "report-accept-everything.json", "report-human-corrected.json"]) expect(existsSync(join(out, "syn-a", f)), f).toBe(true);
    expect(existsSync(join(out, "syn-b", "report-human-corrected.json"))).toBe(false);
    expect(existsSync(join(out, "syn-bad", "error.json"))).toBe(true);

    const [a, b, bad] = summary.sets;
    expect(a.gates!.find((g) => g.gate.startsWith("G1"))).toMatchObject({ value: "3", pass: false }); // Bedroom, brickwork, plaster unit
    expect(a.gates!.find((g) => g.gate.startsWith("G2"))).toMatchObject({ value: "1", pass: false }); // the window
    expect(a.gates!.find((g) => g.gate.startsWith("G3"))).toMatchObject({ value: "5/6", pass: true });
    expect(a.outcome).toMatch(/^NOT ACCEPTED/);
    expect(b.outcome).toMatch(/^development set/);
    expect(bad.outcome).toMatch(/^NOT SCORED — reference not accepted/);

    const agg = summary.aggregate as Record<string, { setsScored: string[]; rawMachine: { byCategory: CategoryMetrics[] } | null; humanCorrected: { sets: string[]; byCategory: CategoryMetrics[] } | null }>;
    expect(agg.acceptance.setsScored).toEqual(["syn-a"]);
    expect(agg.acceptance.rawMachine!.byCategory.find((c) => c.category === "doors_windows")!.precision).toMatchObject({ n: 1, of: 2 });
    expect(agg.acceptance.humanCorrected!.byCategory.find((c) => c.category === "doors_windows")!.precision).toMatchObject({ n: 1, of: 1 });
    expect(agg.development.setsScored).toEqual(["syn-b"]);
    expect(agg.development.humanCorrected).toBeNull();

    const metrics = JSON.parse(readFileSync(join(out, "syn-a", "metrics.json"), "utf8"));
    expect(metrics.rawMachine.label).toMatch(/^RAW MACHINE/);
    expect(metrics.humanCorrected.label).toMatch(/^HUMAN-CORRECTED/);
    expect(metrics.humanCorrected.decisions).toEqual({ accept: 3, correct: 2, reject: 1 });
  });
});
