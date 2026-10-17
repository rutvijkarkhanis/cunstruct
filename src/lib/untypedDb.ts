// Minimal query surface for tables that are not in the generated Supabase
// types yet (boq, boq_line, dsr_item, and the rate-evidence tables). Keeps the
// rest of the code typed without `any`; regenerate types to retire it.
import { supabase } from "@/integrations/supabase/client";

export type DbError = { message: string; code?: string };
export type DbResult = { data: unknown; error: DbError | null };
export interface Query extends PromiseLike<DbResult> {
  select(cols?: string): Query;
  eq(col: string, value: unknown): Query;
  in(col: string, values: readonly unknown[]): Query;
  neq(col: string, value: unknown): Query;
  is(col: string, value: null): Query;
  or(filter: string): Query;
  ilike(col: string, pattern: string): Query;
  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): Query;
  limit(n: number): Query;
  range(from: number, to: number): Query;
  insert(values: object): Query;
  upsert(values: object, opts?: { onConflict?: string }): Query;
  update(values: object): Query;
  delete(): Query;
  maybeSingle(): PromiseLike<DbResult>;
}

export const db = supabase as unknown as { from: (table: string) => Query };

/** PostgREST/Postgres "table does not exist" for `table` — not a generic failure. */
export const isMissingTable = (table: string, e: DbError | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" ||
    (e.message.toLowerCase().includes(table) && /does not exist|schema cache|could not find/i.test(e.message)));

/** Call a Postgres function that isn't in the generated types. */
export const rpc = (fn: string, args: Record<string, unknown>): PromiseLike<DbResult> =>
  (supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<DbResult> }).rpc(fn, args);
