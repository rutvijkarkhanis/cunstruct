# UX charter Phase 0: shell map and capability inventory

**Task:** issue #224 (W2.1). **Charter section served:** §8.1 (Phase 0), with §7 for dispositions and §11.4 decision 8 for viewports. The charter is v1.1, read from PR #209's branch (docs/ux-ui-revamp-charter-v1-1-approved); it is not yet on `main`.
**Code inspected:** `main` @ `1c47814` (27 Oct 2026).
**Author:** Ruthvich (agent). **Status: for owner review.** Nothing here is a decision. §2, §4, §5 and §6 are **proposals** for the owner (Rutvij) to accept, change or reject at the Phase 0 gate.

This builds on two earlier documents and does not repeat them:

- [`docs/B12-ROUTE-INVENTORY.md`](../B12-ROUTE-INVENTORY.md) lists all 75 `<Route>`s in `src/App.tsx`. `src/lib/routeInventory.test.ts` checks it against the code. §1 below groups those routes by the layout that wraps them.
- [`docs/UX-UI-AUDIT.md`](../UX-UI-AUDIT.md) (16 Oct 2026) holds the screen-by-screen findings, axe results and widths tested. It is cited where it is evidence. Where `main` has changed since then, this says so.

`src/test/uxInventory.test.ts` fails if any file, exported function or test named in this document's backticks no longer exists, if a capability in charter §8.1 item 3 has no row, or if a production status is not one of the three allowed values.

### Evidence labels

- **[code]** read in the source on `main` @ `1c47814`.
- **[test]** asserted by a named test that passes on that commit.
- **[prod-log]** recorded in [`docs/deployment-log.md`](../deployment-log.md) as observed in production. Not re-checked by this task. No agent signed in to production for this inventory.
- **[audit]** observed in the 16 Oct 2026 audit against "the configured Supabase project". The audit does not name that project as production, so it is not counted as production evidence here.
- **[inferred]** a conclusion from the above, labelled as such.
- **[unknown]** not established. Listed in §7.

---

## 1. Shell map (observed)

The app subdomain (`VITE_IS_APP_SUBDOMAIN`, `src/lib/subdomain.ts`) serves every staff and contractor route. The main domain serves the storefront and sends app paths across with `CrossDomainRedirect` (`src/App.tsx`). [code]

### 1.1 Layouts and the routes they wrap

| Shell (layout component) | Wraps (B12 rows) | Gate | Chrome it draws | Notes |
|---|---|---|---|---|
| **Project journey**: `src/components/app/AppLayout.tsx` | `/app`, `/app/projects` | Signed out → `/auth?returnUrl=…`. Signed in, not staff → `/my-projects`. Waits for roles before deciding. [code] [test: `src/components/app/AppShell.test.tsx`] | Top bar: "Cunstruct", **Projects**, **Ops console**, Sign out; skip link; `<main id="app-main">`; guide panel (`src/components/guide/GuidePanel.tsx`) | The only shell with a skip link and a `main` landmark on every page. [code] |
| ↳ **Project shell**: `src/components/app/ProjectShell.tsx` (inside AppLayout) | `/app/projects/:id/{overview, drawings, review, boq, check, export}`; index → `overview`; unknown step → inline "This step is not available." | As AppLayout | Back to Projects; editable project name (`src/components/app/ProjectNameEditor.tsx`); BOQ phases; numbered step tabs (`PROJECT_STEPS` in `src/components/app/projectShellContext.ts`); step status and Back/Next | The selected BOQ travels in `?boq=` across steps. [code] [test: `src/components/app/AppShell.test.tsx`] |
| ↳↳ **Workbench preview**: `src/components/app/WorkbenchLayout.tsx` (inside ProjectShell) | `/app/projects/:id/workbench/*`, 7 rows | `WORKBENCH_PREVIEW_ENABLED` (`src/lib/workbenchPreview.ts`): off by default; refused against the production Supabase project | One section nav (Overview, Drawings, Review, BOQ, Check, Export); hides the journey steps | **Not a production route.** It embeds the review workstation (`src/components/app/WorkbenchReview.tsx`) so review stays in `/app`. [code] [test: `src/lib/workbenchPreview.test.ts`, `src/lib/app/journey.workbench.test.ts`] |
| **Ops console**: `src/components/ops/OpsLayout.tsx` | The 26 `/ops` rows | Signed out → `/auth` (no return URL). Not staff → "Operations access required". [code] | Left sidebar with 11 entries (Overview, Projects, Stage Master, Stage Mappings, BOQ Templates, BOQ, Forecasts, Business Forecast, Onboarding Queue, Anomalies, WhatsApp Briefings), a "Project journey" link, Sign out. Mobile: hamburger drawer below `md` | Draws **no** chrome on `…/boqs/:boqId/review` and `…/workspace` (URL-shape check). [code] |
| ↳ **Ops project layout**: `src/components/ops/ProjectLayout.tsx` (inside OpsLayout) | `/ops/projects/:id/*`; index → `workspace`; `documents` → `../workspace?mode=documents`; `boqs` → `../workspace?mode=boq` | As OpsLayout | Back to Projects; project name; tabs **Workspace** and **Activity** | Full-bleed (no chrome) on Workspace, Review and the bare BOQ editor route. [code] [test: `src/components/ops/ProjectLayout.test.tsx`] |
| **No layout**: contractor pages | `/my-projects`, `/my-projects/:id`, `/my-projects/:id/order`, `/contractor/my-projects/:id` | Each page checks auth itself; staff opening `/my-projects` are sent to the staff list [test: `src/pages/MyProjects.staff.test.tsx`] | Page's own | Contractor role was not evaluated by the audit (no test account). [audit] |
| **No layout**: shared and reference pages | `/auth`, `/privacy`, `/share/:token`, `/design-system`, `/ops/engineering-preview` (inside OpsLayout) | `/share/:token` is public by design; `/design-system` renders in dev or for staff, else 404 | Page's own | `PublicWorkspaceShare` sits outside OpsLayout on purpose (comment in `src/App.tsx`). [code] |
| **Storefront** (main domain) | 20 storefront rows | Public | Storefront pages' own | Out of the estimation path (charter §3.4). |

