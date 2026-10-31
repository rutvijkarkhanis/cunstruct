/**
 * Dataset manifests for drawing benchmarks, and the role guard that stops a dataset being used for
 * something its role forbids (above all: a holdout in a development benchmark, or a validation set
 * quietly becoming development data after its result is known).
 *
 * Measurement-quality tooling only; not imported by product code.
 */
import { z } from "zod";

export const DATASET_MANIFEST_SCHEMA = "cunstruct.dataset-manifest.v1";

export const DatasetRole = z.enum(["development", "validation", "holdout", "out-of-domain", "exploratory"]);
export type DatasetRole = z.infer<typeof DatasetRole>;

/** What a run intends to do with a dataset. */
export const Purpose = z.enum([
  "development-benchmark", // scored while the engine is being changed
  "tuning",                // used to choose rules or thresholds
  "validation",            // scored once with the frozen VECTOR engine; never used for tuning
  "raster-validation",     // validation of a raster (scanned) pipeline; never mixed with vector validation
  "release-holdout",       // scored once, for a release decision, with a frozen engine
  "intake-diagnostic",     // read-only structural inspection of the PDFs
  "review-packages",       // blinded material for human reviewers
  "negative-test",         // the engine must NOT produce building measurements here
  "exploratory",           // looking, not scoring
]);
export type Purpose = z.infer<typeof Purpose>;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "full 64-hex SHA-256");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/);

export const SourceFile = z.object({
  name: z.string().min(1),
  sha256: sha256.nullable(), // null only while a file is still to be supplied (status "pending")
  status: z.enum(["present", "pending"]).default("present"),
  pages: z.number().int().positive().nullable(),
  producer: z.string().nullable().describe("CAD/export application from the PDF metadata, if known"),
  text_layer: z.enum(["yes", "no", "partial", "unknown"]),
  content: z.enum(["native-vector", "mixed", "raster-only", "unknown"]),
  scales: z.array(z.string()).default([]),
  viewports: z.array(z.string()).default([]),
  multiple_scales_on_one_sheet: z.boolean().nullable(),
  pages_in_scope: z.array(z.number().int().positive()).nullable().default(null),
  notes: z.string().optional(),
});

export const RoleChange = z.object({
  from: DatasetRole.nullable(),
  to: DatasetRole,
  date: isoDate,
  decided_by: z.string().min(1),
  reason: z.string().min(1),
  /** For validation → development: the recorded validation run that completed the validation role. */
  completed_run: z.object({ report: z.string(), sha256 }).optional(),
});

export const DatasetManifest = z.object({
  schema: z.literal(DATASET_MANIFEST_SCHEMA),
  dataset_id: z.string().regex(/^[A-Za-z0-9._-]+$/),
  description: z.string(),
  role: DatasetRole,
  /** What kind of drawing evidence the dataset carries. A raster dataset can never stand in for
   *  native-vector validation of the vector engine, and vice versa. */
  modality: z.enum(["native-vector", "raster"]).default("native-vector"),
  role_history: z.array(RoleChange).min(1),
  archive: z.object({ name: z.string(), sha256 }).nullable().default(null),
  files: z.array(SourceFile),
  annotations: z.object({
    provenance: z.string().describe("who made the reference and how"),
    independent: z.boolean().describe("true only when prepared by someone other than the engine developer"),
    reviewer: z.string().nullable(),
    verification_date: isoDate.nullable(),
    reference_file: z.string().nullable(),
    reference_sha256: sha256.nullable(),
  }),
  /** Holdout only: the recorded authorization for its single release evaluation. */
  release_authorization: z.object({ by: z.string(), date: isoDate, engine_fingerprint: sha256 }).nullable().default(null),
  notes: z.array(z.string()).default([]),
}).superRefine((m, ctx) => {
  const last = m.role_history[m.role_history.length - 1];
  if (last.to !== m.role) ctx.addIssue({ code: "custom", path: ["role"], message: `role ${m.role} differs from the last recorded role change (${last.to})` });
  m.role_history.forEach((c, i) => {
    const prev = i ? m.role_history[i - 1].to : null;
    if (c.from !== prev) ctx.addIssue({ code: "custom", path: ["role_history", i], message: `role change ${i} starts from ${c.from}, but the role was ${prev}` });
    const err = promotionError(c);
    if (err) ctx.addIssue({ code: "custom", path: ["role_history", i], message: err });
  });
  if (m.release_authorization && m.role !== "holdout") ctx.addIssue({ code: "custom", path: ["release_authorization"], message: "only a holdout carries a release authorization" });
  for (const [i, f] of m.files.entries()) if (f.status === "present" && !f.sha256) ctx.addIssue({ code: "custom", path: ["files", i, "sha256"], message: "a present file needs its full SHA-256" });
});
export type DatasetManifest = z.infer<typeof DatasetManifest>;

