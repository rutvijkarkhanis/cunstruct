// PR #154 — provenance persistence for Analyze Project's document -> BOQ
// scope, into the EXISTING boq_document table. Mocks the supabase client the
// same chain-builder way useBoqManagement.test.tsx/WorkspaceBoqPanel.test.tsx
// already do, so this exercises the real upsert/select shape this function
// actually sends, not a re-implementation of it.
//
// Scope F adds analysis_run_source/document_revision mocking, modeling run-
// to-document-to-revision ownership the same way applyReviewPlan.test.ts's
// Scope E mock does (a plain array for analysis_run_source — not a Map — so
// the same (run, document) pair can genuinely hold more than one row, the
// exact "conflicting claims" case this file must never guess through).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { linkAnalyzedDocumentsToBoq, loadBoqDocumentLinks } from "./boqDocumentLinks";

let projectDocumentRows: { id: string; current_revision_id: string | null }[] = [];
const upsertCalls: { table: string; rows: unknown; options: unknown }[] = [];
const selectCalls: { table: string; ids: string[] }[] = [];
let boqDocumentRows: { boq_id: string; document_id: string }[] = [];
const boqDocumentSelectCalls: string[][] = [];

interface RunSourceRow { analysis_run_id: string; document_id: string; status: string; document_revision_id: string | null }
let analysisRunSourceRows: RunSourceRow[] = [];
// revisionId -> the document_id it actually belongs to (ownership), mirroring
// document_revision's real FK-enforced document_id column.
let documentRevisionOwner = new Map<string, string>();

vi.mock("@/integrations/supabase/client", () => {
  const chain = (result: { data: unknown; error: null }) => {
    const obj: Record<string, unknown> = {};
    ["select", "in"].forEach((m) => { obj[m] = () => obj; });
    (obj as { then: unknown }).then = (resolve: (r: typeof result) => void) => resolve(result);
    return obj;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === "project_document") {
          const obj: Record<string, unknown> = {};
          obj.select = () => obj;
          obj.in = (_col: string, ids: string[]) => { selectCalls.push({ table, ids }); return chain({ data: projectDocumentRows, error: null }); };
          return obj;
        }
        if (table === "boq_document") {
          return {
            upsert: (rows: unknown, options: unknown) => {
              upsertCalls.push({ table, rows, options });
              return { then: (resolve: (r: { data: null; error: null }) => void) => resolve({ data: null, error: null }) };
            },
            select: () => ({
              in: (_col: string, ids: string[]) => {
                boqDocumentSelectCalls.push(ids);
                return { then: (resolve: (r: { data: unknown; error: null }) => void) => resolve({ data: boqDocumentRows, error: null }) };
              },
            }),
          };
        }
        if (table === "analysis_run_source") {
          let filters: Record<string, unknown> = {};
          let excludeNullRevision = false;
          const builder: Record<string, unknown> = {
            eq: (col: string, val: unknown) => { filters = { ...filters, [col]: val }; return builder; },
            not: () => { excludeNullRevision = true; return builder; },
            then: (resolve: (r: { data: unknown; error: null }) => void) => {
              const rows = analysisRunSourceRows.filter((r) =>
                (filters.analysis_run_id === undefined || r.analysis_run_id === filters.analysis_run_id)
                && (filters.document_id === undefined || r.document_id === filters.document_id)
                && (filters.status === undefined || r.status === filters.status)
                && (!excludeNullRevision || r.document_revision_id != null),
              );
              return resolve({ data: rows.map((r) => ({ document_revision_id: r.document_revision_id })), error: null });
            },
          };
          builder.select = () => builder;
          return builder;
        }
        if (table === "document_revision") {
          let id: string | undefined;
          let documentIdFilter: string | undefined;
          const builder: Record<string, unknown> = {
            eq: (col: string, val: unknown) => {
              if (col === "id") id = val as string;
              if (col === "document_id") documentIdFilter = val as string;
              return builder;
            },
            maybeSingle: async () => {
              const owner = id ? documentRevisionOwner.get(id) : undefined;
              const found = owner != null && (documentIdFilter === undefined || owner === documentIdFilter);
              return { data: found ? { id } : null, error: null };
            },
          };
          builder.select = () => builder;
          return builder;
        }
        throw new Error(`unexpected table in test: ${table}`);
      },
    },
  };
});

