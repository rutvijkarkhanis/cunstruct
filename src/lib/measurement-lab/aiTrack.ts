/**
 * TRACK B — in-house + AI-assisted measurement: data contract and comparison only.
 *
 * STATUS: UNAVAILABLE. No AI call is made from the Measurement Lab. The correct integration point is
 * the existing server-side edge function `supabase/functions/ai-analysis` (OpenAI key held server-side,
 * per-mode prompt + JSON schema, claiming ledger + preflight against duplicate paid calls, model and
 * pricing from `_shared/modelConfig.ts`). It has no measurement mode today; adding one requires an
 * edge-function change, a deploy and explicit authorization for paid calls. Until then this module only
 * defines how a Track B run would be recorded, validated and compared, so that nothing has to be
 * invented later and nothing can be faked now.
 *
 * Rules the contract enforces:
 *  - Track B is its own frozen run; the Track A (in-house) run it builds on is referenced by hash and
 *    never modified;
 *  - provider, model, model version, configuration and prompt version are mandatory;
 *  - AI input and raw output are kept verbatim (with hashes); failures and incomplete responses are
 *    recorded as such, never as empty-but-successful runs;
 *  - usage and cost are recorded; retries are counted (and limited by the caller's policy);
 *  - every AI measurement says what it did relative to Track A (kept / changed / added / removed);
 *  - no field can carry a price, rate or BOQ quantity, and no Track B result is ever "verified".
 */
import { z } from "zod";
import type { FrozenRun, LabMeasurement } from "./core";

export const TRACK_B_STATUS = {
  available: false,
  reason: "No measurement mode exists in the ai-analysis edge function; adding one needs an edge-function change, a deploy and authorization for paid calls. No AI call has been made.",
  integration_point: "supabase/functions/ai-analysis (server-side key, claiming ledger, preflight, _shared/modelConfig.ts pricing)",
} as const;

const pt = z.array(z.number()).length(2);
export const AiMeasurement = z.object({
  /** the Track A measurement this refers to; null for a measurement the AI added */
  base_measurement_id: z.string().nullable(),
  action: z.enum(["kept", "changed", "added", "removed"]),
  page: z.number().int().positive(),
  text: z.string(),
  value: z.number().nullable(),
  unit: z.string().nullable(),
  start: pt.nullable(),
  end: pt.nullable(),
  associated_element: z.string().nullable(),
  decision: z.enum(["accepted", "held", "rejected"]),
  rationale: z.string(),
}).strict(); // strict: no price, rate, quantity or BOQ field can ride along

export const TrackBRun = z.object({
  schema: z.literal("cunstruct.lab-ai-run.v1"),
  track: z.literal("B"),
  base_run: z.object({ run_id: z.string(), output_sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
  provider: z.string().min(1),
  model: z.string().min(1),
  model_version: z.string().min(1),
  configuration: z.record(z.unknown()),
  prompt_version: z.string().min(1),
  request: z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/), sent_at: z.string(), pages: z.array(z.number().int().positive()) }),
  response: z.object({ status: z.enum(["complete", "incomplete", "failed"]), raw: z.string(), raw_sha256: z.string().regex(/^[0-9a-f]{64}$/), error: z.string().nullable(), received_at: z.string() }),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative(), cost_usd: z.number().nonnegative().nullable(), retries: z.number().int().nonnegative() }),
  measurements: z.array(AiMeasurement),
  /** AI output is never a verification */
  verified: z.literal(false),
}).superRefine((r, ctx) => {
  if (r.response.status === "failed" && r.measurements.length) ctx.addIssue({ code: "custom", path: ["measurements"], message: "a failed AI response cannot carry measurements" });
  if (r.response.status !== "failed" && r.response.error) ctx.addIssue({ code: "custom", path: ["response", "error"], message: "an error belongs to a failed response" });
});
export type TrackBRun = z.infer<typeof TrackBRun>;

/** Validates a Track B run against its Track A base: it must reference that exact frozen output, and
 *  every kept/changed/removed measurement must name a real Track A measurement. */
export function validateTrackB(run: unknown, base: FrozenRun): { ok: true; run: TrackBRun } | { ok: false; errors: string[] } {
  const p = TrackBRun.safeParse(run);
  if (!p.success) return { ok: false, errors: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const errs: string[] = [];
  if (p.data.base_run.run_id !== base.run_id || p.data.base_run.output_sha256 !== base.output_sha256) errs.push("Track B does not reference this exact frozen Track A run");
  const ids = new Set(base.measurements.map((m) => m.id));
  for (const m of p.data.measurements) {
    if (m.action === "added" ? m.base_measurement_id !== null : !m.base_measurement_id || !ids.has(m.base_measurement_id)) errs.push(`${m.action} measurement has an invalid base id (${m.base_measurement_id})`);
  }
  return errs.length ? { ok: false, errors: errs } : { ok: true, run: p.data };
}

/** What the AI changed relative to Track A, field by field. Track A is read, never written. */
export function diffTracks(base: readonly LabMeasurement[], b: TrackBRun) {
  const byId = new Map(base.map((m) => [m.id, m]));
  const out = { kept: [] as string[], changed: [] as { id: string; fields: string[] }[], added: [] as number[], removed: [] as string[], untouched: [] as string[] };
  const seen = new Set<string>();
  b.measurements.forEach((m, i) => {
    if (m.action === "added") { out.added.push(i); return; }
    const a = byId.get(m.base_measurement_id!)!; seen.add(a.id);
    if (m.action === "removed") { out.removed.push(a.id); return; }
    const fields: string[] = [];
    if (m.value !== a.value) fields.push("value");
    if (m.decision !== a.decision) fields.push("decision");
    if (JSON.stringify(m.start) !== JSON.stringify(a.span?.start ?? null) || JSON.stringify(m.end) !== JSON.stringify(a.span?.end ?? null)) fields.push("endpoints");
    if (m.action === "kept" && !fields.length) out.kept.push(a.id); else out.changed.push({ id: a.id, fields });
  });
  for (const m of base) if (!seen.has(m.id)) out.untouched.push(m.id);
  return out;
}
