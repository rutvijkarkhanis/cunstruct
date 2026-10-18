// M8 — deterministic fixture data for the real-browser Find Similar /
// Click-to-Identify specs. These are RAW PostgREST row shapes (snake_case,
// matching the actual DB columns reviewStore.ts/drawingStorage.ts/
// locationObservations.ts select from) — NOT the already-parsed TS shapes
// used by the Vitest component tests, since these rows are served directly
// as the body of intercepted `/rest/v1/*` responses, one layer below where
// those parsing functions run.

export const PROJECT_ID = "e2e-proj-1";
export const BOQ_ID = "e2e-boq-1";
export const RUN_ID = "e2e-run-1";

export const DOC_A_ID = "e2e-doc-a";
export const DOC_A_REVISION_ID = "e2e-rev-a";
export const DOC_B_ID = "e2e-doc-b";
export const DOC_B_REVISION_ID = "e2e-rev-b";

export const ITEM_DOOR_ID = "e2e-item-door";
export const ITEM_COLUMN_ID = "e2e-item-column";

// PDF point size for both fixture documents — see
// scripts/e2e-fixtures/generate_test_pdf.py (PAGE_W/PAGE_H). pdf.js's own
// getViewport({scale:1}) will report exactly this for an unrotated page, so
// specs can predict on-screen positions from these numbers without reading
// back the app's internal zoom/scale state.
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;

// Document A, page 1's drawn rectangle (the red "door"), in the SAME
// top-left-origin bbox convention analysisSchemaV1.ts documents
// (AnalysisSource.pageSize / EvidenceBox.bbox) — converted by hand from the
// PDF-space (bottom-left-origin) rectangle the generator script draws; see
// that script's own comment for the conversion.
export const DOC_A_PAGE1_DOOR_BBOX: [number, number, number, number] = [250, 280, 360, 350];
// Document A, page 2's drawn rectangle (the blue "window").
export const DOC_A_PAGE2_WINDOW_BBOX: [number, number, number, number] = [80, 202, 220, 292];
// Document B, page 1's drawn rectangle (the green "column").
export const DOC_B_PAGE1_COLUMN_BBOX: [number, number, number, number] = [350, 522, 440, 642];

const E2E_MODEL = "e2e-fixture-model";
const E2E_CONTRACT_VERSION = "e2e-fixture-contract";

function claimFor(documentId: string, revisionId: string, filename: string) {
  return {
    id: `e2e-claim-${documentId}`, project_id: PROJECT_ID, boq_id: BOQ_ID, analysis_run_id: RUN_ID,
    document_id: documentId, document_revision_id: revisionId, filename_at_time_of_analysis: filename,
    content_hash: `e2e-hash-${documentId}`, contract_version: E2E_CONTRACT_VERSION, provider: "openai",
    model: E2E_MODEL, mode: "BOQ", status: "SUCCEEDED", error: null,
    claimed_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:01:00Z",
  };
}

/** The same fixture with the run replaced by a json_import run, which records
 *  no analysed revision (no analysis_run_source rows): the drawings'
 *  provenance is "unknown", so the product must keep Identify unavailable. */
export function withJsonImportRun(f: ReturnType<typeof buildRestFixtures>) {
  return {
    ...f,
    analysis_run: [{ id: RUN_ID, boq_id: BOQ_ID, project_id: PROJECT_ID, source: "json_import", item_count: 2, created_at: "2026-01-01T00:00:00Z", resolved_document_id: null }],
    analysis_run_source: [] as unknown[],
  };
}

