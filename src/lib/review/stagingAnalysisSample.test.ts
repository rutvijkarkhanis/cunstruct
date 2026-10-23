// The analysis sample the staging hand-off imports (docs/samples) must stay
// valid input for the review screen's Import JSON — parsed by the real parser.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseAnalysisV1 } from "./analysisSchemaV1";

describe("docs/samples/staging-analysis-sample.json", () => {
  it("parses as an analysis with two measured items and one pending item (no quantity invented)", () => {
    const text = fs.readFileSync(path.resolve(__dirname, "../../../docs/samples/staging-analysis-sample.json"), "utf8");
    const r = parseAnalysisV1(text);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    const items = r.analysis!.items;
    expect(items.map((i) => [i.key, i.quantity, i.aiStatus])).toEqual([["FC-1", 120, "MEASURED"], ["FL-1", 95, "MEASURED"], ["SK-1", null, "PENDING"]]);
  });
});
