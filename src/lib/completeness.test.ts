import { describe, it, expect } from "vitest";
import {
  auditCompleteness,
  summariseCompleteness,
  type ExpectedComponent,
  type GeneratedComponent,
} from "./completeness";

const EXPECTED: ExpectedComponent[] = [
  { key: "flooring", name: "Flooring", moduleKey: "finishes" },
  { key: "painting", name: "Internal Paint", moduleKey: "finishes" },
  { key: "kitchen_counter", name: "Kitchen Counter", moduleKey: "interior_joinery" },
  { key: "reinforcement", name: "RCC Reinforcement", moduleKey: "civil_structural" },
  { key: "hvac", name: "HVAC", moduleKey: "hvac" },
];

describe("auditCompleteness", () => {
  it("distinguishes COMPLETE, DETECTED_BUT_UNQUANTIFIED, APPLICABLE_BUT_MISSING and NOT_APPLICABLE", () => {
    const generated: GeneratedComponent[] = [
      { key: "flooring", status: "MEASURED", qty: 1200 },        // COMPLETE
      { key: "kitchen_counter", status: "PENDING", qty: null },  // DETECTED_BUT_UNQUANTIFIED
      // painting expected but not generated → APPLICABLE_BUT_MISSING
      // reinforcement expected but not generated (module applicable) → APPLICABLE_BUT_MISSING
      // hvac module not applicable → NOT_APPLICABLE
    ];
    const rows = auditCompleteness({
      applicableModules: ["finishes", "interior_joinery", "civil_structural"],
      expected: EXPECTED,
      generated,
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.status]));
    expect(byKey.flooring).toBe("COMPLETE");
    expect(byKey.kitchen_counter).toBe("DETECTED_BUT_UNQUANTIFIED");
    expect(byKey.painting).toBe("APPLICABLE_BUT_MISSING");
    expect(byKey.reinforcement).toBe("APPLICABLE_BUT_MISSING");
    expect(byKey.hvac).toBe("NOT_APPLICABLE");
  });

  it("reports INFORMATION_UNAVAILABLE when the source module is flagged absent", () => {
    const rows = auditCompleteness({
      applicableModules: ["civil_structural"],
      expected: [EXPECTED[3]], // reinforcement
      generated: [],
      unavailableModules: ["civil_structural"], // structural drawings absent
    });
    expect(rows[0].status).toBe("INFORMATION_UNAVAILABLE");
  });

  it("treats a PENDING component in an unavailable module as INFORMATION_UNAVAILABLE", () => {
    const rows = auditCompleteness({
      applicableModules: ["civil_structural"],
      expected: [EXPECTED[3]],
      generated: [{ key: "reinforcement", status: "PENDING", qty: null }],
      unavailableModules: ["civil_structural"],
    });
    expect(rows[0].status).toBe("INFORMATION_UNAVAILABLE");
  });

  it("does not count an ESTIMATED coverage quantity as missing", () => {
    const rows = auditCompleteness({
      applicableModules: ["finishes"],
      expected: [EXPECTED[1]],
      generated: [{ key: "painting", status: "ESTIMATED", qty: 40 }],
    });
    expect(rows[0].status).toBe("COMPLETE");
  });
});

describe("summariseCompleteness", () => {
  it("rolls rows up into per-verdict counts", () => {
    const rows = auditCompleteness({
      applicableModules: ["finishes", "interior_joinery", "civil_structural"],
      expected: EXPECTED,
      generated: [
        { key: "flooring", status: "MEASURED", qty: 1200 },
        { key: "kitchen_counter", status: "PENDING", qty: null },
      ],
    });
    const sum = summariseCompleteness(rows);
    expect(sum.COMPLETE).toBe(1);
    expect(sum.DETECTED_BUT_UNQUANTIFIED).toBe(1);
    expect(sum.APPLICABLE_BUT_MISSING).toBe(2);
    expect(sum.NOT_APPLICABLE).toBe(1);
  });
});
