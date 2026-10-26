// AI ANALYSIS CLIENT — thin browser wrapper over the ai-analysis Edge
// Function. Contains NO business logic, NO model list, NO pricing — those
// live server-side only (supabase/functions/_shared/modelConfig.ts) so they
// never ship in this bundle. This module only shapes the request and types
// whatever the server chooses to send back.
//
// The server decides everything that matters (eligibility, claiming, cost,
// admin gating); this file exists so ImportGate doesn't call
// supabase.functions.invoke directly in three different places.

import { supabase } from "@/integrations/supabase/client";

/** Phase 3 plumbing only — LOCATION and BOQ_AND_LOCATION are accepted and
 *  persisted end-to-end but do not yet run any different extraction than
 *  BOQ. Do NOT expose either as a user-facing control until that extraction
 *  exists (see AiApiPanel.tsx, which never sets this field). */
export type AnalysisMode = "BOQ" | "LOCATION" | "BOQ_AND_LOCATION";

export interface PreflightSummary {
  /** Echoes what the request resolved to — the caller's own mode if given
   *  and valid, or "BOQ" if omitted. Never affects file counts below in this
   *  phase (identical eligibility computation for every mode). */
  mode: AnalysisMode;
  totalProjectFiles: number;
  totalEligibleDrawingFiles: number;
  filesPendingHash: number;
  alreadyAnalysedCount: number;
  newFilesCount: number;
  duplicateFilesSkipped: number;
  inFlightCount: number;
  allFilesAlreadyAnalysed: boolean;
  existingRunCount: number;
  latestRunId: string | null;
  documentCompleteness: "UNKNOWN";
  /** "Review files" — which files will/won't be sent, by name, grouped by
   *  their folder path (e.g. ["Floor 2"], or [] for Unfiled) for display.
   *  Not sensitive (no model/pricing/provider), so every user sees this, not
   *  just admins. The folder is presentation only — see docs/ai-analysis-pipeline.md. */
  willSendFiles: PreflightFile[];
  alreadyAnalysedFiles: PreflightFile[];
  duplicateGroups: PreflightFile[][];
}

export interface PreflightFile {
  documentId: string;
  filename: string;
  folderPath: string[];
}

/** Only ever present when the server has independently verified the caller
 *  is an admin — a client that merely enables SHOW_INTERNAL_AI_CONTROLS
 *  without being admin gets `internal: undefined` and must show nothing. */
export interface PreflightInternal {
  provider: string;
  model: string;
  contractVersion: string;
  forceReanalyse: boolean;
  /** A range, never a single "exact" number — see modelConfig.ts. */
  estimatedCost: { lowUsd: number; highUsd: number; basis: "page_count" | "mixed" };
}

export interface PreflightResponse {
  ok: boolean;
  error?: string;
  preflight?: PreflightSummary;
  internal?: PreflightInternal;
}

export interface GenerateResponse {
  ok: boolean;
  error?: string;
  generated: number;
  runId?: string;
  /** Present on every generate response — echoes the resolved mode, same as
   *  PreflightSummary.mode. */
  mode?: AnalysisMode;
  /** Present only for a LOCATION-mode generate — the number of observations
   *  persisted. Deliberately separate from itemCount (which means "BOQ
   *  review items produced" and is always 0 for a LOCATION run) rather than
   *  overloading it — see the Phase 4 design review. */
  observationCount?: number;
  /** LOCATION only: what the parser and pinning refused (never persisted). */
  observationDiagnostics?: {
    received: number; accepted: number; needsReview: number;
    rejected: { index: number; reason: string; mark?: string; page?: number; recoverable: boolean }[];
    droppedEvidenceBoxesFromKept: number;
    unpinned: { index: number; observationType: string; mark?: string }[];
  };
  itemCount?: number;
  allAlreadyAnalysed?: boolean;
  message?: string;
  latestRunId?: string | null;
  skipped?: { filename: string; reason: string }[];
  sourceCoverage?: string[];
}

export interface ModelConfigResponse {
  ok: boolean;
  error?: string;
  defaultModel?: string;
  models?: { id: string; label: string; pricing: { inputPerMillion: number; outputPerMillion: number } }[];
}

