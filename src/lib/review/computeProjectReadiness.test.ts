import { describe, it, expect, vi } from "vitest";
import { computeProjectReadiness, type DisciplineBoqRef, type ReadinessComputeDeps } from "./computeProjectReadiness";
import type { StoredReviewItem } from "./reviewStore";
import type { StoredDrawing } from "./documentResolve";
import type { LocationObservation } from "./locationObservations";

const drawing = (documentId: string): StoredDrawing => ({ documentId, name: `${documentId}.pdf`, filePath: `p/${documentId}/r1.pdf`, pageCount: 1 });

function item(o: Partial<StoredReviewItem> & { id: string } & { ai: Partial<StoredReviewItem["ai"]> & { key: string } }): StoredReviewItem {
  return {
    reviewStatus: "PENDING_REVIEW",
    ...o,
    ai: {
      item: o.ai.key, quantity: 7, unit: "nos", confidence: 0.9, aiStatus: "MEASURED",
      source: { documentId: "doc-1", document: "doc-1.pdf", page: 1, evidence: [{ bbox: [0, 0, 1, 1], page: 1 }] },
      ...o.ai,
    },
  } as StoredReviewItem;
}

function obs(id: string, mark: string, observationType: LocationObservation["observationType"] = "opening"): LocationObservation {
  return { id, observationType, mark, scopeHint: null, locationText: null, attributes: {}, evidence: { evidence: [{ bbox: [0, 0, 1, 1] }] }, evidenceCompleteness: "FULL", createdAt: "2026-01-01T00:00:00Z" };
}

