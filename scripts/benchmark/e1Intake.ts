// E1 intake check and E2 hand-off (plan of record v1.0, items E1 and E2).
//
// Checks each benchmark set folder laid out as in
// docs/benchmarks/E1-BENCHMARK-INTAKE-KIT.md §2 against the kit's per-set
// checklist (§8), checks the portfolio against the plan's E1 test, and builds
// the E2 runner's manifest from COMPLETE sets only: the reference is always
// the adjudicated gold BOQ, never a single QS's file. Nothing here reads a
// drawing's content or edits any input; it only lists, hashes and validates.
//
// Steps that files cannot prove (the extractor ran before any QS file was
// opened; the measurement sheets passed the completeness check; the contract
// tags were second-checked) must be attested by name and date in set.json.
// An attestation records a person's confirmation; it is never inferred.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateReferenceBoq, statusOf, type ReferenceBoq } from "@/lib/e2e/boqReference";
import { MANIFEST_SCHEMA, type Manifest, type ManifestSet } from "./runner";

export const E1_SET_SCHEMA = "cunstruct.e1-set.v1";
export const TYPOLOGIES = ["residential", "commercial", "institutional"] as const;
export const MODALITIES = ["vector", "scanned"] as const;
export type Typology = (typeof TYPOLOGIES)[number];
export type Modality = (typeof MODALITIES)[number];

/** set.json: the machine-readable row of the local register (kit §3). Never committed. */
export interface E1SetMeta {
  schema_version: typeof E1_SET_SCHEMA;
  id: string;
  typology: Typology;
  modality: Modality;
  /** Kit §1.1: meets the Set A contract → scored as an "acceptance" set; otherwise "development". */
  setAEligible: boolean;
  permission: { status: "signed" | "pending"; signedBy?: string; date?: string };
  attestations?: Partial<Record<AttestationKey, { by: string; date: string }>>;
}

/** Kit §8 rows that files alone cannot prove. */
export const ATTESTATIONS = {
  engineOutputBeforeQsOpened: "Engine output saved and hashed before any QS file was opened (kit §2, protocol v1 §2–§4)",
  qsSheetsComplete: "QS-A and QS-B measurement sheets pass the completeness check, every scaled row identified (kit §5)",
  noMeasuredLineOnScaledRow: "No measured line in either QS reference BOQ or in gold rests on a scaled row (kit §5, §6.2)",
  contractTagsChecked: "Contract tags checked by a second person (kit §7)",
} as const;
export type AttestationKey = keyof typeof ATTESTATIONS;

/** Drawings that may never enter E1 (kit §1.3; pilot package §A5, X1–X11).
 *  Set B is recorded in the repo only as af382dca…f9db5, so it is matched by
 *  that prefix and suffix. The app's own drawings (X3–X5) are held only in the
 *  local, git-ignored EXCLUSION-HASHES.local.md, read by checkE1Root. */
export const EXCLUDED_DRAWINGS: { label: string; test: (sha: string) => boolean }[] = [
  { label: "Set B (protocol v1 §3, af382dca…f9db5)", test: (s) => s.startsWith("af382dca") && s.endsWith("f9db5") },
  ...([
    ["external-20261013 drawing-1.pdf (X1)", "6ef6c85bf0cf43ea260e5a7e78bbbfaf08ef26586801a626a605ad3b0b1e7e72"],
    ["external-20261013 drawing-2.pdf (X2)", "05d0a2c400fc3c029c366814d793af71dd70a0749dbfd58b60d7a3b1a1810abb"],
    ["repository fixture e2e/fixtures/document-a.pdf (X7)", "6d220af14626bfb6d092b1f39d198d6ce0a25c3d46cc467c79fb11e6671f47ec"],
    ["repository fixture e2e/fixtures/document-b.pdf (X8)", "919b6d49f47522788b8a4af337e03f83fea70a6e8d9f215a58a365b99894f3a2"],
    ["repository fixture raster-only.pdf (X9)", "af627014b6720f493b8aa03dde4794cea47472cbdd97d7a82506026dd59ba349"],
    ["repository fixture rotated-90.pdf (X10)", "d472bd79921f9d704baddb77eedc0737c70bb3c5f45156d035dade1ac07301af"],
    ["repository fixture vector-geometry.pdf (X11)", "818f73a061aeb1989658bfedc14d13faba4f2174c53d37a23a23ebaceb5b6ef7"],
  ] as const).map(([label, hash]) => ({ label, test: (s: string) => s === hash })),
];

