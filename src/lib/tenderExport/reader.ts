// Reader: load a tender workbook and locate its item table(s) without changing
// anything. Header detection looks for item-no / description / unit / quantity /
// rate (and optionally amount) headings in the first rows of each sheet; a
// column map can be given instead for a layout the detector does not recognise.
import ExcelJS from "exceljs";
import { isEmpty, literalNumberOf, normItemNo, textOf } from "./cells";
import type { ColumnMap, ReadTender, TenderItem, TenderTable, TotalRow } from "./types";

const HEADER_PATTERNS: Record<keyof ColumnMap, RegExp> = {
  itemNo: /^(item\s*(no|number|#)?|s\.?\s*no|sl\.?\s*no|sr\.?\s*no|code)\.?$/i,
  description: /^(description|particulars|description of (the )?(work|item)s?|item description)/i,
  unit: /^(unit|units|uom)$/i,
  qty: /^(qty|quantity|quantities|qty\.)$/i,
  rate: /^(rate|rates|rate \(.*\)|rate in (rs|₹|inr).*|unit rate)/i,
  amount: /^(amount|amount \(.*\)|amount in (rs|₹|inr).*|total amount)/i,
};
const TOTAL_LABEL = /\b(sub-?\s*total|total|carried (over|to abstract)|c\/o|b\/f|brought forward)\b/i;
const HEADER_SCAN_ROWS = 30;

export interface ReadOptions {
  /** Per-sheet column map, used instead of header detection (header row = the given row). */
  columnMaps?: Record<string, { headerRow: number; columns: ColumnMap }>;
  /** Only look at these sheets (all others are kept untouched and listed as skipped). */
  sheets?: string[];
}

function detectHeader(ws: ExcelJS.Worksheet): { headerRow: number; columns: ColumnMap } | null {
  const last = Math.min(ws.rowCount, HEADER_SCAN_ROWS);
  for (let r = 1; r <= last; r++) {
    const found: Partial<ColumnMap> = {};
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      const t = textOf(cell);
      for (const [key, re] of Object.entries(HEADER_PATTERNS) as [keyof ColumnMap, RegExp][]) {
        if (found[key] == null && re.test(t)) { found[key] = col; break; }
      }
    });
    if (found.itemNo && found.description && found.unit && found.qty && found.rate) return { headerRow: r, columns: found as ColumnMap };
  }
  return null;
}

function readTable(ws: ExcelJS.Worksheet, headerRow: number, columns: ColumnMap): TenderTable {
  const items: TenderItem[] = [];
  const totals: TotalRow[] = [];
  let section: string | null = null;
  let sectionRows: number[] = [];
  const sheetRows: number[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const itemNo = textOf(row.getCell(columns.itemNo));
    const description = textOf(row.getCell(columns.description));
    const unit = textOf(row.getCell(columns.unit));
    const qtyCell = row.getCell(columns.qty);
    const label = `${itemNo} ${description}`.trim();
    if (!label && isEmpty(qtyCell)) continue;
    if (TOTAL_LABEL.test(label) && !unit) {
      const isSheetTotal = !section || /grand|sheet|abstract|carried/i.test(label);
      totals.push({ sheet: ws.name, row: r, label, section: isSheetTotal ? null : section, coversRows: isSheetTotal ? [...sheetRows] : [...sectionRows] });
      if (!isSheetTotal) sectionRows = [];
      continue;
    }
    if (itemNo && description && unit) {
      items.push({ sheet: ws.name, row: r, itemNo: normItemNo(itemNo), description, unit, qty: literalNumberOf(qtyCell), section });
      sectionRows.push(r);
      sheetRows.push(r);
      continue;
    }
    // A row with a label but no unit is a section heading.
    if (description || itemNo) {
      section = description || itemNo;
      sectionRows = [];
    }
  }
  return { sheet: ws.name, headerRow, columns, items, totals };
}

/** Load a tender workbook (.xlsx bytes) and find its item tables. Nothing is changed. */
export async function readTenderWorkbook(data: ArrayBuffer | Uint8Array, options: ReadOptions = {}): Promise<ReadTender> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as ArrayBuffer);
  const tables: TenderTable[] = [];
  const skippedSheets: string[] = [];
  workbook.eachSheet((ws) => {
    if (options.sheets && !options.sheets.includes(ws.name)) { skippedSheets.push(ws.name); return; }
    const given = options.columnMaps?.[ws.name];
    const header = given ?? detectHeader(ws);
    if (!header) { skippedSheets.push(ws.name); return; }
    const table = readTable(ws, header.headerRow, header.columns);
    if (table.items.length) tables.push(table);
    else skippedSheets.push(ws.name);
  });
  return { workbook, tables, skippedSheets };
}

/** Serialise the (filled) workbook back to .xlsx bytes. */
export async function writeTenderWorkbook(read: ReadTender): Promise<Uint8Array> {
  const buf = await read.workbook.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
