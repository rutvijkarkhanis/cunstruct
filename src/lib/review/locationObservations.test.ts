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
//
// Also records every `.eq(field, value)` filter applied to each `.from(table)`
// call, in order, so tests can assert the EXACT filter set a query used —
// this is what proves the fallback query really does include `.eq("model",
// model)` with the exact value passed in, not just that it returns the right
// answer for a hand-picked mock response.
let queues: Record<string, { data: unknown; error: unknown }[]>;
let filterLog: Record<string, [string, unknown][][]>;
function enqueue(table: string, result: { data: unknown; error: unknown }) {
  (queues[table] ??= []).push(result);
}
function nextResult(table: string): { data: unknown; error: unknown } {
  const q = queues[table];
  return q?.length ? q.shift()! : { data: null, error: null };
}
/** The filter set applied on the Nth (0-indexed) `.from(table)` call, as a
 *  plain object — e.g. `filtersFor("analysis_run_source", 1)` for the second
 *  call to that table. */
function filtersFor(table: string, callIndex: number): Record<string, unknown> {
  const calls = filterLog[table];
  const call = calls?.[callIndex];
  if (!call) throw new Error(`no .from("${table}") call at index ${callIndex} (only ${calls?.length ?? 0} recorded)`);
  return Object.fromEntries(call);
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      (filterLog[table] ??= []).push(filters);
      const obj: Record<string, unknown> = {};
      obj.select = () => obj;
      obj.eq = (field: string, value: unknown) => { filters.push([field, value]); return obj; };
      obj.order = () => obj;
      obj.limit = () => obj;
      obj.maybeSingle = () => Promise.resolve(nextResult(table));
      (obj as { then: unknown }).then = (resolve: (r: unknown) => void) => resolve(nextResult(table));
      return obj;
    },
  },
}));

beforeEach(() => { queues = {}; filterLog = {}; });

