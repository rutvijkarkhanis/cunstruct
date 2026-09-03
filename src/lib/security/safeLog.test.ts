import { describe, it, expect } from "vitest";
import { redactForLog, toSafeMetadata, newCorrelationId } from "./safeLog";

describe("redactForLog", () => {
  it("drops forbidden keys (tokens, secrets, prompts, content, PII)", () => {
    const out = redactForLog({
      projectId: "p1",
      access_token: "secret-abc",
      apiKey: "k",
      signed_url: "https://…",
      prompt: "full prompt text",
      response_body: "…",
      drawing: "base64…",
      email: "a@b.com",
      phone: "+91…",
      operation: "analysis.request",
    });
    expect(out).toEqual({ projectId: "p1", operation: "analysis.request" });
    expect(Object.keys(out)).not.toContain("access_token");
    expect(Object.keys(out)).not.toContain("prompt");
    expect(Object.keys(out)).not.toContain("email");
  });

  it("summarises nested objects/arrays so content can't leak through them", () => {
    const out = redactForLog({ items: [1, 2, 3], meta: { a: 1 }, projectId: "p" });
    expect(out.items).toBe("[array:3]");
    expect(out.meta).toBe("[object]");
    expect(out.projectId).toBe("p");
  });
});

describe("toSafeMetadata", () => {
  it("emits only safe metadata fields and a timestamp", () => {
    const meta = toSafeMetadata({ operation: "audit.import", status: "ok", projectId: "p1", correlationId: "c1" });
    expect(meta.operation).toBe("audit.import");
    expect(meta.status).toBe("ok");
    expect(meta.projectId).toBe("p1");
    expect(meta.correlationId).toBe("c1");
    expect(typeof meta.ts).toBe("string");
  });

  it("cannot carry a sensitive field even if one is forced in via the shape", () => {
    // @ts-expect-error — intentionally passing a forbidden field to prove it's stripped.
    const meta = toSafeMetadata({ operation: "x", status: "ok", token: "leak" });
    expect(Object.keys(meta)).not.toContain("token");
  });
});

describe("newCorrelationId", () => {
  it("returns a non-empty, unique-ish id", () => {
    const a = newCorrelationId();
    const b = newCorrelationId();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});
