// INPUT NORMALISATION for the counting engine: adapters from existing
// extractors, coordinate/unit conversion into canonical page space, and
// validation that drops malformed input with a recorded reason instead of
// guessing at it.
//
// Canonical space is evidenceCoords.ts's: top-left origin, y down, scale 1
// (PDF points for a PDF page). Sources that measure differently:
//   - DXF / CAD: millimetres (or inches), y up from the sheet's bottom edge;
//   - OCR (drawing_ocr.py, PR #230's OCR fallback): pixels at a stated DPI,
//     already y down.
// toCanonicalSheet() converts one of those into points, y down, once, so
// every later stage reasons in one space.

import type { PageGeometryExtraction } from "../review/pdfGeometry";
import type { DrawingTextRun } from "../review/drawingInventory";
import type { DrawingGeometry } from "../review/drawingGeometry";
import { boundingBoxOfPoints } from "../review/drawingGeometry";
import type { AnalysisV1 } from "../review/analysisSchemaV1";
import { isCountableUnit } from "../review/typeGrouping";
import type { Bbox, CountingInput, CountingSheetInput, RejectedInput, ScheduleEntryInput, TextSource } from "./contract";
import { canonicalMark, categoryOfDescription, categoryOfMark } from "./categories";

// ── Adapters ────────────────────────────────────────────────────────────────

/** A sheet from pdfGeometry.extractPageGeometry() output (already canonical). */
export function sheetFromPdfExtraction(
  documentId: string,
  extraction: PageGeometryExtraction,
  extra: Partial<Pick<CountingSheetInput, "documentName" | "documentSha256" | "sheetNumber" | "unitsPerMm" | "symbols" | "excludedRegions">> = {},
): CountingSheetInput {
  const runs: DrawingTextRun[] = extraction.textRuns
    .filter((r) => r.text.trim())
    .map((r) => ({ text: r.text, origin: [r.x, r.y], direction: r.direction ?? [1, 0], width: r.width, height: r.height }));
  return {
    documentId,
    page: extraction.page,
    pageSize: extraction.pageSize,
    textLayer: runs.length ? "available" : "absent",
    textSource: "pdf_text",
    runs,
    shapes: extraction.shapes,
    ...extra,
  };
}

const SCHEDULE_KEY_PREFIXES = /^(SCHED|CHECK):/;

/**
 * Schedule entries from a cunstruct.analysis.v1 payload — PR #230's schedule
 * reader emits one item per schedule row keyed by its tag ("D1"). Items whose
 * key is not a mark (SCHED:…, CHECK:…, room areas) are not schedule entries
 * of a countable type and are skipped. A schedule quantity is kept only when
 * its unit is a count; an area per opening ("m2") is never a count.
 */
export function scheduleFromAnalysis(analysis: AnalysisV1): ScheduleEntryInput[] {
  const out: ScheduleEntryInput[] = [];
  analysis.items.forEach((item, i) => {
    if (SCHEDULE_KEY_PREFIXES.test(item.key)) return;
    const mark = canonicalMark(item.key);
    if (!mark) return;
    const counted = isCountableUnit(item.unit) && item.quantity != null && item.aiStatus !== "PENDING";
    out.push({
      id: `schedule:${i}:${mark}`,
      mark,
      category: categoryOfMark(mark) ?? categoryOfDescription(item.item) ?? undefined,
      description: item.description ?? item.item,
      dimension: item.dimension,
      scheduledQuantity: counted ? item.quantity : null,
      unit: counted ? item.unit : undefined,
      source: item.source,
    });
  });
  return out;
}

// ── Coordinate conversion ───────────────────────────────────────────────────

export interface SourceSpace {
  /** Units of every coordinate in the source sheet. */
  units: "pt" | "mm" | "in" | "px";
  /** Required for "px": the raster's resolution. */
  dpi?: number;
  /** "up" for CAD/DXF (origin bottom-left), "down" for PDF/OCR. */
  yAxis: "up" | "down";
}

const MM_PER_IN = 25.4;
const PT_PER_IN = 72;

/** Points per source unit. Throws on a "px" space with no positive DPI —
 *  a conversion with an unknown factor is not attempted. */
export function pointsPerUnit(space: SourceSpace): number {
  switch (space.units) {
    case "pt": return 1;
    case "in": return PT_PER_IN;
    case "mm": return PT_PER_IN / MM_PER_IN;
    case "px":
      if (!(space.dpi && space.dpi > 0)) throw new Error("A pixel space needs a positive dpi to convert to points.");
      return PT_PER_IN / space.dpi;
  }
}

/** Convert a sheet measured in `space` into canonical page space. The page
 *  size is converted with the same factor; y is flipped about the page
 *  height when the source is y-up. Text direction vectors are flipped too,
 *  so a run reading upward stays reading upward. */
export function toCanonicalSheet(sheet: CountingSheetInput, space: SourceSpace): CountingSheetInput {
  const k = pointsPerUnit(space);
  const H = sheet.pageSize.height * k;
  const flip = space.yAxis === "up";
  const pt = ([x, y]: [number, number]): [number, number] => [x * k, flip ? H - y * k : y * k];
  const box = (b: Bbox): Bbox => {
    const [x1, y1] = pt([b[0], b[1]]); const [x2, y2] = pt([b[2], b[3]]);
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  };
  const shapes: DrawingGeometry[] = sheet.shapes.map((s) => {
    const points = s.points.map(pt);
    return { ...s, points, bbox: points.length ? boundingBoxOfPoints(points) : box(s.bbox) };
  });
  return {
    ...sheet,
    pageSize: { width: sheet.pageSize.width * k, height: H },
    runs: sheet.runs.map((r) => ({
      ...r,
      origin: pt(r.origin),
      direction: flip ? [r.direction[0], -r.direction[1]] : r.direction,
      width: r.width * k,
      height: r.height * k,
    })),
    shapes,
    symbols: sheet.symbols?.map((s) => ({ ...s, bbox: box(s.bbox) })),
    excludedRegions: sheet.excludedRegions?.map((r) => ({ ...r, bbox: box(r.bbox) })),
    unitsPerMm: sheet.unitsPerMm == null ? undefined : sheet.unitsPerMm * k,
  };
}

