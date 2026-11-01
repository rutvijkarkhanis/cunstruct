import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { appendVerdict, freezeRun, verifyLog, verifyRun, type CorrectionEvent, type LabMeasurement } from "./core";
import { checkImport, exportLab, importLab, memoryStore, type LabExport } from "./labStore";
import { describeMeasurement, receiptsFor } from "./record";

// SYNTHETIC drawing and measurements. The whole correction lifecycle on the real Lab code: freeze →
// correct → store → "reload" (a fresh store fed from the exported JSON) → export/import → tamper checks.
const SHA = "e".repeat(64);
const m = (id: string, value: number): LabMeasurement => ({ id, page: 1, text: String(value), value, unit: "mm", textAnchor: [10, 10], line: { a: [0, 12], b: [40, 12] }, span: { start: [0, 12], end: [40, 12], length: 40 }, decision: "accepted", status: "acceptable", reasons: [], association: null });
const roundTrip = (x: LabExport): LabExport => JSON.parse(JSON.stringify(x));

async function lifecycle() {
  const run = await freezeRun("engine-9ac1f71", { name: "drawing.pdf", sha256: SHA, pages: [1] }, { measurements: [m("D1", 1730), m("D2", 900)], raw: {} });
  const store = memoryStore();
  await store.putRun(run);
  const at = new Date("2026-11-01T10:00:00Z");
  let log: readonly CorrectionEvent[] = await appendVerdict([], { run_id: run.run_id, measurement_id: "D1", verdict: "incorrect", note: "printed 1735; engine read 1730", reviewer_id: "user-123", reviewer_label: "admin@x", correction: { value: 1735 } }, at);
  await store.appendEvent(log[0]);
  log = await appendVerdict(log, { run_id: run.run_id, measurement_id: "D2", verdict: "correct", reviewer_id: "user-123", reviewer_label: "admin@x" }, at);
  await store.appendEvent(log[1]);
  return { run, store, log };
}

