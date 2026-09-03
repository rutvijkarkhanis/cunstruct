import { describe, it, expect } from "vitest";
import { matchFindingToLine, linkFindings, type BoqLineRef } from "@/lib/auditFindings";
import type { AuditFinding } from "@/lib/auditJson";

// external_key (and a raw BOQ line id) IDENTIFY an item — they must never GRANT
// access to it. Authorization is always the caller's authorized line set: an
// imported finding can only ever attach to a line the caller already passed in
// (i.e. lines from the authorized project's BOQ). These tests prove that a
// finding referencing a line OUTSIDE the authorized set is dropped, not attached.

// The lines the caller is authorized to see (this project's BOQ only).
const AUTHORIZED_LINES: BoqLineRef[] = [
  { id: "line-A1", description: "Flooring", externalKey: "PROJ-A-FLR" },
  { id: "line-A2", description: "Wardrobe", externalKey: "PROJ-A-WR" },
];

describe("external_key does not bypass authorization", () => {
  it("a finding naming another project's external_key does not attach to any authorized line", () => {
    const finding: AuditFinding = { findingType: "METHODOLOGY_ERROR", item: "Wardrobe", externalKey: "PROJ-B-WR" };
    expect(matchFindingToLine(finding, AUTHORIZED_LINES)).toBeNull();
  });

  it("a foreign boq_line_id is never returned; matching only ever stays in the authorized set", () => {
    // Foreign id + an item that doesn't text-match anything authorized → null.
    const foreignOnly: AuditFinding = { findingType: "QUANTITY_ERROR", item: "Terrace deck", boqLineId: "line-B9" };
    expect(matchFindingToLine(foreignOnly, AUTHORIZED_LINES)).toBeNull();

    // Foreign id but a matching description → falls back to the AUTHORIZED line,
    // never the foreign one. The result is always within the authorized set.
    const foreignWithText: AuditFinding = { findingType: "QUANTITY_ERROR", item: "Flooring", boqLineId: "line-B9" };
    const result = matchFindingToLine(foreignWithText, AUTHORIZED_LINES);
    expect(result).not.toBe("line-B9");
    expect(result == null || AUTHORIZED_LINES.some((l) => l.id === result)).toBe(true);
  });

  it("knowing a valid external_key only resolves within the authorized set", () => {
    const finding: AuditFinding = { findingType: "UNIT_ERROR", item: "Flooring", externalKey: "PROJ-A-FLR" };
    expect(matchFindingToLine(finding, AUTHORIZED_LINES)).toBe("line-A1");
  });

  it("linkFindings never carries a foreign boq_line_id through to persistence", () => {
    const findings: AuditFinding[] = [
      { findingType: "METHODOLOGY_ERROR", item: "Wardrobe from project B", externalKey: "PROJ-B-WR" },
      { findingType: "OTHER", item: "Balcony", boqLineId: "line-B9" },
    ];
    const linked = linkFindings(findings, AUTHORIZED_LINES);
    // Neither matches an authorized line (no text/key match), and crucially no
    // foreign id is carried through.
    expect(linked.every((f) => f.matched === false)).toBe(true);
    expect(linked.every((f) => f.boqLineId === undefined || AUTHORIZED_LINES.some((l) => l.id === f.boqLineId))).toBe(true);
    expect(linked[1].boqLineId).toBeUndefined();
  });
});
