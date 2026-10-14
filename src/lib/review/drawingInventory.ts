// DRAWING INVENTORY — what a drawing's own text layer says is on each page,
// independent of any AI output.
//
// The inventory answers "what is there to find?" so coverage can be measured
// against the drawing rather than against whatever a model happened to
// return. It is built from deterministic text runs (pdf.js text layer today;
// any other source — OCR, a CAD export — can supply DrawingTextPage too) and
// classifies each line conservatively:
//
//   space_label       — a room or space name from a fixed, reviewable vocabulary
//   room_dimension    — a "length x width" pair (feet-inches, or metric with units)
//   length_annotation — a single length ("9'-3\"", "4' WIDE")
//   area_annotation   — a stated area ("3960 SQFT")
//   sheet_title       — "<...> FLOOR PLAN", which identifies the page's floor
//   opening_label     — would be a space label, but names a door, window or
//                       ventilator ("TOILET DOOR", "KITCHEN WINDOW")
//   opening_size      — a size pair that the page's schedule structure shows is
//                       a door/window/ventilator size, not a room size
//   other             — everything else (electrical symbols, furniture, notes…)
//
// It never decides that a dimension belongs to a label (that is
// roomDimensionReconciliation.ts's job) and never treats a candidate as a
// verified BOQ quantity. Text it can't classify is counted, not guessed at.
//
// Coordinates: every box is [x1, y1, x2, y2] in the page's canonical space —
// top-left origin, y down, as displayed (rotation applied), sized `pageSize`
// (see evidenceCoords.ts). Pure and deterministic.

import type { ExtractedTextRun } from "./pdfGeometry";
import { placementDistance } from "./roomDimensionReconciliation";

export type Box = [number, number, number, number];
export interface PageSize { width: number; height: number }

/** One line of text from any deterministic source, in canonical page space. */
export interface DrawingTextRun {
  text: string;
  /** Baseline start point. */
  origin: [number, number];
  /** Unit reading direction ([1,0] = left-to-right; [0,-1] = bottom-to-top). */
  direction: [number, number];
  /** Extent along `direction`. */
  width: number;
  /** Glyph height, perpendicular to `direction`. */
  height: number;
}

export interface DrawingTextPage {
  documentId: string;
  page: number;
  pageSize: PageSize;
  /** "absent" for a raster/scanned page with no text layer — the inventory
   *  for it is empty and coverage for it is unknown, never "complete". */
  textLayer: "available" | "absent";
  runs: DrawingTextRun[];
}

/** Adapter from pdfGeometry.extractPageGeometry() output. */
export function textPageFromPdfExtraction(
  documentId: string,
  extraction: { page: number; pageSize: PageSize; textRuns: ExtractedTextRun[] },
): DrawingTextPage {
  const runs = extraction.textRuns
    .filter((r) => r.text.trim())
    .map((r) => ({ text: r.text, origin: [r.x, r.y] as [number, number], direction: r.direction ?? [1, 0] as [number, number], width: r.width, height: r.height }));
  return { documentId, page: extraction.page, pageSize: extraction.pageSize, textLayer: runs.length ? "available" : "absent", runs };
}

// ── Lengths and dimensions ──────────────────────────────────────────────────

export type LengthUnit = "in" | "m" | "mm";
/** A length exactly as written, held in its own unit. Feet-inches are held in
 *  whole inches so 14'2" stays exact (170 in). */
export interface Length {
  value: number;
  /** null when the drawing establishes no unit for this length (a unitless
   *  pair with no unit note on its page). Never used for a quantity. */
  unit: LengthUnit | null;
  text: string;
  /** false when the drawing printed no unit for this length and it was read
   *  as the pair's other unit ("3.5 x 4.2 m"). Never used for a quantity. */
  unitStated?: false;
}
/** How a unitless pair's unit was (or wasn't) established. Absent for pairs
 *  whose units are printed with them. */
export type UnitBasis =
  | { kind: "page_note"; candidateId: string; note: string }
  | { kind: "unresolved"; reason: string };
export interface DimensionPair {
  first: Length;
  second: Length;
  unitBasis?: UnitBasis;
  /** For a unitless pair: what was done to read it. The printed text is kept on each Length. */
  normalization?: string;
}