// ── Validation ──────────────────────────────────────────────────────────────

const finite = (...v: unknown[]) => v.every((x) => typeof x === "number" && Number.isFinite(x));
const validBox = (b: unknown): b is Bbox =>
  Array.isArray(b) && b.length === 4 && finite(...b) && (b as number[])[2] >= (b as number[])[0] && (b as number[])[3] >= (b as number[])[1];
const TEXT_SOURCES: readonly TextSource[] = ["pdf_text", "ocr", "cad"];

/**
 * Drop what can't be reasoned about, element by element, each with a
 * recorded reason: a sheet with no usable page size or page number, a run
 * with a non-finite coordinate, a shape with no points or a NaN, a symbol
 * with an invalid box. Nothing is repaired or invented. Malformed schedule
 * entries (no readable mark) are dropped the same way.
 */
export function validateInput(input: CountingInput): { input: CountingInput; rejected: RejectedInput[] } {
  const rejected: RejectedInput[] = [];
  const sheets: CountingSheetInput[] = [];
  const rawSheets = Array.isArray(input?.sheets) ? input.sheets : [];
  if (!Array.isArray(input?.sheets)) rejected.push({ where: "input.sheets", reason: "not an array — no sheets read" });
  rawSheets.forEach((s, si) => {
    const where = `sheets[${si}]`;
    if (!s || typeof s !== "object") { rejected.push({ where, reason: "not an object" }); return; }
    if (!s.documentId || typeof s.documentId !== "string") { rejected.push({ where, reason: "no documentId" }); return; }
    if (!finite(s.page) || s.page < 1) { rejected.push({ where, reason: "no valid 1-based page number" }); return; }
    if (!s.pageSize || !finite(s.pageSize.width, s.pageSize.height) || s.pageSize.width <= 0 || s.pageSize.height <= 0) {
      rejected.push({ where, reason: "no valid page size — coordinates on it cannot be placed" }); return;
    }
    const runs = (Array.isArray(s.runs) ? s.runs : []).filter((r, i) => {
      const ok = r && typeof r.text === "string" && Array.isArray(r.origin) && finite(r.origin[0], r.origin[1])
        && Array.isArray(r.direction) && finite(r.direction[0], r.direction[1]) && Math.hypot(r.direction[0], r.direction[1]) > 0
        && finite(r.width, r.height) && r.width >= 0 && r.height > 0;
      if (!ok) rejected.push({ where: `${where}.runs[${i}]`, reason: "text run with a missing or non-finite position, direction or size" });
      return ok;
    });
    const shapes = (Array.isArray(s.shapes) ? s.shapes : []).filter((g, i) => {
      const ok = g && Array.isArray(g.points) && g.points.length > 0 && g.points.every((p) => Array.isArray(p) && finite(p[0], p[1]));
      if (!ok) rejected.push({ where: `${where}.shapes[${i}]`, reason: "shape with no points or a non-finite point" });
      return ok;
    }).map((g) => ({ ...g, bbox: boundingBoxOfPoints(g.points) }));
    const symbols = (s.symbols ?? []).filter((y, i) => {
      const ok = y && typeof y.id === "string" && validBox(y.bbox) && ["door", "window", "ventilator"].includes(y.category);
      if (!ok) rejected.push({ where: `${where}.symbols[${i}]`, reason: "symbol with no id, no valid box or an unknown category" });
      return ok;
    });
    const excludedRegions = (s.excludedRegions ?? []).filter((r, i) => {
      const ok = r && validBox(r.bbox);
      if (!ok) rejected.push({ where: `${where}.excludedRegions[${i}]`, reason: "region with no valid box" });
      return ok;
    });
    const textSource: TextSource = TEXT_SOURCES.includes(s.textSource) ? s.textSource : "ocr";
    if (!TEXT_SOURCES.includes(s.textSource)) rejected.push({ where: `${where}.textSource`, reason: `unknown text source "${String(s.textSource)}" — treated as OCR (least trusted)` });
    const unitsPerMm = finite(s.unitsPerMm) && (s.unitsPerMm as number) > 0 ? s.unitsPerMm : undefined;
    sheets.push({
      ...s, runs, shapes, symbols, excludedRegions, textSource, unitsPerMm,
      textLayer: s.textLayer === "available" && runs.length > 0 ? "available" : "absent",
    });
  });

  const schedule = (Array.isArray(input?.schedule) ? input.schedule : []).filter((e, i) => {
    const mark = e && typeof e.mark === "string" ? canonicalMark(e.mark) : null;
    if (!mark) rejected.push({ where: `schedule[${i}]`, reason: `no readable mark ("${String(e?.mark)}")` });
    return !!mark;
  }).map((e) => ({
    ...e,
    mark: canonicalMark(e.mark)!,
    scheduledQuantity: finite(e.scheduledQuantity) && (e.scheduledQuantity as number) >= 0 ? e.scheduledQuantity : null,
  }));

  const expectedSheets = (input?.expectedSheets ?? []).filter((x) => x && typeof x.sheetNumber === "string" && x.sheetNumber.trim());
  return { input: { sheets, schedule, expectedSheets }, rejected };
}
