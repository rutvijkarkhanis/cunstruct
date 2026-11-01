import { describe, it, expect } from "vitest";
import { appendDefer, deferredSet, verifyDeferLog, type DeferEvent } from "./defer";
import { appendVerdict, freezeRun, latestVerdicts, type CorrectionEvent, type LabMeasurement } from "./core";
import { checkImport, exportLab, importLab, memoryStore } from "./labStore";
import { applyFilter, nextUnresolved, progressOf, visibleMeasurements } from "./reviewState";
import { overlappingWith } from "./overlay";

// SYNTHETIC data only.
const SHA = "f".repeat(64);
const m = (id: string, at: [number, number] = [10, 10], page = 1): LabMeasurement => ({ id, page, text: "100", value: 100, unit: "mm", textAnchor: at, line: null, span: null, decision: "held", status: "hold", reasons: [], association: null });
const RUN = `engine-9ac1f71:${SHA.slice(0, 12)}:abc`;
const d = async (log: readonly DeferEvent[], id: string, deferred: boolean) => appendDefer(log, { run_id: RUN, measurement_id: id, deferred, reviewer_id: "user-1", reviewer_label: "admin@x" });

describe("defer log (workflow flag, not a verdict)", () => {
  it("is append-only and hash-chained, keeps who and when, and the latest event wins", async () => {
    let log = await d([], "D1", true);
    log = await d(log, "D2", true);
    log = await d(log, "D1", false);
    expect([...deferredSet(log, RUN)]).toEqual(["D2"]);
    expect(log[0]).toMatchObject({ seq: 0, measurement_id: "D1", deferred: true, reviewer_id: "user-1", reviewer_label: "admin@x" });
    expect(log.every((e) => e.at && e.hash && Object.isFrozen(e))).toBe(true);
    expect(await verifyDeferLog(log)).toBeNull();
    const t = log.map((e) => ({ ...e })); t[1].deferred = false;
    expect(await verifyDeferLog(t)).toBe(1);
  });
  it("refuses redundant events and an unauthenticated reviewer", async () => {
    const log = await d([], "D1", true);
    await expect(d(log, "D1", true)).rejects.toThrow(/already deferred/);
    await expect(d([], "D1", false)).rejects.toThrow(/not deferred/);
    await expect(appendDefer([], { run_id: RUN, measurement_id: "D1", deferred: true, reviewer_id: " " })).rejects.toThrow(/authenticated reviewer/);
  });
  it("never changes verdicts or corrections, is counted apart, and N skips deferred items", async () => {
    const ms = [m("D1"), m("D2"), m("D3")];
    const vlog: readonly CorrectionEvent[] = await appendVerdict([], { run_id: RUN, measurement_id: "D2", verdict: "incorrect", note: "why", reviewer_id: "u", correction: { value: 105 } });
    const before = JSON.stringify(vlog);
    const defers = deferredSet(await d(await d([], "D2", true), "D3", true), RUN);
    const vs = latestVerdicts(vlog, RUN);
    expect(JSON.stringify(vlog)).toBe(before);
    expect(vs.get("D2")).toMatchObject({ verdict: "incorrect", correction: { value: 105 } });
    expect(progressOf(ms, vs, defers)).toEqual({ total: 3, reviewed: 1, notReviewed: 2, correct: 0, incorrect: 1, unclear: 0, unresolved: 1, deferred: 2 });
    expect(applyFilter(ms, vs, "deferred", defers).map((x) => x.id)).toEqual(["D2", "D3"]);
    expect(applyFilter(ms, vs, "unresolved", defers).map((x) => x.id)).toEqual(["D1"]);
    expect(nextUnresolved(ms, vs, "D1", ms, defers)).toBe("D1"); // the only one left to resolve
  });
});

describe("register/drawing visibility", () => {
  it("hides resolved items unless Show reviewed is on or the filter asks for them; keeps the selected item pinned", async () => {
    const ms = [m("D1"), m("D2"), m("D3")];
    const vs = latestVerdicts(await appendVerdict(await appendVerdict([], { run_id: RUN, measurement_id: "D1", verdict: "correct", reviewer_id: "u" }), { run_id: RUN, measurement_id: "D3", verdict: "unclear", note: "?", reviewer_id: "u" }), RUN);
    const ids = (x: { list: LabMeasurement[] }) => x.list.map((y) => y.id);
    expect(ids(visibleMeasurements(ms, vs, "all", false))).toEqual(["D2", "D3"]); // unclear is still unresolved
    expect(ids(visibleMeasurements(ms, vs, "all", true))).toEqual(["D1", "D2", "D3"]);
    expect(ids(visibleMeasurements(ms, vs, "correct", false))).toEqual(["D1"]); // asked for explicitly
    expect(visibleMeasurements(ms, vs, "unresolved", false, new Set(), "D1")).toMatchObject({ pinned: "D1" });
    expect(ids(visibleMeasurements(ms, vs, "unresolved", false, new Set(), "D1"))).toEqual(["D1", "D2", "D3"]);
    expect(visibleMeasurements(ms, vs, "unresolved", false, new Set(), "D2").pinned).toBeNull();
  });
});

describe("overlapping markers", () => {
  it("finds every measurement whose clickable box substantially overlaps, on the same page only", () => {
    const a = m("A", [100, 50]), b = m("B", [104, 52]), c = m("C", [140, 50]), dd = m("D", [100, 50], 2), e = m("E", [Number.NaN, 0]);
    expect(overlappingWith(a, [a, b, c, dd, e]).map((x) => x.id)).toEqual(["A", "B"]);
    expect(overlappingWith(c, [a, b, c]).map((x) => x.id)).toEqual(["C"]); // only touching: not an overlap
    expect(overlappingWith(e, [a, e]).map((x) => x.id)).toEqual(["E"]);
  });
});

describe("defer log in backups", () => {
  it("exports and imports the defer log with integrity checks; v2 files without it still import; never overwrites", async () => {
    const run = await freezeRun("engine-9ac1f71", { name: "t.pdf", sha256: SHA, pages: [1] }, { measurements: [m("D1")], raw: {} });
    const dl = await appendDefer([], { run_id: run.run_id, measurement_id: "D1", deferred: true, reviewer_id: "u", reviewer_label: "admin@x" });
    const x = JSON.parse(JSON.stringify(exportLab(SHA, [run], [], [], dl)));
    expect(x.schema).toBe("cunstruct.lab-export.v3");
    const s = memoryStore();
    expect(await importLab(s, x)).toEqual({ runs: 1, events: 0, refEvents: 0, deferEvents: 1 });
    expect(await s.getDeferLog(SHA)).toEqual(x.defer_log);
    expect(await importLab(s, x)).toEqual({ runs: 0, events: 0, refEvents: 0, deferEvents: 0 });
    const bad = JSON.parse(JSON.stringify(x)); bad.defer_log[0].deferred = false;
    expect((await checkImport(bad)).join()).toMatch(/defer log hash chain is broken/);
    const other = memoryStore(); await other.putRun(run);
    await other.appendDeferEvent((await appendDefer([], { run_id: run.run_id, measurement_id: "D1", deferred: true, reviewer_id: "someone-else" }))[0]);
    await expect(importLab(other, x)).rejects.toThrow(/stored defer log differs/);
    const v2 = { ...x, schema: "cunstruct.lab-export.v2" }; delete v2.defer_log;
    expect(await checkImport(v2)).toEqual([]);
    expect(await importLab(memoryStore(), v2)).toEqual({ runs: 1, events: 0, refEvents: 0, deferEvents: 0 });
  });
});
