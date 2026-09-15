// AI ANALYSIS PREFLIGHT — pure computation, no I/O.
//
// Answers, honestly and deterministically, "what would Generate actually do
// right now?" — BEFORE any OpenAI call happens. Takes plain data (already
// fetched by the caller) so it's testable without a database or an edge
// runtime, and reused unmodified by both the ai-analysis edge function and
// its unit tests (see src/lib/ai/preflight.test.ts).
//
// Never claims a completeness it can't back up: DOCUMENT COMPLETENESS (does
// this project's upload set represent the FULL drawing register?) is
// unknowable from uploaded files alone — see completeness() below — and this
// module never invents a score for it.

export interface EligibleFile {
  documentId: string;
  documentRevisionId: string;
  filename: string;
  /** Null when the SHA-256 hasn't been computed yet — computeMissingHashes()
   *  in the edge function fills these in just-in-time before preflight runs
   *  its duplicate/already-analysed comparison, so in practice this is only
   *  null for a file the caller hasn't hashed yet. */
  contentHash: string | null;
  byteSize: number;
}

export type LedgerStatus = "PROCESSING" | "SUCCEEDED" | "FAILED";

export interface LedgerRow {
  contentHash: string;
  status: LedgerStatus;
  documentId: string | null;
  filenameAtTimeOfAnalysis: string | null;
  analysisRunId: string | null;
}

export interface PreflightFileSummary {
  documentId: string;
  documentRevisionId: string;
  filename: string;
  contentHash: string;
}

export interface PreflightResult {
  totalProjectFiles: number;
  totalEligibleDrawingFiles: number;
  /** Eligible PDFs whose content hash isn't computed yet — these cannot be
   *  classified as new/duplicate/already-analysed until hashed. */
  filesPendingHash: number;
  alreadyAnalysed: PreflightFileSummary[];
  newEligible: PreflightFileSummary[];
  /** Claimed by another in-flight request right now — never re-sent. */
  inFlight: PreflightFileSummary[];
  /** Two or more eligible files that resolve to the IDENTICAL content hash —
   *  informational: only one of them will ever actually be sent. */
  duplicateGroups: PreflightFileSummary[][];
  /** What Generate would actually send if clicked right now, given
   *  `forceReanalyse`. Never includes an inFlight file (that would be a
   *  double-send) and never includes a bare duplicate of another file already
   *  in this same list (same hash sent once, not once per document). */
  willSend: PreflightFileSummary[];
  /** True only when every eligible file's hash is known AND there is a real
   *  document register to compare against (the caller sets this from
   *  whatever it can determine — this module never invents one from upload
   *  counts alone; see docs/ai-analysis-pipeline.md "Completeness"). */
  documentCompletenessKnown: boolean;
  contractVersion: string;
  provider: string;
  model: string;
}

/**
 * Compute the preflight view. `files` is every eligible-by-mime-type drawing
 * revision found for the project; `ledger` is every analysis_run_source row
 * for this project already matching (contractVersion, provider, model) — a
 * row for a DIFFERENT contract/model never counts as "already analysed" here,
 * by design (see contract.ts).
 */
export function computePreflight(
  totalProjectFiles: number,
  files: EligibleFile[],
  ledger: LedgerRow[],
  opts: { contractVersion: string; provider: string; model: string; forceReanalyse: boolean },
): PreflightResult {
  const hashed = files.filter((f): f is EligibleFile & { contentHash: string } => f.contentHash != null);
  const filesPendingHash = files.length - hashed.length;

  const byHash = new Map<string, LedgerRow>();
  for (const row of ledger) {
    // A SUCCEEDED row always wins over a stale PROCESSING/FAILED one for the
    // same hash if somehow both exist (shouldn't, given the unique
    // constraint, but this stays correct even if the caller passes history).
    const existing = byHash.get(row.contentHash);
    if (!existing || row.status === "SUCCEEDED") byHash.set(row.contentHash, row);
  }

  const toSummary = (f: EligibleFile & { contentHash: string }): PreflightFileSummary => ({
    documentId: f.documentId,
    documentRevisionId: f.documentRevisionId,
    filename: f.filename,
    contentHash: f.contentHash,
  });

  const alreadyAnalysed: PreflightFileSummary[] = [];
  const inFlight: PreflightFileSummary[] = [];
  const candidateNew: (EligibleFile & { contentHash: string })[] = [];

  for (const f of hashed) {
    const row = byHash.get(f.contentHash);
    if (row?.status === "SUCCEEDED") alreadyAnalysed.push(toSummary(f));
    else if (row?.status === "PROCESSING") inFlight.push(toSummary(f));
    else candidateNew.push(f); // no row, or a FAILED row (retryable)
  }

  // Duplicate groups among files that would otherwise be sent — dedupe by
  // hash so identical bytes uploaded under two names/folders/document ids are
  // sent to OpenAI at most once.
  const groups = new Map<string, (EligibleFile & { contentHash: string })[]>();
  for (const f of candidateNew) {
    const g = groups.get(f.contentHash) ?? [];
    g.push(f);
    groups.set(f.contentHash, g);
  }
  const duplicateGroups = [...groups.values()].filter((g) => g.length > 1).map((g) => g.map(toSummary));

  const newEligible = candidateNew.map(toSummary);
  const oneOfEachHash = [...groups.values()].map((g) => toSummary(g[0]));

  const willSend = opts.forceReanalyse
    // Force re-analyse (admin-only, see modelConfig/index.ts gating): resend
    // everything not currently in flight, one send per distinct content hash.
    ? [...new Map(hashed.filter((f) => !inFlight.some((x) => x.contentHash === f.contentHash))
        .map((f) => [f.contentHash, toSummary(f)])).values()]
    : oneOfEachHash;

  return {
    totalProjectFiles,
    totalEligibleDrawingFiles: files.length,
    filesPendingHash,
    alreadyAnalysed,
    newEligible,
    inFlight,
    duplicateGroups,
    willSend,
    documentCompletenessKnown: false,
    contractVersion: opts.contractVersion,
    provider: opts.provider,
    model: opts.model,
  };
}
