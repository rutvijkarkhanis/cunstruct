import { describe, it, expect, vi, beforeEach } from "vitest";

const ai = vi.hoisted(() => ({ fetchPreflight: vi.fn(), generateAnalysis: vi.fn() }));
vi.mock("@/lib/ai/analysisClient", () => ai);

import { computeDrawingFingerprints, PROCESSING_OFF_MESSAGE } from "./drawingFingerprints";

beforeEach(() => { ai.fetchPreflight.mockReset(); ai.generateAnalysis.mockReset(); });

describe("drawing fingerprints (free, no AI)", () => {
  it("asks the server for preflight only, never for an analysis", async () => {
    ai.fetchPreflight.mockResolvedValue({ ok: true, preflight: { totalEligibleDrawingFiles: 3, filesPendingHash: 1 } });
    expect(await computeDrawingFingerprints("p1")).toEqual({ eligible: 3, fingerprinted: 2 });
    expect(ai.fetchPreflight).toHaveBeenCalledWith({ projectId: "p1" });
    expect(ai.generateAnalysis).not.toHaveBeenCalled();
  });

  it("server processing off is reported as such", async () => {
    ai.fetchPreflight.mockResolvedValue({ ok: false, error: "AI processing is not enabled for this project." });
    await expect(computeDrawingFingerprints("p1")).rejects.toThrow(PROCESSING_OFF_MESSAGE);
  });

  it("an HTTP error carries the server's reason when it can be read", async () => {
    ai.fetchPreflight.mockRejectedValue(Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: { json: async () => ({ error: "AI processing is not enabled for this project." }) },
    }));
    await expect(computeDrawingFingerprints("p1")).rejects.toThrow(PROCESSING_OFF_MESSAGE);
    ai.fetchPreflight.mockRejectedValue(new Error("network down"));
    await expect(computeDrawingFingerprints("p1")).rejects.toThrow("Fingerprinting failed: network down");
  });
});
