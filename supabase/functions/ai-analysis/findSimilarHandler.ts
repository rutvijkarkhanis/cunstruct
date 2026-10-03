// FIND SIMILAR — the actual request-handling logic for the `find_similar`
// action, extracted into its own pure-TypeScript module (no Deno/`npm:`
// imports) so it can be exercised directly under Vitest. index.ts's
// `Deno.serve` handler can't be invoked from a Node test runner at all
// (`npm:` specifiers, Deno globals), which is why identify's own branch
// before this one has never had an automated test — this module exists so
// find_similar can.
//
// This also makes the zero-database-write guarantee STRUCTURAL, not just
// reviewed: `handleFindSimilar` receives no Supabase client and no writable
// handle of any kind — only a file loader and an OpenAI caller, both
// narrow, single-purpose dependencies the caller (index.ts) injects. There
// is nothing in scope here a future change could call a database write
// method on without first threading a brand-new parameter through this
// function's own signature — see findSimilarHandler.test.ts for the
// regression test that makes this concrete.
//
// index.ts's "find_similar" branch is a thin wrapper around this function:
// the SAME auth/project/canSendToProvider gate every other action already
// goes through applies before this is ever called, and there is no
// additional admin-only restriction (unlike model_config or the admin-only
// LOCATION extraction entry point) — see findSimilarHandler.test.ts's
// source-level check on index.ts for that too.
//
// Relative + explicit extension (not the usual "@/..." alias) — same
// cross-environment convention as every other pure module this feature
// shares between the browser build and the Supabase Edge Function.
import { buildFindSimilarPrompt } from "../../../src/lib/review/findSimilarPrompt.ts";
import { parseFindSimilarResultV1, type SimilarReferenceV1, type FindSimilarResultV1 } from "../../../src/lib/review/findSimilarSchemaV1.ts";
import type { EvidenceBox } from "../../../src/lib/review/analysisSchemaV1.ts";

export interface FindSimilarRequestInput {
  documentId?: string;
  /** The already-confirmed identification to search for more occurrences
   *  of. Already shape-validated by index.ts's zod BodySchema before this
   *  is called — this module trusts the shape but still never lets
   *  anything from the MODEL's response override it (see below). */
  reference?: { label: string; description?: string; evidence: EvidenceBox[] };
}

export interface FindSimilarDeps {
  /** Loads the whole resolved document's bytes — identical in kind to
   *  identify's own loadSingleDocumentFile, injected so a test can supply a
   *  fake without touching Supabase/storage at all. */
  loadDocumentFile: (documentId: string) => Promise<{ filename: string; bytes: Uint8Array }>;
  /** Calls the model — identical in kind to generateAnalysisViaOpenAI,
   *  injected so a test never spends real API credits (same discipline
   *  openaiClient.ts's own header comment documents: that file is
   *  deliberately never exercised by an automated test). */
  callOpenAi: (promptText: string, files: { filename: string; bytes: Uint8Array }[]) => Promise<{ rawJson: string }>;
}

export type FindSimilarHandlerResult =
  | { status: 200; body: { ok: true; result: FindSimilarResultV1; warnings: string[] } }
  | { status: 400 | 404 | 502; body: { ok: false; error: string } };

export async function handleFindSimilar(input: FindSimilarRequestInput, deps: FindSimilarDeps): Promise<FindSimilarHandlerResult> {
  if (!input.documentId) return { status: 400, body: { ok: false, error: "documentId is required" } };
  if (!input.reference) return { status: 400, body: { ok: false, error: "reference is required" } };

  let file: { filename: string; bytes: Uint8Array };
  try {
    file = await deps.loadDocumentFile(input.documentId);
  } catch (e) {
    return { status: 404, body: { ok: false, error: e instanceof Error ? e.message : "Failed to load the drawing file" } };
  }

  // The caller's own confirmed identification, carried through verbatim —
  // never replaced by anything the model later reports. parseFindSimilarResultV1
  // always re-attaches THIS object to the result, never anything parsed out
  // of the model's own JSON.
  const reference: SimilarReferenceV1 = { label: input.reference.label, evidence: input.reference.evidence };
  if (input.reference.description) reference.description = input.reference.description;

  const promptText = buildFindSimilarPrompt({ reference });
  let openAiResult: { rawJson: string };
  try {
    openAiResult = await deps.callOpenAi(promptText, [file]);
  } catch (e) {
    return { status: 502, body: { ok: false, error: e instanceof Error ? e.message : "OpenAI request failed" } };
  }

  const parsed = parseFindSimilarResultV1(openAiResult.rawJson, reference);
  if (!parsed.ok || !parsed.result) {
    return { status: 502, body: { ok: false, error: "OpenAI response failed validation: " + (parsed.error ?? "unknown error") } };
  }

  // No DB write — see the module header comment and findSimilarHandler.test.ts.
  return { status: 200, body: { ok: true, result: parsed.result, warnings: parsed.warnings } };
}
