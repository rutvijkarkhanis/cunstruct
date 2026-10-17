// PROTOCOL v1.1 GATES — the frozen-software hashes (§2) and the §5 gates read
// off one scorer report. Moved unchanged out of score-set-a.test.ts so the
// multi-set runner and the single-set driver share one definition; the gate
// logic itself is identical to the version first used for the synthetic dry run.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EndToEndReport } from "@/lib/e2e/boqEndToEndScorer";
import type { ReferenceBoq } from "@/lib/e2e/boqReference";

export const ROOT = resolve(__dirname, "../..");

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

export const sha256File = (p: string) => createHash("sha256").update(readFileSync(resolve(ROOT, p))).digest("hex");
export const sha256Text = (s: string) => createHash("sha256").update(s).digest("hex");

/** Current hashes of the frozen files, for comparison with FROZEN_V1_1. */
export const frozenHashesNow = () => Object.fromEntries(Object.keys(FROZEN_V1_1).map((p) => [p, sha256File(p)]));
export const frozenHashesMatch = () => Object.entries(frozenHashesNow()).every(([p, h]) => FROZEN_V1_1[p] === h);

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