### 1.2 Signed-in landing route

| Entry | Where a staff user lands | Where a non-staff user lands | Source |
|---|---|---|---|
| Sign-in at `/auth` with no return URL | `/app/projects` | `/my-projects` | `src/pages/Auth.tsx:38` [code] [test: `src/context/AuthContext.test.tsx`] |
| Sign-in with `?returnUrl=` | the return URL | the return URL | `src/pages/Auth.tsx:34` [code] |
| App subdomain `/` | `/app/projects` (then AppLayout) | `/my-projects` (AppLayout sends them) | `src/App.tsx` [code] |
| Password reset completion | `/app/projects` | `/my-projects` | `src/pages/Auth.tsx:68` [code] |

**Change since the audit:** the audit (§3.2) found staff landing on the Ops procurement dashboard (`/ops`) and `/` going to `/my-projects`. On `main` both now go to `/app/projects` (commit `80c689f`). This is code-confirmed only. Whether production serves this commit was **not** checked. [code] [unknown]

### 1.3 Hand-offs between shells (observed)

Project work still crosses from `/app` into `/ops` at these points. Each is a link, so the `/ops` page opens inside OpsLayout's chrome, or without chrome on full-bleed routes. All pass a `returnTo` back to the journey (`src/lib/app/journey.ts#safeJourneyReturn`). [code]

| From (journey) | To (Ops) | Built by | Why it leaves `/app` |
|---|---|---|---|
| Review quantities step: "Open review" (`src/pages/app/ProjectReview.tsx`) and Drawings → review (`src/components/app/DrawingProcessingPanel.tsx`) | `/ops/projects/:id/boqs/:boqId/review` | `src/lib/app/journey.ts#reviewWorkstationPath` | Review decisions, Identify and Apply live only in `src/pages/ops/BoqReviewWorkstation.tsx` |
| Build BOQ and Check & export: "Edit in builder" (`src/pages/app/ProjectBoq.tsx`, `src/pages/app/ProjectExport.tsx`) | `/ops/projects/:id/boqs/:boqId` | `src/lib/app/journey.ts#builderPath` | Commercials, Make, Materials, client view, revisions, audit import and work packages live only in `src/pages/ops/OpsBoqBuilder.tsx` |
| "Create a BOQ" / "Open this project's BOQs" (Review, BOQ, Export steps) | `/ops/projects/:id/boqs/manage` | `src/lib/app/journey.ts#manageBoqsPath` | BOQ creation, delete, reorder, import and generate-from-JSON live in `src/pages/ops/ProjectBoqs.tsx` |
| Project header: "Edit details in the Ops console" | `/ops/projects` | `src/components/app/ProjectShell.tsx` | Client, location, type and area are edited in `src/pages/ops/OpsProjects.tsx` |
| Empty project list: "onboard a project in the Ops console" | `/ops/projects` | `src/pages/app/AppProjects.tsx` | Project onboarding |
| Top bar: "Ops console" | `/ops` | `src/components/app/AppLayout.tsx` | Global |

Going the other way, OpsLayout's "Project journey" links to `/app/projects`. Sharing, folders and Analyze Project are reached from the Ops workspace (`src/pages/ops/ProjectWorkspace.tsx`); the journey's Drawings step opens the same Analyze panel (`src/components/ops/workspace/WorkspaceAnalyzePanel.tsx`) in place. [code]

---

## 2. Canonical shell and route tree: PROPOSAL

> **Proposal for the owner. Not a decision.** Charter §8.1 item 2 and the Phase 0 gate make this the owner's call.

