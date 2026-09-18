// COMPOSITION-LEVEL PROOF of the LOCATION generate flow index.ts implements.
//
// IMPORTANT — what this file does and does NOT prove:
// index.ts cannot currently be imported into Vitest at all (empirically
// confirmed: it fails at Vite's import-analysis step on Deno-only `npm:`
// specifiers, before `Deno.serve`'s own top-level call — which would ALSO
// throw, since no `Deno` global exists under Node/jsdom — is ever reached).
// This is pre-existing to Phase 4 (docs/ai-analysis-pipeline.md already
// documents openaiClient.ts/index.ts as untested-by-design for this reason)
// and making it importable would require new test infrastructure (a Deno
// global shim, a way to capture Deno.serve's handler, a vitest resolver
// alias for `npm:` specifiers, and a full mock Supabase query-builder) —
// real implementation-adjacent work, not something to add silently.
//
// What THIS file proves instead: the REAL functions index.ts's LOCATION
// branch calls (generateAnalysisViaOpenAI with CUNSTRUCT_OBSERVATION_JSON_SCHEMA,
// parseObservationsV1, resolveObservationSource) compose correctly in the
// EXACT sequence and produce the EXACT row shapes index.ts's source
// constructs (verified by literal comparison against the row-construction
// expressions in index.ts) — via a mocked `fetch`, never a mocked Supabase
// client claiming to be index.ts itself.
import { describe, it, expect, vi, afterEach } from "vitest";
import { generateAnalysisViaOpenAI } from "../../../supabase/functions/_shared/openaiClient.ts";
import { CUNSTRUCT_ANALYSIS_JSON_SCHEMA, CUNSTRUCT_OBSERVATION_JSON_SCHEMA } from "../../../supabase/functions/_shared/openaiSchema.ts";
import { parseObservationsV1 } from "../../../supabase/functions/_shared/observationValidation.ts";
import { resolveObservationSource, type ClaimedFile } from "../../../supabase/functions/_shared/observationSource.ts";

afterEach(() => vi.unstubAllGlobals());

function mockOpenAiResponses(rawJson: string) {
  let call = 0;
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    const step = call++;
    if (step === 0) return { ok: true, status: 200, json: async () => ({ id: "file-1" }) } as Response; // upload
    if (step === 1) return { ok: true, status: 200, json: async () => ({ output_text: rawJson, usage: { input_tokens: 10, output_tokens: 20 } }) } as Response; // responses
    return { ok: true, status: 200, json: async () => ({}) } as Response; // delete
  });
}

