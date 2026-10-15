// INVENTORY-GUIDED EXTRACTION (experiment arm) — gives the model the room
// labels the drawing's own text layer contains, and asks for a verdict on
// each, using the EXISTING observation schema and parser unchanged.
//
// What the model is given per candidate: an id, the page, the page's floor
// (from its sheet title), the printed label and an APPROXIMATE position
// (nearest 5% across/down). Deliberately NOT given: exact boxes (so any
// evidence box it returns is its own placement) or dimensions (so dimension
// accuracy still measures the model). Nothing here reads a benchmark
// reference or a stored model output.
//
// Verdicts travel in location_text, which the schema already carries:
//   "[C7] confirmed …"  — a normal observation with its own evidence box
//   "[C7] rejected: …"  — not a room; excluded from room claims
//   "[C7] unresolved: …" — couldn't decide; excluded, counted for review
// Observations without a tag are new discoveries and are scored like any other.

import { buildDrawingInventory, type DrawingTextPage } from "./drawingInventory";
import { buildLocationBenchmarkReport } from "./locationBenchmarkReport";
import type { ObservationParseDiagnostics, ObservationV1 } from "./observationSchemaV1";
import type { ExpectedObservation } from "./benchmarkTypes";

export interface GuidanceCandidate {
  id: string;
  page: number;
  floor: string | null;
  label: string;
  acrossPct: number;
  downPct: number;
}

const to5 = (v: number) => Math.min(100, Math.max(0, Math.round((v * 100) / 5) * 5));

/** Room-class space labels from the drawing text, in reading order. */
export function guidanceCandidates(pages: DrawingTextPage[]): GuidanceCandidate[] {
  const inventory = buildDrawingInventory(pages);
  const floorOf = new Map(inventory.pages.map((p) => [p.page, p.floor.status === "identified" ? p.floor.floor : null]));
  return inventory.candidates
    .filter((c) => c.kind === "space_label" && c.spaceClass === "room")
    .map((c) => ({
      page: c.page, floor: floorOf.get(c.page) ?? null, label: c.text,
      acrossPct: to5((c.box[0] + c.box[2]) / 2 / c.pageSize.width),
      downPct: to5((c.box[1] + c.box[3]) / 2 / c.pageSize.height),
    }))
    .sort((a, b) => a.page - b.page || a.downPct - b.downPct || a.acrossPct - b.acrossPct)
    .map((c, i) => ({ id: `C${i + 1}`, ...c }));
}

export function inventoryGuidance(candidates: GuidanceCandidate[]): string {
  return [
    "A text scan of these drawings found the candidate room labels below. They are leads to check, not facts: a candidate may be furniture, a cupboard or a misread.",
    "For EVERY candidate, return exactly one observation whose location_text starts with its id and a verdict:",
    '- "[C<n>] confirmed" — you can see this room on the drawing. Report it as room_or_space with the label as mark, the floor as scope_hint, its own dimension if one is printed for it, and an evidence box you placed on the drawing yourself.',
    '- "[C<n>] rejected: <reason>" — it is not a room. Use observation_type other_construction_fact, evidence_completeness LIMITED, no evidence boxes.',
    '- "[C<n>] unresolved: <reason>" — you cannot tell. Use evidence_completeness LIMITED, no evidence boxes.',
    "Positions are approximate (nearest 5%). Labels that repeat (e.g. several W.R) are separate rooms; keep each one separate with its own box.",
    "Also report any room the list misses, with no id in location_text.",
    "Candidates (id · page · floor · label · position):",
    ...candidates.map((c) => `${c.id} · p.${c.page} · ${c.floor ?? "floor not identified"} · ${c.label} · about ${c.acrossPct}% across, ${c.downPct}% down`),
  ].join("\n");
}

const TAG = /^\s*\[(C\d+)\]\s*(confirmed|rejected|unresolved)\b/i;

export interface CandidateOutcomes {
  /** Observations scored as room claims: confirmed candidates plus untagged discoveries. */
  claims: ObservationV1[];
  confirmed: string[];
  rejected: string[];
  unresolved: string[];
  /** Candidates the model gave no verdict for. */
  missingVerdict: string[];
  /** Tags naming an id that wasn't in the list, or a candidate given more than one verdict. */
  invalidTags: string[];
}

/** Split a run's observations by verdict. A run with no tags (any other arm)
 *  passes through unchanged: every observation is a claim. */
