// BOQ completeness engine (domain/service foundation).
//
// Answers: "What SHOULD be in this BOQ for this project type, and what have we
// actually generated?" It reuses the existing scope taxonomy — expected
// components are keyed by `scope_module.key` — and consumes the methodology/
// status that the quantity layer already produces. It is a pure function so the
// existing BOQ UI (or a later audit view) can render it without new plumbing.
//
// It deliberately does NOT introduce a parallel scope tree, fetch data, or make
// applicability decisions of its own — the caller supplies the applicable
// modules (from the existing project-type scope mechanism) and the generated
// lines.

import type { QuantityStatus } from "./quantityMethod";

/**
 * The completeness verdict for one expected component.
 *   COMPLETE                  — applicable and adequately quantified
 *   DETECTED_BUT_UNQUANTIFIED — present but measurement is insufficient (PENDING)
 *   APPLICABLE_BUT_MISSING    — expected for the applicable scope, not generated
 *   INFORMATION_UNAVAILABLE   — cannot quantify because required drawing/spec is absent
 *   NOT_APPLICABLE            — the component's scope module does not apply
 */
export type ComponentCompleteness =
  | "COMPLETE"
  | "DETECTED_BUT_UNQUANTIFIED"
  | "APPLICABLE_BUT_MISSING"
  | "INFORMATION_UNAVAILABLE"
  | "NOT_APPLICABLE";

/** An expected BOQ component for a scope module (reference data, not per-project). */
export interface ExpectedComponent {
  /** Machine key, unique within its module, e.g. "reinforcement". */
  key: string;
  /** Human label, e.g. "RCC Reinforcement". */
  name: string;
  /** The scope_module.key this component belongs to, e.g. "civil_structural". */
  moduleKey: string;
}

/** A component the generation pipeline actually produced. */
export interface GeneratedComponent {
  /** Matches an ExpectedComponent.key (or a free component the pipeline emitted). */
  key: string;
  status: QuantityStatus;
  qty: number | null;
}

export interface CompletenessRow {
  key: string;
  name: string;
  moduleKey: string;
  status: ComponentCompleteness;
}

export interface CompletenessInput {
  /** scope_module keys marked applicable via the existing project-type mechanism. */
  applicableModules: string[];
  /** Expected components (reference data) for this project type. */
  expected: ExpectedComponent[];
  /** Components the generation pipeline produced, by key. */
  generated: GeneratedComponent[];
  /**
   * Module keys for which the required source (drawings/specs) is known to be
   * absent, so an ungenerated component is INFORMATION_UNAVAILABLE rather than
   * merely APPLICABLE_BUT_MISSING. Optional.
   */
  unavailableModules?: string[];
}

const isQuantified = (g: GeneratedComponent): boolean =>
  (g.status === "MEASURED" || g.status === "COUNTED" || g.status === "DERIVED" || g.status === "ESTIMATED") &&
  g.qty != null && g.qty > 0;

/**
 * Audit expected-vs-generated components into a per-component completeness
 * verdict. Pure and deterministic.
 */
export function auditCompleteness(input: CompletenessInput): CompletenessRow[] {
  const applicable = new Set(input.applicableModules);
  const unavailable = new Set(input.unavailableModules ?? []);
  const byKey = new Map(input.generated.map((g) => [g.key, g]));

  return input.expected.map(({ key, name, moduleKey }): CompletenessRow => {
    if (!applicable.has(moduleKey)) return { key, name, moduleKey, status: "NOT_APPLICABLE" };

    const g = byKey.get(key);
    if (!g) {
      return {
        key,
        name,
        moduleKey,
        status: unavailable.has(moduleKey) ? "INFORMATION_UNAVAILABLE" : "APPLICABLE_BUT_MISSING",
      };
    }
    if (g.status === "NOT_APPLICABLE") return { key, name, moduleKey, status: "NOT_APPLICABLE" };
    if (isQuantified(g)) return { key, name, moduleKey, status: "COMPLETE" };
    // Present (detected/applicable) but PENDING / unquantified.
    return {
      key,
      name,
      moduleKey,
      status: unavailable.has(moduleKey) ? "INFORMATION_UNAVAILABLE" : "DETECTED_BUT_UNQUANTIFIED",
    };
  });
}

/** Roll a completeness audit up into per-verdict counts (for a summary bar). */
export function summariseCompleteness(rows: CompletenessRow[]): Record<ComponentCompleteness, number> {
  const out: Record<ComponentCompleteness, number> = {
    COMPLETE: 0,
    DETECTED_BUT_UNQUANTIFIED: 0,
    APPLICABLE_BUT_MISSING: 0,
    INFORMATION_UNAVAILABLE: 0,
    NOT_APPLICABLE: 0,
  };
  for (const r of rows) out[r.status] += 1;
  return out;
}