describe("correction lifecycle", () => {
  it("the frozen engine output is immutable; the correction is a separate event with reason, reviewer and time", async () => {
    const { run, log } = await lifecycle();
    expect(run.measurements[0].value).toBe(1730);
    expect(Object.isFrozen(run.measurements[0])).toBe(true);
    expect(() => { (run.measurements[0] as { value: number }).value = 1735; }).toThrow();
    expect(await verifyRun(run)).toBe(true);
    expect(log[0]).toMatchObject({ seq: 0, run_id: run.run_id, measurement_id: "D1", verdict: "incorrect", note: "printed 1735; engine read 1730", reviewer_id: "user-123", reviewer_label: "admin@x", correction: { value: 1735 }, at: "2026-11-01T10:00:00.000Z" });
    expect(Object.isFrozen(log[0])).toBe(true);
    // the original value stays recoverable next to the corrected one
    const rec = describeMeasurement(run.measurements[0], run, log);
    expect(rec).toMatchObject({ engine_value: 1730, current_value: 1735, provenance: "human-corrected" });
    expect(receiptsFor(run.measurements[0], run.run_id, log)[0]).toMatchObject({ value_before: 1730, value_after: 1735, changed_value: true, note: "printed 1735; engine read 1730", reviewer_label: "admin@x" });
  });

  it("a reload (fresh store from the saved data) and an export/import keep the correction, its history and every hash", async () => {
    const { run, store, log } = await lifecycle();
    const file = roundTrip(exportLab(SHA, await store.getRuns(SHA), await store.getLog(SHA), await store.getRefLog(SHA)));
    expect(await checkImport(file)).toEqual([]);
    const fresh = memoryStore();
    expect(await importLab(fresh, file)).toEqual({ runs: 1, events: 2, refEvents: 0, deferEvents: 0 });
    const [run2] = await fresh.getRuns(SHA);
    const log2 = await fresh.getLog(SHA);
    expect(run2.output_sha256).toBe(run.output_sha256);
    expect(await verifyRun(run2)).toBe(true);
    expect(await verifyLog(log2)).toBeNull();
    expect(log2.map((e) => e.hash)).toEqual(log.map((e) => e.hash));
    expect(describeMeasurement(run2.measurements[0], run2, log2)).toMatchObject({ engine_value: 1730, current_value: 1735, verification: { status: "incorrect" } });
    expect(run2.measurements[0].value).toBe(1730);
  });

  it("import refuses a tampered correction, reason, reviewer or engine value — before writing anything", async () => {
    const { store } = await lifecycle();
    const good = roundTrip(exportLab(SHA, await store.getRuns(SHA), await store.getLog(SHA), []));
    const cases: [string, (x: LabExport) => void, RegExp][] = [
      ["corrected value", (x) => { x.correction_log[0].correction!.value = 9999; }, /correction log hash chain is broken/],
      ["reason", (x) => { x.correction_log[0].note = "edited later"; }, /correction log hash chain is broken/],
      ["reviewer", (x) => { x.correction_log[0].reviewer_id = "someone-else"; }, /correction log hash chain is broken/],
      ["frozen engine value", (x) => { x.runs[0].measurements[0].value = 1735; }, /does not match its output hash/],
    ];
    for (const [what, tamper, why] of cases) {
      const bad = roundTrip(good); tamper(bad);
      expect((await checkImport(bad)).join(" "), what).toMatch(why);
      const target = memoryStore();
      await expect(importLab(target, bad), what).rejects.toThrow(/import refused/);
      expect(await target.getRuns(SHA), what).toHaveLength(0);
      expect(await target.getLog(SHA), what).toHaveLength(0);
    }
  });

  it("import never overwrites: a diverging history is refused, an older backup adds nothing, a re-import is a no-op", async () => {
    const { run, store } = await lifecycle();
    const full = roundTrip(exportLab(SHA, await store.getRuns(SHA), await store.getLog(SHA), []));
    // the store already holds a different first verdict for D1
    const other = memoryStore();
    await other.putRun(run);
    const theirs = await appendVerdict([], { run_id: run.run_id, measurement_id: "D1", verdict: "correct", reviewer_id: "user-456" });
    await other.appendEvent(theirs[0]);
    await expect(importLab(other, full)).rejects.toThrow(/differs from the file's \(no overwrite\)/);
    expect((await other.getLog(SHA)).map((e) => e.hash)).toEqual([theirs[0].hash]);
    // an older backup (only the first event) into the full store: nothing changes
    const older = roundTrip({ ...full, correction_log: full.correction_log.slice(0, 1) });
    expect(await importLab(store, older)).toEqual({ runs: 0, events: 0, refEvents: 0, deferEvents: 0 });
    expect(await store.getLog(SHA)).toHaveLength(2);
    expect(await importLab(store, full)).toEqual({ runs: 0, events: 0, refEvents: 0, deferEvents: 0 });
    expect(await store.getLog(SHA)).toHaveLength(2);
  });

  it("no correction path reaches the BOQ, pricing, exports, apply-review, the production engine or a server", () => {
    const root = process.cwd();
    const files = ["src/lib/measurement-lab/core.ts", "src/lib/measurement-lab/labStore.ts", "src/lib/measurement-lab/record.ts", "src/lib/measurement-lab/reviewState.ts", "src/components/review/MeasurementReviewWorkspace.tsx", "src/components/review/MeasurementLabPanel.tsx"];
    for (const f of files) {
      const src = readFileSync(path.join(root, f), "utf8");
      expect(src, f).not.toMatch(/from\s+["'][^"']*(applyReview|reviewStore|boq|Boq|pricing|tenderExport|analysisClient|measuredQuantities|integrations\/supabase|untypedDb|@\/lib\/review\/(?!analysisSchemaV1))[^"']*["']/);
      expect(src, f).not.toMatch(/\bfetch\(|XMLHttpRequest|functions\.invoke/);
    }
  });
});
