// The AI extraction prompt must actually tell a provider how to produce
// claim-level, multi-region, multi-page evidence — otherwise the claim
// feature (claimEvidence.test.ts, PdfEvidenceViewer.test.tsx) is only ever
// reachable via hand-authored JSON, never from a real AI-generated analysis.

import { describe, it, expect } from "vitest";
import { buildAnalysisPrompt, ANALYSIS_SCHEMA_HINT, CANDIDATES_SCHEMA_HINT } from "./analysisPrompt";

describe("analysis prompt — claim-level evidence guidance", () => {
  const p = buildAnalysisPrompt();

  it("names all five claim types", () => {
    for (const claim of ["general", "quantity", "dimension", "specification", "location"]) {
      expect(p).toMatch(new RegExp(claim, "i"));
    }
  });

  it("instructs that different claims may use different evidence regions and pages", () => {
    expect(p).toMatch(/different (claims|evidence regions)/i);
    expect(p).toMatch(/different pages/i);
  });

  it("instructs that the same region may support multiple claims", () => {
    expect(p).toMatch(/same evidence region may support more than one claim/i);
  });

  it("instructs that one claim may be supported by multiple regions", () => {
    expect(p).toMatch(/single claim may also be supported by more than one evidence region/i);
  });

  it("states the rendered/rotation-safe coordinate convention", () => {
    expect(p).toMatch(/rendered coordinate space/i);
    expect(p).toMatch(/rotated/i);
  });

  it("forbids inventing evidence coordinates and prefers PENDING over fabrication", () => {
    expect(p).toMatch(/never invent evidence coordinates/i);
    expect(p).toMatch(/status pending/i);
  });

  it("the schema hint's evidence entries carry a claim field", () => {
    expect(ANALYSIS_SCHEMA_HINT).toMatch(/"claim":\s*"general"/);
    expect(ANALYSIS_SCHEMA_HINT).toMatch(/"claim":\s*"quantity"/);
  });

  it("the schema hint demonstrates evidence on more than one page", () => {
    const pages = [...ANALYSIS_SCHEMA_HINT.matchAll(/"page":\s*(\d+)/g)].map((m) => m[1]);
    expect(new Set(pages).size).toBeGreaterThan(1);
  });

  it("the schema hint demonstrates multiple regions for the same claim", () => {
    const locationEntries = ANALYSIS_SCHEMA_HINT.split("\n").filter((l) => l.includes('"claim": "location"'));
    expect(locationEntries.length).toBeGreaterThan(1);
  });
});

describe("analysis prompt — conflicting-source candidates guidance", () => {
  const p = buildAnalysisPrompt();

  it("instructs never to pick or average disagreeing values", () => {
    expect(p).toMatch(/do not pick one/i);
    expect(p).toMatch(/do not average/i);
  });

  it("instructs using PENDING with a candidates array instead", () => {
    expect(p).toMatch(/`candidates` array/);
    expect(p).toMatch(/status pending/i);
  });

  it("includes the candidates example, with a value and a basis per entry", () => {
    expect(p).toContain(CANDIDATES_SCHEMA_HINT);
    expect(CANDIDATES_SCHEMA_HINT).toMatch(/"value":\s*\d+/);
    expect(CANDIDATES_SCHEMA_HINT).toMatch(/"basis":\s*"/);
  });

  it("the candidates example itself uses status PENDING and a null quantity", () => {
    expect(CANDIDATES_SCHEMA_HINT).toMatch(/"quantity":\s*null/);
    expect(CANDIDATES_SCHEMA_HINT).toMatch(/"status":\s*"PENDING"/);
  });
});
