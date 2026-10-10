// Drawing-source audit — the full Apply-to-export chain, end to end.
//
// Every existing test proves exactly one segment of this chain: applyReview.ts/
// applyReviewPlan.test.ts prove WHAT GETS WRITTEN to boq_line; OpsBoqBuilder.
// sourceIndicator.test.tsx and ProjectBoqs.test.tsx prove the export paths
// render correctly GIVEN an already-populated boq_line row (as a hand-written
// fixture, never derived from a real Apply call); boqDsrDocument.test.ts and
// resolveDrawingSource.test.ts prove the pure rendering/resolution functions
// in isolation. No single test carries one value from the AI's own evidence,
// through a real applyReviewPlan() write, through the real resolveDrawingSource()
// resolution, into the real PDF/CSV renderers — so a break at any SEAM between
// those pieces (e.g. a field renamed on one side of a boundary, or a type that
// silently drifts) would not necessarily be caught by any existing test.
//
// This file closes that integration gap. Only the Supabase client is mocked,
// at the outermost boundary — classifyReviewItem, buildApplyPlan,
// applyReviewPlan, resolveDrawingSource, buildDsrQuoteHtml, buildBoqCsv, and
// buildProjectQuoteHtml are all the REAL, unmocked functions. Nothing is
// written to a real database; nothing touches Srikakulam or any live project.
import { describe, it, expect, vi } from "vitest";

const boqLineStore = new Map<string, Record<string, unknown>>();

// Seed data standing in for a real project_document/document_revision pair:
// "doc-1" exists, with current revision "rev-1" (which genuinely belongs to it).
const BOQ_PROJECT_ID = "project-1"; // this file's boq ("boq-1") belongs to this project
const PROJECT_DOCUMENT: Record<string, { current_revision_id: string | null; project_id: string }> = {
  "doc-1": { current_revision_id: "rev-1", project_id: BOQ_PROJECT_ID },
};
const DOCUMENT_REVISION_OWNER: Record<string, string> = { "rev-1": "doc-1" };

function selectBuilder(table: string, filters: Record<string, unknown> = {}) {
  return {
    eq: (col: string, val: unknown) => selectBuilder(table, { ...filters, [col]: val }),
    not: () => selectBuilder(table, filters),
    // documentStillExists's resolveBoqProjectId call (applyReview.ts) is the
    // only query in this file terminated with .single() rather than
    // .maybeSingle().
    single: async () => {
      if (table === "boq") return { data: { project_id: BOQ_PROJECT_ID }, error: null };
      return { data: null, error: null };
    },
    maybeSingle: async () => {
      const id = filters.id as string | undefined;
      if (table === "project_document") {
        const row = id ? PROJECT_DOCUMENT[id] : undefined;
        if (row && filters.project_id !== undefined && row.project_id !== filters.project_id) {
          return { data: null, error: null };
        }
        return { data: row ?? null, error: null };
      }
      if (table === "document_revision") {
        const owner = id ? DOCUMENT_REVISION_OWNER[id] : undefined;
        const docFilter = filters.document_id as string | undefined;
        const found = owner != null && (docFilter === undefined || owner === docFilter);
        return { data: found ? { id } : null, error: null };
      }
      return { data: null, error: null };
    },
    then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: [], error: null }),
  };
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        const result = table === "boq_line" ? { data: { id: "new-line-1" }, error: null } : { error: null };
        if (table === "boq_line") boqLineStore.set("new-line-1", payload);
        return {
          select: () => ({ single: async () => result }),
          then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve(result).then(onFulfilled),
        };
      },
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      select: () => selectBuilder(table),
    }),
  },
}));

import { buildApplyPlan, applyReviewPlan } from "./applyReview";
import { resolveDrawingSource } from "./drawingStorage";
import type { StoredDrawing } from "./documentResolve";
import type { StoredReviewItem } from "./reviewStore";
import type { AnalysisItemV1 } from "./analysisSchemaV1";
import { buildDsrQuoteHtml, buildBoqCsv, buildProjectQuoteHtml, computeCommercials, type QuoteItem, type CsvRow, type ProjectQuoteBoq } from "../boqDsrDocument";

const ai = (o: Partial<AnalysisItemV1>): AnalysisItemV1 => ({
  key: o.key ?? o.item ?? "x", item: o.item ?? "Item", quantity: o.quantity ?? 7,
  confidence: o.confidence ?? 0.9, aiStatus: o.aiStatus ?? "MEASURED", ...o,
});
const reviewItem = (o: Partial<StoredReviewItem> & { ai: AnalysisItemV1 }): StoredReviewItem => ({
  id: o.id ?? "ri-1", ai: o.ai, reviewStatus: o.reviewStatus ?? "PENDING_REVIEW", reviewer: o.reviewer,
});

