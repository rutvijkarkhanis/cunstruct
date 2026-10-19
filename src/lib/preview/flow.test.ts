// Integrated preview flow (plan v1.2 §5B) on the SYNTHETIC fixture project.
// Local, deterministic, mock-only evidence: no drawing is measured and no
// figure here is a real estimate.
import { describe, expect, it } from "vitest";
import { seedCatalogue } from "@/lib/dsr/seedFixture";
import { NO_MATCH_LABEL, PROVISIONAL_LABEL } from "@/lib/priceFirst";
import { FLOW_DSR_CANDIDATES, FLOW_PROJECT, FLOW_REVISION_C } from "@/preview/flow/fixtures";
import {
  applyRevision, editMeasurement, emptyReview, recordCheck, recordSampleFinding, reopenFlowGap, resolveFlowGap, runFlow,
  type FlowProject, type FlowResult, type FlowReview,
} from "./flow";
import { resetIds } from "./revisionDelta";

const line = (r: FlowResult, id: string) => r.lines.find((l) => l.id === id)!;
const REVIEWER = "Owner (test)";

/** Accept every measured line, verify key items, clear coverage, check the sample and regions. */
function fullyReviewed(project: FlowProject, opts: { verifyKey?: boolean; clearCoverage?: boolean; sampleFound?: (book: number) => number } = {}) {
  let review: FlowReview = emptyReview();
  let r = runFlow(project, review);
  for (const l of r.lines) {
    if (l.quantityState === "pending") continue;
    const key = l.amount != null && l.amount >= project.materiality;
    review = recordCheck(review, r, l.id, key && opts.verifyKey !== false ? "verified" : "accepted", REVIEWER);
  }
  r = runFlow(project, review);
  if (opts.clearCoverage !== false) {
    for (const g of r.gaps) review = resolveFlowGap(review, r, g.id, { type: "excluded", reason: "Not in this package (test)", by: REVIEWER, at: "2026-10-19T00:00:00Z" });
  }
  r = runFlow(project, review);
  for (const { plan } of r.signOff.plans) for (const s of plan.selected) review = recordSampleFinding(review, r, s.id, (opts.sampleFound ?? ((b) => b))(s.book));
  for (const id of r.signOff.regionPlan.selected) review = { ...review, regionMisses: { ...review.regionMisses, [id]: false } };
  return review;
}

/** The fixture with its pending and no-match lines measured/removed, so it can become certifiable. */
const COMPLETE: FlowProject = {
  ...FLOW_PROJECT,
  lines: FLOW_PROJECT.lines.filter((l) => l.id !== "FL-5" && l.id !== "FL-6"),
};

describe("fixture: DSR candidates are the shipped seed, unchanged", () => {
  it("every candidate matches the DSR 2023 seed row exactly (no invented rate)", () => {
    const seed = seedCatalogue();
    for (const c of FLOW_DSR_CANDIDATES) {
      const s = seed.find((i) => i.source === c.source && i.rate_year === c.rate_year && i.code === c.code);
      expect(s, c.code).toBeDefined();
      expect({ ...c }).toEqual({ ...s });
    }
  });
});

