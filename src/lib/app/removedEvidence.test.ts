import { describe, it, expect } from "vitest";
import { removedReviewedItems } from "./removedEvidence";
import type { EvidenceItem } from "@/lib/lineEvidence";

const item = (key: string, reviewStatus: EvidenceItem["reviewStatus"], name = `Item ${key}`): EvidenceItem =>
  ({ id: `ri-${key}-${reviewStatus}`, runId: "r", reviewStatus, ai: { key, item: name, quantity: 1, unit: "nos", confidence: 1, aiStatus: "MEASURED", source: { document: "d", evidence: [] } } } as unknown as EvidenceItem);
const removal = (key: string, at = "2026-10-22T10:00:00Z") => ({ old_value: JSON.stringify({ id: "l", external_key: key, description: `Line ${key}` }), changed_at: at });

describe("removedReviewedItems", () => {
  it("flags a verified or corrected item whose line was removed and is not back", () => {
    expect(removedReviewedItems([item("D1", "VERIFIED"), item("W1", "EDITED")], [], [removal("D1"), removal("W1")]).map((r) => [r.key, r.decision, r.description]))
      .toEqual([["D1", "VERIFIED", "Line D1"], ["W1", "EDITED", "Line W1"]]);
  });
  it("is quiet when the line is back, the item was never removed, or the item is not accepted", () => {
    expect(removedReviewedItems([item("D1", "VERIFIED")], [{ external_key: "D1" }], [removal("D1")])).toEqual([]);
    expect(removedReviewedItems([item("D1", "VERIFIED")], [], [])).toEqual([]);
    expect(removedReviewedItems([item("C1", "PENDING_REVIEW"), item("F1", "FLAGGED")], [], [removal("C1"), removal("F1")])).toEqual([]);
  });
  it("uses the newest decision per key and the latest removal; ignores unreadable records", () => {
    expect(removedReviewedItems([item("D1", "FLAGGED"), item("D1", "VERIFIED")], [], [removal("D1")])).toEqual([]);
    const r = removedReviewedItems([item("D1", "VERIFIED")], [], [removal("D1", "2026-10-01T00:00:00Z"), removal("D1", "2026-10-05T00:00:00Z"), { old_value: "{", changed_at: "x" }]);
    expect(r).toHaveLength(1);
    expect(r[0].removedAt).toBe("2026-10-05T00:00:00Z");
  });
});
