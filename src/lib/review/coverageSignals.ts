// COVERAGE SIGNALS — PR #155, the first pure Coverage/Completeness layer.
//
// Phase A Readiness (instanceReconciliation.ts/readiness.ts) answers: "for a
// BOQ item we already have, how well is it reconciled against evidence?"
// This module answers the OPPOSITE traversal over the same evidence graph:
// "for evidence that exists in the drawings/schedules, is there a
// corresponding BOQ item at all?" It is not a replacement for Readiness and
// never touches it — Readiness's GREEN/AMBER/RED semantics are completely
// unchanged by this file.
//
//   Drawing evidence -> document -> boq_document -> BOQ -> analysis_review_item
//
// Pure, synchronous, deterministic: no I/O, no Supabase, no AI call, no
// database write, no BOQ mutation, no new table/status enum. The caller
// supplies already-loaded observations, review items, and boq_document
// links; this file only detects evidence with no matching BOQ item (a
// "Potential Gap") and returns plain data. PR #156 will later turn these
// signals into boq_audit_finding rows — this file never writes one itself.

import { norm, PHYSICAL_OBSERVATION_TYPES } from "./typeInstances";
import type { LocationObservation } from "./locationObservations";
import type { StoredReviewItem } from "./reviewStore";

/**
 * One document's LOCATION observations. LocationObservation itself carries
 * no document id (it is always loaded already scoped to one document's run
 * — see locationObservations.ts's loadLocationObservations(runId)), so the
 * caller supplies that scope explicitly here rather than this module
 * inventing a second document-identity convention.
 */
export interface CoverageDocumentObservations {
  documentId: string;
  observations: LocationObservation[];
}

/**
 * One BOQ's existing review items (the analysis_review_item rows already
 * loaded via loadReviewItems — unchanged). Only each item's ai.key is
 * actually used by the matching rule below; the full existing
 * StoredReviewItem type is accepted rather than a narrower invented one,
 * matching readiness.ts's own BoqReadinessGroup precedent (group-by-boq,
 * carry the real existing item shape).
 */
export interface CoverageBoqReviewItems {
  boqId: string;
  items: StoredReviewItem[];
}

/** One boq_document row's scope — exactly (boq_id, document_id), the only
 *  two columns this module needs from that table. */
export interface CoverageBoqDocumentLink {
  boqId: string;
  documentId: string;
}

export interface GenerateCoverageSignalsInput {
  documents: CoverageDocumentObservations[];
  boqs: CoverageBoqReviewItems[];
  boqDocumentLinks: CoverageBoqDocumentLink[];
}

/** The only two evidence sources this first Coverage layer recognizes — the
 *  same split typeInstances.ts already draws between a schedule TABLE row
 *  and a placed PHYSICAL occurrence (PHYSICAL_OBSERVATION_TYPES). Every
 *  other observation type (dimension_annotation, level_annotation, …) is
 *  neither and is ignored — never broadened in this PR. */
export type CoverageEvidenceType = "schedule_entry" | "physical";

/**
 * A single, deterministic "evidence exists but no BOQ item matches it" —
 * not a verified missing item, not a proposed BOQ line, not a quantity, not
 * an AI-generated judgment. `type` is always POTENTIAL_GAP:
 * SCHEDULE_ENTRY_WITHOUT_BOQ_ITEM and PHYSICAL_EVIDENCE_WITHOUT_BOQ_ITEM are
 * the two rules that can PRODUCE a signal, never separate status/type
 * values on the signal itself — when both rules apply to the same
 * document+boq+key they collapse into exactly one signal whose
 * evidenceTypes names both, rather than a third merged status.
 */
export interface CoverageSignal {
  type: "POTENTIAL_GAP";
  boqId: string;
  documentId: string;
  /** norm(mark) — the same case/whitespace-insensitive key typeInstances.ts
   *  already matches marks against a BOQ item's ai.key with. */
  normalizedKey: string;
  /** The original, as-extracted mark text, for display only. Deterministic
   *  regardless of input order: the mark belonging to whichever
   *  contributing observation has the lexicographically smallest id. */
  mark: string;
  /** Sorted, deduplicated, alphabetical — never insertion-order-dependent. */
  evidenceTypes: CoverageEvidenceType[];
  /** The contributing analysis_observation ids, sorted — so a later
   *  consumer (PR #156) can trace this signal back to its exact evidence.
   *  Never a quantity, never a proposed line. */
  observationIds: string[];
  /** Stable, deterministic identity for this exact (boq, document,
   *  normalized key) gap — suitable for a future idempotent Finding
   *  write (PR #156). Uses the repository's existing "¦"-joined
   *  composite-key convention (reviewQueue.ts's scopedKey/dupeKey), not an
   *  invented separator. */
  signalKey: string;
  /** Human-readable, deterministic — never AI-generated, never a
   *  confidence score. */
  reason: string;
}

