// EXTERNAL BOQ AUDIT JSON CONTRACT (provider-agnostic).
//
// After Cunstruct generates a BOQ, the operator exports it and has it audited
// OUTSIDE the app (today: ChatGPT compares the drawings + the BOQ JSON). The
// auditor returns a standardised Audit JSON which the operator pastes back here.
// This module PARSES and VALIDATES that JSON into structured findings. It makes
// NO drawing judgements of its own and NEVER mutates the BOQ — findings are a
// review layer the user accepts / dismisses / resolves.
//
// Contract:
//   { "audit": { "status": "PASS" | "ISSUES_FOUND", "findings": [ Finding, … ] } }
// A PASS with an empty findings array is valid. Each Finding:
//   {
//     "finding_type": "MISSING_ITEM", "action": "ADD",
//     "scope": "Finishes", "category": "Flooring", "item": "Floor finish",
//     "location": "First Floor",
//     "current_value": "1 nos", "recommended_value": "1200",
//     "recommended_method": "AREA", "recommended_unit": "sqft",
//     "reason": "Detected on the plan but absent from the BOQ",
//     "evidence": "First Floor Plan",
//     "boq_line_id": "…", "external_key": "FF-FLR-01"
//   }

import { extractJson } from "./boqEvalJson";
import { normalizeMethod, normalizeStatus } from "./analysisJson";
import type { QuantityMethod, QuantityStatus } from "./quantityMethod";

export type AuditStatus = "PASS" | "ISSUES_FOUND";

