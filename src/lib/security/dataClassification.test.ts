import { describe, it, expect } from "vitest";
import {
  classify,
  isPublic,
  canSendToProvider,
  assertSendableToProvider,
} from "./dataClassification";

describe("data classification", () => {
  it("treats project drawings and documents as CONFIDENTIAL by default", () => {
    expect(classify("project_document")).toBe("CONFIDENTIAL");
    expect(classify("document_content")).toBe("CONFIDENTIAL");
    expect(classify("boq")).toBe("CONFIDENTIAL");
    expect(isPublic("project_document")).toBe(false);
  });

  it("treats credentials and PII as HIGHLY_CONFIDENTIAL", () => {
    expect(classify("credential")).toBe("HIGHLY_CONFIDENTIAL");
    expect(classify("user_pii")).toBe("HIGHLY_CONFIDENTIAL");
  });

  it("treats reference catalogues as PUBLIC", () => {
    expect(classify("reference_catalog")).toBe("PUBLIC");
    expect(isPublic("reference_catalog")).toBe(true);
  });
});

describe("canSendToProvider", () => {
  it("NEVER sends credentials or PII, even with AI enabled", () => {
    expect(canSendToProvider({ kind: "credential", aiProcessingEnabled: true })).toBe(false);
    expect(canSendToProvider({ kind: "user_pii", aiProcessingEnabled: true })).toBe(false);
  });

  it("sends confidential project data ONLY when the project enabled AI processing", () => {
    expect(canSendToProvider({ kind: "project_document", aiProcessingEnabled: false })).toBe(false);
    expect(canSendToProvider({ kind: "project_document", aiProcessingEnabled: true })).toBe(true);
  });

  it("always allows public reference data", () => {
    expect(canSendToProvider({ kind: "reference_catalog", aiProcessingEnabled: false })).toBe(true);
  });
});

describe("assertSendableToProvider", () => {
  it("throws for confidential data when AI is disabled", () => {
    expect(() => assertSendableToProvider({ kind: "boq", aiProcessingEnabled: false })).toThrow(/not enabled/i);
  });
  it("throws for credentials regardless", () => {
    expect(() => assertSendableToProvider({ kind: "credential", aiProcessingEnabled: true })).toThrow(/never sent/i);
  });
  it("does not throw for confidential data when AI is enabled", () => {
    expect(() => assertSendableToProvider({ kind: "boq", aiProcessingEnabled: true })).not.toThrow();
  });
});