const FT_IN = String.raw`(\d+)\s*['’′]\s*-?\s*(?:(\d+(?:\.\d+)?)\s*(?:["”″]|''))?`;
const FT_IN_PAIR = new RegExp(String.raw`^\s*${FT_IN}\s*[xX×]\s*${FT_IN}\s*$`);
const FT_IN_ANY = new RegExp(FT_IN);
const METRIC_PAIR = /^\s*(\d+(?:\.\d+)?)\s*(mm|m)?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(mm|m)\s*$/i;
const NUM = String.raw`(\d{1,6}(?:\.\d{1,2})?)`;
const UNITLESS_PAIR = new RegExp(String.raw`^\s*${NUM}\s*[xX×]\s*${NUM}\s*$`);
// An explicit statement of the drawing's dimension unit, e.g. "ALL DIMENSIONS ARE IN MM".
const UNIT_NOTE = /\bDIMENSIONS?\s+(?:ARE\s+|IS\s+)?(?:GIVEN\s+|SHOWN\s+)?IN\s+(MM|MILLIMET(?:RE|ER)S?|METRES?|METERS?|CM|CENTIMET(?:RE|ER)S?|FEET(?:\s+AND\s+INCHES)?|FT)\b/i;
const AREA = /\b\d+(?:\.\d+)?\s*(?:SQ\.?\s*FT|SQFT|SFT|SQ\.?\s*M|SQM|M2|M²)\b/i;

function feetInches(feet: string, inches: string | undefined, text: string): Length | null {
  const ft = Number(feet), inch = inches === undefined ? 0 : Number(inches);
  if (!Number.isFinite(ft) || !Number.isFinite(inch) || inch >= 12) return null;
  return { value: ft * 12 + inch, unit: "in", text: text.trim() };
}

/** "3850 X 3500", "1350x980", "2277.50 x 2400": two plain positive numbers with
 *  no unit. Returned with unit null and unitBasis unresolved — buildDrawingInventory
 *  sets the unit only from a unit note on the same page. Magnitude is never used. */
export function parseUnitlessPair(text: string): DimensionPair | null {
  const m = UNITLESS_PAIR.exec(text);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  if (!(a > 0) || !(b > 0)) return null;
  return {
    first: { value: a, unit: null, text: m[1] },
    second: { value: b, unit: null, text: m[2] },
    unitBasis: { kind: "unresolved", reason: "No unit is printed with this size, and this page has no note stating the dimension unit." },
    normalization: "Unitless pair read as two plain numbers; values kept exactly as printed.",
  };
}

/** The unit a note like "ALL DIMENSIONS ARE IN MM" states, or null. */
export function unitNoteOf(text: string): "mm" | "m" | "cm" | "ft-in" | null {
  const m = UNIT_NOTE.exec(text);
  if (!m) return null;
  const u = m[1].toUpperCase();
  if (u === "MM" || u.startsWith("MILLI")) return "mm";
  if (u === "CM" || u.startsWith("CENTI")) return "cm";
  if (u.startsWith("FEET") || u === "FT") return "ft-in";
  return "m";
}

/** Parse "14'2\" X 12'4\"", "8' X 5'6\"" or "3.5 x 4.2 m". Null when the text
 *  isn't exactly one dimension pair (or has impossible inches, e.g. 5'14"). */
export function parseDimensionPair(text: string): DimensionPair | null {
  const f = FT_IN_PAIR.exec(text);
  if (f) {
    const [left, right] = text.split(/[xX×]/);
    const first = feetInches(f[1], f[2], left), second = feetInches(f[3], f[4], right);
    return first && second ? { first, second } : null;
  }
  const m = METRIC_PAIR.exec(text);
  if (m) {
    const unitA = (m[2] ?? m[4]).toLowerCase() as LengthUnit, unitB = m[4].toLowerCase() as LengthUnit;
    const first: Length = { value: Number(m[1]), unit: unitA, text: `${m[1]}${m[2] ?? ""}` };
    if (!m[2]) first.unitStated = false;
    return { first, second: { value: Number(m[3]), unit: unitB, text: `${m[3]}${m[4]}` } };
  }
  return null;
}

