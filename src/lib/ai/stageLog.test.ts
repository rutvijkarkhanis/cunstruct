import { describe, it, expect } from "vitest";
import { openAiErrorCode, sanitizeForLog, stageLogEntry } from "../../../supabase/functions/_shared/stageLog";
import { openAiFailure } from "../../../supabase/functions/_shared/openaiClient";

describe("ai-analysis stage logging", () => {
  it("redacts anything credential-shaped and truncates", () => {
    const s = sanitizeForLog("Authorization: Bearer abc.def.ghi failed; key sk-proj-ABCDEFGHIJKLMNOP; jwt eyJhbGciOi.eyJzdWIi.sig; apikey=xyz123");
    expect(s).not.toMatch(/abc\.def\.ghi|sk-proj-ABCDEFGHIJKLMNOP|eyJhbGciOi\.eyJzdWIi\.sig|xyz123/);
    expect(s).toContain("[redacted");
    expect(sanitizeForLog("x".repeat(1000))).toHaveLength(300);
    expect(sanitizeForLog(new TypeError("Cannot read properties of undefined (reading 'filePath')"))).toBe("TypeError: Cannot read properties of undefined (reading 'filePath')");
  });

  it("a log entry holds the stage, ids already sent, the status and a sanitized message — nothing else", () => {
    const e = stageLogEntry({ requestId: "r1", stage: "openai", action: "generate", mode: "BOQ", projectId: "p1", boqId: "b1", status: 502, error: "OpenAI analysis request failed (status 401, invalid_api_key) Bearer sk-secret-123456789" });
    expect(Object.keys(e).sort()).toEqual(["action", "boqId", "fn", "level", "message", "mode", "projectId", "requestId", "stage", "status"]);
    expect(e.message).not.toMatch(/sk-secret/);
  });

  it("caller-supplied fields are sanitized and capped, so a request cannot write free text into the logs", () => {
    const e = stageLogEntry({ requestId: "r".repeat(500), stage: "parse_request", mode: `BOQ ${"x".repeat(500)} Bearer abc.def`, status: 500, error: "boom" });
    expect(e.mode!.length).toBeLessThanOrEqual(32);
    expect(e.requestId.length).toBeLessThanOrEqual(100);
    expect(JSON.stringify(e)).not.toMatch(/abc\.def/);
    expect("action" in e).toBe(false); // absent fields stay absent
  });

  it("keeps only OpenAI's short error code, never its free-text message", () => {
    expect(openAiErrorCode({ error: { code: "insufficient_quota", message: "You exceeded your quota sk-abc" } })).toBe("insufficient_quota");
    expect(openAiErrorCode({ error: { code: null, type: "invalid_request_error" } })).toBe("invalid_request_error");
    expect(openAiErrorCode({ error: { code: "not a code: with spaces" } })).toBeNull();
    expect(openAiErrorCode("not json")).toBeNull();
  });

  it("an OpenAI rejection names the status and code, not the response body", async () => {
    const res = new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "You exceeded your current quota for org-123" } }), { status: 429 });
    const err = await openAiFailure("analysis request", res);
    expect(err.message).toBe("OpenAI analysis request failed (status 429, insufficient_quota)");
    expect(err.message).not.toMatch(/org-123|exceeded/);
    const bare = await openAiFailure("file upload", new Response("oops", { status: 500 }));
    expect(bare.message).toBe("OpenAI file upload failed (status 500)");
  });
});
