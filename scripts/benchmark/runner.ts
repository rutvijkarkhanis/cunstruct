// MULTI-SET BENCHMARK RUNNER — protocol v1.1 on every set a manifest lists.
// Per set: the frozen pipeline (runEndToEnd) and scorer (scoreEndToEnd) under
// both simulated policies, the §5 gates (gates.ts), and per-category metrics
// (metrics.ts) for the RAW MACHINE run (policy accept-everything). When a set
// supplies a human review-decisions file, the same metrics are computed for a
// separate HUMAN-CORRECTED run and written under a separate key — the two are
// never blended, per set or in the aggregate.
//
// The caller must route "@/integrations/supabase/client" to the in-memory
// database (vi.mock in the driver test), as the pipeline requires.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { execSync } from "node:child_process";
import { runEndToEnd } from "@/lib/e2e/pipeline";
import { scoreEndToEnd, systemItemsOf } from "@/lib/e2e/boqEndToEndScorer";
import { validateReferenceBoq, type ReferenceBoq } from "@/lib/e2e/boqReference";
import type { DsrIndex } from "@/lib/dsr/match";
import { FROZEN_V1_1, frozenHashesMatch, gates, sha256Text, ROOT, type GateResult } from "./gates";
import { CATEGORIES, METRICS_METHOD, metricsOf, recordsOf, type MetricsBlock, type RefRecord, type SysRecord } from "./metrics";

// ── Manifest ─────────────────────────────────────────────────────────────────

export const MANIFEST_SCHEMA = "cunstruct.benchmark-manifest.v1";
export type SetRole = "acceptance" | "development";

export interface ManifestSet {
  /** Unique; used as the output folder name ([A-Za-z0-9._-]). */
  id: string;
  /** "acceptance" = Set A (gates decide), "development" = Set B (reported only). */
  role: SetRole;
  documentName?: string;
  /** SHA-256 of the drawing PDF; the reference must name the same. */
  drawingSha256: string;
  /** Path to the extractor output JSON. */
  analysis: string;
  /** Optional: SHA-256 of the extractor output recorded BEFORE the reference was opened; checked if given. */
  analysisSha256?: string;
  /** Path to the reference BOQ (cunstruct.reference-boq.v1). */
  reference: string;
  /** Path to, or inline, {referenceLineId: "in" | "out"}. */
  contract?: string | Record<string, "in" | "out">;
  /** Path to, or inline, {"<page>": {width, height}} in PDF points. */
  pageSizes?: string | Record<string, { width: number; height: number }>;
  /** Optional path to a human review-decisions file (cunstruct.review-decisions.v1). */
  decisions?: string;
}

export interface Manifest { schema_version: typeof MANIFEST_SCHEMA; sets: ManifestSet[] }

const HEX64 = /^[0-9a-f]{64}$/i;
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

export function validateManifest(raw: unknown): { ok: true; manifest: Manifest } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const m = raw as Partial<Manifest>;
  if (m?.schema_version !== MANIFEST_SCHEMA) errors.push(`schema_version must be "${MANIFEST_SCHEMA}".`);
  if (!Array.isArray(m?.sets) || m.sets.length === 0) errors.push("sets must be a non-empty array.");
  const ids = new Set<string>();
  (Array.isArray(m?.sets) ? m.sets : []).forEach((s, i) => {
    const at = `sets[${i}]`;
    if (!isStr(s?.id) || !/^[A-Za-z0-9._-]+$/.test(s.id)) errors.push(`${at}.id must be [A-Za-z0-9._-]+.`);
    else if (ids.has(s.id)) errors.push(`${at}.id "${s.id}" is repeated.`);
    else ids.add(s.id);
    if (s?.role !== "acceptance" && s?.role !== "development") errors.push(`${at}.role must be "acceptance" or "development".`);
    if (!isStr(s?.drawingSha256) || !HEX64.test(s.drawingSha256)) errors.push(`${at}.drawingSha256 must be a 64-character hex SHA-256.`);
    if (s?.analysisSha256 != null && !(isStr(s.analysisSha256) && HEX64.test(s.analysisSha256))) errors.push(`${at}.analysisSha256 must be a 64-character hex SHA-256 when given.`);
    if (!isStr(s?.analysis)) errors.push(`${at}.analysis (path) is required.`);
    if (!isStr(s?.reference)) errors.push(`${at}.reference (path) is required.`);
    if (s?.decisions != null && !isStr(s.decisions)) errors.push(`${at}.decisions must be a path when given.`);
  });
  return errors.length ? { ok: false, errors } : { ok: true, manifest: m as Manifest };
}

