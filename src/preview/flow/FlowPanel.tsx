// Integrated flow (plan v1.2 §5B, preview only): one synthetic project run
// through src/lib/preview/flow.ts — measurement rows → provisional DSR rates →
// money-at-risk queue → coverage → sampling sign-off → revision delta. Every
// surface reads the same pipeline result, so an edit in one updates the
// others. In-memory React state only: nothing is saved, read or sent.
import { useMemo, useState } from "react";
import { formatINR } from "@/design/money";
import { QuantityCell } from "@/design/QuantityCell";
import { UNIT_LABEL } from "@/lib/measurement/measurement";
import {
  applyRevision, editMeasurement, emptyReview, recordCheck, recordSampleFinding, reopenFlowGap, resolveFlowGap, runFlow,
  type CheckOutcome, type FlowLineResult, type FlowProject, type FlowReview,
} from "@/lib/preview/flow";
import { REASON_LABEL } from "@/lib/preview/moneyAtRisk";
import { widenMus } from "@/lib/preview/sampling";
import type { EngineLine } from "@/lib/preview/types";
import { CoveragePanel } from "@/preview/CoveragePanel";
import { DEMO_REVIEWER } from "@/preview/fixtures";
import { LineTable } from "@/preview/measurement/MeasurementSheet";
import { RevisionDeltaPanel } from "@/preview/RevisionDeltaPanel";
import { Notice, SurfacePanel } from "@/preview/shared";
import { FLOW_PROJECT, FLOW_REVISION_C } from "./fixtures";

const rateText = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const REVIEW_LABEL: Record<EngineLine["reviewState"], string> = {
  needs_review: "Needs review", accepted: "Accepted · demo", corrected: "Corrected · demo", verified: "Verified · demo",
};

function quantityText(l: FlowLineResult) {
  const unit = UNIT_LABEL[l.measurement.unit];
  if (l.measurement.status === "invalid") return <QuantityCell value={null} state="BLOCKING" missingLabel="Total withheld" />;
  if (l.quantityState === "pending") return <QuantityCell value={null} state="PENDING_QTY" missingLabel="Quantity pending" />;
  return <QuantityCell value={l.measurement.total} unit={unit} />;
}

