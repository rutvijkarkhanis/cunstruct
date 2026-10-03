// FIND SIMILAR CLIENT — thin browser wrapper over the ai-analysis Edge
// Function's "find_similar" action. A SEPARATE file from identifyClient.ts
// (not an edit to it) so that file carries zero diff from this feature —
// mirrors its own invoke()/throw-on-transport-error pattern exactly.
//
// Unlike identifyClient.ts (which trusts `data as IdentifyResponse`
// verbatim), this client additionally re-validates the edge function's own
// `result` through parseFindSimilarResultV1 before returning it — the same
// never-fabricate parser the edge function itself runs server-side, so a
// malformed/unexpected response shape (a future edge-function bug, a
// corrupted response, anything) is caught here as an honest `ok:false`
// error rather than silently passed through or crashing the caller. The
// reference passed in is what the result is validated/anchored against —
// never anything the response itself might claim.

import { supabase } from "@/integrations/supabase/client";
import { parseFindSimilarResultV1, type FindSimilarResultV1, type SimilarReferenceV1 } from "@/lib/review/findSimilarSchemaV1";

export interface FindSimilarResponse {
  ok: boolean;
  error?: string;
  result?: FindSimilarResultV1;
  warnings?: string[];
}

export interface FindSimilarArgs {
  projectId: string;
  documentId: string;
  /** The already-confirmed identification to search for more occurrences
   *  of — forwarded to the server unchanged, never altered by this client. */
  reference: SimilarReferenceV1;
  model?: string;
}

/** Ask the server to search the whole resolved document for other
 *  occurrences of an already-confirmed identification. Ephemeral by design
 *  — the result is never persisted server-side; this call is a plain
 *  request/response, not a batch job to poll for. An empty `matches` array
 *  is a valid, successful "nothing else found" result, never an error. */
export async function findSimilar(args: FindSimilarArgs): Promise<FindSimilarResponse> {
  const { data, error } = await supabase.functions.invoke("ai-analysis", { body: { action: "find_similar", ...args } });
  if (error) throw error;

  const raw = data as { ok?: boolean; error?: string; result?: unknown; warnings?: string[] } | null | undefined;
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Unexpected response from the server." };
  }
  if (!raw.ok) {
    return { ok: false, error: raw.error ?? "Find Similar request failed." };
  }

  // Defensive re-validation of the edge function's own already-parsed
  // result — never a blind type cast. JSON.stringify/re-parse round-trips
  // the structured object back through the same manual "never fabricate"
  // parser used server-side, so a malformed `matches` array or a dropped
  // field is caught as an honest error, not silently forwarded.
  const parsed = parseFindSimilarResultV1(JSON.stringify(raw.result ?? {}), args.reference);
  if (!parsed.ok || !parsed.result) {
    return { ok: false, error: "Unexpected response shape from the server: " + (parsed.error ?? "unknown error") };
  }
  return { ok: true, result: parsed.result, warnings: parsed.warnings.length ? parsed.warnings : (raw.warnings ?? []) };
}
