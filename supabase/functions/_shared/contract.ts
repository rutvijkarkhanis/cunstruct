// ANALYSIS CONTRACT VERSION — the exact prompt + schema + extraction-rule
// version an AI-generated analysis_run was produced under.
//
// Distinct from `schema_version` (the JSON *shape*, "cunstruct.analysis.v1"):
// this identifies the *behaviour* — the prompt wording, which fields are
// requested, how conflicts/candidates are handled. Bump it whenever a change
// to the prompt or extraction rules is significant enough that a file
// analysed under the old contract should be considered "not yet analysed
// under the current one" (see docs/ai-analysis-pipeline.md).
//
// This is the second half of the compound identity that decides whether a
// file needs to be (re-)sent to OpenAI: (project, content_hash) says WHICH
// bytes; (contract_version, provider, model) says UNDER WHAT RULES. Bumping
// this version is how a deliberate prompt/schema/model upgrade makes
// previously-analysed files eligible again WITHOUT calling it "force
// re-analyse" — a normal Generate simply sees them as new work.
export const ANALYSIS_CONTRACT_VERSION = "cunstruct-openai-v1.0.0";

export const DEFAULT_PROVIDER = "openai";

// ANALYSIS MODE — which kind of analysis a run represents. Phase 3 plumbing
// only: BOQ is today's existing extraction, unchanged. LOCATION and
// BOQ_AND_LOCATION are accepted and persisted end-to-end (their own
// analysis_run/analysis_run_source identity, never colliding with a BOQ run
// over the same file) but do NOT yet run any different extraction — that is
// later phases' work. Never expose LOCATION/BOQ_AND_LOCATION as a user-facing
// control until that extraction exists.
export const ANALYSIS_MODES = ["BOQ", "LOCATION", "BOQ_AND_LOCATION"] as const;
export type AnalysisMode = (typeof ANALYSIS_MODES)[number];
export const DEFAULT_ANALYSIS_MODE: AnalysisMode = "BOQ";

/**
 * Resolve a client-supplied `mode` string to a real AnalysisMode, or `null`
 * if it names something that isn't one of ANALYSIS_MODES. `undefined`/`null`
 * (not specified at all) resolves to DEFAULT_ANALYSIS_MODE — the exact
 * backward-compatibility rule: an omitted mode must behave like today's BOQ
 * pipeline. An explicit-but-unrecognized string is never silently coerced to
 * the default (that would hide a caller's mistake); the edge function must
 * reject it with a 400 instead of resolving it here.
 */
export function resolveAnalysisMode(requested: string | undefined | null): AnalysisMode | null {
  if (requested == null) return DEFAULT_ANALYSIS_MODE;
  return (ANALYSIS_MODES as readonly string[]).includes(requested) ? (requested as AnalysisMode) : null;
}
