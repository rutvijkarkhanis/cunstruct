// DEPLOYED TARGET CHECK — which Supabase project a built or deployed app
// actually connects to, read from its JavaScript (not from configuration).
//
//   node scripts/check-deployed-target.mjs https://<preview-host>/   # a deployment (GET only)
//   node scripts/check-deployed-target.mjs dist                      # a local build
//
// Reports every URL a Supabase client is constructed with and every Supabase
// host the JavaScript names, against the production project (supabase/
// config.toml / committed .env, as the staging guard reads them), and whether
// the workbench preview code shipped. Exit 0 only when every Supabase host is
// a non-production project; 1 for production, none found, or unreadable.
//
// A protected Vercel Preview: set VERCEL_AUTOMATION_BYPASS_SECRET in the
// shell; it is sent as the x-vercel-protection-bypass header and never
// printed. Nothing else is sent, and only same-origin assets are read.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProduction, refFromSupabaseUrl } from "./staging-guard.mjs";

// A minified `createClient(url, key, { auth: … })` call site, as Vite emits it.
export const CLIENT_RE = /[\w$]{1,3}="([^"]*)",[\w$]{1,3}="[^"]*",[\w$]{1,3}=[\w$]{1,3}\([\w$]{1,3},[\w$]{1,3},\{auth:\{/g;
const HOST_RE = /\b([a-z0-9]{20})\.supabase\.(?:co|in)\b/gi;
const PREVIEW_RE = /Workbench preview|Workbench sections|unverifiable-project|production-project|WorkbenchLayout|WorkbenchReview/;
const ASSET_RE = /["'(/]((?:\/)?assets\/[\w.-]+\.js)/g;

/** Client URLs, every Supabase project ref named, and whether preview code is present. */
export function analyse(scripts) {
  const urls = new Set(); const refs = new Set();
  let preview = false;
  for (const text of scripts) {
    for (const m of text.matchAll(CLIENT_RE)) urls.add(m[1]);
    for (const m of text.matchAll(HOST_RE)) refs.add(m[1].toLowerCase());
    if (PREVIEW_RE.test(text)) preview = true;
  }
  return { urls: [...urls], refs: [...refs], preview };
}

/** "production" | "non-production" | "unverifiable". Production wins over everything. */
export function verdict(urls, productionRefs, hostRefs = []) {
  const prod = productionRefs.map((p) => p.toLowerCase());
  if (hostRefs.some((r) => prod.includes(r))) return "production";
  if (!urls.length) return "unverifiable";
  const refs = urls.map((u) => refFromSupabaseUrl(u.replace(/\/+$/, "").toLowerCase()));
  if (refs.some((r) => r != null && prod.includes(r))) return "production";
  if (urls.some((u) => prod.some((p) => u.toLowerCase().includes(p)))) return "production";
  if (refs.some((r) => r == null)) return "unverifiable";
  return "non-production";
}

/** The report lines: hosts and refs only — never a key, a header or a secret. */
export function report({ scripts, urls, refs, preview }, v) {
  return [
    `Scripts read: ${scripts}`,
    `Supabase client URL(s): ${urls.length ? urls.join(", ") : "none found"}`,
    `Supabase projects named in the JavaScript: ${refs.length ? refs.join(", ") : "none"}`,
    `Target: ${v}${v === "production" ? " (THE PRODUCTION PROJECT)" : v === "unverifiable" ? " (not verified as staging)" : ""}`,
    `Workbench preview code: ${preview ? "present" : "absent"}`,
  ];
}

async function scriptsFromUrl(base, env = process.env) {
  const origin = new URL(base).origin;
  const headers = env.VERCEL_AUTOMATION_BYPASS_SECRET ? { "x-vercel-protection-bypass": env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};
  const get = async (u) => {
    const r = await fetch(u, { headers, redirect: "follow" });
    if (!r.ok) throw new Error(`GET ${new URL(u).pathname} → HTTP ${r.status}${r.status === 401 || r.status === 403 ? " (protected? set VERCEL_AUTOMATION_BYPASS_SECRET)" : ""}`);
    if (new URL(r.url).origin !== origin) throw new Error(`GET ${new URL(u).pathname} was redirected to another site (a login page?)`);
    return r.text();
  };
  const seen = new Set(); const texts = [];
  const html = await get(base);
  const queue = [...html.matchAll(ASSET_RE)].map((m) => m[1]);
  while (queue.length && seen.size < 400) {
    const rel = queue.shift();
    const u = new URL(rel.startsWith("/") ? rel : `/${rel}`, origin).href;
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
  if (!production.refs.length) { console.error("Cannot identify the production project from this repository, so nothing can be verified."); process.exit(1); }
  try {
    const scripts = /^https?:\/\//.test(target) ? await scriptsFromUrl(target) : scriptsFromDir(target);
    const a = analyse(scripts);
    const v = verdict(a.urls, production.refs, a.refs);
    for (const line of report({ scripts: scripts.length, ...a }, v)) console.log(line);
    process.exit(v === "non-production" ? 0 : 1);
  } catch (e) {
    console.error(`Could not read the app: ${e instanceof Error ? e.message : "unknown error"}`);
    process.exit(1);
  }
}