describe("pipeline: measurement → price first → amounts", () => {
  const r = runFlow(FLOW_PROJECT, emptyReview());

  it("measured quantities come from the measurement rows (gross − deductions)", () => {
    expect(line(r, "FL-1").measurement.total).toBe(25.92);
    expect(line(r, "FL-2").measurement.total).toBe(2.16);
    expect(line(r, "FL-3").measurement.total).toBe(15.31); // 8.28 + 8.69 − 1.66
    expect(line(r, "FL-4").measurement.total).toBe(47.1);
    expect(line(r, "FL-6").measurement.status).toBe("pending");
  });

  it("each line gets a provisional DSR rate or an explicit no-match; amounts only where quantity and rate are known", () => {
    expect(line(r, "FL-3").pricing).toMatchObject({ kind: "provisional_dsr", code: "6.4.2", rate: 9105.95, label: PROVISIONAL_LABEL });
    expect(line(r, "FL-3").amount).toBe(139412);
    expect(line(r, "FL-5").pricing).toMatchObject({ kind: "no_match", label: NO_MATCH_LABEL, amount: null });
    expect(line(r, "FL-5").rate).toBeNull();
    expect(line(r, "FL-5").amount).toBeNull();
    expect(r.totals).toMatchObject({ lines: 6, measured: 5, pending: 1, noMatch: 1, provisionalAmount: 6747 + 14714 + 139412 + 16831 });
  });

  it("a pending quantity never gets an amount, even though its rate is known", () => {
    const pending = line(r, "FL-6");
    expect(pending.quantityState).toBe("pending");
    expect(pending.rate).toBe(1553.45);
    expect(pending.amount).toBeNull();
    expect(pending.pricing.amount).toBeNull();
    const ranked = r.queue.ranked.find((x) => x.line.id === "FL-6")!;
    expect(ranked.amount).toBeNull();
    expect(ranked.riskRs).toBeNull();
    expect(r.signOff.pools.blocked.pending).toEqual(["FL-6"]);
  });

  it("an invalid measurement is withheld (pending, no amount), and blocks certification by name", () => {
    const bad = editMeasurement(FLOW_PROJECT, "FL-4", "FL-4.2", "L", 99); // deduction exceeds gross
    const rb = runFlow(bad, emptyReview());
    expect(line(rb, "FL-4").measurement.status).toBe("invalid");
    expect(line(rb, "FL-4").quantityState).toBe("pending");
    expect(line(rb, "FL-4").amount).toBeNull();
    expect(rb.blockers).toContain("1 line(s) with a measurement error: total withheld");
  });

  it("clearing a measured value makes the line pending: its amount disappears rather than becoming ₹0", () => {
    const r2 = runFlow(editMeasurement(FLOW_PROJECT, "FL-1", "FL-1.1", "D", null), emptyReview());
    expect(line(r2, "FL-1").quantityState).toBe("pending");
    expect(line(r2, "FL-1").amount).toBeNull();
    expect(r2.totals.provisionalAmount).toBe(r.totals.provisionalAmount - 6747);
  });

  it("measuring the pending row gives the line an amount from its measured total", () => {
    const r2 = runFlow(editMeasurement(FLOW_PROJECT, "FL-6", "FL-6.2", "L", 4), emptyReview());
    expect(line(r2, "FL-6").measurement.total).toBe(20); // 7.2 + 12.8
    expect(line(r2, "FL-6").amount).toBe(Math.round(20 * 1553.45));
  });
});

describe("money-at-risk queue follows the pipeline", () => {
  it("pending first, then priced lines by risk ₹, then no-DSR-match lines", () => {
    const r = runFlow(FLOW_PROJECT, emptyReview());
    expect(r.queue.ranked.map((x) => x.line.id)).toEqual(["FL-6", "FL-3", "FL-4", "FL-2", "FL-1", "FL-5"]);
    expect(r.queue.ranked[1]).toMatchObject({ isKey: true, riskRs: 69706 });
  });

  it("a check lowers a line's risk and re-orders the queue; an edit puts it back", () => {
    let review = emptyReview();
    const r0 = runFlow(FLOW_PROJECT, review);
    review = recordCheck(review, r0, "FL-4", "verified", REVIEWER);
    const r1 = runFlow(FLOW_PROJECT, review);
    expect(r1.queue.ranked.map((x) => x.line.id)).toEqual(["FL-6", "FL-3", "FL-2", "FL-1", "FL-4", "FL-5"]);
    const edited = editMeasurement(FLOW_PROJECT, "FL-4", "FL-4.1", "L", 16.5);
    const r2 = runFlow(edited, review);
    expect(r2.queue.ranked.map((x) => x.line.id).indexOf("FL-4")).toBe(2);
  });
});

