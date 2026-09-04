// Cunstruct Analysis JSON — schema v1 (`cunstruct.analysis.v1`).
//
// The richer analysis contract the Review Workstation consumes: per-item
// structured source + evidence coordinates, a numeric confidence, dimension, and
// an AI measurement status. Produced OUTSIDE Cunstruct (pasted, or later by an AI
// provider through the server boundary) and PARSED/VALIDATED here — no AI, no
// network. It never fabricates a quantity, a coordinate, or a confidence: a
// missing quantity stays null (PENDING); an invalid evidence box is dropped with
// a warning, not invented.
//
// It reuses the existing robust extractor (`extractJson`) so fenced / smart-quoted
// / prose-wrapped paste still works, and is backward compatible with the flatter
// `analysisJson` shape (string `source`, HIGH/MED/LOW confidence).

import { extractJson } from "@/lib/boqEvalJson";

export type AiStatus = "MEASURED" | "INFERRED" | "PENDING";

/** One evidence region on a drawing page. bbox is [x1,y1,x2,y2] in the page's own
 *  coordinate space (see evidenceCoords.ts for the transform to screen pixels). */
export interface EvidenceBox {
  bbox: [number, number, number, number];
  page?: number;
  label?: string;
}

export interface AnalysisSource {
  document?: string;
  page?: number;
  evidence: EvidenceBox[];
}

export interface AnalysisItemV1 {
  /** Stable per-item key (e.g. "W1") — identifies, never authorizes. */
  key: string;
  item: string;
  description?: string;
  /** Numeric quantity, or null for a quantity-pending item (never fabricated). */
  quantity: number | null;
  unit?: string;
  dimension?: string;
  specification?: string;
  location?: string;
  source?: AnalysisSource;
  /** 0..1, or null if the analysis didn't supply one (never invented). */
  confidence: number | null;
  aiStatus: AiStatus;
  /** A derivation the analysis supplied — shown verbatim, never fabricated. */
  calculation?: string;
  notes?: string;
}

export interface AnalysisProjectV1 {
  projectType?: string;
  name?: string;
}

export interface AnalysisV1 {
  schemaVersion: string;
  project?: AnalysisProjectV1;
  items: AnalysisItemV1[];
}

export interface AnalysisParseV1 {
  ok: boolean;
  error?: string;
  analysis?: AnalysisV1;
  warnings: string[];
}

const SCHEMA_V1 = "cunstruct.analysis.v1";

// ── typed helpers ────────────────────────────────────────────────────────────
function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A confidence in [0,1]. Accepts a 0–100 percentage (divided, with a warning via
 *  caller). Anything non-numeric → null (never invented). */
export function normalizeConfidenceNumber(v: unknown): { value: number | null; wasPercent: boolean } {
  const n = num(v);
  if (n == null) return { value: null, wasPercent: false };
  if (n > 1 && n <= 100) return { value: Math.max(0, Math.min(1, n / 100)), wasPercent: true };
  return { value: Math.max(0, Math.min(1, n)), wasPercent: false };
}

/** Validate a single evidence bbox; returns null (not a fabricated box) if invalid. */
export function parseEvidenceBox(raw: unknown): EvidenceBox | null {
  const o = asObj(raw);
  const arr = Array.isArray(o.bbox) ? o.bbox : Array.isArray(raw) ? (raw as unknown[]) : null;
  if (!arr || arr.length !== 4) return null;
  const nums = arr.map((x) => num(x));
  if (nums.some((x) => x == null)) return null;
  const [x1, y1, x2, y2] = nums as number[];
  // Normalize so x1<x2, y1<y2 regardless of the order supplied.
  const box: [number, number, number, number] = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  const page = num(o.page);
  const out: EvidenceBox = { bbox: box };
  if (page != null) out.page = page;
  if (str(o.label)) out.label = str(o.label);
  return out;
}

function normalizeAiStatus(v: unknown, quantity: number | null): AiStatus {
  const s = str(v).toUpperCase();
  if (s.includes("MEASUR")) return "MEASURED";
  if (s.includes("INFER") || s.includes("ASSUM") || s.includes("ESTIMAT")) return "INFERRED";
  if (s.includes("PEND") || s.includes("UNKNOWN")) return "PENDING";
  // No usable status → derive: a null quantity is PENDING, else MEASURED.
  return quantity == null ? "PENDING" : "MEASURED";
}

