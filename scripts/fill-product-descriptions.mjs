/**
 * One-time script to auto-generate SEO descriptions for products that have
 * none in the database. Generates from name + brand + category + subcategory.
 *
 * Run:  node scripts/fill-product-descriptions.mjs
 * Safe: only updates rows where description IS NULL or empty.
 * Dry-run: set DRY_RUN=1 to preview without writing.
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const SUPABASE_URL = "https://dkgjsobfljqoggalivzt.supabase.co";
const SUPABASE_KEY = "sb_publishable_hjMIhO09DS62uJCvhgJoOQ_SY_CZepJ";
const DRY_RUN = process.env.DRY_RUN === "1";

function generateDescription(p) {
  const name = p.group_name?.trim() || p.name || "";
  const parts = [];
  if (p.brand) parts.push(p.brand);
  parts.push(name);

  const categoryLabel = p.subcategory || p.main_category;
  let desc = parts.join(" ");
  if (categoryLabel) desc += ` — ${categoryLabel}`;
  desc += ". Construction-grade quality, delivered in 30 minutes by Cunstruct.";
  return desc;
}

async function fetchEmpty() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/products_master?select=id,name,group_name,brand,main_category,subcategory,description&status=eq.published&description=is.null`,
    {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    },
  );
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

async function updateDescription(id, description) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/products_master?id=eq.${id}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ description }),
    },
  );
  if (!res.ok) throw new Error(`Update failed for ${id}: ${res.status}`);
}

async function main() {
  const products = await fetchEmpty();
  console.log(`Found ${products.length} products with no description`);

  if (DRY_RUN) {
    console.log("\n[DRY RUN] Would generate:\n");
    for (const p of products.slice(0, 10)) {
      console.log(`  ${p.id.slice(0, 8)}… ${p.name}`);
      console.log(`    → ${generateDescription(p)}\n`);
    }
    if (products.length > 10) console.log(`  … and ${products.length - 10} more`);
    return;
  }

  let updated = 0;
  for (const p of products) {
    const desc = generateDescription(p);
    await updateDescription(p.id, desc);
    updated++;
    if (updated % 10 === 0) process.stdout.write(`  ${updated}/${products.length}\r`);
  }
  console.log(`\nUpdated ${updated} product descriptions`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