/** The local exclusion register: every full SHA-256 written in it is excluded. */
export const LOCAL_EXCLUSIONS_FILE = "EXCLUSION-HASHES.local.md";
export function localExclusions(e1Root: string): Set<string> {
  const f = join(resolve(e1Root), LOCAL_EXCLUSIONS_FILE);
  return existsSync(f) ? new Set(readFileSync(f, "utf8").toLowerCase().match(/\b[0-9a-f]{64}\b/g) ?? []) : new Set();
}

/** Set folders are named S01, S02 …; any other folder under the E1 root
 *  (acquisition notes, screening, scoring output) is not a set. */
export const SET_FOLDER = /^S\d{2,}$/;

export interface Check { id: string; ok: boolean; detail: string }
export interface SetIntake {
  dir: string;
  id: string;
  meta: E1SetMeta | null;
  drawingSha256: string | null;
  /** Every check passed: the set counts towards E1 and may be scored. */
  complete: boolean;
  checks: Check[];
}

const HEX64 = /^[0-9a-f]{64}$/;
const sha256File = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const filesIn = (dir: string) =>
  existsSync(dir) && statSync(dir).isDirectory()
    ? readdirSync(dir).filter((f) => !f.startsWith(".") && statSync(join(dir, f)).isFile()).sort()
    : [];
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** The reference BOQ among a folder's JSON files (exactly one must validate). */
function referenceIn(dir: string, drawingSha256: string): { ref?: ReferenceBoq; file?: string; problem?: string } {
  const json = filesIn(dir).filter((f) => f.toLowerCase().endsWith(".json"));
  if (json.length === 0) return { problem: `no reference BOQ (.json) in ${dir}` };
  const loaded = json.map((f) => {
    try {
      return { f, r: validateReferenceBoq(readJson(join(dir, f)), drawingSha256) };
    } catch (e) {
      return { f, r: { status: "invalid" as const, errors: [`not JSON: ${(e as Error).message}`] } };
    }
  });
  const ok = loaded.filter((x) => x.r.status === "loaded");
  if (ok.length !== 1) {
    const why = loaded.filter((x) => x.r.status !== "loaded").map((x) => `${x.f}: ${JSON.stringify("errors" in x.r ? x.r.errors.slice(0, 3) : x.r)}`);
    return { problem: ok.length === 0 ? `no valid reference BOQ in ${dir} (${why.join("; ")})` : `${ok.length} valid reference BOQs in ${dir}; exactly one is expected` };
  }
  return { ref: (ok[0].r as { reference: ReferenceBoq }).reference, file: join(dir, ok[0].f) };
}

function validateMeta(raw: unknown, folder: string): { meta?: E1SetMeta; errors: string[] } {
  const m = raw as Partial<E1SetMeta>;
  const errors: string[] = [];
  if (m?.schema_version !== E1_SET_SCHEMA) errors.push(`schema_version must be "${E1_SET_SCHEMA}"`);
  if (m?.id !== folder) errors.push(`id must equal the folder name "${folder}"`);
  if (!TYPOLOGIES.includes(m?.typology as Typology)) errors.push(`typology must be one of ${TYPOLOGIES.join(", ")}`);
  if (!MODALITIES.includes(m?.modality as Modality)) errors.push(`modality must be one of ${MODALITIES.join(", ")}`);
  if (typeof m?.setAEligible !== "boolean") errors.push("setAEligible must be true or false");
  if (m?.permission?.status !== "signed" && m?.permission?.status !== "pending") errors.push('permission.status must be "signed" or "pending"');
  return errors.length ? { errors } : { meta: m as E1SetMeta, errors };
}

/** Check one set folder against the kit's §8 checklist. Never throws for a bad input.
 *  `localExcluded`: full hashes from the local exclusion register. */
