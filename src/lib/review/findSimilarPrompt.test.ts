import { describe, it, expect } from "vitest";
import { buildFindSimilarPrompt } from "./findSimilarPrompt";

describe("buildFindSimilarPrompt", () => {
  it("includes the reference label and description", () => {
    const prompt = buildFindSimilarPrompt({ reference: { label: "Door", description: "Single leaf door", evidence: [] } });
    expect(prompt).toContain("Door");
    expect(prompt).toContain("Single leaf door");
  });

  it("includes the reference's evidence location(s) when present", () => {
    const prompt = buildFindSimilarPrompt({
      reference: { label: "Window", evidence: [{ bbox: [10, 20, 30, 40], page: 3 }] },
    });
    expect(prompt).toContain("page 3");
    expect(prompt).toContain("[10, 20, 30, 40]");
  });

  it("never fabricates a location line when the reference has no evidence", () => {
    const prompt = buildFindSimilarPrompt({ reference: { label: "Column", evidence: [] } });
    expect(prompt).not.toContain("bbox [");
  });

  it("instructs the model to search the entire document, not just the reference's own page", () => {
    const prompt = buildFindSimilarPrompt({ reference: { label: "Door", evidence: [] } });
    expect(prompt.toLowerCase()).toContain("entire document");
  });

  it("instructs the model to return separate matches rather than collapsing occurrences", () => {
    const prompt = buildFindSimilarPrompt({ reference: { label: "Door", evidence: [] } });
    expect(prompt.toLowerCase()).toContain("never collapse");
  });

  it("instructs the model to include uncertain/partial matches rather than dropping them", () => {
    const prompt = buildFindSimilarPrompt({ reference: { label: "Door", evidence: [] } });
    expect(prompt.toLowerCase()).toContain("uncertain or partial matches");
  });

  it("instructs an honest empty result when nothing credible is found", () => {
    const prompt = buildFindSimilarPrompt({ reference: { label: "Door", evidence: [] } });
    expect(prompt).toContain("EMPTY matches array");
  });

  it("instructs the model to distinguish visually similar but semantically different elements", () => {
    const prompt = buildFindSimilarPrompt({ reference: { label: "Door", evidence: [] } });
    expect(prompt.toLowerCase()).toContain("semantically different");
  });

  it("instructs the model never to report a quantity, BOQ item, or count", () => {
    const prompt = buildFindSimilarPrompt({ reference: { label: "Door", evidence: [] } });
    const lower = prompt.toLowerCase();
    expect(lower).toContain("never report a quantity");
    expect(lower).toContain("never imply or infer a count");
  });

  it("instructs the model never to include the reference element itself as a match", () => {
    const prompt = buildFindSimilarPrompt({ reference: { label: "Door", evidence: [] } });
    expect(prompt.toLowerCase()).toContain("do not include the reference element itself");
  });
});
