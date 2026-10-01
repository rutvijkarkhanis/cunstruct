// Tests for the Find Similar edge-function request-handling logic
// (supabase/functions/ai-analysis/findSimilarHandler.ts). That file can't
// be exercised via index.ts/Deno.serve under Vitest at all (`npm:`
// specifiers, Deno globals, no exports) — same reason identify's own
// branch has never had an automated test. handleFindSimilar is a pure,
// dependency-injected function instead, so it's imported and driven
// directly here, same precedent as analysisValidation.test.ts importing a
// supabase/functions/_shared module straight into a Vitest file.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { handleFindSimilar, type FindSimilarDeps } from "../../../supabase/functions/ai-analysis/findSimilarHandler";
import { SIMILAR_SCHEMA_V1 } from "../review/findSimilarSchemaV1";

const REFERENCE = { label: "Door", description: "Single leaf door", evidence: [{ bbox: [10, 20, 30, 40] as [number, number, number, number], page: 2 }] };

function deps(overrides: Partial<FindSimilarDeps> = {}): FindSimilarDeps {
  return {
    loadDocumentFile: vi.fn(async () => ({ filename: "plan.pdf", bytes: new Uint8Array([1, 2, 3]) })),
    callOpenAi: vi.fn(async () => ({ rawJson: JSON.stringify({ schema_version: SIMILAR_SCHEMA_V1, matches: [] }) })),
    ...overrides,
  };
}

describe("handleFindSimilar — happy paths", () => {
  it("valid request returns a 200 with the parsed result", async () => {
    const d = deps({
      callOpenAi: vi.fn(async () => ({
        rawJson: JSON.stringify({
          schema_version: SIMILAR_SCHEMA_V1,
          matches: [{ label: "Door", description: "Another door", confidence: 0.7, evidence: [{ bbox: [1, 1, 2, 2], page: 1 }] }],
        }),
      })),
    });
    const res = await handleFindSimilar({ documentId: "doc-1", reference: REFERENCE }, d);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    if (res.body.ok) {
      expect(res.body.result.matches).toHaveLength(1);
      expect(res.body.result.matches[0].label).toBe("Door");
    }
  });

  it("supports multiple matches in one response", async () => {
    const d = deps({
      callOpenAi: vi.fn(async () => ({
        rawJson: JSON.stringify({
          schema_version: SIMILAR_SCHEMA_V1,
          matches: [
            { label: "Door", confidence: 0.9, evidence: [{ bbox: [1, 1, 2, 2], page: 1 }] },
            { label: "Door", confidence: 0.4, evidence: [{ bbox: [3, 3, 4, 4], page: 1 }] },
            { label: "Door", confidence: 0.2, evidence: [{ bbox: [5, 5, 6, 6], page: 4 }] },
          ],
        }),
      })),
    });
    const res = await handleFindSimilar({ documentId: "doc-1", reference: REFERENCE }, d);
    expect(res.status).toBe(200);
    if (res.body.ok) expect(res.body.result.matches).toHaveLength(3);
  });

  it("matches can span multiple pages in a single response", async () => {
    const d = deps({
      callOpenAi: vi.fn(async () => ({
        rawJson: JSON.stringify({
          schema_version: SIMILAR_SCHEMA_V1,
          matches: [
            { label: "Door", confidence: 0.9, evidence: [{ bbox: [1, 1, 2, 2], page: 1 }] },
            { label: "Door", confidence: 0.8, evidence: [{ bbox: [3, 3, 4, 4], page: 12 }] },
          ],
        }),
      })),
    });
    const res = await handleFindSimilar({ documentId: "doc-1", reference: REFERENCE }, d);
    if (res.body.ok) {
      const pages = res.body.result.matches.map((m) => m.evidence[0]?.page);
      expect(pages).toEqual([1, 12]);
    } else throw new Error("expected ok result");
  });

  it("an honest empty matches array is a valid 200 result, not an error", async () => {
    const res = await handleFindSimilar({ documentId: "doc-1", reference: REFERENCE }, deps());
    expect(res.status).toBe(200);
    if (res.body.ok) expect(res.body.result.matches).toEqual([]);
  });

  it("a malformed individual match is dropped (via warnings), the rest of the result still succeeds", async () => {
    const d = deps({
      callOpenAi: vi.fn(async () => ({
        rawJson: JSON.stringify({
          schema_version: SIMILAR_SCHEMA_V1,
          matches: [
            { label: "Door", confidence: 0.6, evidence: [] },
            { label: "", confidence: 0.9, evidence: [] }, // missing label — dropped, not fabricated
          ],
        }),
      })),
    });
    const res = await handleFindSimilar({ documentId: "doc-1", reference: REFERENCE }, d);
    expect(res.status).toBe(200);
    if (res.body.ok) {
      expect(res.body.result.matches).toHaveLength(1);
      expect(res.body.warnings.length).toBeGreaterThan(0);
    } else throw new Error("expected ok result");
  });
});

describe("handleFindSimilar — the caller-supplied reference is authoritative", () => {
  it("never adopts a reference the model's own JSON tries to supply", async () => {
    const d = deps({
      callOpenAi: vi.fn(async () => ({
        rawJson: JSON.stringify({
          schema_version: SIMILAR_SCHEMA_V1,
          matches: [],
          // A model trying to override the reference — must be ignored entirely.
          reference: { label: "Fabricated label", description: "should never appear", evidence: [{ bbox: [0, 0, 0, 0], page: 99 }] },
        }),
      })),
    });
    const res = await handleFindSimilar({ documentId: "doc-1", reference: REFERENCE }, d);
    if (res.body.ok) expect(res.body.result.reference).toEqual(REFERENCE);
    else throw new Error("expected ok result");
  });
});