/** The kinds of problem an external audit can report. */
export const FINDING_TYPES = [
  "MISSING_ITEM",
  "MISSING_SCOPE",
  "QUANTITY_PENDING",
  "QUANTITY_ERROR",
  "METHODOLOGY_ERROR",
  "UNIT_ERROR",
  "DUPLICATE_ITEM",
  "MISSING_SPECIFICATION",
  "INSUFFICIENT_EVIDENCE",
  "OTHER",
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

/** The remediation an auditor recommends — advisory only; never auto-applied. */
export const FINDING_ACTIONS = [
  "ADD",
  "REMOVE",
  "MARK_PENDING",
  "CHANGE_METHOD",
  "CHANGE_UNIT",
  "CHANGE_QTY",
  "ADD_SPECIFICATION",
  "REVIEW",
  "OTHER",
] as const;
export type FindingAction = (typeof FINDING_ACTIONS)[number];

export interface AuditFinding {
  findingType: FindingType;
  action?: FindingAction;
  scope?: string;
  category?: string;
  item?: string;
  location?: string;
  currentValue?: string;
  recommendedValue?: string;
  recommendedMethod?: QuantityMethod;
  recommendedUnit?: string;
  recommendedStatus?: QuantityStatus;
  reason?: string;
  evidence?: string;
  /** A BOQ line id, when the auditor could pin the finding to one. */
  boqLineId?: string;
  /** A stable external key that matches an analysis item / BOQ line. */
  externalKey?: string;
}

export interface AuditParseResult {
  ok: boolean;
  error?: string;
  status?: AuditStatus;
  findings: AuditFinding[];
  warnings: string[];
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}
const enumOf = <T extends string>(all: readonly T[], v: unknown): T | null => {
  const s = str(v).toUpperCase().replace(/[\s-]+/g, "_");
  return (all as readonly string[]).includes(s) ? (s as T) : null;
};

const ACTION_ALIASES: [RegExp, FindingAction][] = [
  [/^add(_item)?$/i, "ADD"],
  [/remove|delete|drop/i, "REMOVE"],
  [/pending/i, "MARK_PENDING"],
  [/method/i, "CHANGE_METHOD"],
  [/unit/i, "CHANGE_UNIT"],
  [/qty|quantity/i, "CHANGE_QTY"],
  [/spec/i, "ADD_SPECIFICATION"],
  [/review|check|verify/i, "REVIEW"],
];
function normalizeAction(v: unknown): FindingAction | undefined {
  const direct = enumOf(FINDING_ACTIONS, v);
  if (direct) return direct;
  const s = str(v);
  if (!s) return undefined;
  for (const [re, a] of ACTION_ALIASES) if (re.test(s)) return a;
  return "OTHER";
}

/**
 * Parse and validate an external audit JSON string into structured findings.
 * Pure and deterministic. Malformed JSON, a missing `audit` object, or a missing
 * `findings` array → `ok:false`. An unknown finding_type is downgraded to OTHER
 * with a warning rather than rejecting the whole import.
 */
export function parseAuditJson(text: string): AuditParseResult {
  const warnings: string[] = [];
  if (!(text ?? "").trim()) {
    return { ok: false, error: "Paste the audit JSON to import.", findings: [], warnings };
  }

  const parsed = extractJson(text);
  if (parsed === undefined) {
    return { ok: false, error: "Invalid JSON — no JSON object found in the pasted text.", findings: [], warnings };
  }

  // Accept { audit: { status, findings } }, a bare { status, findings }, or a
  // bare findings array.
  let auditObj: Record<string, unknown>;
  if (Array.isArray(parsed)) {
    auditObj = { findings: parsed };
  } else {
    const obj = asObj(parsed);
    auditObj = "audit" in obj ? asObj(obj.audit) : obj;
  }

  const findingsRaw = auditObj.findings;
  if (!Array.isArray(findingsRaw)) {
    return { ok: false, error: 'JSON schema error — expected an "audit.findings" array.', findings: [], warnings };
  }

  const status: AuditStatus =
    enumOf(["PASS", "ISSUES_FOUND"] as const, auditObj.status) ??
    (findingsRaw.length === 0 ? "PASS" : "ISSUES_FOUND");

  const findings: AuditFinding[] = [];
  findingsRaw.forEach((raw, i) => {
    const o = asObj(raw);
    let findingType = enumOf(FINDING_TYPES, o.finding_type ?? o.type);
    if (!findingType) {
      const supplied = str(o.finding_type ?? o.type);
      if (supplied) warnings.push(`Finding ${i + 1}: unknown finding_type "${supplied}" — recorded as OTHER.`);
      else warnings.push(`Finding ${i + 1}: no finding_type — recorded as OTHER.`);
      findingType = "OTHER";
    }

    const recMethodRaw = o.recommended_method ?? o.recommendedMethod;
    const recommendedMethod = normalizeMethod(recMethodRaw) ?? undefined;
    if (recMethodRaw != null && str(recMethodRaw) && !recommendedMethod) {
      warnings.push(`Finding ${i + 1}: unknown recommended_method "${str(recMethodRaw)}".`);
    }

    findings.push({
      findingType,
      action: normalizeAction(o.action),
      scope: str(o.scope) || undefined,
      category: str(o.category) || undefined,
      item: str(o.item) || undefined,
      location: str(o.location) || undefined,
      currentValue: str(o.current_value ?? o.currentValue) || undefined,
      recommendedValue: str(o.recommended_value ?? o.recommendedValue) || undefined,
      recommendedMethod,
      recommendedUnit: str(o.recommended_unit ?? o.recommendedUnit) || undefined,
      recommendedStatus: normalizeStatus(o.recommended_status ?? o.recommendedStatus) ?? undefined,
      reason: str(o.reason) || undefined,
      evidence: str(o.evidence ?? o.source) || undefined,
      boqLineId: str(o.boq_line_id ?? o.boqLineId) || undefined,
      externalKey: str(o.external_key ?? o.externalKey ?? o.key) || undefined,
    });
  });

  if (status === "ISSUES_FOUND" && findings.length === 0) {
    warnings.push('Audit status is ISSUES_FOUND but no findings were listed.');
  }
  return { ok: true, status, findings, warnings };
}

/** Tally findings by type (for the review summary bar). */
export function summariseFindings(findings: AuditFinding[]): Record<FindingType, number> {
  const out = Object.fromEntries(FINDING_TYPES.map((t) => [t, 0])) as Record<FindingType, number>;
  for (const f of findings) out[f.findingType] += 1;
  return out;
}
