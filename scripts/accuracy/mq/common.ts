// Shared helpers for the measurement-quality CLI tools (accuracy harness only; not product code).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");

/** --key=value / --key value flags from anywhere in argv (vite-node does not keep argv positions stable). */
export function args(): Record<string, string> {
  const a = process.argv, out: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(a[i]);
    if (!m) continue;
    out[m[1]] = m[2] ?? (a[i + 1] && !a[i + 1].startsWith("--") ? a[++i] : "true");
  }
  return out;
}
export function need(a: Record<string, string>, k: string): string {
  if (!a[k]) throw new Error(`missing --${k}`);
  return a[k];
}

export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
export const sha256File = (p: string) => sha256(readFileSync(p));

/** Deterministic JSON: object keys sorted, so equal content always hashes equally. */
export function stableStringify(v: unknown, indent = 0): string {
  const sort = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(sort) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])])) : x;
  return JSON.stringify(sort(v), null, indent);
}
export function writeJson(p: string, v: unknown, indent = 1): string {
  mkdirSync(path.dirname(p), { recursive: true });
  const s = stableStringify(v, indent) + "\n";
  writeFileSync(p, s);
  return sha256(s);
}
export function writeText(p: string, s: string): string {
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, s);
  return sha256(s);
}
export const readJson = <T = unknown>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

/** Refuse to write private outputs inside the Git working tree (drawings, crops and review data stay out of Git). */
export function assertOutsideRepo(p: string) {
  const abs = path.resolve(p);
  if (abs === REPO || abs.startsWith(REPO + path.sep)) throw new Error(`refusing to write private output inside the repository: ${abs}`);
}

export const csvCell = (v: unknown) => {
  const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

export const exists = existsSync;
