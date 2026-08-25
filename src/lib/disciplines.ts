// Multi-discipline BOQ. A project can have one BOQ per discipline. Civil is
// generated from the DSR knowledge bank; the MEP disciplines (Electrical,
// Plumbing, HVAC, Fire) use curated item catalogues sized from the same project
// parameters + room dimensions. MEP rates are left for case-by-case pricing
// (no DSR code) except where the DSR genuinely covers the item (plumbing).

import { buildContext, type QtyContext, type RoomDims } from "./boqDsrCatalog";
import { generateLines, type GeneratedLine, type ProjectBasics } from "./boqDsrGenerate";
import { applyDrawing, defaultBasis, type DrawingSummary } from "./boqDrawing";
import { withinAllocation, allocationFloors, type BoqScope } from "./boqAllocation";
import { withAssessableDisciplines } from "./boqDiscipline";
import { withQuantityEvidence } from "./boqEvidence";
import type { Spec } from "./boqSpec";

export interface DiscItem {
  section: string;
  label: string;
  unit: string;
  code?: string | null;                       // DSR code where the item is scheduled, else null
  qty: (c: QtyContext, spec: Spec) => number;
  when?: (spec: Spec) => boolean;
  scope?: BoqScope;                            // allocation layer (default: "unit")
}
export interface Discipline {
  key: string;
  name: string;
  short: string;
  civil?: boolean;                            // civil uses the DSR engine
  items?: DiscItem[];                         // MEP catalogue
}

const truthy = (v: unknown) => v === true || v === "true";
const density = (s: Spec) => (s.elec_density === "premium" ? 12 : s.elec_density === "basic" ? 6 : 9);

// ---- Electrical (rates case-by-case) ---------------------------------------
const ELECTRICAL: DiscItem[] = [
  { section: "Wiring & Points", label: "Concealed wiring for light/fan/call-bell points with modular switches", unit: "point",
    qty: (c, s) => c.rooms * density(s) },
  { section: "Wiring & Points", label: "Power plug points (16A) with modular sockets", unit: "point",
    qty: (c) => c.rooms * 2 + c.kitchens * 3 },
  { section: "Wiring & Points", label: "AC / geyser dedicated power points (20A)", unit: "point",
    qty: (c) => c.beds + c.baths },
  { section: "Cabling & Conduit", label: "Concealed PVC conduit with FRLS copper wiring (sub-circuits)", unit: "metre",
    qty: (c) => c.floorSqm * 1.6 },
  { section: "DB & Panels", label: "Distribution board with MCBs / RCCB, complete", unit: "nos",
    qty: (c) => Math.max(1, c.floors) },
  { section: "DB & Panels", label: "Main panel / meter board with incomer & earthing", unit: "nos",
    qty: () => 1, scope: "building" },        // building service intake — shared
  { section: "Earthing & Protection", label: "Earthing station (GI/copper) with earth pit", unit: "nos",
    qty: () => 2, scope: "building" },        // building earthing — shared
  { section: "Fixtures", label: "Light fittings, ceiling fans & exhaust fans (supply & install)", unit: "nos",
    qty: (c) => c.rooms * 4 + c.baths },
];

// ---- Plumbing (DSR-scheduled where available + NS) -------------------------
const PLUMBING: DiscItem[] = [
  { section: "Water Supply", label: "CPVC concealed water supply piping with fittings", unit: "metre", code: "18.8.1",
    qty: (c) => c.baths * 12 + c.kitchens * 6 },
  { section: "Drainage", label: "Cast-iron / uPVC soil, waste & vent piping", unit: "metre", code: "17.35.1.1",
    qty: (c) => c.baths * 8 },
  { section: "Sanitary Fixtures", label: "European WC with seat & cistern, complete", unit: "nos", code: "17.2.1",
    qty: (c) => c.baths },
  { section: "Sanitary Fixtures", label: "Wash basin with CP fittings, complete", unit: "nos", code: "17.7.3",
    qty: (c) => c.baths },
  { section: "Sanitary Fixtures", label: "CP fittings — bib cocks, taps, health faucet, floor trap", unit: "nos", code: "18.49.1",
    qty: (c) => c.baths * 5 },
  { section: "Tanks & Pumps", label: "Overhead water storage tank with fittings", unit: "nos",
    qty: () => 1, when: (s) => truthy(s.oht), scope: "building" },
  { section: "Tanks & Pumps", label: "Underground water sump with fittings", unit: "nos",
    qty: () => 1, when: (s) => truthy(s.sump), scope: "building" },
  { section: "Tanks & Pumps", label: "Water pump / pressure pump set", unit: "nos",
    qty: () => 1, when: (s) => truthy(s.pump), scope: "building" },
  { section: "Hot Water", label: "Geyser / water heater with points & connections", unit: "nos",
    qty: (c) => c.baths, when: (s) => truthy(s.geyser) },
];

