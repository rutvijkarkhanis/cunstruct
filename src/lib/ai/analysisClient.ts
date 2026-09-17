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

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("ai-analysis", { body });
  if (error) throw error;
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
