/**
 * REVIEW STATE — progress, navigation and the reviewer's saved place in the Measurement Lab.
 *
 * Review status comes ONLY from the append-only verdict log: opening or selecting a measurement never
 * marks it reviewed. The saved place (selection, filter, engine, panel layout) is a per-viewer UI
 * preference kept in this browser's localStorage, one entry per drawing (by sha256). It holds no
 * drawing content and no verdicts, so losing it loses only the reviewer's position, never evidence.
 */
import type { CorrectionEvent, EngineId, LabMeasurement } from "./core";
import type { ReviewStatus } from "./record";

export type { ReviewStatus } from "./record";

/** Unresolved = still needs a person: never reviewed, or the latest verdict is "unclear". */
export const isUnresolved = (s: ReviewStatus) => s === "not-reviewed" || s === "unclear";
export const statusOf = (verdicts: ReadonlyMap<string, CorrectionEvent>, id: string): ReviewStatus => verdicts.get(id)?.verdict ?? "not-reviewed";

const NONE: ReadonlySet<string> = new Set();
/** Correctness counts (from verdicts) and workflow counts (deferred) are kept apart: `unresolved` is
 *  what is left to do NOW (not reviewed or unclear, and not deferred); `deferred` counts flagged items
 *  whatever their verdict. Deferral never changes a correctness count. */
export interface Progress { total: number; reviewed: number; notReviewed: number; correct: number; incorrect: number; unclear: number; unresolved: number; deferred: number }
export function progressOf(ms: readonly LabMeasurement[], verdicts: ReadonlyMap<string, CorrectionEvent>, deferred: ReadonlySet<string> = NONE): Progress {
  const p: Progress = { total: ms.length, reviewed: 0, notReviewed: 0, correct: 0, incorrect: 0, unclear: 0, unresolved: 0, deferred: 0 };
  for (const m of ms) {
    const s = statusOf(verdicts, m.id);
    if (s === "not-reviewed") p.notReviewed++; else { p.reviewed++; p[s]++; }
    if (deferred.has(m.id)) p.deferred++;
    else if (isUnresolved(s)) p.unresolved++;
  }
  return p;
}

export const FILTERS = ["all", "unresolved", "deferred", "not-reviewed", "correct", "incorrect", "unclear", "accepted", "held", "rejected"] as const;
export type Filter = (typeof FILTERS)[number];
export const FILTER_LABELS: Record<Filter, string> = {
  all: "all", unresolved: "unresolved (to do)", deferred: "deferred", "not-reviewed": "not reviewed", correct: "reviewed · correct", incorrect: "reviewed · incorrect",
  unclear: "reviewed · unclear", accepted: "engine accepted", held: "engine held", rejected: "engine rejected",
};
export function applyFilter(ms: readonly LabMeasurement[], verdicts: ReadonlyMap<string, CorrectionEvent>, f: Filter, deferred: ReadonlySet<string> = NONE): LabMeasurement[] {
  return ms.filter((m) => {
    const s = statusOf(verdicts, m.id);
    switch (f) {
      case "all": return true;
      case "unresolved": return isUnresolved(s) && !deferred.has(m.id);
      case "deferred": return deferred.has(m.id);
      case "not-reviewed": case "correct": case "incorrect": case "unclear": return s === f;
      default: return m.decision === f;
    }
  });
}

/** Where `currentId` sits in `ms`. When it has just left a filtered list (e.g. it was reviewed under the
 *  "unresolved" filter), its place in the full `order` is used, so navigation continues from there
 *  instead of jumping back to the top. Returns a fractional index between neighbours in that case. */
function positionIn(ms: readonly LabMeasurement[], currentId: string | null, order?: readonly LabMeasurement[]): number {
  if (!currentId) return -1;
  const i = ms.findIndex((m) => m.id === currentId);
  if (i >= 0 || !order) return i;
  const rank = new Map(order.map((m, k) => [m.id, k]));
  const r = rank.get(currentId);
  if (r === undefined) return -1;
  const before = ms.filter((m) => (rank.get(m.id) ?? -1) < r).length;
  return before - 0.5;
}
/** The next unresolved measurement after `currentId` in list order, wrapping; null when none is left.
 *  The current measurement is returned only if it is the sole unresolved one. */
export function nextUnresolved(ms: readonly LabMeasurement[], verdicts: ReadonlyMap<string, CorrectionEvent>, currentId: string | null, order?: readonly LabMeasurement[], deferred: ReadonlySet<string> = NONE): string | null {
  if (!ms.length) return null;
  const pos = positionIn(ms, currentId, order);
  const start = Math.floor(pos + 1);
  for (let k = 0; k < ms.length; k++) {
    const m = ms[(start + k) % ms.length];
    if (m.id === currentId && k < ms.length - 1) continue;
    if (isUnresolved(statusOf(verdicts, m.id)) && !deferred.has(m.id)) return m.id; // deferred items are skipped: come back via the "deferred" filter
  }
  return null;
}

