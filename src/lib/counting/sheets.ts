// SHEET CLASSIFICATION — which sheets are plans (the only view whose
// occurrences are counted), which floor each plan shows, and whether two
// plans show the same layout.
//
// The view comes from the sheet's own title text. A sheet whose titles name
// both a plan and an elevation/section/detail is "mixed": its regions are not
// separated here, so nothing on it can be confirmed until a reviewer (or an
// excludedRegions entry) separates them. The floor comes from the existing
// drawingInventory.ts sheet-title rule — not a second floor parser.

import { buildDrawingInventory, runBox } from "../review/drawingInventory";
import type { CountingSheetInput, SheetSummary, ViewKind } from "./contract";

const VIEW_PATTERNS: [Exclude<ViewKind, "mixed" | "unknown">, RegExp][] = [
  ["plan", /\b(FLOOR|LEVEL|ROOF|TERRACE|STILT|BASEMENT|GROUND|TYPICAL|FURNITURE|LAYOUT|WORKING)\s+PLAN\b|\bPLAN\s+(AT|OF)\b|^\s*PLAN\s*$/i],
  ["elevation", /\bELEVATIONS?\b/i],
  ["section", /\bSECTIONS?\b|\bSECTION\s+[A-Z]-[A-Z]\b/i],
  ["detail", /\bDETAILS?\b|\bENLARGED\b/i],
  ["schedule", /\bSCHEDULES?\b/i],
];
// "TYPICAL FLOOR PLAN", "1ST TO 4TH FLOOR PLAN", "FIRST TO FOURTH FLOOR PLAN".
const TYPICAL = /\bTYPICAL\b|\b\d+(?:ST|ND|RD|TH)\s*(?:TO|-|–|&)\s*\d+(?:ST|ND|RD|TH)\b|\b[A-Z]+\s+(?:TO|&)\s+[A-Z]+\s+FLOORS?\b/i;

export function sheetKeyOf(s: Pick<CountingSheetInput, "documentId" | "page">): string {
  return `${s.documentId}#p${s.page}`;
}

/** View of one sheet from its title-like runs. A schedule title on a plan
 *  sheet does not make it mixed (schedules sit on plans all the time, and
 *  their tags are excluded row by row); any other second view does. */
export function classifyView(texts: string[]): { view: ViewKind; titles: string[] } {
  const hits = new Map<ViewKind, string[]>();
  for (const t of texts) {
    for (const [view, re] of VIEW_PATTERNS) {
      if (re.test(t)) { (hits.get(view) ?? hits.set(view, []).get(view)!).push(t.trim()); break; }
    }
  }
  const drawn = [...hits.keys()].filter((v) => v !== "schedule");
  const titles = [...hits.values()].flat();
  if (drawn.length === 0) return { view: hits.has("schedule") ? "schedule" : "unknown", titles };
  if (drawn.length === 1) return { view: drawn[0], titles };
  return { view: "mixed", titles };
}

export function summarizeSheet(sheet: CountingSheetInput): SheetSummary {
  const sheetKey = sheetKeyOf(sheet);
  const texts = sheet.runs.map((r) => r.text);
  const { view, titles } = classifyView(texts);
  const inventory = buildDrawingInventory([{
    documentId: sheet.documentId, page: sheet.page, pageSize: sheet.pageSize, textLayer: sheet.textLayer, runs: sheet.runs,
  }]);
  const floor = inventory.pages[0].floor;
  const notes: string[] = [];
  if (view === "mixed") notes.push(`Titles name more than one view (${titles.join("; ")}); regions are not separated.`);
  return {
    sheetKey,
    documentId: sheet.documentId,
    page: sheet.page,
    sheetNumber: sheet.sheetNumber?.trim() || null,
    view: sheet.textLayer === "absent" ? "unknown" : view,
    floor: floor.status === "identified" ? floor.floor : null,
    floorStatus: floor.status,
    typical: titles.some((t) => TYPICAL.test(t)) || texts.some((t) => /\bTYPICAL\b.*\bPLAN\b/i.test(t)),
    textLayer: sheet.textLayer,
    textSource: sheet.textSource,
    layoutFingerprint: "",
    notes,
  };
}

/** FNV-1a, 32-bit, as 8 hex chars. Deterministic and dependency-free; a
 *  digest for spotting identical inputs, not a security hash. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Stable JSON: object keys sorted, so key order never changes a digest. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Order-independent layout digest: every tag text and symbol centre, as a
 *  fraction of the page (to 1%), sorted. Two sheets drawn from the same plan
 *  at the same position match; a moved or extra opening does not. */
export function layoutFingerprint(
  sheet: CountingSheetInput,
  tagRunIndexes: number[],
  symbolBoxes: [number, number, number, number][],
): string {
  const { width, height } = sheet.pageSize;
  const pct = (x: number, size: number) => Math.round((x / size) * 100);
  const parts = [
    ...tagRunIndexes.map((i) => {
      const b = runBox(sheet.runs[i]);
      return `t:${sheet.runs[i].text.trim().toUpperCase()}@${pct((b[0] + b[2]) / 2, width)},${pct((b[1] + b[3]) / 2, height)}`;
    }),
    ...symbolBoxes.map((b) => `s@${pct((b[0] + b[2]) / 2, width)},${pct((b[1] + b[3]) / 2, height)}`),
  ].sort();
  return parts.length ? fnv1a(parts.join("|")) : "empty";
}
