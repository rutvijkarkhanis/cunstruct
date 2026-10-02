import { describe, it, expect } from "vitest";
import { generateShareToken, hashShareToken } from "./shareToken";

describe("generateShareToken", () => {
  it("returns a long, URL-safe token", () => {
    const token = generateShareToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("never returns the same token twice", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateShareToken()));
    expect(tokens.size).toBe(50);
  });
});

describe("hashShareToken", () => {
  it("is deterministic — the same input always hashes the same way", async () => {
    const token = generateShareToken();
    const h1 = await hashShareToken(token);
    const h2 = await hashShareToken(token);
    expect(h1).toBe(h2);
  });

  it("is sensitive to a single-character change", async () => {
    const token = "a".repeat(32);
    const tweaked = "b" + token.slice(1);
    const h1 = await hashShareToken(token);
    const h2 = await hashShareToken(tweaked);
    expect(h1).not.toBe(h2);
  });

  it("returns a hex-encoded SHA-256 digest (64 hex chars)", async () => {
    const hash = await hashShareToken("anything");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never returns the raw token back out", async () => {
    const token = "my-raw-token-value";
    const hash = await hashShareToken(token);
    expect(hash).not.toContain(token);
  });
});
