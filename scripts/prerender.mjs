/**
 * Post-build SSG step: generates dist/product/[id]/index.html for every
 * published product, with the correct <title>, meta description, Open Graph
 * tags, and JSON-LD baked into the HTML before React hydrates.
 *
 * This means Google and social crawlers (Twitter, LinkedIn, WhatsApp) see the
 * right metadata on a plain HTTP fetch — no JavaScript execution required.
 *
 * Run via: node scripts/prerender.mjs   (called automatically by npm run build)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dist = resolve(root, "dist");

// Credentials are hardcoded in src/lib/supabase.ts — use the same values here
const SUPABASE_URL = "https://dkgjsobfljqoggalivzt.supabase.co";
const SUPABASE_KEY = "sb_publishable_hjMIhO09DS62uJCvhgJoOQ_SY_CZepJ";
const SITE_URL = "https://cunstruct.com";
const SITE_NAME = "Cunstruct";

const template = readFileSync(resolve(dist, "index.html"), "utf-8");

// ── HTML helpers ─────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function injectMeta(tmpl, { title, description, image, url, type = "website", jsonLd }) {
  const pageTitle = title ? `${title} | ${SITE_NAME}` : SITE_NAME;

  let html = tmpl;

  // Replace known static tags — use \s*\/?>  to match both > and />
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(pageTitle)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${esc(description)}" />`);
  html = html.replace(/<meta property="og:title" content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${esc(pageTitle)}" />`);
  html = html.replace(/<meta property="og:description" content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${esc(description)}" />`);
  html = html.replace(/<meta property="og:type" content="[^"]*"\s*\/?>/, `<meta property="og:type" content="${esc(type)}" />`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*"\s*\/?>/, `<meta name="twitter:title" content="${esc(pageTitle)}" />`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*"\s*\/?>/, `<meta name="twitter:description" content="${esc(description)}" />`);

  // Inject supplementary tags (image, canonical, JSON-LD) before </head>
  const extras = [
    image ? `  <meta property="og:image" content="${esc(image)}">` : "",
    url   ? `  <meta property="og:url" content="${esc(url)}">` : "",
    url   ? `  <link rel="canonical" href="${esc(url)}">` : "",
    image ? `  <meta name="twitter:image" content="${esc(image)}">` : "",
    jsonLd
      ? `  <script type="application/ld+json">${JSON.stringify(
          Array.isArray(jsonLd) ? jsonLd : [jsonLd],
        )}</script>`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (extras) {
    html = html.replace("</head>", `${extras}\n</head>`);
  }

  return html;
}

function writeHtml(segments, html) {
  const filePath = resolve(dist, ...segments);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, html, "utf-8");
}

// ── Supabase fetch ────────────────────────────────────────────────────────────

async function fetchProducts() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/products_master?select=id,name,group_name,brand,description,image_url,selling_price,main_category,subcategory&status=eq.published`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) {
      console.warn(`Supabase fetch failed (${res.status}) — skipping per-product HTML generation`);
      return [];
    }
    return res.json();
  } catch (err) {
    console.warn(`Supabase unreachable (${err.message}) — skipping per-product HTML generation`);
    return [];
  }
}

// ── JSON-LD builders ──────────────────────────────────────────────────────────

function productSchema(p) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.group_name?.trim() || p.name,
    ...(p.description ? { description: p.description } : {}),
    image: p.image_url,
    sku: p.id,
    ...(p.brand ? { brand: { "@type": "Brand", name: p.brand } } : {}),
    offers: {
      "@type": "Offer",
      price: p.selling_price,
      priceCurrency: "INR",
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/product/${p.id}`,
    },
  };
}

function breadcrumbSchema(p) {
  const items = [{ name: "Home", url: `${SITE_URL}/` }];
  if (p.main_category) {
    items.push({
      name: p.main_category,
      url: `${SITE_URL}/products?category=${encodeURIComponent(p.main_category)}`,
    });
  }
  if (p.subcategory) {
    items.push({
      name: p.subcategory,
      url: `${SITE_URL}/products?category=${encodeURIComponent(p.main_category ?? "")}&sub=${encodeURIComponent(p.subcategory)}`,
    });
  }
  items.push({ name: p.group_name?.trim() || p.name, url: `${SITE_URL}/product/${p.id}` });
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const products = await fetchProducts();

  // One canonical URL per product group (pick first product in each group)
  const canonicalByGroup = new Map();
  for (const p of products) {
    const key = p.group_name?.trim() || p.name;
    if (!canonicalByGroup.has(key)) canonicalByGroup.set(key, p);
  }

  let productCount = 0;
  for (const p of canonicalByGroup.values()) {
    const groupName = p.group_name?.trim() || p.name;
    const title = `${p.brand ? p.brand + " " : ""}${groupName}`;
    const description = p.description
      ? `${p.description.slice(0, 155)}${p.description.length > 155 ? "…" : ""}`
      : `Buy ${groupName} online from Cunstruct. 30-minute delivery.`;

    const html = injectMeta(template, {
      title,
      description,
      image: p.image_url,
      url: `${SITE_URL}/product/${p.id}`,
      type: "product",
      jsonLd: [productSchema(p), breadcrumbSchema(p)],
    });

    writeHtml(["product", p.id, "index.html"], html);
    productCount++;
  }

  // /products — generic listing page
  writeHtml(
    ["products", "index.html"],
    injectMeta(template, {
      title: "All Products",
      description:
        "Browse all construction materials — cement, steel, tiles, plumbing, electrical and more. Delivered in 30 minutes.",
      url: `${SITE_URL}/products`,
    }),
  );

  // /kits
  writeHtml(
    ["kits", "index.html"],
    injectMeta(template, {
      title: "Construction Kits",
      description:
        "Pre-assembled construction kits for common jobs — plastering, tiling, plumbing repairs and more. Everything you need, delivered in 30 minutes.",
      url: `${SITE_URL}/kits`,
    }),
  );

  // /search (static shell — query-specific content loads client-side)
  writeHtml(
    ["search", "index.html"],
    injectMeta(template, {
      title: "Search",
      description: "Search Cunstruct for construction materials, kits, and more.",
      url: `${SITE_URL}/search`,
    }),
  );

  console.log(
    `Pre-rendered: ${productCount} product pages + /products + /kits + /search`,
  );
}

main().catch((err) => {
  // Don't fail the build — pre-rendering is a best-effort enhancement
  console.warn("Pre-render error:", err.message);
});
