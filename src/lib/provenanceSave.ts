// A BOQ line write that carries provenance (basis, quantity status, identity,
// drawing reference, location) must either save all of it or nothing. Earlier
// code retried a failed write with those columns stripped, which saved a line
// that silently claimed less than the reviewer chose — no basis, no pending
// marker, no drawing reference. That retry is gone: a database missing these
// columns now gets a clear, actionable error instead.

/** A missing column, and nothing else: PostgREST PGRST204 ("Could not find
 *  the 'x' column of 'boq_line' in the schema cache") or Postgres 42703
 *  ('column "x" of relation "boq_line" does not exist'). Never matched on a
 *  bare column name (a constraint such as boq_line_source_document_id_fkey
 *  contains one), nor on any other "does not exist" (a missing function or
 *  table is a different failure and is reported as itself). */
const isMissingColumn = (e: { code?: string; message?: string }) =>
  e.code === "PGRST204" || e.code === "42703" ||
  /\bcolumn\b[^]*?(does not exist|in the schema cache)/i.test(e.message ?? "");

export class ProvenanceColumnsMissingError extends Error {
  readonly cause: unknown;
  constructor(original: { message?: string } | null | undefined) {
    super(
      "Nothing was saved: this database is missing BOQ line columns needed to keep each quantity's basis, status and drawing reference. " +
      "Apply the pending database migrations, then try again." +
      (original?.message ? ` (Database said: ${original.message})` : ""),
    );
    this.name = "ProvenanceColumnsMissingError";
    this.cause = original;
  }
}

/** Throw the actionable error for a missing-column failure, else the original. */
export function throwLineSaveError(error: { code?: string; message?: string } | null | undefined): never {
  if (error && isMissingColumn(error)) throw new ProvenanceColumnsMissingError(error);
  throw error;
}
