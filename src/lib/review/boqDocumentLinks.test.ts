// PR #154 — provenance persistence for Analyze Project's document -> BOQ
// scope, into the EXISTING boq_document table. Mocks the supabase client the
// same chain-builder way useBoqManagement.test.tsx/WorkspaceBoqPanel.test.tsx
// already do, so this exercises the real upsert/select shape this function
// actually sends, not a re-implementation of it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { linkAnalyzedDocumentsToBoq, loadBoqDocumentLinks } from "./boqDocumentLinks";

let projectDocumentRows: { id: string; current_revision_id: string | null }[] = [];
const upsertCalls: { table: string; rows: unknown; options: unknown }[] = [];
const selectCalls: { table: string; ids: string[] }[] = [];
let boqDocumentRows: { boq_id: string; document_id: string }[] = [];
const boqDocumentSelectCalls: string[][] = [];

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
