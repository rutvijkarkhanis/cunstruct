import { describe, it, expect } from "vitest";
import {
  buildProviderRequest,
  assertNoForbiddenData,
  type AuthorizedProjectScope,
  type SelectedInput,
} from "./aiBoundary";

const SCOPE_ON: AuthorizedProjectScope = { projectId: "proj-A", aiProcessingEnabled: true };
const SCOPE_OFF: AuthorizedProjectScope = { projectId: "proj-A", aiProcessingEnabled: false };

const input = (o: Partial<SelectedInput> = {}): SelectedInput => ({
  kind: "document_content", ref: "doc-1", content: "room 3.0 x 4.0", ...o,
});

describe("buildProviderRequest — minimum-data principle", () => {
  it("includes ONLY the explicitly selected items for the authorised project", () => {
    const req = buildProviderRequest("analysis", SCOPE_ON, [input(), input({ ref: "doc-2", content: "wall area 120" })], "cor-1");
    expect(req.operation).toBe("analysis");
    expect(req.inputs.projectId).toBe("proj-A");
    expect(req.inputs.items).toHaveLength(2);
    expect(req.inputs.items.map((i) => i.ref)).toEqual(["doc-1", "doc-2"]);
    // No provider/model is chosen here — resolved server-side later.
    expect(req.provider).toBeUndefined();
  });

  it("refuses to send confidential data when the project has NOT enabled AI", () => {
    expect(() => buildProviderRequest("analysis", SCOPE_OFF, [input()], "cor-1")).toThrow(/not enabled/i);
  });

  it("never sends credentials/PII kinds even with AI enabled", () => {
    expect(() => buildProviderRequest("analysis", SCOPE_ON, [input({ kind: "credential", content: "x" })], "c")).toThrow(/never sent/i);
    expect(() => buildProviderRequest("analysis", SCOPE_ON, [input({ kind: "user_pii", content: "x" })], "c")).toThrow(/never sent/i);
  });

  it("requires an authorised project scope — a bare id/key is not enough to build a request", () => {
    expect(() => buildProviderRequest("analysis", { projectId: "", aiProcessingEnabled: true }, [input()], "c"))
      .toThrow(/authorised project scope/i);
  });

  it("rejects inputs that smuggle forbidden data (service role, api key, supabase url)", () => {
    expect(() => buildProviderRequest("analysis", SCOPE_ON, [input({ content: "here is the service_role key" })], "c")).toThrow(/forbidden data/i);
    expect(() => buildProviderRequest("analysis", SCOPE_ON, [input({ content: "Authorization: Bearer abc" })], "c")).toThrow(/forbidden data/i);
    expect(() => buildProviderRequest("analysis", SCOPE_ON, [input({ ref: "VITE_SUPABASE_URL" })], "c")).toThrow(/forbidden data/i);
  });
});

describe("assertNoForbiddenData", () => {
  it("passes clean measurement content", () => {
    expect(() => assertNoForbiddenData("living room 12 x 16, wall area 340 sqft")).not.toThrow();
  });
  it("catches credential and DB-internal markers", () => {
    for (const bad of ["service_role", "api_key=123", "sb_secret_xyz", "sk-abc123", "publishable_key"]) {
      expect(() => assertNoForbiddenData(`payload with ${bad}`)).toThrow();
    }
  });
});
