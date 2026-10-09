// SRIKAKULAM SYNTHETIC NON-REGRESSION CHECK (Scope B) — proves that adding
// calculation_data parsing to parseAnalysisV1 does not change how the
// existing Srikakulam benchmark fixtures parse. This is a PARSING/SCHEMA
// regression check only, run entirely synthetically (no live model call,
// no network) — it is NOT a measurement of real-world drawing accuracy, and
// is never described as one. A manually verified accuracy gold set does not
// exist and remains out of scope for this increment.
import { describe, it, expect } from "vitest";
import { parseAnalysisV1 } from "./analysisSchemaV1";
import { SRIKAKULAM_BENCHMARK, perfectRunFor } from "./srikakulamBenchmark";

/** Model-shaped (OpenAI structured-output strict-schema) JSON for one
 *  perfectRunFor() item, with calculation_data explicitly null — exactly
 *  what today's real model responses look like, since none of them emit
 *  calculation_data yet. */
function toModelShapedJson(item: ReturnType<typeof perfectRunFor>[number]) {
  return {
    key: item.key, item: item.item, description: null,
    quantity: item.quantity, unit: item.unit ?? null,
    dimension: item.dimension ?? null, specification: item.specification ?? null,
    location: item.location ?? null,
    source: { document_id: null, document: null, page: null, evidence: [] },
    confidence: item.confidence, status: item.aiStatus,
    calculation: null, calculation_data: null, notes: null, candidates: [],
  };
}

describe("Srikakulam benchmark fixtures — parsing/schema non-regression with calculation_data present-but-null", () => {
  for (const c of SRIKAKULAM_BENCHMARK) {
    it(`${c.id}: every expected item parses with no warnings and calculationData left undefined`, () => {
      const expected = perfectRunFor(c);
      if (expected.length === 0) return; // nothing to assert for a zero-item case
      const payload = { schema_version: "cunstruct.analysis.v1", items: expected.map(toModelShapedJson) };
      const result = parseAnalysisV1(JSON.stringify(payload));

      expect(result.ok).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(result.analysis!.items).toHaveLength(expected.length);
      result.analysis!.items.forEach((parsed, i) => {
        expect(parsed.calculationData).toBeUndefined();
        expect(parsed.quantity).toBe(expected[i].quantity);
        expect(parsed.aiStatus).toBe(expected[i].aiStatus);
        expect(parsed.key).toBe(expected[i].key);
      });
    });
  }
});