/** A non-2xx answer from ai-analysis, carrying the server's own reason. */
export class AnalysisRequestError extends Error {
  constructor(message: string, readonly status: number | null, readonly serverError: string | null) {
    super(message);
    this.name = "AnalysisRequestError";
  }
}

/** supabase-js reports every non-2xx as "Edge Function returned a non-2xx
 *  status code" and leaves the response in `error.context`. ai-analysis
 *  answers its own failures with `{ ok: false, error }` (e.g. "OpenAI
 *  analysis request failed (status 429)") — read that, so the screen shows
 *  why it failed instead of a generic line. Still an error: nothing here
 *  turns a failure into a result. */
export async function analysisRequestError(error: unknown): Promise<Error> {
  const res = (error as { context?: unknown })?.context;
  if (!(res instanceof Response)) return error instanceof Error ? error : new Error(String(error));
  let serverError: string | null = null;
  try {
    const body = await res.clone().json() as { error?: unknown };
    // Shown as is (the server already returns it), on one line and capped.
    if (typeof body?.error === "string" && body.error.trim()) serverError = body.error.replace(/\s+/g, " ").trim().slice(0, 300);
  } catch { /* not JSON (e.g. a gateway page): the status is all there is */ }
  const message = serverError
    ? `${serverError} (HTTP ${res.status})`
    : `The analysis service failed (HTTP ${res.status}) without saying why.`;
  return new AnalysisRequestError(message, res.status, serverError);
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("ai-analysis", { body });
  if (error) throw await analysisRequestError(error);
  return data as T;
}

export function fetchPreflight(args: {
  projectId: string; boqId?: string | null; model?: string; forceReanalyse?: boolean;
  /** Omit for today's exact existing behavior (resolves to "BOQ" server-side).
   *  Not yet wired into any UI control — see AnalysisMode's doc. */
  mode?: AnalysisMode;
}): Promise<PreflightResponse> {
  return invoke<PreflightResponse>({ action: "preflight", ...args });
}

export function generateAnalysis(args: {
  projectId: string; boqId?: string | null; documentIds?: string[]; model?: string; forceReanalyse?: boolean;
  /** Omit for today's exact existing behavior (resolves to "BOQ" server-side).
   *  Not yet wired into any UI control — see AnalysisMode's doc. */
  mode?: AnalysisMode;
}): Promise<GenerateResponse> {
  return invoke<GenerateResponse>({ action: "generate", ...args });
}

export function fetchModelConfig(): Promise<ModelConfigResponse> {
  return invoke<ModelConfigResponse>({ action: "model_config" });
}

/**
 * Translates a raw generate-analysis failure — a server error string from
 * `GenerateResponse.error`, or a thrown network/transport exception's message —
 * into one of three short, actionable messages a first-time contractor can act
 * on without knowing what OpenAI, a JSON schema, or an HTTP status code is.
 * Presentation only: the raw value itself is never altered or discarded here —
 * callers (AiApiPanel.tsx) still log it for developers before showing this in
 * its place, and nothing server-side changes what it returns or persists.
 */
export function friendlyGenerateError(raw: string | undefined | null): string {
  const msg = raw ?? "";
  // The edge function's own validation-failure text embeds parseAnalysisV1's
  // exact wording — checked before the generic "failed validation" case below
  // so a genuinely empty result reads as empty, not as a garbled response.
  if (/"?items"?\s*array is empty|no valid items found/i.test(msg)) {
    return "No BOQ quantities were found in these drawings. Try another drawing or run the analysis again.";
  }
  if (/failed validation|invalid json|expected an .?items.? array/i.test(msg)) {
    return "The analysis result couldn't be processed. Please try again.";
  }
  return "Analysis couldn't be completed. Please try again.";
}

/** Presentation-only gate — see docs/ai-analysis-pipeline.md. The real
 *  enforcement is the server's own admin check (a caller who isn't admin
 *  simply never receives a `preflight.internal` block, regardless of this
 *  flag). Never treat this flag as a security control. */
export function showInternalAiControls(): boolean {
  try {
    const flag = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SHOW_INTERNAL_AI_CONTROLS;
    return flag === "true" || flag === "1";
  } catch {
    return false;
  }
}
