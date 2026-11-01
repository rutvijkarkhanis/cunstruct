import { describe, it, expect } from "vitest";
import { appendVerdict, freezeRun, type LabMeasurement } from "./core";
import { appendReferenceEvent, type RefEvent } from "./reference";
import { checkImport, exportLab, importLab, memoryStore } from "./labStore";

// SYNTHETIC data only.
const SHA = "d".repeat(64);
const m = (id: string): LabMeasurement => ({ id, page: 1, text: "1000", value: 1000, unit: "mm", textAnchor: [25, 98], line: null, span: null, decision: "held", status: "hold", reasons: [], association: null });
async function fixture() {
  const run = await freezeRun("engine-9ac1f71", { name: "t.pdf", sha256: SHA, pages: [1] }, { measurements: [m("D1")], raw: {} });
  const log = await appendVerdict([], { run_id: run.run_id, measurement_id: "D1", verdict: "unclear", note: "faint", reviewer_id: "u" });
  const refLog: readonly RefEvent[] = await appendReferenceEvent([], { type: "add", record: { ref_id: "R1", page: 1, view: "", element: "", printed_text: "1000", value: 1000, unit: "mm", text_point: [25, 98], start: [0, 100], end: [50, 100], associated_element: "a -> b", derivability: "derivable", notes: "" } }, { reviewer_id: "u", reviewer_label: "u", drawing_sha256: SHA, engine_runs_existed: false });
  return { run, log, refLog, x: exportLab(SHA, [run], log, refLog) };
}

describe("backup: export and import with integrity checks", () => {
  it("round-trips through JSON into an empty store", async () => {
    const { x } = await fixture();
    const s = memoryStore();
    expect(await importLab(s, JSON.parse(JSON.stringify(x)))).toEqual({ runs: 1, events: 1, refEvents: 1, deferEvents: 0 });
    expect(await s.getRuns(SHA)).toHaveLength(1);
    expect(await s.getLog(SHA)).toHaveLength(1);
    expect(await s.getRefLog(SHA)).toHaveLength(1);
  });
  it("refuses a tampered run, a broken chain, or data for another drawing — before writing anything", async () => {
    const { x } = await fixture();
    const t1 = JSON.parse(JSON.stringify(x)); t1.runs[0].measurements[0].value = 1;
    expect((await checkImport(t1)).join()).toMatch(/does not match its output hash/);
    const t2 = JSON.parse(JSON.stringify(x)); t2.correction_log[0].verdict = "correct";
    expect((await checkImport(t2)).join()).toMatch(/correction log hash chain is broken/);
    const t3 = JSON.parse(JSON.stringify(x)); t3.reference_log[0].record.value = 2;
    expect((await checkImport(t3)).join()).toMatch(/reference log hash chain is broken/);
    const t4 = JSON.parse(JSON.stringify(x)); t4.drawing_sha256 = "e".repeat(64);
    expect((await checkImport(t4)).join()).toMatch(/another drawing/);
    const s = memoryStore();
    await expect(importLab(s, t1)).rejects.toThrow(/import refused/);
    expect(await s.getRuns(SHA)).toHaveLength(0);
  });
  it("re-importing the same backup changes nothing; a diverging log is refused, never overwritten", async () => {
    const { x, run } = await fixture();
    const s = memoryStore();
    await importLab(s, x);
    expect(await importLab(s, x)).toEqual({ runs: 0, events: 0, refEvents: 0, deferEvents: 0 }); // nothing new: counts say so
    const other = await appendVerdict([], { run_id: run.run_id, measurement_id: "D1", verdict: "correct", reviewer_id: "u" });
    await expect(importLab(s, { ...x, correction_log: [...other] })).rejects.toThrow(/differs/);
    expect((await s.getLog(SHA))[0].verdict).toBe("unclear");
  });
});
