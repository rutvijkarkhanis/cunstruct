// DEPLOYED TARGET CHECK — which Supabase project a built or deployed app
// actually connects to, read from its JavaScript (not from configuration).
//
//   node scripts/check-deployed-target.mjs https://<preview-host>/   # a deployment (GET only)
//   node scripts/check-deployed-target.mjs dist                      # a local build
//
// Reports every URL a Supabase client is constructed with, whether it is the
// production project (supabase/config.toml / committed .env, as the staging
// guard reads them), and whether the workbench preview code shipped. Exits 1
// when the app connects to production or its target cannot be read, so it can
// gate a hand-over. Sends no credentials and reads nothing but public assets.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProduction, refFromSupabaseUrl } from "./staging-guard.mjs";

// A minified `createClient(url, key, { auth: … })` call site, as Vite emits it.
export const CLIENT_RE = /[\w$]{1,3}="([^"]*)",[\w$]{1,3}="[^"]*",[\w$]{1,3}=[\w$]{1,3}\([\w$]{1,3},[\w$]{1,3},\{auth:\{/g;
const PREVIEW_RE = /Workbench preview|Workbench sections|unverifiable-project|production-project|WorkbenchLayout|WorkbenchReview/;
const ASSET_RE = /["'(/]((?:\/)?assets\/[\w.-]+\.js)/g;

/** Every Supabase client URL, and whether preview code is present, in a set of JS texts. */
export function analyse(scripts) {
  const urls = new Set();
  let preview = false;
  for (const text of scripts) {
    for (const m of text.matchAll(CLIENT_RE)) urls.add(m[1]);
    if (PREVIEW_RE.test(text)) preview = true;
  }
  return { urls: [...urls], preview };
}

/** "production" | "non-production" | "unverifiable" for the client URLs found. */
export function verdict(urls, productionRefs) {
  if (!urls.length) return "unverifiable";
  const refs = urls.map((u) => refFromSupabaseUrl(u.replace(/\/+$/, "")) ?? (() => { try { return new URL(u).hostname.toLowerCase(); } catch { return null; } })());
  if (refs.some((r) => r == null)) return "unverifiable";
  if (refs.some((r) => productionRefs.some((p) => r.includes(p)))) return "production";
  return "non-production";
}

async function scriptsFromUrl(base) {
  const seen = new Set(); const texts = [];
  const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`GET ${u} → ${r.status}`); return r.text(); };
  const html = await get(base);
  const queue = [...html.matchAll(ASSET_RE)].map((m) => m[1]);
  while (queue.length && seen.size < 400) {
    const rel = queue.shift();
    const u = new URL(rel.startsWith("/") ? rel : `/${rel}`, base).href;
    if (seen.has(u)) continue;
    seen.add(u);
    const text = await get(u);
    texts.push(text);
    for (const m of text.matchAll(ASSET_RE)) queue.push(m[1]);
  }
  return texts;
}

function scriptsFromDir(dir) {
  const assets = path.join(dir, "assets");
  return fs.readdirSync(assets).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join(assets, f), "utf8"));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const target = process.argv[2];
  if (!target) { console.error("Usage: node scripts/check-deployed-target.mjs <https://deployment/ | build directory>"); process.exit(2); }
  const production = readProduction(root);
  try {
    const scripts = /^https?:\/\//.test(target) ? await scriptsFromUrl(target) : scriptsFromDir(target);
    const { urls, preview } = analyse(scripts);
    const v = verdict(urls, production.refs);
    console.log(`Scripts read: ${scripts.length}`);
    console.log(`Supabase client URL(s): ${urls.length ? urls.join(", ") : "none found"}`);
    console.log(`Target: ${v}${v === "production" ? " (THE PRODUCTION PROJECT)" : ""}`);
    console.log(`Workbench preview code: ${preview ? "present" : "absent"}`);
    process.exit(v === "non-production" ? 0 : 1);
  } catch (e) {
    console.error(`Could not read the app: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