### 2.1 Options

| | **A. Evolve the `/app` project shell** (AppLayout + ProjectShell) | **B. Evolve the `/ops` project shell** (OpsLayout + ProjectLayout + ProjectWorkspace) |
|---|---|---|
| Already the signed-in landing | Yes (§1.2) | No |
| Project-level areas (charter §4) | Has Overview, Drawings, Review, BOQ, Check and Export, matching the charter's four areas | Has Workspace (drawing-first, with BOQ, Materials, Analyze and Review modes) and Activity (forecasting) |
| Persistent project context | `?boq=` survives every step [test] | Mode, document, page and BOQ in the URL (`src/lib/review/workspaceState.ts`) |
| Accessibility evidence | 0 axe violations at 1280/768/390 on the five journey screens; skip link and `main` landmark [audit] | Workspace and Review lacked `h1`/`main` [audit] |
| Global navigation | Two items (Projects, Ops console) | 11 items, mostly procurement and forecasting (charter §3.4 says these must not compete) |
| Capabilities still elsewhere | Review/Apply/Identify, builder-only features and BOQ management (§1.3) | Journey's step status, export checks, DSR check section, line history and evidence panels |
| Existing single-workbench work | The workbench preview already sits inside ProjectShell and embeds review there | None |
| Conflicts with earlier plans | B12 named `/ops/projects/:id/workspace` as the "B1 workspace" and proposed redirecting `/app/*` into it | Matches B12 |

### 2.2 Recommendation: option A

Evolve `/app/projects/:id` as the canonical project shell. Specialist surfaces (review workstation, BOQ editor) become full-screen routes **under** it rather than under `/ops`. The reasons, with evidence: it is already the landing route; its sections already match charter §4; it has the best accessibility evidence; it keeps the procurement and forecasting navigation out of the project path; and the workbench preview has already shown that the review workstation can be embedded there without changing the review engine. [code] [audit] [inferred]

**This contradicts B12's proposed dispositions**, which redirect `/app/*` into the Ops workspace. B12's rows are themselves proposals ("Nothing has been removed or redirected"), so nothing has to be undone. If the owner accepts option A, B12's disposition column needs a follow-up edit in its own task. This task does not edit it.

### 2.3 Proposed route tree (option A)

| Proposed route | Today | Compatibility redirect once parity is shown (charter §8.2) |
|---|---|---|
| `/app/projects` | Same | `/ops/projects` (project list part only) |
| `/app/projects/:id` → status | `/app/projects/:id/overview` | `/ops/projects/:id`, `/ops/projects/:id/workspace` (after Workspace parity) |
| `/app/projects/:id/drawings` | Same | `/ops/projects/:id/documents` (already redirects to Workspace) |
| `/app/projects/:id/review` (full-screen workstation inside the shell) | Hand-off to `/ops/projects/:id/boqs/:boqId/review` | `/ops/projects/:id/boqs/:boqId/review` |
| `/app/projects/:id/boq` (full-screen editor inside the shell) | Journey table plus hand-off to `/ops/projects/:id/boqs/:boqId` | `/ops/projects/:id/boqs/:boqId`, `/ops/boq/:id` |
| `/app/projects/:id/boq/manage` or a BOQ sheet | Hand-off to `/ops/projects/:id/boqs/manage` | `/ops/projects/:id/boqs/manage`, `/ops/projects/:id/boqs` |
| `/app/projects/:id/check`, `/export` (charter §11.4 decision 1 decides whether these merge) | Same | none |
| Signed-in landing: `/app/projects` (unchanged) | Same | — |

Until each redirect lands, every row of §1.3 is a **transition exception** under charter §8.2: it must be recorded with its removal gate. Proposed gates: review hand-off → Phase 2 gate (the first slice needs review in the shell); builder and BOQ-management hand-offs → Phase 3 gate (BOQ consolidation); project-details hand-off → Phase 2 gate.

---

## 3. Capability matrix (charter §8.1 item 3)

Each row: owning components, persistence (exported functions, then tables or database functions, which the test checks against `supabase/migrations/` and `supabase/deferred-migrations/`), tests that protect it today, and production status.

**Production status** is exactly one of: **works**, **unavailable (migration not applied)**, or **unknown — owner check needed**. "works" is used only where `docs/deployment-log.md` records the behaviour passing in production. Everything else is unknown, however well tested. Passing tests are listed as protection, not as production evidence.

