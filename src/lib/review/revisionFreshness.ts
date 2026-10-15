// ANALYSIS REVISION FRESHNESS — is the drawing revision an analysis run read
// still the document's current revision?
//
// The one durable record of "which revision was analysed" is
// analysis_run_source.document_revision_id, written by the ai-analysis edge
// function on the claim for the exact revision whose bytes it sent (and
// stamped with analysis_run_id when the run succeeds). Nothing else records
// it: a json_import run creates no claim rows, and boq_document.analyzed_
// revision_id is a per-BOQ link that is never updated after a re-analysis.
//
// Every document a run's evidence is attributed to is assessed on its own —
// one stale or unknown source is never hidden by another valid one:
//   current     — exactly one analysed revision is recorded and it is still
//                 the document's current revision
//   superseded  — the recorded analysed revision is no longer current
//   unknown     — no usable record of the analysed revision (json_import, a
//                 claim whose revision is missing or owned by another
//                 document). Never inferred from timestamps or from "current".
//   conflicting — the run's claims name more than one revision
//   missing     — a claimed document no longer exists in this project
// Apply is allowed only when every assessed source is `current`.
//
// A run that references no project document at all makes no provenance claim,
// so it has nothing to be stale against (Apply writes no source columns for
// it — see applyReview.ts's sourcePatchFor).

import { db } from "@/lib/untypedDb";
import type { StoredDrawing } from "./documentResolve";
import type { LocationObservation } from "./locationObservations";

export type SourceFreshnessState = "current" | "superseded" | "unknown" | "conflicting" | "missing";

export interface RevisionRef {
  id: string;
  label: string | null;
  filePath: string | null;
  originalFilename: string | null;
  pageCount: number | null;
  pageTitles: Record<string, string> | null;
}

export interface SourceFreshness {
  documentId: string;
  documentName: string | null;
  state: SourceFreshnessState;
  /** The revision the run read — only when exactly one valid one is recorded. */
  analyzedRevision: RevisionRef | null;
  /** The document's current revision at assessment time (null if it has none or is gone). */
  currentRevision: RevisionRef | null;
}

export interface RunFreshness {
  runId: string;
  sources: SourceFreshness[];
  /** True when any source is not `current`. */
  applyBlocked: boolean;
}

/** Thrown by applyReviewPlan before any write when a run's sources are not all current. */
export class AnalysisRevisionBlockedError extends Error {
  readonly freshness: RunFreshness;
  constructor(message: string, freshness: RunFreshness) {
    super(message);
    this.name = "AnalysisRevisionBlockedError";
    this.freshness = freshness;
  }
}

export interface ClaimRow { document_id: string; document_revision_id: string | null; status: string }
export interface DocumentRow { id: string; name: string | null; current_revision_id: string | null }
export interface RevisionRow {
  id: string; document_id: string; label?: string | null; file_path?: string | null;
  original_filename?: string | null; page_count?: number | null; page_titles?: Record<string, string> | null;
}

function toRef(r: RevisionRow): RevisionRef {
  return {
    id: r.id, label: r.label ?? null, filePath: r.file_path ?? null, originalFilename: r.original_filename ?? null,
    pageCount: r.page_count ?? null, pageTitles: r.page_titles ?? null,
  };
}

/**
 * Pure classification. `claims` are the run's analysis_run_source rows;
 * `documents` are this project's documents (anything not listed is not in
 * the project); `revisions` are the document_revision rows for the assessed
 * documents (ownership is checked against document_id, never trusted on id
 * alone). `referencedDocumentIds` are the other documents the run's evidence
 * is attributed to (item sources, the run's re-linked drawing); ids that are
 * not project documents are ignored — nothing is written for them.
 */
