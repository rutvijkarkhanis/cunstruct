import { describe, it, expect } from "vitest";
import { parseBoqImport, parseNum } from "./boqImport";

describe("parseNum", () => {
  it("strips currency and thousands separators; blanks → null", () => {
    expect(parseNum("₹1,234.50")).toBe(1234.5);
    expect(parseNum("1,000")).toBe(1000);
    expect(parseNum("12.5")).toBe(12.5);
    expect(parseNum("-")).toBeNull();
    expect(parseNum("")).toBeNull();
    expect(parseNum(undefined)).toBeNull();
  });
});

describe("parseBoqImport", () => {
  it("imports a Cunstruct-style CSV export (header mapped by name)", () => {
    const csv = [
      "Sub-head,Item,Code,Specification,Unit,Qty,Rate (ref excl GST),Your rate,Amount",
      "Sanitary,1.01,17.2.1,European WC with cistern,each,5,1000,1100,5500",
      "Sanitary,1.02,,Wash basin with CP fittings,each,4,,800,3200",
    ].join("\n");
    const { lines } = parseBoqImport(csv);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ section: "Sanitary", code: "17.2.1", description: "European WC with cistern", unit: "each", qty: 5, rate: 1100, amount: 5500 });
    expect(lines[1]).toMatchObject({ description: "Wash basin with CP fittings", qty: 4, rate: 800 });
  });

  it("imports a spreadsheet paste (tab-delimited)", () => {
    const tsv = [
      "Description\tUnit\tQty\tRate\tAmount",
      "Kitchen flooring\tsqft\t126\t85\t10710",
      "Wardrobe\trft\t18.5\t2200\t40700",
    ].join("\n");
    const { lines } = parseBoqImport(tsv);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ description: "Kitchen flooring", unit: "sqft", qty: 126, rate: 85 });
    expect(lines[1].qty).toBe(18.5);
  });

  it("treats a description-only row as a sub-head for the rows beneath it", () => {
    const csv = [
      "Description,Unit,Qty,Rate",
      "ELECTRICAL WORKS,,,",
      "15A socket point,point,25,450",
      "5A socket point,point,18,350",
    ].join("\n");
    const { lines } = parseBoqImport(csv);
    expect(lines).toHaveLength(2);
    expect(lines[0].section).toBe("ELECTRICAL WORKS");
    expect(lines[1].section).toBe("ELECTRICAL WORKS");
  });

  it("derives rate from amount when only an amount is given (preserves the amount)", () => {
    const csv = ["Description,Qty,Amount", "Painting,100,25000"].join("\n");
    const { lines } = parseBoqImport(csv);
    expect(lines[0].rate).toBe(250);          // 25000 / 100
    expect(lines[0].amount).toBe(25000);
    expect(lines[0].qty * (lines[0].rate ?? 0)).toBe(25000);
  });

  it("keeps a quantity with no rate as rate-pending (never invents a price)", () => {
    const csv = ["Description,Unit,Qty,Rate", "Terrace waterproofing,sqft,900,"].join("\n");
    const { lines } = parseBoqImport(csv);
    expect(lines[0].qty).toBe(900);
    expect(lines[0].rate).toBeUndefined();
  });

  it("skips a row with a quantity but no description, and warns", () => {
    const csv = ["Description,Qty,Rate", ",5,100", "Real item,3,200"].join("\n");
    const { lines, warnings } = parseBoqImport(csv);
    expect(lines).toHaveLength(1);
    expect(warnings.some((w) => /no description/i.test(w))).toBe(true);
  });

  it("falls back to positional mapping with no header", () => {
    const csv = ["Cement plaster,sqft,200,45", "RCC,cum,12,7800"].join("\n");
    const { lines, warnings } = parseBoqImport(csv);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ description: "Cement plaster", unit: "sqft", qty: 200, rate: 45 });
    expect(warnings.some((w) => /position/i.test(w))).toBe(true);
  });

  it("handles quoted CSV fields containing commas", () => {
    const csv = ['Description,Unit,Qty,Rate', '"RCC M20, incl. shuttering",cum,12,7800'].join("\n");
    const { lines } = parseBoqImport(csv);
    expect(lines[0].description).toBe("RCC M20, incl. shuttering");
    expect(lines[0].qty).toBe(12);
  });

  it("returns a warning for empty input", () => {
    expect(parseBoqImport("").warnings.length).toBeGreaterThan(0);
    expect(parseBoqImport("").lines).toHaveLength(0);
  });
});
