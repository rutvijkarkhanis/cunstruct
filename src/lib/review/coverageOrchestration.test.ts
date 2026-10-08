import { describe, it, expect, vi } from "vitest";
import { generateAndPersistCoverageFindings, type CoverageOrchestrationDeps } from "./coverageOrchestration";
import type { LocationObservation } from "./locationObservations";
import type { StoredReviewItem } from "./reviewStore";

function obs(id: string, mark: string, observationType: LocationObservation["observationType"] = "opening"): LocationObservation {
  return { id, observationType, mark, scopeHint: null, locationText: null, attributes: {}, evidence: { evidence: [{ bbox: [0, 0, 1, 1] }] }, evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z" };
}

function item(id: string, key: string): StoredReviewItem {
  return { id, ai: { key, item: key, quantity: 1, confidence: 0.9, aiStatus: "MEASURED" }, reviewStatus: "VERIFIED" };
}

function baseDeps(overrides: Partial<CoverageOrchestrationDeps> = {}): CoverageOrchestrationDeps {
  return {
    latestRunForBoq: vi.fn(async () => null),
    loadReviewItems: vi.fn(async () => []),
    loadLocationObservations: vi.fn(async () => []),
    loadBoqDocumentLinks: vi.fn(async () => []),
    persistCoverageFindings: vi.fn(async () => ({ runId: "run-1", createdCount: 0, skippedCount: 0 })),
    ...overrides,
  };
}

describe("generateAndPersistCoverageFindings", () => {
  it("is a no-op for an empty boqRefs array — no queries, no persistence", async () => {
    const deps = baseDeps();
    const result = await generateAndPersistCoverageFindings([], "proj-1", deps);
    expect(result).toEqual({ signals: [], persistedByBoqId: {} });
    expect(deps.loadBoqDocumentLinks).not.toHaveBeenCalled();
    expect(deps.persistCoverageFindings).not.toHaveBeenCalled();
  });

  it("assembles inputs from the existing reads and persists a detected gap for the right BOQ", async () => {
    const deps = baseDeps({
      loadBoqDocumentLinks: vi.fn(async () => [{ boqId: "boq-civil", documentId: "doc-A" }]),
      latestRunForBoq: vi.fn(async (boqId: string) => (boqId === "boq-civil" ? { id: "run-1" } : null)),
      loadReviewItems: vi.fn(async () => []), // no review item for D-07 -> gap
      loadLocationObservations: vi.fn(async (documentId: string) => (documentId === "doc-A" ? [obs("o1", "D-07", "schedule_entry")] : [])),
    });

    const result = await generateAndPersistCoverageFindings([{ boqId: "boq-civil" }], "proj-1", deps);

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]).toMatchObject({ boqId: "boq-civil", documentId: "doc-A", normalizedKey: "d-07" });
    expect(deps.persistCoverageFindings).toHaveBeenCalledTimes(1);
    expect(deps.persistCoverageFindings).toHaveBeenCalledWith({ boqId: "boq-civil", projectId: "proj-1", signals: result.signals });
    expect(result.persistedByBoqId).toEqual({ "boq-civil": { runId: "run-1", createdCount: 0, skippedCount: 0 } });
  });

  it("never calls persistCoverageFindings for a BOQ with zero detected signals", async () => {
    const deps = baseDeps({
      loadBoqDocumentLinks: vi.fn(async () => [{ boqId: "boq-civil", documentId: "doc-A" }]),
      latestRunForBoq: vi.fn(async () => ({ id: "run-1" })),
      loadReviewItems: vi.fn(async () => [item("ri-1", "D-07")]), // matches -> no gap
      loadLocationObservations: vi.fn(async () => [obs("o1", "D-07", "schedule_entry")]),
    });
    const result = await generateAndPersistCoverageFindings([{ boqId: "boq-civil" }], "proj-1", deps);
    expect(result.signals).toEqual([]);
    expect(deps.persistCoverageFindings).not.toHaveBeenCalled();
    expect(result.persistedByBoqId).toEqual({});
  });

  it("loads each distinct document's LOCATION observations only once, even when shared across multiple BOQs", async () => {
    const loadLocationObservations = vi.fn(async (documentId: string) => (documentId === "doc-A" ? [obs("o1", "D-07", "schedule_entry")] : []));
    const deps = baseDeps({
      loadBoqDocumentLinks: vi.fn(async () => [
        { boqId: "boq-civil", documentId: "doc-A" },
        { boqId: "boq-electrical", documentId: "doc-A" },
      ]),
      latestRunForBoq: vi.fn(async () => null),
      loadLocationObservations,
    });
    await generateAndPersistCoverageFindings([{ boqId: "boq-civil" }, { boqId: "boq-electrical" }], "proj-1", deps);
    expect(loadLocationObservations).toHaveBeenCalledTimes(1);
    expect(loadLocationObservations).toHaveBeenCalledWith("doc-A");
  });

  it("a BOQ never analysed (latestRunForBoq returns null) contributes empty review items, never an error", async () => {
    const deps = baseDeps({
      loadBoqDocumentLinks: vi.fn(async () => [{ boqId: "boq-civil", documentId: "doc-A" }]),
      latestRunForBoq: vi.fn(async () => null),
      loadLocationObservations: vi.fn(async () => [obs("o1", "D-07", "schedule_entry")]),
    });
    const result = await generateAndPersistCoverageFindings([{ boqId: "boq-civil" }], "proj-1", deps);
    expect(deps.loadReviewItems).not.toHaveBeenCalled();
    expect(result.signals).toHaveLength(1); // no items at all -> still a gap, never an error
  });

  it("scopes each BOQ's persisted signals to exactly that BOQ — never another's", async () => {
    const deps = baseDeps({
      loadBoqDocumentLinks: vi.fn(async () => [
        { boqId: "boq-civil", documentId: "doc-A" },
        { boqId: "boq-electrical", documentId: "doc-B" },
      ]),
      latestRunForBoq: vi.fn(async () => null),
      loadLocationObservations: vi.fn(async (documentId: string) => [obs(`o-${documentId}`, documentId === "doc-A" ? "D-07" : "W-12", "schedule_entry")]),
    });
    await generateAndPersistCoverageFindings([{ boqId: "boq-civil" }, { boqId: "boq-electrical" }], "proj-1", deps);
    expect(deps.persistCoverageFindings).toHaveBeenCalledTimes(2);
    const civilCall = (deps.persistCoverageFindings as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0].boqId === "boq-civil");
    const electricalCall = (deps.persistCoverageFindings as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0].boqId === "boq-electrical");
    expect(civilCall[0].signals).toHaveLength(1);
    expect(civilCall[0].signals[0].normalizedKey).toBe("d-07");
    expect(electricalCall[0].signals).toHaveLength(1);
    expect(electricalCall[0].signals[0].normalizedKey).toBe("w-12");
  });

  it("a later BOQ's persistCoverageFindings failure aborts the loop before it is attempted, but never un-persists an earlier BOQ's already-committed call", async () => {
    const persistCoverageFindings = vi.fn()
      .mockResolvedValueOnce({ runId: "run-civil", createdCount: 1, skippedCount: 0 })
      .mockRejectedValueOnce(new Error("DB error"));
    const deps = baseDeps({
      loadBoqDocumentLinks: vi.fn(async () => [
        { boqId: "boq-civil", documentId: "doc-A" },
        { boqId: "boq-electrical", documentId: "doc-B" },
      ]),
      latestRunForBoq: vi.fn(async () => null),
      loadLocationObservations: vi.fn(async () => [obs("o1", "D-07", "schedule_entry")]),
      persistCoverageFindings,
    });
    await expect(generateAndPersistCoverageFindings([{ boqId: "boq-civil" }, { boqId: "boq-electrical" }], "proj-1", deps))
      .rejects.toThrow("DB error");
    expect(persistCoverageFindings).toHaveBeenCalledTimes(2); // civil committed, electrical attempted and failed
  });

  it("passes projectId through to persistCoverageFindings, including null", async () => {
    const deps = baseDeps({
      loadBoqDocumentLinks: vi.fn(async () => [{ boqId: "boq-civil", documentId: "doc-A" }]),
      latestRunForBoq: vi.fn(async () => null),
      loadLocationObservations: vi.fn(async () => [obs("o1", "D-07", "schedule_entry")]),
    });
    await generateAndPersistCoverageFindings([{ boqId: "boq-civil" }], null, deps);
    expect(deps.persistCoverageFindings).toHaveBeenCalledWith(expect.objectContaining({ projectId: null }));
  });

  it("never mutates boqRefs", async () => {
    const boqRefs = Object.freeze([Object.freeze({ boqId: "boq-civil" })]);
    const deps = baseDeps();
    await expect(generateAndPersistCoverageFindings(boqRefs as { boqId: string }[], "proj-1", deps)).resolves.toBeDefined();
  });
});