export function classifyRunFreshness(args: {
  runId: string;
  claims: ClaimRow[];
  documents: DocumentRow[];
  revisions: RevisionRow[];
  referencedDocumentIds: Iterable<string>;
}): RunFreshness {
  const docById = new Map(args.documents.map((d) => [d.id, d]));
  const revById = new Map(args.revisions.map((r) => [r.id, r]));
  const owned = (revisionId: string | null | undefined, documentId: string) => {
    const r = revisionId ? revById.get(revisionId) : undefined;
    return r && r.document_id === documentId ? r : undefined;
  };

  const claimedRevisions = new Map<string, Set<string | null>>();
  for (const c of args.claims) {
    if (c.status !== "SUCCEEDED") continue;
    const set = claimedRevisions.get(c.document_id) ?? new Set<string | null>();
    set.add(c.document_revision_id ?? null);
    claimedRevisions.set(c.document_id, set);
  }

  const documentIds = new Set<string>(claimedRevisions.keys());
  for (const id of args.referencedDocumentIds) if (docById.has(id)) documentIds.add(id);

  const sources: SourceFreshness[] = [...documentIds].sort().map((documentId) => {
    const doc = docById.get(documentId);
    const current = doc ? owned(doc.current_revision_id, documentId) : undefined;
    const base = {
      documentId, documentName: doc?.name ?? null,
      currentRevision: current ? toRef(current) : null,
    };
    if (!doc) return { ...base, state: "missing" as const, analyzedRevision: null };
    const claimed = claimedRevisions.get(documentId);
    if (!claimed) return { ...base, state: "unknown" as const, analyzedRevision: null };
    if (claimed.size > 1) return { ...base, state: "conflicting" as const, analyzedRevision: null };
    const analyzed = owned([...claimed][0], documentId);
    if (!analyzed) return { ...base, state: "unknown" as const, analyzedRevision: null };
    const state = current && current.id === analyzed.id ? "current" as const : "superseded" as const;
    return { ...base, state, analyzedRevision: toRef(analyzed) };
  });

  return { runId: args.runId, sources, applyBlocked: sources.some((s) => s.state !== "current") };
}

/**
 * Load and classify a run's source freshness. Fails closed: any query error
 * is thrown, never treated as "fresh". `projectId` null means the BOQ has no
 * project, so no document can be verified as belonging to it.
 */
export async function assessRunFreshness(args: {
  runId: string;
  projectId: string | null;
  referencedDocumentIds: Iterable<string>;
}): Promise<RunFreshness> {
  const { data: claims, error: claimsError } = await db
    .from("analysis_run_source")
    .select("document_id, document_revision_id, status")
    .eq("analysis_run_id", args.runId);
  if (claimsError) throw claimsError;

  let documents: DocumentRow[] = [];
  if (args.projectId) {
    const { data, error } = await db
      .from("project_document")
      .select("id, name, current_revision_id")
      .eq("project_id", args.projectId);
    if (error) throw error;
    documents = (data ?? []) as DocumentRow[];
  }

  const claimRows = (claims ?? []) as ClaimRow[];
  const referenced = [...args.referencedDocumentIds];
  const docIds = new Set(documents.map((d) => d.id));
  const ofInterest = [...new Set([...claimRows.map((c) => c.document_id), ...referenced])].filter((id) => docIds.has(id));

  let revisions: RevisionRow[] = [];
  if (ofInterest.length) {
    const { data, error } = await db
      .from("document_revision")
      .select("id, document_id, label, file_path, original_filename, page_count, page_titles")
      .in("document_id", ofInterest);
    if (error) throw error;
    revisions = (data ?? []) as RevisionRow[];
  }

  return classifyRunFreshness({ runId: args.runId, claims: claimRows, documents, revisions, referencedDocumentIds: referenced });
}

const nameOf = (s: SourceFreshness) => s.documentName ?? "A source document";
const labelOf = (r: RevisionRef | null) => r?.label ?? "an unlabelled revision";

/** One plain sentence per blocked source, in the order assessed. */
export function describeSourceFreshness(s: SourceFreshness): string {
  switch (s.state) {
    case "current":
      return `${nameOf(s)}: analysed ${labelOf(s.analyzedRevision)}, which is still current.`;
    case "superseded":
      return s.currentRevision
        ? `${nameOf(s)}: this analysis read ${labelOf(s.analyzedRevision)}, but the current revision is now ${labelOf(s.currentRevision)}.`
        : `${nameOf(s)}: this analysis read ${labelOf(s.analyzedRevision)}, which is no longer the current revision.`;
    case "unknown":
      return `${nameOf(s)}: there is no record of which revision this analysis read (for example, an analysis imported as JSON). It cannot be attributed to the current revision.`;
    case "conflicting":
      return `${nameOf(s)}: this analysis has conflicting records of which revision it read.`;
    case "missing":
      return "A document this analysis read no longer exists in this project.";
  }
}

export function freshnessBlockMessage(f: RunFreshness): string {
  const blocked = f.sources.filter((s) => s.state !== "current");
  return `Apply is blocked until the analysis matches the current drawings. ${blocked.map(describeSourceFreshness).join(" ")} Re-analyse the current revision to continue.`;
}

/**
 * Throw (before any write) unless every source is current and, when the
 * caller supplies the snapshot it showed the reviewer, every source's current
 * revision is still the one in that snapshot.
 */
