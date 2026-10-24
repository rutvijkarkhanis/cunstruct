import { describe, it, expect } from "vitest";
import { parseBoqName } from "./boqRename";

describe("parseBoqName", () => {
  it("trims and collapses spaces; refuses empty and over-long names", () => {
    expect(parseBoqName("  Ground   floor BOQ ")).toEqual({ ok: true, name: "Ground floor BOQ" });
    expect(parseBoqName("  ").ok).toBe(false);
    expect(parseBoqName("x".repeat(121)).ok).toBe(false);
  });
});