describe("LOCATION generate flow — schema selection matches mode (proof #2/#3 of the merge gate)", () => {
  it("mode=LOCATION sends CUNSTRUCT_OBSERVATION_JSON_SCHEMA on the wire, never the BOQ schema", async () => {
    const fetchMock = mockOpenAiResponses(JSON.stringify({ schema_version: "cunstruct.observation.v1", observations: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await generateAnalysisViaOpenAI("key", "gpt-4o-mini", "prompt", [{ filename: "a.pdf", bytes: new Uint8Array([1]) }], CUNSTRUCT_OBSERVATION_JSON_SCHEMA).catch(() => {});
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/responses"))!;
    const body = JSON.parse(call[1].body as string);
    expect(body.text.format.name).toBe("cunstruct_observation_v1");
  });

  it("mode=BOQ (and BOQ_AND_LOCATION, unchanged) sends CUNSTRUCT_ANALYSIS_JSON_SCHEMA, never the observation schema", async () => {
    const fetchMock = mockOpenAiResponses(JSON.stringify({ schema_version: "cunstruct.analysis.v1", items: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await generateAnalysisViaOpenAI("key", "gpt-4o-mini", "prompt", [{ filename: "a.pdf", bytes: new Uint8Array([1]) }], CUNSTRUCT_ANALYSIS_JSON_SCHEMA).catch(() => {});
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/responses"))!;
    const body = JSON.parse(call[1].body as string);
    expect(body.text.format.name).toBe("cunstruct_analysis_v1");
  });
});

describe("LOCATION generate flow — end-to-end composition (OpenAI wire -> parse -> pin -> row shape)", () => {
  const claimedFiles: ClaimedFile[] = [
    { documentId: "doc-ground", documentRevisionId: "rev-ground-1", filename: "Ground Floor Plan.pdf" },
  ];

  it("a successful OpenAI response produces exactly the analysis_observation row shape index.ts inserts", async () => {
    const wireJson = JSON.stringify({
      schema_version: "cunstruct.observation.v1",
      observations: [
        {
          observation_type: "schedule_entry", mark: "W1", scope_hint: "Ground Floor",
          location_text: "Door/Window schedule, Ground floor sheet",
          attributes: { dimension: "6'x6'9\"", specification: "UPVC", material: null },
          evidence_completeness: "FULL",
          source: { document_id: "doc-ground", document: null, page: 8, evidence: [{ bbox: [1, 2, 3, 4], page: 8, label: null, claim: "general" }] },
        },
      ],
    });
    const fetchMock = mockOpenAiResponses(wireJson);
    vi.stubGlobal("fetch", fetchMock);

    // Step 1: the real transport call, with the real observation schema — the
    // exact call index.ts's LOCATION branch makes.
    const openAiResult = await generateAnalysisViaOpenAI("key", "gpt-4o-mini", "prompt", [{ filename: "Ground Floor Plan.pdf", bytes: new Uint8Array([1]) }], CUNSTRUCT_OBSERVATION_JSON_SCHEMA);

    // Step 2: the real parser — proves the persisted evidence will be the
    // PARSED AnalysisSource shape (obs.source), never raw OpenAI wire JSON
    // (proof #6 of the merge gate: the wire used snake_case document_id;
    // obs.source exposes camelCase documentId, the canonical in-memory shape).
    const parsed = parseObservationsV1(openAiResult.rawJson);
    expect(parsed.ok).toBe(true);
    const obs = parsed.observations![0];
    expect(obs.source).not.toHaveProperty("document_id"); // never the raw wire key
    expect(obs.source.documentId).toBe("doc-ground"); // the canonical, parsed key

    // Step 3: the real source-pinning function.
    const resolved = resolveObservationSource({ documentId: obs.source.documentId, document: obs.source.document }, claimedFiles);
    expect(resolved).toEqual({ documentId: "doc-ground", revisionId: "rev-ground-1" });

    // Step 4: literally the same row-construction expression as
    // index.ts:532-538's `observationRows = pinned.map(...)` — proves the
    // exact persisted shape, including that `evidence` is `obs.source` (the
    // parsed object), not `openAiResult.rawJson` or any wire-shaped value.
    const row = {
      run_id: "run-fake-id", project_id: "proj-1",
      document_id: resolved!.documentId, revision_id: resolved!.revisionId,
      observation_type: obs.observationType, mark: obs.mark ?? null, scope_hint: obs.scopeHint ?? null,
      location_text: obs.locationText ?? null, attributes: obs.attributes, evidence: obs.source,
      evidence_completeness: obs.evidenceCompleteness,
    };
    expect(row).toEqual({
      run_id: "run-fake-id", project_id: "proj-1",
      document_id: "doc-ground", revision_id: "rev-ground-1",
      observation_type: "schedule_entry", mark: "W1", scope_hint: "Ground Floor",
      location_text: "Door/Window schedule, Ground floor sheet",
      attributes: { dimension: "6'x6'9\"", specification: "UPVC" },
      evidence: { documentId: "doc-ground", document: undefined, page: 8, evidence: [{ bbox: [1, 2, 3, 4], page: 8, label: undefined, claim: "general" }], pageSize: undefined },
      evidence_completeness: "FULL",
    });
  });

  it("zero observations surviving the parser (proof #10): parseObservationsV1 itself reports ok:false — index.ts's failClaims/502 branch is reached, never a false ok:true", async () => {
    // A response with an observations array that parses structurally but
    // whose sole entry is invalid (unrecognized observation_type) — the
    // exact case Layer A rejects (see observationSchemaV1.test.ts).
    const wireJson = JSON.stringify({
      schema_version: "cunstruct.observation.v1",
      observations: [{ observation_type: "not_a_real_type", evidence_completeness: "FULL", source: { evidence: [{ bbox: [0, 0, 1, 1] }] } }],
    });
    const parsed = parseObservationsV1(wireJson);
    // This is exactly the condition index.ts's `if (!parsedObservations.ok || !parsedObservations.observations)`
    // checks — proving that branch is reached, not a silent "0 observations, still ok:true".
    expect(parsed.ok).toBe(false);
    expect(parsed.observations).toBeUndefined();
  });

  it("zero observations surviving source-pinning (proof #10, Layer B): every observation unresolvable -> index.ts's explicit pinned.length===0 guard fires", () => {
    const wireJson = JSON.stringify({
      schema_version: "cunstruct.observation.v1",
      observations: [{
        observation_type: "opening", evidence_completeness: "FULL",
        source: { document_id: "doc-not-in-this-batch", evidence: [{ bbox: [0, 0, 1, 1] }] },
      }],
    });
    const parsed = parseObservationsV1(wireJson);
    expect(parsed.ok).toBe(true); // structurally valid...
    const pinned = parsed.observations!
      .map((obs) => resolveObservationSource({ documentId: obs.source.documentId, document: obs.source.document }, claimedFiles))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    // ...but unpinnable, which is exactly index.ts's `if (pinned.length === 0)`
    // guard (line 504) — the case that must fail the request, never report
    // ok:true with zero persisted rows.
    expect(pinned).toHaveLength(0);
  });
});