// ── Human review decisions ───────────────────────────────────────────────────

export const DECISIONS_SCHEMA = "cunstruct.review-decisions.v1";

export type Decision =
  | { key: string; action: "accept"; note?: string }
  | { key: string; action: "reject"; note?: string }
  | { key: string; action: "correct"; quantity: number; unit?: string; item?: string; note?: string };

export interface DecisionsFile {
  schema_version: typeof DECISIONS_SCHEMA;
  /** SHA-256 of the exact extractor output file these decisions were made on. */
  analysisSha256: string;
  reviewedBy: string;
  reviewedAt: string;
  /** Must be true: the reviewer did not see the reference BOQ. */
  reviewedWithoutReference: true;
  /** Exactly one decision per analysis item, by its key. */
  decisions: Decision[];
}

const itemsOf = (parsed: unknown): Record<string, unknown>[] | null => {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  const o = (parsed ?? {}) as Record<string, unknown>;
  const arr = o.items ?? o.requirements ?? o.analysis;
  return Array.isArray(arr) ? (arr as Record<string, unknown>[]) : null;
};
const s = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
/** The item key exactly as parseAnalysisV1 resolves it (key → external_key → id → item name). */
export const analysisItemKey = (o: Record<string, unknown>) =>
  s(o.key ?? o.external_key ?? o.id ?? o.item) || s(o.item) || s(o.name) || s(o.description) || s(o.requirement);

/** Validate a decisions file against the analysis text it claims to cover. */
export function validateDecisions(raw: unknown, analysisJson: string): { ok: true; decisions: DecisionsFile } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const d = raw as Partial<DecisionsFile>;
  if (d?.schema_version !== DECISIONS_SCHEMA) errors.push(`schema_version must be "${DECISIONS_SCHEMA}".`);
  if (!isStr(d?.analysisSha256) || d.analysisSha256.toLowerCase() !== sha256Text(analysisJson)) errors.push(`analysisSha256 must be the SHA-256 of the analysis file (${sha256Text(analysisJson)}).`);
  if (!isStr(d?.reviewedBy)) errors.push("reviewedBy is required.");
  if (!isStr(d?.reviewedAt) || Number.isNaN(Date.parse(d.reviewedAt))) errors.push("reviewedAt must be a date.");
  if (d?.reviewedWithoutReference !== true) errors.push("reviewedWithoutReference must be true: a reviewer who saw the reference makes the corrected result meaningless.");
  let items: Record<string, unknown>[] | null = null;
  try { items = itemsOf(JSON.parse(analysisJson)); } catch { errors.push("The analysis file is not JSON."); }
  if (!items) errors.push("The analysis has no items array.");
  const keys = (items ?? []).map(analysisItemKey);
  const dupKeys = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dupKeys.length) errors.push(`Analysis item keys are not unique (${[...new Set(dupKeys)].join(", ")}); decisions cannot address them.`);
  if (!Array.isArray(d?.decisions)) errors.push("decisions must be an array.");
  const seen = new Set<string>();
  (Array.isArray(d?.decisions) ? d.decisions : []).forEach((x, i) => {
    const at = `decisions[${i}]`;
    if (!isStr(x?.key)) { errors.push(`${at}.key is required.`); return; }
    if (seen.has(x.key)) errors.push(`${at}.key "${x.key}" is decided twice.`);
    seen.add(x.key);
    if (!keys.includes(x.key)) errors.push(`${at}.key "${x.key}" is not an item of the analysis.`);
    if (x.action === "correct") {
      if (typeof x.quantity !== "number" || !Number.isFinite(x.quantity) || x.quantity < 0) errors.push(`${at}.quantity must be a non-negative number for "correct".`);
      if (x.unit != null && !isStr(x.unit)) errors.push(`${at}.unit must be a non-empty string when given.`);
      if (x.item != null && !isStr(x.item)) errors.push(`${at}.item must be a non-empty string when given.`);
    } else if (x.action !== "accept" && x.action !== "reject") errors.push(`${at}.action must be "accept", "reject" or "correct".`);
  });
  const undecided = keys.filter((k) => !seen.has(k));
  if (undecided.length) errors.push(`Every analysis item needs a decision; undecided: ${undecided.join(", ")}.`);
  return errors.length ? { ok: false, errors } : { ok: true, decisions: d as DecisionsFile };
}

