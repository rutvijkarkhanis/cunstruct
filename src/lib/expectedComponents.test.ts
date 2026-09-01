import { describe, it, expect } from "vitest";
import {
  EXPECTED_COMPONENT_CATALOG,
  applicabilityOf,
  expectedComponentsForProject,
  expectedListForModules,
  type ExpectedComponentDef,
} from "./expectedComponents";
import { auditCompleteness } from "./completeness";

// The modules scope_module_suggestion seeds for Residential (see the taxonomy
// migration). Used as the applicable set — no project-type map is duplicated here.
const RESIDENTIAL_MODULES = [
  "civil_structural", "architectural", "electrical", "plumbing",
  "finishes", "interior_joinery", "external_works", "landscape",
];

describe("expected component catalog integrity", () => {
  const MODULE_KEYS = new Set([
    "civil_structural", "architectural", "electrical", "plumbing", "hvac", "fire_fighting",
    "fire_alarm", "elv_data_it", "interior_joinery", "finishes", "external_works", "landscape",
    "specialist_systems", "equipment_ffe",
  ]);

  it("files every component under an existing scope_module key (no parallel taxonomy)", () => {
    for (const c of EXPECTED_COMPONENT_CATALOG) expect(MODULE_KEYS.has(c.moduleKey)).toBe(true);
  });

  it("has unique component keys", () => {
    const keys = EXPECTED_COMPONENT_CATALOG.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("applicabilityOf — three-way distinction", () => {
  const flooring = EXPECTED_COMPONENT_CATALOG.find((c) => c.key === "flooring")!;
  const lift = EXPECTED_COMPONENT_CATALOG.find((c) => c.key === "lift")!;
  const hvac = EXPECTED_COMPONENT_CATALOG.find((c) => c.key === "hvac_system")!;

  it("EXPECTED when the module applies and the component is standard", () => {
    expect(applicabilityOf(flooring, RESIDENTIAL_MODULES)).toBe("EXPECTED");
  });
  it("NOT_APPLICABLE when the component's module does not apply to the project", () => {
    // HVAC isn't among Residential's suggested modules.
    expect(applicabilityOf(hvac, RESIDENTIAL_MODULES)).toBe("NOT_APPLICABLE");
  });
  it("CONDITIONAL when a discretionary component's module applies", () => {
    // Specialist systems applies (e.g. Infrastructure/External); lift is discretionary.
    expect(applicabilityOf(lift, ["specialist_systems"])).toBe("CONDITIONAL");
    // But for Residential (no specialist_systems suggested) lift is NOT_APPLICABLE.
    expect(applicabilityOf(lift, RESIDENTIAL_MODULES)).toBe("NOT_APPLICABLE");
  });
});

describe("Residential coverage (covered first)", () => {
  const list = expectedComponentsForProject(RESIDENTIAL_MODULES);
  const byKey = Object.fromEntries(list.map((e) => [e.component.key, e.applicability]));

  it("expects the fundamental residential scopes", () => {
    expect(byKey.flooring).toBe("EXPECTED");
    expect(byKey.reinforcement).toBe("EXPECTED");
    expect(byKey.internal_plaster).toBe("EXPECTED");
    expect(byKey.sanitary_fixtures).toBe("EXPECTED");
    expect(byKey.wiring).toBe("EXPECTED");
    expect(byKey.kitchen_counter).toBe("EXPECTED");
  });

  it("marks discretionary joinery/landscape as CONDITIONAL, not expected", () => {
    expect(byKey.storage).toBe("CONDITIONAL");
    expect(byKey.vanity).toBe("CONDITIONAL");
    expect(byKey.landscape).toBe("CONDITIONAL");
  });

  it("omits components whose module is not applicable to Residential", () => {
    expect(byKey.hvac_system).toBeUndefined();
    expect(byKey.fire_alarm_system).toBeUndefined();
    expect(byKey.lift).toBeUndefined();
  });
});

describe("feeds the completeness engine deterministically", () => {
  it("distinguishes covered / pending / missing against generated lines", () => {
    const expected = expectedListForModules(RESIDENTIAL_MODULES);
    const rows = auditCompleteness({
      applicableModules: RESIDENTIAL_MODULES,
      expected,
      generated: [
        { key: "flooring", status: "MEASURED", qty: 1200 },     // COMPLETE
        { key: "kitchen_counter", status: "PENDING", qty: null }, // DETECTED_BUT_UNQUANTIFIED
        // reinforcement not generated → APPLICABLE_BUT_MISSING
      ],
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.status]));
    expect(byKey.flooring).toBe("COMPLETE");
    expect(byKey.kitchen_counter).toBe("DETECTED_BUT_UNQUANTIFIED");
    expect(byKey.reinforcement).toBe("APPLICABLE_BUT_MISSING");
  });
});
