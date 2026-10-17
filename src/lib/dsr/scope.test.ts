import { describe, it, expect } from "vitest";
import { seedCatalogue } from "./seedFixture";
import { buildDsrIndex, matchLine } from "./match";
import { scopeSuggestions, scopeLineKey, type ScopeLine } from "./scope";

const ix = buildDsrIndex(seedCatalogue(), "DSR", "2023");
const run = (lines: ScopeLine[]) => scopeSuggestions(lines, new Map(lines.map((l) => [l.id, matchLine(l, ix)])), ix);
const rcc: ScopeLine = { id: "L1", description: "RCC 1:2:4 in footings", unit: "cum", dsr_code: "5.1.3" };

describe("missing scope from the schedule's own exclusions", () => {
  it("an RCC item that excludes formwork and reinforcement surfaces both, with the trigger and the schedule's words", () => {
    const s = run([rcc]);
    expect(s.map((x) => x.key)).toEqual(["excluded_formwork:5", "excluded_reinforcement:5"]);
    const fw = s[0];
    expect(fw.triggers).toEqual([{ lineId: "L1", description: "RCC 1:2:4 in footings", dsrCode: "5.1.3", clause: expect.stringMatching(/^centering, shuttering, finishing and reinforcement/) }]);
    expect(fw.why).toContain("DSR 2023 item 5.1.3");
    expect(fw.why).toContain("excluding the cost of centering, shuttering");
    expect(fw.options.every((o) => o.code.startsWith("5.9."))).toBe(true);
    expect(fw.missingEvidence).toMatch(/No quantity/);
    expect(s[1].options.every((o) => o.code.startsWith("5.22"))).toBe(true);
    expect(s[1].options.every((o) => o.unit === "kg")).toBe(true);
  });

  it("plain concrete (chapter 4) excludes only formwork, offered from chapter 4", () => {
    const s = run([{ id: "P", description: "Cement concrete 1:4:8", unit: "cum", dsr_code: "4.1.8" }]);
    expect(s.map((x) => x.key)).toEqual(["excluded_formwork:4"]);
    expect(s[0].options.every((o) => o.code.startsWith("4.3."))).toBe(true);
  });

  it("several triggering lines give ONE suggestion per work, not one per line", () => {
    const s = run([rcc, { id: "L2", description: "RCC 1:1.5:3 in slabs", unit: "cum", dsr_code: "5.1.2" }]);
    expect(s.filter((x) => x.rule === "excluded_formwork")).toHaveLength(1);
    expect(s[0].triggers.map((t) => t.lineId)).toEqual(["L1", "L2"]);
    expect(s[0].why).toContain("and 1 more line");
  });

  it("covered work is not suggested: a line coded to a formwork item (any chapter)", () => {
    const s = run([rcc, { id: "F", description: "Shuttering to columns", unit: "sqm", dsr_code: "4.3.3" }]);
    expect(s.map((x) => x.key)).toEqual(["excluded_reinforcement:5"]);
  });

  it("a line that names the work without a code is a possible duplicate, not silently treated as cover", () => {
    const s = run([rcc, { id: "R", description: "Rebar for footings", unit: "kg" }]);
    const rf = s.find((x) => x.rule === "excluded_reinforcement")!;
    expect(rf.possibleDuplicates).toEqual([{ lineId: "R", description: "Rebar for footings", why: expect.any(String) }]);
    expect(rf.nextDecision).toMatch(/^Check whether/);
  });

  it("“excluding reinforcement” in a line's own text does not count as covering reinforcement", () => {
    const s = run([{ ...rcc, description: "RCC 1:2:4 in footings excluding reinforcement" }, { id: "X", description: "PCC excluding reinforcement", unit: "cum" }]);
    expect(s.find((x) => x.rule === "excluded_reinforcement")!.possibleDuplicates).toEqual([]);
  });

  it("only reliable matches trigger; excluded lines and unmatched lines do not", () => {
    expect(run([{ ...rcc, unit: "sqm" }])).toEqual([]);                // wrong unit → possible, not reliable
    expect(run([{ ...rcc, included: false }])).toEqual([]);
    expect(run([{ id: "Z", description: "Solar panel installation", unit: "each" }])).toEqual([]);
  });

  it("lines created by accepting stay linked to the suggestion and do not count as cover", () => {
    const accepted: ScopeLine = { id: "A1", description: "Centering and shuttering …", unit: "sqm", dsr_code: "5.9.3", external_key: scopeLineKey("excluded_formwork:5", "5.9.3") };
    const fw = run([rcc, accepted]).find((x) => x.rule === "excluded_formwork")!;
    expect(fw.acceptedLineIds).toEqual(["A1"]);
    expect(fw.nextDecision).toMatch(/^Accepted/);
  });
});
