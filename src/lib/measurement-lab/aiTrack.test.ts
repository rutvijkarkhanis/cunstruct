import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { diffTracks, TRACK_B_STATUS, TrackBRun, validateTrackB } from "./aiTrack";
import { freezeRun, type LabMeasurement } from "./core";

// SYNTHETIC Track B records only — no AI call is made anywhere in the lab.
const H = (c: string) => c.repeat(64);
const m = (id: string, over: Partial<LabMeasurement> = {}): LabMeasurement => ({ id, page: 1, text: "1000", value: 1000, unit: "mm", textAnchor: [25, 98], line: null, span: { start: [0, 100], end: [50, 100], length: 50 }, decision: "held", status: "hold", reasons: [], association: null, ...over });
const ai = (base: { run_id: string; output_sha256: string }, measurements: unknown[], over: Record<string, unknown> = {}) => ({
  schema: "cunstruct.lab-ai-run.v1", track: "B", base_run: base, provider: "openai", model: "model-x", model_version: "2026-09-01", configuration: { temperature: 0 }, prompt_version: "measurement-review.v0",
  request: { sha256: H("a"), sent_at: "2026-11-01T10:00:00Z", pages: [1] }, response: { status: "complete", raw: "{}", raw_sha256: H("b"), error: null, received_at: "2026-11-01T10:00:05Z" },
  usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.01, retries: 0 }, measurements, verified: false, ...over,
});
const am = (over: Record<string, unknown>) => ({ base_measurement_id: "D1", action: "kept", page: 1, text: "1000", value: 1000, unit: "mm", start: [0, 100], end: [50, 100], associated_element: null, decision: "held", rationale: "", ...over });

describe("Track B (in-house + AI): contract only, unavailable", () => {
  it("is labelled unavailable, and the lab makes no AI/network call", () => {
    expect(TRACK_B_STATUS.available).toBe(false);
    for (const f of ["src/lib/measurement-lab/aiTrack.ts", "src/lib/measurement-lab/core.ts", "src/components/review/MeasurementLabPanel.tsx"]) {
      const src = readFileSync(path.join(process.cwd(), f), "utf8");
      expect(src, f).not.toMatch(/\bfetch\(|XMLHttpRequest|functions\.invoke|from\s+["'][^"']*(analysisClient|identifyClient|findSimilarClient|openaiClient|integrations\/supabase|untypedDb)[^"']*["']/);
    }
  });
  it("keeps Track A untouched, references it by exact hash, and records provider, model, prompt version and usage", async () => {
    const base = await freezeRun("engine-9ac1f71", { name: "t", sha256: H("c"), pages: [1] }, { measurements: [m("D1"), m("D2")], raw: {} });
    const before = JSON.stringify(base);
    const r = validateTrackB(ai(base, [am({ action: "changed", value: 1010, decision: "accepted" }), am({ base_measurement_id: null, action: "added", value: 500 }), am({ base_measurement_id: "D2", action: "removed" })]), base);
    expect(r.ok).toBe(true);
    const d = diffTracks(base.measurements, (r as { run: TrackBRun }).run);
    expect(d).toMatchObject({ changed: [{ id: "D1", fields: ["value", "decision"] }], added: [1], removed: ["D2"] });
    expect(JSON.stringify(base)).toBe(before);
    expect(validateTrackB(ai({ run_id: base.run_id, output_sha256: H("f") }, []), base)).toMatchObject({ ok: false });
    expect(validateTrackB({ ...ai(base, []), prompt_version: "" }, base).ok).toBe(false);
  });
  it("cannot carry prices or BOQ quantities, cannot claim verification, and records failures honestly", async () => {
    const base = await freezeRun("engine-9ac1f71", { name: "t", sha256: H("c"), pages: [1] }, { measurements: [m("D1")], raw: {} });
    expect(validateTrackB(ai(base, [am({ rate: 120 })]), base).ok).toBe(false);
    expect(validateTrackB(ai(base, [am({ boq_quantity: 3 })]), base).ok).toBe(false);
    expect(validateTrackB(ai(base, [], { verified: true }), base).ok).toBe(false);
    expect(validateTrackB(ai(base, [am({})], { response: { status: "failed", raw: "", raw_sha256: H("b"), error: "timeout", received_at: "x" } }), base).ok).toBe(false);
    expect(validateTrackB(ai(base, [], { response: { status: "failed", raw: "", raw_sha256: H("b"), error: "timeout", received_at: "x" } }), base).ok).toBe(true);
    expect(validateTrackB(ai(base, [am({ base_measurement_id: "NOPE", action: "changed" })]), base).ok).toBe(false);
  });
});
