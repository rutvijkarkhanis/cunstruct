import { describe, it, expect } from "vitest";
import { parseWorkspaceQuery, buildWorkspaceQuery, workspaceUrl, isWorkspaceMode } from "./workspaceState";

describe("isWorkspaceMode", () => {
  it("accepts every real mode", () => {
    for (const m of ["drawing", "review", "boq", "materials", "procurement", "analyze"]) {
      expect(isWorkspaceMode(m)).toBe(true);
    }
  });
  it("rejects unknown/empty values", () => {
    expect(isWorkspaceMode("bim-viewer")).toBe(false);
    expect(isWorkspaceMode(null)).toBe(false);
    expect(isWorkspaceMode(undefined)).toBe(false);
    expect(isWorkspaceMode("")).toBe(false);
  });
});

describe("parseWorkspaceQuery", () => {
  it("defaults to drawing mode with nothing selected on an empty query", () => {
    expect(parseWorkspaceQuery(new URLSearchParams(""))).toEqual({ document: null, page: null, mode: "drawing", boq: null });
  });

  it("reads document/page/mode/boq from the query string", () => {
    const params = new URLSearchParams("document=doc-1&page=3&mode=review&boq=boq-1");
    expect(parseWorkspaceQuery(params)).toEqual({ document: "doc-1", page: 3, mode: "review", boq: "boq-1" });
  });

  it("falls back to drawing mode for an unrecognized mode value — never guesses a mode", () => {
    const params = new URLSearchParams("mode=bim-viewer");
    expect(parseWorkspaceQuery(params).mode).toBe("drawing");
  });

  it("treats a non-numeric or non-positive page as null rather than fabricating one", () => {
    expect(parseWorkspaceQuery(new URLSearchParams("page=abc")).page).toBeNull();
    expect(parseWorkspaceQuery(new URLSearchParams("page=0")).page).toBeNull();
    expect(parseWorkspaceQuery(new URLSearchParams("page=-5")).page).toBeNull();
  });

  it("floors a fractional page", () => {
    expect(parseWorkspaceQuery(new URLSearchParams("page=2.9")).page).toBe(2);
  });

  it("treats a blank document/boq as absent, not an empty-string id", () => {
    const params = new URLSearchParams("document=&boq=");
    const state = parseWorkspaceQuery(params);
    expect(state.document).toBeNull();
    expect(state.boq).toBeNull();
  });
});

describe("buildWorkspaceQuery", () => {
  it("omits defaults so the common case stays a clean URL", () => {
    expect(buildWorkspaceQuery({ mode: "drawing" }).toString()).toBe("");
  });

  it("round-trips through parseWorkspaceQuery", () => {
    const original = { document: "doc-1", page: 4, mode: "review" as const, boq: "boq-1" };
    const roundTripped = parseWorkspaceQuery(buildWorkspaceQuery(original));
    expect(roundTripped).toEqual(original);
  });

  it("never writes a page param for page<=0", () => {
    expect(buildWorkspaceQuery({ page: 0 }).has("page")).toBe(false);
  });
});

describe("workspaceUrl", () => {
  it("builds the canonical workspace path with no query for the bare case", () => {
    expect(workspaceUrl("proj-1", {})).toBe("/ops/projects/proj-1/workspace");
  });

  it("builds a deep link into a specific document/page/mode/boq", () => {
    expect(workspaceUrl("proj-1", { document: "doc-1", page: 2, mode: "review", boq: "boq-1" }))
      .toBe("/ops/projects/proj-1/workspace?document=doc-1&page=2&mode=review&boq=boq-1");
  });
});