describe("handleFindSimilar — failure modes", () => {
  it("400s when documentId is missing", async () => {
    const res = await handleFindSimilar({ reference: REFERENCE }, deps());
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("400s when reference is missing", async () => {
    const res = await handleFindSimilar({ documentId: "doc-1" }, deps());
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("404s when document loading fails", async () => {
    const d = deps({ loadDocumentFile: vi.fn(async () => { throw new Error("No drawing file is stored for this document."); }) });
    const res = await handleFindSimilar({ documentId: "doc-1", reference: REFERENCE }, d);
    expect(res.status).toBe(404);
    if (!res.body.ok) expect(res.body.error).toMatch(/No drawing file/);
  });

  it("502s when the OpenAI call fails", async () => {
    const d = deps({ callOpenAi: vi.fn(async () => { throw new Error("OpenAI request failed"); }) });
    const res = await handleFindSimilar({ documentId: "doc-1", reference: REFERENCE }, d);
    expect(res.status).toBe(502);
    if (!res.body.ok) expect(res.body.error).toMatch(/OpenAI request failed/);
  });

  it("502s on malformed model output (invalid JSON) — never fabricates a result", async () => {
    const d = deps({ callOpenAi: vi.fn(async () => ({ rawJson: "not json" })) });
    const res = await handleFindSimilar({ documentId: "doc-1", reference: REFERENCE }, d);
    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
  });

  it("502s when the response is missing the required matches array", async () => {
    const d = deps({ callOpenAi: vi.fn(async () => ({ rawJson: JSON.stringify({ schema_version: SIMILAR_SCHEMA_V1 }) })) });
    const res = await handleFindSimilar({ documentId: "doc-1", reference: REFERENCE }, d);
    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
  });
});

describe("handleFindSimilar — BOQ/database boundary (structural)", () => {
  it("never calls anything beyond the two injected dependencies — no database handle exists in scope to write with", async () => {
    const loadDocumentFile = vi.fn(async () => ({ filename: "plan.pdf", bytes: new Uint8Array() }));
    const callOpenAi = vi.fn(async () => ({ rawJson: JSON.stringify({ schema_version: SIMILAR_SCHEMA_V1, matches: [] }) }));
    await handleFindSimilar({ documentId: "doc-1", reference: REFERENCE }, { loadDocumentFile, callOpenAi });
    expect(loadDocumentFile).toHaveBeenCalledTimes(1);
    expect(callOpenAi).toHaveBeenCalledTimes(1);
    // handleFindSimilar's own signature (FindSimilarDeps) has exactly these
    // two function dependencies and nothing else — see the type import
    // above. There is no third "db" dependency a result could have been
    // written through even if this test didn't exist.
  });
});

// A literal, source-level regression guard: if a future change ever adds a
// database write or an admin-only gate inside findSimilarHandler.ts or
// index.ts's find_similar branch, this test fails — it doesn't rely on
// remembering to re-run a one-time manual audit.
describe("find_similar — source-level zero-write and no-admin-gate guard", () => {
  const handlerSource = readFileSync(
    join(__dirname, "../../../supabase/functions/ai-analysis/findSimilarHandler.ts"),
    "utf-8",
  );
  const indexSource = readFileSync(join(__dirname, "../../../supabase/functions/ai-analysis/index.ts"), "utf-8");

  function extractBranch(source: string, marker: string): string {
    const start = source.indexOf(marker);
    expect(start, `expected to find "${marker}" in the edge function source`).toBeGreaterThanOrEqual(0);
    // The branch is a single top-level `if (...) { ... }` block — walk
    // braces from the first `{` after the marker to find its true end,
    // rather than guessing a line count that would silently stop covering
    // the branch if it grows.
    const braceStart = source.indexOf("{", start);
    let depth = 0;
    let i = braceStart;
    for (; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") { depth--; if (depth === 0) break; }
    }
    return source.slice(start, i + 1);
  }

  it("findSimilarHandler.ts contains zero .insert(/.update(/.upsert( calls anywhere", () => {
    expect(handlerSource).not.toMatch(/\.insert\(|\.update\(|\.upsert\(/);
  });

  it("index.ts's find_similar branch contains zero .insert(/.update(/.upsert( calls", () => {
    const branch = extractBranch(indexSource, 'if (input.action === "find_similar")');
    expect(branch).not.toMatch(/\.insert\(|\.update\(|\.upsert\(/);
  });

  it("index.ts's find_similar branch never calls isAdminCaller — reviewer-accessible, not admin-gated", () => {
    const branch = extractBranch(indexSource, 'if (input.action === "find_similar")');
    expect(branch).not.toContain("isAdminCaller");
  });

  it("the find_similar branch sits after the shared canSendToProvider gate every action already goes through", () => {
    const gateIndex = indexSource.indexOf("canSendToProvider(");
    const branchIndex = indexSource.indexOf('if (input.action === "find_similar")');
    expect(gateIndex).toBeGreaterThanOrEqual(0);
    expect(branchIndex).toBeGreaterThan(gateIndex);
  });
});
