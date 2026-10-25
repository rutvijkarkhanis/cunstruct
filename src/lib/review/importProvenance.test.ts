// IMPORT PROVENANCE — an analysis produced outside Cunstruct (the local
// drawing extractor) states the SHA-256 of the drawing it read. It is imported
// only against the one current revision with that content hash, and records
// that revision as the run's source, so Apply's freshness and provenance gates
// work exactly as for an AI run. Unmatched or ambiguous drawings are refused.
//
// SIMULATED: in-memory tables (same stand-in as applyReviewFreshness.test.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let insertHook: ((table: string, row: Row) => void) | null = null;
let failInsertOn: string | null = null; // a table whose inserts fail (e.g. missing in production)
let nextLine = 1;

function reset() {
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, {
    boq: [{ id: "boq-1", project_id: "project-1" }],
    project_document: [], document_revision: [], analysis_run_source: [], boq_line: [], boq_line_change_log: [], project_scope: [],
  });
  insertHook = null;
  failInsertOn = null;
  nextLine = 1;
}

function query(table: string, filters: ((r: Row) => boolean)[] = []) {
  const rows = () => (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
  return {
    eq: (c: string, v: unknown) => query(table, [...filters, (r) => r[c] === v]),
    in: (c: string, vs: unknown[]) => query(table, [...filters, (r) => vs.includes(r[c])]),
    not: (c: string) => query(table, [...filters, (r) => r[c] != null]),
    limit: () => query(table, filters),
    single: async () => ({ data: rows()[0] ? { ...rows()[0] } : null, error: rows()[0] ? null : { message: "no rows" } }),
    maybeSingle: async () => ({ data: rows()[0] ? { ...rows()[0] } : null, error: null }),
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows().map((r) => ({ ...r })), error: null }).then(ok, bad),
  };
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => ({
      select: () => query(table),
      insert: (payload: Row | Row[]) => {
        if (table === failInsertOn) {
          return { then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
            Promise.resolve({ error: { code: "PGRST205", message: `Could not find the table 'public.${table}'` } }).then(ok, bad) };
        }
        const rows = (Array.isArray(payload) ? payload : [payload]).map((r) => (table === "boq_line" ? { id: `line-${nextLine++}`, ...r } : { ...r }));
        db[table].push(...rows);
        for (const r of rows) insertHook?.(table, r);
        const result = { data: { id: rows[0]?.id }, error: null };
        return {
          select: () => ({ single: async () => result }),
          then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
            Promise.resolve({ error: table === failInsertOn ? { code: "PGRST205", message: `Could not find the table 'public.${table}'` } : null }).then(ok, bad),
        };
      },
    }),
  },
}));

import { buildApplyPlan, applyReviewPlan } from "./applyReview";
import { AnalysisRevisionBlockedError } from "./revisionFreshness";
import { NO_DRAWING_MATCH_REASON, attributeItemsToDrawing, findDrawingRevisionByHash, recordImportedRunSource } from "./importProvenance";
import { parseAnalysisV1 } from "./analysisSchemaV1";
import { buildReviewItems } from "./reviewQueue";
import type { StoredReviewItem } from "./reviewStore";
import type { AnalysisItemV1 } from "./analysisSchemaV1";

function doc(id: string, current: string | null, revisions: string[]) {
  db.project_document.push({ id, project_id: "project-1", name: id.toUpperCase(), current_revision_id: current });
  for (const r of revisions) db.document_revision.push({ id: r, document_id: id, label: r, file_path: `drawings/${r}.pdf` });
}
const claim = (runId: string, documentId: string, revisionId: string) =>
  db.analysis_run_source.push({ analysis_run_id: runId, document_id: documentId, document_revision_id: revisionId, status: "SUCCEEDED" });

const item = (id: string, key: string, documentId?: string): StoredReviewItem => ({
  id, reviewStatus: "VERIFIED",
  ai: {
    key, item: `Item ${key}`, quantity: 3, unit: "nos", confidence: 0.9, aiStatus: "MEASURED",
    ...(documentId ? { source: { documentId, page: 2, evidence: [] } } : {}),
  } as AnalysisItemV1,
});
const plan = (...items: StoredReviewItem[]) => buildApplyPlan(items, []);
const all = (...ids: string[]) => new Set(ids);

beforeEach(reset);

const SHA = "a".repeat(64);
const OTHER = "b".repeat(64);
const withHash = (revisionId: string, hash: string) => { db.document_revision.find((r) => r.id === revisionId)!.content_hash = hash; };
const extractorJson = JSON.stringify({
  schema_version: "cunstruct.analysis.v1",
  source_drawing: { sha256: SHA, filename: "set.pdf", extractor: "drawing-ocr 1.0" },
  items: [{ key: "D1", item: "Door D1", quantity: 1, unit: "nr", status: "MEASURED", source: { document_id: null, document: "SD-AR-101 door schedule", page: 1, evidence: [] } }],
});

