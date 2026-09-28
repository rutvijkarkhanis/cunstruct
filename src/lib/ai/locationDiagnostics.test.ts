// Tests for the TEMPORARY LOCATION diagnostic instrumentation
// (locationDiagnostics.ts) — imported from its actual location
// (supabase/functions/_shared/) via a relative, explicit-extension path, the
// same way the edge function imports it — so this exercises the real module,
// not a copy (mirrors observationSource.test.ts). Pure, synthetic fixtures;
// no OpenAI call, no database, no real drawing data.
import { describe, it, expect } from "vitest";
import {
  buildLocationDiagnosticReport,
  extractRawObservations,
  findObservationDropReason,
} from "../../../supabase/functions/_shared/locationDiagnostics.ts";

const OPENAI_INFO = {
  model: "gpt-4o-mini", status: "completed", incompleteDetails: null,
  inputTokens: 1000, outputTokens: 500, totalTokens: 1500,
};

function rawJsonWith(observations: unknown[]): string {
  return JSON.stringify({ schema_version: "cunstruct.observation.v1", observations });
}

describe("extractRawObservations — a separate, non-validating read of the model's own JSON", () => {
  it("extracts index/mark/type/scopeHint/evidenceCompleteness/evidenceCount for every entry", () => {
    const raw = rawJsonWith([
      { mark: "W1", observation_type: "opening", scope_hint: "Ground Floor", evidence_completeness: "FULL", source: { evidence: [{ bbox: [1, 2, 3, 4] }] } },
      { mark: "Dining", observation_type: "room_or_space", scope_hint: "First Floor", evidence_completeness: "LIMITED", source: { evidence: [] } },
    ]);
    const result = extractRawObservations(raw);
    expect(result).toEqual([
      { index: 0, mark: "W1", observationType: "opening", scopeHint: "Ground Floor", evidenceCompleteness: "FULL", evidenceCount: 1 },
      { index: 1, mark: "Dining", observationType: "room_or_space", scopeHint: "First Floor", evidenceCompleteness: "LIMITED", evidenceCount: 0 },
    ]);
  });

  it("never throws on malformed JSON — returns an empty list instead", () => {
    expect(extractRawObservations("{not valid json")).toEqual([]);
    expect(extractRawObservations("")).toEqual([]);
  });

  it("returns an empty list when the shape has no observations array", () => {
    expect(extractRawObservations(JSON.stringify({ schema_version: "x" }))).toEqual([]);
    expect(extractRawObservations(JSON.stringify({ observations: "not an array" }))).toEqual([]);
  });

  it("tolerates a missing source/evidence entirely — evidenceCount is 0, not a throw", () => {
    const raw = rawJsonWith([{ mark: "A", observation_type: "room_or_space" }]);
    const result = extractRawObservations(raw);
    expect(result[0].evidenceCount).toBe(0);
    expect(result[0].scopeHint).toBeNull();
  });
});

describe("findObservationDropReason — recognizes the REAL parseObservationsV1 warnings, never invents one", () => {
  it("finds the exact warning for a missing/unrecognized observation_type drop", () => {
    const warnings = [`"observation 1": missing or unrecognized observation_type "bogus_type" — skipped (never invented).`];
    expect(findObservationDropReason(0, warnings)).toBe(warnings[0]);
  });

  it("finds the exact warning for an empty-evidence, non-LIMITED drop", () => {
    const warnings = [`"observation 3": no valid evidence and evidence_completeness is not LIMITED — skipped (never persisted as apparently-verified evidence it doesn't have).`];
    expect(findObservationDropReason(2, warnings)).toBe(warnings[0]);
  });

  it("does NOT mistake a per-evidence-box warning (the observation itself survived) for a whole-observation drop", () => {
    // This warning also contains "skipped" and the same "observation N" label,
    // but it's about ONE bad bbox inside an otherwise-surviving observation —
    // parseSource's own wording, distinct from the two observation-drop markers.
    const warnings = [`"observation 1": evidence[0] has no valid bbox — skipped (no coordinate fabricated).`];
    expect(findObservationDropReason(0, warnings)).toBeNull();
  });

  it("returns null when no warning correlates to the index — never guesses", () => {
    expect(findObservationDropReason(5, ["\"observation 1\": missing or unrecognized observation_type \"x\" — skipped (never invented)."])).toBeNull();
    expect(findObservationDropReason(0, [])).toBeNull();
  });
});