/** Filters that explicitly ask for resolved items; "Show reviewed" cannot hide those. */
const ASKS_FOR_REVIEWED: readonly Filter[] = ["correct", "incorrect", "deferred"];
/** The register and the drawing show the SAME measurements: the active filter, minus resolved ones
 *  (correct / incorrect) unless "Show reviewed" is on or the filter asks for them. The selected
 *  measurement stays visible (`pinned`) after a verdict resolves it, so its receipt can be read; a
 *  filter change that leaves it out clears the selection instead (see the workspace). */
export function visibleMeasurements(ms: readonly LabMeasurement[], verdicts: ReadonlyMap<string, CorrectionEvent>, f: Filter, showReviewed: boolean, deferred: ReadonlySet<string> = NONE, selected: string | null = null): { list: LabMeasurement[]; pinned: string | null } {
  const hideResolved = !showReviewed && !ASKS_FOR_REVIEWED.includes(f);
  const keep = new Set(applyFilter(ms, verdicts, f, deferred).filter((m) => { const s = statusOf(verdicts, m.id); return !(hideResolved && (s === "correct" || s === "incorrect")); }).map((m) => m.id));
  const pinned = selected && !keep.has(selected) && ms.some((m) => m.id === selected) ? selected : null;
  if (pinned) keep.add(pinned);
  return { list: ms.filter((m) => keep.has(m.id)), pinned };
}
/** The neighbour in list order (no wrap); the first item when nothing is selected. */
export function step(ms: readonly LabMeasurement[], currentId: string | null, dir: 1 | -1, order?: readonly LabMeasurement[]): string | null {
  if (!ms.length) return null;
  const pos = positionIn(ms, currentId, order);
  if (pos === -1) return ms[dir === 1 ? 0 : ms.length - 1].id;
  const i = Number.isInteger(pos) ? pos + dir : dir === 1 ? Math.ceil(pos) : Math.floor(pos);
  return ms[Math.min(ms.length - 1, Math.max(0, i))].id;
}

// ── drawing identity ────────────────────────────────────────────────────────
const SHA_RE = /^[0-9a-f]{64}$/;
/** A drawing's identity is the sha256 of its exact bytes — never its filename. The same file under
 *  another name has the same identity; a different file under the same name does not. If the digest
 *  cannot be computed (or is malformed) the drawing gets NO identity: nothing is restored, stored or
 *  keyed to it. The bytes are only hashed here, never kept. */
export async function fingerprintDrawing(bytes: Uint8Array, digest: (b: Uint8Array) => Promise<string>): Promise<{ ok: true; sha256: string } | { ok: false; reason: string }> {
  try {
    if (!bytes.byteLength) return { ok: false, reason: "the file is empty" };
    const sha256 = await digest(bytes);
    return SHA_RE.test(sha256) ? { ok: true, sha256 } : { ok: false, reason: "the fingerprint was malformed" };
  } catch (e) { return { ok: false, reason: (e as Error)?.message || "the browser could not compute a fingerprint" }; }
}

// ── saved place ─────────────────────────────────────────────────────────────
export interface LabUiState {
  v: 1;
  drawing: { name: string; sha256: string; numPages: number };
  /** the workstation route the lab was opened from (project / BOQ context) */
  context_path: string;
  mode: "blind" | "file";
  ref_scope: "blind" | "amended";
  pages_text: string;
  engine: EngineId;
  filter: Filter;
  selected: string | null;
  inspector_open: boolean;
  /** the measurement register (left list) is shown */
  register_open: boolean;
  /** show measurements already resolved (correct / incorrect) in the register and on the drawing */
  show_reviewed: boolean;
  /** true: the drawing zooms to the selected measurement; false: the whole sheet */
  focus: boolean;
  shortcuts: boolean;
  last_reviewed: string | null;
  saved_at: string;
}
export const UI_KEY = (sha: string) => `cunstruct.measurement-lab.ui.v1:${sha}`;
export const LAST_KEY = "cunstruct.measurement-lab.ui.v1:last";
type KV = Pick<Storage, "getItem" | "setItem">;
const ls = (): KV | null => { try { return window.localStorage; } catch { return null; } };