<!-- matrix:start -->
| # | Capability | Owning components | Persistence (functions; tables) | Protecting tests | Production status | Evidence and notes |
|---|---|---|---|---|---|---|
| 1 | Project | `src/pages/app/AppProjects.tsx`, `src/components/app/ProjectNameEditor.tsx`, `src/pages/ops/OpsProjects.tsx` | `src/lib/app/projectsQuery.ts#loadAppProjects`, `src/lib/app/draftProject.ts#createDraftProject`, `src/lib/app/draftProject.ts#renameProject`; `projects` | `src/lib/app/projects.test.ts`, `src/lib/app/draftProject.test.ts`, `src/components/app/ProjectNameEditor.test.tsx`, `src/pages/app/AppProjects.upload.test.tsx` | unknown — owner check needed | Table present (2026-10-21 read-only schema probe) [prod-log]. Project list read on 16 Oct [audit]. Create, rename and edit-details not observed in production. |
| 2 | Documents | `src/pages/app/ProjectDrawings.tsx`, `src/components/app/UploadDrawingsCard.tsx`, `src/components/app/RemoveDrawingDialog.tsx`, `src/components/ops/workspace/WorkspaceSources.tsx`, `src/components/review/PdfEvidenceViewer.tsx` | `src/hooks/useDocumentManagement.ts#uploadProjectDrawing`, `src/hooks/useDocumentManagement.ts#removeProjectDocument`, `src/lib/review/drawingStorage.ts#loadProjectDrawings`; `project_document`, `boq_document` | `src/hooks/useDocumentManagement.test.tsx`, `src/hooks/useDocumentManagement.remove.test.ts`, `src/pages/app/ProjectDrawings.test.tsx`, `src/pages/app/ProjectDrawings.remove.test.tsx`, `src/components/review/PdfEvidenceViewer.test.tsx` | unknown — owner check needed | Viewer opened 4-page PDFs on 16 Oct [audit]. Upload and remove were blocked by the audit's write guard; not observed in production. |
| 3 | Folders | `src/components/ops/workspace/WorkspaceSourceManager.tsx` | `src/lib/documentFolders.ts#buildFolderTree`, `src/hooks/useDocumentManagement.ts#useDocumentManagement`; `document_folder` | `src/lib/documentFolders.test.ts`, `src/components/ops/workspace/WorkspaceSourceManager.test.tsx` | unknown — owner check needed | Table present (2026-10-21 probe: 43 history rows match the schema) [prod-log]. Folder UI exists only in the Ops workspace, not in `/app`. [code] |
| 4 | Revisions (drawing revisions and freshness) | `src/components/ops/workspace/WorkspaceSourceManager.tsx`, `src/pages/ops/BoqReviewWorkstation.tsx` | `src/lib/review/revisionFreshness.ts#assessRunFreshness`, `src/lib/review/revisionFreshness.ts#assertApplyAllowed`; `document_revision` | `src/lib/review/revisionFreshness.test.ts`, `src/pages/ops/BoqReviewWorkstationFreshness.test.tsx`, `src/lib/review/applyReviewFreshness.test.ts` | unknown — owner check needed | Freshness guard is a charter §3.6 safeguard. No production observation recorded. |
| 5 | Analysis (Analyze Project) | `src/components/ops/workspace/WorkspaceAnalyzePanel.tsx`, `src/components/app/DrawingProcessingPanel.tsx` | `src/lib/ai/projectAnalysis.ts#runProjectAnalysis`, `src/lib/ai/analysisClient.ts#generateAnalysis`; `analysis_run`, `analysis_run_source`, `ai_operation_log` | `src/components/ops/workspace/WorkspaceAnalyzePanel.test.tsx`, `src/lib/ai/projectAnalysis.test.ts`, `src/lib/ai/analysisClient.test.ts`, `src/components/app/DrawingProcessingPanel.test.tsx` | unknown — owner check needed | PLAN.md (W1) and PR #215 report HTTP 502 from Analyze Project in production; cause not yet established. W1 (Learnator) owns this. Paid AI call; agents must not run it. |
| 6 | Identify (click-to-identify, find similar) | `src/pages/ops/BoqReviewWorkstation.tsx`, `src/components/review/IdentifyResultPanel.tsx`, `src/components/review/FindSimilarResultPanel.tsx` | `src/lib/ai/identifyClient.ts#identifyAtPoint`, `src/lib/ai/findSimilarClient.ts#findSimilar`; `analysis_review_item` | `src/pages/ops/BoqReviewWorkstationIdentify.test.tsx`, `src/lib/ai/identifyClient.test.ts`, `src/pages/ops/BoqReviewWorkstationFindSimilar.test.tsx`, `src/components/review/IdentifyResultPanel.test.tsx` | unknown — owner check needed | Reachable only inside the review workstation (`/ops`). Calls the `ai-analysis` function (paid). |
| 7 | Review decisions and Apply | `src/pages/ops/BoqReviewWorkstation.tsx`, `src/pages/app/ProjectReview.tsx`, `src/components/review/ApplyReceiptPanel.tsx` | `src/lib/review/reviewStore.ts#saveReviewDecision`, `src/lib/review/applyReview.ts#applyReviewPlan`; `analysis_review_item`, `boq_line_change_log` | `src/pages/ops/BoqReviewWorkstationApplyGate.test.tsx`, `src/lib/review/applyReview.test.ts`, `src/lib/review/reviewStore.test.ts`, `src/pages/app/JourneyApply.integration.test.tsx`, `src/pages/app/ProjectReview.test.tsx` | unknown — owner check needed | Apply was **not** exercised in production (V1 open; owner accepted local-only coverage on 2026-10-21) [prod-log]. Apply gate observed blocking on 16 Oct [audit]. |
| 8 | BOQ management | `src/pages/ops/ProjectBoqs.tsx`, `src/components/ops/workspace/WorkspaceBoqPanel.tsx`, `src/components/app/BoqPicker.tsx`, `src/components/app/WorkbenchLayout.tsx` | `src/hooks/useBoqManagement.ts#useBoqManagement`, `src/lib/app/boqRename.ts#renameBoq`, `src/lib/boqImport.ts#parseBoqImport`, `src/lib/boqEvalJson.ts#parseBoqEvalJson`; `boq`, `project_scope` | `src/hooks/useBoqManagement.test.tsx`, `src/pages/ops/ProjectBoqs.test.tsx`, `src/pages/ops/ProjectBoqs.pending.test.tsx`, `src/lib/app/boqRename.test.ts`, `src/lib/boqImport.test.ts`, `src/components/ops/workspace/WorkspaceBoqPanel.test.tsx` | unknown — owner check needed | Create, rename, reorder, delete, import, generate-from-JSON and move live in `ProjectBoqs` (`/ops`). Rename is also in the workbench preview. |
| 9 | Line-level BOQ editing: rate, remove, exclude, undo, stale-edit refusal | `src/pages/ops/OpsBoqBuilder.tsx` | `src/lib/manualRateEdit.ts#applyManualRateEdit`, `src/lib/lineRemoval.ts#removeLineWithSnapshot`, `src/lib/lineRemoval.ts#restoreRemovedLine`; `boq_line`, `boq_line_change_log` | `src/pages/ops/OpsBoqBuilder.rateEdit.test.tsx`, `src/pages/ops/OpsBoqBuilder.removeUndo.test.tsx`, `src/pages/ops/OpsBoqBuilder.editSafety.test.tsx`, `src/lib/manualRateEdit.test.ts`, `src/lib/lineRemoval.test.ts` | works | On ZZ-TEST, 2026-10-21: manual rate set then undone; line removed then restored; line excluded then restored; two-tab stale edit refused. Each reversed with the app's Undo [prod-log]. Known defect: the builder's rate input shows the undone value until reload (`docs/bugs/BOQ-BUILDER-STALE-RATE-AFTER-UNDO.md`). |
| 10 | Line-level BOQ editing: quantity, unit, description, add line, line history, evidence | `src/pages/app/ProjectBoq.tsx`, `src/components/app/BoqTable.tsx`, `src/components/app/AddLineForm.tsx`, `src/components/app/LineHistoryPanel.tsx`, `src/components/app/LineEvidencePanel.tsx`, `src/pages/ops/OpsBoqBuilder.tsx` | `src/lib/lineEdit.ts#saveLineEdit`, `src/lib/lineEdit.ts#addLineRecorded`, `src/lib/app/newLine.ts#buildNewLine`, `src/lib/app/lineHistory.ts#loadLineHistory`, `src/lib/lineEvidence.ts`; `boq_line`, `boq_line_change_log` | `src/components/app/BoqTable.test.tsx`, `src/pages/app/ProjectBoq.test.tsx`, `src/lib/lineEdit.test.ts`, `src/lib/app/lineHistory.test.ts`, `src/components/app/undoHistory.test.ts`, `src/pages/ops/OpsBoqBuilder.fieldSync.test.tsx`, `src/pages/app/JourneyRecovery.integration.test.tsx` | unknown — owner check needed | Two editors with different models (journey click-to-edit vs builder always-on inputs) [audit]. These edits were not in the 2026-10-21 smoke set. |
| 11 | Make (margin) | `src/pages/ops/OpsBoqBuilder.tsx` | `src/lib/boqLiveExport.ts#lineAmount`; `boq_line` | `src/pages/ops/OpsBoqBuilder.fieldSync.test.tsx` | unknown — owner check needed | Builder view "Make": quote − cost per line. Only the cost input's save is tested; the margin arithmetic has no dedicated test (grep for the view found none). |
| 12 | Materials | `src/pages/ops/OpsBoqBuilder.tsx`, `src/components/ops/workspace/WorkspaceContext.tsx` | `src/lib/boqExplode.ts#explodeMaterials`; `dsr_coefficient`, `boq_line` | `src/lib/boqExplode.test.ts`, `src/components/ops/workspace/WorkspaceContext.test.tsx` | unknown — owner check needed | Two different things share the name: the builder's coefficient explosion, and the workspace panel listing lines linked to a catalogue product (reads products_master, which no repo migration creates; origin not established). |
| 13 | Client presentation | `src/pages/ops/OpsBoqBuilder.tsx` | `src/lib/boqLiveExport.ts#commercialsFor`; `boq` | none found | unknown — owner check needed | "Show to client" / `p` hides internal figures. **No test protects it** (searched for "Show to client" and "client view"). Parity risk if the builder is retired. |
| 14 | DSR checks (schedule check, accept/reject/defer, use schedule rate) | `src/components/app/DsrCheckSection.tsx`, `src/pages/app/ProjectExport.tsx` | `src/lib/dsr/scopeStore.ts#saveScopeDecision`, `src/lib/dsr/scopeStore.ts#applyScheduleRate`, `src/lib/dsr/scopeStore.ts#acceptScopeSuggestion`; `dsr_item`, `boq_line_change_log` | `src/pages/app/DsrCheck.integration.test.tsx`, `src/lib/dsr/scopeStore.test.ts`, `src/lib/dsr/match.test.ts`, `src/lib/dsr/scope.test.ts` | unknown — owner check needed | Not exercised in production: ZZ-TEST had no matches or suggestions (V2 open; owner accepted local-only coverage) [prod-log]. |
| 15 | DSR mapping | `src/pages/ops/BoqDsrMapping.tsx`, `src/components/ops/DsrPicker.tsx` | `src/hooks/useDsrMapping.ts#useDsrMapping`, `src/lib/dsrMapping.ts#mappingWriteFor`; `boq_line_dsr_mapping` | `src/pages/ops/BoqDsrMapping.test.tsx`, `src/lib/dsrMapping.test.ts`, `src/lib/dsrMappingMigration.test.ts` | unavailable (migration not applied) | `20261003000000` is in `supabase/deferred-migrations/` (R8 chain, undecided); builder requests to deferred tables returned 404 on 2026-10-21 [prod-log]. The charter's reported "broken DSR-mapping route" (§2) may be this; not confirmed. |
| 16 | Commercial: rate evidence and vendor quotations | `src/components/ops/RateEvidencePanel.tsx`, `src/pages/ops/BoqDsrMapping.tsx` | `src/hooks/useRateEvidence.ts#useRateEvidence`, `src/lib/rateEvidence.ts#buildRateComparison`; `vendor_quotation`, `boq_line_rate_review` | `src/lib/rateEvidence.test.ts`, `src/lib/rateEvidenceMigration.test.ts`, `src/pages/ops/BoqDsrMapping.rates.test.tsx` | unavailable (migration not applied) | `20261004000000`, deferred chain [prod-log] [code]. |
| 17 | Commercial: rate adoption | `src/components/ops/RateAdoptionPreview.tsx`, `src/pages/ops/BoqDsrMapping.tsx` | `src/hooks/useRateAdoption.ts#useRateAdoption`, `src/lib/rateAdoption.ts#applyRateAdoption`; `adopt_boq_line_rate`, `boq_line_rate_adoption` | `src/lib/rateAdoption.test.ts`, `src/lib/rateAdoptionMigration.test.ts`, `src/pages/ops/BoqDsrMapping.adoption.test.tsx`, `src/lib/applyAdoptedRate.test.ts` | unavailable (migration not applied) | `20261005000000`, deferred chain [prod-log] [code]. |
| 18 | Commercial: commercials (cost index, contingency, overhead, cess, GST) | `src/pages/ops/OpsBoqBuilder.tsx`, `src/components/app/WorkbenchCommercials.tsx` | `src/lib/boqSpecWrite.ts#writeBoqSpecKeys`, `src/lib/boqLiveExport.ts#commercialsFor`, `src/lib/app/commercials.ts#undoSpecChange`; `boq` | `src/lib/boqSpecWrite.test.ts`, `src/lib/app/commercials.test.ts`, `src/lib/dsrGstIncluded.test.ts`, `src/lib/dsrCpohCessIncluded.test.ts` | unknown — owner check needed | Stored in `boq.spec`, so no deferred migration is needed [code]. Not observed in production. |
| 19 | Commercial: commercial revisions (freeze, diff, revision export) | `src/components/ops/BoqRevisionsPanel.tsx`, `src/components/ops/RevisionViewer.tsx`, `src/components/app/WorkbenchRevisions.tsx`, `src/pages/app/ProjectExport.tsx` | `src/hooks/useBoqRevisions.ts#useBoqRevisions`, `src/lib/boqRevision.ts#buildRevisionLines`; `create_boq_commercial_revision`, `boq_commercial_revision`, `boq_commercial_revision_line` | `src/components/ops/BoqRevisionsPanel.test.tsx`, `src/hooks/useBoqRevisions.export.test.tsx`, `src/lib/boqRevision.test.ts`, `src/lib/boqRevisionMigration.test.ts`, `src/pages/ops/OpsBoqBuilder.revisions.test.tsx` | unavailable (migration not applied) | `20261006000000`–`20261008000000`, deferred chain [prod-log]. `GET boq_commercial_revision` 404 on 16 Oct [audit]. The UI says so (`REVISIONS_UNAVAILABLE_MESSAGE`). |
| 20 | Sharing | `src/components/ops/workspace/ShareLinksDialog.tsx`, `src/pages/PublicWorkspaceShare.tsx`, `src/components/share/ShareBoqPanel.tsx` | `src/hooks/useShareLinks.ts#useShareLinks`; `project_share_link` | `src/hooks/useShareLinks.test.tsx`, `src/components/ops/workspace/ShareLinksDialog.test.tsx`, `src/pages/PublicWorkspaceShare.test.tsx`, `src/components/share/ShareBoqPanel.test.tsx`, `src/lib/ai/shareWorkspaceHandler.test.ts` | unknown — owner check needed | Table present per 2026-10-21 probe [prod-log]. Plan of record v1.2: "R3 sharing is parked by owner decision". Uses the `workspace-share` function. |
| 21 | Exports (live PDF quote, CSV, work packages, project quote) | `src/pages/app/ProjectExport.tsx`, `src/pages/ops/OpsBoqBuilder.tsx`, `src/pages/ops/ProjectBoqs.tsx` | `src/lib/boqLiveExport.ts#liveQuotePayload`, `src/lib/boqLiveExport.ts#liveCsv`, `src/lib/boqDsrDocument.ts#openQuoteWindow`, `src/lib/boqDsrDocument.ts#openProjectQuote`, `src/lib/exportFreshness.ts#rereadForExport`, `src/lib/workPackages.ts#buildWorkPackageCsv`, `src/lib/boqDraftDisclaimer.ts`; `boq`, `boq_line` | `src/pages/app/ProjectExport.test.tsx`, `src/lib/boqLiveExport.test.ts`, `src/lib/boqDsrDocument.test.ts`, `src/lib/exportFreshness.test.ts`, `src/lib/boqExportConsistency.test.ts`, `src/lib/workPackages.test.ts`, `src/pages/ops/OpsBoqBuilder.exportGuard.test.tsx` | unknown — owner check needed | PDF and CSV generated on 16 Oct [audit]. Draft disclaimer is a charter §3.6 trust feature. `src/lib/tenderExport/index.ts` exists but nothing outside its folder imports it [code]. |
<!-- matrix:end -->