describe("linkAnalyzedDocumentsToBoq", () => {
  beforeEach(() => {
    projectDocumentRows = [];
    upsertCalls.length = 0;
    selectCalls.length = 0;
    boqDocumentRows = [];
    boqDocumentSelectCalls.length = 0;
    analysisRunSourceRows = [];
    documentRevisionOwner = new Map();
  });

  it("is a no-op for an empty documentIds array — never issues a query", async () => {
    await linkAnalyzedDocumentsToBoq("boq-1", []);
    expect(selectCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
  });

  it("upserts one row per document, with the discipline's boqId and each document's CURRENT revision", async () => {
    projectDocumentRows = [
      { id: "doc-1", current_revision_id: "rev-1" },
      { id: "doc-2", current_revision_id: "rev-2" },
    ];
    await linkAnalyzedDocumentsToBoq("boq-civil", ["doc-1", "doc-2"]);
    expect(upsertCalls).toHaveLength(1); // one round trip for both documents, not two
    expect(upsertCalls[0].rows).toEqual([
      { boq_id: "boq-civil", document_id: "doc-1", analyzed_revision_id: "rev-1" },
      { boq_id: "boq-civil", document_id: "doc-2", analyzed_revision_id: "rev-2" },
    ]);
  });

  it("uses the EXISTING unique(boq_id, document_id) constraint via onConflict + ignoreDuplicates, never a manual exists-check", async () => {
    projectDocumentRows = [{ id: "doc-1", current_revision_id: "rev-1" }];
    await linkAnalyzedDocumentsToBoq("boq-civil", ["doc-1"]);
    expect(upsertCalls[0].options).toEqual({ onConflict: "boq_id,document_id", ignoreDuplicates: true });
  });

  it("never fabricates a revision id — a document with no current revision gets NULL, not a guess", async () => {
    projectDocumentRows = [{ id: "doc-1", current_revision_id: null }];
    await linkAnalyzedDocumentsToBoq("boq-civil", ["doc-1"]);
    expect(upsertCalls[0].rows).toEqual([{ boq_id: "boq-civil", document_id: "doc-1", analyzed_revision_id: null }]);
  });

  it("never fabricates a revision id for a document that doesn't resolve at all (deleted/missing) — NULL, not skipped and not guessed", async () => {
    projectDocumentRows = []; // doc-1 doesn't come back from the select at all
    await linkAnalyzedDocumentsToBoq("boq-civil", ["doc-1"]);
    expect(upsertCalls[0].rows).toEqual([{ boq_id: "boq-civil", document_id: "doc-1", analyzed_revision_id: null }]);
  });

  it("the same document linked to two different BOQs produces two independent rows (different boq_id), never one overwriting the other", async () => {
    projectDocumentRows = [{ id: "shared-doc", current_revision_id: "rev-1" }];
    await linkAnalyzedDocumentsToBoq("civil-boq", ["shared-doc"]);
    await linkAnalyzedDocumentsToBoq("electrical-boq", ["shared-doc"]);
    expect(upsertCalls).toHaveLength(2);
    expect(upsertCalls[0].rows).toEqual([{ boq_id: "civil-boq", document_id: "shared-doc", analyzed_revision_id: "rev-1" }]);
    expect(upsertCalls[1].rows).toEqual([{ boq_id: "electrical-boq", document_id: "shared-doc", analyzed_revision_id: "rev-1" }]);
  });

  it("re-running with the identical (boqId, documentId) sends the identical upsert again — dedup is the DB constraint's job, not this function's", async () => {
    projectDocumentRows = [{ id: "doc-1", current_revision_id: "rev-1" }];
    await linkAnalyzedDocumentsToBoq("civil-boq", ["doc-1"]);
    await linkAnalyzedDocumentsToBoq("civil-boq", ["doc-1"]);
    expect(upsertCalls).toHaveLength(2);
    expect(upsertCalls[0].rows).toEqual(upsertCalls[1].rows);
    expect(upsertCalls[1].options).toEqual({ onConflict: "boq_id,document_id", ignoreDuplicates: true });
  });

  // Revision-provenance audit (pre-commit, PR #154): confirms the exact
  // property the function's own doc comment now documents — it reads
  // current_revision_id FRESH on every call, never a cached/passed-in
  // snapshot. That is precisely why a revision change between the edge
  // function's own download and this later read is a real (if narrow,
  // pre-existing-class) race — never silently assumed away.
  it("re-queries current_revision_id fresh on every call, never a cached snapshot from an earlier call", async () => {
    projectDocumentRows = [{ id: "doc-1", current_revision_id: "rev-1" }];
    await linkAnalyzedDocumentsToBoq("civil-boq", ["doc-1"]);
    expect(selectCalls).toHaveLength(1);

    // Simulate the document having been re-uploaded between the two calls.
    projectDocumentRows = [{ id: "doc-1", current_revision_id: "rev-2" }];
    await linkAnalyzedDocumentsToBoq("electrical-boq", ["doc-1"]);
    expect(selectCalls).toHaveLength(2);
    expect(upsertCalls[1].rows).toEqual([{ boq_id: "electrical-boq", document_id: "doc-1", analyzed_revision_id: "rev-2" }]);
  });

  // ── Scope F — exact analyzed revision via analysis_run_source, reusing
  // resolveAnalyzedRevisionId (applyReview.ts) rather than a reimplementation. ──

  it("revision drift: run analyzed revision A; the document's CURRENT revision is now B; the new link stores A", async () => {
    projectDocumentRows = [{ id: "doc-1", current_revision_id: "rev-B" }]; // B is current NOW
    documentRevisionOwner.set("rev-A", "doc-1"); // the revision actually analyzed — no longer current
    documentRevisionOwner.set("rev-B", "doc-1");
    analysisRunSourceRows = [{ analysis_run_id: "run-1", document_id: "doc-1", status: "SUCCEEDED", document_revision_id: "rev-A" }];

    await linkAnalyzedDocumentsToBoq("boq-civil", ["doc-1"], "run-1");

    expect(upsertCalls[0].rows).toEqual([{ boq_id: "boq-civil", document_id: "doc-1", analyzed_revision_id: "rev-A" }]);
  });

  it("a claim naming a revision owned by a DIFFERENT document is rejected — never persisted, falls back to current revision", async () => {
    projectDocumentRows = [{ id: "doc-1", current_revision_id: "rev-current" }];
    documentRevisionOwner.set("rev-current", "doc-1");
    documentRevisionOwner.set("rev-foreign", "doc-OTHER"); // exists, but not owned by doc-1
    analysisRunSourceRows = [{ analysis_run_id: "run-1", document_id: "doc-1", status: "SUCCEEDED", document_revision_id: "rev-foreign" }];

    await linkAnalyzedDocumentsToBoq("boq-civil", ["doc-1"], "run-1");

    const row = (upsertCalls[0].rows as { analyzed_revision_id: string | null }[])[0];
    expect(row.analyzed_revision_id).toBe("rev-current");
    expect(row.analyzed_revision_id).not.toBe("rev-foreign");
  });

  it("no matching analysis_run_source claim: the existing current-revision fallback is unchanged", async () => {
    projectDocumentRows = [{ id: "doc-1", current_revision_id: "rev-current" }];
    documentRevisionOwner.set("rev-current", "doc-1");
    // No analysisRunSourceRows seeded — models a json_import run, or an
    // ai_api run from before this plumbing existed.

    await linkAnalyzedDocumentsToBoq("boq-civil", ["doc-1"], "run-unclaimed");

    expect(upsertCalls[0].rows).toEqual([{ boq_id: "boq-civil", document_id: "doc-1", analyzed_revision_id: "rev-current" }]);
  });

  it("conflicting SUCCEEDED claims for the same run+document never arbitrarily pick one, and never fall back to current revision either", async () => {
    projectDocumentRows = [{ id: "doc-1", current_revision_id: "rev-current" }];
    documentRevisionOwner.set("rev-current", "doc-1");
    documentRevisionOwner.set("rev-X", "doc-1");
    documentRevisionOwner.set("rev-Y", "doc-1");
    analysisRunSourceRows = [
      { analysis_run_id: "run-1", document_id: "doc-1", status: "SUCCEEDED", document_revision_id: "rev-X" },
      { analysis_run_id: "run-1", document_id: "doc-1", status: "SUCCEEDED", document_revision_id: "rev-Y" },
    ];

    await linkAnalyzedDocumentsToBoq("boq-civil", ["doc-1"], "run-1");

    const row = (upsertCalls[0].rows as { analyzed_revision_id: string | null }[])[0];
    expect(row.analyzed_revision_id).toBeNull();
    expect(row.analyzed_revision_id).not.toBe("rev-X");
    expect(row.analyzed_revision_id).not.toBe("rev-Y");
    expect(row.analyzed_revision_id).not.toBe("rev-current");
  });

  it("an unsuccessful (non-SUCCEEDED) claim never overrides the current-revision fallback, even naming an otherwise-valid, owned revision", async () => {
    projectDocumentRows = [{ id: "doc-1", current_revision_id: "rev-current" }];
    documentRevisionOwner.set("rev-current", "doc-1");
    documentRevisionOwner.set("rev-failed-claim", "doc-1"); // real, owned — but the claim for it never succeeded
    analysisRunSourceRows = [{ analysis_run_id: "run-1", document_id: "doc-1", status: "FAILED", document_revision_id: "rev-failed-claim" }];

    await linkAnalyzedDocumentsToBoq("boq-civil", ["doc-1"], "run-1");

    const row = (upsertCalls[0].rows as { analyzed_revision_id: string | null }[])[0];
    expect(row.analyzed_revision_id).toBe("rev-current");
    expect(row.analyzed_revision_id).not.toBe("rev-failed-claim");
  });

  it("missing runId: behaves exactly as every pre-existing caller/test above — current-revision fallback, no analysis_run_source query at all", async () => {
    projectDocumentRows = [{ id: "doc-1", current_revision_id: "rev-current" }];
    // Seeded so that, if this were (incorrectly) consulted without a runId,
    // the test would fail loudly rather than coincidentally passing.
    analysisRunSourceRows = [{ analysis_run_id: "run-1", document_id: "doc-1", status: "SUCCEEDED", document_revision_id: "rev-should-never-be-used" }];
    documentRevisionOwner.set("rev-should-never-be-used", "doc-1");

    await linkAnalyzedDocumentsToBoq("boq-civil", ["doc-1"]); // no third argument at all

    expect(upsertCalls[0].rows).toEqual([{ boq_id: "boq-civil", document_id: "doc-1", analyzed_revision_id: "rev-current" }]);
  });

  it("run isolation: a claim belonging to a DIFFERENT run never influences this run's resolved revision", async () => {
    projectDocumentRows = [{ id: "doc-1", current_revision_id: "rev-current" }];
    documentRevisionOwner.set("rev-current", "doc-1");
    documentRevisionOwner.set("rev-other-run", "doc-1");
    analysisRunSourceRows = [{ analysis_run_id: "run-OTHER", document_id: "doc-1", status: "SUCCEEDED", document_revision_id: "rev-other-run" }];

    await linkAnalyzedDocumentsToBoq("boq-civil", ["doc-1"], "run-1"); // asking about run-1, not run-OTHER

    const row = (upsertCalls[0].rows as { analyzed_revision_id: string | null }[])[0];
    expect(row.analyzed_revision_id).toBe("rev-current"); // no claim for run-1 -> fallback, never run-OTHER's value
    expect(row.analyzed_revision_id).not.toBe("rev-other-run");
  });

  it("existing link protection is unchanged: the same onConflict/ignoreDuplicates upsert options are used even on the new runId-aware path", async () => {
    projectDocumentRows = [{ id: "doc-1", current_revision_id: "rev-current" }];
    documentRevisionOwner.set("rev-current", "doc-1");
    documentRevisionOwner.set("rev-A", "doc-1");
    analysisRunSourceRows = [{ analysis_run_id: "run-1", document_id: "doc-1", status: "SUCCEEDED", document_revision_id: "rev-A" }];

    await linkAnalyzedDocumentsToBoq("boq-civil", ["doc-1"], "run-1");

    // The protection against overwriting an existing (and possibly manually
    // overridden, via BoqDocumentsPanel.tsx) link is the upsert's own
    // onConflict+ignoreDuplicates options, never row-level logic in this
    // function — confirming those options are untouched by Scope F.
    expect(upsertCalls[0].options).toEqual({ onConflict: "boq_id,document_id", ignoreDuplicates: true });
  });
});

// Coverage orchestration wiring — reading the authoritative boq_document
// scope back out, the exact shape coverageSignals.ts's CoverageBoqDocumentLink needs.
describe("loadBoqDocumentLinks", () => {
  beforeEach(() => {
    boqDocumentRows = [];
    boqDocumentSelectCalls.length = 0;
  });

  it("is a no-op for an empty boqIds array — never issues a query", async () => {
    const result = await loadBoqDocumentLinks([]);
    expect(result).toEqual([]);
    expect(boqDocumentSelectCalls).toHaveLength(0);
  });

  it("maps boq_id/document_id rows to boqId/documentId", async () => {
    boqDocumentRows = [{ boq_id: "boq-civil", document_id: "doc-1" }];
    expect(await loadBoqDocumentLinks(["boq-civil"])).toEqual([{ boqId: "boq-civil", documentId: "doc-1" }]);
  });

  it("scopes the query to exactly the given boqIds — one query, never one per BOQ", async () => {
    await loadBoqDocumentLinks(["boq-civil", "boq-electrical"]);
    expect(boqDocumentSelectCalls).toEqual([["boq-civil", "boq-electrical"]]);
  });

  it("returns one row per boq_document pair, preserving multiple documents per BOQ and multiple BOQs per document", async () => {
    boqDocumentRows = [
      { boq_id: "boq-civil", document_id: "doc-1" },
      { boq_id: "boq-civil", document_id: "doc-2" },
      { boq_id: "boq-electrical", document_id: "doc-1" },
    ];
    const result = await loadBoqDocumentLinks(["boq-civil", "boq-electrical"]);
    expect(result).toHaveLength(3);
    expect(result).toEqual(expect.arrayContaining([
      { boqId: "boq-civil", documentId: "doc-1" },
      { boqId: "boq-civil", documentId: "doc-2" },
      { boqId: "boq-electrical", documentId: "doc-1" },
    ]));
  });
});
