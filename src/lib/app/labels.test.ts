import { describe, it, expect } from "vitest";
import { sectionLabel, revisionLabel, UNASSIGNED_SECTION_LABEL } from "./labels";
import { DRAWING_REVIEW_SECTION } from "@/lib/applyFinding";

describe("sectionLabel", () => {
  it("never exposes the internal review section name", () => {
    expect(sectionLabel(DRAWING_REVIEW_SECTION)).toBe(UNASSIGNED_SECTION_LABEL);
    expect(sectionLabel(DRAWING_REVIEW_SECTION)).not.toMatch(/Drawing review/);
  });
  it("labels missing sections Unassigned and keeps real trades", () => {
    expect(sectionLabel(null)).toBe("Unassigned");
    expect(sectionLabel("  ")).toBe("Unassigned");
    expect(sectionLabel("Brickwork")).toBe("Brickwork");
  });
});

describe("revisionLabel", () => {
  it("does not double the Rev prefix", () => {
    expect(revisionLabel("Rev A")).toBe("Rev A");
    expect(revisionLabel("rev b")).toBe("Rev b");
    expect(revisionLabel("Rev. C")).toBe("Rev C");
    expect(revisionLabel("REV-2")).toBe("Rev 2");
    expect(revisionLabel("Rev2")).toBe("Rev 2");
  });
  it("adds the prefix to a bare label", () => {
    expect(revisionLabel("A")).toBe("Rev A");
    expect(revisionLabel("3")).toBe("Rev 3");
  });
  it("does not treat words that merely start with 'rev' as prefixed", () => {
    expect(revisionLabel("Revised layout")).toBe("Rev Revised layout");
  });
  it("returns null when there is no label", () => {
    expect(revisionLabel(null)).toBeNull();
    expect(revisionLabel("")).toBeNull();
  });
});