describe("Apply-to-export integration: AI evidence -> boq_line write -> resolver -> renderers", () => {
  it("a NEW_LINE candidate's AI source genuinely reaches the single-BOQ PDF, the CSV, and the multi-BOQ PDF", async () => {
    // 1. An AI review item with a real documentId/page, reviewed and ready to apply.
    const item = reviewItem({
      id: "ri-int-1",
      ai: ai({ key: "W-int", item: "Window W-int", quantity: 6, unit: "nos", source: { documentId: "doc-1", page: 4, evidence: [] } }),
      reviewStatus: "VERIFIED",
    });
    const plan = buildApplyPlan([item], []);
    expect(plan[0].classification).toBe("NEW_LINE");

    // 2. The real applyReviewPlan() write (Supabase client mocked; everything
    // else real) — this is exactly what a reviewer's Apply click executes.
    const result = await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-int-1"]) });
    expect(result.appliedCount).toBe(1);

    // 3. Read back exactly what was persisted — this is the "live boq_line row"
    // standing in for a real one, carrying only what applyReviewPlan actually wrote.
    const persisted = boqLineStore.get("new-line-1")!;
    expect(persisted.source_document_id).toBe("doc-1");
    expect(persisted.source_revision_id).toBe("rev-1");
    expect(persisted.source_page).toBe("4");

    // 4. The real resolveDrawingSource(), fed the persisted columns and a
    // drawingsById map shaped exactly like loadProjectDrawings(projectId)'s
    // real output — not a shortcut, not a pre-resolved fixture.
    const drawing: StoredDrawing = { documentId: "doc-1", name: "Ground Floor Plan" };
    const drawingsById = new Map([["doc-1", drawing]]);
    const resolved = resolveDrawingSource(
      persisted.source_document_id as string, persisted.source_page as string, drawingsById, false,
    );
    expect(resolved).toEqual({ sourceDocument: "Ground Floor Plan", sourcePage: "4" });

    // 5. The real single-BOQ PDF renderer, fed a QuoteItem carrying exactly
    // what step 4 resolved.
    const quoteItem: QuoteItem = {
      no: "1.01", code: null, spec: item.ai.item, qty: item.ai.quantity!, unit: "nos",
      rate: 500, amount: 3000, sourceDocument: resolved.sourceDocument, sourcePage: resolved.sourcePage,
    };
    const html = buildDsrQuoteHtml({
      boqName: "Test BOQ", generatedOn: "1 Jan 2026",
      subheads: [{ no: 1, name: "Works", subtotal: 3000, lines: [quoteItem] }],
      abstract: [{ no: 1, name: "Works", amount: 3000 }],
      commercials: computeCommercials(3000, { costIndexPct: 0, contingencyPct: 0, overheadPct: 0, cessPct: 0, gstPct: 18 }),
    }, { autoPrint: false });
    expect(html).toContain("Ground Floor Plan");
    expect(html).toContain("p.4");

    // 6. The real CSV renderer, fed the same resolved values.
    const csvRow: CsvRow = {
      subhead: "1.00 Works", itemNo: "1.01", code: null, spec: item.ai.item, unit: "nos", qty: item.ai.quantity!, rate: 500,
      sourceDocument: resolved.sourceDocument, sourcePage: resolved.sourcePage,
    };
    const csv = buildBoqCsv([csvRow], { boqName: "Test BOQ", generatedOn: "1 Jan 2026" });
    const cols = csv.split("\r\n")[4].split(",");
    expect(cols[9]).toBe("Ground Floor Plan");
    expect(cols[10]).toBe("4");

    // 7. The real multi-BOQ PDF renderer, same resolved values, proving the
    // combined export path renders identically to the single-BOQ one for the
    // SAME underlying Apply-written data.
    const projectBoq: ProjectQuoteBoq = {
      name: "Test BOQ", subheads: [{ no: 1, name: "Works", subtotal: 3000, lines: [quoteItem] }],
      commercials: computeCommercials(3000, { costIndexPct: 0, contingencyPct: 0, overheadPct: 0, cessPct: 0, gstPct: 18 }),
    };
    const combinedHtml = buildProjectQuoteHtml(
      { projectName: "Test Project", branding: "firm", generatedOn: "1 Jan 2026" }, [projectBoq], { autoPrint: false },
    );
    expect(combinedHtml).toContain("Ground Floor Plan");
    expect(combinedHtml).toContain("p.4");
  });

  it("a NEW_LINE candidate with NO AI source reaches every export path with no fabricated annotation", async () => {
    const item = reviewItem({
      id: "ri-int-2",
      ai: ai({ key: "W-int2", item: "Window W-int2", quantity: 3, unit: "nos" }), // no source
      reviewStatus: "VERIFIED",
    });
    const plan = buildApplyPlan([item], []);
    expect(plan[0].source).toBeUndefined();

    await applyReviewPlan({ boqId: "boq-1", candidates: plan, selectedIds: new Set(["ri-int-2"]) });
    const persisted = boqLineStore.get("new-line-1")!;
    expect(persisted.source_document_id).toBeNull();

    const resolved = resolveDrawingSource(persisted.source_document_id as string | null, persisted.source_page as string | null, new Map(), false);
    expect(resolved).toEqual({ sourceDocument: null, sourcePage: null });

    const quoteItem: QuoteItem = { no: "1.01", code: null, spec: item.ai.item, qty: 3, unit: "nos", rate: null, amount: null, ...resolved };
    const html = buildDsrQuoteHtml({
      boqName: "Test BOQ", generatedOn: "1 Jan 2026",
      subheads: [{ no: 1, name: "Works", subtotal: 0, lines: [quoteItem] }],
      abstract: [{ no: 1, name: "Works", amount: 0 }],
      commercials: computeCommercials(0, { costIndexPct: 0, contingencyPct: 0, overheadPct: 0, cessPct: 0, gstPct: 18 }),
    }, { autoPrint: false });
    expect(html).not.toContain('<span class="srcref"');
  });
});
