// SYNTHETIC revisions only.
import { describe, expect, it } from "vitest";
import { resetIds, revisionDelta } from "./revisionDelta";
import type { EngineLine } from "./types";

const line = (id: string, over: Partial<EngineLine> = {}): EngineLine => ({
  id, description: id, unit: "m³", quantity: 10, quantityState: "established", rate: 100, reviewState: "verified", ...over,
});

describe("revisionDelta", () => {
  it("gives old → new quantity and Δ₹ per line, sorted by |Δ₹|", () => {
    const rows = revisionDelta(
      [line("small", { quantity: 10 }), line("big", { quantity: 10 }), line("drop", { quantity: 10 }), line("same")],
      [line("small", { quantity: 11 }), line("big", { quantity: 40 }), line("drop", { quantity: 5 }), line("same")],
    );
    expect(rows.map((r) => [r.id, r.oldQuantity, r.newQuantity, r.deltaQuantity, r.deltaRs, r.status])).toEqual([
      ["big", 10, 40, 30, 3000, "changed"],
      ["drop", 10, 5, -5, -500, "changed"],
      ["small", 10, 11, 1, 100, "changed"],
      ["same", 10, 10, 0, 0, "unchanged"],
    ]);
  });

  it("only lines whose inputs changed reset to unverified", () => {
    const rows = revisionDelta([line("a"), line("b"), line("c")], [line("a", { quantity: 12 }), line("b"), line("c", { rate: 120 })]);
    expect(resetIds(rows).sort()).toEqual(["a", "c"]);
  });

  it("a pending quantity on either side gives no Δ₹ — never ₹0 — and is listed after priced deltas", () => {
    const rows = revisionDelta(
      [line("p1", { quantityState: "pending", quantity: 0 }), line("p2"), line("x")],
      [line("p1", { quantity: 20 }), line("p2", { quantityState: "pending", quantity: 0 }), line("x", { quantity: 11 })],
    );
    expect(rows.map((r) => [r.id, r.deltaRs, r.status, r.resetsVerification])).toEqual([
      ["x", 100, "changed", true],
      ["p1", null, "unpriced", true],
      ["p2", null, "unpriced", true],
    ]);
    expect(rows.find((r) => r.id === "p1")!.oldQuantity).toBeNull();
  });

  it("a line with no rate has no Δ₹", () => {
    const [r] = revisionDelta([line("n", { rate: null })], [line("n", { rate: null, quantity: 12 })]);
    expect(r).toMatchObject({ deltaQuantity: 2, deltaRs: null, status: "unpriced", resetsVerification: true });
  });

  it("added and removed lines carry their full amount as Δ₹ and reset", () => {
    const rows = revisionDelta([line("gone", { quantity: 3 })], [line("new", { quantity: 2 })]);
    expect(rows.map((r) => [r.id, r.deltaRs, r.status, r.resetsVerification])).toEqual([
      ["gone", -300, "removed", true],
      ["new", 200, "added", true],
    ]);
  });
});
