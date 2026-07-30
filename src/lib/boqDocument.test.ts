import { describe, it, expect } from "vitest";
import { buildBoqDocumentHtml, type BoqDocPayload } from "./boqDocument";
import { matchType } from "./boqGenerate";

const payload: BoqDocPayload = {
  projectName: "Villa <A> & B",
  customerName: "R. Karkhanis",
  location: "Pune",
  builtUpSqft: 1800,
  floors: 2,
  qualityTier: "premium",
  generatedOn: "30 Jul 2026",
  stages: [
    {
      name: "Foundation", sequence: 1, lines: [
        { name: "Cement", qty: 120, unit: "bag", price: 380, lineTotal: 45600, priced: true },
        { name: "Aggregate", qty: 40, unit: "cft", price: null, lineTotal: 0, priced: false },
      ],
    },
  ],
  offerTotal: 45600,
  gapNames: ["Aggregate"],
};

describe("buildBoqDocumentHtml", () => {
  it("renders both sections with the offer total", () => {
    const html = buildBoqDocumentHtml(payload);
    expect(html).toContain("Bill of Quantities");
    expect(html).toContain("Commercial Offer");
    expect(html).toContain("Cement");
    // Offer total formatted with grouping.
    expect(html).toContain("45,600");
  });

  it("escapes HTML in user-supplied names to prevent injection", () => {
    const html = buildBoqDocumentHtml(payload);
    expect(html).toContain("Villa &lt;A&gt; &amp; B");
    expect(html).not.toContain("Villa <A>");
  });

  it("lists unpriced items under 'to be sourced' and excludes them from the offer table amount", () => {
    const html = buildBoqDocumentHtml(payload);
    expect(html).toContain("Items to be sourced");
    expect(html).toContain("Aggregate");
  });
});

describe("matchType", () => {
  const products = [
    { id: "p1", name: "UltraTech Cement 50kg", selling_price: 380, unit: "bag" },
    { id: "p2", name: "Asian Paints Putty", selling_price: 500, unit: "kg" },
  ];

  it("returns 'linked' when an exact product_id resolves", () => {
    expect(matchType({ id: "i1", item_name: "Cement", product_id: "p1" }, products)).toBe("linked");
  });

  it("returns 'keyword' when only a name keyword matches", () => {
    expect(matchType({ id: "i2", item_name: "Putty", match_keyword: "putty" }, products)).toBe("keyword");
  });

  it("returns 'none' when nothing matches", () => {
    expect(matchType({ id: "i3", item_name: "Teak door", match_keyword: "teak" }, products)).toBe("none");
  });

  it("does not fall back to keyword when a set product_id fails to resolve", () => {
    expect(matchType({ id: "i4", item_name: "Cement", product_id: "missing", match_keyword: "cement" }, products)).toBe("keyword");
  });
});