/** Classify one observation for Coverage purposes, reusing the exact same
 *  physical/schedule split typeInstances.ts already defines. Anything else
 *  (dimension_annotation, level_annotation, …) is unsupported here and
 *  contributes no signal — this PR never broadens what counts as evidence. */
function evidenceTypeFor(observationType: LocationObservation["observationType"]): CoverageEvidenceType | null {
  if (observationType === "schedule_entry") return "schedule_entry";
  if (PHYSICAL_OBSERVATION_TYPES.has(observationType)) return "physical";
  return null;
}

interface Aggregate {
  boqId: string;
  documentId: string;
  normalizedKey: string;
  evidenceTypes: Set<CoverageEvidenceType>;
  observations: { id: string; mark: string }[];
}

/**
 * Generate Coverage's P0 "missing BOQ item" signals — SCHEDULE_ENTRY_
 * WITHOUT_BOQ_ITEM and PHYSICAL_EVIDENCE_WITHOUT_BOQ_ITEM — collapsed to
 * exactly one candidate per (boq, document, normalized key). Pure,
 * synchronous, deterministic: the same inputs (in any array order) always
 * produce the same output, in the same order; no input array or object is
 * ever mutated.
 *
 * Scoping is strict: an observation is evaluated ONLY against the BOQ(s)
 * its own document is linked to via boq_document — never against an
 * unrelated project BOQ, and never at all when the document has no
 * boq_document link (never assumes project-level membership). An
 * observation with no usable mark/key contributes nothing — this module
 * never manufactures an identity from description, quantity, coordinates,
 * page number, or array position.
 */
export function generateCoverageSignals(input: GenerateCoverageSignalsInput): CoverageSignal[] {
  const { documents, boqs, boqDocumentLinks } = input;

  // boqId -> Set<normalizedKey> already covered by that BOQ's own review items.
  const boqKeys = new Map<string, Set<string>>();
  for (const { boqId, items } of boqs) {
    const keys = boqKeys.get(boqId) ?? new Set<string>();
    for (const item of items) {
      const key = norm(item.ai.key);
      if (key) keys.add(key);
    }
    boqKeys.set(boqId, keys);
  }

  // documentId -> Set<boqId> this document is scoped to via boq_document —
  // the authoritative scope boundary (PR #154's own reason for existing).
  const docBoqs = new Map<string, Set<string>>();
  for (const { boqId, documentId } of boqDocumentLinks) {
    if (!documentId) continue;
    const set = docBoqs.get(documentId) ?? new Set<string>();
    set.add(boqId);
    docBoqs.set(documentId, set);
  }

  const aggregates = new Map<string, Aggregate>();

  for (const { documentId, observations } of documents) {
    if (!documentId) continue; // never manufacture scope for an unresolved document
    const linkedBoqIds = docBoqs.get(documentId);
    if (!linkedBoqIds || linkedBoqIds.size === 0) continue; // no mapping -> no candidate

    for (const observation of observations) {
      const evidenceType = evidenceTypeFor(observation.observationType);
      if (!evidenceType) continue; // unsupported observation type — ignored, never broadened

      const normalizedKey = norm(observation.mark);
      if (!normalizedKey) continue; // no usable key — never manufacture one

      for (const boqId of linkedBoqIds) {
        if (boqKeys.get(boqId)?.has(normalizedKey)) continue; // a matching item exists — no gap

        const aggKey = `${boqId}¦${documentId}¦${normalizedKey}`;
        const existing = aggregates.get(aggKey);
        const agg: Aggregate = existing ?? {
          boqId, documentId, normalizedKey,
          evidenceTypes: new Set<CoverageEvidenceType>(),
          observations: [],
        };
        agg.evidenceTypes.add(evidenceType);
        agg.observations.push({ id: observation.id, mark: observation.mark ?? "" });
        if (!existing) aggregates.set(aggKey, agg);
      }
    }
  }

  const signals: CoverageSignal[] = [];
  for (const agg of aggregates.values()) {
    // Sort contributing observations by id so `mark`/observationIds never
    // depend on the order observations happened to be iterated in.
    const sortedObservations = [...agg.observations].sort((a, b) => a.id.localeCompare(b.id));
    const observationIds = sortedObservations.map((o) => o.id);
    const mark = sortedObservations[0].mark;
    const evidenceTypes = [...agg.evidenceTypes].sort();
    const signalKey = `coverage¦${agg.boqId}¦${agg.documentId}¦${agg.normalizedKey}`;
    signals.push({
      type: "POTENTIAL_GAP",
      boqId: agg.boqId,
      documentId: agg.documentId,
      normalizedKey: agg.normalizedKey,
      mark,
      evidenceTypes,
      observationIds,
      signalKey,
      reason: `Evidence for "${mark}" (${evidenceTypes.join(" + ")}) was found in this document, but no matching item exists in this BOQ.`,
    });
  }

  return signals.sort((a, b) => a.signalKey.localeCompare(b.signalKey));
}