// ---- HVAC (rates case-by-case) ---------------------------------------------
const HVAC: DiscItem[] = [
  { section: "Air Conditioning", label: "Split air-conditioning units (1.5 TR) with indoor/outdoor units", unit: "nos",
    qty: (c) => c.beds + c.living },
  { section: "Air Conditioning", label: "Refrigerant copper piping, drain & cabling per unit", unit: "metre",
    qty: (c) => (c.beds + c.living) * 5 },
  { section: "Ventilation", label: "Exhaust / ventilation fans with ducting", unit: "nos",
    qty: (c) => c.baths + c.kitchens },
  { section: "Ventilation", label: "Fresh-air / kitchen chimney ducting", unit: "metre",
    qty: (c) => c.kitchens * 6 },
];

// ---- Fire fighting & alarm (rates case-by-case) ----------------------------
const FIRE: DiscItem[] = [
  { section: "Fire Protection", label: "Portable fire extinguishers (ABC type, 4/6 kg)", unit: "nos",
    qty: (c) => Math.max(2, c.floors * 2) },
  { section: "Fire Alarm", label: "Smoke / heat detectors with wiring", unit: "nos",
    qty: (c) => c.rooms + c.floors },
  { section: "Fire Alarm", label: "Fire alarm control panel with hooter, complete", unit: "nos",
    qty: () => 1, scope: "building" },        // building fire panel — shared
  { section: "Fire Protection", label: "Fire hydrant / hose reel points (where applicable)", unit: "nos",
    qty: (c) => c.floors, scope: "common" },  // common-area fire hydrant
];

export const DISCIPLINES: Discipline[] = [
  { key: "civil", name: "Civil Works", short: "Civil", civil: true },
  { key: "plumbing", name: "Plumbing Works", short: "Plumbing", items: PLUMBING },
  { key: "electrical", name: "Electrical Works", short: "Electrical", items: ELECTRICAL },
  { key: "hvac", name: "HVAC Works", short: "HVAC", items: HVAC },
  { key: "fire", name: "Fire Fighting & Alarm", short: "Fire", items: FIRE },
];

export const disciplineByKey = (key: string) => DISCIPLINES.find((d) => d.key === key) ?? DISCIPLINES[0];

/** Generate BOQ lines for any discipline: civil via the DSR engine, MEP via its catalogue. */
export function generateForDiscipline(key: string, spec: Spec, project: ProjectBasics, dims?: RoomDims): GeneratedLine[] {
  // A per-floor / per-unit BOQ covers ONE floor of work, so whole-building scaling
  // (× floors) must collapse to one — otherwise a Floor-1 BOQ inherits the whole
  // building's structural / envelope quantities. Whole-project BOQs keep the count.
  const floors = allocationFloors(spec, project.floors);
  const proj: ProjectBasics = { area_sqft: project.area_sqft, floors };
  let out: GeneratedLine[];
  if (key === "civil") {
    out = generateLines(spec, proj, dims);
  } else {
    const disc = disciplineByKey(key);
    if (!disc.items) return [];
    const ctx = buildContext(spec, { area_sqft: proj.area_sqft, floors }, dims);
    out = [];
    for (const it of disc.items) {
      if (it.when && !it.when(spec)) continue;
      const qty = Math.round(it.qty(ctx, spec) * 100) / 100;
      if (qty <= 0) continue;
      out.push({ section: it.section, code: it.code ?? null, qty, label: it.label, unit: it.unit, ns: !it.code, scope: it.scope ?? "unit" });
    }
  }
  // Stamp a fallback provenance on every line (measured rooms → derived; else
  // coefficient/heuristic).
  const hasRooms = !!dims;
  out = out.map((l) => ({ ...l, basis: defaultBasis(l, hasRooms) }));
  // ALLOCATION BOUNDARY: keep only the candidate items whose scope layer this
  // BOQ's allocation owns. A private-floor / unit BOQ drops site / substructure /
  // structure / building / common candidates (they belong to other BOQs); a
  // whole-project BOQ keeps everything. Drawing-derived lines are never dropped.
  out = withinAllocation(out, spec);
  // DISCIPLINE EVIDENCE GATE: on a drawing-driven BOQ, withhold any discipline
  // that has no evidence in the supplied drawing set — no structural drawing
  // means no invented RCC/excavation/masonry, etc. A pure questionnaire BOQ is
  // not gated (the questionnaire is the intent). Drawing lines are never withheld.
  out = withAssessableDisciplines(out, spec);
  // Then let the operator's drawing summary override the items it explicitly
  // covers, append drawing-only requirements, and supersede duplicated template
  // scope. Everything else keeps its assumption basis.
  const summary = (spec as Record<string, unknown>)._drawing as DrawingSummary | undefined;
  out = applyDrawing(out, summary);
  // QUANTITY EVIDENCE GATE: on a drawing-driven BOQ the catalogue may supply the
  // item + rate but never a fabricated quantity. Keep only lines whose quantity is
  // backed by the drawing (counted/measured) or an entered measurement; withhold
  // catalogue coefficient / area-heuristic quantities. Drawing requirements the
  // drawing could not quantify remain as pending (qty null) in spec._drawing and
  // render separately. A questionnaire/archetype BOQ is returned unchanged.
  return withQuantityEvidence(out, spec);
}
