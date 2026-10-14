// OBSERVATION SOURCE RESOLUTION — Phase 4's document/revision pinning
// ("Layer B" in the Phase 4 design review). Pure; no I/O. Determines exactly
// which claimed file (of the ones actually sent to OpenAI in this `generate`
// call) an observation's evidence belongs to, and never guesses:
//
//   - EXACTLY ONE claimed file -> that file, unconditionally. The caller
//     already knows with certainty which document/revision this batch was,
//     independent of anything the model says (see below) — this is the ONE
//     case where the model's own source.documentId/document is never
//     authoritative enough to override or reject the observation.
//   - Two or more claimed files, documentId given -> must match exactly one
//     claimed file, or rejected.
//   - Two or more claimed files, only a filename given -> resolved by exact
//     filename match; ambiguous (two claimed files share it) or no match ->
//     rejected.
//   - Two or more claimed files, neither given -> rejected; a multi-file
//     batch with no document attribution is never assigned to an arbitrary
//     file.
//
// Why the single-file case is unconditional: the model is never told
// Cunstruct's internal document_id (only filename + bytes are uploaded — see
// generateAnalysisViaOpenAI), so a model-supplied source.documentId in a
// single-document LOCATION request (the only kind DocumentLocationExtraction
// ever sends — always exactly one documentId) can be absent, a
// misremembered filename, or an invented placeholder, but can NEVER change
// which document was actually analysed: there was only ever one candidate.
// Silently rejecting a real, structurally valid observation over a mismatch
// that carries no actual ambiguity is a worse failure than trusting the one
// file the caller itself claimed. This does NOT extend to a multi-file
// batch, where a wrong/absent reference IS a genuine ambiguity — that path
// is completely unchanged.
//
// document_id/revision_id are resolved together, from the SAME claimed-file
// record — never two independent lookups that could disagree (see the Phase
// 4 design review's revision-pinning invariants).

export interface ClaimedFile {
  documentId: string;
  documentRevisionId: string;
  filename: string;
}

export interface ResolvedObservationSource {
  documentId: string;
  revisionId: string;
}

export function resolveObservationSource(
  source: { documentId?: string; document?: string },
  claimedFiles: ClaimedFile[],
): ResolvedObservationSource | null {
  // Single-file batch: deterministic, regardless of source.documentId/document
  // (present, absent, or wrong) — see this file's header comment.
  if (claimedFiles.length === 1) {
    return { documentId: claimedFiles[0].documentId, revisionId: claimedFiles[0].documentRevisionId };
  }

  if (source.documentId) {
    const match = claimedFiles.find((f) => f.documentId === source.documentId);
    return match ? { documentId: match.documentId, revisionId: match.documentRevisionId } : null;
  }

  if (source.document) {
    const matches = claimedFiles.filter((f) => f.filename === source.document);
    return matches.length === 1 ? { documentId: matches[0].documentId, revisionId: matches[0].documentRevisionId } : null;
  }

  return null;
}

/** An observation that could not be pinned to exactly one claimed file — it
 *  is never persisted, but the caller can report it instead of losing it. */
export interface UnpinnedObservation {
  /** 0-based position among the parsed (accepted) observations. */
  index: number;
  observationType: string;
  mark?: string;
  /** What the model named as its source, for diagnosis. */
  claimedDocumentId?: string;
  claimedDocument?: string;
}

/** resolveObservationSource() over a whole batch, keeping the ones that
 *  resolve and reporting the ones that don't (multi-file batches only — a
 *  single claimed file always resolves). */
export function pinObservations<T extends { observationType: string; mark?: string; source: { documentId?: string; document?: string } }>(
  observations: T[],
  claimedFiles: ClaimedFile[],
): { pinned: { documentId: string; revisionId: string; obs: T }[]; unpinned: UnpinnedObservation[] } {
  const pinned: { documentId: string; revisionId: string; obs: T }[] = [];
  const unpinned: UnpinnedObservation[] = [];
  observations.forEach((obs, index) => {
    const resolved = resolveObservationSource({ documentId: obs.source.documentId, document: obs.source.document }, claimedFiles);
    if (resolved) pinned.push({ documentId: resolved.documentId, revisionId: resolved.revisionId, obs });
    else unpinned.push({
      index, observationType: obs.observationType, mark: obs.mark,
      claimedDocumentId: obs.source.documentId, claimedDocument: obs.source.document,
    });
  });
  return { pinned, unpinned };
}
