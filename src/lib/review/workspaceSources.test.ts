import { describe, it, expect } from "vitest";
import { groupSourcesByDiscipline, type SourceDocument } from "./workspaceSources";

function doc(overrides: Partial<SourceDocument> & { id: string; name: string }): SourceDocument {
  return { docType: null, discipline: null, status: "uploaded", pageCount: null, ...overrides };
}

describe("groupSourcesByDiscipline", () => {
  it("groups by the document's own discipline field", () => {
    const groups = groupSourcesByDiscipline([
      doc({ id: "a", name: "Ground Floor", discipline: "Architectural" }),
      doc({ id: "b", name: "Structural Plan", discipline: "Structural" }),
      doc({ id: "c", name: "First Floor", discipline: "Architectural" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Architectural", "Structural"]);
    expect(groups[0].documents.map((d) => d.id)).toEqual(["a", "c"]);
  });

  it("falls back to docType when discipline is absent", () => {
    const groups = groupSourcesByDiscipline([doc({ id: "a", name: "Spec", discipline: null, docType: "specification" })]);
    expect(groups[0].label).toBe("specification");
  });

  it("falls back to 'Other' when neither discipline nor docType is set — never invents a grouping", () => {
    const groups = groupSourcesByDiscipline([doc({ id: "a", name: "Mystery doc" })]);
    expect(groups[0].label).toBe("Other");
  });

  it("always places 'Other' last, regardless of input order", () => {
    const groups = groupSourcesByDiscipline([
      doc({ id: "a", name: "Mystery" }),
      doc({ id: "b", name: "Ground Floor", discipline: "Architectural" }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Architectural", "Other"]);
  });

  it("returns an empty array for no documents", () => {
    expect(groupSourcesByDiscipline([])).toEqual([]);
  });
});