describe("verification resets on input change, for that line only", () => {
  const checkedAll = () => {
    let review = emptyReview();
    const r = runFlow(FLOW_PROJECT, review);
    for (const id of ["FL-1", "FL-2", "FL-3", "FL-4", "FL-5"]) review = recordCheck(review, r, id, "accepted", REVIEWER);
    return review;
  };

  it("editing a measurement row resets that line's check and no other", () => {
    const review = checkedAll();
    const r = runFlow(editMeasurement(FLOW_PROJECT, "FL-2", "FL-2.1", "no", 3), review);
    expect(line(r, "FL-2")).toMatchObject({ check: null, reset: true });
    expect(line(r, "FL-2").engine.reviewState).toBe("needs_review");
    for (const id of ["FL-1", "FL-3", "FL-4", "FL-5"]) expect(line(r, id).check?.outcome, id).toBe("accepted");
    expect(r.totals.reset).toBe(1);
  });

  it("a row edit that leaves the total unchanged still resets (the rows are part of the fingerprint)", () => {
    const review = checkedAll();
    // 2 × 12 × 0.9 × 0.1 → 1 × 24 × 0.9 × 0.1: same 2.16 m³, different rows.
    const p = editMeasurement(editMeasurement(FLOW_PROJECT, "FL-2", "FL-2.1", "no", 1), "FL-2", "FL-2.1", "L", 24);
    const r = runFlow(p, review);
    expect(line(r, "FL-2").measurement.total).toBe(2.16);
    expect(line(r, "FL-2").reset).toBe(true);
  });

  it("a rate change (different DSR candidate rate) resets the lines priced from it only", () => {
    const review = checkedAll();
    const p = { ...FLOW_PROJECT, dsr: FLOW_PROJECT.dsr.map((d) => (d.code === "13.4.1" ? { ...d, rate: 400 } : d)) };
    const r = runFlow(p, review);
    expect(line(r, "FL-4").reset).toBe(true);
    expect(r.lines.filter((l) => l.reset).map((l) => l.id)).toEqual(["FL-4"]);
  });

  it("a drawing revision id change on its own resets every check", () => {
    const review = checkedAll();
    const r = runFlow({ ...FLOW_PROJECT, drawingRevision: "OTHER" }, review);
    expect(r.lines.filter((l) => l.check).length).toBe(0);
  });

  it("a pending line cannot be checked", () => {
    const r = runFlow(FLOW_PROJECT, emptyReview());
    expect(() => recordCheck(emptyReview(), r, "FL-6", "accepted", REVIEWER)).toThrow(/measure it before review/);
  });

  it("a sample finding is also tied to the line's inputs", () => {
    const review = fullyReviewed(COMPLETE);
    const r = runFlow(COMPLETE, review, { previewMode: false });
    expect(r.signOff.allEvaluated).toBe(true);
    const sampledId = r.signOff.plans.flatMap(({ plan }) => plan.selected)[0].id;
    const p = editMeasurement(COMPLETE, sampledId, `${sampledId}.1`, "no", 5);
    const edited = runFlow(p, review, { previewMode: false });
    // The edit resets the line's check: it leaves the sample pools and is unreviewed again.
    expect(edited.blockers).toContain("1 line(s) not yet reviewed");
    // Re-accepted, it is back in the sample, but the old finding no longer counts.
    const again = runFlow(p, recordCheck(review, edited, sampledId, "accepted", REVIEWER), { previewMode: false });
    expect(again.signOff.evals.flatMap((e) => e.awaiting)).toContain(sampledId);
    expect(again.signOff.allEvaluated).toBe(false);
  });
});

