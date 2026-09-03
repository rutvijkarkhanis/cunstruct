// PROJECT DATA DELETION — project-scoped, isolation-respecting.
//
// Deletes a project and the data that belongs to it. It relies on the existing
// database foreign keys (project-child tables are `... references projects(id)
// on delete cascade`), so removing the project row deterministically removes its
// scopes, documents, revisions, BOQs, BOQ lines, audit runs/findings, rooms,
// forecasts, orders and the AI operation log for that project — and nothing that
// belongs to another project.
//
// Row-level security still applies: only staff (ops/admin) may delete a project;
// a non-staff owner has read-only access and the delete is denied by RLS. This
// function never bypasses RLS (it uses the browser client, not a service role).

import { supabase } from "@/integrations/supabase/client";
import { safeLog, newCorrelationId } from "@/lib/security/safeLog";

/**
 * What a project delete cascades to (via `on delete cascade`), documented so the
 * lifecycle is explicit. Kept as data so a test can assert it stays in sync.
 */
export const PROJECT_CASCADE_TABLES = [
  "project_scope",
  "project_document",     // → document_revision (cascade)
  "project_rooms",
  "project_stages",
  "stage_updates",
  "boq",                  // → boq_line, boq_document, boq_audit_run (→ boq_audit_finding) (cascade)
  "forecasts",            // → forecast_items (cascade)
  "catalog_gaps",
  "ai_operation_log",
] as const;

/**
 * References that are set to NULL (not deleted) when a project is removed, so the
 * caller knows what intentionally survives:
 *   - order_items / sales_orders retention is governed by their own FKs;
 *   - a project-linked BOQ line's `source_document_id` is nulled if a document
 *     goes, never cross-project.
 * Documented in docs/SECURITY.md §Retention.
 */
export const PROJECT_SET_NULL_NOTE =
  "boq_line.source_document_id / source_revision_id are set null if a document is removed; " +
  "sales order history is retained by design and cleared separately if required.";

export interface DeleteProjectResult {
  projectId: string;
  deleted: boolean;
}

/**
 * Delete one project and all data that cascades from it. Project-scoped and
 * RLS-enforced. Throws on failure; never touches another project.
 */
export async function deleteProjectAndData(projectId: string): Promise<DeleteProjectResult> {
  const correlationId = newCorrelationId();
  if (!projectId) throw new Error("A projectId is required.");

  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) {
    safeLog({ operation: "project.delete", status: "error", projectId, correlationId, code: error.code ?? "delete_failed" });
    throw error;
  }
  safeLog({ operation: "project.delete", status: "ok", projectId, correlationId });
  return { projectId, deleted: true };
}
