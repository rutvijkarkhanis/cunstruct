import { describe, it, expect } from "vitest";
import {
  SUPPORTED_MODELS, DEFAULT_MODEL, findModel, resolveModel, estimateCostUsd, actualCostUsd,
} from "../../../supabase/functions/_shared/modelConfig.ts";

describe("resolveModel — the ONLY place a client-supplied model id may take effect", () => {
  it("a non-admin caller always gets the default model, regardless of what they request", () => {
    const requested = SUPPORTED_MODELS.find((m) => m.id !== DEFAULT_MODEL)!;
    const resolved = resolveModel(requested.id, false);
    expect(resolved.id).toBe(DEFAULT_MODEL);
  });

  it("an admin caller gets their requested model when it's in the allowlist", () => {
    const requested = SUPPORTED_MODELS.find((m) => m.id !== DEFAULT_MODEL)!;
    const resolved = resolveModel(requested.id, true);
    expect(resolved.id).toBe(requested.id);
  });

  it("an admin caller requesting an unknown/arbitrary model id falls back to the default — never forwarded to OpenAI", () => {
    const resolved = resolveModel("gpt-5-nonexistent-jailbreak", true);
    expect(resolved.id).toBe(DEFAULT_MODEL);
  });

  it("no requested model at all resolves to the default for anyone", () => {
    expect(resolveModel(undefined, true).id).toBe(DEFAULT_MODEL);
    expect(resolveModel(null, false).id).toBe(DEFAULT_MODEL);
  });
});

describe("findModel", () => {
  it("finds a known model by id", () => {
    expect(findModel(DEFAULT_MODEL)?.id).toBe(DEFAULT_MODEL);
  });
  it("returns undefined for an unknown id", () => {
    expect(findModel("not-a-real-model")).toBeUndefined();
  });
});

describe("cost math", () => {
  const model = findModel(DEFAULT_MODEL)!;

  it("estimateCostUsd is zero for no files", () => {
    expect(estimateCostUsd(model, [])).toBe(0);
  });

  it("estimateCostUsd grows with file size and file count", () => {
    const one = estimateCostUsd(model, [1_000_000]);
    const two = estimateCostUsd(model, [1_000_000, 1_000_000]);
    expect(two).toBeGreaterThan(one);
  });

  it("actualCostUsd matches the documented per-token pricing", () => {
    // 1,000,000 input + 1,000,000 output tokens should cost exactly the
    // model's published per-million rates.
    const cost = actualCostUsd(model, 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(model.pricing.inputPerMillion + model.pricing.outputPerMillion, 4);
  });

  it("every supported model has strictly positive pricing (never invented as free)", () => {
    for (const m of SUPPORTED_MODELS) {
      expect(m.pricing.inputPerMillion).toBeGreaterThan(0);
      expect(m.pricing.outputPerMillion).toBeGreaterThan(0);
    }
  });
});