### 3.1 What the matrix shows (inferred)

- **One capability has production evidence of working** (row 9), and it lives only in the Ops builder. Any consolidation must carry its tests (`OpsBoqBuilder.rateEdit`, `.removeUndo`, `.editSafety`) to the new editor (charter §8.6).
- **Four capabilities are unavailable** (rows 15, 16, 17, 19), all from the undecided R8 deferred chain. Under charter §8.1 they are not parity requirements, and their future is owner decision 9 (§11.4).
- **Builder-only capabilities without a journey equivalent:** Make, Materials (coefficients), client presentation, commercials editing (except the workbench preview), audit import, work packages, intake form. These are the parity gap for option A.
- **Untested capability:** client presentation (row 13) has no test.

---

## 4. Disposition table: PROPOSAL (charter §7)

> **Proposal for the owner. Not a decision.** No disposition may be acted on until the owner approves it and §7's seven-point trace is complete for that surface. "Proposed" means this task's recommendation. Retirement needs demonstrated parity, including ported tests.

| Surface (routes, see B12) | Proposed disposition | Replacement / where it would live | Before it can move |
|---|---|---|---|
| Journey shell and steps (`/app/projects/**`) | **KEEP** (canonical, option A) | — | Owner accepts §2 |
| Workbench preview (`/app/projects/:id/workbench/*`) | **CONSOLIDATE** into the journey shell | Its section nav and embedded review become the shell's | Owner accepts §2; Phase 2 slice |
| Review workstation (`/ops/projects/:id/boqs/:boqId/review`) | **RELOCATE** under the canonical shell; engine unchanged | `/app/projects/:id/review` (full-screen) | Review, Identify, Apply and freshness tests run against the new route |
| BOQ builder (`/ops/projects/:id/boqs/:boqId`, `/ops/boq/:id`) | **CONSOLIDATE** with the journey BOQ table | One editor under `/app/projects/:id/boq` | Parity for rows 9–13, 18, 21, with ported tests; undo model decided (§11.4 decision 7) |
| BOQ management (`/ops/projects/:id/boqs/manage`) | **RELOCATE** | A BOQ sheet or sub-route in the canonical shell | Create, delete, reorder, import, generate-from-JSON, move |
| Ops Workspace (`/ops/projects/:id/workspace`) | **INVESTIGATE** | Drawings & Review area of the canonical shell | Folders, sharing, Materials panel and Analyze have no journey home yet |
| DSR mapping (`…/dsr-mapping`, both trees) | **INVESTIGATE** (unavailable; owner decision 9) | — | Charter §8.4: links to unavailable capabilities are hidden where appropriate |
| Ops project Activity (`/ops/projects/:id/activity`) | **RELOCATE** out of the project path | Forecasting area, if kept | Owner decision 4 |
| Ops project Procurement (`/ops/projects/:id/procurement`) | **INVESTIGATE** | — | Owner decision 4 |
| Ops dashboard and forecasting pages (`/ops`, stages, mappings, forecasts, projections, anomalies, briefings, onboarding) | **RELOCATE** to a secondary area outside the estimation path | Separate admin/forecasting area | Owner decision 4. Not "dead": WhatsApp functions and forecast tables back them |
| BOQ templates (`/ops/boq-templates`) | **INVESTIGATE** | Reference/admin area | Whether templates feed estimation |
| Ops BOQ list (`/ops/boq`) | **CONSOLIDATE** into the project index | `/app/projects` | Cross-project BOQ search need confirmed |
| Ops projects list (`/ops/projects`) | **CONSOLIDATE** | `/app/projects` plus project-details editing | Edit-details and delete-project parity |
| Engineering preview (`/ops/engineering-preview`) | **INVESTIGATE** | — | Mock-only prototype; charter §5.2 says reuse patterns only |
| Contractor views (`/my-projects/**`, `/contractor/my-projects/:id`) | **KEEP** as is, outside the estimation path | — | Owner decision 4; never evaluated with a contractor account |
| Storefront (main domain) | **KEEP** as is, outside the estimation path | — | Owner decision 4 |
| Public share (`/share/:token`), auth, privacy, design system | **KEEP** | — | — |

