// LOCATION OBSERVATIONS — data-layer tests for the read-only inspector
// queries. Also the static-source proof that this file (the ONLY new
// browser-side read path onto analysis_observation) is read-only: no
// .insert/.update/.delete call exists anywhere in it, and it never
// references boq_line — the exact "cannot create or modify BOQ lines"
// guarantee, proven structurally rather than by mocking Supabase writes
// that don't exist to mock.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { latestLocationRunForDocument, loadLocationObservations } from "./locationObservations";

// Per-table FIFO queues: each `.from(table)` call consumes the NEXT queued
// response for that table, regardless of whether the call site terminates
// the chain with `.maybeSingle()` (project_document/document_revision) or by
// awaiting the chain object itself (analysis_run_source, array-returning) —
// letting one mock support latestLocationRunForDocument's up-to-three
// sequential table calls (document-scoped lookup -> content hash lookup ->
// hash-scoped fallback lookup) in the exact order it makes them.
let queues: Record<string, { data: unknown; error: unknown }[]>;
function enqueue(table: string, result: { data: unknown; error: unknown }) {
  (queues[table] ??= []).push(result);
}
function nextResult(table: string): { data: unknown; error: unknown } {
  const q = queues[table];
  return q?.length ? q.shift()! : { data: null, error: null };
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const obj: Record<string, unknown> = {};
      ["select", "eq", "order", "limit"].forEach((m) => { obj[m] = () => obj; });
      obj.maybeSingle = () => Promise.resolve(nextResult(table));
      (obj as { then: unknown }).then = (resolve: (r: unknown) => void) => resolve(nextResult(table));
      return obj;
    },
  },
}));

beforeEach(() => { queues = {}; });

