import { describe, it, expect } from "vitest";
import { classifyModel, MODEL_MARGIN } from "./tradeModel";

describe("classifyModel", () => {
  it("classifies by catalog category", () => {
    expect(classifyModel("Building Materials")).toBe("Broker");
    expect(classifyModel("Structural")).toBe("Broker");
    expect(classifyModel("Electrical")).toBe("Hook");
    expect(classifyModel("Fixtures & Fittings")).toBe("Hook");
    expect(classifyModel("Tools & Equipment")).toBe("Trade");
  });

  it("falls back to name keywords when category is missing", () => {
    expect(classifyModel(null, "Cement (PPC)")).toBe("Broker");
    expect(classifyModel(null, "Plastering Sand")).toBe("Broker");
    expect(classifyModel(null, "PVC Wire 1.5mm")).toBe("Hook");
    expect(classifyModel(null, "Random Widget")).toBe("Trade");
  });

  it("prefers category over name when both are present", () => {
    expect(classifyModel("Electrical", "Cement")).toBe("Hook");
  });

  it("has a default margin for every model", () => {
    expect(MODEL_MARGIN.Trade).toBeGreaterThan(MODEL_MARGIN.Hook);
    expect(MODEL_MARGIN.Hook).toBeGreaterThan(MODEL_MARGIN.Broker);
  });
});
