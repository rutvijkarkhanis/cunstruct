// ENGINEERING PREVIEW — workspace model (plan v1.2, I2 and I3).
//
// Pure, dependency-light logic for the mock workspace: the synthetic fixture,
// spreadsheet-style cell movement, edit validation and paste-a-range. No I/O,
// no Supabase client. Every record here is SYNTHETIC; nothing is measured from
// a real drawing and nothing is a benchmark result.
import { parseNumericInput } from "@/design/money";
import { pricedAmount, quantityState, type QuantityState } from "@/lib/quantity";

// ── Fixture ──────────────────────────────────────────────────────────────────

export type RegionStatus = "linked" | "uncertain";

/** A rectangle on the synthetic drawing (viewBox units, 0 0 400 260). */
export interface DrawingRegion {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** "uncertain": the link is a guess and must read as unverified. */
  status: RegionStatus;
}

export interface WorkspaceLine {
  id: string;
  description: string;
  unit: string;
  /** null = no quantity (pending); never shown as 0. */
  qty: number | null;
  /** "MEASURED" once a number is entered (a typed 0 is a confirmed zero); "PENDING" otherwise. */
  quantityStatus: "MEASURED" | "PENDING";
  /** null = no rate. */
  rate: number | null;
  /** null = no drawing region at all. */
  regionId: string | null;
  /** Columns changed in this demo session. */
  edited: EditableColumn[];
}

export const DRAWING_VIEWBOX = { width: 400, height: 260 };

export const REGIONS: DrawingRegion[] = [
  { id: "R-TRENCH", label: "Foundation trench, grid B3–D5", x: 40, y: 40, w: 120, h: 52, status: "linked" },
  { id: "R-FOOTING", label: "Footing detail F1", x: 196, y: 40, w: 72, h: 60, status: "linked" },
  { id: "R-WALL", label: "Wall layout, ground floor", x: 40, y: 140, w: 228, h: 44, status: "linked" },
  { id: "R-BARS", label: "Bar schedule S-203 (link unconfirmed)", x: 300, y: 40, w: 64, h: 144, status: "uncertain" },
];

export const INITIAL_WORKSPACE_LINES: WorkspaceLine[] = [
  { id: "L-01", description: "Excavation in foundation trenches", unit: "m³", qty: 24, quantityStatus: "MEASURED", rate: 420, regionId: "R-TRENCH", edited: [] },
  { id: "L-02", description: "PCC below footings", unit: "m³", qty: 6.5, quantityStatus: "MEASURED", rate: 6200, regionId: "R-FOOTING", edited: [] },
  { id: "L-03", description: "Reinforcement steel", unit: "kg", qty: null, quantityStatus: "PENDING", rate: 68, regionId: "R-BARS", edited: [] },
  { id: "L-04", description: "Additional formwork quantity", unit: "m²", qty: 0, quantityStatus: "MEASURED", rate: 720, regionId: "R-FOOTING", edited: [] },
  { id: "L-05", description: "Brickwork above plinth", unit: "m³", qty: 18.2, quantityStatus: "MEASURED", rate: 7400, regionId: "R-WALL", edited: [] },
  { id: "L-06", description: "Cement plaster 12 mm, internal walls", unit: "m²", qty: 310.5, quantityStatus: "MEASURED", rate: null, regionId: null, edited: [] },
];

// ── Derived values (the shared quantity rule) ───────────────────────────────

const asQty = (l: WorkspaceLine) => ({ qty: l.qty, quantity_status: l.quantityStatus });

export const lineQuantityState = (l: WorkspaceLine): QuantityState => quantityState(asQty(l));

/** Whole rupees, or null when no amount can be stated (pending quantity or no rate). */
export const lineAmount = (l: WorkspaceLine): number | null => pricedAmount({ ...asQty(l), custom_rate: l.rate });

export type RegionLink = "linked" | "unverified" | "none";

export function regionLink(l: WorkspaceLine, regions: DrawingRegion[] = REGIONS): RegionLink {
  const r = l.regionId == null ? undefined : regions.find((x) => x.id === l.regionId);
  if (!r) return "none";
  return r.status === "linked" ? "linked" : "unverified";
}

export const linesForRegion = (regionId: string, lines: WorkspaceLine[]) => lines.filter((l) => l.regionId === regionId).map((l) => l.id);

// ── Grid geometry and movement ───────────────────────────────────────────────

export const COLUMNS = [
  { id: "item", label: "Item", editable: false },
  { id: "qty", label: "Qty", editable: true },
  { id: "rate", label: "Rate (₹)", editable: true },
  { id: "amount", label: "Amount", editable: false },
  { id: "state", label: "Quantity state", editable: false },
  { id: "region", label: "Drawing region", editable: false },
] as const;

export type ColumnId = (typeof COLUMNS)[number]["id"];
export type EditableColumn = "qty" | "rate";
export const isEditable = (col: number): boolean => COLUMNS[col]?.editable === true;
export const columnId = (col: number): ColumnId => COLUMNS[col].id;

export interface Cell {
  row: number;
  col: number;
}

