// CLICK-TO-IDENTIFY CLIENT — thin browser wrapper over the ai-analysis Edge
// Function's "identify" action. A SEPARATE file from analysisClient.ts (not
// an edit to it) so that file's existing BOQ/LOCATION request shapes carry
// zero diff from this feature — mirrors its own invoke() pattern exactly.

import { supabase } from "@/integrations/supabase/client";
import type { IdentifyResultV1 } from "@/lib/review/identifySchemaV1";

export interface IdentifyResponse {
  ok: boolean;
  error?: string;
  result?: IdentifyResultV1;
  warnings?: string[];
}

export interface IdentifyArgs {
  projectId: string;
  documentId: string;
  page: number;
  point: { x: number; y: number };
  /** Real text runs already extracted near the click (pdfGeometry.ts via
   *  findNearbyContext) — never invented by this client. */
  nearbyText?: string[];
  model?: string;
}

/** Ask the server to identify what's at one clicked point on one drawing
 *  page. Ephemeral by design — the result is never persisted server-side
 *  (see the Click-to-Identify investigation report); this call is a plain
 *  request/response, not a batch job to poll for. */
export async function identifyAtPoint(args: IdentifyArgs): Promise<IdentifyResponse> {
  const { data, error } = await supabase.functions.invoke("ai-analysis", { body: { action: "identify", ...args } });
  if (error) throw error;
  return data as IdentifyResponse;
}
