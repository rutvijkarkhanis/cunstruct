// The BOQ's commercial inputs as the workbench edits them: the same spec keys
// and defaults the BOQ builder and every export use (lib/boqLiveExport
// commercialsFor), written only through lib/boqSpecWrite (guarded on the
// BOQ's updated_at). A value that is not a percentage is refused before any
// write — the builder's inputs send whatever was typed.
import type { Spec } from "@/lib/boqSpec";
import { SpecAbort, writeBoqSpecKeys } from "@/lib/boqSpecWrite";

export const COMMERCIAL_FIELDS = [
  { key: "_cost_index_pct", label: "Cost index", fallback: 0 },
  { key: "_contingency_pct", label: "Contingency", fallback: 3 },
  { key: "_overhead_pct", label: "Overhead & profit", fallback: 15 },
  { key: "_cess_pct", label: "Labour cess", fallback: 1 },
  { key: "_gst_pct", label: "GST", fallback: 18 },
] as const;
export type CommercialKey = (typeof COMMERCIAL_FIELDS)[number]["key"];

/** The percentage in effect, and whether this BOQ sets it or the default applies. */
export function commercialValue(spec: Spec, key: CommercialKey): { value: number; isDefault: boolean } {
  const f = COMMERCIAL_FIELDS.find((x) => x.key === key)!;
  const raw = spec[key];
  return raw == null || raw === "" ? { value: f.fallback, isDefault: true } : { value: Number(raw), isDefault: false };
}

export type PercentResult = { ok: true; value: number } | { ok: false; error: string };
export function parsePercent(raw: string): PercentResult {
  const text = raw.trim().replace(/%$/, "").trim();
  if (text === "") return { ok: false, error: "Enter a percentage (0 to 100)." };
  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, error: "Enter a percentage (0 to 100)." };
  if (n < 0 || n > 100) return { ok: false, error: "A percentage must be between 0 and 100." };
  return { ok: true, value: n };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Undo one commercial-input change: put `before` back (undefined removes the
 * key, so the default applies again) — only while the saved value is still
 * `after`. "conflict": it was changed since (nothing written); "failed": the
 * BOQ kept changing under every attempt, or the write failed (nothing written).
 */
export async function undoSpecChange(boqId: string, key: string, before: unknown, after: unknown): Promise<"done" | "conflict" | "failed"> {
  try {
    const r = await writeBoqSpecKeys(boqId, (current) => (same(current[key], after) ? { [key]: before } : new SpecAbort("changed")));
    return r.status === "saved" ? "done" : r.status === "aborted" ? "conflict" : "failed";
  } catch {
    return "failed";
  }
}

/** "Overhead & profit: 15% (default) → 10%" */
export function describeSpecChange(key: string, before: unknown, after: unknown): string {
  const f = COMMERCIAL_FIELDS.find((x) => x.key === key);
  if (!f) return `${key === "_firm_name" ? "Firm name" : key === "_firm_tagline" ? "Tagline" : key}: “${String(before ?? "")}” → “${String(after ?? "")}”`;
  const shown = (v: unknown) => (v == null || v === "" ? `${f.fallback}% (default)` : `${v}%`);
  return `${f.label}: ${shown(before)} → ${shown(after)}`;
}
