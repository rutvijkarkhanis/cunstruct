// INSTANCE COUNTING CONTRACT — `cunstruct.counting.v1`.
//
// The typed boundary of the drawing instance-counting engine: what it accepts
// (deterministic drawing observations — text runs, vector shapes, optional
// symbol detections from another source, schedule entries) and what it
// returns (candidate instances, per-type counts and an explicit list of
// unresolved cases).
//
// Two rules shape every type here:
//
//   1. OBSERVED evidence is kept apart from INFERRED interpretation. A
//      candidate's `observed` block holds only things read off the drawing
//      (a symbol's geometry, a tag's text and box). Which tag belongs to
//      which symbol, which schedule entry a tag refers to, and whether two
//      detections are one object are interpretations, held under
//      `interpretation` with the reason for each.
//   2. Nothing uncertain is presented as a quantity. A TypeCount carries a
//      `quantity` only when every candidate behind it is confirmed and
//      nothing on the same sheet could change it; otherwise `quantity` is
//      null and `reasons` says why. Confidence is null throughout: no part
//      of this engine produces a calibrated probability, so none is claimed.
//
// Coordinates: canonical page space, exactly as evidenceCoords.ts defines it
// — top-left origin, x right, y down, as displayed (rotation applied), at the
// page's own scale-1 size. normalize.ts converts other spaces (DXF y-up
// millimetres, 300-dpi OCR pixels) into it before anything else runs.
//
// The engine is pure: no I/O, no Supabase, no model call, no clock, no
// randomness. Same input, same output, byte for byte.

import type { DrawingTextRun, PageSize } from "../review/drawingInventory";
import type { DrawingGeometry } from "../review/drawingGeometry";
import type { AnalysisSource } from "../review/analysisSchemaV1";

export const COUNTING_CONTRACT_VERSION = "cunstruct.counting.v1";
export const COUNTING_ENGINE = "cunstruct-instance-counting 1.0.0";

export type Bbox = [number, number, number, number];

// ── Categories ──────────────────────────────────────────────────────────────

/** Countable element categories. The first slice handles openings only; a
 *  new category (fixtures, furniture, columns …) is added by giving it a
 *  CategoryProfile in categories.ts and a detector — the engine's
 *  association, de-duplication, cross-view and counting stages are
 *  category-agnostic. */
export type ElementCategory = "door" | "window" | "ventilator";

// ── Input ───────────────────────────────────────────────────────────────────

/** Where a sheet's text came from. OCR text is an input signal, not a
 *  reading: a tag read by OCR never confirms an instance on its own. */
export type TextSource = "pdf_text" | "ocr" | "cad";

/** A symbol detection supplied by something other than this engine's own
 *  geometric detector — a LOCATION observation, a CAD block insert, or a
 *  reviewer's manual mark. Only its box and category are used; `method`
 *  is carried through for provenance. */
export interface SymbolObservationInput {
  id: string;
  category: ElementCategory;
  bbox: Bbox;
  method: "location_observation" | "cad_block" | "manual";
  /** A mark the source attached to it (e.g. a CAD block attribute). Treated
   *  as one more tag signal, never as more trustworthy than a printed tag. */
  mark?: string;
}

export interface ExcludedRegionInput {
  bbox: Bbox;
  /** Why tags here are not plan occurrences: "title block", "legend", … */
  reason: string;
}

export interface CountingSheetInput {
  documentId: string;
  documentName?: string;
  /** SHA-256 of the drawing file, when known — carried into the analysis
   *  payload's source_drawing so an import is tied to one stored revision. */
  documentSha256?: string;
  page: number;
  pageSize: PageSize;
  /** "absent" for a raster page with no usable text: nothing on it can be
   *  counted, and the drawing set is incomplete for counting purposes. */
  textLayer: "available" | "absent";
  textSource: TextSource;
  runs: DrawingTextRun[];
  shapes: DrawingGeometry[];
  symbols?: SymbolObservationInput[];
  excludedRegions?: ExcludedRegionInput[];
  /** The sheet number as printed (e.g. "A-101"), when known. Used to check
   *  the set against `expectedSheets`. */
  sheetNumber?: string;
  /** Drawing units per real millimetre, when the sheet's scale is known
   *  (1:100 in PDF points → 72/25.4/100). Enables the door-leaf size check;
   *  absent means sizes are not checked and the candidate says so. */
  unitsPerMm?: number;
}

