// generateAnalysisViaOpenAI is documented as never exercised against the
// real API (see docs/ai-analysis-pipeline.md "Manual verification") — but
// Phase 4 widens its signature to accept the JSON schema as a parameter
// instead of hardcoding CUNSTRUCT_ANALYSIS_JSON_SCHEMA internally, so BOQ and
// LOCATION extraction can share this one transport without duplicating it.
// This test verifies that plumbing is correct by mocking `fetch` — it never
// touches the real network, and it proves the function sends whatever schema
// its caller passes in, not a hardcoded one.
import { describe, it, expect, vi, afterEach } from "vitest";
import { generateAnalysisViaOpenAI } from "../../../supabase/functions/_shared/openaiClient.ts";

const FAKE_SCHEMA = { name: "some_other_schema", strict: true, schema: { type: "object", properties: {} } };

function mockFetchSequence(responses: { ok: boolean; status?: number; json: () => unknown }[]) {
  let call = 0;
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    const r = responses[Math.min(call, responses.length - 1)];
    call++;
    return { ok: r.ok, status: r.status ?? 200, json: async () => r.json() } as Response;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateAnalysisViaOpenAI — schema is caller-supplied, never hardcoded", () => {
  it("sends the exact schema object passed in, not CUNSTRUCT_ANALYSIS_JSON_SCHEMA", async () => {
    const fetchMock = mockFetchSequence([
      { ok: true, json: () => ({ id: "file-1" }) }, // file upload
      { ok: true, json: () => ({ output_text: "{}", usage: { input_tokens: 1, output_tokens: 1 } }) }, // responses call
      { ok: true, json: () => ({}) }, // file delete
    ]);
    vi.stubGlobal("fetch", fetchMock);

    await generateAnalysisViaOpenAI("fake-key", "gpt-4o-mini", "prompt text", [{ filename: "a.pdf", bytes: new Uint8Array([1]) }], FAKE_SCHEMA);

    const responsesCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/responses"));
    expect(responsesCall).toBeDefined();
    const body = JSON.parse(responsesCall![1].body as string);
    expect(body.text.format.name).toBe("some_other_schema");
    expect(body.text.format.name).not.toBe("cunstruct_analysis_v1");
  });
});
