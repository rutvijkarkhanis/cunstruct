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
const OPTIONAL_COL_RE = /\bbasis\b|external_key|measurement_method|quantity_status|scope_id|schema cache|could not find|does not exist/i;

// Matches ONLY the two partial unique indexes 20260929000000_boq_line_identity_
// constraint.sql adds for (boq_id, external_key, scope_id) — never any other
// unique-violation boq_line might one day have. A Postgres/PostgREST 23505
// whose message doesn't name one of these two indexes is a genuinely
// unexpected error and must still throw, not be silently swallowed.
const BOQ_LINE_IDENTITY_CONFLICT_RE = /boq_line_identity_(scoped|unscoped)_idx/i;

/** True only for the specific unique-violation the boq_line identity indexes
 *  raise — never any other 23505 a future, unrelated constraint might add. */
function isBoqLineIdentityConflict(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === "23505" && BOQ_LINE_IDENTITY_CONFLICT_RE.test(error.message ?? "");
}

interface NewLine {
  boq_id: string; section: string; description: string; unit: string | null;
  qty: number; basis: string | null; basis_note: string | null;
  external_key: string | null; measurement_method: string | null; quantity_status: string | null;
  scope_id: string | null;
  included: boolean; source: string; sort: number;
}

async function insertLineResilient(row: NewLine): Promise<string> {
  let res = await supabase.from("boq_line").insert(row).select("id").single();
  if (res.error && OPTIONAL_COL_RE.test(res.error.message)) {
    const { basis, basis_note, external_key, measurement_method, quantity_status, scope_id, ...base } = row;
    res = await supabase.from("boq_line").insert(base).select("id").single();
  }
  if (res.error) throw res.error;
  return (res.data as { id: string }).id;
}

/** The row's qty/unit the caller expects to still be persisted — a
 *  compare-and-swap guard. A key is present only when that column is meant
 *  to be checked; `unit: null` checks for a genuinely null column. */
interface UpdateExpected {
  qty?: number;
  unit?: string | null;
}

/** Chain the compare-and-swap `.eq()`/`.is()` filters for whichever of
 *  qty/unit `expected` asks to guard onto an in-flight update query. `null`
 *  needs `.is()`, not `.eq()` — Postgres/PostgREST equality never matches
 *  NULL. Untyped on purpose: supabase-js's builder type is reassigned through
 *  several distinct generic instantiations as filters chain on, which a
 *  shared helper can't express any more cleanly than `any` — the real
 *  contract (both branches end in `.select("id")`) is exercised by the
 *  regression tests, not by this helper's signature. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withExpectedFilters(query: any, expected: UpdateExpected): any {
  let q = query;
  if (expected.qty !== undefined) q = q.eq("qty", expected.qty);
  if ("unit" in expected) q = expected.unit == null ? q.is("unit", null) : q.eq("unit", expected.unit);
  return q;
}

/**
 * Update boq_line by id. When `expected` is omitted, behaves exactly as
 * before (unconditional update, always resolves true) — the audit-import
 * callers below (applyMethodUnit/setLineQty/markLinePending) never pass it.
 * When `expected` carries a qty and/or unit to guard, the write is
 * conditional on the row's CURRENT value(s) still matching — a
 * compare-and-swap against a stale pre-apply snapshot (see applyReview.ts's
 * applyReviewPlan). Returns false, with NO write and NO error, when the
 * guard fails (zero rows matched): the caller must treat that as a conflict,
 * never assume success.
 */