// ── Space vocabulary ────────────────────────────────────────────────────────
// Deliberately explicit and short: a word not listed here is not a space.
// Coverage built on it is therefore always reported as provisional.

export type SpaceClass = "room" | "circulation" | "outdoor";
const ROOM_WORDS = new Set([
  "ROOM", "BEDROOM", "KITCHEN", "DINING", "LIVING", "HALL", "LOUNGE", "FOYER", "TOILET", "BATH", "BATHROOM",
  "WASHROOM", "POWDER", "UTILITY", "STORE", "STORAGE", "POOJA", "PUJA", "PRAYER", "LIFT", "STUDY", "OFFICE",
  "PANTRY", "LAUNDRY", "GYM", "DRESS", "DRESSING", "CLOSET", "DEN", "SERVANT", "MAID",
]);
const ROOM_ABBREVIATIONS = new Set(["WR", "WIC"]); // compared on the label key (W.R → WR)
const CIRCULATION_WORDS = new Set(["PASSAGE", "CORRIDOR", "LOBBY", "ENTRANCE", "STAIR", "STAIRS", "STAIRCASE"]);
const OUTDOOR_WORDS = new Set(["BALCONY", "VERANDAH", "VERANDA", "SITOUT", "TERRACE", "DECK", "GARDEN", "POCKET", "PARKING", "PORCH"]);
// Words that make a line furniture, a fixture or a note even if it contains a space word.
const NOT_A_SPACE = new Set(["UNIT", "OH", "WARDROBE", "SHOWER", "WC", "WB", "FRIDGE", "ISLAND", "PLASMA", "MIRROR", "GATE", "AREA", "PLAN", "WALL", "BOARD"]);

/** Case- and punctuation-insensitive identity for labels: "W.R" = "WR",
 *  "Children Bedroom-1" = "CHILDREN BEDROOM 1". */