/** The analysis as the human left it: rejected items removed, corrected items
 *  carrying the reviewer's quantity (status MEASURED), accepted items as they were. */
export function applyDecisions(analysisJson: string, decisions: DecisionsFile): string {
  const parsed = JSON.parse(analysisJson);
  const by = new Map(decisions.decisions.map((x) => [x.key, x]));
  const out = (itemsOf(parsed) ?? []).flatMap((o) => {
    const x = by.get(analysisItemKey(o))!;
    if (x.action === "reject") return [];
    if (x.action === "accept") return [o];
    const c: Record<string, unknown> = { ...o, quantity: x.quantity, status: "MEASURED" };
    delete c.qty; delete c.ai_status; delete c.candidates;
    if (x.unit) c.unit = x.unit;
    if (x.item) c.item = x.item;
    return [c];
  });
  if (Array.isArray(parsed)) return JSON.stringify(out);
  const field = "items" in parsed ? "items" : "requirements" in parsed ? "requirements" : "analysis";
  return JSON.stringify({ ...parsed, [field]: out });
}

// ── One set ──────────────────────────────────────────────────────────────────

const POLICIES = ["accept-everything", "accept-evidenced-measurements"] as const;

export interface SetResult {
  id: string;
  role: SetRole;
  outDir: string;
  error?: string;
  analysisSha256?: string;
  drawingSha256: string;
  gates?: Record<(typeof POLICIES)[number], GateResult[]>;
  rawMachine?: { refs: RefRecord[]; systems: SysRecord[] };
  humanCorrected?: { refs: RefRecord[]; systems: SysRecord[]; reviewedBy: string; reviewedAt: string; decisions: Record<string, number> } | null;
}

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const at = (base: string, p: string) => (isAbsolute(p) ? p : resolve(base, p));
const write = (dir: string, name: string, v: unknown) => writeFileSync(resolve(dir, name), typeof v === "string" ? v : JSON.stringify(v, null, 2));

/** Score one set and write its outputs into `outDir`. Never throws for a bad
 *  input: the error is returned (and written to error.json) so other sets still run. */
