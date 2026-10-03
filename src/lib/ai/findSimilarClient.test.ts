import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { SIMILAR_SCHEMA_V1, type SimilarReferenceV1 } from "@/lib/review/findSimilarSchemaV1";

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invokeMock(...args) } },
}));

import { findSimilar } from "./findSimilarClient";

const REFERENCE: SimilarReferenceV1 = {
  label: "Door",
  description: "Single leaf door",
  evidence: [{ bbox: [10, 20, 30, 40], page: 2 }],
};

describe("findSimilar — request shape", () => {
  it("invokes the ai-analysis function with action: find_similar", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true, result: { schemaVersion: SIMILAR_SCHEMA_V1, matches: [] } }, error: null });
    await findSimilar({ projectId: "proj-1", documentId: "doc-1", reference: REFERENCE });
    expect(invokeMock).toHaveBeenCalledWith("ai-analysis", expect.objectContaining({ body: expect.objectContaining({ action: "find_similar" }) }));
  });

  it("generates the correct request payload", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true, result: { schemaVersion: SIMILAR_SCHEMA_V1, matches: [] } }, error: null });
    await findSimilar({ projectId: "proj-1", documentId: "doc-1", reference: REFERENCE, model: "gpt-x" });
    expect(invokeMock).toHaveBeenCalledWith("ai-analysis", {
      body: { action: "find_similar", projectId: "proj-1", documentId: "doc-1", reference: REFERENCE, model: "gpt-x" },
    });
  });

  it("forwards the confirmed reference unchanged — never mutates or re-shapes it", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true, result: { schemaVersion: SIMILAR_SCHEMA_V1, matches: [] } }, error: null });
    await findSimilar({ projectId: "proj-1", documentId: "doc-1", reference: REFERENCE });
    const [, { body }] = invokeMock.mock.calls[0];
    expect(body.reference).toBe(REFERENCE); // same object reference, not a copy or a re-derived shape
  });
});

describe("findSimilar — successful results", () => {
  it("returns ok:true with a single match", async () => {
    invokeMock.mockResolvedValue({
      data: { ok: true, result: { schemaVersion: SIMILAR_SCHEMA_V1, matches: [{ label: "Door", confidence: 0.8, evidence: [{ bbox: [1, 1, 2, 2], page: 1 }] }] } },
      error: null,
    });
    const res = await findSimilar({ projectId: "proj-1", documentId: "doc-1", reference: REFERENCE });
    expect(res.ok).toBe(true);
    expect(res.result?.matches).toHaveLength(1);
    expect(res.result?.matches[0].label).toBe("Door");
  });

  it("returns ok:true preserving every match, including multiple matches", async () => {
    invokeMock.mockResolvedValue({
      data: {
        ok: true,
        result: {
          schemaVersion: SIMILAR_SCHEMA_V1,
          matches: [
            { label: "Door", confidence: 0.9, evidence: [{ bbox: [1, 1, 2, 2], page: 1 }] },
            { label: "Door", confidence: 0.5, evidence: [{ bbox: [3, 3, 4, 4], page: 1 }] },
            { label: "Door", confidence: 0.2, evidence: [{ bbox: [5, 5, 6, 6], page: 3 }] },
          ],
        },
      },
      error: null,
    });
    const res = await findSimilar({ projectId: "proj-1", documentId: "doc-1", reference: REFERENCE });
    expect(res.result?.matches).toHaveLength(3);
  });

  it("preserves matches spanning multiple pages", async () => {
    invokeMock.mockResolvedValue({
      data: {
        ok: true,
        result: {
          schemaVersion: SIMILAR_SCHEMA_V1,
          matches: [
            { label: "Door", confidence: 0.9, evidence: [{ bbox: [1, 1, 2, 2], page: 1 }] },
            { label: "Door", confidence: 0.8, evidence: [{ bbox: [3, 3, 4, 4], page: 11 }] },
          ],
        },
      },
      error: null,
    });
    const res = await findSimilar({ projectId: "proj-1", documentId: "doc-1", reference: REFERENCE });
    expect(res.result?.matches.map((m) => m.evidence[0]?.page)).toEqual([1, 11]);
  });

  it("treats an empty matches array as a valid successful result, not an error", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true, result: { schemaVersion: SIMILAR_SCHEMA_V1, matches: [] } }, error: null });
    const res = await findSimilar({ projectId: "proj-1", documentId: "doc-1", reference: REFERENCE });
    expect(res.ok).toBe(true);
    expect(res.result?.matches).toEqual([]);
    expect(res.error).toBeUndefined();
  });
});

