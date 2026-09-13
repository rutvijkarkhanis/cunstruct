// OPENAI CLIENT — the only module in this feature that talks to OpenAI's
// network API. Everything else (validation, claiming, cost math, contract
// identity) is deliberately kept out of here so this stays a thin,
// swappable transport: business rules never live in this file.
//
// Uses the Responses API with a native PDF `input_file` (uploaded first via
// the Files API) and Structured Outputs (`text.format: json_schema`,
// `strict: true`) so the model's response is guaranteed to match
// openaiSchema.ts's shape — no fenced/prose JSON to scrape out.
//
// NOT exercised by any automated test (that would spend real API credits,
// which we were explicitly told never to do outside one intentional manual
// run — see docs/ai-analysis-pipeline.md "Manual verification"). Every other
// module this calls into (preflight, modelConfig, analysisValidation, the
// claim logic in index.ts) IS unit-tested; this file is deliberately the
// thinnest possible wrapper so there is as little untested surface as
// possible.

import { CUNSTRUCT_ANALYSIS_JSON_SCHEMA } from "./openaiSchema.ts";

const OPENAI_API_BASE = "https://api.openai.com/v1";

export interface OpenAiFileInput {
  filename: string;
  bytes: Uint8Array;
}

export interface OpenAiAnalysisResult {
  /** Raw JSON text from the model — NOT yet validated; the caller runs this
   *  through parseAnalysisV1() before trusting anything in it. */
  rawJson: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

class OpenAiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Upload one PDF to OpenAI's Files API; returns the file id to reference
 *  from the Responses call. Never logs the file's bytes or content. */
async function uploadFile(apiKey: string, file: OpenAiFileInput): Promise<string> {
  const form = new FormData();
  form.append("purpose", "user_data");
  form.append("file", new Blob([file.bytes], { type: "application/pdf" }), file.filename);
  const res = await fetch(`${OPENAI_API_BASE}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    // Never include the response body verbatim — it can echo request
    // metadata back; surface only the status for diagnostics.
    throw new OpenAiError(`OpenAI file upload failed (status ${res.status})`, res.status);
  }
  const data = await res.json();
  return data.id as string;
}

async function deleteFile(apiKey: string, fileId: string): Promise<void> {
  try {
    await fetch(`${OPENAI_API_BASE}/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    // Best-effort cleanup only — a failed delete must never fail the request
    // that already has (or doesn't have) its analysis result.
  }
}

/**
 * Generate a Cunstruct analysis for one or more drawing files via OpenAI's
 * Responses API. Files are uploaded, referenced by id in the request, then
 * deleted afterward (success or failure) — nothing is left resident in the
 * OpenAI account beyond the single request's lifetime.
 */
export async function generateAnalysisViaOpenAI(
  apiKey: string,
  model: string,
  promptText: string,
  files: OpenAiFileInput[],
): Promise<OpenAiAnalysisResult> {
  const fileIds: string[] = [];
  try {
    for (const f of files) fileIds.push(await uploadFile(apiKey, f));

    const content: Record<string, unknown>[] = fileIds.map((id) => ({ type: "input_file", file_id: id }));
    content.push({ type: "input_text", text: promptText });

    const res = await fetch(`${OPENAI_API_BASE}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: [{ role: "user", content }],
        text: { format: { type: "json_schema", ...CUNSTRUCT_ANALYSIS_JSON_SCHEMA } },
      }),
    });
    if (!res.ok) {
      throw new OpenAiError(`OpenAI analysis request failed (status ${res.status})`, res.status);
    }
    const data = await res.json();

    const rawJson: string =
      data.output_text ??
      data.output
        ?.flatMap((o: { content?: { type: string; text?: string }[] }) => o.content ?? [])
        .find((c: { type: string }) => c.type === "output_text")?.text;
    if (!rawJson) throw new OpenAiError("OpenAI response contained no output text", 502);

    const usage = data.usage ?? {};
    return {
      rawJson,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      totalTokens: usage.total_tokens ?? (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    };
  } finally {
    for (const id of fileIds) await deleteFile(apiKey, id);
  }
}
