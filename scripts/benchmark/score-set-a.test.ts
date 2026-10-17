// SET A SCORING DRIVER — runs the frozen extraction acceptance protocol
// (docs/benchmarks/extraction-acceptance-protocol.md, amended by
// extraction-acceptance-protocol-v1.1.md) on one drawing. It only CALLS the
// frozen functions (runEndToEnd, scoreEndToEnd, validateReferenceBoq,
// systemItemsOf) unchanged; it adds no scoring logic beyond reading the gates
// off their report.
//
// Not part of the test suite (outside vitest.config include). Run with:
//   BENCH_ANALYSIS=<extractor output .json> BENCH_REFERENCE=<reference .json> \
//   BENCH_DRAWING_SHA=<sha256 of the drawing PDF> BENCH_CONTRACT=<{lineId:"in"|"out"} .json> \
//   [BENCH_PAGE_SIZES=<{"1":{"width":..,"height":..}} .json>] [BENCH_DOC_NAME=...] BENCH_OUT=<dir> \
//   npx vitest run --config scripts/benchmark/vitest.bench.config.ts
// Without the inputs it verifies the frozen hashes only. Outputs stay local
// (BENCH_OUT); never commit them.
import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/integrations/supabase/client", async () => await import("@/lib/e2e/inMemorySupabase"));

import { runEndToEnd } from "@/lib/e2e/pipeline";
import { scoreEndToEnd, systemItemsOf, type EndToEndReport } from "@/lib/e2e/boqEndToEndScorer";
import { validateReferenceBoq, type ReferenceBoq } from "@/lib/e2e/boqReference";

const ROOT = resolve(__dirname, "../..");
/** Protocol v1.1 §2 (v1 with pipeline.ts updated for the "Quantity basis" CSV column). */
export const FROZEN_V1_1: Record<string, string> = {
  "scripts/drawing-ocr/drawing_ocr.py": "13e8dcd010fc22797a64ae946b14de972102d57c96cf2c24a1cf7e01850441f9",
  "scripts/drawing-ocr/layout.py": "87c6345f1e993c313a6263149afd40798f48df4dffa49a64f58cb6254675a679",
  "src/lib/e2e/boqEndToEndScorer.ts": "22bf1de1f2c7336159096f4c06b08f158b6afaed478af096090b7dc278e0857a",
  "src/lib/e2e/boqReference.ts": "8a5d6fd6f8d64c6da39b0d8ab4978f935349f1219dcb45e2e3b3508db545ffec",
  "src/lib/e2e/referenceMatching.ts": "9a0a71fba6cd20613f35416726e020760df0c0a206b6310b9f09fe90a6a787b4",
  "src/lib/e2e/pipeline.ts": "ea71ff7db31b56b598ca31d6d4817bfde9544b889f6380d7e81a066e27ff5357",
  "src/lib/e2e/reviewPolicy.ts": "95864f01295404dc1708f8f533b2f37b1c41e2006465a97053a2f050cfa36014",
};
const sha = (p: string) => createHash("sha256").update(readFileSync(resolve(ROOT, p))).digest("hex");
const env = process.env;
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));

export interface GateResult { gate: string; measure: string; value: string; threshold: string; pass: boolean | "manual" }