describe("computeProjectReadiness", () => {
  it("a BOQ with no analysis run yet contributes an empty (zeroed) group, never an error", async () => {
    const refs: DisciplineBoqRef[] = [{ discipline: "civil", boqId: "civil-boq", boqName: "Civil Works" }];
    const deps: ReadinessComputeDeps = {
      latestRunForBoq: vi.fn(async () => null),
      loadReviewItems: vi.fn(async () => []),
      loadLocationRun: vi.fn(async () => ({ ran: false, observations: [] })),
    };
    const result = await computeProjectReadiness(refs, [], deps);
    expect(result.projectReadiness.byBoq).toEqual([{ boqId: "civil-boq", boqName: "Civil Works", discipline: "civil", counts: { green: 0, amber: 0, red: 0, total: 0, readyPct: 0 } }]);
    expect(result.exceptions).toEqual([]);
    expect(deps.loadReviewItems).not.toHaveBeenCalled();
  });

  it("an exact-match countable item with schedule evidence and LOCATION run -> GREEN, never listed as an exception", async () => {
    const w1 = item({ id: "item-w1", ai: { key: "W1", quantity: 2, unit: "nos" } });
    const refs: DisciplineBoqRef[] = [{ discipline: "civil", boqId: "civil-boq", boqName: "Civil Works" }];
    const deps: ReadinessComputeDeps = {
      latestRunForBoq: vi.fn(async () => ({ id: "run-1" })),
      loadReviewItems: vi.fn(async () => [w1]),
      loadLocationRun: vi.fn(async () => ({
        ran: true,
        observations: [obs("o1", "W1"), obs("o2", "W1"), obs("sched", "W1", "schedule_entry")],
      })),
    };
    const result = await computeProjectReadiness(refs, [drawing("doc-1")], deps);
    expect(result.projectReadiness.overall).toEqual({ green: 1, amber: 0, red: 0, total: 1, readyPct: 100 });
    expect(result.exceptions).toEqual([]);
  });

  it("a mismatched count produces an AMBER exception row with the item's own expected/located/schedule facts", async () => {
    const w1 = item({ id: "item-w1", ai: { key: "W1", quantity: 7, unit: "nos" } });
    const refs: DisciplineBoqRef[] = [{ discipline: "civil", boqId: "civil-boq", boqName: "Civil Works" }];
    const deps: ReadinessComputeDeps = {
      latestRunForBoq: vi.fn(async () => ({ id: "run-1" })),
      loadReviewItems: vi.fn(async () => [w1]),
      loadLocationRun: vi.fn(async () => ({ ran: true, observations: [obs("o1", "W1"), obs("sched", "W1", "schedule_entry")] })),
    };
    const result = await computeProjectReadiness(refs, [drawing("doc-1")], deps);
    expect(result.exceptions).toEqual([{
      itemId: "item-w1", itemName: "W1", discipline: "civil", boqId: "civil-boq", boqName: "Civil Works",
      expectedQuantity: 7, locatedCount: 1, hasScheduleEntry: true, status: "AMBER",
    }]);
  });

  it("an item whose source document can't be resolved is treated as LOCATION never having run (honest, not fabricated)", async () => {
    const unresolvable = item({ id: "item-x", ai: { key: "X", quantity: 3, unit: "nos", source: { evidence: [] } } });
    const refs: DisciplineBoqRef[] = [{ discipline: "civil", boqId: "civil-boq", boqName: "Civil Works" }];
    const loadLocationRun = vi.fn(async () => ({ ran: true, observations: [] }));
    const deps: ReadinessComputeDeps = {
      latestRunForBoq: vi.fn(async () => ({ id: "run-1" })),
      loadReviewItems: vi.fn(async () => [unresolvable]),
      loadLocationRun,
    };
    const result = await computeProjectReadiness(refs, [], deps);
    expect(loadLocationRun).not.toHaveBeenCalled();
    expect(result.exceptions[0].status).toBe("RED"); // no evidence at all -> RED, independent of LOCATION
  });

  it("memoizes loadLocationRun per document — a document shared by several items across BOQs is only resolved once", async () => {
    const w1Civil = item({ id: "item-civil-w1", ai: { key: "W1", quantity: 2, unit: "nos" } });
    const w1Electrical = item({ id: "item-electrical-w1", ai: { key: "W1", quantity: 2, unit: "nos" } });
    const refs: DisciplineBoqRef[] = [
      { discipline: "civil", boqId: "civil-boq", boqName: "Civil Works" },
      { discipline: "electrical", boqId: "electrical-boq", boqName: "Electrical Works" },
    ];
    const loadLocationRun = vi.fn(async () => ({ ran: true, observations: [obs("o1", "W1"), obs("o2", "W1"), obs("sched", "W1", "schedule_entry")] }));
    const deps: ReadinessComputeDeps = {
      latestRunForBoq: vi.fn(async () => ({ id: "run-1" })),
      loadReviewItems: vi.fn(async (runId: string) => (runId === "run-1" ? [w1Civil] : [w1Electrical])),
      loadLocationRun,
    };
    await computeProjectReadiness(refs, [drawing("doc-1")], deps);
    expect(loadLocationRun).toHaveBeenCalledTimes(1);
  });

  it("aggregates multiple BOQs into byBoq (each kept separate) plus one combined overall", async () => {
    const civilGreen = item({ id: "item-civil", ai: { key: "W1", quantity: 2, unit: "nos" } });
    const electricalRed = item({ id: "item-electrical", ai: { key: "E1", quantity: null, unit: "nos", source: { evidence: [] } } });
    const refs: DisciplineBoqRef[] = [
      { discipline: "civil", boqId: "civil-boq", boqName: "Civil Works" },
      { discipline: "electrical", boqId: "electrical-boq", boqName: "Electrical Works" },
    ];
    const deps: ReadinessComputeDeps = {
      latestRunForBoq: vi.fn(async (boqId: string) => ({ id: boqId === "civil-boq" ? "run-civil" : "run-electrical" })),
      loadReviewItems: vi.fn(async (runId: string) => (runId === "run-civil" ? [civilGreen] : [electricalRed])),
      loadLocationRun: vi.fn(async () => ({ ran: true, observations: [obs("o1", "W1"), obs("o2", "W1"), obs("sched", "W1", "schedule_entry")] })),
    };
    const result = await computeProjectReadiness(refs, [drawing("doc-1")], deps);
    expect(result.projectReadiness.byBoq.find((b) => b.boqId === "civil-boq")?.counts.green).toBe(1);
    expect(result.projectReadiness.byBoq.find((b) => b.boqId === "electrical-boq")?.counts.red).toBe(1);
    expect(result.projectReadiness.overall).toEqual({ green: 1, amber: 0, red: 1, total: 2, readyPct: 50 });
  });
});