async function updateLineResilient(
  lineId: string,
  patch: Record<string, unknown>,
  expected?: UpdateExpected,
): Promise<boolean> {
  const guarded = expected != null && (expected.qty !== undefined || "unit" in expected);

  if (!guarded) {
    let { error } = await supabase.from("boq_line").update(patch).eq("id", lineId);
    if (error && OPTIONAL_COL_RE.test(error.message)) {
      const { measurement_method, quantity_status, external_key, basis, basis_note, scope_id, ...base } = patch;
      ({ error } = await supabase.from("boq_line").update(base).eq("id", lineId));
    }
    if (error) throw error;
    return true;
  }

  let { data, error } = await withExpectedFilters(supabase.from("boq_line").update(patch).eq("id", lineId), expected).select("id");
  if (error && OPTIONAL_COL_RE.test(error.message)) {
    const { measurement_method, quantity_status, external_key, basis, basis_note, scope_id, ...base } = patch;
    ({ data, error } = await withExpectedFilters(supabase.from("boq_line").update(base).eq("id", lineId), expected).select("id"));
  }
  if (error) throw error;
  return (data ?? []).length > 0;
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
    scope_id: null,
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

// ── Drawing-analysis review → BOQ (BOQ Review Workstation "Apply to BOQ") ─────
// Same insertion/update mechanics as the audit-finding functions above, reused
// as-is rather than duplicated. The only difference is provenance labeling
// (section/basis_note), since a review item carries no "section" of its own.

export interface AddReviewLineArgs {
  boqId: string;
  description: string;
  unit?: string | null;
  /** 0 when pending; the caller decides via `pending`, never guessed here. */
  qty: number;
  pending: boolean;
  externalKey: string;
  sort?: number;
  /** The project_scope id already resolved for this item's location, if any
   *  (see applyReview.ts's resolveScopeIdForLocation) — never resolved here,
   *  only persisted. A line created with no scope behaves exactly as before. */
  scopeId?: string | null;
}

/**
 * Insert a new BOQ line for a drawing-analysis review item whose external_key
 * matched no existing line. Only called when the item carries the one field the
 * existing insertion pattern actually requires (a non-empty description) — see
 * applyReview.ts's classifyReviewItem, which never calls this otherwise.
 *
 * Returns null — never throws — when the database's boq_line identity
 * indexes (20260929000000_boq_line_identity_constraint.sql) reject this
 * insert as a duplicate of an existing (boq_id, external_key, scope) row.
 * That happens when a SEPARATE apply call (or, defensively, some other path)
 * already created this exact line since this candidate was classified — the
 * caller (applyReview.ts's applyReviewPlan) must treat that as a conflict,
 * never a fabricated success. Any other error still throws.
 */
export async function addReviewItemAsLine(args: AddReviewLineArgs): Promise<string | null> {
  try {
    return await insertLineResilient({
      boq_id: args.boqId,
      section: "Drawing review — added",
      description: args.description,
      unit: args.unit ?? null,
      qty: args.qty,
      basis: args.pending ? PENDING_BASIS : null,
      basis_note: "Added from drawing analysis review",
      external_key: args.externalKey,
      measurement_method: null,
      quantity_status: args.pending ? "PENDING" : "MEASURED",
      scope_id: args.scopeId ?? null,
      included: true,
      source: "manual",
      sort: args.sort ?? 9999,
    });
  } catch (err) {
    if (isBoqLineIdentityConflict(err as { code?: string; message?: string } | null | undefined)) return null;
    throw err;
  }
}

/**
 * Apply a reviewed qty and/or unit to an existing, matched BOQ line. Only the
 * fields present in `patch` are written — never touches description, section,
 * rates, or any other unrelated column.
 *
 * `expected`, when given, makes the write a compare-and-swap: it only takes
 * effect if the row's CURRENT qty/unit still match (see updateLineResilient).
 * Returns false when the guard fails — no write happened, and the caller
 * (applyReview.ts's applyReviewPlan) must treat that as a conflict, never a
 * fabricated success.
 */
export async function applyReviewQtyUnit(
  lineId: string,
  patch: { qty?: number; unit?: string | null; basis?: string | null; quantity_status?: string | null },
  expected?: { qty?: number; unit?: string | null },
): Promise<boolean> {
  return updateLineResilient(lineId, patch, expected);
}
