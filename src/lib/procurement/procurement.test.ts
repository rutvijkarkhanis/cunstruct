// B11 procurement preview lib — ILLUSTRATIVE FIXTURES and repo-seed coefficients.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PREVIEW_COEFFICIENTS, PREVIEW_DEALER, PREVIEW_PROCUREMENT_LINES, PREVIEW_SCHEDULE,
  buildPreviewProcurementPlan, phaseCallOffs, reconcileIssues, requirementsFromBoq,
  type MaterialCoefficient, type ProcurementBoqLine,
} from "./index";

const line = (over: Partial<ProcurementBoqLine>): ProcurementBoqLine => ({
  id: "X", dsrCode: "4.1.3", description: "x", unit: "cum", quantity: 10,
  quantityState: "established", certification: "certified", workPackageId: "WP-1", ...over,
});

describe("requirementsFromBoq — exclusions", () => {
  const { materials, notProcurable, procurableLineIds } = requirementsFromBoq(PREVIEW_PROCUREMENT_LINES, PREVIEW_COEFFICIENTS);

  it("only certified/verified lines with an established, positive quantity and coefficients are procurable", () => {
    expect(procurableLineIds).toEqual(["PL-01", "PL-04", "PL-05"]);
  });

  it("lists every other line as not procurable yet, with a reason", () => {
    expect(notProcurable.map((n) => [n.lineId, n.reasonCode])).toEqual([
      ["PL-02", "quantity_pending"],
      ["PL-03", "not_certified"],
      ["PL-06", "confirmed_zero"],
      ["PL-07", "no_coefficients"],
    ]);
    for (const n of notProcurable) expect(n.reason.length).toBeGreaterThan(10);
  });

  it("a pending-quantity line carries no quantity and no amount, and adds nothing to any material", () => {
    const pending = notProcurable.find((n) => n.lineId === "PL-02")!;
    expect(pending.quantity).toBeNull();
    expect(pending.amount).toBeNull();
    const steel = materials.find((m) => m.materialKey === "tmt-bars")!;
    expect(steel.contributions.map((c) => c.lineId)).toEqual(["PL-04"]);
    expect(steel.quantity).toBe(441); // 420 kg × 1.05 (seed line 970)
  });

  it("an uncertified line is excluded even when its quantity is established", () => {
    const r = requirementsFromBoq([line({ certification: "needs_review" }), line({ id: "Y", certification: "returned" }), line({ id: "Z", certification: "draft" })], PREVIEW_COEFFICIENTS);
    expect(r.needs).toEqual([]);
    expect(r.notProcurable.every((n) => n.reasonCode === "not_certified")).toBe(true);
  });

  it("an established line with a null or negative quantity is invalid, never treated as 0", () => {
    const r = requirementsFromBoq([line({ quantity: null }), line({ id: "N", quantity: -2 })], PREVIEW_COEFFICIENTS);
    expect(r.notProcurable.map((n) => n.reasonCode)).toEqual(["invalid_quantity", "invalid_quantity"]);
  });

  it("a unit mismatch between line and coefficient is excluded, not converted silently", () => {
    const r = requirementsFromBoq([line({ unit: "sqm" })], PREVIEW_COEFFICIENTS);
    expect(r.notProcurable[0].reasonCode).toBe("unit_mismatch");
  });

  it("a line without a DSR code is excluded", () => {
    expect(requirementsFromBoq([line({ dsrCode: null })], PREVIEW_COEFFICIENTS).notProcurable[0].reasonCode).toBe("no_dsr_code");
  });
});

describe("requirementsFromBoq — aggregation and provenance", () => {
  const { materials } = requirementsFromBoq(PREVIEW_PROCUREMENT_LINES, PREVIEW_COEFFICIENTS);
  const byKey = Object.fromEntries(materials.map((m) => [`${m.materialKey}|${m.unit}`, m]));

  it("multiplies quantity by coefficient and aggregates the same material across items", () => {
    expect(byKey["aggregate-20mm|cum"].quantity).toBe(4.355); // 6.5 × 0.67
    expect(byKey["aggregate-10mm|cum"].quantity).toBe(1.43); // 6.5 × 0.22
    expect(byKey["cement|tonne"].quantity).toBe(2.656); // 6.5 × 0.32 + 9.6 × 0.06 (illustrative)
    expect(byKey["coarse-sand|cum"].quantity).toBe(5.485); // 2.893 + 2.592
    expect(byKey["bricks|nos"].quantity).toBe(4800);
  });

  it("flags a material illustrative when any contribution uses an illustrative coefficient", () => {
    expect(byKey["aggregate-20mm|cum"].illustrative).toBe(false);
    expect(byKey["tmt-bars|kg"].illustrative).toBe(false);
    expect(byKey["cement|tonne"].illustrative).toBe(true);
    expect(byKey["bricks|nos"].illustrative).toBe(true);
  });

  it("repo-seed coefficients match the rows in the cited migration file and are marked unverified", () => {
    const sql = readFileSync(resolve(__dirname, "../../../supabase/migrations/20260731002000_dar_coefficients.sql"), "utf8").split("\n");
    const seeded = PREVIEW_COEFFICIENTS.filter((c): c is MaterialCoefficient & { source: { kind: "repo_seed" } } => c.source.kind === "repo_seed");
    expect(seeded.length).toBeGreaterThan(0);
    for (const c of seeded) {
      expect(c.source.verified).toBe(false);
      const row = sql[c.source.lines[0] - 1];
      expect(row).toContain(`'${c.itemCode}'`);
      expect(row).toContain(`,${c.perItemUnit},`);
    }
  });

  it("every non-seed coefficient is labelled an illustrative fixture", () => {
    for (const c of PREVIEW_COEFFICIENTS) {
      if (c.source.kind !== "repo_seed") expect(c.source.note).toMatch(/Illustrative fixture/);
    }
  });
});

