import { describe, it, expect, vi, beforeEach } from "vitest";
// The edge function's own request rules (supabase/functions/ai-analysis uses
// exactly these), so the request below is checked against what the server
// accepts, not against a mock that accepts anything.
import { modeRequiresBoqScope, resolveAnalysisMode } from "../../../supabase/functions/_shared/contract";

const ai = vi.hoisted(() => ({ fetchPreflight: vi.fn(), generateAnalysis: vi.fn() }));
vi.mock("@/lib/ai/analysisClient", () => ai);

import { computeDrawingFingerprints, FINGERPRINT_REQUEST, PROCESSING_OFF_MESSAGE } from "./drawingFingerprints";

/** The ai-analysis request checks before preflight runs (index.ts): a known
 *  mode, and a BOQ for BOQ-scoped modes. */
const serverAccepts = (req: { mode?: string; boqId?: string | null }) => {
  const mode = resolveAnalysisMode(req.mode);
  return mode !== null && !(modeRequiresBoqScope(mode) && !req.boqId);
};

beforeEach(() => { ai.fetchPreflight.mockReset(); ai.generateAnalysis.mockReset(); });

describe("drawing fingerprints (free, no AI)", () => {
  it("a draft project with no BOQ: the request is project-wide and passes the server's checks", async () => {
    ai.fetchPreflight.mockResolvedValue({ ok: true, preflight: { totalEligibleDrawingFiles: 1, filesPendingHash: 0 } });
    expect(await computeDrawingFingerprints("p1")).toEqual({ eligible: 1, fingerprinted: 1 });
    expect(ai.fetchPreflight).toHaveBeenCalledWith({ projectId: "p1", boqId: null, mode: "LOCATION" });
    expect(serverAccepts(FINGERPRINT_REQUEST("p1"))).toBe(true);
  });

  it("regression: the request without a mode was BOQ mode to the server, and refused without a BOQ", () => {
    expect(serverAccepts({ boqId: null })).toBe(false); // what was sent before: "boqId is required for BOQ-mode analysis."
  });

  it("BOQ-scoped analysis stays strict: BOQ modes without a BOQ are still refused; with one, accepted", () => {
    expect(serverAccepts({ mode: "BOQ", boqId: null })).toBe(false);
    expect(serverAccepts({ mode: "BOQ_AND_LOCATION", boqId: null })).toBe(false);
    expect(serverAccepts({ mode: "BOQ", boqId: "b1" })).toBe(true);
    expect(serverAccepts({ mode: "LOCATION", boqId: null })).toBe(true);
    expect(serverAccepts({ mode: "bogus", boqId: "b1" })).toBe(false);
  });

  it("Retry sends the same preflight again — no other action, never an analysis", async () => {
    ai.fetchPreflight.mockResolvedValue({ ok: true, preflight: { totalEligibleDrawingFiles: 2, filesPendingHash: 0 } });
    await computeDrawingFingerprints("p1");
    await computeDrawingFingerprints("p1");
    expect(ai.fetchPreflight.mock.calls).toEqual([[FINGERPRINT_REQUEST("p1")], [FINGERPRINT_REQUEST("p1")]]);
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
    ai.fetchPreflight.mockRejectedValue(Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: { json: async () => ({ error: "boqId is required for BOQ-mode analysis." }) },
    }));
    await expect(computeDrawingFingerprints("p1")).rejects.toThrow("Fingerprinting failed: boqId is required for BOQ-mode analysis.");
  });
});
