// BOQ CONSISTENCY AUDIT.
//
// After a BOQ is generated, this produces the per-BOQ accounting the estimator needs
// to trust it — how many items are priced / rate-pending / counted / measured /
// derived / pending / equipment / excluded — and flags conflicts rather than silently
// resolving them: duplicates, quantity conflicts, potential double-counting between a
// composite item and its components, and any quantity that reached a line WITHOUT
// drawing evidence (which should never happen on a drawing-driven BOQ — the audit is
// how we prove the evidence gate held).
//
// It is a read-only report over the drawing summary + generated lines. It never
// changes a quantity; "use the most authoritative source" is a decision left to the
// operator, informed by the findings here.

import { measurementMethodOf, type DrawingItem, type DrawingSummary, type MeasurementMethod } from "./boqDrawing";
import type { GeneratedLine } from "./boqDsrGenerate";
import { classifyRequirements, findMissingDrawingScope } from "./boqMapping";

export interface AuditCounts {
  requirements: number;    // total drawing requirements in this BOQ's allocation
  priced: number;          // mapped to a coded (rate-bearing) catalogue item
  ratePending: number;     // quantified works line, no rate yet
  counted: number;
  measured: number;
  derived: number;
  schedule: number;
  pending: number;         // no defensible quantity
  equipment: number;       // loose client equipment (not contractor works)
  excluded: number;        // seen in drawing, owned by another allocation
}

export type AuditFindingKind =
  | "duplicate"              // the same requirement appears twice in this BOQ
  | "quantity_conflict"     // the same requirement appears with two different quantities
  | "double_count"          // a composite item and one of its components are both present
  | "unjustified_quantity"  // a priced quantity with no drawing evidence (gate leak)
  | "missing_from_boq";     // a quantified requirement that did not survive into a line

export interface AuditFinding {
  kind: AuditFindingKind;
  detail: string;
  items: string[];
}

