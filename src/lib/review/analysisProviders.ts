// ANALYSIS PROVIDERS — registry + configuration detection (no provider chosen).
//
// Describes the AI providers the workstation's "AI API" mode CAN target, without
// hard-coding one and without any implementation or SDK. The actual analysis call
// happens SERVER-SIDE (a future Supabase Edge Function) where provider API keys
// live — never in the browser. Because the client cannot see server secrets, the
// client-side `isProviderConfigured()` is conservative: it reports "not
// configured" unless the app is explicitly told a server analysis endpoint
// exists, so the default input mode is always JSON import.

import type { AIAnalysisProvider } from "@/lib/ai/aiBoundary";

export type InputMode = "JSON_IMPORT" | "AI_API";

export type ProviderKey = "openai" | "anthropic" | "google";

export interface ProviderMeta {
  key: ProviderKey;
  label: string;
  /** Example model ids for the config dropdown; the real model is chosen server-side. */
  models: string[];
  /** True once an adapter is wired server-side. All false today (no provider chosen). */
  implemented: boolean;
}

export const PROVIDERS: ProviderMeta[] = [
  { key: "openai", label: "OpenAI", models: ["gpt-4o", "o1"], implemented: false },
  { key: "anthropic", label: "Anthropic", models: ["claude-opus-4-8", "claude-sonnet-5"], implemented: false },
  { key: "google", label: "Google", models: ["gemini-2.5-pro"], implemented: false },
];

export function providerMeta(key: ProviderKey): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.key === key);
}

/**
 * Whether a server-side analysis endpoint is configured for this app. The client
 * only ever sees a PUBLIC feature flag (never a key). Absent flag → false, so the
 * workstation defaults to JSON import and works with no AI configured.
 */
export function isProviderConfigured(): boolean {
  try {
    const flag = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_ANALYSIS_API_ENABLED;
    return flag === "true" || flag === "1";
  } catch {
    return false;
  }
}

/** The default input mode: AI API only when a server endpoint is configured. */
export function defaultInputMode(): InputMode {
  return isProviderConfigured() ? "AI_API" : "JSON_IMPORT";
}

/**
 * Placeholder registry for future server-side adapters. Empty on purpose — no
 * provider is implemented. When an adapter is added it registers here; the UI and
 * review logic never import a concrete provider directly.
 */
export const analysisProviderRegistry: Partial<Record<ProviderKey, AIAnalysisProvider>> = {};
