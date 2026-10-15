// EXPORT × UNRESOLVED DRAWING REVIEW — the quote/schedule must state that
// pending or flagged drawing-review items are not in the BOQ, instead of
// reading as the drawing's complete scope ("Quantity pending: 0 items" alone).

import { describe, it, expect } from "vitest";
import { buildDsrQuoteHtml, computeCommercials, type DsrQuotePayload } from "./boqDsrDocument";

const payload = (over: Partial<DsrQuotePayload> = {}): DsrQuotePayload => ({
  boqName: "Test BOQ",
  generatedOn: "14 Oct 2026",
  subheads: [{ no: 1, name: "Drawing review — added", subtotal: 0, lines: [
    { no: "1.01", code: null, spec: "Fire Sprinkler Heads", qty: 23, unit: "nos", rate: null, amount: null, sourceDocument: "set", sourcePage: "4" },
  ] }],
  abstract: [{ no: 1, name: "Drawing review — added", amount: 0 }],
  commercials: computeCommercials(0, { costIndexPct: 0, contingencyPct: 3, overheadPct: 15, cessPct: 1, gstPct: 18 }),
  ...over,
});

describe("buildDsrQuoteHtml — unresolved drawing-review notice", () => {
  it("priced quote states how many review items are not included", () => {
    const html = buildDsrQuoteHtml(payload({ unresolvedReviewCount: 4 }));
    expect(html).toContain("Incomplete scope.");
    expect(html).toContain("4 drawing-review items are still pending or flagged and are not included in this BOQ.");
  });

  it("schedule issued for pricing (blank rates) states it too", () => {
    const html = buildDsrQuoteHtml(payload({ unresolvedReviewCount: 1, blankRates: true }));
    expect(html).toContain("1 drawing-review item is still pending or flagged and is not included in this BOQ.");
  });

  it("no notice when nothing is unresolved or the count is unknown", () => {
    expect(buildDsrQuoteHtml(payload({ unresolvedReviewCount: 0 }))).not.toContain("Incomplete scope.");
    expect(buildDsrQuoteHtml(payload())).not.toContain("Incomplete scope.");
  });

  it("project size is printed only when the project has one", () => {
    const html = buildDsrQuoteHtml(payload({ builtUpSqft: null, floors: null }));
    expect(html).not.toContain("Built-up:");
    expect(html).not.toContain("Floors:");
  });
});