---

## 5. Usage record and baseline (charter §8.1 item 5): owner input needed

This cannot be produced by an agent. It needs the owner's own use of the product, and charter §8.3 keeps live checks in the owner's session. **Not done.** A proposed capture, for the owner to fill in or change:

| Surface | Used in the last month? (owner) | For what task |
|---|---|---|
| `/app/projects` journey steps | | |
| Ops Workspace | | |
| Review workstation | | |
| BOQ builder (which views: Lines / Make / Materials / client view) | | |
| BOQ management | | |
| Ops dashboard / forecasting / WhatsApp | | |

**Phase 2 slice baseline** (charter §12: "correct and price a quantity while inspecting its source, then verify recovery and the saved/export state"), measured once on the current UI on ZZ-TEST: elapsed time, shell transitions (count `/app` ↔ `/ops` crossings; §1.3 predicts at least two), context lost on return, interaction steps, and errors.

---

## 6. Supported viewports: PROPOSAL (charter §11.4 decision 8)

> **Proposal for the owner. Not a decision.**

| Tier | Width | Scope | Evidence |
|---|---|---|---|
| **Primary** | ≥ 1280 px desktop | Every core task: drawings, review, BOQ editing, check, export | Audit tested 1280; drawing review and dense BOQ editing need canvas width (charter §4) |
| **Secondary** | 768–1279 px tablet | Read everything; review decisions; single-field BOQ edits. Full-screen editing may scroll horizontally inside the table, never the page | Audit tested 768 with no page overflow on the journey; the builder shows its grand-total summary only at `lg` (1024 px) and up [code] |
| **Limited** | 390–767 px phone | Project status, drawing viewing, share links, export download. No commitment to review or BOQ editing | Audit tested 390 with no overflow on the journey; OpsLayout switches to a drawer below `md` [code]. B12 marks contractor phone views as an owner decision |
| Outside these | < 390 px | Documented as unsupported, not tested | — |

