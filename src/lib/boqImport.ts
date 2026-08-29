// IMPORT EXISTING BOQ (structured lines).
//
// Parses a BOQ the user already has (pasted from Excel/Google Sheets, or a CSV file,
// including a Cunstruct CSV export) into structured lines. The user's BOQ is the
// SOURCE OF TRUTH: quantities, units, rates and amounts are taken as given and never
// re-interpreted. Nothing is generated or matched — the lines are stored verbatim.
//
// Delimiter is auto-detected (tab for spreadsheet paste, else comma with quote
// handling). Columns are mapped by fuzzy header names; a row with a description but no
// quantity is treated as a sub-head/section header for the rows beneath it.

export interface ImportedBoqLine {
  section?: string;
  code?: string;
  description: string;
  unit?: string;
  qty: number;
  /** Rate as given (or derived from amount ÷ qty when only an amount was supplied). */
  rate?: number;
  /** Amount as given, kept for reference. */
  amount?: number;
}

export interface BoqImportResult {
  lines: ImportedBoqLine[];
  warnings: string[];
}

/** Split one delimited line, honouring double-quoted fields (CSV). Tab-delimited
 *  spreadsheet paste has no quoting, which this also handles. */
function splitRow(line: string, delim: string): string[] {
  if (delim === "\t") return line.split("\t");
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Parse a number from a cell: strips currency, thousands separators and stray
 *  symbols. Empty / "-" / non-numeric → null (never a fabricated 0). */
export function parseNum(cell: string | undefined): number | null {
  if (cell == null) return null;
  const s = String(cell).replace(/[₹$,\s]/g, "").replace(/[^0-9.-]/g, "").trim();
  if (!s || s === "-" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

type ColMap = Partial<Record<"section" | "code" | "description" | "unit" | "qty" | "rate" | "amount", number>>;

// Header → column role. Order matters: "your rate" beats "rate", "specification"/
// "description" beat "item" for the description role.
function mapHeader(cells: string[]): ColMap | null {
  const h = cells.map((c) => c.toLowerCase().trim());
  const find = (re: RegExp, avoid?: RegExp) => {
    const i = h.findIndex((x) => re.test(x) && !(avoid && avoid.test(x)));
    return i >= 0 ? i : undefined;
  };
  const map: ColMap = {};
  map.section = find(/sub[-\s]?head|section|chapter|category|\bhead\b|trade/);
  map.code = find(/\bcode\b|dsr/);
  // description: prefer specification/description/particulars over a bare "item" (often a serial)
  map.description = find(/description|specification|particular|nomenclature|work\s*item/) ?? find(/^item$|item\s*name|scope/);
  map.unit = find(/\bunit\b|\buom\b|\bu\/m\b/);
  map.qty = find(/quantity|\bqty\b|\bnos?\b/);
  map.rate = find(/your\s*rate/) ?? find(/\brate\b|unit\s*price|unit\s*cost|\bprice\b/);
  map.amount = find(/amount|line\s*total|\btotal\b/);
  // A row is a header only if it actually named a description/qty/rate column.
  if (map.description == null && map.qty == null && map.rate == null && map.amount == null) return null;
  return map;
}

// When there's no recognisable header, assume the common Cunstruct/tender order and
// map positionally by width.
function positionalMap(width: number): ColMap {
  if (width >= 9) return { section: 0, code: 2, description: 3, unit: 4, qty: 5, rate: 7, amount: 8 }; // Cunstruct CSV export
  if (width >= 6) return { code: 0, description: 1, unit: 2, qty: 3, rate: 4, amount: 5 };
  if (width === 5) return { description: 0, unit: 1, qty: 2, rate: 3, amount: 4 };
  if (width === 4) return { description: 0, unit: 1, qty: 2, rate: 3 };
  if (width === 3) return { description: 0, qty: 1, rate: 2 };
  return { description: 0, qty: 1 };
}

/**
 * Parse a pasted/CSV BOQ into structured lines. The user's numbers are preserved
 * exactly; where only an amount is given, the rate is derived as amount ÷ qty so the
 * amount is reproduced (a warning notes it). Rows with a description but no quantity
 * become the running sub-head for the lines beneath them.
 */
export function parseBoqImport(text: string): BoqImportResult {
  const warnings: string[] = [];
  const rawLines = (text ?? "").replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (!rawLines.length) return { lines: [], warnings: ["Nothing to import — paste your BOQ rows or upload a CSV."] };

  const delim = rawLines[0].includes("\t") ? "\t" : ",";
  const rows = rawLines.map((l) => splitRow(l, delim).map((c) => c.trim().replace(/^"|"$/g, "")));

  // Find a header row within the first few lines; else fall back to positional.
  let map: ColMap | null = null;
  let start = 0;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const m = mapHeader(rows[i]);
    if (m) { map = m; start = i + 1; break; }
  }
  if (!map) { map = positionalMap(rows[0].length); start = 0; warnings.push("No header row detected — columns were mapped by position; check the preview."); }

  const at = (row: string[], idx?: number) => (idx == null ? undefined : row[idx]);
  const lines: ImportedBoqLine[] = [];
  let section: string | undefined;

  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    const desc = (at(row, map.description) ?? "").trim();
    const qty = parseNum(at(row, map.qty));
    const rate = parseNum(at(row, map.rate));
    const amount = parseNum(at(row, map.amount));
    const sectionCell = (at(row, map.section) ?? "").trim();
    if (sectionCell) section = sectionCell;

    if (!desc && !qty) continue;                        // blank / separator
    // A description with no quantity and no money is a sub-head for following rows.
    if (desc && qty == null && rate == null && amount == null) { section = desc; continue; }
    if (!desc) { warnings.push(`Row ${i + 1}: has a quantity but no description — skipped.`); continue; }
    if (qty == null) { warnings.push(`Row ${i + 1}: "${desc}" has no quantity — skipped.`); continue; }

    let effRate = rate ?? undefined;
    if (effRate == null && amount != null && qty !== 0) {
      effRate = amount / qty;                            // preserve the amount exactly
    }
    lines.push({
      section: section || undefined,
      code: (at(row, map.code) ?? "").trim() || undefined,
      description: desc,
      unit: (at(row, map.unit) ?? "").trim() || undefined,
      qty,
      rate: effRate,
      amount: amount ?? undefined,
    });
  }

  if (!lines.length && !warnings.length) warnings.push("No BOQ lines were recognised — check the columns.");
  return { lines, warnings };
}
