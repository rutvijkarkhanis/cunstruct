// LOCATION OBSERVATIONS — data-layer tests for the read-only inspector
// queries. Also the static-source proof that this file (the ONLY new
// browser-side read path onto analysis_observation) is read-only: no
// .insert/.update/.delete call exists anywhere in it, and it never
// references boq_line — the exact "cannot create or modify BOQ lines"
// guarantee, proven structurally rather than by mocking Supabase writes
// that don't exist to mock.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { latestLocationRunForDocument, loadLocationObservations } from "./locationObservations";

function chain(result: { data: unknown; error: unknown }) {
  const obj: Record<string, unknown> = {};
  ["select", "eq", "order", "limit"].forEach((m) => { obj[m] = () => obj; });
  (obj as { then: unknown }).then = (resolve: (r: typeof result) => void) => resolve(result);
  return obj;
}

let mockResult: { data: unknown; error: unknown } = { data: [], error: null };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => chain(mockResult) },
}));

describe("latestLocationRunForDocument", () => {
  it("returns NOT_RUN when no analysis_run_source row exists for this document/mode", async () => {
    mockResult = { data: [], error: null };
    const state = await latestLocationRunForDocument("proj-1", "doc-1");
    expect(state).toEqual({ status: "NOT_RUN", runId: null, claimedAt: null, completedAt: null, error: null });
  });

  it("returns NOT_RUN (never fabricates a different status) when the query itself errors", async () => {
    mockResult = { data: null, error: { message: "network error" } };
    const state = await latestLocationRunForDocument("proj-1", "doc-1");
    expect(state.status).toBe("NOT_RUN");
  });

  it("returns SUCCEEDED with the run id and timestamps when the latest claim succeeded", async () => {
    mockResult = {
      data: [{ status: "SUCCEEDED", analysis_run_id: "run-1", claimed_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:05:00Z", error: null }],
      error: null,
    };
    const state = await latestLocationRunForDocument("proj-1", "doc-1");
    expect(state).toEqual({ status: "SUCCEEDED", runId: "run-1", claimedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:05:00Z", error: null });
  });

  it("returns FAILED with the stored error message, never silently swallowed", async () => {
    mockResult = {
      data: [{ status: "FAILED", analysis_run_id: null, claimed_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:01:00Z", error: "OpenAI request failed" }],
      error: null,
    };
    const state = await latestLocationRunForDocument("proj-1", "doc-1");
    expect(state.status).toBe("FAILED");
    expect(state.error).toBe("OpenAI request failed");
  });

  it("returns PROCESSING while a claim is in flight", async () => {
    mockResult = { data: [{ status: "PROCESSING", analysis_run_id: null, claimed_at: "2026-01-01T00:00:00Z", completed_at: null, error: null }], error: null };
    const state = await latestLocationRunForDocument("proj-1", "doc-1");
    expect(state.status).toBe("PROCESSING");
  });
});

describe("loadLocationObservations", () => {
  it("maps every persisted field, camelCased, in the exact stored shape", async () => {
    mockResult = {
      data: [{
        id: "obs-1", observation_type: "schedule_entry", mark: "W1", scope_hint: "Ground Floor",
        location_text: "Door/Window schedule", attributes: { dimension: "6x6", specification: "UPVC" },
        evidence: { documentId: "doc-1", page: 8, evidence: [{ bbox: [1, 2, 3, 4], page: 8 }] },
        evidence_completeness: "FULL", created_at: "2026-01-01T00:00:00Z",
      }],
      error: null,
    };
    const rows = await loadLocationObservations("run-1");
    expect(rows).toEqual([{
      id: "obs-1", observationType: "schedule_entry", mark: "W1", scopeHint: "Ground Floor",
      locationText: "Door/Window schedule", attributes: { dimension: "6x6", specification: "UPVC" },
      evidence: { documentId: "doc-1", page: 8, evidence: [{ bbox: [1, 2, 3, 4], page: 8 }] },
      evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z",
    }]);
  });

  it("returns an empty array (never null/undefined) for a genuine zero-observation run", async () => {
    mockResult = { data: [], error: null };
    const rows = await loadLocationObservations("run-1");
    expect(rows).toEqual([]);
  });

  it("returns an empty array on a query error too — never throws, never fabricates a row", async () => {
    mockResult = { data: null, error: { message: "network error" } };
    const rows = await loadLocationObservations("run-1");
    expect(rows).toEqual([]);
  });
});

describe("locationObservations.ts is read-only and BOQ-isolated", () => {
  it("contains no .insert(/.update(/.delete( call and no boq_line reference", () => {
    const src = readFileSync(join(__dirname, "locationObservations.ts"), "utf8");
    expect(src).not.toMatch(/\.insert\(/);
    expect(src).not.toMatch(/\.update\(/);
    expect(src).not.toMatch(/\.delete\(/);
    expect(src).not.toMatch(/boq_line/);
  });
});
