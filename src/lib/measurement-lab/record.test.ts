import { describe, it, expect } from "vitest";
import { appendVerdict, freezeRun, type CorrectionEvent, type LabMeasurement } from "./core";
import { changesForRun, describeMeasurement, receiptsFor } from "./record";
import { labMarkers, measurementIdOf } from "./overlay";

// SYNTHETIC measurements only.
const m = (id: string, over: Partial<LabMeasurement> = {}): LabMeasurement => ({
  id, page: 2, text: "1730", value: 1730, unit: "mm", textAnchor: [100, 50], line: { a: [80, 54], b: [130, 54] },
  span: { start: [80, 54], end: [130, 54], length: 50 }, decision: "accepted", status: "acceptable", reasons: [],
  association: { decision: "associated", measures: "wall", ends: [{ kind: "grid", labels: ["6"] }, { kind: "wall" }] }, ...over,
});
const run = (ms: LabMeasurement[], engine: "engine-9ac1f71" | "engine-1de95f6" = "engine-9ac1f71") => freezeRun(engine, { name: "t.pdf", sha256: "a".repeat(64), pages: [2] }, { measurements: ms, raw: {} });
async function verdicts(runId: string, ...vs: { id: string; verdict: "correct" | "incorrect" | "unclear"; note?: string; value?: number }[]) {
  let log: readonly CorrectionEvent[] = [];
  for (const v of vs) log = await appendVerdict(log, { run_id: runId, measurement_id: v.id, verdict: v.verdict, note: v.note, reviewer_id: "u1", reviewer_label: "admin@x", correction: v.value !== undefined ? { value: v.value } : null });
  return log;
}
const fact = (r: ReturnType<typeof describeMeasurement>, k: string) => r.evidence.find((e) => e.key === k)!;

describe("measurement record (inspector data)", () => {
  it("shows value, unit, page, engine and every evidence fact with how well it is supported", async () => {
    const r0 = await run([m("D1")]);
    const r = describeMeasurement(r0.measurements[0], r0, []);
    expect(r).toMatchObject({ id: "D1", category: "linear-dimension", engine_value: 1730, unit: "mm", current_value: 1730, provenance: "explicit", source: { page: 2, drawing_name: "t.pdf" }, location_linkable: true });
    expect(r.engine).toMatchObject({ id: "engine-9ac1f71", output_sha256: r0.output_sha256 });
    expect(fact(r, "text")).toMatchObject({ state: "available", value: "“1730”" });
    expect(fact(r, "line").state).toBe("available");
    expect(fact(r, "endpoints").state).toBe("available");
    expect(fact(r, "span")).toMatchObject({ state: "derived", value: "50 pt" });
    expect(fact(r, "scale")).toMatchObject({ state: "missing", value: null });
    expect(fact(r, "association")).toMatchObject({ state: "available" });
    expect(fact(r, "conflicts")).toMatchObject({ state: "available", value: "none reported by the engine" });
    expect(r.verification).toMatchObject({ status: "not-reviewed", latest: null, receipts: [] });
  });
  it("marks missing evidence as missing and engine conflicts as unresolved — nothing is filled in", async () => {
    const r0 = await run([m("D2", { line: null, span: null, association: null, decision: "held", status: "hold", reasons: ["two candidate lines"] })]);
    const r = describeMeasurement(r0.measurements[0], r0, []);
    expect(fact(r, "line")).toMatchObject({ state: "missing", value: null });
    expect(fact(r, "endpoints")).toMatchObject({ state: "missing", value: null });
    expect(r.evidence.find((e) => e.key === "span")).toBeUndefined();
    expect(fact(r, "association")).toMatchObject({ state: "missing" });
    expect(fact(r, "conflicts")).toMatchObject({ state: "unresolved", note: "two candidate lines" });
    expect(r.provenance).toBe("unresolved");
    const r1 = await run([m("D3", { association: null })], "engine-1de95f6");
    expect(fact(describeMeasurement(r1.measurements[0], r1, []), "association").note).toMatch(/does not associate/);
    const r2 = await run([m("D4", { textAnchor: [Number.NaN, 5] })]);
    const d4 = describeMeasurement(r2.measurements[0], r2, []);
    expect(d4.location_linkable).toBe(false);
    expect(fact(d4, "location").state).toBe("missing");
  });
  it("a correction changes the current value and provenance, never the frozen engine value", async () => {
    const r0 = await run([m("D1")]);
    const log = await verdicts(r0.run_id, { id: "D1", verdict: "incorrect", note: "reads 1735 at 400%", value: 1735 });
    const r = describeMeasurement(r0.measurements[0], r0, log);
    expect(r).toMatchObject({ engine_value: 1730, current_value: 1735, provenance: "human-corrected", verification: { status: "incorrect" } });
    expect(r.verification.latest?.note).toBe("reads 1735 at 400%");
    expect(r0.measurements[0].value).toBe(1730);
    expect(Object.isFrozen(r0.measurements[0])).toBe(true);
  });
  it("receipts show before → after for each verdict, and whether the value changed", async () => {
    const r0 = await run([m("D1"), m("D2")]);
    const log = await verdicts(r0.run_id,
      { id: "D1", verdict: "unclear", note: "faint" },
      { id: "D1", verdict: "incorrect", note: "re-read", value: 1735 },
      { id: "D2", verdict: "correct" },
      { id: "D1", verdict: "correct", note: "engine was right after all" });
    const rs = receiptsFor(r0.measurements[0], r0.run_id, log);
    expect(rs.map((r) => [r.previous_status, r.verdict, r.value_before, r.value_after, r.changed_value])).toEqual([
      ["not-reviewed", "unclear", 1730, 1730, false],
      ["unclear", "incorrect", 1730, 1735, true],
      ["incorrect", "correct", 1735, 1730, true],
    ]);
    expect(rs.every((r) => r.event_hash && r.reviewer_label === "admin@x")).toBe(true);
    const all = changesForRun(r0, log);
    expect(all.map((r) => [r.seq, r.measurement_id])).toEqual([[3, "D1"], [2, "D2"], [1, "D1"], [0, "D1"]]);
    expect(describeMeasurement(r0.measurements[0], r0, log)).toMatchObject({ current_value: 1730, provenance: "explicit", verification: { status: "correct" } });
  });
});

describe("drawing markers", () => {
  it("one clickable marker per located measurement; the selected one shows text, line and endpoints highlighted", () => {
    const ms = [m("D1"), m("D2", { textAnchor: [300, 80], line: null, span: null }), m("D3", { textAnchor: [Number.NaN, 0] })];
    const none = labMarkers(ms, null, { 2: { width: 600, height: 400 } });
    expect(none.map((k) => [k.reviewItemId, k.emphasis])).toEqual([["D1", "muted"], ["D2", "muted"]]);
    const sel = labMarkers(ms, "D1", { 2: { width: 600, height: 400 } });
    expect(sel.filter((k) => k.emphasis === "primary").map((k) => k.box.label)).toEqual(['printed "1730"', "engine dimension line", "engine endpoint 1", "engine endpoint 2"]);
    expect(sel.every((k) => k.page === 2 && k.pageSize?.width === 600)).toBe(true);
    expect(sel.find((k) => k.reviewItemId === "D3")).toBeUndefined();
    expect(measurementIdOf(sel[2].id)).toBe("D1");
    // overlapping measurements stay distinct markers, each mapping back to its own measurement
    const overlap = labMarkers([m("A"), m("B")], "B", {});
    expect(new Set(overlap.map((k) => measurementIdOf(k.id)))).toEqual(new Set(["A", "B"]));
  });
});
