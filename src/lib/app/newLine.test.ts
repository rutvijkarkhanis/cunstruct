import { describe, it, expect } from "vitest";
import { buildNewLine } from "./newLine";

const base = { boqId: "b1", description: "Skirting", unit: "m", qty: "", section: "", sort: 9 };

describe("buildNewLine", () => {
  it("adds a line without a quantity as pending — never an invented quantity", () => {
    const r = buildNewLine(base);
    expect(r).toMatchObject({ ok: true, row: { qty: 0, basis: "PENDING", quantity_status: "PENDING", section: "Other", dsr_rate: null, custom_rate: null, source_document_id: null } });
  });
  it("records an entered quantity as manual", () => {
    expect(buildNewLine({ ...base, qty: "1,250.5" })).toMatchObject({ ok: true, row: { qty: 1250.5, basis: "MANUAL" } });
    expect((buildNewLine({ ...base, qty: "4" }) as { row: Record<string, unknown> }).row).not.toHaveProperty("quantity_status");
  });
  it("takes code, reference rate and section from a picked DSR item", () => {
    expect(buildNewLine({ ...base, qty: "2", dsr: { code: "4.1.2", rate: 512.4, chapter: "Concrete" } }))
      .toMatchObject({ ok: true, row: { dsr_code: "4.1.2", dsr_rate: 512.4, section: "Concrete" } });
    expect(buildNewLine({ ...base, section: "Finishes", dsr: { code: "x", rate: null, chapter: "Concrete" } })).toMatchObject({ row: { section: "Finishes" } });
  });
  it("refuses what is incomplete or not a quantity", () => {
    expect(buildNewLine({ ...base, description: " " })).toEqual({ ok: false, error: "Enter a description." });
    expect(buildNewLine({ ...base, unit: "" })).toEqual({ ok: false, error: "Enter a unit." });
    expect(buildNewLine({ ...base, qty: "-1" })).toEqual({ ok: false, error: "Quantity cannot be negative." });
    expect(buildNewLine({ ...base, qty: "two" }).ok).toBe(false);
  });
});
