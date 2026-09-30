// DRAWING MARKERS — deterministic Category/Type/Instance -> on-drawing
// marking sets, matching the reference product's "selecting a type
// highlights all its instances" interaction.
//
// PURE. No AI, no I/O, no fabrication: every marker's box is either a real
// LOCATION observation's own evidence (a genuine per-occurrence physical
// detection) or a real analysis item's own evidence.evidence[] (the region
// that supports its claim — NOT a claim that this is the physical element's
// outline). The two are tagged with a distinct `kind` and never conflated —
// see Section 11 of the reference-adoption plan: evidence ("this supports
// the claim") and detection/instance ("this is the physical element") are
// different concepts that happen to share a coordinate system.
//
// This module never decides WHICH document is currently open — the caller
// (BoqReviewWorkstation) already resolves that per item via
// documentResolve.ts and only passes markers for items that resolve to the
// document actually on screen. Nothing here reaches into Supabase or React.

import type { StoredReviewItem } from "./reviewStore";
import type { EvidenceBox, AnalysisSource } from "./analysisSchemaV1";
import type { CategoryGroup, ElementCategory } from "./typeGrouping";
import type { TypeInstance } from "./typeInstances";

export type MarkerKind = "evidence" | "instance";
export type MarkerEmphasis = "primary" | "secondary" | "muted";

export interface DrawingMarker {
  /** Stable within one marker set: `${reviewItemId}:e:${boxIndex}` for an
   *  evidence marker, `${observation.id}:${boxIndex}` for an instance marker. */
  id: string;
  reviewItemId: string;
  category: ElementCategory;
  kind: MarkerKind;
  /** Set only for an "instance" marker — the real LOCATION observation id it
   *  came from, so a click on the drawing can toggle that exact instance's
   *  focus without parsing `id` (which encodes the box index too). */
  observationId?: string;
  box: EvidenceBox;
  /** Resolved page — the box's own `page`, else the source's page. Never
   *  guessed further than that; a marker with no resolvable page is dropped
   *  by the builders below rather than placed on whatever page is showing. */
  page: number;
  /** The coordinate space the box is measured in, when the source declares
   *  one — same optional-override convention as evidenceCoords.resolvePageSpace. */
  pageSize?: { width: number; height: number };
  /** A short on-canvas label — the type's own key, or (for an instance) its
   *  key plus a 1-based ordinal, e.g. "W1" / "W1 #2". Never invented text. */
  label: string;
  /** Only meaningful for an "instance" marker: true when this occurrence's
   *  own recorded dimension/specification genuinely disagrees with its
   *  parent type's declared value (see typeInstances.ts). */
  differsFromType?: boolean;
  emphasis: MarkerEmphasis;
}

function resolvedPage(box: EvidenceBox, source: AnalysisSource | undefined): number | null {
  return box.page ?? source?.page ?? null;
}

/** One marker per real evidence box the type's own analysis supplied —
 *  never per physical occurrence (that's evidenceForType's job when real
 *  LOCATION data exists). Boxes with no resolvable page are dropped. */
function evidenceMarkersForItem(item: StoredReviewItem, category: ElementCategory, emphasis: MarkerEmphasis): DrawingMarker[] {
  const source = item.ai.source;
  const boxes = source?.evidence ?? [];
  const out: DrawingMarker[] = [];
  boxes.forEach((box, i) => {
    const page = resolvedPage(box, source);
    if (page == null) return;
    out.push({
      id: `${item.id}:e:${i}`, reviewItemId: item.id, category, kind: "evidence",
      box, page, pageSize: source?.pageSize, label: item.ai.key, emphasis,
    });
  });
  return out;
}

/** One marker per real LOCATION-observation evidence box — genuine
 *  per-occurrence detections, never fabricated. `emphasisFor` lets the
 *  caller give one specific instance a heavier treatment (the focused one)
 *  while the rest stay visible but subordinate. */
function instanceMarkersForItem(
  item: StoredReviewItem, category: ElementCategory, instances: TypeInstance[],
  emphasisFor: (observationId: string) => MarkerEmphasis,
): DrawingMarker[] {
  const out: DrawingMarker[] = [];
  instances.forEach((inst, idx) => {
    const { observation } = inst;
    const boxes = observation.evidence.evidence ?? [];
    boxes.forEach((box, i) => {
      const page = resolvedPage(box, observation.evidence);
      if (page == null) return;
      out.push({
        id: `${observation.id}:${i}`, reviewItemId: item.id, category, kind: "instance", observationId: observation.id,
        box, page, pageSize: observation.evidence.pageSize,
        label: instances.length > 1 ? `${item.ai.key} #${idx + 1}` : item.ai.key,
        differsFromType: inst.differsFromType,
        emphasis: emphasisFor(observation.id),
      });
    });
  });
  return out;
}

/** Real instances if this type genuinely has them, else its own evidence —
 *  the one honesty-preserving fallback used by every builder below. Never
 *  invents an instance when LOCATION data doesn't exist for this document. */
function markersForItem(
  item: StoredReviewItem, category: ElementCategory, instances: TypeInstance[],
  emphasis: MarkerEmphasis, focusedObservationId?: string | null,
): DrawingMarker[] {
  if (instances.length > 0) {
    return instanceMarkersForItem(item, category, instances, (obsId) =>
      focusedObservationId && obsId === focusedObservationId ? "primary" : emphasis);
  }
  return evidenceMarkersForItem(item, category, emphasis);
}

/** What's on the drawing when nothing is selected — every type's real,
 *  available markings, all equally muted ("here's what Cunstruct has
 *  detection/evidence for"), nothing singled out yet. */
export function markersForAll(groups: CategoryGroup[], instancesByItemId: Map<string, TypeInstance[]>): DrawingMarker[] {
  const out: DrawingMarker[] = [];
  for (const group of groups) {
    for (const card of group.types) {
      out.push(...markersForItem(card.reviewItem, group.category, instancesByItemId.get(card.reviewItem.id) ?? [], "muted"));
    }
  }
  return out;
}

/** A category is selected — every type IN that category gets the
 *  "secondary" (visibly emphasized) treatment; other categories contribute
 *  nothing (kept off the canvas entirely, not merely dimmed, so the emphasis
 *  reads unambiguously). */
export function markersForCategory(group: CategoryGroup, instancesByItemId: Map<string, TypeInstance[]>): DrawingMarker[] {
  const out: DrawingMarker[] = [];
  for (const card of group.types) {
    out.push(...markersForItem(card.reviewItem, group.category, instancesByItemId.get(card.reviewItem.id) ?? [], "secondary"));
  }
  return out;
}

/** A type is selected — ALL of its real instances (or its own evidence, when
 *  no LOCATION data exists) are highlighted together, answering "these are
 *  the occurrences that make up this type." */
export function markersForType(
  item: StoredReviewItem, category: ElementCategory, instances: TypeInstance[],
): DrawingMarker[] {
  return markersForItem(item, category, instances, "secondary");
}

/** One specific instance is focused — it gets "primary" treatment; its
 *  siblings stay visible but subordinate ("secondary"), never hidden — the
 *  reviewer should still see where the other occurrences are while
 *  inspecting one of them. Falls back to markersForType's behavior when the
 *  requested observation isn't actually one of this type's instances. */
export function markersForInstance(
  item: StoredReviewItem, category: ElementCategory, instances: TypeInstance[], focusedObservationId: string,
): DrawingMarker[] {
  return markersForItem(item, category, instances, "secondary", focusedObservationId);
}