describe("findSimilar — fails safely, never silently converts an error into an empty result", () => {
  it("returns ok:false with the server's own error when the edge function reports failure (e.g. document load failure)", async () => {
    invokeMock.mockResolvedValue({ data: { ok: false, error: "No drawing file is stored for this document." }, error: null });
    const res = await findSimilar({ projectId: "proj-1", documentId: "doc-1", reference: REFERENCE });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("No drawing file is stored for this document.");
    expect(res.result).toBeUndefined();
  });

  it("returns ok:false with the server's own error on an OpenAI/provider failure", async () => {
    invokeMock.mockResolvedValue({ data: { ok: false, error: "OpenAI request failed" }, error: null });
    const res = await findSimilar({ projectId: "proj-1", documentId: "doc-1", reference: REFERENCE });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("OpenAI request failed");
  });

  it("returns ok:false when the response is not an object at all", async () => {
    invokeMock.mockResolvedValue({ data: "not an object", error: null });
    const res = await findSimilar({ projectId: "proj-1", documentId: "doc-1", reference: REFERENCE });
    expect(res.ok).toBe(false);
    expect(res.result).toBeUndefined();
  });

  it("returns ok:false when the response is null", async () => {
    invokeMock.mockResolvedValue({ data: null, error: null });
    const res = await findSimilar({ projectId: "proj-1", documentId: "doc-1", reference: REFERENCE });
    expect(res.ok).toBe(false);
  });

  it("returns ok:false (never a fabricated empty result) when the result is missing the matches array", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true, result: { schemaVersion: SIMILAR_SCHEMA_V1 } }, error: null });
    const res = await findSimilar({ projectId: "proj-1", documentId: "doc-1", reference: REFERENCE });
    expect(res.ok).toBe(false);
    expect(res.result).toBeUndefined();
  });

  it("returns ok:false when result is malformed/not shaped like a FindSimilarResultV1 at all", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true, result: "garbage" }, error: null });
    const res = await findSimilar({ projectId: "proj-1", documentId: "doc-1", reference: REFERENCE });
    expect(res.ok).toBe(false);
  });

  it("throws (never returns a fabricated ok:false silently swallowed) when the function invocation itself errors (transport failure)", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error("network down") });
    await expect(findSimilar({ projectId: "proj-1", documentId: "doc-1", reference: REFERENCE })).rejects.toThrow("network down");
  });

  it("surfaces an authentication/authorization failure the same way any transport error surfaces — a thrown rejection, never a silent empty match list", async () => {
    // supabase.functions.invoke's own convention (mirrored by identifyClient.ts): a 401/403
    // from the edge function arrives as a non-null `error`, not as data.ok:false — this
    // client doesn't special-case it, same as identify's own client; a caller can still
    // inspect the thrown error's message/status itself.
    const authError = Object.assign(new Error("Not authenticated"), { status: 401 });
    invokeMock.mockResolvedValue({ data: null, error: authError });
    await expect(findSimilar({ projectId: "proj-1", documentId: "doc-1", reference: REFERENCE })).rejects.toMatchObject({ message: "Not authenticated", status: 401 });
  });
});

describe("findSimilar — no database/persistence dependency (structural)", () => {
  const source = readFileSync(join(__dirname, "findSimilarClient.ts"), "utf-8");

  it("imports only the standard browser supabase client and the Find Similar contract — nothing BOQ/persistence-shaped", () => {
    expect(source).toContain('from "@/integrations/supabase/client"');
    expect(source).not.toMatch(/analysis_review_item|analysis_observation|boq_line|service_role/);
  });

  it("contains no write call of any kind", () => {
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.from\(/);
  });
});
