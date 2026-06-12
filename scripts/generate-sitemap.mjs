/**
 * Generates public/sitemap.xml by fetching all published products from Supabase.
 * Run via: node scripts/generate-sitemap.mjs
 * Requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Parse .env file
function loadEnv() {
  try {
    const env = readFileSync(resolve(root, ".env"), "utf-8");
    return Object.fromEntries(
      env.split("\n")
        .filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => {
          const idx = l.indexOf("=");
          const key = l.slice(0, idx).trim();
          const raw = l.slice(idx + 1).trim();
          const value = raw.replace(/^["']|["']$/g, "");
          return [key, value];
        }),
    );
  } catch {
    return {};
  }
}

const env = { ...loadEnv(), ...process.env };
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SITE_URL = "https://cunstruct.com";

const STATIC_ROUTES = [
  { path: "/", changefreq: "daily", priority: "1.0" },
  { path: "/products", changefreq: "daily", priority: "0.9" },
  { path: "/kits", changefreq: "weekly", priority: "0.8" },
  { path: "/search", changefreq: "weekly", priority: "0.5" },
];

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildUrl(loc, changefreq, priority) {
  return `  <url>\n    <loc>${xmlEscape(loc)}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

async function fetchProducts() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn("Supabase env vars missing — skipping dynamic product URLs");
    return [];
  }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/products_master?select=id,group_name,name,main_category,subcategory&status=eq.published`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
    },
  );
  if (!res.ok) {
    console.warn(`Supabase fetch failed: ${res.status}`);
    return [];
  }
  return res.json();
}

async function fetchKits() {
  // Kits are defined statically in src/lib/kits.ts — we include the /kits page.
  // Individual kit pages (/kit/:id) are not SEO-critical as they require product data.
  return [];
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  const products = await fetchProducts();

  // Deduplicate: one URL per group (representative product)
  const seenGroups = new Set();
  const productUrls = [];
  for (const p of products) {
    const groupKey = p.group_name?.trim() || p.name;
    if (!seenGroups.has(groupKey)) {
      seenGroups.add(groupKey);
      productUrls.push(buildUrl(`${SITE_URL}/product/${p.id}`, "weekly", "0.8"));
    }
  }

  // Category pages
  const categories = [...new Set(products.map((p) => p.main_category).filter(Boolean))];
  const categoryUrls = categories.map((cat) =>
    buildUrl(`${SITE_URL}/products?category=${encodeURIComponent(cat)}`, "daily", "0.85"),
  );

  // Subcategory pages
  const subMap = new Map();
  for (const p of products) {
    if (p.main_category && p.subcategory) {
      subMap.set(`${p.main_category}|||${p.subcategory}`, { main: p.main_category, sub: p.subcategory });
    }
  }
  const subcategoryUrls = [...subMap.values()].map(({ main, sub }) =>
    buildUrl(
      `${SITE_URL}/products?category=${encodeURIComponent(main)}&sub=${encodeURIComponent(sub)}`,
      "daily",
      "0.75",
    ),
  );

  const staticUrls = STATIC_ROUTES.map(({ path, changefreq, priority }) =>
    buildUrl(`${SITE_URL}${path}`, changefreq, priority),
  );

  const allUrls = [...staticUrls, ...categoryUrls, ...subcategoryUrls, ...productUrls];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls.join("\n")}
</urlset>
`;

  writeFileSync(resolve(root, "public/sitemap.xml"), sitemap, "utf-8");
  console.log(
    `Sitemap written: ${staticUrls.length} static, ${categoryUrls.length} categories, ${subcategoryUrls.length} subcategories, ${productUrls.length} products`,
  );
}

main().catch((err) => {
  console.error("Sitemap generation failed:", err);
  process.exit(1);
});