async function importAndApply(sha: string) {
  const parsed = parseAnalysisV1(extractorJson.replace(SHA, sha));
  expect(parsed.ok).toBe(true);
  const found = await findDrawingRevisionByHash("project-1", parsed.analysis!.sourceDrawing!.sha256);
  if (!found.ok) return { found };
  const attributed = attributeItemsToDrawing(parsed.analysis!, found.match.documentId);
  if (!attributed.ok) return { found, attributed };
  await recordImportedRunSource({ runId: "run-j", projectId: "project-1", boqId: "boq-1", sha256: sha, match: found.match, extractor: "drawing-ocr 1.0" });
  const stored = buildReviewItems(attributed.analysis.items).map((r, i) => ({ ...r, id: `ri-${i}`, reviewStatus: "VERIFIED" as const }));
  return { found, plan: buildApplyPlan(stored, [], []) };
}

describe("importing an analysis tied to a stored drawing by content hash", () => {
  it("parses source_drawing and rejects a malformed hash", () => {
    expect(parseAnalysisV1(extractorJson).analysis?.sourceDrawing).toEqual({ sha256: SHA, filename: "set.pdf", extractor: "drawing-ocr 1.0" });
    expect(parseAnalysisV1(extractorJson.replace(SHA, "abc")).ok).toBe(false);
  });

  it("matched current revision: claim recorded, Apply writes document, revision and page provenance", async () => {
    doc("doc-a", "rev-a1", ["rev-a1"]); withHash("rev-a1", SHA);
    const { found, plan } = await importAndApply(SHA);
    expect(found.ok && found.match).toMatchObject({ documentId: "doc-a", revisionId: "rev-a1" });
    expect(db.analysis_run_source).toEqual([expect.objectContaining({ analysis_run_id: "run-j", document_id: "doc-a", document_revision_id: "rev-a1", status: "SUCCEEDED", content_hash: SHA })]);
    const res = await applyReviewPlan({ boqId: "boq-1", candidates: plan!, selectedIds: all("ri-0"), runId: "run-j" });
    expect(res.appliedCount).toBe(1);
    expect(db.boq_line[0]).toMatchObject({ external_key: "D1", qty: 1, source_document_id: "doc-a", source_revision_id: "rev-a1", source_page: "1" });
  });

  it("drawing revised after import: Apply is blocked as stale, nothing written", async () => {
    doc("doc-a", "rev-a1", ["rev-a1", "rev-a2"]); withHash("rev-a1", SHA);
    const { plan } = await importAndApply(SHA);
    db.project_document.find((d) => d.id === "doc-a")!.current_revision_id = "rev-a2";
    const err = await applyReviewPlan({ boqId: "boq-1", candidates: plan!, selectedIds: all("ri-0"), runId: "run-j" }).catch((e) => e);
    expect(err).toBeInstanceOf(AnalysisRevisionBlockedError);
    expect(db.boq_line).toHaveLength(0);
  });

  it("hash matches no current revision (only an older one): refused, nothing recorded", async () => {
    doc("doc-a", "rev-a2", ["rev-a1", "rev-a2"]); withHash("rev-a1", SHA); withHash("rev-a2", OTHER);
    const { found } = await importAndApply(SHA);
    expect(found.ok).toBe(false);
    expect(db.analysis_run_source).toHaveLength(0);
    // The way to get a fingerprint computed must not lead to a full analysis:
    // two Workspace buttons are labelled "Analyze Project", and only opening
    // the panel (the side-panel one) is safe.
    expect("reason" in found && found.reason).toBe(NO_DRAWING_MATCH_REASON);
    expect(NO_DRAWING_MATCH_REASON).toContain("click Analyze Project in the side panel only to open that panel");
    expect(NO_DRAWING_MATCH_REASON).toContain("Do not press the Analyze Project button inside the panel, which starts a full analysis");
  });

  it("hash matches two drawings: refused as ambiguous", async () => {
    doc("doc-a", "rev-a1", ["rev-a1"]); doc("doc-b", "rev-b1", ["rev-b1"]); withHash("rev-a1", SHA); withHash("rev-b1", SHA);
    const { found } = await importAndApply(SHA);
    expect(found.ok).toBe(false);
    expect("reason" in found && found.reason).toContain("2 drawings");
  });

  it("an item naming a different drawing than the stated source is refused", () => {
    const parsed = parseAnalysisV1(extractorJson.replace('"document_id":null', '"document_id":"doc-x"'));
    expect(attributeItemsToDrawing(parsed.analysis!, "doc-a").ok).toBe(false);
  });
});
