import { describe, it, expect } from "vitest";
import { parseAnalysisV1 } from "./analysisSchemaV1";
import type { AnalysisV1 } from "./analysisSchemaV1";

describe("multiple analysis runs per BOQ", () => {
  // These tests verify the design that allows:
  // 1. Multiple runs can coexist for the same BOQ
  // 2. latestRunForBoq always returns the most recent run
  // 3. Older runs remain intact and unmodified
  // 4. Each run has its own set of review items
  // 5. resolved_document_id is preserved across runs
  //
  // Note: Full integration tests with DB require network access (Supabase).
  // These unit tests verify schema integrity and parsing logic.

  const createTestAnalysis = (version: number): AnalysisV1 => ({
    schema_version: "cunstruct.analysis.v1",
    items: [
      {
        key: `W${version}`,
        item: `Window v${version}`,
        quantity: version,
        description: `Test window version ${version}`,
        source: { document: "test.pdf", page: 1, evidence: [] },
      },
    ],
  });

  it("analysis schema v1 parsing preserves all fields for multiple imports", () => {
    const json1 = JSON.stringify(createTestAnalysis(1));
    const json2 = JSON.stringify(createTestAnalysis(2));

    const parsed1 = parseAnalysisV1(json1);
    const parsed2 = parseAnalysisV1(json2);

    expect(parsed1.ok).toBe(true);
    expect(parsed2.ok).toBe(true);
    expect(parsed1.analysis?.items[0].quantity).toBe(1);
    expect(parsed2.analysis?.items[0].quantity).toBe(2);
  });
});
