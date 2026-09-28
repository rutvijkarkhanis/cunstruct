// LOCATION DIAGNOSTIC INSTRUMENTATION — TEMPORARY, DIAGNOSTIC-ONLY.
//
// Exists to answer exactly one open question from the LOCATION recall
// investigation: on a real, dense-drawing production run, does (A) the model
// itself return only a handful of observations, (B) parseObservationsV1
// silently drop observations the model DID return, (C) the OpenAI response
// come back incomplete/truncated, or (D) does the model's output survive
// intact, meaning the remaining gap is elsewhere? The prior retrospective
// investigation of Runs 1-3 could not answer this because raw OpenAI output
// and completion status were never captured for any of them.
//
// This module is deliberately NOT wired into normal LOCATION behavior — it
// is only read from ai-analysis/index.ts when LOCATION_DIAGNOSTIC_MODE is
// explicitly enabled (a server-side-only env var, never a client-supplied
// field). It never mutates, filters, or re-validates anything: every value
// it reports is already computed by the REAL, unmodified
// generateAnalysisViaOpenAI()/parseObservationsV1() calls. This is purely an
// observer over data that already exists, summarizing it for a log line.
//
// Deliberately does NOT capture the full raw JSON text or any free-text
// field (location_text, attributes.*, evidence bbox/label) — those can carry
// project-specific drawing content, and the diagnostic question above never
// needed them. Only short identity fields (mark, scope_hint — typically a
// few words, e.g. "W1", "Ground Floor") and structural counts are captured,
// which is sufficient to determine raw observation count and raw -> parsed
// losses without widening what a single diagnostic run writes to the
// function's logs beyond what's actually needed.
//
// Intended to be removed once one real diagnostic run has been captured and
// analyzed — not a permanent production feature. See the LOCATION recall
// investigation thread for full context.

/** Identity/shape summary of ONE observation exactly as the model returned
 *  it, before parseObservationsV1 touches anything. */
export interface RawObservationSummary {
  index: number;
  mark: string | null;
  observationType: string | null;
  scopeHint: string | null;
  evidenceCompleteness: string | null;
  evidenceCount: number;
}

export interface DroppedObservationSummary extends RawObservationSummary {
  /** The EXACT warning text parseObservationsV1 (observationSchemaV1.ts)
   *  already produced for this entry — never invented. If a raw entry is
   *  missing from the parsed output with no correlating warning, it is
   *  reported separately (see LocationDiagnosticReport.reconciliation),
   *  never assigned a guessed reason. */
  dropReason: string;
}

export interface LocationDiagnosticOpenAiInfo {
  model: string;
  status: string | null;
  incompleteDetails: unknown;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LocationDiagnosticReport {
  openai: LocationDiagnosticOpenAiInfo;
  rawObservationCount: number;
  rawObservations: RawObservationSummary[];
  rawLimitedCount: number;
  rawNonLimitedCount: number;
  parsedObservationCount: number;
  droppedObservations: DroppedObservationSummary[];
  /** Sanity check: rawObservationCount - droppedObservations.length SHOULD
   *  equal parsedObservationCount. A mismatch means either this diagnostic's
   *  own (deliberately separate, non-validating) raw extraction diverged
   *  from the real parser, or a drop happened for a reason this diagnostic
   *  doesn't yet recognize — reported explicitly rather than assumed away. */
  reconciliation: { expectedSurvivorCount: number; actualParsedCount: number; consistent: boolean };
}

// The exact, literal substrings parseObservationsV1 (observationSchemaV1.ts)
// uses in its own warnings when it drops a WHOLE observation. Copied here
// only to RECOGNIZE an existing warning, never to reimplement the check
// itself — if that file's wording ever changes, this (temporary, to-be-
// removed) diagnostic simply stops recognizing the reason rather than
// reporting a wrong one; it fails toward "unknown", never toward a guess.
const OBSERVATION_DROP_MARKERS = [
  "missing or unrecognized observation_type",
  "no valid evidence and evidence_completeness is not LIMITED",
];

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** Best-effort, PURELY DIAGNOSTIC extraction of the raw "observations" array
 *  from the model's own JSON text — deliberately a SEPARATE, simpler read
 *  than parseObservationsV1 (which validates/normalizes/drops), so it can
 *  show what the model said BEFORE any of that happens. Never throws:
 *  malformed/unexpected JSON yields an empty list rather than breaking the
 *  real generate() flow this is attached to. */
export function extractRawObservations(rawJson: string): RawObservationSummary[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return [];
  }
  const obj = asRecord(parsed);
  const arr = Array.isArray(parsed) ? parsed : Array.isArray(obj.observations) ? obj.observations : [];
  return arr.map((raw, index) => {
    const o = asRecord(raw);
    const source = asRecord(o.source);
    const evidence = source.evidence;
    return {
      index,
      mark: str(o.mark),
      observationType: str(o.observation_type ?? o.observationType),
      scopeHint: str(o.scope_hint ?? o.scopeHint),
      evidenceCompleteness: str(o.evidence_completeness ?? o.evidenceCompleteness),
      evidenceCount: Array.isArray(evidence) ? evidence.length : 0,
    };
  });
}

