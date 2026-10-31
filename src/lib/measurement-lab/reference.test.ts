import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { appendReferenceEvent, incompleteFields, replay, toReferenceDimensions, verifyReferenceLog, type ReferenceMeasurement, type RefEvent } from "./reference";

// SYNTHETIC references only.
const SHA = "c".repeat(64);
const who = { reviewer_id: "user-founder", reviewer_label: "founder@x", drawing_sha256: SHA, engine_runs_existed: false };
const rec = (id: string, over: Partial<ReferenceMeasurement> = {}): ReferenceMeasurement => ({
  ref_id: id, page: 1, view: "GF plan", element: "south wall", printed_text: "1730", value: 1730, unit: "mm", text_point: [25, 98], start: [0, 100], end: [50, 100],
  associated_element: "grid 6 -> grid 7", derivability: "derivable", notes: "", ...over,
});
async function build(...bodies: Parameters<typeof appendReferenceEvent>[1][]) {
  let log: readonly RefEvent[] = [];
  for (const b of bodies) log = await appendReferenceEvent(log, b, who);
  return log;
}

describe("Stage A — blind reference capture", () => {
  it("is engine-free: the reference module and the capture component import no engine, run or store", () => {
    const root = process.cwd();
    for (const f of ["src/lib/measurement-lab/reference.ts", "src/lib/measurement-lab/hashing.ts", "src/components/review/BlindReferenceCapture.tsx"]) {
      const src = readFileSync(path.join(root, f), "utf8");
      expect(src, f).not.toMatch(/from\s+["'][^"']*(measurement-lab\/core|\.\/core|aiTrack|labStore|linearDimensions|dimensionTerminators|dimensionAssociation|baselines)["']/);
    }
  });
  it("drafts can be added, edited and withdrawn before locking", async () => {
    const log = await build({ type: "add", record: rec("R1") }, { type: "add", record: rec("R2", { value: 900, printed_text: "900" }) },
      { type: "edit", record: rec("R2", { value: 950, printed_text: "950" }) }, { type: "withdraw", ref_id: "R1", reason: "duplicate" });
    const s = replay(log);
    expect(s.locked).toBe(false);
    expect(s.blind.map((r) => [r.ref_id, r.value])).toEqual([["R2", 950]]);
  });
  it("cannot be locked while a derivable record is incomplete; ambiguous records need a note", async () => {
    expect(incompleteFields(rec("R", { start: null }))).toContain("start endpoint");
    expect(incompleteFields(rec("R", { derivability: "ambiguous", value: null, start: null }))).toEqual(["notes (why it is ambiguous or not derivable)"]);
    await expect(build({ type: "add", record: rec("R1", { end: null }) }, { type: "lock", note: "" })).rejects.toThrow(/incomplete: R1 \(end endpoint\)/);
    await expect(build({ type: "lock", note: "" })).rejects.toThrow(/at least one/);
  });
  it("once locked, records change only through amendments; the original stays", async () => {
    const log = await build({ type: "add", record: rec("R1") }, { type: "lock", note: "" });
    await expect(appendReferenceEvent(log, { type: "edit", record: rec("R1", { value: 1 }) }, who)).rejects.toThrow(/locked/);
    await expect(appendReferenceEvent(log, { type: "add", record: rec("R9") }, who)).rejects.toThrow(/locked/);
    await expect(appendReferenceEvent(log, { type: "amend", ref_id: "R1", changes: { value: 1735 }, reason: "" }, who)).rejects.toThrow(/reason/);
    const l2 = await appendReferenceEvent(log, { type: "amend", ref_id: "R1", changes: { value: 1735 }, reason: "re-read at 400%" }, who);
    const s = replay(l2);
    expect(s.blind[0].value).toBe(1730);
    expect(s.current[0]).toMatchObject({ value: 1735, amended: true });
    expect(s.current[0].history[0]).toMatchObject({ reason: "re-read at 400%", changes: { value: 1735 } });
    expect(toReferenceDimensions(s, SHA, "blind")[0].value).toBe(1730);
    expect(toReferenceDimensions(s, SHA, "amended")[0].value).toBe(1735);
  });
  it("measurements added after the reveal are flagged and excluded from the blind reference", async () => {
    const log = await build({ type: "add", record: rec("R1") }, { type: "lock", note: "" }, { type: "add-after-reveal", record: rec("R2", { value: 500, printed_text: "500" }), reason: "missed in Stage A" });
    const s = replay(log);
    expect(toReferenceDimensions(s, SHA, "blind").map((r) => r.gold_id)).toEqual(["R1"]);
    expect(s.current.find((r) => r.ref_id === "R2")).toMatchObject({ added_after_reveal: true });
  });
  it("amendments before lock are refused; a reviewer identity is required", async () => {
    await expect(build({ type: "add", record: rec("R1") }, { type: "amend", ref_id: "R1", changes: { value: 1 }, reason: "x" })).rejects.toThrow(/locked reference/);
    await expect(appendReferenceEvent([], { type: "add", record: rec("R1") }, { ...who, reviewer_id: "" })).rejects.toThrow(/authenticated reviewer/);
  });
  it("the log is hash-chained: tampering is detected", async () => {
    const log = await build({ type: "add", record: rec("R1") }, { type: "lock", note: "" });
    expect(await verifyReferenceLog(log)).toBeNull();
    const t = log.map((e) => JSON.parse(JSON.stringify(e)) as RefEvent); (t[0] as { record: ReferenceMeasurement }).record.value = 9;
    expect(await verifyReferenceLog(t)).toBe(0);
  });
  it("derivability maps to the scorer: only derivable records are measurable", async () => {
    const log = await build({ type: "add", record: rec("R1") }, { type: "add", record: rec("R2", { derivability: "ambiguous", notes: "two lines" }) }, { type: "add", record: rec("R3", { derivability: "not-derivable", notes: "no ticks" }) }, { type: "lock", note: "" });
    expect(toReferenceDimensions(replay(log), SHA, "blind").map((r) => r.reference_status)).toEqual(["OK", "AMBIGUOUS", "NOT-DERIVABLE"]);
  });
  it("records that engine output existed before the reference was started (possibly not blind)", async () => {
    const log = await appendReferenceEvent([], { type: "add", record: rec("R1") }, { ...who, engine_runs_existed: true });
    const s = replay(await appendReferenceEvent(log, { type: "lock", note: "" }, who));
    expect(s.engine_runs_existed).toBe(true);
    expect(toReferenceDimensions(s, SHA, "blind")[0].verification).toMatch(/may not be blind/);
  });
});
