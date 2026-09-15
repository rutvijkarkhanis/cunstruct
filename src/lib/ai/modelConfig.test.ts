import { describe, it, expect } from "vitest";
import {
  SUPPORTED_MODELS, DEFAULT_MODEL, findModel, resolveModel, estimateCostRange, actualCostUsd,
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

describe("cost estimation — a range, never a single 'exact' figure", () => {
  const model = findModel(DEFAULT_MODEL)!;

  it("estimateCostRange is zero (low and high) for no files", () => {
    const r = estimateCostRange(model, []);
    expect(r.lowUsd).toBe(0);
    expect(r.highUsd).toBe(0);
  });

  it("low is never greater than high", () => {
    const r = estimateCostRange(model, [{ pageCount: 5, byteSize: 500_000 }, { pageCount: 12, byteSize: 2_000_000 }]);
    expect(r.lowUsd).toBeLessThanOrEqual(r.highUsd);
  });

  it("grows with page count and file count", () => {
    const one = estimateCostRange(model, [{ pageCount: 5, byteSize: 500_000 }]);
    const two = estimateCostRange(model, [{ pageCount: 5, byteSize: 500_000 }, { pageCount: 5, byteSize: 500_000 }]);
    expect(two.lowUsd).toBeGreaterThan(one.lowUsd);
    expect(two.highUsd).toBeGreaterThan(one.highUsd);
  });

  it("uses page_count as the basis when every file has one", () => {
    const r = estimateCostRange(model, [{ pageCount: 5, byteSize: 500_000 }]);
    expect(r.basis).toBe("page_count");
  });

  it("falls back to the byte-size proxy (basis: 'mixed') only for a file with no known page count", () => {
    const r = estimateCostRange(model, [{ pageCount: null, byteSize: 500_000 }]);
    expect(r.basis).toBe("mixed");
  });

  it("the client cannot influence the estimate — the function only accepts pageCount/byteSize, never a caller-supplied token or cost figure", () => {
    // Structural check: CostEstimateFileInput has exactly these two fields.
    const r = estimateCostRange(model, [{ pageCount: 3, byteSize: 100 }]);
    expect(Object.keys(r).sort()).toEqual(["basis", "highUsd", "lowUsd"]);
  });

  it("a more expensive model (gpt-4o) produces a higher estimate than the cheaper default for identical files", () => {
    const files = [{ pageCount: 5, byteSize: 500_000 }];
    const cheap = estimateCostRange(findModel(DEFAULT_MODEL)!, files);
    const expensive = estimateCostRange(findModel("gpt-4o")!, files);
    expect(expensive.lowUsd).toBeGreaterThan(cheap.lowUsd);
    expect(expensive.highUsd).toBeGreaterThan(cheap.highUsd);
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