/** The protocol §5 gates, read off one accept-everything report. */
export function gates(report: EndToEndReport, reference: ReferenceBoq, contract: Record<string, "in" | "out">, pageOfItem: Map<string, number | null>): { results: GateResult[]; g5Worksheet: object[] } {
  const a = report.accuracy!;
  const measured = reference.lines.filter((l) => (l.status ?? "measured") === "measured");
  const inContract = measured.filter((l) => contract[l.id] === "in");
  const untagged = measured.filter((l) => contract[l.id] !== "in" && contract[l.id] !== "out").map((l) => l.id);
  const notFound = new Set([...a.scope.missedIds, ...a.scope.ambiguousIds]);
  const foundIn = inContract.filter((l) => !notFound.has(l.id)).length;
  const g2 = a.falsePositives.inBoq + a.nonMeasurable.measuredAnyway.length + a.outOfScope.producedBySystem.length;
  const refPage = new Map(reference.lines.map((l) => [l.id, l.sourcePage ?? null]));
  const paired = a.matches.filter((m) => m.status === "measured");
  const samePage = paired.filter((m) => refPage.get(m.referenceId) != null && pageOfItem.get(m.reviewItemId) === refPage.get(m.referenceId)).length;
  const results: GateResult[] = [
    { gate: "G1 Correctness", measure: "accuracy.quantities.incorrect", value: String(a.quantities.incorrect), threshold: "0", pass: a.quantities.incorrect === 0 },
    { gate: "G2 No unsupported quantities", measure: "falsePositives.inBoq + nonMeasurable.measuredAnyway + outOfScope.producedBySystem", value: String(g2), threshold: "0", pass: g2 === 0 },
    { gate: "G3 Coverage, in-contract", measure: "found / in-contract measured", value: `${foundIn}/${inContract.length}`, threshold: "≥ 0.70", pass: untagged.length === 0 && inContract.length > 0 && foundIn / inContract.length >= 0.7 },
    { gate: "G4 Coverage, all measured", measure: "scope.found / scope.of", value: `${a.scope.found}/${a.scope.of}`, threshold: "reported", pass: true },
    { gate: "G5 No silent omission", measure: "missed in-contract lines on a page with an unresolved item", value: `${inContract.filter((l) => notFound.has(l.id)).length} to check`, threshold: "100 % (manual)", pass: "manual" },
    { gate: "G6 Provenance", measure: "paired lines with source page = reference sourcePage", value: `${samePage}/${paired.length}`, threshold: "100 %", pass: paired.length > 0 && samePage === paired.length },
  ];
  if (untagged.length) results.push({ gate: "Contract tagging", measure: "measured lines not tagged in/out", value: untagged.join(", "), threshold: "none", pass: false });
  const g5Worksheet = inContract.filter((l) => notFound.has(l.id)).map((l) => ({
    referenceId: l.id, item: l.item, sourcePage: l.sourcePage ?? null,
    unresolvedOnSamePage: "fill in: review item id(s) the extractor emitted unresolved on this page/region, or NONE",
  }));
  return { results, g5Worksheet };
}

describe("Set A scoring (protocol v1.1)", () => {
  it("frozen software matches protocol v1.1 §2", () => {
    const now = Object.fromEntries(Object.keys(FROZEN_V1_1).map((p) => [p, sha(p)]));
    expect(now).toEqual(FROZEN_V1_1);
  });

  it.runIf(!!env.BENCH_ANALYSIS && !!env.BENCH_REFERENCE)("scores the drawing", async () => {
    const out = resolve(env.BENCH_OUT ?? "benchmark-inputs/set-a-out");
    mkdirSync(out, { recursive: true });
    const analysisJson = readFileSync(env.BENCH_ANALYSIS!, "utf8");
    const loaded = validateReferenceBoq(json(env.BENCH_REFERENCE!), env.BENCH_DRAWING_SHA ?? "");
    expect(loaded.status, JSON.stringify(loaded)).toBe("loaded");
    const reference = (loaded as { reference: ReferenceBoq }).reference;
    const contract = env.BENCH_CONTRACT ? json(env.BENCH_CONTRACT) : {};
    const pageSizes = env.BENCH_PAGE_SIZES ? json(env.BENCH_PAGE_SIZES) : undefined;
    const doc = env.BENCH_DOC_NAME ?? "Set A drawing";
    const summary: Record<string, unknown> = { analysisSha256: createHash("sha256").update(analysisJson).digest("hex"), drawingSha256: env.BENCH_DRAWING_SHA };
    for (const policy of ["accept-everything", "accept-evidenced-measurements"] as const) {
      const run = await runEndToEnd({ analysisJson, documentId: "doc-set-a", documentName: doc, policy });
      const report = scoreEndToEnd(run, loaded, doc, { drawingPageSizes: pageSizes });
      writeFileSync(resolve(out, `report-${policy}.json`), JSON.stringify(report, null, 2));
      const pageOf = new Map(systemItemsOf(run).map((s) => [s.reviewItemId, s.evidence?.page ?? null]));
      const g = gates(report, reference, contract, pageOf);
      summary[policy] = g.results;
      if (policy === "accept-everything") writeFileSync(resolve(out, "g5-worksheet.json"), JSON.stringify(g.g5Worksheet, null, 2));
    }
    writeFileSync(resolve(out, "gates.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  });
});