describe("buildLocationDiagnosticReport — assembles raw/parsed/dropped from already-computed data only", () => {
  it("a perfect run: every raw observation survives, reconciliation is consistent", () => {
    const raw = rawJsonWith([
      { mark: "A", observation_type: "room_or_space", scope_hint: "Ground Floor", evidence_completeness: "FULL", source: { evidence: [{ bbox: [1, 2, 3, 4] }] } },
      { mark: "B", observation_type: "room_or_space", scope_hint: "Ground Floor", evidence_completeness: "FULL", source: { evidence: [{ bbox: [1, 2, 3, 4] }] } },
    ]);
    const report = buildLocationDiagnosticReport(OPENAI_INFO, raw, [], 2);
    expect(report.rawObservationCount).toBe(2);
    expect(report.parsedObservationCount).toBe(2);
    expect(report.droppedObservations).toEqual([]);
    expect(report.reconciliation).toEqual({ expectedSurvivorCount: 2, actualParsedCount: 2, consistent: true });
    expect(report.rawLimitedCount).toBe(0);
    expect(report.rawNonLimitedCount).toBe(2);
  });

  it("a run with one evidence-driven drop: the dropped entry is reported with its real reason, the survivor isn't", () => {
    const raw = rawJsonWith([
      { mark: "A", observation_type: "room_or_space", scope_hint: "Ground Floor", evidence_completeness: "FULL", source: { evidence: [{ bbox: [1, 2, 3, 4] }] } },
      // FULL completeness but empty evidence — exactly the drop path this
      // investigation flagged as a candidate silent-loss mechanism.
      { mark: "B", observation_type: "room_or_space", scope_hint: "Ground Floor", evidence_completeness: "FULL", source: { evidence: [] } },
    ]);
    const warnings = [`"observation 2": no valid evidence and evidence_completeness is not LIMITED — skipped (never persisted as apparently-verified evidence it doesn't have).`];
    const report = buildLocationDiagnosticReport(OPENAI_INFO, raw, warnings, 1);
    expect(report.rawObservationCount).toBe(2);
    expect(report.parsedObservationCount).toBe(1);
    expect(report.droppedObservations).toEqual([
      { index: 1, mark: "B", observationType: "room_or_space", scopeHint: "Ground Floor", evidenceCompleteness: "FULL", evidenceCount: 0, dropReason: warnings[0] },
    ]);
    expect(report.reconciliation.consistent).toBe(true);
  });

  it("an inconsistency between raw extraction and the real parser is reported, not hidden", () => {
    // Deliberately mismatched: the real parser says 5 survived, but this
    // diagnostic's own (separate) raw read only found 1 entry and no
    // recognized drop reasons for the other 4 — e.g. because the raw JSON's
    // shape diverged from what this lightweight extractor expects. The
    // report must surface that gap, never silently assume consistency.
    const raw = rawJsonWith([{ mark: "A", observation_type: "room_or_space", scope_hint: "Ground Floor", evidence_completeness: "FULL", source: { evidence: [] } }]);
    const report = buildLocationDiagnosticReport(OPENAI_INFO, raw, [], 5);
    expect(report.reconciliation).toEqual({ expectedSurvivorCount: 1, actualParsedCount: 5, consistent: false });
  });

  it("carries the OpenAI response metadata through unchanged", () => {
    const info = { model: "gpt-4o", status: "incomplete", incompleteDetails: { reason: "max_output_tokens" }, inputTokens: 2000, outputTokens: 16384, totalTokens: 18384 };
    const report = buildLocationDiagnosticReport(info, rawJsonWith([]), [], 0);
    expect(report.openai).toEqual(info);
  });
});
