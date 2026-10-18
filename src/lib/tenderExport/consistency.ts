// Consistency check: after filling, the department's own arithmetic must agree
// with the rates written. Spreadsheet formulas are NOT evaluated (exceljs keeps
// stale cached results), so each formula is checked structurally instead:
// - an amount cell's formula must be this row's quantity × rate;
// - a total's formula must cover exactly its section's (or sheet's) item rows;
// - an abstract sheet's reference into an item sheet must point at a total row.
// Literal numbers are compared with the values computed from the filled rates.
// Each matched line is also compared with Cunstruct's own quantity and amount.
import type ExcelJS from "exceljs";
import { colLetter, formulaOf, literalNumberOf } from "./cells";
import type { ConsistencyReport, Disagreement, Mapping, ReadTender, TenderTable } from "./types";

const RUPEE_TOLERANCE = 0.5;

const clean = (f: string) => f.replace(/\$/g, "").replace(/\s+/g, "").toUpperCase();
/** "ROUND(E5*F5,2)" → "E5*F5" (one ROUND/ROUNDUP/ROUNDDOWN wrapper is allowed). */
const unwrapRound = (f: string) => f.replace(/^ROUND(UP|DOWN)?\((.*),-?\d+\)$/, "$2");

function referencedRows(formula: string, col: string): Set<number> | null {
  const f = clean(formula);
  const m = /^SUM\((.*)\)$/.exec(f);
  const body = m ? m[1] : null;
  const parts = body ? body.split(",") : f.split("+");
  const rows = new Set<number>();
  for (const p of parts) {
    const range = new RegExp(`^${col}(\\d+):${col}(\\d+)$`).exec(p);
    const single = new RegExp(`^${col}(\\d+)$`).exec(p);
    if (range) for (let r = Number(range[1]); r <= Number(range[2]); r++) rows.add(r);
    else if (single) rows.add(Number(single[1]));
    else return null;
  }
  return rows;
}

function checkTable(ws: ExcelJS.Worksheet, t: TenderTable, out: Disagreement[], sums: ConsistencyReport["sums"]) {
  const amountByRow = new Map<number, number>();
  const q = colLetter(t.columns.qty);
  const rCol = colLetter(t.columns.rate);
  for (const item of t.items) {
    const rate = literalNumberOf(ws.getRow(item.row).getCell(t.columns.rate));
    const amount = rate != null && item.qty != null ? item.qty * rate : 0;
    amountByRow.set(item.row, amount);
    if (!t.columns.amount) continue;
    const cell = ws.getRow(item.row).getCell(t.columns.amount);
    const f = formulaOf(cell);
    if (f != null) {
      const g = unwrapRound(clean(f));
      const ok = g === `${q}${item.row}*${rCol}${item.row}` || g === `${rCol}${item.row}*${q}${item.row}`;
      if (!ok) out.push({ kind: "amount_formula", sheet: t.sheet, row: item.row, itemNo: item.itemNo, detail: `amount formula =${f} is not this row's quantity × rate (${q}${item.row}*${rCol}${item.row})` });
      continue;
    }
    const lit = literalNumberOf(cell);
    if (lit != null && Math.abs(lit - amount) > RUPEE_TOLERANCE) {
      out.push({ kind: "amount_value", sheet: t.sheet, row: item.row, itemNo: item.itemNo, detail: `amount ${lit} differs from quantity × rate = ${amount}` });
    }
  }
  const itemRows = new Set(t.items.map((i) => i.row));
  const totalRows = new Set(t.totals.map((x) => x.row));
  for (const total of t.totals) {
    const expected = total.coversRows.reduce((s, r) => s + (amountByRow.get(r) ?? 0), 0);
    sums.push({ sheet: t.sheet, section: total.section, amount: expected });
    if (!t.columns.amount) continue;
    const cell = ws.getRow(total.row).getCell(t.columns.amount);
    const f = formulaOf(cell);
    if (f != null) {
      const rows = referencedRows(f, colLetter(t.columns.amount));
      const covered = rows ? [...rows].filter((r) => itemRows.has(r)).sort((a, b) => a - b) : null;
      const want = [...total.coversRows].sort((a, b) => a - b);
      const doubleCount = rows ? [...rows].some((r) => totalRows.has(r)) : false;
      // A sheet total may instead add up exactly the section totals that together cover its items.
      const viaSections = !!rows && total.section === null && [...rows].every((r) => totalRows.has(r)) && (() => {
        const parts = t.totals.filter((x) => rows.has(x.row) && x.section !== null);
        const union = parts.flatMap((x) => x.coversRows).sort((a, b) => a - b);
        return parts.length === rows.size && JSON.stringify(union) === JSON.stringify(want);
      })();
      if (!viaSections && (!rows || doubleCount || JSON.stringify(covered) !== JSON.stringify(want))) {
        out.push({ kind: "total_formula", sheet: t.sheet, row: total.row, detail: `"${total.label}" =${f} does not cover exactly item rows ${want.join(", ") || "(none)"}${doubleCount ? " (it includes another total)" : ""}` });
      }
      continue;
    }
    const lit = literalNumberOf(cell);
    if (lit != null && Math.abs(lit - expected) > RUPEE_TOLERANCE) {
      out.push({ kind: "total_value", sheet: t.sheet, row: total.row, detail: `"${total.label}" ${lit} differs from the sum of its items = ${expected}` });
    }
  }
}

