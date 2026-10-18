// Writer: fill the department's rate column — and nothing else. Description,
// unit, quantity, amounts, totals, order, styles and every other sheet are left
// as read. A rate cell that already holds a value or a formula is never
// overwritten; it is reported instead.
import { isEmpty } from "./cells";
import type { FillOptions, FillResult, Mapping, ReadTender, TenderItem } from "./types";

export function fillTenderRates(read: ReadTender, mapping: Mapping, options: FillOptions = {}): FillResult {
  const gapMode = options.gapMode ?? "blank";
  const result: FillResult = { written: [], gapsWritten: [], refused: [] };
  const rateCol = (item: TenderItem) => read.tables.find((t) => t.sheet === item.sheet)!.columns.rate;

  for (const m of mapping.matches) {
    const cell = read.workbook.getWorksheet(m.item.sheet)!.getRow(m.item.row).getCell(rateCol(m.item));
    if (!isEmpty(cell)) {
      result.refused.push({ sheet: m.item.sheet, row: m.item.row, itemNo: m.item.itemNo, detail: "rate cell is not empty in the department's file; left unchanged" });
      continue;
    }
    cell.value = m.line.rate!;
    result.written.push({ sheet: m.item.sheet, row: m.item.row, itemNo: m.item.itemNo, rate: m.line.rate! });
  }
  for (const g of mapping.gaps) {
    const cell = read.workbook.getWorksheet(g.item.sheet)!.getRow(g.item.row).getCell(rateCol(g.item));
    if (!isEmpty(cell)) {
      result.refused.push({ sheet: g.item.sheet, row: g.item.row, itemNo: g.item.itemNo, detail: "gap item's rate cell is not empty in the department's file; left unchanged" });
      continue;
    }
    if (gapMode === "zero") cell.value = 0;
    result.gapsWritten.push({ sheet: g.item.sheet, row: g.item.row, itemNo: g.item.itemNo, value: gapMode === "zero" ? 0 : null });
  }
  // Formula results cached in the file were computed without these rates:
  // ask the spreadsheet to recalculate when it is opened.
  read.workbook.calcProperties = { ...read.workbook.calcProperties, fullCalcOnLoad: true };
  return result;
}
