// SYNTHETIC CONTROLS for the locked tender BoQ export (owner-only preview lane,
// plan v1.2 §5B, derived from B8). The tender workbook below is SYNTHETIC — built
// in this test to mimic a department file's structure (title rows with merged
// cells, sections, amount formulas, subtotals, a grand total carried to an
// abstract sheet, a protected sheet). It is not a real tender, and passing these
// tests is not B8's acceptance (which needs a real department file).
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { checkTenderConsistency, fillTenderRates, mapLinesToTender, readTenderWorkbook, writeTenderWorkbook, type CunstructLine } from "./index";

const SHEET = "Civil";

async function syntheticTender(opts: { plantWrongTotal?: boolean; prefilledRate?: boolean } = {}): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET);
  ws.mergeCells("A1:G1");
  ws.getCell("A1").value = "SYNTHETIC TENDER — NOT A REAL DEPARTMENT FILE";
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells("A2:G2");
  ws.getCell("A2").value = "Name of work: synthetic test building";
  ws.getRow(3).values = ["Item No", "Description", "Unit", "Qty", "Rate (Rs)", "Amount (Rs)", "Remarks"];
  ws.getRow(3).font = { bold: true };
  const rows: [number, (string | number | null | { formula: string })[]][] = [
    [4, [null, "EARTH WORK"]],
    [5, ["1.1", "Excavation in foundation", "cum", 120, null, { formula: "D5*E5" }, "as per drawing"]],
    [6, ["1.2", "Filling in plinth", "cum", 45.5, null, { formula: "D6*E6" }]],
    [7, [null, "Sub-total Earth work", null, null, null, { formula: opts.plantWrongTotal ? "SUM(F5:F5)" : "SUM(F5:F6)" }]],
    [8, [null, "CONCRETE"]],
    [9, ["2.1", "PCC 1:4:8", "cum", 30, opts.prefilledRate ? 999 : null, { formula: "ROUND(D9*E9,2)" }]],
    [10, ["2.2", "RCC M25 in columns", "cum", 18.2, null, { formula: "D10*E10" }]],
    [11, ["2.3", "Formwork for columns", "sqm", 150, null, { formula: "$D11*$E11" }]],
    [12, [null, "Sub-total Concrete", null, null, null, { formula: "SUM(F9:F11)" }]],
    [13, [null, "Grand total carried to abstract", null, null, null, { formula: "F7+F12" }]],
  ];
  for (const [r, vals] of rows) vals.forEach((v, i) => { if (v != null) ws.getRow(r).getCell(i + 1).value = v as ExcelJS.CellValue; });
  ws.getColumn(5).numFmt = "#,##0.00";
  await ws.protect("synthetic", { selectLockedCells: true });
  const ab = wb.addWorksheet("Abstract");
  ab.getCell("A1").value = "Abstract of cost (SYNTHETIC)";
  ab.getCell("A3").value = "Civil";
  ab.getCell("B3").value = { formula: "'Civil'!F13" } as ExcelJS.CellValue;
  const notes = wb.addWorksheet("Notes");
  notes.getCell("A1").value = "Rates shall include GST. (synthetic)";
  notes.getCell("A1").font = { italic: true };
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

const LINES: CunstructLine[] = [
  { id: "L1", tenderItemNo: "1.1", description: "Earthwork excavation", unit: "cum", qty: 120, rate: 250, quantityState: "established" },
  { id: "L2", description: "filling in   PLINTH", unit: "Cum", qty: 45.5, rate: 180, quantityState: "established" },          // exact description + unit
  { id: "L3", tenderItemNo: "2.1.", description: "PCC", unit: "m3", qty: 30, rate: 6000, quantityState: "established" },       // "2.1." = 2.1; m3 = cum
  { id: "L4", tenderItemNo: "2.2", description: "RCC columns", unit: "sqm", qty: 18.2, rate: 9000, quantityState: "established" }, // unit differs
  { id: "L5", description: "Formwork for columns", unit: "sqm", qty: 150, rate: null, quantityState: "established" },           // no rate
  { id: "L6", description: "Brickwork 230 mm", unit: "cum", qty: 12, rate: 7000, quantityState: "established" },               // not in tender
];

/** Every cell of every sheet as comparable JSON (value, style, merge master). */
async function snapshot(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const out: Record<string, unknown> = { sheets: wb.worksheets.map((w) => w.name) };
  for (const ws of wb.worksheets) {
    out[`${ws.name}:merges`] = [...((ws.model as { merges?: string[] }).merges ?? [])].sort();
    out[`${ws.name}:protection`] = (ws as unknown as { sheetProtection?: unknown }).sheetProtection ?? null;
    ws.eachRow({ includeEmpty: true }, (row, r) => row.eachCell({ includeEmpty: true }, (cell, c) => {
      out[`${ws.name}!${r}:${c}`] = JSON.stringify({ v: cell.value, f: cell.font ?? null, n: cell.numFmt ?? null, m: cell.isMerged ? cell.master.address : null });
    }));
  }
  return out;
}