const ENGINE_IDS: EngineId[] = ["engine-1de95f6", "engine-9ac1f71"];
/** Reads a saved place; anything malformed is dropped field by field, never trusted. */
export function sanitizeUi(x: unknown): LabUiState | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>, d = o.drawing as Record<string, unknown> | undefined;
  if (o.v !== 1 || !d || typeof d.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(d.sha256) || typeof d.name !== "string") return null;
  const str = (v: unknown, dflt: string) => (typeof v === "string" ? v : dflt);
  const bool = (v: unknown, dflt: boolean) => (typeof v === "boolean" ? v : dflt);
  return {
    v: 1, drawing: { name: d.name, sha256: d.sha256, numPages: Number.isInteger(d.numPages) ? (d.numPages as number) : 0 },
    context_path: str(o.context_path, ""), mode: o.mode === "file" ? "file" : "blind", ref_scope: o.ref_scope === "amended" ? "amended" : "blind",
    pages_text: str(o.pages_text, "").slice(0, 200), engine: ENGINE_IDS.includes(o.engine as EngineId) ? (o.engine as EngineId) : "engine-9ac1f71",
    filter: (FILTERS as readonly string[]).includes(o.filter as string) ? (o.filter as Filter) : "unresolved",
    selected: typeof o.selected === "string" ? o.selected : null, inspector_open: bool(o.inspector_open, true), register_open: bool(o.register_open, true), show_reviewed: bool(o.show_reviewed, false), focus: bool(o.focus, true),
    shortcuts: bool(o.shortcuts, true), last_reviewed: typeof o.last_reviewed === "string" ? o.last_reviewed : null, saved_at: str(o.saved_at, ""),
  };
}
export function loadUi(sha: string, store: KV | null = ls()): LabUiState | null {
  if (!SHA_RE.test(sha)) return null;
  try { const raw = store?.getItem(UI_KEY(sha)); const s = raw ? sanitizeUi(JSON.parse(raw)) : null; return s && s.drawing.sha256 === sha ? s : null; } catch { return null; }
}
export function saveUi(s: LabUiState, store: KV | null = ls()): boolean {
  if (!SHA_RE.test(s.drawing.sha256)) return false;
  try {
    store?.setItem(UI_KEY(s.drawing.sha256), JSON.stringify(s));
    store?.setItem(LAST_KEY, JSON.stringify({ name: s.drawing.name, sha256: s.drawing.sha256, numPages: s.drawing.numPages, context_path: s.context_path, saved_at: s.saved_at }));
    return !!store;
  } catch { return false; }
}
export function lastSession(store: KV | null = ls()): { name: string; sha256: string; numPages: number; context_path: string; saved_at: string } | null {
  try {
    const o = JSON.parse(store?.getItem(LAST_KEY) ?? "null");
    return o && typeof o.sha256 === "string" && /^[0-9a-f]{64}$/.test(o.sha256) && typeof o.name === "string"
      ? { name: o.name, sha256: o.sha256, numPages: Number(o.numPages) || 0, context_path: String(o.context_path ?? ""), saved_at: String(o.saved_at ?? "") } : null;
  } catch { return null; }
}

// ── keyboard ────────────────────────────────────────────────────────────────
export type ShortcutAction = "accept" | "incorrect" | "unclear" | "defer" | "next-unresolved" | "previous" | "focus" | "toggle-inspector" | "help" | "clear";
export const SHORTCUTS: { keys: string; action: ShortcutAction; label: string }[] = [
  { keys: "A", action: "accept", label: "Mark the selected measurement correct" },
  { keys: "R", action: "incorrect", label: "Mark incorrect — records only once a reason is typed" },
  { keys: "U", action: "unclear", label: "Mark unclear — records only once a reason is typed" },
  { keys: "D", action: "defer", label: "Defer / undefer — a workflow flag to come back later, not a verdict" },
  { keys: "N", action: "next-unresolved", label: "Next unresolved measurement (skips deferred)" },
  { keys: "P", action: "previous", label: "Previous measurement in the list" },
  { keys: "F", action: "focus", label: "Zoom the drawing to the selected measurement" },
  { keys: "I", action: "toggle-inspector", label: "Show or hide the inspector" },
  { keys: "?", action: "help", label: "Show this list" },
  { keys: "Esc", action: "clear", label: "Clear the selection (with nothing selected, Esc closes the Lab)" },
];
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.isContentEditable) return true;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return true;
  return !!el.closest?.('[role="combobox"],[role="listbox"],[role="menu"],[role="dialog"][data-lab-nested]');
}
export function shortcutFor(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): ShortcutAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === "Escape") return "clear";
  if (e.key === "?") return "help";
  const map: Record<string, ShortcutAction> = { a: "accept", r: "incorrect", u: "unclear", d: "defer", n: "next-unresolved", p: "previous", f: "focus", i: "toggle-inspector" };
  return map[e.key.toLowerCase()] ?? null;
}
