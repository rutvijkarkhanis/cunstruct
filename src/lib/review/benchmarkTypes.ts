// Generic benchmark types — the shapes used to score extraction runs against a
// manually audited ground truth. No drawing data lives here: ground-truth sets
// are fixtures (synthetic ones in __fixtures__/syntheticBenchmark.ts).

import type { AnalysisItemV1 } from "./analysisSchemaV1";
import type { ObservationType } from "./observationSchemaV1";

/** The four-way gap taxonomy: only "A" reflects the AI extraction actually
 *  getting something wrong. B/C are gaps in Cunstruct's schema or code that no
 *  AI extraction, however accurate, could satisfy today. D is a limit of this
 *  benchmark's own ground truth, not of Cunstruct or the AI. Never blend these. */
export type GapCategory =
  | "A_EXTRACTION_FAILURE"
  | "B_REPRESENTATION_GAP"
  | "C_CAPABILITY_GAP"
  | "D_BENCHMARK_DATA_GAP";

export interface CaseGap {
  category: GapCategory;
  note: string;
}

/** One real item the drawing set actually specifies. `id` is a stable
 *  benchmark-local identifier (not the AI's `key`) so duplicate-expectations
 *  can reference specific expected items unambiguously. */
export interface ExpectedItem {
  id: string;
  key: string;
  item: string;
  location?: string;
  quantity: number | null;
  unit?: string;
  dimension?: string;
  specification?: string;
}

export interface DuplicateExpectation {
  a: string; // ExpectedItem.id
  b: string; // ExpectedItem.id
  shouldBeDuplicate: boolean;
}

export interface BenchmarkCase {
  id: string;
  tier: 1 | 2 | 3;
  title: string;
  sourcePage: string;
  description: string;
  expectedItems: ExpectedItem[];
  /** Pairs buildReviewItems() must (or must not) flag as duplicates. Omitted
   *  when the case isn't about identity/duplicate behavior at all. */
  duplicateExpectations?: DuplicateExpectation[];
  /** Set when even a flawless AI extraction cannot be fully scored today
   *  because of a schema/code gap (B/C) or a benchmark data gap (D). Absent
   *  for a case with no known gap. */
  gap?: CaseGap;
  /** False only for a D_BENCHMARK_DATA_GAP case: ground truth itself isn't
   *  confirmed, so this case is reported but excluded from every average. */
  graded: boolean;
  notes?: string;
}

/** Build the AnalysisItemV1[] a flawless AI extraction would produce for one
 *  case — i.e. the case's ground truth, faithfully carried into the schema.
 *  This is NOT AI output; it exists only to (a) prove the scorer reports a
 *  perfect score on a perfect run, and (b) exercise the real reviewQueue.ts
 *  logic against realistic, schema-shaped data. */
export function perfectRunFor(c: BenchmarkCase): AnalysisItemV1[] {
  return c.expectedItems.map((e) => ({
    key: e.key,
    item: e.item,
    location: e.location,
    quantity: e.quantity,
    unit: e.unit,
    dimension: e.dimension,
    specification: e.specification,
    confidence: 0.95,
    aiStatus: e.quantity == null ? "PENDING" : "MEASURED",
  }));
}

export interface ExpectedObservation {
  id: string;
  observationType: ObservationType;
  mark?: string;
  scopeHint?: string;
  attributes?: { dimension?: string; specification?: string; material?: string };
  sourcePage: string;
  /** The page number already stated in `sourcePage`'s own text, restated as
   *  a comparable number — never independently re-derived or guessed.
   *  Omitted only if a future entry's sourcePage genuinely doesn't state one. */
  expectedPage?: number;
  notes?: string;
  /** Omitted (or `true`) means this entry's ground truth has been manually
   *  confirmed — see the file header's audit-status convention. `false`
   *  means NOT YET AUDITED: excluded from every scored average. */
  graded?: boolean;
  /** Set only when this entry documents a KNOWN discrepancy between this
   *  confirmed ground truth and a real production run's actual output (an
   *  A_EXTRACTION_FAILURE), or when `graded` is `false` (a
   *  D_BENCHMARK_DATA_GAP — ground truth itself not yet confirmed). Absent
   *  for a plain confirmed-correct entry. */
  gap?: CaseGap;
  /** Where the label sits on the page, when recorded from the drawing. Lets the
   *  scorer pair repeated labels (several W.R on one floor) by location instead
   *  of array order. bbox is [x1,y1,x2,y2] in the rendered page's top-left
   *  coordinate space of size `pageSize`. */
  expectedBox?: { bbox: [number, number, number, number]; pageSize: { width: number; height: number } };
}

/** One manually audited LOCATION production run, ready to be scored on its
 *  own via scoreObservations() (or as part of a registry via
 *  scoreLocationBenchmark()). `expectedObservations` and `distinctnessPairs`
 *  must reference only ids from THIS run — never another run's — so a
 *  missing fact from one document can never surface as a false negative
 *  against a different document's run. */
export interface LocationBenchmarkRun {
  id: string;
  title: string;
  /** Free-text identity, for humans reading a report — never parsed. */
  documentDescription: string;
  expectedObservations: ExpectedObservation[];
  distinctnessPairs: { a: string; b: string }[];
}