async function run(bytes: Uint8Array, lines = LINES, gapMode: "blank" | "zero" = "blank") {
  const read = await readTenderWorkbook(bytes);
  const mapping = mapLinesToTender(read, lines);
  const fill = fillTenderRates(read, mapping, { gapMode });
  const report = checkTenderConsistency(read, mapping);
  const out = await writeTenderWorkbook(read);
  return { read, mapping, fill, report, out };
}

describe("reader (SYNTHETIC tender)", () => {
  it("finds the item table, items, sections and totals; leaves other sheets alone", async () => {
    const read = await readTenderWorkbook(await syntheticTender());
    expect(read.tables).toHaveLength(1);
    const t = read.tables[0];
    expect(t).toMatchObject({ sheet: SHEET, headerRow: 3, columns: { itemNo: 1, description: 2, unit: 3, qty: 4, rate: 5, amount: 6 } });
    expect(t.items.map((i) => [i.itemNo, i.qty, i.section])).toEqual([
      ["1.1", 120, "EARTH WORK"], ["1.2", 45.5, "EARTH WORK"], ["2.1", 30, "CONCRETE"], ["2.2", 18.2, "CONCRETE"], ["2.3", 150, "CONCRETE"],
    ]);
    expect(t.totals.map((x) => [x.row, x.section, x.coversRows])).toEqual([[7, "EARTH WORK", [5, 6]], [12, "CONCRETE", [9, 10, 11]], [13, null, [5, 6, 9, 10, 11]]]);
    expect(read.skippedSheets).toEqual(["Abstract", "Notes"]);
  });

  it("accepts a column map for a layout the detector does not recognise", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Odd");
    ws.getRow(1).values = ["#", "Work", "UoM?", "Nos/Qty", "Our price", "Value"];
    ws.getRow(2).values = ["7", "Door shutters", "nos", 4, null, null];
    const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    expect((await readTenderWorkbook(bytes)).tables).toHaveLength(0);
    const read = await readTenderWorkbook(bytes, { columnMaps: { Odd: { headerRow: 1, columns: { itemNo: 1, description: 2, unit: 3, qty: 4, rate: 5, amount: 6 } } } });
    expect(read.tables[0].items.map((i) => i.itemNo)).toEqual(["7"]);
  });
});

describe("mapper: item number first, then exact description + unit; never fuzzy", () => {
  it("matches, lists gaps with reasons, and lists lines with no tender item", async () => {
    const read = await readTenderWorkbook(await syntheticTender());
    const m = mapLinesToTender(read, LINES);
    expect(m.matches.map((x) => [x.item.itemNo, x.line.id, x.basis])).toEqual([
      ["1.1", "L1", "item_no"], ["1.2", "L2", "description_and_unit"], ["2.1", "L3", "item_no"],
    ]);
    expect(m.gaps.map((g) => [g.item.itemNo, g.reason])).toEqual([["2.2", "unit_mismatch"], ["2.3", "no_rate"]]);
    expect(m.unmatchedLines.map((u) => u.line.id).sort()).toEqual(["L4", "L6"]);
  });

  it("an approximately similar description is NOT a match", async () => {
    const read = await readTenderWorkbook(await syntheticTender());
    const m = mapLinesToTender(read, [{ id: "X", description: "Excavation in foundations", unit: "cum", qty: 120, rate: 250, quantityState: "established" }]);
    expect(m.matches).toEqual([]);
    expect(m.unmatchedLines.map((u) => u.line.id)).toEqual(["X"]);
  });

  it("two lines for one item is ambiguous: no rate is written for it", async () => {
    const read = await readTenderWorkbook(await syntheticTender());
    const m = mapLinesToTender(read, [
      { id: "A", tenderItemNo: "1.1", description: "x", unit: "cum", qty: 120, rate: 250, quantityState: "established" },
      { id: "B", tenderItemNo: "1.1", description: "y", unit: "cum", qty: 120, rate: 260, quantityState: "established" },
    ]);
    expect(m.matches).toEqual([]);
    expect(m.gaps.find((g) => g.item.itemNo === "1.1")).toMatchObject({ reason: "ambiguous" });
    expect(m.unmatchedLines.map((u) => u.line.id).sort()).toEqual(["A", "B"]);
  });
});