export type MoveKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Tab" | "ShiftTab" | "Enter" | "ShiftEnter";

/** Excel-like movement. Arrows stop at the edges; Tab/Shift+Tab move along a
 *  row and wrap to the next/previous row; Enter/Shift+Enter move down/up.
 *  Returns null when Tab/Shift+Tab would leave the grid (focus moves on). */
export function moveCell(at: Cell, key: MoveKey, rows: number, cols: number = COLUMNS.length): Cell | null {
  const clamp = (n: number, max: number) => Math.max(0, Math.min(max - 1, n));
  switch (key) {
    case "ArrowUp":
    case "ShiftEnter":
      return { row: clamp(at.row - 1, rows), col: at.col };
    case "ArrowDown":
    case "Enter":
      return { row: clamp(at.row + 1, rows), col: at.col };
    case "ArrowLeft":
      return { row: at.row, col: clamp(at.col - 1, cols) };
    case "ArrowRight":
      return { row: at.row, col: clamp(at.col + 1, cols) };
    case "Tab": {
      if (at.col < cols - 1) return { row: at.row, col: at.col + 1 };
      return at.row < rows - 1 ? { row: at.row + 1, col: 0 } : null;
    }
    case "ShiftTab": {
      if (at.col > 0) return { row: at.row, col: at.col - 1 };
      return at.row > 0 ? { row: at.row - 1, col: cols - 1 } : null;
    }
  }
}

// ── Editing ──────────────────────────────────────────────────────────────────

export type EditResult = { ok: true; line: WorkspaceLine } | { ok: false; error: string };

/** Validate and apply one cell's text. An empty quantity makes the line
 *  pending (never 0); an empty rate removes the rate. Numbers go through the
 *  D1 parser, so "4,5" and junk are refused rather than guessed. */
export function applyCellText(line: WorkspaceLine, col: EditableColumn, raw: string): EditResult {
  const text = raw.trim();
  const mark = (l: WorkspaceLine): WorkspaceLine => ({ ...l, edited: l.edited.includes(col) ? l.edited : [...l.edited, col] });
  if (text === "") {
    return col === "qty"
      ? { ok: true, line: mark({ ...line, qty: null, quantityStatus: "PENDING" }) }
      : { ok: true, line: mark({ ...line, rate: null }) };
  }
  const n = parseNumericInput(text);
  const what = col === "qty" ? "Quantity" : "Rate";
  if (n == null) return { ok: false, error: `${what} "${raw}" is not a number.` };
  if (n < 0) return { ok: false, error: `${what} "${raw}" must be zero or more.` };
  return col === "qty"
    ? { ok: true, line: mark({ ...line, qty: n, quantityStatus: "MEASURED" }) }
    : { ok: true, line: mark({ ...line, rate: n }) };
}

/** Split clipboard text into a block of cells (rows by newline, cells by tab). */
export function parseClipboard(text: string): string[][] {
  const rows = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  return rows.map((r) => r.split("\t"));
}

export type PasteResult =
  | { ok: true; lines: WorkspaceLine[]; rows: number; cols: number }
  | { ok: false; errors: string[] };

/** Paste a block starting at `at`. All or nothing: if any target is outside
 *  the grid, read-only, or not a valid number, nothing is applied and every
 *  problem is listed. */
export function pasteRange(lines: WorkspaceLine[], at: Cell, text: string): PasteResult {
  const block = parseClipboard(text);
  const errors: string[] = [];
  const next = lines.map((l) => ({ ...l, edited: [...l.edited] }));
  block.forEach((cells, r) => {
    cells.forEach((value, c) => {
      const row = at.row + r;
      const col = at.col + c;
      const where = `row ${r + 1}, cell ${c + 1}`;
      if (row >= lines.length || col >= COLUMNS.length) {
        errors.push(`${where} falls outside the grid.`);
        return;
      }
      if (!isEditable(col)) {
        errors.push(`${where} lands on "${COLUMNS[col].label}", which cannot be edited.`);
        return;
      }
      const res = applyCellText(next[row], columnId(col) as EditableColumn, value);
      if ("error" in res) errors.push(`${where}: ${res.error}`);
      else next[row] = res.line;
    });
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, lines: next, rows: block.length, cols: Math.max(...block.map((b) => b.length)) };
}

// ── Sign-off ledger ──────────────────────────────────────────────────────────

export function ledgerSummary(lines: WorkspaceLine[]): string {
  const pending = lines.filter((l) => lineQuantityState(l) === "pending").length;
  const noRate = lines.filter((l) => l.rate == null).length;
  const noRegion = lines.filter((l) => regionLink(l) === "none").length;
  const unverified = lines.filter((l) => regionLink(l) === "unverified").length;
  const edited = lines.filter((l) => l.edited.length > 0).length;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  return [
    plural(lines.length, "line"),
    `${pending} pending`,
    `${noRate} without a rate`,
    `${noRegion} without a drawing region`,
    `${unverified} with an unverified region`,
    `${edited} edited (demo)`,
    "Not signed off — demo only, no reference set",
  ].join(" · ");
}
