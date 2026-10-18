// SYNTHETIC lines only; the uncertainty scores are stated assumptions, not measurements.
import { describe, expect, it } from "vitest";
import { rankByMoneyAtRisk, UNCERTAINTY } from "./moneyAtRisk";
import type { EngineLine } from "./types";

const line = (id: string, over: Partial<EngineLine> = {}): EngineLine => ({
  id, description: id, unit: "m³", quantity: 10, quantityState: "established", rate: 100, reviewState: "needs_review", ...over,
});

describe("rankByMoneyAtRisk", () => {
  it("orders priced lines by uncertainty × rate × quantity", () => {
    const r = rankByMoneyAtRisk([
      line("small", { quantity: 1 }), // 0.5 × 100 = 50
      line("big", { quantity: 100 }), // 0.5 × 10,000 = 5,000
      line("accepted", { quantity: 100, reviewState: "accepted" }), // 0.1 × 10,000 = 1,000
    ], 1_000_000);
    expect(r.ranked.map((x) => [x.line.id, x.riskRs])).toEqual([["big", 5000], ["accepted", 1000], ["small", 50]]);
    expect(r.totalRiskRs).toBe(6050);
  });

  it("states the uncertainty per review state, and a verified line carries no risk", () => {
    expect(UNCERTAINTY).toEqual({ needs_review: 0.5, accepted: 0.1, corrected: 0.05, verified: 0 });
    expect(rankByMoneyAtRisk([line("v", { reviewState: "verified" })], 1e9).ranked[0].riskRs).toBe(0);
  });

  it("lists pending quantities first with no ₹ figure, and no-rate lines last, never as ₹0", () => {
    const r = rankByMoneyAtRisk([
      line("priced"),
      line("norate", { rate: null }),
      line("pending-cheap", { quantityState: "pending", rate: 10 }),
      line("pending-dear", { quantityState: "pending", rate: 9000 }),
    ], 1e9);
    expect(r.ranked.map((x) => [x.line.id, x.band, x.riskRs, x.amount])).toEqual([
      ["pending-dear", "unquantified", null, null],
      ["pending-cheap", "unquantified", null, null],
      ["priced", "priced", 500, 1000],
      ["norate", "unpriced", null, null],
    ]);
    expect(r.excluded).toEqual({ pending: 2, noRate: 1 });
    expect(r.ranked.find((x) => x.line.id === "norate")!.reasons).toContain("NO_DSR_MATCH");
    expect(r.ranked[0].reasons).toContain("PENDING_QUANTITY");
  });

  it("flags key items at or above the materiality threshold for 100% review", () => {
    const r = rankByMoneyAtRisk([line("at", { quantity: 50 }), line("below", { quantity: 49 })], 5000);
    expect(r.ranked.find((x) => x.line.id === "at")).toMatchObject({ isKey: true, reasons: expect.arrayContaining(["KEY_ITEM"]) });
    expect(r.ranked.find((x) => x.line.id === "below")!.isKey).toBe(false);
  });

  it("a confirmed zero is priced at ₹0 and labelled, distinct from pending", () => {
    const z = rankByMoneyAtRisk([line("z", { quantity: 0, quantityState: "confirmed_zero" })], 1e9).ranked[0];
    expect(z).toMatchObject({ band: "priced", amount: 0, riskRs: 0 });
    expect(z.reasons).toContain("CONFIRMED_ZERO");
  });

  it("is deterministic: ties break by amount, then rate, then id, whatever the input order", () => {
    const ls = [line("b"), line("a"), line("c", { quantity: 5, rate: 200 })];
    const ids = (xs: EngineLine[]) => rankByMoneyAtRisk(xs, 1e9).ranked.map((x) => x.line.id);
    expect(ids(ls)).toEqual(["c", "a", "b"]); // equal risk and amount: higher rate first, then id
    expect(ids([...ls].reverse())).toEqual(ids(ls));
    expect(rankByMoneyAtRisk(ls, 1e9).ranked.map((x) => x.rank)).toEqual([1, 2, 3]);
  });

  it("refuses a non-positive materiality threshold", () => {
    expect(() => rankByMoneyAtRisk([], 0)).toThrow(/materialityThreshold/);
  });
});