export function labelKey(text: string | undefined): string {
  return (text ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function spaceClassOf(text: string): SpaceClass | null {
  const words = text.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  if (words.some((w) => NOT_A_SPACE.has(w))) return null;
  if (ROOM_ABBREVIATIONS.has(labelKey(text))) return "room";
  if (words.some((w) => ROOM_WORDS.has(w))) return "room";
  if (words.some((w) => CIRCULATION_WORDS.has(w))) return "circulation";
  if (words.some((w) => OUTDOOR_WORDS.has(w))) return "outdoor";
  return null;
}

const SHEET_TITLE = /\b((?:[A-Z0-9]+\s+){0,2}FLOOR)\s+PLAN\b/i;

// ── Inventory ───────────────────────────────────────────────────────────────

export type CandidateKind =
  | "space_label" | "room_dimension" | "length_annotation" | "area_annotation" | "sheet_title" | "unit_note"
  | "opening_label" | "opening_size" | "other";

/** Why a candidate is treated as part of a door/window/ventilator schedule,
 *  and the candidates that show it. */
export interface OpeningEvidence { reason: string; evidenceIds: string[] }

export interface InventoryCandidate {
  id: string;
  documentId: string;
  page: number;
  pageSize: PageSize;
  kind: CandidateKind;
  text: string;
  box: Box;
  /** The run's reading direction and line height (for spatial reasoning). */
  direction: [number, number];
  lineHeight: number;
  spaceClass?: SpaceClass;
  dimension?: DimensionPair;
  /** For a sheet title: the floor it names, as printed ("FIRST FLOOR"). */
  floorText?: string;
  /** For a unit note: the unit it states. */
  unitNote?: "mm" | "m" | "cm" | "ft-in";
  /** For opening_label / opening_size: what identifies it as an opening. */
  opening?: OpeningEvidence;
  /** For a space_label printed on an opening-schedule row: it may name the
   *  room an opening serves, not a space on the plan. Never paired with a size. */
  scheduleRow?: OpeningEvidence;
}

export type PageFloor =
  | { status: "identified"; floor: string; candidateId: string }
  | { status: "unidentified" }
  | { status: "conflict"; floors: string[] };

export interface InventoryPage {
  documentId: string;
  page: number;
  pageSize: PageSize;
  textLayer: "available" | "absent";
  floor: PageFloor;
}

export interface DrawingInventory {
  pages: InventoryPage[];
  candidates: InventoryCandidate[];
}

/** Axis-aligned box of a run, from its baseline, direction and height. */
export function runBox(run: DrawingTextRun): Box {
  const [ox, oy] = run.origin, [dx, dy] = run.direction;
  // "Up" from the baseline in a y-down space: the direction rotated -90°.
  const ux = dy, uy = -dx;
  const xs = [ox, ox + dx * run.width, ox + ux * run.height, ox + dx * run.width + ux * run.height];
  const ys = [oy, oy + dy * run.width, oy + uy * run.height, oy + dy * run.width + uy * run.height];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** "FIRST FLOOR" → "First Floor". */
export function floorName(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function classifyText(text: string): Pick<InventoryCandidate, "kind" | "spaceClass" | "dimension" | "floorText" | "unitNote"> {
  const title = SHEET_TITLE.exec(text);
  if (title) return { kind: "sheet_title", floorText: title[1].replace(/\s+/g, " ").toUpperCase() };
  const unitNote = unitNoteOf(text);
  if (unitNote) return { kind: "unit_note", unitNote };
  const dimension = parseDimensionPair(text) ?? parseUnitlessPair(text);
  if (dimension) return { kind: "room_dimension", dimension };
  const spaceClass = spaceClassOf(text);
  if (spaceClass) return { kind: "space_label", spaceClass };
  if (AREA.test(text)) return { kind: "area_annotation" };
  if (FT_IN_ANY.test(text)) return { kind: "length_annotation" };
  return { kind: "other" };
}

export function buildDrawingInventory(pages: DrawingTextPage[]): DrawingInventory {
  const candidates: InventoryCandidate[] = [];
  const inventoryPages: InventoryPage[] = [];
  for (const p of pages) {
    const pageCandidates = p.runs.map((run, i): InventoryCandidate => ({
      id: `${p.documentId}:p${p.page}:${i}`,
      documentId: p.documentId,
      page: p.page,
      pageSize: p.pageSize,
      text: run.text.trim(),
      box: runBox(run),
      direction: run.direction,
      lineHeight: run.height,
      ...classifyText(run.text.trim()),
    }));
    // A unitless size takes its unit only from a note on the same page that
    // states one supported length unit. No note, conflicting notes, or a note
    // naming another unit leaves it unresolved.
    const noteUnits = [...new Set(pageCandidates.filter((c) => c.kind === "unit_note").map((c) => c.unitNote!))];
    for (const c of pageCandidates) {
      if (c.kind !== "room_dimension" || c.dimension?.unitBasis?.kind !== "unresolved") continue;
      if (noteUnits.length > 1) {
        c.dimension = { ...c.dimension, unitBasis: { kind: "unresolved", reason: `This page's notes state different units (${noteUnits.join(", ")}).` } };
      } else if (noteUnits.length === 1 && (noteUnits[0] === "mm" || noteUnits[0] === "m")) {
        const unit = noteUnits[0], note = pageCandidates.find((n) => n.kind === "unit_note")!;
        c.dimension = {
          ...c.dimension,
          first: { ...c.dimension.first, unit }, second: { ...c.dimension.second, unit },
          unitBasis: { kind: "page_note", candidateId: note.id, note: note.text },
          normalization: `${c.dimension.normalization} Unit ${unit} from the page note "${note.text}".`,
        };
      } else if (noteUnits.length === 1) {
        c.dimension = { ...c.dimension, unitBasis: { kind: "unresolved", reason: `This page's note states ${noteUnits[0]}, which a plain-number size can't be read in.` } };
      }
    }
    classifyOpeningSchedule(pageCandidates);
    candidates.push(...pageCandidates);
    const titles = pageCandidates.filter((c) => c.kind === "sheet_title");
    const floors = [...new Set(titles.map((t) => t.floorText!))];
    inventoryPages.push({
      documentId: p.documentId, page: p.page, pageSize: p.pageSize, textLayer: p.textLayer,
      floor: floors.length === 0 ? { status: "unidentified" }
        : floors.length > 1 ? { status: "conflict", floors: floors.map(floorName) }
        : { status: "identified", floor: floorName(floors[0]), candidateId: titles[0].id },
    });
  }
  return { pages: inventoryPages, candidates };
}

// ── Opening schedules ───────────────────────────────────────────────────────
// Door, window and ventilator schedules print "W x H" sizes exactly like room
// sizes, often beneath a description holding a room word ("TOILET DOOR").
// Sizes are taken out of room measurement only on structural evidence on the
// page: a schedule mark ("D1", "W4", "V1") or an opening description on the
// same row, or an opening description (or a schedule-row label) directly above
// the size, where a room's name would be. Nothing is dropped: every affected
// candidate keeps its text, box and parsed size, and carries the reason.

const OPENING_WORD = /\b(DOORS?|WINDOWS?|VENTILATORS?)\b/i;
const OPENING_MARK = /^[DWV]\d{1,2}[A-Z]?$/i;
/** Two runs share a schedule row when their centres sit on the same line and
 *  the gap between them is at most this many line heights. */
export const ROW_GAP_LINES = 6;

const centreOf = (b: Box): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

function sameRow(a: InventoryCandidate, b: InventoryCandidate): boolean {
  if (a.page !== b.page || a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1] <= 0.99) return false;
  const [dx, dy] = a.direction, h = Math.max(a.lineHeight, b.lineHeight) || 1;
  const [ax, ay] = centreOf(a.box), [bx, by] = centreOf(b.box);
  if (Math.abs((bx - ax) * -dy + (by - ay) * dx) > h / 2) return false;
  const span = (c: InventoryCandidate) => {
    const xs = [c.box[0] * dx + c.box[1] * dy, c.box[2] * dx + c.box[3] * dy];
    return [Math.min(...xs), Math.max(...xs)];
  };
  const [a1, a2] = span(a), [b1, b2] = span(b);
  return Math.max(b1 - a2, a1 - b2) <= ROW_GAP_LINES * h;
}

function classifyOpeningSchedule(candidates: InventoryCandidate[]): void {
  for (const c of candidates) {
    if (c.kind === "space_label" && OPENING_WORD.test(c.text)) {
      c.kind = "opening_label";
      delete c.spaceClass;
      c.opening = { reason: `"${c.text}" names a door, window or ventilator, not a space.`, evidenceIds: [c.id] };
    }
  }
  const isMark = (c: InventoryCandidate) => OPENING_MARK.test(c.text);
  const anchors = candidates.filter((c) => isMark(c) || (c.kind !== "room_dimension" && OPENING_WORD.test(c.text)));
  const rowAnchor = (c: InventoryCandidate) => anchors.find((a) => a !== c && sameRow(c, a));

  for (const c of candidates) {
    if (c.kind !== "space_label") continue;
    const a = rowAnchor(c);
    if (a) c.scheduleRow = { reason: `Printed on an opening-schedule row with "${a.text}"; it may name the room an opening serves, not a space on the plan.`, evidenceIds: [a.id] };
  }

  for (const c of candidates) {
    if (c.kind !== "room_dimension") continue;
    const a = rowAnchor(c);
    if (a) {
      c.kind = "opening_size";
      c.opening = { reason: `On the same row as "${a.text}" in an opening schedule.`, evidenceIds: [a.id] };
      continue;
    }
    // The text directly above the size, where a room's name would be printed.
    const above = candidates
      .filter((u) => u !== c && u.kind !== "room_dimension" && u.kind !== "opening_size")
      .map((u) => ({ u, d: placementDistance(u, c) }))
      .filter((x): x is { u: InventoryCandidate; d: number } => x.d !== null)
      .sort((x, y) => x.d - y.d)[0]?.u;
    if (above?.kind === "opening_label" || (above && OPENING_WORD.test(above.text))) {
      c.kind = "opening_size";
      c.opening = { reason: `Printed beneath "${above.text}", which names an opening.`, evidenceIds: [above.id] };
    } else if (above?.scheduleRow) {
      c.kind = "opening_size";
      c.opening = { reason: `Printed beneath "${above.text}", which sits on an opening-schedule row.`, evidenceIds: [above.id, ...above.scheduleRow.evidenceIds] };
    }
  }
}