/** Finds the EXACT warning parseObservationsV1 already produced for the raw
 *  observation at `index`, if it was dropped entirely (not just pruned of
 *  one bad evidence box — see OBSERVATION_DROP_MARKERS). Never invents a
 *  reason: returns null when no matching warning exists, even if the entry
 *  is genuinely missing from the parsed output for some other cause. */
export function findObservationDropReason(index: number, parseWarnings: string[]): string | null {
  const label = `"observation ${index + 1}":`;
  const hit = parseWarnings.find(
    (w) => w.startsWith(label) && OBSERVATION_DROP_MARKERS.some((marker) => w.includes(marker)),
  );
  return hit ?? null;
}

/** Assembles the full diagnostic report from data the real pipeline already
 *  computed. Pure — never calls OpenAI, never re-runs validation, never
 *  touches the database. */
export function buildLocationDiagnosticReport(
  openai: LocationDiagnosticOpenAiInfo,
  rawJson: string,
  parseWarnings: string[],
  parsedObservationCount: number,
): LocationDiagnosticReport {
  const rawObservations = extractRawObservations(rawJson);
  const droppedObservations: DroppedObservationSummary[] = [];
  for (const raw of rawObservations) {
    const dropReason = findObservationDropReason(raw.index, parseWarnings);
    if (dropReason) droppedObservations.push({ ...raw, dropReason });
  }
  const expectedSurvivorCount = rawObservations.length - droppedObservations.length;
  return {
    openai,
    rawObservationCount: rawObservations.length,
    rawObservations,
    rawLimitedCount: rawObservations.filter((o) => o.evidenceCompleteness === "LIMITED").length,
    rawNonLimitedCount: rawObservations.filter((o) => o.evidenceCompleteness !== "LIMITED").length,
    parsedObservationCount,
    droppedObservations,
    reconciliation: {
      expectedSurvivorCount,
      actualParsedCount: parsedObservationCount,
      consistent: expectedSurvivorCount === parsedObservationCount,
    },
  };
}

/** The exact, greppable log-line prefix an operator should search their
 *  Supabase Edge Function logs for after running ONE LOCATION generate call
 *  with LOCATION_DIAGNOSTIC_MODE enabled. */
export const LOCATION_DIAGNOSTIC_LOG_PREFIX = "[LOCATION_DIAGNOSTIC]";

/** A second, minimal log emitted after persistence, correlated to the report
 *  above only by both appearing in the same function invocation's logs
 *  (there is no shared request id to key them by more precisely without a
 *  larger change than this diagnostic warrants). */
export interface LocationDiagnosticPersistenceInfo {
  handedToPersistenceCount: number;
  persistedCount: number;
  persistenceError: string | null;
}
