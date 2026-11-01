import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { LinearDimension } from "@/lib/measurement-lab/baselines/engine-9ac1f71/linearDimensions";
import { parseAnalysisV1 } from "@/lib/review/analysisSchemaV1";
import { classifyReviewItem } from "@/lib/review/applyReview";
import { toAnalysisPayload } from "@/lib/review/measuredQuantities";
import { downstreamEligibility, evidenceFromEngine, MeasurementEvidenceV1, toReviewWorkflowCandidate, withReview, type ReviewerRecord } from "./evidenceContract";

// SYNTHETIC engine records and reviewer records only.
const FP = "f".repeat(64), SHA = "c".repeat(64);
const dim = (over: Partial<LinearDimension> = {}): LinearDimension => ({
  id: "D1-1", page: 1, text: "1,730", parsed: { text: "1,730", value: 1730, unit: null, notation: "unitless" } as LinearDimension["parsed"],
  unit: "mm", unitBasis: "page-note", statedMm: 1730, textAnchor: [1113.35236544, 1112.54], textHeight: 10.01112,
  line: { a: [1088.84, 1109], b: [1138.46, 1109], joinedAcrossText: true },
  span: { start: [1088.8400000000001, 1109], end: [1138.4774683544304, 1109], length: 49.637468354430155, ends: ["filled-tick", "filled-tick"] },
  endpoints: { decision: "valid-pair", reason: "pair", start: [1088.8400000000001, 1109], end: [1138.4774683544304, 1109], length: 49.637468354430155,
    ends: [{ at: 0, kind: "filled-tick", shapes: [419], evidence: "e" }, { at: 49.637468354430155, kind: "filled-tick", shapes: [432], evidence: "e" }], textPosition: -0.006, left: [{ at: 0, kind: "filled-tick", shapes: [419], evidence: "e" }], right: [{ at: 49.637468354430155, kind: "filled-tick", shapes: [432], evidence: "e" }] },
  association: { decision: "associated", measures: "grid-to-grid", ends: [{ kind: "grid", labels: ["6"], evidence: "g" }, { kind: "grid", labels: ["7"], evidence: "g" }], reason: "Measured grid to grid." },
  scaleCheck: { region: "S1", valuePerPoint: 34.886, basedOn: 68, measured: 1731.7, deviation: 1.7, tolerance: 26 }, measured: { value: 1731.7, mm: 1731.7 },
  status: "consistent", decisions: { text: "detected", parse: "parsed", unit: "page-note", line: "found", endpoints: "valid-pair", association: "associated", scale: "consistent", overall: "acceptable" },
  reasons: [], role: "chain", ...over,
});
const ctx = { file_name: "drawing.pdf", file_sha256: SHA, candidate_fingerprint: FP };
const rec = (over: Partial<ReviewerRecord> = {}): ReviewerRecord => ({ reviewer_id: "IR-1", independent: true, blind: true, verdict: "correct", at: "2026-11-02T10:00", corrected_value: null, corrected_endpoints: null, resolved_element: null, source: "r1.csv row 4", ...over });
const held = () => dim({ decisions: { ...dim().decisions, association: "ambiguous", overall: "hold" }, association: { decision: "ambiguous", measures: null, reason: "x", ends: [{ kind: "grid", labels: ["6"], evidence: "g" }, { kind: "ambiguous", candidates: ["edge before the line", "edge beyond the line"], reason: "Extension lines leave this end in both directions" }] }, reasons: ["At least one end could be measured from more than one element."] });