export function splitCandidateOutcomes(observations: ObservationV1[], candidates: GuidanceCandidate[]): CandidateOutcomes {
  const ids = new Set(candidates.map((c) => c.id));
  const seen = new Set<string>();
  const out: CandidateOutcomes = { claims: [], confirmed: [], rejected: [], unresolved: [], missingVerdict: [], invalidTags: [] };
  for (const o of observations) {
    const m = TAG.exec(o.locationText ?? "");
    if (!m) { out.claims.push(o); continue; }
    const [, id, verdictRaw] = m;
    const verdict = verdictRaw.toLowerCase();
    if (!ids.has(id) || seen.has(id)) { out.invalidTags.push(id); if (verdict === "confirmed") out.claims.push(o); continue; }
    seen.add(id);
    if (verdict === "confirmed") { out.confirmed.push(id); out.claims.push(o); }
    else if (verdict === "rejected") out.rejected.push(id);
    else out.unresolved.push(id);
  }
  out.missingVerdict = candidates.filter((c) => !seen.has(c.id)).map((c) => c.id);
  return out;
}

export interface ScreeningMetrics {
  referenceRooms: number;
  matched: number;
  recall: number;
  /** Matched / (matched + unmatched room_or_space claims). Other observation types aren't room claims. */
  precision: number | null;
  falsePositives: { mark?: string; page?: number }[];
  dimensions: { correct: number; of: number };
  floorLabels: { correct: number; of: number };
  duplicates: number;
  evidencePlacement: { placed: number; of: number } | null;
  parserRejections: number | null;
  reviewItems: number;
  notComputable: string[];
}

/** Same rules for every arm: one reference, one scorer, room claims only. */
export function screeningMetrics(
  reference: ExpectedObservation[],
  claims: ObservationV1[],
  diagnostics: ObservationParseDiagnostics | null,
  verdicts: Pick<CandidateOutcomes, "unresolved" | "missingVerdict"> = { unresolved: [], missingVerdict: [] },
): ScreeningMetrics {
  const r = buildLocationBenchmarkReport(reference, claims, diagnostics);
  const falsePositives = r.extras.filter((x) => x.observationType === "room_or_space").map((x) => ({ mark: x.mark, page: x.page }));
  const byId = new Map(reference.map((e) => [e.id, e]));

  // Evidence placed = the claim's first box on the right page covers the
  // reference label's centre, or its centre is within 5% of the page of it.
  const boxed = r.matched.filter((m) => (claims[m.actualIndex].source.evidence ?? []).length > 0);
  const placed = boxed.filter((m) => {
    const e = byId.get(m.id)!;
    const a = claims[m.actualIndex];
    const box = a.source.evidence[0];
    if (!e.expectedBox || (box.page ?? a.source.page) !== e.expectedPage) return false;
    const s = a.source.pageSize ?? e.expectedBox.pageSize, ps = e.expectedBox.pageSize;
    const [ex, ey] = [(e.expectedBox.bbox[0] + e.expectedBox.bbox[2]) / 2 / ps.width, (e.expectedBox.bbox[1] + e.expectedBox.bbox[3]) / 2 / ps.height];
    const [x1, y1, x2, y2] = [box.bbox[0] / s.width, box.bbox[1] / s.height, box.bbox[2] / s.width, box.bbox[3] / s.height];
    const covers = x1 <= ex && ex <= x2 && y1 <= ey && ey <= y2;
    return covers || Math.hypot((x1 + x2) / 2 - ex, (y1 + y2) / 2 - ey) <= 0.05;
  }).length;

  const dimsOf = r.matched.filter((m) => m.dimensionCorrect !== null);
  const parserRejections = diagnostics ? diagnostics.rejected.length : null;
  const notComputable = [...r.notComputable];
  if (boxed.length === 0 && r.matched.length > 0) notComputable.push("evidence placement (no matched claim carries a box)");
  return {
    referenceRooms: r.referenceRooms,
    matched: r.matched.length,
    recall: r.matched.length / r.referenceRooms,
    precision: r.matched.length + falsePositives.length ? r.matched.length / (r.matched.length + falsePositives.length) : null,
    falsePositives,
    dimensions: { correct: r.dimensions.correct, of: dimsOf.length },
    floorLabels: r.floorLabels,
    duplicates: r.duplicates.length,
    evidencePlacement: boxed.length ? { placed, of: boxed.length } : null,
    parserRejections,
    // Every item a person must check before anything reaches a BOQ.
    reviewItems: falsePositives.length + r.dimensions.incorrect.length + r.dimensions.notReported.length
      + (r.floorLabels.of - r.floorLabels.correct) + r.duplicates.length
      + verdicts.unresolved.length + verdicts.missingVerdict.length + (parserRejections ?? 0),
    notComputable,
  };
}

/** True when the guidance text carries no dimension strings — the arm must
 *  not hand the model the answers it is being measured on. */
export function guidanceHasNoDimensions(text: string): boolean {
  return !/\d+\s*['’′]\s*-?\s*(\d+\s*["”″])?\s*[xX×]/.test(text);
}