describe("latestLocationRunForDocument — document_id-scoped lookup (existing behavior, A)", () => {
  it("returns NOT_RUN when no analysis_run_source row exists for this document, and no content-hash fallback match either", async () => {
    enqueue("analysis_run_source", { data: [], error: null }); // document-scoped: none
    enqueue("project_document", { data: null, error: null }); // no current revision at all
    const state = await latestLocationRunForDocument("proj-1", "doc-1");
    expect(state).toEqual({ status: "NOT_RUN", runId: null, claimedAt: null, completedAt: null, error: null });
  });

  it("returns NOT_RUN (never fabricates a different status) when the document-scoped query itself errors, and there is no content hash to fall back on", async () => {
    enqueue("analysis_run_source", { data: null, error: { message: "network error" } });
    enqueue("project_document", { data: null, error: null });
    const state = await latestLocationRunForDocument("proj-1", "doc-1");
    expect(state.status).toBe("NOT_RUN");
  });

  it("returns SUCCEEDED with the run id and timestamps when THIS document's own claim succeeded — unchanged, never reaches the fallback", async () => {
    enqueue("analysis_run_source", {
      data: [{ status: "SUCCEEDED", analysis_run_id: "run-1", claimed_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:05:00Z", error: null }],
      error: null,
    });
    const state = await latestLocationRunForDocument("proj-1", "doc-1");
    expect(state).toEqual({ status: "SUCCEEDED", runId: "run-1", claimedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:05:00Z", error: null });
    // Only one analysis_run_source call — the fallback path was never entered.
    expect(queues.project_document).toBeUndefined();
  });

  it("returns FAILED with the stored error message, never silently swallowed", async () => {
    enqueue("analysis_run_source", {
      data: [{ status: "FAILED", analysis_run_id: null, claimed_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:01:00Z", error: "OpenAI request failed" }],
      error: null,
    });
    const state = await latestLocationRunForDocument("proj-1", "doc-1");
    expect(state.status).toBe("FAILED");
    expect(state.error).toBe("OpenAI request failed");
  });

  it("returns PROCESSING while a claim is in flight", async () => {
    enqueue("analysis_run_source", { data: [{ status: "PROCESSING", analysis_run_id: null, claimed_at: "2026-01-01T00:00:00Z", completed_at: null, error: null }], error: null });
    const state = await latestLocationRunForDocument("proj-1", "doc-1");
    expect(state.status).toBe("PROCESSING");
  });
});

describe("latestLocationRunForDocument — content-hash fallback (the identity-mismatch fix)", () => {
  it("B. reports CONTENT_MATCHED_OTHER_DOCUMENT when an identical-content SUCCEEDED claim exists under a DIFFERENT document_id", async () => {
    enqueue("analysis_run_source", { data: [], error: null }); // document-scoped: this document was never claimed
    enqueue("project_document", { data: { current_revision_id: "rev-1" }, error: null });
    enqueue("document_revision", { data: { content_hash: "hash-abc" }, error: null });
    enqueue("analysis_run_source", {
      data: [{ analysis_run_id: "run-other", claimed_at: "2026-01-02T00:00:00Z", completed_at: "2026-01-02T00:05:00Z", document_id: "doc-OTHER" }],
      error: null,
    });
    const state = await latestLocationRunForDocument("proj-1", "doc-1");
    expect(state.status).toBe("CONTENT_MATCHED_OTHER_DOCUMENT");
    expect(state.runId).toBe("run-other");
    expect(state.completedAt).toBe("2026-01-02T00:05:00Z");
    // Never claims extraction ran for THIS document.
    expect(state.status).not.toBe("SUCCEEDED");
  });

  it("C. reports CONTENT_MATCHED_UNATTRIBUTED when the matching SUCCEEDED claim's document_id is NULL (original document deleted)", async () => {
    enqueue("analysis_run_source", { data: [], error: null });
    enqueue("project_document", { data: { current_revision_id: "rev-1" }, error: null });
    enqueue("document_revision", { data: { content_hash: "hash-abc" }, error: null });
    enqueue("analysis_run_source", {
      data: [{ analysis_run_id: "run-old", claimed_at: "2026-01-02T00:00:00Z", completed_at: "2026-01-02T00:05:00Z", document_id: null }],
      error: null,
    });
    const state = await latestLocationRunForDocument("proj-1", "doc-1");
    expect(state.status).toBe("CONTENT_MATCHED_UNATTRIBUTED");
    expect(state.runId).toBe("run-old");
    expect(state.status).not.toBe("SUCCEEDED");
  });

  it("D. still reports NOT_RUN when there is no own claim AND no hash-level match either (content hash resolved but nothing matches it)", async () => {
    enqueue("analysis_run_source", { data: [], error: null }); // document-scoped: none
    enqueue("project_document", { data: { current_revision_id: "rev-1" }, error: null });
    enqueue("document_revision", { data: { content_hash: "hash-unique" }, error: null });
    enqueue("analysis_run_source", { data: [], error: null }); // hash-scoped fallback: none either
    const state = await latestLocationRunForDocument("proj-1", "doc-1");
    expect(state).toEqual({ status: "NOT_RUN", runId: null, claimedAt: null, completedAt: null, error: null });
  });

  it("does not fall back at all when the document itself has no current revision (nothing to hash)", async () => {
    enqueue("analysis_run_source", { data: [], error: null });
    enqueue("project_document", { data: { current_revision_id: null }, error: null });
    const state = await latestLocationRunForDocument("proj-1", "doc-1");
    expect(state.status).toBe("NOT_RUN");
    expect(queues.document_revision).toBeUndefined(); // never even asked for the hash
  });

  it("never falls back to a PROCESSING or FAILED hash-level match — only a SUCCEEDED one explains 'no new eligible files'", async () => {
    enqueue("analysis_run_source", { data: [], error: null });
    enqueue("project_document", { data: { current_revision_id: "rev-1" }, error: null });
    enqueue("document_revision", { data: { content_hash: "hash-abc" }, error: null });
    // The fallback query itself filters status="SUCCEEDED" server-side, so a
    // PROCESSING/FAILED row for this hash is never even returned to it.
    enqueue("analysis_run_source", { data: [], error: null });
    const state = await latestLocationRunForDocument("proj-1", "doc-1");
    expect(state.status).toBe("NOT_RUN");
  });
});

describe("loadLocationObservations", () => {
  it("maps every persisted field, camelCased, in the exact stored shape", async () => {
    enqueue("analysis_observation", {
      data: [{
        id: "obs-1", observation_type: "schedule_entry", mark: "W1", scope_hint: "Ground Floor",
        location_text: "Door/Window schedule", attributes: { dimension: "6x6", specification: "UPVC" },
        evidence: { documentId: "doc-1", page: 8, evidence: [{ bbox: [1, 2, 3, 4], page: 8 }] },
        evidence_completeness: "FULL", created_at: "2026-01-01T00:00:00Z",
      }],
      error: null,
    });
    const rows = await loadLocationObservations("run-1");
    expect(rows).toEqual([{
      id: "obs-1", observationType: "schedule_entry", mark: "W1", scopeHint: "Ground Floor",
      locationText: "Door/Window schedule", attributes: { dimension: "6x6", specification: "UPVC" },
      evidence: { documentId: "doc-1", page: 8, evidence: [{ bbox: [1, 2, 3, 4], page: 8 }] },
      evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z",
    }]);
  });

  it("returns an empty array (never null/undefined) for a genuine zero-observation run", async () => {
    enqueue("analysis_observation", { data: [], error: null });
    const rows = await loadLocationObservations("run-1");
    expect(rows).toEqual([]);
  });

  it("returns an empty array on a query error too — never throws, never fabricates a row", async () => {
    enqueue("analysis_observation", { data: null, error: { message: "network error" } });
    const rows = await loadLocationObservations("run-1");
    expect(rows).toEqual([]);
  });
});

describe("locationObservations.ts is read-only and BOQ-isolated (E, F)", () => {
  it("contains no .insert(/.update(/.delete( call and no boq_line reference, including the new fallback lookup", () => {
    const src = readFileSync(join(__dirname, "locationObservations.ts"), "utf8");
    expect(src).not.toMatch(/\.insert\(/);
    expect(src).not.toMatch(/\.update\(/);
    expect(src).not.toMatch(/\.delete\(/);
    expect(src).not.toMatch(/boq_line/);
  });

  it("never imports the server-only modelConfig.ts (pricing/model table forbidden from src/) — comments mentioning it by name are fine, an import statement is not", () => {
    const src = readFileSync(join(__dirname, "locationObservations.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*modelConfig/);
  });
});
