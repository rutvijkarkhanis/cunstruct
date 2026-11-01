import { describe, it, expect } from "vitest";
import { appendVerdict, latestVerdicts, type CorrectionEvent, type LabMeasurement } from "./core";
import { applyFilter, fingerprintDrawing, isTypingTarget, lastSession, loadUi, nextUnresolved, progressOf, saveUi, shortcutFor, step, UI_KEY, type LabUiState } from "./reviewState";

// SYNTHETIC data only.
const m = (id: string, decision: LabMeasurement["decision"] = "held"): LabMeasurement => ({ id, page: 1, text: "1", value: 1, unit: "mm", textAnchor: [1, 1], line: null, span: null, decision, status: decision, reasons: [], association: null });
const ms = [m("D1", "accepted"), m("D2"), m("D3"), m("D4", "rejected")];
async function v(...xs: [string, "correct" | "incorrect" | "unclear"][]) {
  let log: readonly CorrectionEvent[] = [];
  for (const [id, verdict] of xs) log = await appendVerdict(log, { run_id: "r", measurement_id: id, verdict, note: verdict === "correct" ? "" : "why", reviewer_id: "u" });
  return latestVerdicts(log, "r");
}
const mem = () => { const d = new Map<string, string>(); return { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, x: string) => void d.set(k, x), d }; };
const SHA = "b".repeat(64);
const ui = (over: Partial<LabUiState> = {}): LabUiState => ({ v: 1, drawing: { name: "x.pdf", sha256: SHA, numPages: 3 }, context_path: "/ops/projects/p/boqs/b/review", mode: "blind", ref_scope: "blind", pages_text: "1,3", engine: "engine-9ac1f71", filter: "unresolved", selected: "D3", inspector_open: false, register_open: true, show_reviewed: false, focus: true, shortcuts: true, last_reviewed: "D2", saved_at: "2026-11-01T10:00:00Z", ...over });

describe("review progress", () => {
  it("counts from verdicts only: opening or selecting never marks anything reviewed", async () => {
    expect(progressOf(ms, new Map())).toMatchObject({ total: 4, reviewed: 0, notReviewed: 4, unresolved: 4 });
    const vs = await v(["D1", "correct"], ["D2", "incorrect"], ["D3", "unclear"]);
    expect(progressOf(ms, vs)).toEqual({ total: 4, reviewed: 3, notReviewed: 1, correct: 1, incorrect: 1, unclear: 1, unresolved: 2, deferred: 0 });
  });
  it("filters by review status or by the engine's own decision", async () => {
    const vs = await v(["D1", "correct"], ["D3", "unclear"]);
    expect(applyFilter(ms, vs, "unresolved").map((x) => x.id)).toEqual(["D2", "D3", "D4"]);
    expect(applyFilter(ms, vs, "not-reviewed").map((x) => x.id)).toEqual(["D2", "D4"]);
    expect(applyFilter(ms, vs, "unclear").map((x) => x.id)).toEqual(["D3"]);
    expect(applyFilter(ms, vs, "held").map((x) => x.id)).toEqual(["D2", "D3"]);
  });
  it("next unresolved skips reviewed items and wraps; previous steps back without wrapping", async () => {
    const vs = await v(["D2", "correct"], ["D3", "incorrect"]);
    expect(nextUnresolved(ms, vs, "D1")).toBe("D4");
    expect(nextUnresolved(ms, vs, "D4")).toBe("D1");
    expect(nextUnresolved(ms, vs, null)).toBe("D1");
    const done = await v(["D1", "correct"], ["D2", "correct"], ["D3", "correct"], ["D4", "correct"]);
    expect(nextUnresolved(ms, done, "D2")).toBeNull();
    expect(step(ms, "D3", -1)).toBe("D2");
    expect(step(ms, "D1", -1)).toBe("D1");
    expect(step(ms, null, -1)).toBe("D4");
  });
});

describe("saved place (resume)", () => {
  it("round-trips per drawing and remembers the last session", () => {
    const s = mem();
    expect(saveUi(ui(), s)).toBe(true);
    expect(loadUi(SHA, s)).toEqual(ui());
    expect(loadUi("c".repeat(64), s)).toBeNull();
    expect(lastSession(s)).toMatchObject({ name: "x.pdf", sha256: SHA, context_path: "/ops/projects/p/boqs/b/review" });
    // the saved place holds no verdicts or drawing content
    expect(Object.keys(JSON.parse(s.d.get(UI_KEY(SHA))!)).sort()).toEqual(["context_path", "drawing", "engine", "filter", "focus", "inspector_open", "last_reviewed", "mode", "pages_text", "ref_scope", "register_open", "saved_at", "selected", "shortcuts", "show_reviewed", "v"]);
  });
  it("ignores corrupt or tampered entries field by field, and survives storage that throws", () => {
    const s = mem();
    s.setItem(UI_KEY(SHA), "{not json");
    expect(loadUi(SHA, s)).toBeNull();
    s.setItem(UI_KEY(SHA), JSON.stringify({ ...ui(), engine: "engine-evil", filter: "nope", selected: 7, inspector_open: "yes" }));
    expect(loadUi(SHA, s)).toMatchObject({ engine: "engine-9ac1f71", filter: "unresolved", selected: null, inspector_open: true });
    s.setItem(UI_KEY(SHA), JSON.stringify({ ...ui(), drawing: { name: "x", sha256: "c".repeat(64) } }));
    expect(loadUi(SHA, s)).toBeNull();
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(loadUi(SHA, broken)).toBeNull();
    expect(saveUi(ui(), broken)).toBe(false);
    expect(lastSession(broken)).toBeNull();
  });
});

