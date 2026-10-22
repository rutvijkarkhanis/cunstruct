// Phase 2 fixture set (UX/UI revamp) — the fixed fixture records the Phase 0
// baseline and the Phase 2 slice run against. MOCK DATA ONLY: one project,
// one BOQ, eight BOQ lines and the existing e2e drawings and review items. It
// contains no production data. Line descriptions, codes, units and rates are
// copied from the committed DSR 2023 snapshot
// (docs/benchmarks/e3/snapshots/dsr_item-after-20261021.json), not invented.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRestFixtures, PROJECT_ID, BOQ_ID, DOC_A_ID, DOC_B_ID, ITEM_DOOR_ID } from "./testData";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = path.join(__dirname, "..", "..", "docs", "benchmarks", "e3", "snapshots", "dsr_item-after-20261021.json");

type DsrItem = { code: string; description: string; unit: string; rate: number | string };

/** The DSR codes used, in line order. Chosen to span short and long descriptions (133–1,071 characters). */
export const PHASE2_DSR_CODES = ["4.3.1", "18.70.13", "26.18.1", "4.2.5B", "5.33.1.1", "9.87.3", "18.88A.9", "4.20.1.4"] as const;

function dsrItems(): Map<string, DsrItem> {
  const rows = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as DsrItem[];
  const wanted = new Set<string>(PHASE2_DSR_CODES);
  const out = new Map<string, DsrItem>();
  for (const r of rows) if (wanted.has(r.code) && !out.has(r.code)) out.set(r.code, r);
  for (const c of PHASE2_DSR_CODES) if (!out.has(c)) throw new Error(`DSR code ${c} not found in the committed snapshot`);
  return out;
}

export const LINE_ID = (n: number) => `p2-line-${n}`;
/** The line the scripted task edits: line 7 (DSR 18.88A.9, "each"), linked to review item D1 on Document A. */
export const TARGET_LINE = 7;

/** Line states covered: verified, corrected, assumption, pending, drawing input, excluded, manual rate with no DSR code, DSR-derived. */
const STATES = [
  { basis: "REVIEW_VERIFIED", quantity_status: "MEASURED", qty: 42.5, custom_rate: null, included: true },
  { basis: "REVIEW_CORRECTED", quantity_status: "COUNTED", qty: 12, custom_rate: null, included: true },
  { basis: "HEURISTIC", quantity_status: null, qty: 18, custom_rate: null, included: true },
  { basis: "PENDING", quantity_status: "PENDING", qty: 0, custom_rate: null, included: true, noRate: true },
  { basis: "DRAWING_INPUT", quantity_status: "MEASURED", qty: 6.75, custom_rate: null, included: true },
  { basis: null, quantity_status: null, qty: 30, custom_rate: null, included: false },
  { basis: "REVIEW_VERIFIED", quantity_status: "COUNTED", qty: 1, custom_rate: null, included: true, evidence: true },
  { basis: "MANUAL", quantity_status: "MEASURED", qty: 4, custom_rate: 1500, included: true, noDsr: true },
] as const;