/** Rules for changing a dataset's role. Returns why a change is not allowed, or null. */
export function promotionError(c: z.infer<typeof RoleChange>): string | null {
  if (c.from === null || c.from === c.to) return null;
  if (c.from === "holdout" && c.to !== "validation" && c.to !== "development")
    return "a holdout can only move on (to validation or development) after its release evaluation";
  if (c.to === "holdout") return "a dataset that has been looked at cannot become a holdout";
  if (c.from === "validation" && c.to === "development" && !c.completed_run)
    return "validation → development needs the recorded validation run (report and hash) that completed the validation role";
  if (c.from === "out-of-domain" && c.to !== "exploratory") return "an out-of-domain dataset can only become exploratory";
  return null;
}

const ALLOWED: Record<DatasetRole, Purpose[]> = {
  development: ["development-benchmark", "tuning", "intake-diagnostic", "review-packages", "exploratory"],
  validation: ["validation", "raster-validation", "intake-diagnostic", "review-packages"],
  holdout: ["release-holdout"],
  "out-of-domain": ["negative-test", "intake-diagnostic", "exploratory"],
  exploratory: ["exploratory", "intake-diagnostic"],
};

export class DatasetRoleError extends Error {}

/** Throws unless the dataset's role permits the purpose. A holdout is usable only for its one
 *  recorded release evaluation, with the engine fingerprint the authorization names. */
export function assertUsable(m: DatasetManifest, purpose: Purpose, ctx: { engineFingerprint?: string } = {}): void {
  const parsed = DatasetManifest.safeParse(m);
  if (!parsed.success) throw new DatasetRoleError(`invalid manifest ${m?.dataset_id}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  if (purpose === "validation" && m.modality !== "native-vector")
    throw new DatasetRoleError(`dataset ${m.dataset_id} is ${m.modality}: it cannot be used as native-vector validation (use "raster-validation")`);
  if (purpose === "raster-validation" && m.modality !== "raster")
    throw new DatasetRoleError(`dataset ${m.dataset_id} is ${m.modality}: raster validation needs a raster dataset`);
  if (!ALLOWED[m.role].includes(purpose))
    throw new DatasetRoleError(`dataset ${m.dataset_id} has role "${m.role}", which does not permit "${purpose}" (allowed: ${ALLOWED[m.role].join(", ")})`);
  if (m.role === "holdout") {
    const auth = m.release_authorization;
    if (!auth) throw new DatasetRoleError(`holdout ${m.dataset_id} has no recorded release authorization: it must not be opened`);
    if (!ctx.engineFingerprint || ctx.engineFingerprint !== auth.engine_fingerprint)
      throw new DatasetRoleError(`holdout ${m.dataset_id} is authorized only for engine ${auth.engine_fingerprint.slice(0, 12)}…`);
  }
}

/** A development benchmark over several datasets: every one must be development data. */
export function assertDevelopmentSet(ms: DatasetManifest[]): void {
  for (const m of ms) assertUsable(m, "development-benchmark");
}

/** Returns a new manifest with the role changed, refusing changes the rules forbid. */
export function changeRole(m: DatasetManifest, change: Omit<z.infer<typeof RoleChange>, "from">): DatasetManifest {
  const c = { ...change, from: m.role };
  const err = promotionError(c);
  if (err) throw new DatasetRoleError(`${m.dataset_id}: ${err}`);
  return DatasetManifest.parse({ ...m, role: c.to, role_history: [...m.role_history, c] });
}