describe("phaseCallOffs", () => {
  const { needs } = requirementsFromBoq(PREVIEW_PROCUREMENT_LINES, PREVIEW_COEFFICIENTS);
  const { callOffs, unscheduled } = phaseCallOffs(needs, PREVIEW_SCHEDULE, PREVIEW_DEALER, 1);

  it("produces one call-off per work week, placed one lead week earlier, to the contractor's own dealer", () => {
    expect(callOffs.map((c) => [c.needWeek, c.placeByWeek])).toEqual([[2, 1], [3, 2], [4, 3], [5, 4], [6, 5]]);
    for (const c of callOffs) {
      expect(c.dealer.relationship).toBe("contractor_own_dealer");
      expect(c.dealer.illustrative).toBe(true);
    }
    expect(unscheduled).toEqual([]);
  });

  it("splits evenly and puts the rounding remainder in the last week, so totals are preserved", () => {
    const agg20 = callOffs.flatMap((c) => c.items.filter((i) => i.materialKey === "aggregate-20mm").map((i) => i.quantity));
    expect(agg20).toEqual([2.178, 2.177]);
    const totals = new Map<string, number>();
    for (const c of callOffs) for (const i of c.items) totals.set(`${i.materialKey}|${i.unit}`, (totals.get(`${i.materialKey}|${i.unit}`) ?? 0) + i.quantity);
    const { materials } = requirementsFromBoq(PREVIEW_PROCUREMENT_LINES, PREVIEW_COEFFICIENTS);
    for (const m of materials) expect(Math.round(totals.get(`${m.materialKey}|${m.unit}`)! * 1000) / 1000).toBe(m.quantity);
  });

  it("call-offs only ever contain procurable lines", () => {
    const ids = new Set(callOffs.flatMap((c) => c.items.flatMap((i) => i.lineIds)));
    expect([...ids].sort()).toEqual(["PL-01", "PL-04", "PL-05"]);
  });

  it("reports needs whose work package is missing or invalid instead of guessing a week", () => {
    const r = phaseCallOffs(
      [
        { ...needs[0], lineId: "A", workPackageId: null },
        { ...needs[0], lineId: "B", workPackageId: "WP-9" },
        { ...needs[0], lineId: "C", workPackageId: "BAD" },
      ],
      [{ id: "BAD", name: "bad", startWeek: 5, endWeek: 3 }],
      PREVIEW_DEALER,
      1,
    );
    expect(r.callOffs).toEqual([]);
    expect(r.unscheduled.map((u) => u.reason)).toEqual(["no_work_package", "unknown_work_package", "invalid_schedule"]);
  });
});

describe("reconcileIssues", () => {
  const { reconciliation } = buildPreviewProcurementPlan();
  const byKey = Object.fromEntries(reconciliation.rows.map((r) => [r.materialKey, r]));

  it("theoretical consumption is work done × coefficient", () => {
    expect(byKey["tmt-bars"].theoretical).toBe(315); // 300 × 1.05
    expect(byKey["bricks"].theoretical).toBe(2000); // 4 × 500 (illustrative)
    expect(byKey["aggregate-20mm"].theoretical).toBe(4.355);
  });

  it("flags over- and under-issue beyond the tolerance and passes those within it", () => {
    expect(byKey["tmt-bars"].status).toBe("within_tolerance"); // +4.8 %
    expect(byKey["tmt-bars"].variancePct).toBe(4.8);
    expect(byKey["coarse-sand"].status).toBe("over_issue");
    expect(byKey["bricks"].status).toBe("under_issue"); // −15 %
    expect(byKey["bricks"].variancePct).toBe(-15);
    expect(byKey["cement"].status).toBe("within_tolerance");
  });

  it("ignores work recorded on a non-procurable line and warns", () => {
    expect(reconciliation.warnings).toEqual([expect.objectContaining({ lineId: "PL-03", code: "work_on_non_procurable_line" })]);
  });

  it("flags issue of a material with no theoretical counterpart, and work beyond the certified quantity", () => {
    const r = reconcileIssues(
      PREVIEW_PROCUREMENT_LINES, PREVIEW_COEFFICIENTS,
      [{ lineId: "PL-04", quantityDone: 500 }],
      [{ materialKey: "binding-wire", unit: "kg", quantity: 3 }],
      5,
    );
    expect(r.rows.find((x) => x.materialKey === "binding-wire")!.status).toBe("unmatched_issue");
    expect(r.warnings.map((w) => w.code)).toEqual(["work_exceeds_certified"]);
  });

  it("with no work done, any issue is over-issue (variance % undefined)", () => {
    const r = reconcileIssues(PREVIEW_PROCUREMENT_LINES, PREVIEW_COEFFICIENTS, [{ lineId: "PL-04", quantityDone: 0 }], [{ materialKey: "tmt-bars", unit: "kg", quantity: 10 }], 5);
    expect(r.rows[0]).toMatchObject({ status: "over_issue", variancePct: null });
  });
});