export function buildPhase2Fixtures() {
  const base = buildRestFixtures();
  const dsr = dsrItems();
  const boq_line = PHASE2_DSR_CODES.map((code, i) => {
    const d = dsr.get(code)!;
    const st = STATES[i] as (typeof STATES)[number] & { noRate?: boolean; noDsr?: boolean; evidence?: boolean };
    return {
      id: LINE_ID(i + 1), boq_id: BOQ_ID, section: i < 4 ? "Earthwork & concrete" : "Finishes & fittings",
      dsr_code: st.noDsr ? null : d.code, description: d.description, unit: d.unit,
      qty: st.qty as number, dsr_rate: st.noDsr || st.noRate ? null : Number(d.rate), custom_rate: st.custom_rate as number | null, cost: null,
      basis: st.basis as string | null, basis_note: null, quantity_status: st.quantity_status as string | null, measurement_method: null,
      included: st.included as boolean, source: null, sort: i,
      // The evidence-linked line cites Document A page 1 (text column, as in the schema) and carries review item D1's key.
      source_document_id: st.evidence ? DOC_A_ID : null, source_page: st.evidence ? "1" : null,
      scope_id: null, external_key: st.evidence ? "D1" : `P2-${i + 1}`,
      created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
    };
  });
  return {
    ...base,
    // Arrays: the journey's list queries expect arrays. The spec serves the
    // single-object form only when the request asks for one (Accept header).
    projects: [{ ...base.projects, name: "Phase 2 fixture project (mock)", client_name: "Fixture client", location: "Fixture city", project_type: "Residential", area_sqft: 2400, floors: 2, owner_id: "e2e-user-1", created_at: "2026-10-01T00:00:00Z", current_stage_id: null }],
    boq: [{ ...base.boq, name: "Phase 2 fixture BOQ", status: "draft", spec: null, discipline: "civil", contractor_id: null, created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-05T00:00:00Z", sort: 0, parent_id: null }],
    boq_line,
    // Review item D1 is VERIFIED so the target line's evidence resolves; C1 stays pending.
    analysis_review_item: base.analysis_review_item.map((it) =>
      it.id === ITEM_DOOR_ID ? { ...it, review_status: "VERIFIED", reviewed_at: "2026-10-04T00:00:00Z" } : it),
    project_document: base.project_document.map((d) => ({ ...d, folder_id: null, created_at: "2026-10-01T00:00:00Z", discipline: d.id === DOC_B_ID ? "structural" : "architectural" })),
  };
}

/** A dsr_item row (billable) for the DSR picker, copied from the committed snapshot. */
export function dsrCatalogueRow(code: string) {
  const d = (JSON.parse(readFileSync(SNAPSHOT, "utf8")) as (DsrItem & { chapter?: string | null; subhead?: string | null })[]).find((r) => r.code === code);
  if (!d) throw new Error(`DSR code ${code} not found in the committed snapshot`);
  return { id: `dsr-${code}`, code: d.code, description: d.description, unit: d.unit, rate: Number(d.rate), chapter: d.chapter ?? null, subhead: d.subhead ?? null, billable: true };
}

/** The second BOQ of the multi-BOQ set. */
export const BOQ2_ID = "e2e-boq-2";
export const BOQ2_LINE_ID = (n: number) => `p2-b2-line-${n}`;

/**
 * The Phase 2 set plus a second BOQ in the same project, for multi-BOQ
 * workbench tests. MOCK DATA ONLY. Its three lines are the first three items
 * of the committed DSR 2023 snapshot whose codes the first BOQ does not use
 * (description, unit and rate copied, not invented), so each BOQ's lines and
 * export rows are told apart by code. It has no analysis run or review items:
 * the first BOQ stays the project's most recently analysed BOQ (the default
 * selection). buildPhase2Fixtures() is unchanged, so the Phase 0 baseline's
 * fixture is unchanged.
 */
export function buildMultiBoqFixtures() {
  const one = buildPhase2Fixtures();
  const used = new Set<string>(PHASE2_DSR_CODES);
  const rows = (JSON.parse(readFileSync(SNAPSHOT, "utf8")) as DsrItem[])
    .filter((r) => r.code && !used.has(r.code) && r.description && r.unit && Number(r.rate) > 0);
  const picked: DsrItem[] = [];
  for (const r of rows) { if (!picked.some((p) => p.code === r.code)) picked.push(r); if (picked.length === 3) break; }
  if (picked.length < 3) throw new Error("The committed DSR snapshot has fewer than three further items");
  const lines = picked.map((d, i) => ({
    ...one.boq_line[0], id: BOQ2_LINE_ID(i + 1), boq_id: BOQ2_ID, section: "Second BOQ section", sort: i,
    dsr_code: d.code, description: d.description, unit: d.unit, qty: [5, 8, 13][i], dsr_rate: Number(d.rate), custom_rate: null,
    basis: "MANUAL", quantity_status: "MEASURED", included: true, source_document_id: null, source_page: null, external_key: `P2B2-${i + 1}`,
  }));
  return {
    ...one,
    boq: [...one.boq, { ...one.boq[0], id: BOQ2_ID, name: "Second fixture BOQ", created_at: "2026-10-06T00:00:00Z", updated_at: "2026-10-06T00:00:00Z", sort: 1 }],
    boq_line: [...one.boq_line, ...lines],
  };
}

export { PROJECT_ID, BOQ_ID, DOC_A_ID };