describe("measurement evidence contract v1", () => {
  it("serializes and reads back losslessly, preserving printed text and coordinates exactly", () => {
    const e = evidenceFromEngine(dim(), ctx);
    const back = MeasurementEvidenceV1.parse(JSON.parse(JSON.stringify(e)));
    expect(back).toEqual(e);
    expect(back.printed.text).toBe("1,730");
    expect(back.normalized.value).toBe(1730);
    expect(back.printed.text_anchor_pt).toEqual([1113.35236544, 1112.54]);
    expect(back.endpoints!.end).toEqual([1138.4774683544304, 1109]);
    expect(back.terminators.map((t) => t.chosen)).toEqual([true, true]);
  });

  it("keeps every stage decision; nothing is collapsed into one number", () => {
    const e = evidenceFromEngine(held(), ctx);
    expect(Object.keys(e.decisions)).toEqual(["text", "parse", "unit", "line", "endpoints", "association", "scale", "overall"]);
    expect(e.association.ends[1]).toMatchObject({ kind: "ambiguous", candidates: ["edge before the line", "edge beyond the line"] });
    expect(e).not.toHaveProperty("confidence");
  });

  it("an engine acceptance is not a verification: unreviewed evidence is never eligible", () => {
    const e = evidenceFromEngine(dim(), ctx);
    expect(e.review.state).toBe("unreviewed");
    expect(downstreamEligibility(e).eligible).toBe(false);
    expect(() => toReviewWorkflowCandidate(e, "DIM-1")).toThrow(/not eligible/);
  });

  it("held measurements cannot be marked verified by fiat; developer review is not independent", () => {
    const e = evidenceFromEngine(held(), ctx);
    expect(MeasurementEvidenceV1.safeParse({ ...e, review: { state: "independently-verified", records: [] } }).success).toBe(false);
    const dev = withReview(e, [rec({ reviewer_id: "developer", independent: false, blind: false })]);
    expect(dev.review.state).toBe("developer-reviewed");
    expect(downstreamEligibility(dev).eligible).toBe(false);
  });

  it("an ambiguous association is not applied unless an independent reviewer names the element", () => {
    const e = withReview(evidenceFromEngine(held(), ctx), [rec()]);
    expect(e.review.state).toBe("independently-verified");
    expect(downstreamEligibility(e)).toMatchObject({ eligible: false, reasons: [expect.stringMatching(/association is ambiguous/)] });
    const named = withReview(evidenceFromEngine(held(), ctx), [rec({ resolved_element: { kind: "grid-to-edge", end1: "grid 6", end2: "outer face of column" } })]);
    expect(downstreamEligibility(named).eligible).toBe(true);
  });

  it("disagreeing independent reviewers leave the measurement in adjudication, not eligible", () => {
    const e = withReview(evidenceFromEngine(dim(), ctx), [rec(), rec({ reviewer_id: "IR-2", verdict: "incorrect" })]);
    expect(e.review.state).toBe("needs-adjudication");
    expect(downstreamEligibility(e).eligible).toBe(false);
  });

  it("a verified measurement becomes only a PENDING, quantity-less review candidate: never a priced BOQ record", () => {
    const e = withReview(evidenceFromEngine(dim(), ctx), [rec()]);
    const c = toReviewWorkflowCandidate(e, "DIM-1");
    expect(c.quantity).toBeNull();
    expect(c.status).toBe("PENDING");
    for (const k of ["rate", "price", "amount", "unit_price", "total"]) expect(c).not.toHaveProperty(k);
    expect(c.dimension).toBe('1730 mm (printed "1,730")');
    // through the EXISTING contract, unchanged: it parses as a pending item...
    const parsed = parseAnalysisV1(JSON.stringify({ schema_version: "cunstruct.analysis.v1", items: [c] }));
    expect(parsed.ok).toBe(true);
    const ai = parsed.analysis!.items[0];
    expect(ai).toMatchObject({ quantity: null, aiStatus: "PENDING" });
    // ...and the existing apply-review path refuses it until a person reviews it there
    expect(classifyReviewItem({ id: "r1", ai, reviewStatus: "PENDING_REVIEW" }, []).classification).toBe("NOT_ELIGIBLE");
  });
});

describe("existing contracts and the production boundary", () => {
  it("toAnalysisPayload still emits the cunstruct.analysis.v1 shape it did before", () => {
    expect(toAnalysisPayload([])).toEqual({ schema_version: "cunstruct.analysis.v1", items: [] });
  });

  it("the engine reaches the product only through the admin-only, lazy-loaded Measurement Lab", () => {
    const root = path.resolve(__dirname, "../..");
    const importers = (pattern: RegExp) => {
      const out: string[] = [];
      const walk = (dir: string) => {
        for (const f of readdirSync(dir)) {
          const p = path.join(dir, f);
          if (statSync(p).isDirectory()) { if (f !== "__fixtures__") walk(p); continue; }
          if (/\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && pattern.test(readFileSync(p, "utf8"))) out.push(path.relative(root, p));
        }
      };
      walk(root);
      return out.sort();
    };
    // only the lab core imports the lab's engines; only the lazy launcher loads the lab panel;
    // only the verification screen renders the launcher
    expect(importers(/from\s+["']@\/lib\/measurement-lab\/core["']/)).toEqual(["components/review/MeasurementLabPanel.tsx", "components/review/MeasurementReviewWorkspace.tsx"]);
    // the review workspace is part of the lazy lab chunk: only the panel renders it
    expect(importers(/from\s+["'][^"']*MeasurementReviewWorkspace["']/)).toEqual(["components/review/MeasurementLabPanel.tsx"]);
    expect(importers(/import\(["']\.\/MeasurementLabPanel["']\)/)).toEqual(["components/review/MeasurementLabLauncher.tsx"]);
    expect(importers(/from\s+["'][^"']*MeasurementLabPanel["']/)).toEqual([]); // never a static import
    expect(importers(/from\s+["'][^"']*MeasurementLabLauncher["']/)).toEqual(["pages/ops/BoqReviewWorkstation.tsx"]);
  });

  it("no product code imports the measurement engine or the measurement-quality tooling (the lab core excepted)", () => {
    const root = path.resolve(__dirname, "../..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) { if (f !== "__fixtures__") walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(f) || /\.test\.tsx?$/.test(f)) continue;
        const rel = path.relative(root, p);
        if (rel.startsWith(path.join("lib", "measurement-quality"))) continue;
        // the Measurement Lab runs both engines by design (owner decision); it is admin-only and lazy-loaded (test above)
        if (rel.startsWith(path.join("lib", "measurement-lab"))) continue;
        // the engine's own modules may import each other
        if (["linearDimensions.ts", "dimensionTerminators.ts", "dimensionAssociation.ts"].includes(f)) continue;
        const src = readFileSync(p, "utf8");
        if (/from\s+["'][^"']*(measurement-quality|linearDimensions|dimensionTerminators|dimensionAssociation)["']/.test(src)) offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
