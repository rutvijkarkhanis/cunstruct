// The BOQ line read shared by the journey's BOQ and Export steps (one query
// key, one shape). Same stale-schema fallback as the BOQ builder: on a
// deployment missing the provenance columns, lines still load, never dropped.
import { db } from "@/lib/untypedDb";
import type { BoqTableLine } from "./boqTable";

export type AppBoqLine = BoqTableLine & { scope_id?: string | null; external_key?: string | null };

const LINE_COLS = "id, section, dsr_code, description, unit, qty, dsr_rate, custom_rate, basis, quantity_status, measurement_method, included, sort, source_document_id, source_page, scope_id, external_key";
const LINE_COLS_BASE = "id, section, dsr_code, description, unit, qty, dsr_rate, custom_rate, included, sort";
const missingCol = (msg?: string) => !!msg && /\b(basis|quantity_status|measurement_method|source_document_id|source_page|scope_id|external_key)\b|schema cache|could not find|does not exist/i.test(msg);

export const appBoqLinesKey = (boqId: string | null) => ["app-boq-lines", boqId] as const;

export async function loadAppBoqLines(boqId: string): Promise<AppBoqLine[]> {
  let r = await db.from("boq_line").select(LINE_COLS).eq("boq_id", boqId).order("sort");
  if (r.error && missingCol(r.error.message)) r = await db.from("boq_line").select(LINE_COLS_BASE).eq("boq_id", boqId).order("sort");
  if (r.error) throw r.error;
  return (r.data ?? []) as AppBoqLine[];
}