describe("keyboard mapping", () => {
  it("maps the documented keys, ignores modified keys, and treats fields as typing", () => {
    const k = (key: string, mod = {}) => shortcutFor({ key, ctrlKey: false, metaKey: false, altKey: false, ...mod });
    expect(["a", "R", "u", "d", "n", "p", "f", "i", "?", "Escape"].map((x) => k(x))).toEqual(["accept", "incorrect", "unclear", "defer", "next-unresolved", "previous", "focus", "toggle-inspector", "help", "clear"]);
    expect(k("a", { ctrlKey: true })).toBeNull();
    expect(k("r", { metaKey: true })).toBeNull();
    expect(k("v")).toBeNull();
    for (const tag of ["input", "textarea", "select"]) expect(isTypingTarget(document.createElement(tag))).toBe(true);
    const div = document.createElement("div"); div.contentEditable = "true"; Object.defineProperty(div, "isContentEditable", { value: true });
    expect(isTypingTarget(div)).toBe(true);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("navigation after a verdict removes the item from a filtered list", () => {
  it("N continues from the reviewed item's place, P goes to the item before it", async () => {
    const all = [m("D1"), m("D2"), m("D3"), m("D4"), m("D5")];
    const vs = await v(["D1", "correct"], ["D3", "correct"]); // D3 was just reviewed under the "unresolved" filter
    const list = applyFilter(all, vs, "unresolved"); // D2, D4, D5
    expect(nextUnresolved(list, vs, "D3", all)).toBe("D4");
    expect(step(list, "D3", -1, all)).toBe("D2");
    expect(step(list, "D3", 1, all)).toBe("D4");
    const vs2 = await v(["D1", "correct"], ["D5", "correct"]);
    expect(nextUnresolved(applyFilter(all, vs2, "unresolved"), vs2, "D5", all)).toBe("D2"); // wraps past the end
  });
});

describe("drawing identity for resume", () => {
  const sha = async (b: Uint8Array) => { const d = await crypto.subtle.digest("SHA-256", b); return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join(""); };
  it("identity is the content fingerprint: a renamed copy resumes, a different file with the same name does not", async () => {
    const s = mem();
    const a = await fingerprintDrawing(new TextEncoder().encode("%PDF drawing A"), sha);
    const b = await fingerprintDrawing(new TextEncoder().encode("%PDF drawing B"), sha);
    if (!a.ok || !b.ok) throw new Error("fingerprint");
    saveUi(ui({ drawing: { name: "plan.pdf", sha256: a.sha256, numPages: 1 }, selected: "D7" }), s);
    const renamed = await fingerprintDrawing(new TextEncoder().encode("%PDF drawing A"), sha); // same bytes, any filename
    expect(renamed).toEqual(a);
    expect(loadUi((renamed as { sha256: string }).sha256, s)).toMatchObject({ selected: "D7", drawing: { name: "plan.pdf" } });
    expect(loadUi(b.sha256, s)).toBeNull(); // "plan.pdf" with other content: nothing restored
  });
  it("a failed or malformed fingerprint gives no identity: nothing is restored or saved", async () => {
    const s = mem();
    saveUi(ui(), s);
    expect(await fingerprintDrawing(new Uint8Array([1]), async () => { throw new Error("SubtleCrypto unavailable"); })).toEqual({ ok: false, reason: "SubtleCrypto unavailable" });
    expect(await fingerprintDrawing(new Uint8Array([1]), async () => "not-a-hash")).toMatchObject({ ok: false });
    expect(await fingerprintDrawing(new Uint8Array([]), sha)).toMatchObject({ ok: false, reason: "the file is empty" });
    expect(loadUi("", s)).toBeNull();
    expect(loadUi("x".repeat(64), s)).toBeNull();
    expect(saveUi(ui({ drawing: { name: "x.pdf", sha256: "nope", numPages: 1 } }), s)).toBe(false);
    expect([...s.d.keys()].every((k) => !k.endsWith(":nope"))).toBe(true);
  });
});
