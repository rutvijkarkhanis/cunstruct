// LOCATION benchmark report — a per-room breakdown of one run against one
// reference, built on scoreObservations() (same matching, same grading).
// Pure: no I/O, never modifies the reference. Metrics the input can't support
// are listed in `notComputable` rather than reported as zero.

import { normalizeDimension, scoreObservations } from "./observationBenchmarkScorer";
import type { ObservationParseDiagnostics, ObservationV1 } from "./observationSchemaV1";
import type { ExpectedObservation } from "./benchmarkTypes";

export interface ReportRoom {
  id: string;
  mark?: string;
  floor?: string;
  page?: number;
  expectedDimension?: string;
}

export interface MatchedRoom extends ReportRoom {
  actualIndex: number;
  actualDimension?: string;
  /** null when the reference records no dimension for this room. */
  dimensionCorrect: boolean | null;
  typeCorrect: boolean;
  pageCorrect: boolean | null;
}

export interface ActualSummary {
  index: number;
  observationType: string;
  mark?: string;
  scopeHint?: string;
  page?: number;
}

export interface LocationBenchmarkReport {
  referenceRooms: number;
  matched: MatchedRoom[];
  missed: ReportRoom[];
  dimensions: { correct: number; incorrect: MatchedRoom[]; notReported: MatchedRoom[]; referenceWithDimension: number };
  types: { correct: number; of: number };
  /** Actual observations whose scope_hint names the floor their page shows. */
  floorLabels: { correct: number; of: number };
  extras: ActualSummary[];
  duplicates: ActualSummary[];
  observationsWithoutEvidence: number;
  /** null when the raw model response's parse diagnostics are unavailable. */
  parser: ObservationParseDiagnostics | null;
  notComputable: string[];
}

const norm = (s?: string) => (s ?? "").trim().toLowerCase();

export function buildLocationBenchmarkReport(
  reference: ExpectedObservation[],
  actual: ObservationV1[],
  parser: ObservationParseDiagnostics | null,
): LocationBenchmarkReport {
  const graded = reference.filter((e) => e.graded !== false);
  const r = scoreObservations(reference, actual, []);
  const byId = new Map(reference.map((e) => [e.id, e]));
  const room = (e: ExpectedObservation): ReportRoom => ({
    id: e.id, mark: e.mark, floor: e.scopeHint, page: e.expectedPage, expectedDimension: e.attributes?.dimension,
  });
  const summary = (i: number): ActualSummary => ({
    index: i, observationType: actual[i].observationType, mark: actual[i].mark, scopeHint: actual[i].scopeHint, page: actual[i].source?.page,
  });

  const matched: MatchedRoom[] = r.matchedPairs
    .filter((p) => byId.get(p.expectedId)!.graded !== false)
    .map(({ expectedId, actualIndex }) => {
      const e = byId.get(expectedId)!;
      const a = actual[actualIndex];
      return {
        ...room(e), actualIndex, actualDimension: a.attributes.dimension,
        dimensionCorrect: e.attributes?.dimension
          ? normalizeDimension(a.attributes.dimension) === normalizeDimension(e.attributes.dimension)
          : null,
        typeCorrect: a.observationType === e.observationType,
        pageCorrect: e.expectedPage === undefined ? null : a.source?.page === e.expectedPage,
      };
    });
  const matchedIds = new Set(matched.map((m) => m.id));
  const matchedActual = new Set(r.matchedPairs.map((p) => p.actualIndex));

  // The floor each page shows, as the reference records it (one floor per page).
  const floorOfPage = new Map<number, string>();
  for (const e of graded) if (e.expectedPage !== undefined && e.scopeHint) floorOfPage.set(e.expectedPage, norm(e.scopeHint));
  const floorLabelled = actual.filter((a) => a.source?.page !== undefined && floorOfPage.has(a.source.page));

  const withoutEvidence = actual.filter((a) => (a.source?.evidence ?? []).length === 0).length;
  const notComputable: string[] = [];
  if (!parser) notComputable.push("parser rejections and dropped evidence boxes (the raw model response was not kept)");
  if (actual.length > 0 && withoutEvidence === actual.length) {
    notComputable.push("evidence traceability, location-based room pairing, and location-based duplicate separation (no observation carries an evidence box)");
  }
  if (floorLabelled.length < actual.length) notComputable.push("floor-label accuracy for observations on pages the reference doesn't cover");

  return {
    referenceRooms: graded.length,
    matched,
    missed: graded.filter((e) => !matchedIds.has(e.id)).map(room),
    dimensions: {
      correct: matched.filter((m) => m.dimensionCorrect === true).length,
      incorrect: matched.filter((m) => m.dimensionCorrect === false && m.actualDimension),
      notReported: matched.filter((m) => m.dimensionCorrect === false && !m.actualDimension),
      referenceWithDimension: graded.filter((e) => e.attributes?.dimension).length,
    },
    types: { correct: matched.filter((m) => m.typeCorrect).length, of: matched.length },
    floorLabels: {
      correct: floorLabelled.filter((a) => norm(a.scopeHint) === floorOfPage.get(a.source!.page!)).length,
      of: floorLabelled.length,
    },
    extras: actual.map((_, i) => i).filter((i) => !matchedActual.has(i)).map(summary),
    duplicates: r.duplicateActualIds.map((id) => summary(Number(id.split("#")[1]))),
    observationsWithoutEvidence: withoutEvidence,
    parser,
    notComputable,
  };
}