describe("writer + round trip (SYNTHETIC tender)", () => {
  it("writes rates only where matched; every other cell, merge, style, sheet and the protection survive", async () => {
    const original = await syntheticTender();
    const { fill, out } = await run(original);
    expect(fill.written.map((w) => [w.itemNo, w.rate])).toEqual([["1.1", 250], ["1.2", 180], ["2.1", 6000]]);
    expect(fill.gapsWritten.map((g) => [g.itemNo, g.value])).toEqual([["2.2", null], ["2.3", null]]);

    const before = await snapshot(original);
    const after = await snapshot(out);
    const rateCells = new Set([`${SHEET}!5:5`, `${SHEET}!6:5`, `${SHEET}!9:5`]);
    for (const k of Object.keys(before)) {
      if (rateCells.has(k)) continue;
      expect(after[k], k).toEqual(before[k]);
    }
    expect(Object.keys(after).filter((k) => !(k in before))).toEqual([]);
    for (const [k, rate] of [[`${SHEET}!5:5`, 250], [`${SHEET}!6:5`, 180], [`${SHEET}!9:5`, 6000]] as const) {
      expect(JSON.parse(after[k] as string).v).toBe(rate);
    }
  });

  it("blank vs zero is a per-tender setting: gaps stay empty, or get 0", async () => {
    const blank = await run(await syntheticTender(), LINES, "blank");
    const zero = await run(await syntheticTender(), LINES, "zero");
    const cellAt = async (bytes: Uint8Array, addr: string) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes as unknown as ArrayBuffer); return wb.getWorksheet(SHEET)!.getCell(addr).value; };
    expect(await cellAt(blank.out, "E10")).toBeNull();
    expect(await cellAt(blank.out, "E11")).toBeNull();
    expect(await cellAt(zero.out, "E10")).toBe(0);
    expect(await cellAt(zero.out, "E11")).toBe(0);
    // Amounts are never written by us: the department's formulas stay.
    expect(await cellAt(zero.out, "F10")).toEqual({ formula: "D10*E10" });
  });

  it("never overwrites a rate already in the department's file", async () => {
    const { fill, out } = await run(await syntheticTender({ prefilledRate: true }));
    expect(fill.refused.map((r) => r.itemNo)).toEqual(["2.1"]);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(out as unknown as ArrayBuffer);
    expect(wb.getWorksheet(SHEET)!.getCell("E9").value).toBe(999);
  });

  it("asks the spreadsheet to recalculate on open (cached formula results are stale)", async () => {
    const { read } = await run(await syntheticTender());
    expect(read.workbook.calcProperties.fullCalcOnLoad).toBe(true);
  });
});

describe("consistency: amounts, totals, abstract and Cunstruct agree", () => {
  it("passes on the filled synthetic tender and reports section and sheet sums", async () => {
    const { report } = await run(await syntheticTender());
    expect(report.disagreements).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.sums).toEqual([
      { sheet: SHEET, section: "EARTH WORK", amount: 120 * 250 + 45.5 * 180 },
      { sheet: SHEET, section: "CONCRETE", amount: 30 * 6000 },
      { sheet: SHEET, section: null, amount: 120 * 250 + 45.5 * 180 + 30 * 6000 },
    ]);
  });

  it("catches a planted subtotal that skips an item", async () => {
    const { report } = await run(await syntheticTender({ plantWrongTotal: true }));
    expect(report.ok).toBe(false);
    expect(report.disagreements).toEqual([expect.objectContaining({ kind: "total_formula", row: 7 })]);
  });

  it("reports a quantity that differs from Cunstruct's, and never compares a pending line", async () => {
    const lines: CunstructLine[] = [
      { ...LINES[0], qty: 118 },                                   // differs from the department's 120
      { ...LINES[1], quantityState: "pending", qty: null },         // pending: rate still written, no amount compared
      LINES[2],
    ];
    const { report, fill } = await run(await syntheticTender(), lines);
    expect(fill.written.map((w) => w.itemNo)).toEqual(["1.1", "1.2", "2.1"]);
    expect(report.ok).toBe(false);
    expect(report.disagreements.map((d) => [d.kind, d.itemNo])).toEqual([["qty_differs", "1.1"], ["line_amount", "1.1"], ["not_compared", "1.2"]]);
  });

  it("flags an abstract that refers to an item row instead of a total", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await syntheticTender()) as unknown as ArrayBuffer);
    wb.getWorksheet("Abstract")!.getCell("B3").value = { formula: "'Civil'!F9" } as ExcelJS.CellValue;
    const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const { report } = await run(bytes);
    expect(report.disagreements).toEqual([expect.objectContaining({ kind: "total_formula", sheet: "Abstract", row: 3 })]);
  });
});