/** One schedule row, as an independent signal that a type exists. Usually
 *  built from cunstruct.analysis.v1 schedule items (PR #230's reader, or any
 *  other producer) by scheduleFromAnalysis(). */
export interface ScheduleEntryInput {
  id: string;
  mark: string;
  category?: ElementCategory;
  description?: string;
  dimension?: string;
  /** A count printed in the schedule, when it prints one. Building-wide by
   *  convention; it is compared with the drawing count only when that count
   *  is complete, and never used as the count. */
  scheduledQuantity: number | null;
  unit?: string;
  source?: AnalysisSource;
}

export interface ExpectedSheet {
  sheetNumber: string;
  title?: string;
}

export interface CountingInput {
  sheets: CountingSheetInput[];
  schedule: ScheduleEntryInput[];
  /** The drawing register / sheet index, when one is known. A listed sheet
   *  that is not supplied makes the set incomplete. */
  expectedSheets?: ExpectedSheet[];
}

// ── Output ──────────────────────────────────────────────────────────────────

export type ViewKind = "plan" | "elevation" | "section" | "detail" | "schedule" | "mixed" | "unknown";

export interface SheetSummary {
  sheetKey: string;
  documentId: string;
  page: number;
  sheetNumber: string | null;
  view: ViewKind;
  /** The floor named by the sheet title, or null when none / more than one. */
  floor: string | null;
  floorStatus: "identified" | "unidentified" | "conflict";
  /** True when the title says the plan stands for several floors. */
  typical: boolean;
  textLayer: "available" | "absent";
  textSource: TextSource;
  /** Order-independent digest of the sheet's opening layout (tags and
   *  symbols, position relative to the page). Two sheets with the same
   *  fingerprint show the same layout. */
  layoutFingerprint: string;
  /** Sheet-level facts a reviewer should see (e.g. arcs without a leaf). */
  notes: string[];
}

export type RecognitionMethod =
  | "door_swing_geometry"     // quarter arc + leaf line in the PDF vectors
  | "double_swing_geometry"   // two door swings meeting at one opening
  | "location_observation"
  | "cad_block"
  | "manual"
  | "plan_tag";               // only a printed tag; no symbol found

/** Something read directly off a drawing. Never an interpretation. */
export interface ObservedEvidence {
  /** Stable id of the input element: `${sheetKey}:run:${i}`, `:shape:${i}`,
   *  `:sym:${id}`. Enough to find the exact input again. */
  id: string;
  kind: "symbol" | "tag_text";
  documentId: string;
  page: number;
  bbox: Bbox;
  text?: string;
  method?: RecognitionMethod;
  /** For a tag: what the text parses to. */
  tag?: ParsedTag;
}

export type ParsedTag =
  | { status: "readable"; mark: string; category: ElementCategory }
  | { status: "multiple"; marks: string[]; category: ElementCategory | null }
  | { status: "unreadable"; category: ElementCategory | null; reason: string };

export type CountStatus = "confirmed" | "pending_review" | "ambiguous" | "conflicting" | "rejected";

export interface TagAssociation {
  status: "unique" | "ambiguous" | "none" | "tag_only";
  tagId?: string;
  /** Distance tag → symbol in multiples of the tag's text height. */
  distance?: number;
  /** Second-nearest / nearest; > the required margin when unique. */
  margin?: number;
  /** Other tags or symbols that were close enough to compete. */
  competitorIds?: string[];
  reason: string;
}

export interface ScheduleAssociation {
  status: "matched" | "no_entry" | "no_mark" | "conflicting_entries" | "category_mismatch" | "no_schedule_supplied";
  entryIds: string[];
  reason: string;
}