export function assertApplyAllowed(f: RunFreshness, expectedCurrentRevisionIds?: Record<string, string | null>): void {
  if (f.applyBlocked) throw new AnalysisRevisionBlockedError(freshnessBlockMessage(f), f);
  if (!expectedCurrentRevisionIds) return;
  const changed = f.sources.filter((s) =>
    !(s.documentId in expectedCurrentRevisionIds) || expectedCurrentRevisionIds[s.documentId] !== (s.currentRevision?.id ?? null));
  if (changed.length) {
    throw new AnalysisRevisionBlockedError(
      `The source drawings changed after this review was checked (${changed.map(nameOf).join(", ")}). Nothing was applied. Reload the review and check again.`,
      f,
    );
  }
}

/** The snapshot of current revisions a reviewer saw — passed back to Apply. */
export function currentRevisionSnapshot(f: RunFreshness): Record<string, string | null> {
  return Object.fromEntries(f.sources.map((s) => [s.documentId, s.currentRevision?.id ?? null]));
}

/**
 * The drawings the evidence viewer should render: a superseded source shows
 * the revision the analysis actually read (its stored file, or no file — the
 * viewer then falls back to its page plot — never the newer drawing). Every
 * other document is returned unchanged; for `unknown`/`conflicting` sources
 * the caller must label the provenance (see evidenceProvenanceNotice).
 */
export function drawingsAsAnalyzed(drawings: StoredDrawing[], f: RunFreshness | undefined): StoredDrawing[] {
  if (!f) return drawings;
  const superseded = new Map(f.sources.filter((s) => s.state === "superseded" && s.analyzedRevision).map((s) => [s.documentId, s.analyzedRevision!]));
  if (superseded.size === 0) return drawings;
  return drawings.map((d) => {
    const r = superseded.get(d.documentId);
    return r ? { ...d, filePath: r.filePath, originalFilename: r.originalFilename, pageCount: r.pageCount, pageTitles: r.pageTitles } : d;
  });
}

/**
 * True only when `documentId`'s provenance is confirmed current: the
 * freshness check has completed and the analysed revision is still the
 * document's current revision. Only then is the displayed drawing the same
 * revision that LOCATION runs and Identify / Find Similar (which read the
 * document's CURRENT revision server-side) refer to. Superseded, unknown,
 * conflicting, missing, still-checking and failed-check all return false.
 */
export function provenanceConfirmedCurrent(documentId: string | null | undefined, f: RunFreshness | undefined): boolean {
  if (!documentId || !f) return false;
  return f.sources.some((s) => s.documentId === documentId && s.state === "current");
}

/**
 * The LOCATION observations that may be drawn on `documentId` as displayed:
 * only when its provenance is confirmed current, and then only observations
 * pinned (analysis_observation.document_id/revision_id) to that same
 * document and to exactly the revision on screen. An observation from
 * another revision — e.g. the latest LOCATION run read an older one — or
 * with no pinned revision (deleted since, or never loaded) is unknown here
 * and dropped, never attributed to the displayed revision.
 */
export function observationsForDisplayedRevision(
  observations: LocationObservation[], documentId: string | null | undefined, f: RunFreshness | undefined,
): LocationObservation[] {
  if (!documentId || !provenanceConfirmedCurrent(documentId, f)) return [];
  const displayedRevisionId = f!.sources.find((s) => s.documentId === documentId)!.analyzedRevision!.id;
  return observations.filter((o) => o.documentId === documentId && o.revisionId === displayedRevisionId);
}

/** The provenance line shown above the evidence for one document, or null when there is nothing to qualify. */
export function evidenceProvenanceNotice(documentId: string | null | undefined, f: RunFreshness | undefined, checking: boolean): string | null {
  if (!documentId) return null;
  if (!f) return checking ? "Checking which revision this analysis read…" : "Source revision unknown — it could not be checked.";
  const s = f.sources.find((x) => x.documentId === documentId);
  if (!s || s.state === "current") return null;
  switch (s.state) {
    case "superseded":
      return `Showing ${labelOf(s.analyzedRevision)}, the revision this analysis read. The current revision is now ${s.currentRevision ? labelOf(s.currentRevision) : "a different one"}.`;
    case "unknown":
      return `Source revision unknown. This is the current drawing (${labelOf(s.currentRevision)}); the analysis may not have been made from it.`;
    case "conflicting":
      return `Source revision unknown (conflicting records). This is the current drawing (${labelOf(s.currentRevision)}); the analysis may not have been made from it.`;
    case "missing":
      return "The document this analysis read no longer exists.";
  }
}