/** Abstract sheets: every reference into an item sheet's amount column must point at a total row. */
function checkAbstracts(read: ReadTender, out: Disagreement[]) {
  const bySheet = new Map(read.tables.map((t) => [t.sheet, t]));
  for (const name of read.skippedSheets) {
    const ws = read.workbook.getWorksheet(name);
    ws?.eachRow((row, r) => row.eachCell((cell) => {
      const f = formulaOf(cell);
      if (!f) return;
      for (const m of f.matchAll(/(?:'([^']+)'|([A-Za-z0-9_]+))!\$?([A-Z]+)\$?(\d+)/g)) {
        const t = bySheet.get(m[1] ?? m[2]);
        if (!t || !t.columns.amount || m[3] !== colLetter(t.columns.amount)) continue;
        const target = Number(m[4]);
        if (!t.totals.some((x) => x.row === target)) {
          out.push({ kind: "total_formula", sheet: name, row: r, detail: `abstract refers to ${t.sheet}!${m[3]}${target}, which is not a total row` });
        }
      }
    }));
  }
}

export function checkTenderConsistency(read: ReadTender, mapping: Mapping): ConsistencyReport {
  const out: Disagreement[] = [];
  const sums: ConsistencyReport["sums"] = [];
  for (const t of read.tables) checkTable(read.workbook.getWorksheet(t.sheet)!, t, out, sums);
  checkAbstracts(read, out);
  for (const m of mapping.matches) {
    const { item, line } = m;
    if (line.quantityState === "pending" || line.quantityState === "unavailable" || line.qty == null || item.qty == null) {
      out.push({ kind: "not_compared", sheet: item.sheet, row: item.row, itemNo: item.itemNo, detail: `line ${line.id}: quantity ${line.quantityState === "pending" ? "pending" : "not available"}; no amount compared` });
      continue;
    }
    if (Math.abs(line.qty - item.qty) > 1e-9 * Math.max(1, Math.abs(item.qty))) {
      out.push({ kind: "qty_differs", sheet: item.sheet, row: item.row, itemNo: item.itemNo, detail: `department quantity ${item.qty} ${item.unit}; Cunstruct quantity ${line.qty} (line ${line.id})` });
    }
    const dept = item.qty * line.rate!;
    const ours = line.qty * line.rate!;
    if (Math.abs(dept - ours) > RUPEE_TOLERANCE) {
      out.push({ kind: "line_amount", sheet: item.sheet, row: item.row, itemNo: item.itemNo, detail: `department amount ${dept} vs Cunstruct line amount ${ours} (line ${line.id})` });
    }
  }
  return { ok: out.every((d) => d.kind === "not_compared"), disagreements: out, sums };
}