export interface CandidateInstance {
  id: string;
  category: ElementCategory;
  /** The mark this candidate is proposed to be (D1, W2), or null. */
  proposedType: string | null;
  sheetKey: string;
  documentId: string;
  page: number;
  floor: string | null;
  /** Union of the observed evidence boxes. */
  region: Bbox;
  observed: { symbols: ObservedEvidence[]; tags: ObservedEvidence[] };
  interpretation: {
    tag: TagAssociation;
    schedule: ScheduleAssociation;
    /** Set when several detections were merged into this one object. */
    duplicateGroup?: { memberIds: string[]; reason: string };
    /** Ids of CrossViewReferences to the same mark (never counted). */
    crossViewReferenceIds: string[];
    /** Set when this candidate was rejected as a repeat of another. */
    duplicateOf?: string;
  };
  recognition: { methods: RecognitionMethod[]; confidence: null };
  status: CountStatus;
  /** Every reason this candidate is not confirmed (empty when confirmed). */
  reasons: string[];
}

/** A tag on an elevation, section or detail: the same type shown again,
 *  never an additional installed object. */
export interface CrossViewReference {
  id: string;
  mark: string | null;
  view: ViewKind;
  sheetKey: string;
  evidence: ObservedEvidence;
}

export interface TypeCount {
  /** `${category}|${mark ?? "untagged"}|${floor ?? "?"}|${sheetKey-or-floor}` */
  id: string;
  category: ElementCategory;
  mark: string | null;
  floor: string | null;
  sheetKeys: string[];
  /** Candidates behind this count that are not rejected. */
  candidateIds: string[];
  confirmedCount: number;
  /** The count, only when status is "resolved". Never 0 for "unknown". */
  quantity: number | null;
  status: "resolved" | "unresolved";
  reasons: string[];
  scheduleEntryIds: string[];
  /** Present when sources give different values for the same count. */
  conflictingValues?: { value: number; basis: string }[];
}

/** Per mark, across floors: the drawing total next to the schedule's own
 *  printed quantity. Agreement is reported, never used to upgrade a count. */
export interface MarkTotal {
  mark: string;
  category: ElementCategory;
  drawingTotal: number | null;
  scheduledQuantity: number | null;
  /** Schedule entries listing this mark (empty when the plan shows a mark
   *  the schedule does not). */
  scheduleEntryIds: string[];
  comparison: "agree" | "disagree" | "not_comparable";
  reason: string;
}

export type UnresolvedKind =
  | "unmatched_tag"                     // a plan tag with no detected symbol
  | "untagged_candidate"                // a symbol with no tag
  | "ambiguous_tag"                     // a tag or symbol with more than one close partner
  | "contradictory_association"         // different marks compete for one symbol
  | "unreadable_tag"
  | "schedule_entry_without_instance"
  | "instance_without_schedule_entry"
  | "conflicting_schedule_entries"
  | "schedule_count_conflict"
  | "duplicate_detection"               // several detections merged into one object
  | "duplicate_sheet"                   // the same plan supplied twice
  | "conflicting_sheets"                // two different plans for one floor
  | "typical_floor_multiplier"
  | "floor_unidentified"
  | "mixed_view_sheet"
  | "missing_sheet"
  | "unreadable_sheet"
  | "plan_absent"                       // a mark seen only outside plans
  | "invalid_input";

export interface UnresolvedCase {
  id: string;
  kind: UnresolvedKind;
  message: string;
  sheetKey?: string;
  mark?: string;
  candidateIds?: string[];
  evidenceIds?: string[];
  scheduleEntryIds?: string[];
}

export interface RejectedInput {
  where: string;
  reason: string;
}

export interface CountingResult {
  contractVersion: typeof COUNTING_CONTRACT_VERSION;
  sheets: SheetSummary[];
  instances: CandidateInstance[];
  references: CrossViewReference[];
  counts: TypeCount[];
  markTotals: MarkTotal[];
  unresolved: UnresolvedCase[];
  rejectedInputs: RejectedInput[];
  /** Whether every expected sheet was supplied and readable. */
  drawingSet: { complete: boolean; reasons: string[] };
  provenance: {
    engine: typeof COUNTING_ENGINE;
    /** FNV-1a digest of the canonicalised input — the same input always
     *  gives the same digest, so a stored result can be checked against
     *  the input it claims to come from. */
    inputDigest: string;
    thresholds: Record<string, number>;
  };
}
