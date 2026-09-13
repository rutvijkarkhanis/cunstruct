// MODEL CONFIG — the OpenAI model allowlist + pricing table.
//
// SERVER-SIDE ONLY. This file must never be imported from `src/` — that is
// what actually keeps model IDs, pricing, and provider details out of the
// client bundle (the SHOW_INTERNAL_AI_CONTROLS UI flag is presentation-only;
// this is the real boundary). The client never receives this table directly;
// it only ever sees the fields the ai-analysis edge function chooses to
// return, and only to a caller the server itself has verified is an admin —
// see requireAdmin() in index.ts.
//
// A user-supplied model id is NEVER forwarded to OpenAI — generate() in
// index.ts always resolves the request against this allowlist and falls back
// to DEFAULT_MODEL for anyone who isn't verified admin, or whose requested id
// isn't in the list.
//
// Pricing verified against OpenAI's published per-token pricing as of
// 2026-09-13 (USD per 1,000,000 tokens; https://openai.com/api/pricing/ and
// cross-referenced third-party trackers). OpenAI pricing changes over time —
// an admin relying on estimatedCostUsd() for real budgeting should reverify
// this table against OpenAI's current pricing page rather than trusting it
// indefinitely; `pricingVerifiedAt` below records when it was last checked.

export interface ModelPricing {
  /** USD per 1,000,000 input tokens. */
  inputPerMillion: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMillion: number;
}

export interface ModelDescriptor {
  id: string;
  label: string;
  pricing: ModelPricing;
  /** Supports PDF input via the Responses API's input_file content type. */
  supportsPdfInput: boolean;
}

export const PRICING_VERIFIED_AT = "2026-09-13";

export const SUPPORTED_MODELS: ModelDescriptor[] = [
  {
    id: "gpt-4o",
    label: "GPT-4o",
    pricing: { inputPerMillion: 2.5, outputPerMillion: 10.0 },
    supportsPdfInput: true,
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    pricing: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
    supportsPdfInput: true,
  },
];

export const DEFAULT_MODEL = "gpt-4o-mini";

export function findModel(id: string | null | undefined): ModelDescriptor | undefined {
  return SUPPORTED_MODELS.find((m) => m.id === id);
}

/**
 * Resolve the model to actually use. A caller-requested id is honoured ONLY
 * when `isAdmin` is true AND the id is in the allowlist; every other caller
 * (including an admin requesting an unknown id) gets the default. This is the
 * single place a client-supplied model string is allowed to influence what
 * gets sent to OpenAI — everywhere else, only this function's return value is
 * used.
 */
export function resolveModel(requestedId: string | null | undefined, isAdmin: boolean): ModelDescriptor {
  if (isAdmin && requestedId) {
    const found = findModel(requestedId);
    if (found) return found;
  }
  return findModel(DEFAULT_MODEL)!;
}

/**
 * A rough, pre-generation cost estimate for a set of eligible files. Output
 * tokens are inherently unknown before generation (that's why callers must
 * label this "Estimated cost", never "Exact cost") — this uses a fixed
 * per-file output-token assumption plus the file's own byte size as a rough
 * input-token proxy (~4 bytes/token is the standard rule-of-thumb OpenAI
 * documents for English text/PDF-derived content).
 */
export function estimateCostUsd(model: ModelDescriptor, fileByteSizes: number[]): number {
  const ASSUMED_OUTPUT_TOKENS_PER_FILE = 1500;
  const BYTES_PER_TOKEN_ESTIMATE = 4;
  let inputTokens = 0;
  for (const size of fileByteSizes) inputTokens += Math.ceil(size / BYTES_PER_TOKEN_ESTIMATE);
  const outputTokens = fileByteSizes.length * ASSUMED_OUTPUT_TOKENS_PER_FILE;
  const cost =
    (inputTokens / 1_000_000) * model.pricing.inputPerMillion +
    (outputTokens / 1_000_000) * model.pricing.outputPerMillion;
  return Math.round(cost * 10_000) / 10_000;
}

/** Actual cost from real usage figures returned by the OpenAI response. */
export function actualCostUsd(model: ModelDescriptor, inputTokens: number, outputTokens: number): number {
  const cost =
    (inputTokens / 1_000_000) * model.pricing.inputPerMillion +
    (outputTokens / 1_000_000) * model.pricing.outputPerMillion;
  return Math.round(cost * 10_000) / 10_000;
}
