import { describe, it, expect } from "vitest";
import { classifyDocument, classifyPage } from "./intakeClassify";

// SYNTHETIC page evidence only.
describe("intake classification", () => {
  it("text plus many vector segments and no raster is native vector", () => {
    expect(classifyPage({ text_runs: 300, vector_segments: 40000, images: [] })).toBe("native-vector");
  });
  it("a page-covering scan with no vectors is raster-only, even if split into strips", () => {
    expect(classifyPage({ text_runs: 0, vector_segments: 42, images: Array(14).fill({ page_cover: 0.06 }) })).toBe("raster-only");
  });
  it("a substantial raster beside substantial vectors is mixed", () => {
    expect(classifyPage({ text_runs: 50, vector_segments: 5000, images: [{ page_cover: 0.3 }] })).toBe("mixed");
  });
  it("a near-empty page is insufficient evidence", () => {
    expect(classifyPage({ text_runs: 2, vector_segments: 10, images: [] })).toBe("insufficient-evidence");
  });
  it("documents: all vector → native-vector; vector with raster pages → mixed; domain is declared, never inferred", () => {
    expect(classifyDocument(["native-vector", "native-vector"], false).class).toBe("native-vector");
    expect(classifyDocument(["native-vector", "raster-only"], false).class).toBe("mixed");
    expect(classifyDocument(["raster-only"], false).class).toBe("raster-only");
    expect(classifyDocument(["native-vector"], true).class).toBe("out-of-domain");
    expect(classifyDocument([], false).class).toBe("insufficient-evidence");
  });
});