export function FlowPanel({ initialProject = FLOW_PROJECT, reviewer = DEMO_REVIEWER }: { initialProject?: FlowProject; reviewer?: string }) {
  const [project, setProject] = useState(initialProject);
  const [review, setReview] = useState<FlowReview>(emptyReview);
  const [openLine, setOpenLine] = useState<string | null>(initialProject.lines[0]?.id ?? null);
  const [revision, setRevision] = useState<{ before: EngineLine[]; changed: string[] } | null>(null);
  const result = useMemo(() => runFlow(project, review), [project, review]);
  const byId = new Map(result.lines.map((l) => [l.id, l]));
  const { signOff } = result;

  const check = (id: string, outcome: CheckOutcome) => setReview((rv) => recordCheck(rv, result, id, outcome, reviewer));
  const applyRevC = () => {
    const out = applyRevision(project, review, FLOW_REVISION_C);
    setRevision({ before: result.engineLines, changed: out.changed });
    setProject(out.project);
    setReview(out.review);
  };
  const open = openLine ? project.lines.find((l) => l.id === openLine) : undefined;

  return (
    <SurfacePanel
      title="Integrated flow"
      description="One synthetic project through every step: measure → price first → verify queue → coverage → sign-off → revision. An edit or check in any step updates the others. Demo state only; it is lost on reload."
    >
      <Notice>
        <strong>Synthetic project, illustrative ₹.</strong> Dimensions are invented. Rates are provisional DSR 2023 catalogue rates, not verified against CPWD;
        every ₹ figure is illustrative, not an estimate. A pending or withheld quantity is never priced. Any change to a line's measurement rows, rate or drawing revision resets its check.
      </Notice>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Flow summary">
        <Metric label="Lines measured" value={`${result.totals.measured} of ${result.totals.lines}`} detail={`${result.totals.pending} pending · excluded from ₹`} />
        <Metric label="Illustrative provisional subtotal" value={formatINR(result.totals.provisionalAmount)} detail={result.pricing.note} />
        <Metric label="Illustrative money at risk" value={formatINR(result.queue.totalRiskRs)} detail="Uncertainty × amount (stated assumption)" />
        <Metric label="Certification" value="Not certified" detail={`${result.blockers.length} blocker(s)`} />
      </div>

      <section aria-labelledby="flow-lines" className="space-y-2">
        <h3 id="flow-lines" className="font-semibold">Measure and price first</h3>
        <div className="relative overflow-x-auto rounded-xl border bg-card" role="region" aria-label="Flow BOQ lines" tabIndex={0}>
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Line</th>
                <th className="px-3 py-2 text-right font-medium">Measured quantity</th>
                <th className="px-3 py-2 font-medium">Rate</th>
                <th className="px-3 py-2 text-right font-medium">Illustrative amount</th>
                <th className="px-3 py-2 font-medium">Review</th>
                <th className="px-3 py-2 font-medium"><span className="sr-only">Measurements</span></th>
              </tr>
            </thead>
            <tbody>
              {result.lines.map((l) => (
                <tr key={l.id} className="border-t" data-testid={`flow-line-${l.id}`}>
                  <td className="px-3 py-2"><span className="text-xs text-muted-foreground">{l.id} · {l.sheet}</span><div>{l.description}</div></td>
                  <td className="px-3 py-2 text-right">{quantityText(l)}</td>
                  <td className="px-3 py-2 text-xs">
                    {l.pricing.kind === "provisional_dsr"
                      ? <>{rateText(l.pricing.rate)} / {l.pricing.unit} · DSR {l.pricing.code}<div className="text-muted-foreground">Provisional, not verified</div></>
                      : <span className="font-medium text-amber-900">{l.pricing.label}</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {l.amount != null ? formatINR(l.amount) : l.quantityState === "pending" ? "Not priced — quantity pending" : "Not priced — no rate"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {REVIEW_LABEL[l.engine.reviewState]}
                    {l.reset && <div className="font-medium text-amber-900">Reset: inputs changed</div>}
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" aria-expanded={openLine === l.id} onClick={() => setOpenLine((o) => (o === l.id ? null : l.id))} className="rounded border px-2 py-1 text-xs hover:bg-muted">
                      {openLine === l.id ? "Hide rows" : "Measurements"}<span className="sr-only"> for {l.id}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {open && (
          <LineTable line={open.measurement} onChange={(rowId, field, value) => setProject((p) => editMeasurement(p, open.id, rowId, field, value))} />
        )}
      </section>

      <section aria-labelledby="flow-queue" className="space-y-2">
        <h3 id="flow-queue" className="font-semibold">Verify queue — ordered by money at risk</h3>
        <ol className="overflow-hidden rounded-xl border bg-card" aria-label="Flow verify queue">
          {result.queue.ranked.map(({ line, rank, riskRs, isKey, reasons }) => {
            const l = byId.get(line.id)!;
            const pending = l.quantityState === "pending";
            return (
              <li key={line.id} className="grid gap-2 border-b p-3 last:border-b-0 lg:grid-cols-[1fr_auto] lg:items-center" data-testid={`flow-queue-${line.id}`}>
                <div className="space-y-1">
                  <div className="text-sm"><span className="text-xs font-semibold text-muted-foreground">#{rank} · {line.id}</span> {l.description}</div>
                  <div className="flex flex-wrap gap-x-4 text-xs">
                    <span>Money at risk: <strong>{riskRs == null ? (pending ? "Not computed — quantity unknown" : "Not computed — no rate") : formatINR(riskRs)}</strong></span>
                    <span>{REVIEW_LABEL[line.reviewState]}</span>
                    {isKey && <span className="font-medium text-rose-900">Key item · 100% review</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{reasons.map((r) => REASON_LABEL[r]).join(" · ")}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {pending ? (
                    <span className="text-xs text-muted-foreground">Measure first: a pending quantity cannot be reviewed</span>
                  ) : (["accepted", "corrected", "verified"] as CheckOutcome[]).map((o) => (
                    <button key={o} type="button" disabled={line.reviewState === o} onClick={() => check(line.id, o)} className="rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
                      {o === "accepted" ? "Accept" : o === "corrected" ? "Mark corrected" : "Verify against drawing"}<span className="sr-only"> {line.id}</span>
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <CoveragePanel
        gaps={result.gaps}
        reviewer={reviewer}
        onResolve={(id, r) => setReview((rv) => resolveFlowGap(rv, result, id, r))}
        onReopen={(id) => setReview((rv) => reopenFlowGap(rv, id))}
      />

      <section aria-labelledby="flow-signoff" className="space-y-3">
        <h3 id="flow-signoff" className="font-semibold">Sign-off readiness</h3>
        {signOff.plans.map(({ plan, items }, i) => {
          const e = signOff.evals[i];
          return (
            <div key={plan.pool} className="space-y-2 rounded-xl border bg-card p-4" aria-label={`Sample: ${plan.pool}`} role="group">
              <div className="text-sm font-medium">{plan.pool}</div>
              {plan.selected.length === 0 ? (
                <p className="text-sm text-muted-foreground">No checked, priced, non-key lines in this pool yet.</p>
              ) : (
                <>
                  <ul className="space-y-1">
                    {plan.selected.map((s) => {
                      const f = review.sampleFindings[s.id];
                      const current = f && f.fingerprint === byId.get(s.id)?.fingerprint;
                      return (
                        <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span>{s.id} · {formatINR(s.book)}{s.topStratum ? " · top stratum" : ""}</span>
                          {current ? (
                            <span className="text-xs text-muted-foreground">Checked: {f.found === s.book ? "no difference" : `found ${formatINR(f.found)}`} (demo)</span>
                          ) : (
                            <span className="flex gap-2">
                              <button type="button" onClick={() => setReview((rv) => recordSampleFinding(rv, result, s.id, s.book))} className="rounded border px-2 py-1 text-xs hover:bg-muted">No difference (demo)<span className="sr-only"> {s.id}</span></button>
                              <button type="button" onClick={() => setReview((rv) => recordSampleFinding(rv, result, s.id, Math.round(s.book * 0.5)))} className="rounded border px-2 py-1 text-xs hover:bg-muted">50% difference (demo)<span className="sr-only"> {s.id}</span></button>
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-sm">
                    {!e.complete ? `${e.awaiting.length} sampled line(s) awaiting a check.`
                      : e.uel == null ? "Too many differences to evaluate: review every line in the pool."
                        : `Upper error limit (95%): ${formatINR(e.uel)} — ${e.withinTolerance ? "within" : "exceeds"} the tolerable error of ${formatINR(plan.tolerableError)}.`}
                  </p>
                  {e.recommendation === "widen" && (
                    <button type="button" onClick={() => setReview((rv) => ({ ...rv, widened: { ...rv.widened, [plan.pool]: widenMus(plan, items, 0).n } }))} className="rounded-md border px-3 py-2 text-sm hover:bg-muted">
                      Widen the sample
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}
        <div className="space-y-2 rounded-xl border bg-card p-4" role="group" aria-label={`Sample: ${signOff.regionPlan.pool}`}>
          <div className="text-sm font-medium">{signOff.regionPlan.pool}</div>
          <ul className="space-y-1">
            {signOff.regionPlan.selected.map((id) => (
              <li key={id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{id}</span>
                {id in review.regionMisses ? (
                  <span className="text-xs text-muted-foreground">{review.regionMisses[id] ? "Unbilled work found" : "Nothing missed"} (demo)</span>
                ) : (
                  <span className="flex gap-2">
                    <button type="button" onClick={() => setReview((rv) => ({ ...rv, regionMisses: { ...rv.regionMisses, [id]: false } }))} className="rounded border px-2 py-1 text-xs hover:bg-muted">Nothing missed (demo)<span className="sr-only"> {id}</span></button>
                    <button type="button" onClick={() => setReview((rv) => ({ ...rv, regionMisses: { ...rv.regionMisses, [id]: true } }))} className="rounded border px-2 py-1 text-xs hover:bg-muted">Unbilled work (demo)<span className="sr-only"> {id}</span></button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <aside className="space-y-2 rounded-xl border bg-card p-4">
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-950">Not certified</div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground" aria-label="Flow blockers">
            {result.blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
          <button type="button" disabled className="w-full cursor-not-allowed rounded-md border px-3 py-2 text-sm text-muted-foreground opacity-70">
            Certification unavailable
          </button>
        </aside>
      </section>

      <section aria-labelledby="flow-revision" className="space-y-3">
        <h3 id="flow-revision" className="font-semibold">Drawing revision</h3>
        <p className="text-sm text-muted-foreground">
          Current drawing revision: <strong>{project.drawingRevision}</strong>.
          {revision
            ? ` Revision applied: ${revision.changed.length} line(s) changed (${revision.changed.join(", ") || "none"}); only their checks reset.`
            : " Synthetic revision C changes the trench depth on A-102. Applying it resets only the lines whose inputs change."}
        </p>
        {!revision && (
          <button type="button" onClick={applyRevC} className="rounded-md border px-3 py-2 text-sm hover:bg-muted">
            Apply synthetic revision C
          </button>
        )}
        {revision && <RevisionDeltaPanel revisionA={revision.before} current={result.engineLines} />}
      </section>

    </SurfacePanel>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 text-xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

export default FlowPanel;
