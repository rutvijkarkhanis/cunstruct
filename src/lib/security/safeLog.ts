// SAFE LOGGING — metadata only, never confidential content.
//
// A single, small place to emit operational log lines so that drawing contents,
// prompts, AI responses, signed URLs, tokens and API keys are NEVER written to
// the console / logs. It accepts a fixed, safe metadata shape and additionally
// scrubs any stray sensitive-looking keys before emitting.
//
// This is the logger the future AI boundary must use. It is intentionally tiny —
// not a logging framework.

export type LogStatus = "ok" | "error" | "denied" | "pending";

/** The ONLY fields a log line may carry. No free-form content. */
export interface SafeLogEvent {
  operation: string;                 // e.g. "analysis.request", "audit.import"
  status: LogStatus;
  projectId?: string | null;
  documentId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  correlationId?: string | null;
  /** A short, non-sensitive code — never a message containing content/PII. */
  code?: string | null;
}

// Keys that must never appear in a log payload, matched case-insensitively as a
// substring so `access_token`, `apiKey`, `signedUrl`, `promptText` etc. are all
// caught. Used to scrub accidental additions and to power tests.
export const FORBIDDEN_LOG_KEY_PATTERNS = [
  "token", "apikey", "api_key", "secret", "password", "authorization", "auth_header",
  "service_role", "servicerole", "signedurl", "signed_url", "presigned",
  "prompt", "response_body", "completion", "content", "drawing", "eval_json",
  "email", "phone", "address",
];

const isForbiddenKey = (key: string): boolean => {
  const k = key.toLowerCase();
  return FORBIDDEN_LOG_KEY_PATTERNS.some((p) => k.includes(p));
};

/**
 * Reduce any object to log-safe metadata: drop forbidden keys entirely and keep
 * only primitive scalar values (objects/arrays are summarised to their type, so
 * nested content can't leak). Exported for reuse and testing.
 */
export function redactForLog(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (isForbiddenKey(key)) continue;
    if (value == null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else {
      out[key] = Array.isArray(value) ? `[array:${value.length}]` : "[object]";
    }
  }
  return out;
}

/** Build the safe metadata object for an event (no content, no PII, no secrets). */
export function toSafeMetadata(event: SafeLogEvent): Record<string, unknown> {
  return redactForLog({
    operation: event.operation,
    status: event.status,
    projectId: event.projectId ?? undefined,
    documentId: event.documentId ?? undefined,
    resourceType: event.resourceType ?? undefined,
    resourceId: event.resourceId ?? undefined,
    correlationId: event.correlationId ?? undefined,
    code: event.code ?? undefined,
    ts: new Date().toISOString(),
  });
}

/** A random, non-guessable correlation id for tying related log lines together. */
export function newCorrelationId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `cor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Emit a safe log line. Only metadata is ever printed. */
export function safeLog(event: SafeLogEvent): void {
  const meta = toSafeMetadata(event);
  // Console is the only sink today; a future server sink can consume the same shape.
  if (event.status === "error" || event.status === "denied") {
    console.warn("[cunstruct]", meta);
  } else {
    console.info("[cunstruct]", meta);
  }
}
