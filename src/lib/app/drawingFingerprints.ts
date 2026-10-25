// Drawing fingerprints (document_revision.content_hash) through the existing
// ai-analysis "preflight" action: the server downloads each drawing that has
// none yet, computes its SHA-256 and stores it. Preflight never calls an AI
// model (supabase/functions/ai-analysis, action "preflight"); this module only
// ever asks for preflight, so it cannot start a paid analysis.
//
// The server refuses preflight for a project whose server processing
// (projects.ai_processing_enabled) is off; that is reported as such, not as
// a failure of the drawings.
import { fetchPreflight } from "@/lib/ai/analysisClient";

export interface FingerprintStatus {
  /** Drawings with a stored PDF the server could read. */
  eligible: number;
  /** Of those, how many now have a fingerprint. */
  fingerprinted: number;
}

export const PROCESSING_OFF_MESSAGE = "Server processing is off for this project, so drawing fingerprints cannot be computed.";

export async function computeDrawingFingerprints(projectId: string): Promise<FingerprintStatus> {
  let res: Awaited<ReturnType<typeof fetchPreflight>>;
  try {
    res = await fetchPreflight({ projectId });
  } catch (e) {
    // supabase-js reports any non-2xx as a generic error; the server's own
    // reason is in the response body when it can be read.
    const ctx = (e as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    const body = ctx?.json ? await ctx.json().catch(() => null) : null;
    const reason = body?.error ?? (e instanceof Error ? e.message : String(e));
    throw new Error(/not enabled/i.test(reason) ? PROCESSING_OFF_MESSAGE : `Fingerprinting failed: ${reason}`);
  }
  if (!res?.ok || !res.preflight) {
    const reason = res?.error ?? "no result from the server";
    throw new Error(/not enabled/i.test(reason) ? PROCESSING_OFF_MESSAGE : `Fingerprinting failed: ${reason}`);
  }
  const p = res.preflight;
  return { eligible: p.totalEligibleDrawingFiles, fingerprinted: p.totalEligibleDrawingFiles - p.filesPendingHash };
}
