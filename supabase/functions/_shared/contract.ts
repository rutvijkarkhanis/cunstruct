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
