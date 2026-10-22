// A new BOQ line as the workbench adds it (written by lib/lineEdit
// addLineRecorded, which records its creation). A quantity is never invented:
// left empty, the line is added as pending (qty 0, basis and status PENDING —
// the rule applyFinding's addFindingAsLine already uses); entered, it is a
// manual quantity. A rate comes only from a picked DSR 2023 item (its
// reference rate); an own rate is set afterwards through the audited rate edit.
import { MANUAL_BASIS, PENDING_BASIS } from "@/lib/quantity";

export interface NewLineInput {
  boqId: string; description: string; unit: string; qty: string; section: string;
  dsr?: { code: string; rate: number | null; chapter: string | null } | null;
  sort: number;
}
export type NewLineResult = { ok: true; row: Record<string, unknown> } | { ok: false; error: string };

export function buildNewLine(i: NewLineInput): NewLineResult {
  const description = i.description.trim();
  const unit = i.unit.trim();
  if (!description) return { ok: false, error: "Enter a description." };
  if (!unit) return { ok: false, error: "Enter a unit." };
  const qtyText = i.qty.trim().replace(/,/g, "");
  let qtyFields: Record<string, unknown>;
  if (qtyText === "") qtyFields = { qty: 0, basis: PENDING_BASIS, quantity_status: "PENDING" };
  else {
    const n = Number(qtyText);
    if (!Number.isFinite(n)) return { ok: false, error: "Enter a quantity, or leave it empty to add the line as pending." };
    if (n < 0) return { ok: false, error: "Quantity cannot be negative." };
    qtyFields = { qty: n, basis: MANUAL_BASIS };
  }
  return {
    ok: true,
    row: {
      boq_id: i.boqId, section: i.section.trim() || i.dsr?.chapter || "Other", description, unit,
      dsr_code: i.dsr?.code ?? null, dsr_rate: i.dsr?.rate ?? null, custom_rate: null,
      ...qtyFields, included: true, source: "manual", sort: i.sort,
      // Typed in, not taken from a drawing: no drawing source is guessed.
      source_document_id: null, source_page: null,
    },
  };
}