describe("revision delta resets only changed lines", () => {
  it("revision C changes FL-1 only: FL-1 resets, every other check carries to the new revision", () => {
    let review = emptyReview();
    const r0 = runFlow(FLOW_PROJECT, review);
    for (const id of ["FL-1", "FL-2", "FL-3", "FL-4", "FL-5"]) review = recordCheck(review, r0, id, "accepted", REVIEWER);
    const out = applyRevision(FLOW_PROJECT, review, FLOW_REVISION_C);
    expect(out.project.drawingRevision).toBe("DEMO-REV-C");
    expect(out.changed).toEqual(["FL-1"]);
    expect(resetIds(out.delta)).toEqual(["FL-1"]);
    const d = out.delta.find((x) => x.id === "FL-1")!;
    expect(d).toMatchObject({ oldQuantity: 25.92, newQuantity: 29.16, deltaRs: Math.round(29.16 * 260.3) - 6747, status: "changed" });
    const r1 = runFlow(out.project, out.review);
    expect(line(r1, "FL-1")).toMatchObject({ check: null, reset: true });
    for (const id of ["FL-2", "FL-3", "FL-4", "FL-5"]) expect(line(r1, id).check?.outcome, id).toBe("accepted");
    // The pending line stays pending, with no Δ₹.
    expect(out.delta.find((x) => x.id === "FL-6")).toMatchObject({ deltaRs: null, newQuantity: null });
  });

  it("refuses a revision for a line the project does not have", () => {
    expect(() => applyRevision(FLOW_PROJECT, emptyReview(), { id: "X", rows: { NOPE: [] } })).toThrow(/unknown line NOPE/);
  });
});

describe("certification readiness", () => {
  it("the preview itself never certifies", () => {
    const r = runFlow(COMPLETE, fullyReviewed(COMPLETE));
    expect(r.certifiable).toBe(false);
    expect(r.blockers).toEqual(["Engineering preview: certification is never issued here"]);
  });

  it("with every condition met (outside preview mode) nothing blocks", () => {
    const r = runFlow(COMPLETE, fullyReviewed(COMPLETE), { previewMode: false });
    expect(r.blockers).toEqual([]);
    expect(r.certifiable).toBe(true);
  });

  it("an unresolved coverage item blocks; resolving it unblocks; reopening blocks again", () => {
    const review = fullyReviewed(COMPLETE, { clearCoverage: false });
    let r = runFlow(COMPLETE, review, { previewMode: false });
    expect(r.blockers).toContain("Coverage gaps not all resolved or excluded with a reason");
    let rv = review;
    for (const g of r.gaps) rv = resolveFlowGap(rv, r, g.id, { type: "resolved", reason: "FL-3 covers it (test)", by: REVIEWER, at: "t" });
    r = runFlow(COMPLETE, rv, { previewMode: false });
    expect(r.certifiable).toBe(true);
    rv = reopenFlowGap(rv, r.gaps[0].id);
    expect(runFlow(COMPLETE, rv, { previewMode: false }).certifiable).toBe(false);
  });

  it("an exclusion without a reason is refused", () => {
    const r = runFlow(COMPLETE, emptyReview());
    expect(() => resolveFlowGap(emptyReview(), r, r.gaps[0].id, { type: "excluded", reason: " ", by: REVIEWER, at: "t" })).toThrow(/written reason/);
  });

  it("a key item that is accepted but not verified blocks", () => {
    const r = runFlow(COMPLETE, fullyReviewed(COMPLETE, { verifyKey: false }), { previewMode: false });
    expect(r.blockers).toContain("1 key item(s) not yet verified (100% review required)");
    expect(r.certifiable).toBe(false);
  });

  it("a key item whose measurement changes after verification blocks again", () => {
    const review = fullyReviewed(COMPLETE);
    const r = runFlow(editMeasurement(COMPLETE, "FL-3", "FL-3.1", "L", 6.1), review, { previewMode: false });
    expect(r.blockers).toContain("1 key item(s) not yet verified (100% review required)");
  });

  it("residual error over tolerable blocks", () => {
    const r = runFlow(COMPLETE, fullyReviewed(COMPLETE, { sampleFound: () => 0 }), { previewMode: false });
    expect(r.signOff.allWithin).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/exceeds tolerable error/);
    expect(r.certifiable).toBe(false);
  });

  it("pending quantities, no-DSR-match lines and unreviewed lines block, each by name", () => {
    const r = runFlow(FLOW_PROJECT, emptyReview(), { previewMode: false });
    expect(r.blockers).toEqual(expect.arrayContaining([
      "1 line(s) with a pending quantity",
      "1 line(s) with no DSR match: market rate needed",
      "5 line(s) not yet reviewed",
    ]));
  });
});
