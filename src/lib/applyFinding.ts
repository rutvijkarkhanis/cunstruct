// Apply an audit finding to the BOQ — ONLY when the user explicitly chooses to.
//
// Importing an audit never changes the BOQ. These functions are the explicit,
// user-driven mutations the BoqAuditReview UI calls when the user clicks Add /
// Set qty / Apply method / Mark pending on a specific finding. Each is a small,
// reversible boq_line write; none runs automatically on import.

import { supabase } from "@/integrations/supabase/client";
import { PENDING_BASIS } from "./boqEvalJson";

// The optional columns some deployments haven't migrated yet. On a schema error
// we retry without them, mirroring the existing insert/update fallbacks.
const OPTIONAL_COL_RE = /\bbasis\b|external_key|measurement_method|quantity_status|schema cache|could not find|does not exist/i;

interface NewLine {
  boq_id: string; section: string; description: string; unit: string | null;
  qty: number; basis: string | null; basis_note: string | null;
  external_key: string | null; measurement_method: string | null; quantity_status: string | null;
  included: boolean; source: string; sort: number;
}

async function insertLineResilient(row: NewLine): Promise<string> {
  let res = await supabase.from("boq_line").insert(row).select("id").single();
  if (res.error && OPTIONAL_COL_RE.test(res.error.message)) {
    const { basis, basis_note, external_key, measurement_method, quantity_status, ...base } = row;
    res = await supabase.from("boq_line").insert(base).select("id").single();
  }
  if (res.error) throw res.error;
  return (res.data as { id: string }).id;
}

async function updateLineResilient(lineId: string, patch: Record<string, unknown>): Promise<void> {
  let { error } = await supabase.from("boq_line").update(patch).eq("id", lineId);
  if (error && OPTIONAL_COL_RE.test(error.message)) {
    const { measurement_method, quantity_status, external_key, basis, basis_note, ...base } = patch;
    ({ error } = await supabase.from("boq_line").update(base).eq("id", lineId));
  }
  if (error) throw error;
}

export interface AddLineArgs {
  boqId: string;
  section?: string | null;
  description: string;
  unit?: string | null;
  method?: string | null;
  externalKey?: string | null;
  sort?: number;
}

/**
 * Add a finding's item to the BOQ as a NEW quantity-PENDING line (qty 0, basis
 * PENDING) — a count is never fabricated. Returns the new line id.
 */
export async function addFindingAsLine(args: AddLineArgs): Promise<string> {
  return insertLineResilient({
    boq_id: args.boqId,
    section: args.section?.trim() || "Audit — added",
    description: args.description,
    unit: args.unit ?? null,
    qty: 0,
    basis: PENDING_BASIS,
    basis_note: "Added from audit finding",
    external_key: args.externalKey ?? null,
    measurement_method: args.method ?? null,
    quantity_status: "PENDING",
    included: true,
    source: "manual",
    sort: args.sort ?? 9999,
  });
}

/** Apply a recommended methodology and/or unit to an existing line. */
export async function applyMethodUnit(lineId: string, method?: string | null, unit?: string | null): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (method) patch.measurement_method = method;
  if (unit) patch.unit = unit;
  if (Object.keys(patch).length === 0) return;
  await updateLineResilient(lineId, patch);
}

/**
 * Set a user-supplied quantity on a line, clearing the PENDING marker. The status
 * becomes COUNTED for a count methodology, else MEASURED — a human established it.
 */
export async function setLineQty(lineId: string, qty: number, method?: string | null): Promise<void> {
  const status = (method ?? "").toUpperCase() === "COUNT" ? "COUNTED" : "MEASURED";
  await updateLineResilient(lineId, { qty, basis: null, quantity_status: status });
}

/** Mark an existing line quantity-pending (qty 0, basis PENDING) — never fabricated. */
export async function markLinePending(lineId: string): Promise<void> {
  await updateLineResilient(lineId, { qty: 0, basis: PENDING_BASIS, quantity_status: "PENDING" });
}
