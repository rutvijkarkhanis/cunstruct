import { describe, it, expect } from "vitest";
import { parsePublicShareQuery, buildPublicShareQuery, publicShareUrl } from "./publicShareState";

describe("parsePublicShareQuery", () => {
  it("defaults to nothing selected on an empty query", () => {
    expect(parsePublicShareQuery(new URLSearchParams(""))).toEqual({ document: null, page: null, boq: null });
  });

  it("reads document/page/boq from the query string", () => {
    const params = new URLSearchParams("document=doc-1&page=3&boq=boq-1");
    expect(parsePublicShareQuery(params)).toEqual({ document: "doc-1", page: 3, boq: "boq-1" });
  });

  it("treats a non-numeric or non-positive page as null rather than fabricating one", () => {
    expect(parsePublicShareQuery(new URLSearchParams("page=abc")).page).toBeNull();
    expect(parsePublicShareQuery(new URLSearchParams("page=0")).page).toBeNull();
    expect(parsePublicShareQuery(new URLSearchParams("page=-5")).page).toBeNull();
  });

  it("floors a fractional page", () => {
    expect(parsePublicShareQuery(new URLSearchParams("page=2.9")).page).toBe(2);
  });

  it("treats a blank document/boq as absent, not an empty-string id", () => {
    const params = new URLSearchParams("document=&boq=");
    const state = parsePublicShareQuery(params);
    expect(state.document).toBeNull();
    expect(state.boq).toBeNull();
  });

  it("has no mode field at all — nothing to parse or default", () => {
    const state = parsePublicShareQuery(new URLSearchParams("mode=review"));
    expect(state).not.toHaveProperty("mode");
  });
});

describe("buildPublicShareQuery", () => {
  it("omits defaults so the common case stays a clean URL", () => {
    expect(buildPublicShareQuery({}).toString()).toBe("");
  });

  it("round-trips through parsePublicShareQuery", () => {
    const original = { document: "doc-1", page: 4, boq: "boq-1" };
    const roundTripped = parsePublicShareQuery(buildPublicShareQuery(original));
    expect(roundTripped).toEqual(original);
  });

  it("never writes a page param for page<=0", () => {
    expect(buildPublicShareQuery({ page: 0 }).has("page")).toBe(false);
  });
});

describe("publicShareUrl", () => {
  it("builds the canonical share path with no query for the bare case", () => {
    expect(publicShareUrl("tok-1", {})).toBe("/share/tok-1");
  });

  it("builds a deep link into a specific document/page/boq", () => {
    expect(publicShareUrl("tok-1", { document: "doc-1", page: 2, boq: "boq-1" }))
      .toBe("/share/tok-1?document=doc-1&page=2&boq=boq-1");
  });
});