export function buildRestFixtures() {
  const boq = { id: BOQ_ID, name: "E2E Test BOQ", project_id: PROJECT_ID };
  const project = { id: PROJECT_ID, name: "E2E Test Project", project_type: null, client_name: null, location: null, status: "active" };

  // An AI-analysed BOQ run, the state in which the review workstation offers
  // Identify / Find Similar: its analysis_run_source claims (below) record that
  // it read each document's CURRENT revision, so revisionFreshness.ts
  // classifies both drawings as "current". A json_import run records no
  // revision, and the product deliberately withholds Identify for it
  // (provenance "unknown") — see the R10 regression test in
  // clickToIdentify.spec.ts, which uses withJsonImportRun() below.
  const analysis_run = [{
    id: RUN_ID, boq_id: BOQ_ID, project_id: PROJECT_ID, source: "ai_api", mode: "BOQ",
    provider: "openai", model: E2E_MODEL, contract_version: E2E_CONTRACT_VERSION,
    item_count: 2, created_at: "2026-01-01T00:00:00Z", resolved_document_id: null,
  }];

  const analysis_review_item = [
    {
      id: ITEM_DOOR_ID, run_id: RUN_ID, sort: 0, review_status: "PENDING_REVIEW",
      item_key: "D1", item_name: "Door D1", flag_reason: null, review_note: null, reviewed_at: null,
      reviewer_json: null,
      ai_json: {
        key: "D1", item: "Door D1", quantity: 1, unit: "nos", confidence: 0.9, aiStatus: "MEASURED",
        source: {
          documentId: DOC_A_ID, document: "document-a.pdf", page: 1,
          evidence: [{ bbox: DOC_A_PAGE1_DOOR_BBOX, page: 1, claim: "quantity" }],
        },
      },
    },
    {
      id: ITEM_COLUMN_ID, run_id: RUN_ID, sort: 1, review_status: "PENDING_REVIEW",
      item_key: "C1", item_name: "Column C1", flag_reason: null, review_note: null, reviewed_at: null,
      reviewer_json: null,
      ai_json: {
        key: "C1", item: "Column C1", quantity: 1, unit: "nos", confidence: 0.9, aiStatus: "MEASURED",
        source: {
          documentId: DOC_B_ID, document: "document-b.pdf", page: 1,
          evidence: [{ bbox: DOC_B_PAGE1_COLUMN_BBOX, page: 1, claim: "quantity" }],
        },
      },
    },
  ];

  const project_document = [
    { id: DOC_A_ID, project_id: PROJECT_ID, name: "Document A.pdf", current_revision_id: DOC_A_REVISION_ID },
    { id: DOC_B_ID, project_id: PROJECT_ID, name: "Document B.pdf", current_revision_id: DOC_B_REVISION_ID },
  ];
  const document_revision = [
    {
      id: DOC_A_REVISION_ID, document_id: DOC_A_ID, file_path: `${PROJECT_ID}/${DOC_A_ID}/rev-a.pdf`,
      original_filename: "document-a.pdf", page_count: 3, page_titles: null, content_hash: null,
    },
    {
      id: DOC_B_REVISION_ID, document_id: DOC_B_ID, file_path: `${PROJECT_ID}/${DOC_B_ID}/rev-b.pdf`,
      original_filename: "document-b.pdf", page_count: 2, page_titles: null, content_hash: null,
    },
  ];

  return {
    boq, // singular
    projects: project, // singular
    analysis_run,
    analysis_review_item,
    project_document,
    document_revision,
    boq_line: [] as unknown[],
    // One SUCCEEDED BOQ-mode claim per document, naming its current revision.
    // There is no LOCATION-mode claim, so LOCATION stays NOT_RUN on every
    // document (the mock applies the app's mode=LOCATION filter).
    analysis_run_source: [
      claimFor(DOC_A_ID, DOC_A_REVISION_ID, "document-a.pdf"),
      claimFor(DOC_B_ID, DOC_B_REVISION_ID, "document-b.pdf"),
    ] as unknown[],
    analysis_observation: [] as unknown[],
    user_roles: [{ user_id: "e2e-user-1", role: "ops" }],
  };
}

/** Tables whose REST response is always a single JSON object (queried with
 *  `.single()` in the app), never an array. Everything else in
 *  buildRestFixtures() is returned as an array. */
export const SINGLE_OBJECT_TABLES = new Set(["boq", "projects"]);