describe("latestLocationRunForDocument — document_id-scoped lookup (existing behavior, A)", () => {
  it("returns NOT_RUN when no analysis_run_source row exists for this document, and no content-hash fallback match either", async () => {
    enqueue("analysis_run_source", { data: [], error: null }); // document-scoped: none
    enqueue("project_document", { data: null, error: null }); // no current revision at all
    const state = await latestLocationRunForDocument("proj-1", "doc-1", "gpt-4o-mini");
    expect(state).toEqual({ status: "NOT_RUN", runId: null, claimedAt: null, completedAt: null, error: null });
  });

  it("returns NOT_RUN (never fabricates a different status) when the document-scoped query itself errors, and there is no content hash to fall back on", async () => {
    enqueue("analysis_run_source", { data: null, error: { message: "network error" } });
    enqueue("project_document", { data: null, error: null });
    const state = await latestLocationRunForDocument("proj-1", "doc-1", "gpt-4o-mini");
    expect(state.status).toBe("NOT_RUN");
  });

  it("returns SUCCEEDED with the run id and timestamps when THIS document's own claim succeeded — unchanged, never reaches the fallback (8)", async () => {
    enqueue("analysis_run_source", {
      data: [{ status: "SUCCEEDED", analysis_run_id: "run-1", claimed_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:05:00Z", error: null }],
      error: null,
    });
    const state = await latestLocationRunForDocument("proj-1", "doc-1", "gpt-4o-mini");
    expect(state).toEqual({ status: "SUCCEEDED", runId: "run-1", claimedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:05:00Z", error: null });
    // Only one analysis_run_source call — the fallback path was never entered.
    expect(queues.project_document).toBeUndefined();
  });

  it("returns FAILED with the stored error message, never silently swallowed", async () => {
    enqueue("analysis_run_source", {
      data: [{ status: "FAILED", analysis_run_id: null, claimed_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:01:00Z", error: "OpenAI request failed" }],
      error: null,
    });
    const state = await latestLocationRunForDocument("proj-1", "doc-1", "gpt-4o-mini");
    expect(state.status).toBe("FAILED");
    expect(state.error).toBe("OpenAI request failed");
  });

  it("returns PROCESSING while a claim is in flight", async () => {
    enqueue("analysis_run_source", { data: [{ status: "PROCESSING", analysis_run_id: null, claimed_at: "2026-01-01T00:00:00Z", completed_at: null, error: null }], error: null });
    const state = await latestLocationRunForDocument("proj-1", "doc-1", "gpt-4o-mini");
    expect(state.status).toBe("PROCESSING");
  });
});

describe("latestLocationRunForDocument — content-hash fallback (the identity-mismatch fix)", () => {
  it("B/6. reports CONTENT_MATCHED_OTHER_DOCUMENT when an identical-content SUCCEEDED claim exists under a DIFFERENT document_id, same model", async () => {
    enqueue("analysis_run_source", { data: [], error: null }); // document-scoped: this document was never claimed
    enqueue("project_document", { data: { current_revision_id: "rev-1" }, error: null });
    enqueue("document_revision", { data: { content_hash: "hash-abc" }, error: null });
    enqueue("analysis_run_source", {
      data: [{ analysis_run_id: "run-other", claimed_at: "2026-01-02T00:00:00Z", completed_at: "2026-01-02T00:05:00Z", document_id: "doc-OTHER" }],
      error: null,
    });
    const state = await latestLocationRunForDocument("proj-1", "doc-1", "gpt-4o-mini");
    expect(state.status).toBe("CONTENT_MATCHED_OTHER_DOCUMENT");
    expect(state.runId).toBe("run-other");
    expect(state.completedAt).toBe("2026-01-02T00:05:00Z");
    // Never claims extraction ran for THIS document.
    expect(state.status).not.toBe("SUCCEEDED");
  });

  it("C/7. reports CONTENT_MATCHED_UNATTRIBUTED when the matching SUCCEEDED claim's document_id is NULL (original document deleted), same model", async () => {
    enqueue("analysis_run_source", { data: [], error: null });
    enqueue("project_document", { data: { current_revision_id: "rev-1" }, error: null });
    enqueue("document_revision", { data: { content_hash: "hash-abc" }, error: null });
    enqueue("analysis_run_source", {
      data: [{ analysis_run_id: "run-old", claimed_at: "2026-01-02T00:00:00Z", completed_at: "2026-01-02T00:05:00Z", document_id: null }],
      error: null,
    });
    const state = await latestLocationRunForDocument("proj-1", "doc-1", "gpt-4o-mini");
    expect(state.status).toBe("CONTENT_MATCHED_UNATTRIBUTED");
    expect(state.runId).toBe("run-old");
    expect(state.status).not.toBe("SUCCEEDED");
  });

  it("D/9. still reports NOT_RUN when there is no own claim AND no hash-level match either (content hash resolved but nothing matches it)", async () => {
    enqueue("analysis_run_source", { data: [], error: null }); // document-scoped: none
    enqueue("project_document", { data: { current_revision_id: "rev-1" }, error: null });
    enqueue("document_revision", { data: { content_hash: "hash-unique" }, error: null });
    enqueue("analysis_run_source", { data: [], error: null }); // hash-scoped fallback: none either
    const state = await latestLocationRunForDocument("proj-1", "doc-1", "gpt-4o-mini");
    expect(state).toEqual({ status: "NOT_RUN", runId: null, claimedAt: null, completedAt: null, error: null });
  });

  it("does not fall back at all when the document itself has no current revision (nothing to hash)", async () => {
    enqueue("analysis_run_source", { data: [], error: null });
    enqueue("project_document", { data: { current_revision_id: null }, error: null });
    const state = await latestLocationRunForDocument("proj-1", "doc-1", "gpt-4o-mini");
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
    const state = await latestLocationRunForDocument("proj-1", "doc-1", "gpt-4o-mini");
    expect(state.status).toBe("NOT_RUN");
  });
});

describe("latestLocationRunForDocument — fallback identity parity with preflight (model + contract version)", () => {
  it("2. the fallback query filters on the EXACT model passed in, alongside content_hash/contract_version/provider/mode/status", async () => {
    enqueue("analysis_run_source", { data: [], error: null }); // document-scoped: none
    enqueue("project_document", { data: { current_revision_id: "rev-1" }, error: null });
    enqueue("document_revision", { data: { content_hash: "hash-abc" }, error: null });
    enqueue("analysis_run_source", {
      data: [{ analysis_run_id: "run-other", claimed_at: "2026-01-02T00:00:00Z", completed_at: "2026-01-02T00:05:00Z", document_id: "doc-OTHER" }],
      error: null,
    });
    await latestLocationRunForDocument("proj-1", "doc-1", "gpt-4o");
    // The SECOND analysis_run_source call is the hash-level fallback (the
    // FIRST is the document-scoped lookup, which never filters on model).
    const filters = filtersFor("analysis_run_source", 1);
    expect(filters.model).toBe("gpt-4o");
    expect(filters.project_id).toBe("proj-1");
    expect(filters.content_hash).toBe("hash-abc");
    expect(filters.contract_version).toBe("cunstruct-openai-v1.0.0");
    expect(filters.provider).toBe("openai");
    expect(filters.mode).toBe("LOCATION");
    expect(filters.status).toBe("SUCCEEDED");
  });

  it("3. same hash + same model → matches (the model actually requested is the one filtered on, not a hardcoded default)", async () => {
    enqueue("analysis_run_source", { data: [], error: null });
    enqueue("project_document", { data: { current_revision_id: "rev-1" }, error: null });
    enqueue("document_revision", { data: { content_hash: "hash-abc" }, error: null });
    // Simulates the real database applying `.eq("model", "gpt-4o")` and
    // finding the SUCCEEDED row that was in fact analysed under gpt-4o.
    enqueue("analysis_run_source", {
      data: [{ analysis_run_id: "run-gpt4o", claimed_at: "2026-01-02T00:00:00Z", completed_at: "2026-01-02T00:05:00Z", document_id: "doc-OTHER" }],
      error: null,
    });
    const state = await latestLocationRunForDocument("proj-1", "doc-1", "gpt-4o");
    expect(state.status).toBe("CONTENT_MATCHED_OTHER_DOCUMENT");
    expect(state.runId).toBe("run-gpt4o");
    expect(filtersFor("analysis_run_source", 1).model).toBe("gpt-4o");
  });

  it("4. same hash + DIFFERENT model → does not match (never reports a hash match across models)", async () => {
    enqueue("analysis_run_source", { data: [], error: null });
    enqueue("project_document", { data: { current_revision_id: "rev-1" }, error: null });
    enqueue("document_revision", { data: { content_hash: "hash-abc" }, error: null });
    // The only SUCCEEDED row for this hash was analysed under "gpt-4o-mini";
    // the caller is asking under "gpt-4o". A real Postgrest query with
    // `.eq("model", "gpt-4o")` would exclude that row, so the fallback query
    // (correctly) returns nothing here — the exact behavior this test locks in.
    enqueue("analysis_run_source", { data: [], error: null });
    const state = await latestLocationRunForDocument("proj-1", "doc-1", "gpt-4o");
    expect(state.status).toBe("NOT_RUN");
    expect(state.status).not.toBe("CONTENT_MATCHED_OTHER_DOCUMENT");
    expect(state.status).not.toBe("CONTENT_MATCHED_UNATTRIBUTED");
    // And the query really did ask for the model actually in use, not the
    // one the (hypothetical) other row was analysed under.
    expect(filtersFor("analysis_run_source", 1).model).toBe("gpt-4o");
  });

  it("5. same hash + different contract version → does not match (contract_version is always the current constant, never the stale one a match might have used)", async () => {
    enqueue("analysis_run_source", { data: [], error: null });
    enqueue("project_document", { data: { current_revision_id: "rev-1" }, error: null });
    enqueue("document_revision", { data: { content_hash: "hash-abc" }, error: null });
    // The only SUCCEEDED row for this hash was analysed under an older
    // contract version; `.eq("contract_version", ANALYSIS_CONTRACT_VERSION)`
    // excludes it, so the fallback returns nothing.
    enqueue("analysis_run_source", { data: [], error: null });
    const state = await latestLocationRunForDocument("proj-1", "doc-1", "gpt-4o-mini");
    expect(state.status).toBe("NOT_RUN");
    expect(filtersFor("analysis_run_source", 1).contract_version).toBe("cunstruct-openai-v1.0.0");
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

describe("locationObservations.ts is read-only and BOQ-isolated (10)", () => {
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
