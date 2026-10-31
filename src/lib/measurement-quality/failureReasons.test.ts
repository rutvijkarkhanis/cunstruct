import { describe, it, expect } from "vitest";
import { classifyFailure } from "./failureReasons";

// SYNTHETIC decision records only.
const base = { text: "detected", parse: "parsed", unit: "page-note", line: "found", endpoints: "valid-pair", association: "associated", scale: "consistent", overall: "hold" } as const;
const rec = (dec: Partial<typeof base> | Record<string, string>, extra: Record<string, unknown> = {}) =>
  ({ decisions: { ...base, ...dec }, reasons: ["r"], endpoints: null, association: null, unit: "mm", ...extra }) as never;
const ambEnd = (reason: string) => ({ decision: "ambiguous", measures: null, ends: [{ kind: "grid", labels: ["1"], evidence: "" }, { kind: "ambiguous", candidates: [], reason }], reason: "x" });

describe("failure classification", () => {
  it("accepted measurements have no failure class", () => {
    expect(classifyFailure(rec({ overall: "acceptable" }))).toBeNull();
  });
  it("no line is the primary reason, recorded at the line stage", () => {
    const f = classifyFailure(rec({ line: "not-found", endpoints: "not-attempted", association: "not-attempted", scale: "not-attempted", overall: "reject" }, { reasons: ["No drawn line runs parallel to this text just beside it."] }))!;
    expect(f).toMatchObject({ primary: "no-dimension-line", stage: "line", soleBlocker: null });
  });
  it("a sole blocker is claimed only when every later stage was evaluated", () => {
    expect(classifyFailure(rec({ scale: "conflicting" }, { reasons: ["The printed 900 does not match the drawn length"] }))!.soleBlocker).toBe(true);
  });
  it("unresolved endpoints are split by the engine's own reason", () => {
    const f = classifyFailure(rec({ endpoints: "unresolved", association: "not-attempted", scale: "not-attempted" }, { endpoints: { reason: "The text is not between its nearest terminators (position 0.41)" } }))!;
    expect(f.primary).toBe("text-not-between-terminators");
  });
  it("association reasons come from each end; the earliest stage is primary and later blockers are secondary", () => {
    const f = classifyFailure(rec({ association: "ambiguous", scale: "conflicting" }, {
      association: ambEnd("Extension lines leave this end in both directions and reach different elements."),
      reasons: ["At least one end could be measured from more than one element.", "The printed 900 does not match the drawn length"],
    }))!;
    expect(f).toMatchObject({ primary: "extension-lines-both-directions", secondary: ["scale-conflict"], soleBlocker: false });
  });
  it("near-miss grid ticks and cross-view conflicts are recognised", () => {
    expect(classifyFailure(rec({ association: "ambiguous" }, { association: ambEnd("This end is 1.50 off grid 9's line: the tick is not on the grid line") }))!.primary).toBe("grid-near-miss");
    expect(classifyFailure(rec({}, { crossView: { grids: "9 ↔ 10", values: [3635, 3670], ids: [], conflict: true }, reasons: ["Grids 10 ↔ 9 are dimensioned 3635 and 3670 on different views"] }))!.primary).toBe("cross-view-conflict");
  });
  it("an unrecognised hold is 'unclassified' with its raw reason, never guessed", () => {
    const f = classifyFailure(rec({}, { reasons: ["something new"] }))!;
    expect(f.primary).toBe("unclassified");
    expect(f.evidence[0]).toBe("something new");
  });
});
