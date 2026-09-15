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
// an admin relying on estimateCostRange() for real budgeting should reverify
// this table against OpenAI's current pricing page rather than trusting it
// indefinitely; `PRICING_VERIFIED_AT` below records when it was last checked.

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

// ── Pre-generation cost estimate ──────────────────────────────────────────
//
// OpenAI's Responses API renders each PDF page as BOTH extracted text AND a
// page image (the `input_file` content type's `detail` field, default
// "auto"); image tokens are billed by tiling — 170 tokens/tile + an 85-token
// base charge per image (e.g. a 1024x1024 image = 4 tiles = 765 tokens) — per
// OpenAI's published vision-pricing documentation. Neither the exact render
// resolution/tile count OpenAI will choose for a given page, nor the volume
// of extracted text (a mostly-blank elevation vs. a dense door/window
// schedule), is knowable before the call. A single number here would be
// false precision the API itself doesn't support pre-call — so this returns
// a LOW/HIGH range instead, and callers must present it as a range, not a
// point estimate. (The previous version of this estimator used a flat
// bytes/4 proxy, which for an image-heavy architectural PDF can be off by an
// order of magnitude in either direction; page_count — already stored on
// document_revision — is a materially better proxy for what OpenAI actually
// bills.) Verified against OpenAI's published pricing/docs as of 2026-09-15.
const LOW_TOKENS_PER_PAGE = 300;   // ~1 image tile (255) + a light amount of extracted text
const HIGH_TOKENS_PER_PAGE = 1500; // ~4+ tiles (a detailed, high-resolution page) + more extracted text
const ASSUMED_OUTPUT_TOKENS_PER_FILE = 1500;
/** Only used when a file's page_count isn't known yet (rare — it's normally
 *  captured at upload time); falls back to the old byte-based proxy for that
 *  file alone, so one unknown page count doesn't block an estimate entirely. */
const FALLBACK_BYTES_PER_TOKEN = 4;

export interface CostEstimate {
  lowUsd: number;
  highUsd: number;
  /** "page_count" when every file had a known page count; "mixed" when at
   *  least one file fell back to the byte-size proxy. Surfaced so the UI/
   *  admin can tell when the range is less reliable than usual. */
  basis: "page_count" | "mixed";
}

export interface CostEstimateFileInput {
  pageCount: number | null;
  byteSize: number;
}

/**
 * A pre-generation cost RANGE for a set of eligible files — never a single
 * "exact" figure. Output tokens are inherently unknown before generation
 * (hence a range on the output side too, via the low/high input tokens
 * driving both ends); callers must label this "Estimated cost", never
 * "Exact cost".
 */
export function estimateCostRange(model: ModelDescriptor, files: CostEstimateFileInput[]): CostEstimate {
  let lowInputTokens = 0;
  let highInputTokens = 0;
  let basis: CostEstimate["basis"] = "page_count";
  for (const f of files) {
    if (f.pageCount != null && f.pageCount > 0) {
      lowInputTokens += f.pageCount * LOW_TOKENS_PER_PAGE;
      highInputTokens += f.pageCount * HIGH_TOKENS_PER_PAGE;
    } else {
      basis = "mixed";
      const approx = Math.ceil(f.byteSize / FALLBACK_BYTES_PER_TOKEN);
      lowInputTokens += approx;
      highInputTokens += approx;
    }
  }
  const outputTokens = files.length * ASSUMED_OUTPUT_TOKENS_PER_FILE;
  const cost = (inputTokens: number) =>
    Math.round(((inputTokens / 1_000_000) * model.pricing.inputPerMillion + (outputTokens / 1_000_000) * model.pricing.outputPerMillion) * 10_000) / 10_000;
  return { lowUsd: cost(lowInputTokens), highUsd: cost(highInputTokens), basis };
}

/** Actual cost from real usage figures returned by the OpenAI response. */
export function actualCostUsd(model: ModelDescriptor, inputTokens: number, outputTokens: number): number {
  const cost =
    (inputTokens / 1_000_000) * model.pricing.inputPerMillion +
    (outputTokens / 1_000_000) * model.pricing.outputPerMillion;
  return Math.round(cost * 10_000) / 10_000;
}
