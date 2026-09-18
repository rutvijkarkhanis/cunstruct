// OBSERVATION SOURCE RESOLUTION — Phase 4's document/revision pinning
// ("Layer B" in the Phase 4 design review). Pure; no I/O. Determines exactly
// which claimed file (of the ones actually sent to OpenAI in this `generate`
// call) an observation's evidence belongs to, and never guesses:
//
//   - documentId given -> must match exactly one claimed file, or rejected.
//   - only a filename given -> resolved by exact filename match; ambiguous
//     (two claimed files share it) or no match -> rejected.
//   - neither given -> defaults to the single claimed file ONLY when the
//     batch claimed exactly one file; a multi-file batch with no document
//     attribution is rejected rather than assigned to an arbitrary file.
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
  if (source.documentId) {
    const match = claimedFiles.find((f) => f.documentId === source.documentId);
    return match ? { documentId: match.documentId, revisionId: match.documentRevisionId } : null;
  }

  if (source.document) {
    const matches = claimedFiles.filter((f) => f.filename === source.document);
    return matches.length === 1 ? { documentId: matches[0].documentId, revisionId: matches[0].documentRevisionId } : null;
  }

  if (claimedFiles.length === 1) {
    return { documentId: claimedFiles[0].documentId, revisionId: claimedFiles[0].documentRevisionId };
  }
  return null;
}
