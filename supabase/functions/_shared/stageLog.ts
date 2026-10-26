// STAGE LOGGING for ai-analysis — one structured line per failure, naming the
// stage that failed, so a 5xx in the function logs says where and why without
// anyone needing to reproduce it. Never logs headers, tokens, keys, prompts,
// document contents or response bodies: only the stage, the action/mode, ids
// the caller already sent, an HTTP status and a sanitized, truncated message.
// Pure (no Deno APIs) so it is unit-tested with the rest of _shared.

export type AnalysisStage =
  | "parse_request" | "auth" | "project" | "load_files" | "ledger" | "preflight"
  | "claim" | "download" | "openai" | "validate_response" | "persist_run" | "persist_items" | "finalize"
  | "identify" | "find_similar";

const MAX_MESSAGE = 300;

/** Removes anything credential-shaped and truncates. Applied to every message logged. */
export function sanitizeForLog(raw: unknown): string {
  const text = raw instanceof Error ? `${raw.name}: ${raw.message}` : String(raw ?? "");
  return text
    .replace(/bearer\s+[\w.~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[\w-]{8,}/g, "[redacted-key]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted-jwt]")
    .replace(/((?:api[_-]?key|apikey|token|secret|password|authorization)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE);
}

export interface StageLogEntry {
  fn: "ai-analysis";
  level: "error";
  requestId: string;
  stage: AnalysisStage;
  action?: string;
  mode?: string;
  projectId?: string;
  boqId?: string | null;
  status?: number;
  message: string;
}

/** Caller-supplied short fields (action, mode, ids) — sanitized and capped, so a
 *  crafted request cannot write arbitrary text into the logs. */
const shortField = (v: string | null | undefined, max = 64) => (v == null ? v : sanitizeForLog(v).slice(0, max));

export function stageLogEntry(args: Omit<StageLogEntry, "fn" | "level" | "message"> & { error: unknown }): StageLogEntry {
  const { error, requestId, action, mode, projectId, boqId, ...rest } = args;
  return {
    fn: "ai-analysis", level: "error", ...rest,
    requestId: shortField(requestId, 100)!,
    ...(action !== undefined ? { action: shortField(action) as string } : {}),
    ...(mode !== undefined ? { mode: shortField(mode, 32) as string } : {}),
    ...(projectId !== undefined ? { projectId: shortField(projectId) as string } : {}),
    ...(boqId !== undefined ? { boqId: shortField(boqId) } : {}),
    message: sanitizeForLog(error),
  };
}

/** OpenAI's own short error identifiers (e.g. "insufficient_quota",
 *  "invalid_api_key", "model_not_found") — safe to log and show: a fixed
 *  vocabulary, never free text. Anything else is dropped. */
export function openAiErrorCode(body: unknown): string | null {
  const e = (body as { error?: { code?: unknown; type?: unknown } } | null)?.error;
  for (const v of [e?.code, e?.type]) {
    if (typeof v === "string" && /^[a-z0-9_.-]{1,64}$/i.test(v)) return v;
  }
  return null;
}