export function checkE1Set(setDir: string, localExcluded: Set<string> = new Set()): SetIntake {
  const dir = resolve(setDir);
  const id = dir.split(/[\\/]/).pop()!;
  const checks: Check[] = [];
  const add = (cid: string, ok: boolean, detail: string) => checks.push({ id: cid, ok, detail });
  const out = (): SetIntake => ({ dir, id, meta, drawingSha256, complete: checks.length > 0 && checks.every((c) => c.ok), checks });
  let meta: E1SetMeta | null = null;
  let drawingSha256: string | null = null;

  // Register row.
  const metaPath = join(dir, "set.json");
  if (!existsSync(metaPath)) add("register", false, "set.json is missing (kit §3)");
  else {
    try {
      const v = validateMeta(readJson(metaPath), id);
      if (v.meta) meta = v.meta;
      add("register", !!v.meta, v.meta ? `${v.meta.typology}, ${v.meta.modality}, ${v.meta.setAEligible ? "Set A eligible" : "development"}` : v.errors.join("; "));
    } catch (e) {
      add("register", false, `set.json is not JSON: ${(e as Error).message}`);
    }
  }

  // Permission.
  const permFiles = filesIn(join(dir, "permission"));
  const signed = meta?.permission.status === "signed" && isStr(meta.permission.signedBy) && isStr(meta.permission.date);
  add("permission", signed && permFiles.length > 0,
    !signed ? "permission is not recorded as signed, with signer and date, in set.json" : permFiles.length ? `signed by ${meta!.permission.signedBy}, ${meta!.permission.date}` : "permission/ holds no signed document");

  // Drawing, its recorded hash, and the exclusion list.
  const drawings = filesIn(join(dir, "drawings"));
  if (drawings.length !== 1) add("drawing", false, `drawings/ must hold exactly one file (one combined PDF per set, kit §2); found ${drawings.length}`);
  else {
    drawingSha256 = sha256File(join(dir, "drawings", drawings[0]));
    const sums = existsSync(join(dir, "SHA256SUMS")) ? readFileSync(join(dir, "SHA256SUMS"), "utf8") : "";
    const recorded = sums.split(/\r?\n/).map((l) => l.trim().split(/\s+\*?/)).find((p) => p[1]?.replace(/^drawings\//, "") === drawings[0])?.[0]?.toLowerCase();
    const excluded = EXCLUDED_DRAWINGS.find((x) => x.test(drawingSha256!))
      ?? (localExcluded.has(drawingSha256) ? { label: `a drawing in ${LOCAL_EXCLUSIONS_FILE}` } : undefined);
    if (!recorded) add("drawing", false, `SHA256SUMS does not record drawings/${drawings[0]}`);
    else if (recorded !== drawingSha256) add("drawing", false, `drawings/${drawings[0]} hashes to ${drawingSha256}, not the recorded ${recorded}: the file changed after receipt`);
    else if (excluded) add("drawing", false, `the drawing is ${excluded.label}, which is excluded from E1 (kit §1.3)`);
    else add("drawing", true, `${drawings[0]} ${drawingSha256}`);
  }

  // Engine output, hashed.
  const eo = join(dir, "engine-output");
  const eoJson = filesIn(eo).filter((f) => f.toLowerCase().endsWith(".json"));
  if (eoJson.length !== 1) add("engine-output", false, `engine-output/ must hold exactly one extractor .json; found ${eoJson.length}`);
  else {
    const shaFile = join(eo, `${eoJson[0]}.sha256`);
    const recorded = existsSync(shaFile) ? readFileSync(shaFile, "utf8").trim().split(/\s+/)[0].toLowerCase() : "";
    const actual = sha256File(join(eo, eoJson[0]));
    add("engine-output", HEX64.test(recorded) && recorded === actual,
      !recorded ? `${eoJson[0]}.sha256 is missing: the output must be hashed when it is written` : recorded !== actual ? `${eoJson[0]} hashes to ${actual}, not the recorded ${recorded}` : `${eoJson[0]} ${actual}`);
  }

  // Two QS deliverables, each a measurement sheet and a valid reference BOQ.
  const preparers: string[] = [];
  for (const qs of ["qs-a", "qs-b"]) {
    const qdir = join(dir, qs);
    const sheet = filesIn(qdir).filter((f) => /measurement/i.test(f) && !f.toLowerCase().endsWith(".json"));
    const r = drawingSha256 ? referenceIn(qdir, drawingSha256) : { problem: "no drawing hash to validate against" };
    if (r.ref) preparers.push(r.ref.preparedBy.trim().toLowerCase());
    add(qs, sheet.length > 0 && !!r.ref,
      sheet.length === 0 ? `${qs}/ holds no measurement sheet (a file with "measurement" in its name)` : r.problem ?? `${sheet.join(", ")}; reference BOQ by ${r.ref!.preparedBy}, ${r.ref!.lines.length} lines`);
  }
  if (preparers.length === 2) add("qs-independent", preparers[0] !== preparers[1], preparers[0] !== preparers[1] ? "QS-A and QS-B are different people" : "QS-A and QS-B reference BOQs name the same preparer");

  // Adjudicated measurement sheet (E1 evidence) with its disagreement log.
  const adj = filesIn(join(dir, "adjudication"));
  const adjSheet = adj.filter((f) => /measurement/i.test(f));
  const adjLog = adj.filter((f) => /disagreement/i.test(f));
  add("adjudication", adjSheet.length > 0 && adjLog.length > 0,
    adjSheet.length === 0 ? "adjudication/ holds no adjudicated measurement sheet" : adjLog.length === 0 ? "adjudication/ holds no disagreement log" : `${adjSheet.join(", ")}; ${adjLog.join(", ")}`);

  // Gold reference BOQ (E2 input): valid, by a third person, with its log.
  let gold: ReferenceBoq | undefined;
  {
    const gdir = join(dir, "gold");
    const r = drawingSha256 ? referenceIn(gdir, drawingSha256) : { problem: "no drawing hash to validate against" };
    const log = filesIn(gdir).filter((f) => /disagreement/i.test(f));
    const by = r.ref?.preparedBy.trim().toLowerCase();
    const third = !!by && !preparers.includes(by);
    if (r.ref) gold = r.ref;
    add("gold", !!r.ref && third && log.length > 0,
      r.problem ?? (!third ? `gold is prepared by ${r.ref!.preparedBy}, who is also one of the two QS: the adjudicator must be a third person` : log.length === 0 ? "gold/ holds no disagreement log" : `${r.ref!.lines.length} lines, adjudicated by ${r.ref!.preparedBy}; sha256 ${sha256File(r.file!)}`));
  }

  // Contract tags: every measured gold line tagged, nothing else.
  const tagsPath = join(dir, "contract-tags.json");
  if (!existsSync(tagsPath)) add("contract-tags", false, "contract-tags.json is missing (kit §7)");
  else if (!gold) add("contract-tags", false, "cannot check the tags without a valid gold reference");
  else {
    try {
      const tags = readJson(tagsPath) as Record<string, unknown>;
      const measured = gold.lines.filter((l) => statusOf(l) === "measured").map((l) => l.id);
      const untagged = measured.filter((lid) => tags[lid] !== "in" && tags[lid] !== "out");
      const unknown = Object.keys(tags).filter((k) => !measured.includes(k));
      add("contract-tags", untagged.length === 0 && unknown.length === 0,
        untagged.length ? `${untagged.length} measured gold line(s) untagged: ${untagged.slice(0, 5).join(", ")}` : unknown.length ? `tags name ${unknown.length} id(s) that are not measured gold lines: ${unknown.slice(0, 5).join(", ")}` : `${measured.length} measured lines tagged (${Object.values(tags).filter((t) => t === "in").length} in)`);
    } catch (e) {
      add("contract-tags", false, `contract-tags.json is not JSON: ${(e as Error).message}`);
    }
  }

  // Human attestations for what files cannot prove.
  for (const [key, what] of Object.entries(ATTESTATIONS) as [AttestationKey, string][]) {
    const a = meta?.attestations?.[key];
    add(`attest:${key}`, !!a && isStr(a.by) && isStr(a.date), a && isStr(a.by) && isStr(a.date) ? `${a.by}, ${a.date}` : `not attested in set.json: ${what}`);
  }
  return out();
}

/** Kit §1.1 targets beyond the plan's own test: reported, not required. */
export interface Portfolio {
  sets: number;
  complete: number;
  byTypology: Record<Typology, number>;
  byModality: Record<Modality, number>;
  /** The plan's E1 test, as far as files can show it: 10–20 complete sets
   *  spanning the three typologies and both modalities. */
  meetsPlanCount: boolean;
  meetsPlanSpread: boolean;
  missing: string[];
  kitTargetsUnmet: string[];
}

export function checkE1Portfolio(sets: SetIntake[]): Portfolio {
  const done = sets.filter((s) => s.complete && s.meta);
  const byTypology = Object.fromEntries(TYPOLOGIES.map((t) => [t, done.filter((s) => s.meta!.typology === t).length])) as Record<Typology, number>;
  const byModality = Object.fromEntries(MODALITIES.map((m) => [m, done.filter((s) => s.meta!.modality === m).length])) as Record<Modality, number>;
  const missing: string[] = [];
  if (done.length < 10) missing.push(`${10 - done.length} more complete set(s) for the minimum of 10`);
  if (done.length > 20) missing.push(`${done.length} complete sets: the plan says 10–20`);
  for (const t of TYPOLOGIES) if (!byTypology[t]) missing.push(`no complete ${t} set`);
  for (const m of MODALITIES) if (!byModality[m]) missing.push(`no complete ${m} set`);
  const kitTargetsUnmet: string[] = [];
  for (const t of TYPOLOGIES) if (byTypology[t] < 3) kitTargetsUnmet.push(`${t}: ${byTypology[t]} of 3`);
  if (byModality.vector * 2 < done.length) kitTargetsUnmet.push(`vector: ${byModality.vector} of ${done.length}, under half`);
  if (byModality.scanned < 3) kitTargetsUnmet.push(`scanned: ${byModality.scanned} of 3`);
  if (!done.some((s) => s.meta!.setAEligible)) kitTargetsUnmet.push("no Set A eligible set");
  return {
    sets: sets.length, complete: done.length, byTypology, byModality,
    meetsPlanCount: done.length >= 10 && done.length <= 20,
    meetsPlanSpread: TYPOLOGIES.every((t) => byTypology[t] > 0) && MODALITIES.every((m) => byModality[m] > 0),
    missing, kitTargetsUnmet,
  };
}

/** Check every set folder (S01, S02 …) under an E1 root. Other folders are
 *  listed as ignored, never counted as sets. */
export function checkE1Root(root: string): { sets: SetIntake[]; portfolio: Portfolio; ignoredFolders: string[]; localExclusions: number } {
  const r = resolve(root);
  const folders = readdirSync(r).filter((f) => !f.startsWith(".") && statSync(join(r, f)).isDirectory()).sort();
  const excluded = localExclusions(r);
  const sets = folders.filter((f) => SET_FOLDER.test(f)).map((f) => checkE1Set(join(r, f), excluded));
  return { sets, portfolio: checkE1Portfolio(sets), ignoredFolders: folders.filter((f) => !SET_FOLDER.test(f)), localExclusions: excluded.size };
}

/** The E2 runner's manifest, from complete sets only. An incomplete set (no
 *  gold, untagged lines, unverified hashes, missing attestations …) is
 *  refused with its failing checks, never scored against a lesser reference. */
export function manifestFromE1(sets: SetIntake[]): { manifest: Manifest; refused: { id: string; failing: Check[] }[] } {
  const entries: ManifestSet[] = [];
  const refused: { id: string; failing: Check[] }[] = [];
  for (const s of sets) {
    if (!s.complete || !s.meta || !s.drawingSha256) {
      refused.push({ id: s.id, failing: s.checks.filter((c) => !c.ok) });
      continue;
    }
    const eo = join(s.dir, "engine-output");
    const analysis = filesIn(eo).find((f) => f.toLowerCase().endsWith(".json"))!;
    const gold = referenceIn(join(s.dir, "gold"), s.drawingSha256).file!;
    const decisions = join(s.dir, "review", "decisions.json");
    entries.push({
      id: s.id,
      role: s.meta.setAEligible ? "acceptance" : "development",
      documentName: s.id,
      drawingSha256: s.drawingSha256,
      analysis: join(eo, analysis),
      analysisSha256: readFileSync(join(eo, `${analysis}.sha256`), "utf8").trim().split(/\s+/)[0].toLowerCase(),
      reference: gold,
      contract: join(s.dir, "contract-tags.json"),
      ...(existsSync(decisions) ? { decisions } : {}),
    });
  }
  return { manifest: { schema_version: MANIFEST_SCHEMA, sets: entries }, refused };
}
