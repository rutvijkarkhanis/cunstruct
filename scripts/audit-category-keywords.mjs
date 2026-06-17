/**
 * Cross-checks the live Supabase product catalog (main_category / subcategory
 * names) against a curated list of real search-volume keywords (sourced from
 * Google Keyword Planner) to flag where catalog naming doesn't match what
 * shoppers actually type.
 *
 * Run: node scripts/audit-category-keywords.mjs
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = "https://dkgjsobfljqoggalivzt.supabase.co";
const SUPABASE_KEY = "sb_publishable_hjMIhO09DS62uJCvhgJoOQ_SY_CZepJ";

// Curated from Keyword Planner export (deduplicated, grouped by theme).
// Volume = avg. monthly searches, Comp = competition index (0-100).
const KEYWORD_CLUSTERS = {
  "near me / local": [
    { kw: "hardware store near me", vol: 5000, comp: 8 },
    { kw: "hardware shop near me", vol: 5000, comp: 9 },
    { kw: "building material suppliers near me", vol: 500, comp: 19 },
    { kw: "construction material suppliers near me", vol: 500, comp: 19 },
    { kw: "sanitary shop near me", vol: 500, comp: 25 },
    { kw: "sanitary store near me", vol: 500, comp: 27 },
    { kw: "tool shop near me", vol: 500, comp: 10 },
    { kw: "plumbing supply near me", vol: 50, comp: 5 },
    { kw: "electrical material shop near me", vol: 50, comp: 12 },
    { kw: "construction materials near me", vol: 50, comp: 21 },
    { kw: "building materials near me", vol: 50, comp: 21 },
  ],
  "buy online (commercial intent)": [
    { kw: "building materials online", vol: 50, comp: 69 },
    { kw: "buy building supplies", vol: 50, comp: 71 },
    { kw: "online hardware", vol: 50, comp: 75 },
    { kw: "hardware shop online", vol: 50, comp: 81 },
    { kw: "buy building materials online", vol: 50, comp: 17 },
    { kw: "buy construction material online", vol: 50, comp: 17 },
    { kw: "hardware online shopping", vol: 50, comp: 100 },
    { kw: "buy plumbing materials", vol: 50, comp: 100 },
  ],
  "product-specific": [
    { kw: "drill bit set", vol: 50, comp: 93 },
    { kw: "masonry drill bit", vol: 50, comp: 57 },
    { kw: "masonry bit", vol: 50, comp: 100 },
    { kw: "concrete drill bit", vol: 50, comp: 86 },
    { kw: "cement drill bit", vol: 50, comp: 86 },
    { kw: "hammer drill bit", vol: 50, comp: 81 },
    { kw: "pipe cutter", vol: 50, comp: 73 },
    { kw: "tube cutters", vol: 50, comp: 100 },
    { kw: "pipe fittings near me", vol: 50, comp: 57 },
    { kw: "sanitary fittings shop near me", vol: 50, comp: 46 },
    { kw: "plumbing adjustable spanner", vol: 50, comp: 100 },
  ],
  "supplier / wholesale (B2B)": [
    { kw: "building material supplier", vol: 500, comp: 5 },
    { kw: "construction material distributors", vol: 500, comp: 5 },
    { kw: "building material wholesalers", vol: 50, comp: 2 },
    { kw: "construction material supplier", vol: 50, comp: 9 },
  ],
};

function normalize(s) {
  return (s ?? "").toLowerCase().trim();
}

function wordsOverlap(catName, keyword) {
  const catWords = new Set(normalize(catName).split(/\s+/).filter((w) => w.length > 2));
  const kwWords = normalize(keyword).split(/\s+/).filter((w) => w.length > 2);
  return kwWords.some((w) => catWords.has(w));
}

async function fetchCategories() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/products_master?select=main_category,subcategory&status=eq.published`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
  );
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const rows = await res.json();
  const mains = new Set();
  const subs = new Set();
  for (const r of rows) {
    if (r.main_category) mains.add(r.main_category);
    if (r.subcategory) subs.add(r.subcategory);
  }
  return { mains: [...mains], subs: [...subs] };
}

async function main() {
  const { mains, subs } = await fetchCategories();
  const allCatNames = [...mains, ...subs];

  console.log(`Catalog has ${mains.length} main categories, ${subs.length} subcategories\n`);

  for (const [cluster, keywords] of Object.entries(KEYWORD_CLUSTERS)) {
    console.log(`\n=== ${cluster} ===`);
    for (const { kw, vol, comp } of keywords) {
      const matches = allCatNames.filter((c) => wordsOverlap(c, kw));
      const status = matches.length ? `✓ matches: ${matches.join(", ")}` : "✗ NO MATCH in catalog";
      console.log(`  [${vol}/mo, comp ${comp}] "${kw}" — ${status}`);
    }
  }

  console.log(
    "\nNote: 'near me' and 'buy online' clusters are about page copy/meta description, not\n" +
    "catalog naming — a NO MATCH there just means no category literally contains those words,\n" +
    "which is expected. Focus on the 'product-specific' cluster: a NO MATCH there means a\n" +
    "real subcategory naming gap worth fixing (e.g. rename or add a subcategory shoppers search for).",
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
