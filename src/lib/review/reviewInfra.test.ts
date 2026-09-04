import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROVIDERS, isProviderConfigured, defaultInputMode, analysisProviderRegistry } from "./analysisProviders";
import { buildAnalysisPrompt } from "./analysisPrompt";

describe("analysis providers — agnostic, none implemented, JSON default", () => {
  it("lists OpenAI/Anthropic/Google as architecture placeholders, none implemented", () => {
    expect(PROVIDERS.map((p) => p.key).sort()).toEqual(["anthropic", "google", "openai"]);
    expect(PROVIDERS.every((p) => p.implemented === false)).toBe(true);
    expect(Object.keys(analysisProviderRegistry)).toEqual([]);
  });
  it("defaults to JSON import when no server analysis endpoint is configured", () => {
    // No VITE_ANALYSIS_API_ENABLED in test env → not configured → JSON import.
    expect(isProviderConfigured()).toBe(false);
    expect(defaultInputMode()).toBe("JSON_IMPORT");
  });
});

describe("analysis prompt — configurable, no-fabrication rules", () => {
  const p = buildAnalysisPrompt({ projectType: "Residential" });
  it("carries the core anti-fabrication instructions", () => {
    expect(p).toMatch(/do not invent quantities/i);
    expect(p).toMatch(/common construction practice/i);
    expect(p).toMatch(/pending/i);
    expect(p).toMatch(/cunstruct\.analysis\.v1/);
    expect(p).toMatch(/Residential/);
  });
  it("appends project-specific guidance verbatim", () => {
    expect(buildAnalysisPrompt({ extra: "Ignore basement." })).toMatch(/Ignore basement\./);
  });
});

describe("importing/reviewing an analysis never mutates the BOQ", () => {
  const store = readFileSync(join(__dirname, "reviewStore.ts"), "utf8");
  it("reviewStore writes only analysis_run / analysis_review_item — never boq_line", () => {
    // The safety rule: no code path here touches boq_line (or boq quantities).
    expect(/from\(["']boq_line["']\)/.test(store)).toBe(false);
    expect(store.includes('from("analysis_run")')).toBe(true);
    expect(store.includes('from("analysis_review_item")')).toBe(true);
  });
  it("keeps the AI value immutable (only reviewer_json is updated on a decision)", () => {
    // saveReviewDecision updates reviewer_json/status, never ai_json.
    expect(/update\(\{[\s\S]*?ai_json/.test(store)).toBe(false);
  });
});

describe("analysis review migration artifact", () => {
  const SQL = readFileSync(join(__dirname, "../../../supabase/migrations/20260917000000_boq_analysis_review.sql"), "utf8").toLowerCase();

  it("creates run + review-item tables idempotently", () => {
    expect(SQL).toContain("create table if not exists public.analysis_run");
    expect(SQL).toContain("create table if not exists public.analysis_review_item");
  });
  it("keeps ai_json immutable-by-design (separate reviewer_json column)", () => {
    expect(SQL).toMatch(/ai_json\s+jsonb\s+not null/);
    expect(SQL).toContain("reviewer_json jsonb");
  });
  it("constrains review_status to the reviewer vocabulary", () => {
    for (const s of ["pending_review", "verified", "edited", "flagged", "marked_pending"]) {
      expect(SQL).toContain(s);
    }
  });
  it("is owner/staff isolated like the rest of the schema", () => {
    expect(SQL).toContain("alter table public.analysis_run         enable row level security");
    expect(SQL).toContain("alter table public.analysis_review_item enable row level security");
    expect(SQL).toMatch(/p\.id = analysis_run\.project_id and p\.owner_id = auth\.uid\(\)/);
    expect(SQL).toMatch(/p\.id = analysis_review_item\.project_id and p\.owner_id = auth\.uid\(\)/);
    expect(SQL).not.toContain("using (true)");
  });
});
