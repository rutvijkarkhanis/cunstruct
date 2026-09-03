// AI BOUNDARY — provider-agnostic interface + minimum-data request builder.
//
// This is the SHAPE of the future server-side boundary between Cunstruct and
// whatever AI provider is chosen later. It contains NO provider, NO SDK, NO
// network call and NO model logic. Its job is to define:
//   * the abstract provider interfaces a future adapter must implement, and
//   * a deterministic request builder that enforces the minimum-data principle
//     and refuses to include forbidden data (credentials, other projects, DB
//     internals) in anything destined for a provider.
//
// Architecture this encodes (documented in docs/SECURITY.md):
//   Browser → Cunstruct server → AI provider     (never Browser → provider,
//   never AI provider → database). The provider receives ONLY the explicitly
//   selected inputs below and holds NO Cunstruct/Supabase credentials.

import { assertSendableToProvider, type DataKind } from "@/lib/security/dataClassification";

// ── Abstract provider interfaces (no implementation exists yet) ───────────────

/** An abstract, opaque provider label — resolved to a real provider server-side, later. */
export type ProviderId = string;

export interface AIProviderRequest {
  /** The operation the provider is asked to perform. */
  operation: "analysis" | "audit";
  /** Abstract provider + model labels; never a key or endpoint. */
  provider?: ProviderId;
  model?: string;
  /** The MINIMAL, explicitly-selected inputs (see buildProviderRequest). */
  inputs: MinimalInputs;
  /** Correlation id for the audit trail. */
  correlationId: string;
}

export interface AIProviderResponse {
  /** Raw structured JSON string the provider returned (validated downstream). */
  json: string;
  provider?: ProviderId;
  model?: string;
}

/** A future analysis adapter (drawings → structured Analysis JSON) implements this. */
export interface AIAnalysisProvider {
  readonly id: ProviderId;
  analyze(request: AIProviderRequest): Promise<AIProviderResponse>;
}

/** A future audit adapter (BOQ + drawings → structured Audit JSON) implements this. */
export interface AIAuditProvider {
  readonly id: ProviderId;
  audit(request: AIProviderRequest): Promise<AIProviderResponse>;
}

// ── Minimum-data request building ─────────────────────────────────────────────

/**
 * The authorised scope for a request. A request is ALWAYS built from a project
 * the caller has already authorised server-side — never from a bare id or
 * external_key (those identify, they do not authorise). See docs/SECURITY.md.
 */
export interface AuthorizedProjectScope {
  projectId: string;
  aiProcessingEnabled: boolean;
}

/** One explicitly-selected input item destined for the provider. */
export interface SelectedInput {
  kind: DataKind;
  /** A stable reference (document id, boq line external_key, …) — NOT a secret. */
  ref: string;
  /** The minimal content for this item (text/measurements). Caller-selected. */
  content: string;
}

/** The minimal payload that may leave Cunstruct for a provider. */
export interface MinimalInputs {
  projectId: string;
  items: { kind: DataKind; ref: string; content: string }[];
}

// Keys / substrings that must NEVER appear inside a provider payload. If any input
// content or ref contains these, the build is refused — defence-in-depth against
// accidentally forwarding credentials or DB internals.
export const FORBIDDEN_PAYLOAD_PATTERNS = [
  "service_role", "service-role", "supabase_service", "sb_secret",
  "apikey", "api_key", "authorization:", "bearer ",
  "vite_supabase", "supabase_url", "publishable_key",
  "password", "sk-", "\"anon\"",
];

/** Throw if a payload string contains any forbidden secret/DB-internal marker. */
export function assertNoForbiddenData(payloadText: string): void {
  const hay = payloadText.toLowerCase();
  for (const p of FORBIDDEN_PAYLOAD_PATTERNS) {
    if (hay.includes(p)) {
      throw new Error("Refusing to build provider request: payload contains forbidden data.");
    }
  }
}

/**
 * Build the minimal provider request from an AUTHORISED project scope and an
 * explicit list of selected inputs. Enforces, deterministically:
 *   1) every input's classification permits sending (project AI must be enabled
 *      for confidential data; credentials/PII are always refused);
 *   2) no input carries forbidden secret/DB-internal markers;
 *   3) the payload contains ONLY the selected items for THIS project — never
 *      other projects, the database, or app secrets.
 *
 * This is a pure function. It does not call any provider (there is none yet).
 */
export function buildProviderRequest(
  operation: "analysis" | "audit",
  scope: AuthorizedProjectScope,
  selected: SelectedInput[],
  correlationId: string,
): AIProviderRequest {
  if (!scope.projectId) throw new Error("An authorised project scope is required.");
  if (selected.length === 0) throw new Error("No inputs selected — nothing to send.");

  for (const item of selected) {
    // (1) classification gate — confidential data needs the project AI opt-in.
    assertSendableToProvider({ kind: item.kind, aiProcessingEnabled: scope.aiProcessingEnabled });
    // (2) no forbidden markers in ref or content.
    assertNoForbiddenData(`${item.ref} ${item.content}`);
  }

  const inputs: MinimalInputs = {
    projectId: scope.projectId,
    items: selected.map((s) => ({ kind: s.kind, ref: s.ref, content: s.content })),
  };

  // (3) final guard on the assembled payload.
  assertNoForbiddenData(JSON.stringify(inputs));

  return { operation, provider: undefined, model: undefined, inputs, correlationId };
}
