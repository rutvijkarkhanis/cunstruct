// Reference data for the completeness engine: the standard BOQ components that
// belong to each scope module, and how applicable each is to a given project.
//
// This is DERIVED FROM THE EXISTING taxonomy, not a new one:
//   * every component is filed under an existing `scope_module.key`
//     (civil_structural … equipment_ffe — see 20260910000000_scope_taxonomy.sql);
//   * per-project applicability is read from the existing
//     `scope_module_suggestion` catalogue (the project-type → module hints),
//     supplied by the caller as `applicableModuleKeys`.
//
// It invents no quantities and no ratios — only the well-known scope breakdown of
// a construction BOQ, grouped by the modules Cunstruct already defines. Each
// component is EXPECTED, CONDITIONAL (discretionary — e.g. lift, pool, FF&E), or
// NOT_APPLICABLE (its module doesn't apply to this project).

import type { ExpectedComponent } from "./completeness";

export type Applicability = "EXPECTED" | "CONDITIONAL" | "NOT_APPLICABLE";

export interface ExpectedComponentDef extends ExpectedComponent {
  /** Discretionary even when its module applies (quoted only if the project has it). */
  conditional?: boolean;
}

// Standard components per existing scope module. Keys are stable machine keys.
// (Names mirror ordinary Indian building-BOQ scope; nothing here is a ratio.)
export const EXPECTED_COMPONENT_CATALOG: ExpectedComponentDef[] = [
  // ── Civil / Structural ──
  { moduleKey: "civil_structural", key: "pcc", name: "PCC" },
  { moduleKey: "civil_structural", key: "foundations", name: "Foundations / footings" },
  { moduleKey: "civil_structural", key: "columns", name: "Columns" },
  { moduleKey: "civil_structural", key: "beams", name: "Beams" },
  { moduleKey: "civil_structural", key: "slabs", name: "Slabs" },
  { moduleKey: "civil_structural", key: "staircase", name: "Staircase" },
  { moduleKey: "civil_structural", key: "reinforcement", name: "Reinforcement" },
  { moduleKey: "civil_structural", key: "formwork", name: "Formwork / shuttering" },

  // ── Architectural (masonry, plaster, openings) ──
  { moduleKey: "architectural", key: "external_masonry", name: "External masonry" },
  { moduleKey: "architectural", key: "internal_partitions", name: "Internal partitions" },
  { moduleKey: "architectural", key: "parapets", name: "Parapets" },
  { moduleKey: "architectural", key: "internal_plaster", name: "Internal plaster" },
  { moduleKey: "architectural", key: "external_plaster", name: "External plaster" },
  { moduleKey: "architectural", key: "ceiling_plaster", name: "Ceiling plaster" },
  { moduleKey: "architectural", key: "doors", name: "Doors" },
  { moduleKey: "architectural", key: "windows", name: "Windows" },

  // ── Finishes ──
  { moduleKey: "finishes", key: "flooring", name: "Flooring" },
  { moduleKey: "finishes", key: "skirting", name: "Skirting" },
  { moduleKey: "finishes", key: "wall_tiles", name: "Wall tiles" },
  { moduleKey: "finishes", key: "bathroom_tiles", name: "Bathroom tiles" },
  { moduleKey: "finishes", key: "kitchen_dado", name: "Kitchen dado" },
  { moduleKey: "finishes", key: "putty", name: "Putty" },
  { moduleKey: "finishes", key: "primer", name: "Primer" },
  { moduleKey: "finishes", key: "internal_paint", name: "Internal paint" },
  { moduleKey: "finishes", key: "external_paint", name: "External paint" },
  { moduleKey: "finishes", key: "waterproofing", name: "Waterproofing" },

  // ── Plumbing / Sanitary ──
  { moduleKey: "plumbing", key: "sanitary_fixtures", name: "Sanitary fixtures" },
  { moduleKey: "plumbing", key: "water_supply", name: "Water supply" },
  { moduleKey: "plumbing", key: "drainage", name: "Drainage" },
  { moduleKey: "plumbing", key: "rainwater", name: "Rainwater" },
  { moduleKey: "plumbing", key: "pumps", name: "Pumps", conditional: true },
  { moduleKey: "plumbing", key: "tanks", name: "Tanks", conditional: true },

  // ── Electrical / ELV ──
  { moduleKey: "electrical", key: "db", name: "Distribution board" },
  { moduleKey: "electrical", key: "wiring", name: "Wiring" },
  { moduleKey: "electrical", key: "conduit", name: "Conduit" },
  { moduleKey: "electrical", key: "switches_sockets", name: "Switches & sockets" },
  { moduleKey: "electrical", key: "lighting", name: "Lighting" },
  { moduleKey: "electrical", key: "fans", name: "Fans" },
  { moduleKey: "electrical", key: "earthing", name: "Earthing" },

  // ── Interior / Joinery ──
  { moduleKey: "interior_joinery", key: "kitchen_counter", name: "Kitchen counter" },
  { moduleKey: "interior_joinery", key: "wardrobes", name: "Wardrobes" },
  { moduleKey: "interior_joinery", key: "storage", name: "Storage units", conditional: true },
  { moduleKey: "interior_joinery", key: "vanity", name: "Vanity / mirror", conditional: true },

  // ── HVAC / Fire / ELV-data (whole-system line items) ──
  { moduleKey: "hvac", key: "hvac_system", name: "HVAC system" },
  { moduleKey: "fire_fighting", key: "fire_fighting_system", name: "Fire fighting system" },
  { moduleKey: "fire_alarm", key: "fire_alarm_system", name: "Fire alarm system" },
  { moduleKey: "elv_data_it", key: "data_it", name: "Data / IT / ELV" },

  // ── External works ──
  { moduleKey: "external_works", key: "paving", name: "Paving" },
  { moduleKey: "external_works", key: "driveway_parking", name: "Driveway / parking" },
  { moduleKey: "external_works", key: "gate", name: "Gate", conditional: true },
  { moduleKey: "external_works", key: "external_drainage", name: "External drainage" },
  { moduleKey: "external_works", key: "external_lighting", name: "External lighting" },

  // ── Landscape ──
  { moduleKey: "landscape", key: "landscape", name: "Landscape / greenscape", conditional: true },

  // ── Specialist systems (always discretionary) ──
  { moduleKey: "specialist_systems", key: "lift", name: "Lift", conditional: true },
  { moduleKey: "specialist_systems", key: "swimming_pool", name: "Swimming pool", conditional: true },
  { moduleKey: "specialist_systems", key: "oht", name: "Overhead tank / water systems", conditional: true },

  // ── Equipment / FF&E (always discretionary) ──
  { moduleKey: "equipment_ffe", key: "ffe", name: "Equipment / FF&E", conditional: true },
];