Test commitment once accepted: axe and keyboard pass at 1280, 1024 and 768 for every core screen; 390 for the limited set; 200% zoom at 1280 (the audit did not test zoom).

---

## 7. Open items for the owner (unknowns)

1. **Production status of 17 of 21 rows is unknown.** The cheapest way to settle it is one owner session on ZZ-TEST covering rows 1–8, 10–14, 18, 20 and 21 read paths. That is the owner's call (charter §8.3); no agent will sign in.
2. **Which commit production serves.** Every merge deploys, but whether the landing-route change (`80c689f`) is live was not checked.
3. **`products_master`** is read by the Materials panel and product picker, but no file in `supabase/migrations/` creates it.
4. **Approve or change §2 (canonical shell), §4 (dispositions) and §6 (viewports)**, then B12's disposition column needs a follow-up edit.
5. **Usage record and baseline (§5).**

## 8. Limits of this inventory

- Code-confirmed and test-confirmed facts are from `main` @ `1c47814`. Production facts come only from `docs/deployment-log.md` (latest entry 2026-10-21) and were not re-checked.
- The audit's observations are from `feat/app-journey` on 16 Oct; screens may have changed since.
- "Owning components" lists the main components, not every child. "Protecting tests" lists the most direct tests found by name and search, not a full coverage analysis.
- No rendered interface was inspected for this task.
