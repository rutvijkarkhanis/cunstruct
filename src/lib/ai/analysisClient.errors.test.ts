// A failed ai-analysis call must show the server's reason. supabase-js reports
// every non-2xx as "Edge Function returned a non-2xx status code"; the real
// reason (e.g. the function's own 502 "OpenAI analysis request failed (status
// 429)") is in the response body, which the client used to discard.
import { describe, it, expect, vi, beforeEach } from "vitest";

const fn = vi.hoisted(() => ({ result: null as unknown }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn(async () => fn.result) } },
}));

import { AnalysisRequestError, fetchPreflight, generateAnalysis } from "./analysisClient";

class FunctionsHttpError extends Error {
  constructor(readonly context: Response) { super("Edge Function returned a non-2xx status code"); }
}
const httpError = (status: number, body: string, type = "application/json") =>
  ({ data: null, error: new FunctionsHttpError(new Response(body, { status, headers: { "Content-Type": type } })) });

beforeEach(() => { fn.result = null; });

describe("ai-analysis failures carry the server's reason", () => {
  it("a 502 from the function shows its own error and the HTTP status (the Analyze Project failure)", async () => {
    fn.result = httpError(502, JSON.stringify({ ok: false, error: "OpenAI analysis request failed (status 429, insufficient_quota)", skipped: [] }));
    const err = await generateAnalysis({ projectId: "p1", boqId: "b1", documentIds: ["d1"], mode: "BOQ" }).catch((e) => e);
    expect(err).toBeInstanceOf(AnalysisRequestError);
    expect(err.message).toBe("OpenAI analysis request failed (status 429, insufficient_quota) (HTTP 502)");
    expect(err).toMatchObject({ status: 502, serverError: "OpenAI analysis request failed (status 429, insufficient_quota)" });
    expect(err.message).not.toMatch(/non-2xx/);
  });

  it("a 400 (e.g. a refused request) says why, too", async () => {
    fn.result = httpError(400, JSON.stringify({ ok: false, error: "boqId is required for BOQ-mode analysis." }));
    await expect(fetchPreflight({ projectId: "p1" })).rejects.toThrow("boqId is required for BOQ-mode analysis. (HTTP 400)");
  });

  it("an overlong or multi-line server message is shown on one line, capped", async () => {
    fn.result = httpError(500, JSON.stringify({ ok: false, error: `line one\n${"x".repeat(1000)}` }));
    const err = await generateAnalysis({ projectId: "p1" }).catch((e) => e);
    expect(err.serverError).toHaveLength(300);
    expect(err.message).not.toMatch(/\n/);
  });

  it("a gateway answer with no JSON still names the status, and says the reason is unknown", async () => {
    fn.result = httpError(502, "<html>Bad Gateway</html>", "text/html");
    await expect(generateAnalysis({ projectId: "p1" })).rejects.toThrow("The analysis service failed (HTTP 502) without saying why.");
  });

  it("a transport failure (no response) is rethrown unchanged, and success is untouched", async () => {
    const net = new Error("Failed to send a request to the Edge Function");
    fn.result = { data: null, error: net };
    await expect(generateAnalysis({ projectId: "p1" })).rejects.toBe(net);
    fn.result = { data: { ok: true, generated: 1 }, error: null };
    await expect(generateAnalysis({ projectId: "p1" })).resolves.toEqual({ ok: true, generated: 1 });
  });
});