/**
 * Classify one component's applicability to a project, given which scope modules
 * apply to it (from the existing scope_module_suggestion catalogue).
 *   - module not applicable            → NOT_APPLICABLE
 *   - applicable but discretionary      → CONDITIONAL
 *   - applicable and standard           → EXPECTED
 */
export function applicabilityOf(def: ExpectedComponentDef, applicableModuleKeys: Iterable<string>): Applicability {
  const applicable = applicableModuleKeys instanceof Set ? applicableModuleKeys : new Set(applicableModuleKeys);
  if (!applicable.has(def.moduleKey)) return "NOT_APPLICABLE";
  return def.conditional ? "CONDITIONAL" : "EXPECTED";
}

/**
 * The expected components for a project, given its applicable scope modules.
 * `EXPECTED` and `CONDITIONAL` components are returned (both belong in the BOQ
 * for consideration); `NOT_APPLICABLE` ones are omitted. Deterministic.
 */
export function expectedComponentsForProject(
  applicableModuleKeys: Iterable<string>,
): { component: ExpectedComponent; applicability: Applicability }[] {
  const applicable = new Set(applicableModuleKeys);
  const out: { component: ExpectedComponent; applicability: Applicability }[] = [];
  for (const def of EXPECTED_COMPONENT_CATALOG) {
    const applicability = applicabilityOf(def, applicable);
    if (applicability === "NOT_APPLICABLE") continue;
    out.push({ component: { key: def.key, name: def.name, moduleKey: def.moduleKey }, applicability });
  }
  return out;
}

/** Just the ExpectedComponent list for the completeness engine's `expected` field. */
export function expectedListForModules(applicableModuleKeys: Iterable<string>): ExpectedComponent[] {
  return expectedComponentsForProject(applicableModuleKeys).map((e) => e.component);
}