function parseSource(raw: unknown, warnings: string[], itemLabel: string): AnalysisSource | undefined {
  if (raw == null) return undefined;
  // Backward compat: a plain string source ("Floor Plan — Page 4").
  if (typeof raw === "string") {
    const s = raw.trim();
    return s ? { document: s, evidence: [] } : undefined;
  }
  const o = asObj(raw);
  const document = str(o.document) || undefined;
  const page = num(o.page) ?? undefined;
  const evRaw = Array.isArray(o.evidence) ? o.evidence : [];
  const evidence: EvidenceBox[] = [];
  evRaw.forEach((e, i) => {
    const box = parseEvidenceBox(e);
    if (box) evidence.push(box);
    else warnings.push(`"${itemLabel}": evidence[${i}] has no valid bbox — skipped (no coordinate fabricated).`);
  });
  if (!document && page == null && evidence.length === 0) return undefined;
  return { document, page, evidence };
}

/**
 * Parse and validate a `cunstruct.analysis.v1` payload into an AnalysisV1.
 * Malformed JSON or a missing items array → ok:false. Per-item problems (unknown
 * status, bad bbox, percent confidence) are warnings; the item still loads.
 */
export function parseAnalysisV1(text: string): AnalysisParseV1 {
  const warnings: string[] = [];
  if (!(text ?? "").trim()) return { ok: false, error: "Paste or upload the analysis JSON.", warnings };

  const parsed = extractJson(text);
  if (parsed === undefined) {
    return { ok: false, error: "Invalid JSON — no JSON object found in the pasted text.", warnings };
  }

  let arr: unknown;
  let project: AnalysisProjectV1 | undefined;
  let schemaVersion = SCHEMA_V1;
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else {
    const obj = asObj(parsed);
    if (str(obj.schema_version)) schemaVersion = str(obj.schema_version);
    arr = obj.items ?? obj.requirements ?? obj.analysis;
    const p = asObj(obj.project);
    const projectType = str(p.project_type ?? p.projectType ?? p.type) || undefined;
    const name = str(p.name) || undefined;
    if (projectType || name) project = { projectType, name };
  }

  if (!Array.isArray(arr)) {
    return { ok: false, error: 'JSON schema error — expected an "items" array.', warnings };
  }
  if (arr.length === 0) {
    return { ok: false, error: 'The "items" array is empty — nothing to review.', warnings };
  }

  const items: AnalysisItemV1[] = [];
  const missingFields: string[] = [];
  arr.forEach((raw, idx) => {
    const o = asObj(raw);
    const item = str(o.item) || str(o.name) || str(o.description) || str(o.requirement);
    const key = str(o.key ?? o.external_key ?? o.id ?? o.item) || (item ? item : "");
    if (!item) { missingFields.push(`item ${idx + 1}: missing "item"/"name"`); return; }

    const hasQtyKey = "quantity" in o || "qty" in o;
    const quantity = num("quantity" in o ? o.quantity : o.qty);
    if (hasQtyKey && quantity == null && (o.quantity != null || o.qty != null)) {
      warnings.push(`"${item}": non-numeric quantity — loaded as PENDING (never fabricated).`);
    }

    const conf = normalizeConfidenceNumber(o.confidence);
    if (conf.wasPercent) warnings.push(`"${item}": confidence looked like a percentage — normalized to 0–1.`);

    items.push({
      key: key || item,
      item,
      description: str(o.description) || undefined,
      quantity,
      unit: str(o.unit) || undefined,
      dimension: str(o.dimension) || undefined,
      specification: str(o.specification ?? o.spec) || undefined,
      location: str(o.location ?? o.allocation) || undefined,
      source: parseSource(o.source, warnings, item),
      confidence: conf.value,
      aiStatus: normalizeAiStatus(o.status ?? o.ai_status, quantity),
      calculation: str(o.calculation) || undefined,
      notes: str(o.notes ?? o.note) || undefined,
    });
  });

  if (items.length === 0) {
    return { ok: false, error: `No valid items found. ${missingFields.join("; ")}`, warnings };
  }
  if (missingFields.length) warnings.push(...missingFields);

  return { ok: true, analysis: { schemaVersion, project, items }, warnings };
}
