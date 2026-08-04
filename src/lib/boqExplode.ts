// AOR material explosion. Each BOQ line carries a DSR code and a quantity in the
// item's unit (e.g. 12 cum of RCC). The AOR (dsr_coefficient) says how much of
// each resource one unit of that item consumes (e.g. 6.3 bags cement per cum).
// Multiply and aggregate across every line and you get the project's authentic
// material + labour schedule — the procurement list — instead of coverage-rate
// guesses.
//
// Pure and unit-tested: the builder fetches the coefficient rows and feeds them
// in; no database here.

export type ResourceKind = "material" | "labour" | "plant";

export interface Coefficient {
  item_code: string;      // ties to boq_line.dsr_code
  kind: string;           // material | labour | plant
  resource: string;       // 'Cement', 'TMT steel', 'Beldar'
  qty: number;            // consumption per 1 unit of the DSR item
  unit: string | null;
  product_id: string | null;
}

export interface ExplodableLine {
  dsr_code: string | null;
  qty: number;
  included: boolean;
}

export interface ScheduleRow {
  resource: string;
  kind: string;
  unit: string | null;
  qty: number;            // aggregated consumption across all lines
  product_id: string | null;
}

export interface ExplodeResult {
  rows: ScheduleRow[];        // aggregated, sorted (materials, then labour, then plant)
  matchedCodes: number;       // distinct DSR codes that had at least one coefficient
  unmatchedCodes: string[];   // included lines whose DSR code has no AOR data
}

const KIND_ORDER: Record<string, number> = { material: 0, labour: 1, plant: 2 };
const norm = (s: string) => s.trim().toLowerCase();

/**
 * Explode included BOQ lines through their AOR coefficients and aggregate by
 * (resource, unit, kind). Resources are merged case-insensitively but keep their
 * first-seen display spelling.
 */
export function explodeMaterials(
  lines: ExplodableLine[],
  coeffsByCode: Map<string, Coefficient[]>,
): ExplodeResult {
  const agg = new Map<string, ScheduleRow>();
  const matched = new Set<string>();
  const unmatched = new Set<string>();

  for (const line of lines) {
    if (!line.included || !line.dsr_code || line.qty <= 0) continue;
    const coeffs = coeffsByCode.get(line.dsr_code);
    if (!coeffs || coeffs.length === 0) { unmatched.add(line.dsr_code); continue; }
    matched.add(line.dsr_code);
    for (const c of coeffs) {
      const key = `${c.kind}|${norm(c.resource)}|${norm(c.unit ?? "")}`;
      const add = c.qty * line.qty;
      const row = agg.get(key);
      if (row) {
        row.qty += add;
        if (!row.product_id && c.product_id) row.product_id = c.product_id;
      } else {
        agg.set(key, { resource: c.resource, kind: c.kind, unit: c.unit, qty: add, product_id: c.product_id });
      }
    }
  }

  const rows = [...agg.values()].sort((a, b) => {
    const k = (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9);
    if (k !== 0) return k;
    return b.qty - a.qty;
  });
  // round after aggregation to avoid compounding float noise
  rows.forEach((r) => { r.qty = Math.round(r.qty * 100) / 100; });

  return { rows, matchedCodes: matched.size, unmatchedCodes: [...unmatched] };
}
