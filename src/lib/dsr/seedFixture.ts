// TEST FIXTURE — reads the real DSR 2023 civil schedule from the seed
// migration so matching is tested against the catalogue the app ships with.
// Test-only (uses node:fs); not imported by application code.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DsrItem } from "./catalogue";

const SEED = resolve(__dirname, "../../../supabase/migrations/20260731001000_dsr_seed_civil.sql");
const ROW = /^\('((?:[^']|'')*)','((?:[^']|'')*)','((?:[^']|'')*)','((?:[^']|'')*)','((?:[^']|'')*)','((?:[^']|'')*)','((?:[^']|'')*)',(null|-?[\d.]+),(true|false)\)[,;]?$/;
const un = (s: string) => s.replace(/''/g, "'");

let cache: DsrItem[] | null = null;
export function seedCatalogue(): DsrItem[] {
  if (cache) return cache;
  const out: DsrItem[] = [];
  for (const line of readFileSync(SEED, "utf8").split("\n")) {
    const m = ROW.exec(line.trim());
    if (!m) continue;
    out.push({
      source: un(m[1]), rate_year: un(m[2]), code: un(m[3]), chapter: un(m[4]), subhead: un(m[5]),
      description: un(m[6]), unit: un(m[7]), rate: m[8] === "null" ? null : Number(m[8]),
    });
  }
  return (cache = out);
}