export async function runSet(set: ManifestSet, baseDir: string, outDir: string, ix: DsrIndex): Promise<SetResult> {
  mkdirSync(outDir, { recursive: true });
  const result: SetResult = { id: set.id, role: set.role, outDir, drawingSha256: set.drawingSha256 };
  const fail = (error: string) => { write(outDir, "error.json", { setId: set.id, error }); return { ...result, error }; };
  try {
    const analysisJson = readFileSync(at(baseDir, set.analysis), "utf8");
    result.analysisSha256 = sha256Text(analysisJson);
    if (set.analysisSha256 && set.analysisSha256.toLowerCase() !== result.analysisSha256) {
      return fail(`analysis file SHA-256 ${result.analysisSha256} is not the recorded ${set.analysisSha256}.`);
    }
    const loaded = validateReferenceBoq(readJson(at(baseDir, set.reference)), set.drawingSha256);
    if (loaded.status !== "loaded") return fail(`reference not accepted: ${JSON.stringify(loaded)}`);
    const reference: ReferenceBoq = loaded.reference;
    const obj = <T,>(v: string | T | undefined): T | undefined => (typeof v === "string" ? readJson(at(baseDir, v)) : v);
    const contract = obj<Record<string, "in" | "out">>(set.contract) ?? {};
    const pageSizes = obj<Record<string, { width: number; height: number }>>(set.pageSizes);
    const doc = set.documentName ?? set.id;
    const scoreOpts = { drawingPageSizes: pageSizes as Record<number, { width: number; height: number }> | undefined };

    const gateSummary: Record<string, unknown> = { setId: set.id, role: set.role, analysisSha256: result.analysisSha256, drawingSha256: set.drawingSha256 };
    result.gates = {} as SetResult["gates"];
    for (const policy of POLICIES) {
      const run = await runEndToEnd({ analysisJson, documentId: `doc-${set.id}`, documentName: doc, policy });
      const report = scoreEndToEnd(run, loaded, doc, scoreOpts);
      write(outDir, `report-${policy}.json`, report);
      const items = systemItemsOf(run);
      const g = gates(report, reference, contract, new Map(items.map((x) => [x.reviewItemId, x.evidence?.page ?? null])));
      gateSummary[policy] = g.results;
      result.gates![policy] = g.results;
      if (policy === "accept-everything") {
        write(outDir, "g5-worksheet.json", g.g5Worksheet);
        result.rawMachine = recordsOf(set.id, reference.lines, report.accuracy!, items, ix);
      }
    }
    write(outDir, "gates.json", gateSummary);

    result.humanCorrected = null;
    if (set.decisions) {
      const v = validateDecisions(readJson(at(baseDir, set.decisions)), analysisJson);
      if ("errors" in v) return fail(`decisions file not accepted: ${v.errors.join(" ")}`);
      const corrected = applyDecisions(analysisJson, v.decisions);
      write(outDir, "analysis-human-corrected.json", corrected);
      const run = await runEndToEnd({ analysisJson: corrected, documentId: `doc-${set.id}`, documentName: doc, policy: "accept-everything" });
      const report = scoreEndToEnd(run, loaded, doc, scoreOpts);
      write(outDir, "report-human-corrected.json", report);
      const tally: Record<string, number> = {};
      for (const x of v.decisions.decisions) tally[x.action] = (tally[x.action] ?? 0) + 1;
      result.humanCorrected = { ...recordsOf(set.id, reference.lines, report.accuracy!, systemItemsOf(run), ix), reviewedBy: v.decisions.reviewedBy, reviewedAt: v.decisions.reviewedAt, decisions: tally };
    }
    write(outDir, "metrics.json", setMetricsJson(result));
    return result;
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

const RAW_LABEL = "RAW MACHINE — extractor output through the frozen pipeline with the simulated policy accept-everything (no human looked at any item).";
const HUMAN_LABEL = "HUMAN-CORRECTED — the extractor output after a person's accept / reject / correct decisions (decisions file), through the same pipeline and scorer. Additions by the reviewer are not modelled.";

function setMetricsJson(r: SetResult) {
  return {
    setId: r.id, role: r.role, analysisSha256: r.analysisSha256, drawingSha256: r.drawingSha256,
    method: METRICS_METHOD,
    rawMachine: r.rawMachine ? { label: RAW_LABEL, ...metricsOf(r.rawMachine.refs, r.rawMachine.systems) } : null,
    humanCorrected: r.humanCorrected
      ? { label: HUMAN_LABEL, reviewedBy: r.humanCorrected.reviewedBy, reviewedAt: r.humanCorrected.reviewedAt, decisions: r.humanCorrected.decisions, ...metricsOf(r.humanCorrected.refs, r.humanCorrected.systems) }
      : null,
  };
}

// ── All sets ─────────────────────────────────────────────────────────────────

export function setOutcome(r: SetResult): string {
  if (r.error) return `NOT SCORED — ${r.error}`;
  const g = r.gates!["accept-everything"];
  const failed = g.filter((x) => x.pass === false).map((x) => x.gate);
  if (r.role === "development") {
    const g12 = g.filter((x) => x.gate.startsWith("G1") || x.gate.startsWith("G2"));
    return `development set (reported, not accepting): ${g12.map((x) => `${x.gate.split(" ")[0]} ${x.pass === true ? "pass" : "FAIL"}`).join(", ")}`;
  }
  return failed.length ? `NOT ACCEPTED — failing: ${failed.join("; ")}` : "computed gates pass — G5 manual worksheet outstanding before acceptance";
}

const workingTreeCommit = () => {
  try {
    const head = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain --untracked-files=no", { cwd: ROOT, encoding: "utf8" }).trim() !== "";
    return { head, trackedChangesUncommitted: dirty };
  } catch {
    return { head: null, trackedChangesUncommitted: null, note: "git not available — record the commit by hand" };
  }
};

/** Pool per-line records of every set of one role; human-corrected only over sets that have it. */
export function aggregate(results: SetResult[]) {
  const roles: SetRole[] = ["acceptance", "development"];
  return Object.fromEntries(roles.map((role) => {
    const scored = results.filter((r) => r.role === role && !r.error);
    const human = scored.filter((r) => r.humanCorrected);
    return [role, {
      setsScored: scored.map((r) => r.id),
      rawMachine: scored.length
        ? { label: RAW_LABEL, ...pooled(scored.map((r) => r.rawMachine!)) }
        : null,
      humanCorrected: human.length
        ? { label: HUMAN_LABEL, sets: human.map((r) => r.id), setsWithoutDecisions: scored.filter((r) => !r.humanCorrected).map((r) => r.id), ...pooled(human.map((r) => r.humanCorrected!)) }
        : null,
    }];
  }));
}
const pooled = (xs: { refs: RefRecord[]; systems: SysRecord[] }[]) => {
  const m: MetricsBlock = metricsOf(xs.flatMap((x) => x.refs), xs.flatMap((x) => x.systems));
  return { byCategory: m.byCategory };
};

export async function runManifest(manifestPath: string, outRoot: string, ix: DsrIndex) {
  const v = validateManifest(readJson(manifestPath));
  if ("errors" in v) throw new Error(`Manifest not accepted: ${v.errors.join(" ")}`);
  mkdirSync(outRoot, { recursive: true });
  const base = dirname(resolve(manifestPath));
  const results: SetResult[] = [];
  for (const set of v.manifest.sets) results.push(await runSet(set, base, resolve(outRoot, set.id), ix));
  const summary = {
    protocol: "extraction-acceptance-protocol v1.1",
    manifest: resolve(manifestPath),
    manifestSha256: sha256Text(readFileSync(manifestPath, "utf8")),
    generatedAt: new Date().toISOString(),
    workingTree: workingTreeCommit(),
    frozenSoftware: { matchesV1_1: frozenHashesMatch(), files: Object.keys(FROZEN_V1_1) },
    categories: CATEGORIES,
    sets: results.map((r) => ({
      id: r.id, role: r.role, outDir: r.outDir, analysisSha256: r.analysisSha256 ?? null, drawingSha256: r.drawingSha256,
      outcome: setOutcome(r),
      gates: r.gates ? r.gates["accept-everything"].map((g) => ({ gate: g.gate, value: g.value, threshold: g.threshold, pass: g.pass })) : null,
      humanCorrected: r.humanCorrected ? "metrics.json → humanCorrected" : null,
    })),
    aggregate: aggregate(results),
    method: METRICS_METHOD,
  };
  write(outRoot, "summary.json", summary);
  return { results, summary };
}