export interface BoqAudit {
  counts: AuditCounts;
  findings: AuditFinding[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isEquipmentItem = (it: DrawingItem) => it.scope === "equipment" || it.equipment === true;

// Composite → the components it already includes, so pricing the composite AND a
// component would double-count. Keyed on work families, not specific catalogue codes.
const COMPOSITES: { composite: RegExp; components: RegExp }[] = [
  // A WC "complete"/"with cistern" already includes the cistern, flush pipe, seat.
  { composite: /\b(wc|water\s*closet|euro(?:pean)?\s*wc|water\s*closet).*(complete|with\s*(cistern|seat|fittings)|suite)\b/i,
    components: /\b(cistern|flush\s*(pipe|tank|valve|cock)|wc\s*seat|seat\s*cover|pan\s*connector)\b/i },
  // A wash basin "with CP fittings/complete" already includes the taps/waste/trap.
  { composite: /\b(wash\s*basin|wash\s*hand\s*basin|lavatory|vanity\s*basin).*(complete|with\s*(cp\s*fittings|fittings|taps?|mixer))\b/i,
    components: /\b(basin\s*(tap|mixer|waste)|bottle\s*trap|pillar\s*cock|angle\s*(valve|cock))\b/i },
  // A "sink with fittings" already includes the sink cock / waste coupling.
  { composite: /\b(kitchen\s*sink|sink).*(complete|with\s*(fittings|drain(?:board)?|waste))\b/i,
    components: /\b(sink\s*cock|waste\s*coupling|drain\s*board)\b/i },
];

/** Quantified drawing requirements in this BOQ's allocation, keyed on the DrawingItem. */
function quantified(items: DrawingItem[]): DrawingItem[] {
  return items.filter((i) => i.match?.trim() && i.qty != null && Number.isFinite(i.qty) && (i.qty as number) > 0);
}

/**
 * Audit a generated BOQ against its drawing summary. Pure and read-only.
 * `belongs` scopes "missing" to this BOQ's allocation (out-of-allocation scope is
 * excluded on purpose, not missing).
 */
export function auditBoq(
  summary: DrawingSummary | null | undefined,
  excluded: DrawingSummary | null | undefined,
  lines: GeneratedLine[],
  belongs: (allocation: string | undefined) => boolean = () => true,
): BoqAudit {
  const items = (summary?.items ?? []).filter((i) => i.match?.trim());
  // priced / rate-pending describe CONTRACTOR WORKS only — loose client equipment is
  // never "awaiting a rate", so classify the works items for the mapping state and
  // count equipment on its own.
  const mappings = classifyRequirements({ items: items.filter((i) => !isEquipmentItem(i)) }, lines);

  const counts: AuditCounts = {
    requirements: items.length,
    priced: mappings.filter((m) => m.state === "priced").length,
    ratePending: mappings.filter((m) => m.state === "drawing_item").length,
    counted: 0, measured: 0, derived: 0, schedule: 0, pending: 0,
    equipment: items.filter(isEquipmentItem).length,
    excluded: (excluded?.items ?? []).filter((i) => i.match?.trim()).length,
  };
  for (const it of items) {
    const m: MeasurementMethod = measurementMethodOf(it);
    counts[m] += 1;
  }

  const findings: AuditFinding[] = [];

  // Duplicates & quantity conflicts: group quantified requirements by normalised
  // name within the same allocation.
  const byKey = new Map<string, DrawingItem[]>();
  for (const it of quantified(items)) {
    const key = `${norm(it.match)}|${norm(it.allocation ?? "")}`;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(it);
  }
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    const qtys = new Set(group.map((g) => g.qty));
    if (qtys.size > 1) {
      findings.push({
        kind: "quantity_conflict",
        detail: `"${group[0].match}" appears ${group.length}× with different quantities (${[...qtys].join(", ")}) — confirm which is authoritative.`,
        items: group.map((g) => g.match),
      });
    } else {
      findings.push({
        kind: "duplicate",
        detail: `"${group[0].match}" appears ${group.length}× with the same quantity — likely a duplicate.`,
        items: group.map((g) => g.match),
      });
    }
  }

  // Potential double-counting: a composite requirement present alongside one of its
  // own components.
  const q = quantified(items);
  for (const { composite, components } of COMPOSITES) {
    const comp = q.filter((it) => composite.test(it.match));
    if (!comp.length) continue;
    const parts = q.filter((it) => components.test(it.match) && !composite.test(it.match));
    if (parts.length) {
      findings.push({
        kind: "double_count",
        detail: `"${comp[0].match}" is a composite that already includes ${parts.map((p) => `"${p.match}"`).join(", ")} — pricing both double-counts.`,
        items: [comp[0].match, ...parts.map((p) => p.match)],
      });
    }
  }

  // Gate leak: any PRICED line whose quantity is not backed by a drawing binding.
  // On a drawing-driven BOQ withQuantityEvidence guarantees none; this is the proof.
  const unjustified = lines.filter((l) => !l.drawing && l.included !== false && l.qty > 0 && (l.basis === "HEURISTIC" || l.basis === "DSR_AOR"));
  if (unjustified.length) {
    findings.push({
      kind: "unjustified_quantity",
      detail: `${unjustified.length} priced line(s) carry a quantity with no drawing evidence (catalogue coefficient / area heuristic) — should not occur on a drawing-driven BOQ.`,
      items: unjustified.map((l) => l.label),
    });
  }

  // Quantified scope that did not survive into a line.
  const missing = findMissingDrawingScope(summary, lines, belongs);
  if (missing.length) {
    findings.push({
      kind: "missing_from_boq",
      detail: `${missing.length} quantified requirement(s) did not survive into a BOQ line.`,
      items: missing,
    });
  }

  return { counts, findings };
}

/** A one-line human summary of the counts, for a report header. */
export function auditCountsLine(c: AuditCounts): string {
  return [
    `${c.requirements} requirements`,
    `${c.priced} priced`,
    `${c.ratePending} rate-pending`,
    `${c.counted} counted`,
    `${c.measured} measured`,
    `${c.derived} derived`,
    `${c.schedule} schedule`,
    `${c.pending} pending`,
    `${c.equipment} equipment`,
    `${c.excluded} excluded`,
  ].join(" · ");
}
