# B12 route inventory

This is the route inventory for plan item **B12: Remove the old surfaces**, whose acceptance criterion is a "route inventory diff". There is one row for each `<Route>` in `src/App.tsx`, 74 rows in all. Six of them exist only in workbench-preview builds (below).

`src/lib/routeInventory.test.ts` parses `App.tsx` and fails if the route, tree and element columns below no longer match the code. A route that is added, removed or re-pointed therefore has to show up as a diff to this file.

**Status: proposed dispositions only. Nothing has been removed or redirected.**

- v1.2 §5B forbids removing or replacing the old workflow in production under the preview lane.
- B12 itself depends on B1–B9 and B11 being commercially accepted.
- Each disposition is a plan. A disposition marked "owner decision" is the owner's call.

Trees: **storefront** is the main domain. **app** is the app subdomain (`VITE_IS_APP_SUBDOMAIN`).

Rows marked `[gated: …]` are rendered only when that condition holds. `WORKBENCH_PREVIEW_ENABLED` (`src/lib/workbenchPreview.ts`) is off by default and refuses the production Supabase project. When it is off, those paths fall through to `/app/projects/:id/*`. It is a presentation switch, not an access control.

| Tree | Path | Element | Proposed B12 disposition |
|---|---|---|---|
| storefront | `/` | Index | Demote: fulfilment option reached from B11 procurement |
| storefront | `/products` | Products | Demote: fulfilment option reached from B11 procurement |
| storefront | `/product/:id` | ProductDetail | Demote: fulfilment option reached from B11 procurement |
| storefront | `/cart` | Cart | Demote: fulfilment option reached from B11 procurement |
| storefront | `/checkout` | Checkout | Demote: fulfilment option reached from B11 procurement |
| storefront | `/search` | SearchResults | Demote: fulfilment option reached from B11 procurement |
| storefront | `/kit/:id` | KitDetail | Demote: fulfilment option reached from B11 procurement |
| storefront | `/kits` | Kits | Demote: fulfilment option reached from B11 procurement |
| storefront | `/privacy` | Privacy | Keep |
| storefront | `/auth` | Auth | Keep |
| storefront | `/share/:token` | PublicWorkspaceShare | Keep: B10 share-link target |
| storefront | `/design-system` | DesignSystem | Keep: staff-only D1 reference |
| storefront | `/my-projects` | CrossDomainRedirect | Keep |
| storefront | `/my-projects/*` | CrossDomainRedirect | Keep |
| storefront | `/contractor/*` | CrossDomainRedirect | Keep |
| storefront | `/ops/*` | CrossDomainRedirect | Keep |
| storefront | `/ops` | CrossDomainRedirect | Keep |
| storefront | `/app` | CrossDomainRedirect | Keep |
| storefront | `/app/*` | CrossDomainRedirect | Keep |
| storefront | `/*` | NotFound | Keep |
| app | `/` | Navigate → /my-projects | Keep |
| app | `/privacy` | Privacy | Keep |
| app | `/auth` | Auth | Keep |
| app | `/share/:token` | PublicWorkspaceShare | Keep: B10 share-link target |
| app | `/design-system` | DesignSystem | Keep: staff-only D1 reference |
| app | `/my-projects` | MyProjects | Review: contractor views; candidate for B10 phone surfaces (owner decision) |
| app | `/my-projects/:id` | MyProjectDetail | Review: contractor views; candidate for B10 phone surfaces (owner decision) |
| app | `/my-projects/:id/order` | MyProjectOrder | Review: contractor views; candidate for B10 phone surfaces (owner decision) |
| app | `/contractor/my-projects/:id` | MyProjectDetail | Review: contractor views; candidate for B10 phone surfaces (owner decision) |
| app | `/ops` | OpsLayout | Keep: Ops shell |
| app | `/ops (index)` | OpsDashboard | Collapse: to QA/benchmark, rate library and support |
| app | `/ops/engineering-preview` | EngineeringPreview | Becomes the B1 workspace once commercially accepted |
| app | `/ops/projects` | OpsProjects | Keep: Ops shell |
| app | `/ops/projects/:id` | ProjectLayout | Keep: Ops shell |
| app | `/ops/projects/:id (index)` | Navigate → workspace | Keep: B1 workspace entry |
| app | `/ops/projects/:id/documents` | Navigate → ../workspace?mode=documents | Keep: B1 workspace entry |
| app | `/ops/projects/:id/boqs` | Navigate → ../workspace?mode=boq | Keep: B1 workspace entry |
| app | `/ops/projects/:id/boqs/manage` | ProjectBoqs | Fold into B1 workspace, then redirect |
| app | `/ops/projects/:id/boqs/:boqId` | OpsBoqBuilder | Fold into B1 workspace grid, then redirect |
| app | `/ops/projects/:id/boqs/:boqId/review` | BoqReviewWorkstation | Remove (old review screen) → redirect to B5 verify queue |
| app | `/ops/projects/:id/boqs/:boqId/dsr-mapping` | BoqDsrMapping | Fold into B4 price-first / rate library, then redirect |
| app | `/ops/projects/:id/procurement` | ProjectProcurement | Replace with B11, then redirect |
| app | `/ops/projects/:id/activity` | OpsProjectDetail | Fold into B7 sign-off ledger, then redirect |
| app | `/ops/projects/:id/workspace` | ProjectWorkspace | Keep: B1 workspace entry |
| app | `/ops/stages` | OpsStages | Collapse: customer Ops console page (not QA, rate library or support) |
| app | `/ops/mappings` | OpsMappings | Collapse: customer Ops console page (not QA, rate library or support) |
| app | `/ops/forecasts` | OpsForecasts | Collapse: customer Ops console page (not QA, rate library or support) |
| app | `/ops/briefings` | OpsBriefings | Collapse: customer Ops console page (not QA, rate library or support) |
| app | `/ops/anomalies` | OpsAnomalies | Collapse: customer Ops console page (not QA, rate library or support) |
| app | `/ops/projections` | OpsProjections | Collapse: customer Ops console page (not QA, rate library or support) |
| app | `/ops/onboarding` | OpsOnboarding | Collapse: customer Ops console page (not QA, rate library or support) |
| app | `/ops/boq-templates` | OpsBoqTemplates | Collapse: rate library |
| app | `/ops/boq` | OpsBoqList | Remove: duplicate of the project BOQ → redirect |
| app | `/ops/boq/:id` | OpsBoqBuilder | Remove: duplicate of the project BOQ → redirect |
| app | `/ops/boq/:id/dsr-mapping` | BoqDsrMapping | Fold into B4 price-first / rate library, then redirect |
| app | `/app` | AppLayout | Redirect into the B1 workspace |
| app | `/app (index)` | Navigate → projects | Redirect into the B1 workspace |
| app | `/app/projects` | AppProjects | Redirect into the B1 workspace |
| app | `/app/projects/:id` | ProjectShell | Redirect into the B1 workspace |
| app | `/app/projects/:id (index)` | Navigate → overview | Redirect into the B1 workspace |
| app | `/app/projects/:id/overview` | ProjectOverview | Remove (one of the five tabs) → redirect to B1 workspace |
| app | `/app/projects/:id/drawings` | ProjectDrawings | Remove (one of the five tabs) → redirect to B1 workspace |
| app | `/app/projects/:id/review` | ProjectReview | Remove (one of the five tabs) → redirect to B1 workspace |
| app | `/app/projects/:id/boq` | ProjectBoq | Remove (one of the five tabs) → redirect to B1 workspace |
| app | `/app/projects/:id/check` | ProjectExport | Remove (one of the five tabs) → redirect to B1 workspace |
| app | `/app/projects/:id/export` | ProjectExport | Remove (one of the five tabs) → redirect to B1 workspace |
| app | `/app/projects/:id/workbench` | WorkbenchLayout [gated: WORKBENCH_PREVIEW_ENABLED && WorkbenchLayout && WorkbenchReview] | Preview only: workbench skeleton (off by default; refused against production); not a production route |
| app | `/app/projects/:id/workbench/boq` | ProjectBoq [gated: WORKBENCH_PREVIEW_ENABLED && WorkbenchLayout && WorkbenchReview] | Preview only: workbench skeleton (off by default; refused against production); not a production route |
| app | `/app/projects/:id/workbench/drawings` | ProjectDrawings [gated: WORKBENCH_PREVIEW_ENABLED && WorkbenchLayout && WorkbenchReview] | Preview only: workbench skeleton (off by default; refused against production); not a production route |
| app | `/app/projects/:id/workbench/review` | WorkbenchReview [gated: WORKBENCH_PREVIEW_ENABLED && WorkbenchLayout && WorkbenchReview] | Preview only: workbench skeleton (off by default; refused against production); not a production route |
| app | `/app/projects/:id/workbench/check` | ProjectExport [gated: WORKBENCH_PREVIEW_ENABLED && WorkbenchLayout && WorkbenchReview] | Preview only: workbench skeleton (off by default; refused against production); not a production route |
| app | `/app/projects/:id/workbench/export` | ProjectExport [gated: WORKBENCH_PREVIEW_ENABLED && WorkbenchLayout && WorkbenchReview] | Preview only: workbench skeleton (off by default; refused against production); not a production route |
| app | `/app/projects/:id/*` | inline <p> | Redirect into the B1 workspace |
| app | `/*` | CrossDomainRedirect | Keep |

## Rules for executing B12 later

1. Every removed page gets a redirect to its replacement, so no bookmarked or shared URL is orphaned.
2. Update this table in the same change. The test enforces that.
3. Never execute B12 before its dependencies are commercially accepted.
