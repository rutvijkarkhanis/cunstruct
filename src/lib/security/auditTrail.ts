// APPLICATION AUDIT TRAIL — safe metadata for sensitive operations.
//
// Writes one row to `ai_operation_log` describing WHO did WHAT to WHICH
// project/resource, WHEN, with WHICH abstract provider/model and the result.
// It stores NO document content, NO prompts and NO AI responses — only the safe
// metadata the schema allows. Used now for audit-JSON imports and available for
// the future AI analysis/audit operations.
//
// Best-effort: a failure to record the trail must never break the underlying
// operation, so this never throws.

import { supabase } from "@/integrations/supabase/client";
import { safeLog, newCorrelationId, type LogStatus } from "@/lib/security/safeLog";

export interface AuditTrailEntry {
  operation: string;                 // e.g. "audit.import", "analysis.request"
  projectId?: string | null;
  resourceType?: string | null;      // "boq", "document", …
  resourceId?: string | null;
  provider?: string | null;          // ABSTRACT label, chosen later; never a key
  model?: string | null;
  status?: LogStatus;
  correlationId?: string;
}

/**
 * Record a sensitive operation in the audit trail. Returns the correlation id
 * used, so callers can tie related log lines together. Never throws.
 */
export async function recordAuditTrail(entry: AuditTrailEntry): Promise<string> {
  const correlationId = entry.correlationId ?? newCorrelationId();
  try {
    const { data: userData } = await supabase.auth.getUser();
    const row = {
      project_id: entry.projectId ?? null,
      user_id: userData?.user?.id ?? null,
      operation: entry.operation,
      resource_type: entry.resourceType ?? null,
      resource_id: entry.resourceId ?? null,
      provider: entry.provider ?? null,
      model: entry.model ?? null,
      status: entry.status ?? "ok",
      correlation_id: correlationId,
    };
    const { error } = await supabase.from("ai_operation_log").insert(row);
    if (error && !/does not exist|schema cache|could not find/i.test(error.message)) {
      // Only surface non-"table missing" errors to the safe log (still no throw).
      safeLog({ operation: entry.operation, status: "error", projectId: entry.projectId, correlationId, code: "audit_trail_write_failed" });
    }
  } catch {
    // Never let audit-trail writing break the primary operation.
    safeLog({ operation: entry.operation, status: "error", projectId: entry.projectId, correlationId, code: "audit_trail_exception" });
  }
  return correlationId;
}
