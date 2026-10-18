// Sign-off sheet (B7 logic, preview only): sampling plan and evaluation from
// src/lib/preview/sampling.ts over the demo lines. The preview never certifies.
import { useMemo, useState } from "react";
import { formatINR } from "@/design/money";
import { coverageStatus, type CoverageGap } from "@/lib/preview/coverage";
import {
  allocateTolerable, buildPools, evaluateAttribute, evaluateMus, planAttribute, planMus, signOffBlockers, widenMus,
  type MusFinding, type MusPlan,
} from "@/lib/preview/sampling";
import type { EngineLine } from "@/lib/preview/types";
import { SurfacePanel } from "./shared";

export function SignOffPanel({ lines, gaps, noDetectionRegionIds, materiality, tolerableError, seed, reviewer, drawingRevision }: {
  lines: EngineLine[];
  gaps: CoverageGap[];
  noDetectionRegionIds: string[];
  materiality: number;
  tolerableError: number;
  seed: number;
  reviewer: string;
  drawingRevision: string;
}) {
  const pools = useMemo(() => buildPools(lines, materiality), [lines, materiality]);
  const [teAccepted, teVerified] = allocateTolerable(tolerableError, [pools.acceptedNonKey, pools.verified]);
  const [widened, setWidened] = useState<Record<string, number>>({});
  const [findings, setFindings] = useState<Record<string, number>>({});
  const [regionMisses, setRegionMisses] = useState<Record<string, boolean>>({});

  const plans: { plan: MusPlan; items: typeof pools.acceptedNonKey }[] = [
    { items: pools.acceptedNonKey, plan: planMus("Accepted non-key lines", pools.acceptedNonKey, teAccepted || tolerableError, seed, widened["Accepted non-key lines"]) },
    { items: pools.verified, plan: planMus("Verified lines", pools.verified, teVerified || tolerableError, seed + 1, widened["Verified lines"]) },
  ];
  const evals = plans.map(({ plan }) => evaluateMus(plan, Object.entries(findings).map(([id, found]): MusFinding => ({ id, found }))));
  const regionPlan = planAttribute("No-detection regions", noDetectionRegionIds, 0.1, seed + 2);
  const regionEval = evaluateAttribute(regionPlan, regionMisses);
  const allEvaluated = evals.every((e) => e.complete) && regionEval.complete;
  const allWithin = evals.every((e) => e.withinTolerance !== false) && regionEval.passed !== false;
  const keyUnverified = lines.filter((l) => pools.keyIds.includes(l.id) && l.reviewState !== "verified").length;
  const coverage = coverageStatus(gaps);
  const blockers = signOffBlockers({
    keyItemsUnverified: keyUnverified,
    pendingQuantities: pools.blocked.pending.length,
    linesWithoutRate: pools.blocked.noRate.length,
    coverageCleared: coverage.cleared,
    sampling: { evaluated: allEvaluated, withinTolerance: allEvaluated ? allWithin : null },
    previewMode: true,
  });

  return (
    <SurfacePanel
      title="Sign-off sheet"
      description="Sampling plan and evaluation over the demo lines. Checks below are demo entries kept in this page only; no certificate is created."
    >
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="border-b p-4">
              <h3 className="font-semibold">Pre-certification checklist</h3>
              <p className="mt-1 text-sm text-muted-foreground">Computed from the demo state.</p>
            </div>
            {[
              ["Key lines", `${pools.keyIds.length} key item(s) at or above ${formatINR(materiality)}; ${keyUnverified} not yet verified (100% review)`],
              ["Coverage gaps", `${coverage.open} open, ${coverage.resolved} resolved, ${coverage.excluded} excluded with a reason`],
              ["Pending quantities", `${pools.blocked.pending.length} line(s) remain pending`],
              ["Reference comparison", "No independent reference set loaded"],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-wrap items-center justify-between gap-2 border-b p-4 last:border-b-0">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-sm text-muted-foreground">{value}</span>
              </div>
            ))}
          </div>

          {plans.map(({ plan, items }, i) => {
            const e = evals[i];
            return (
              <div key={plan.pool} className="space-y-2 rounded-xl border bg-card p-4">
                <h3 className="font-semibold">{plan.pool}</h3>
                {plan.selected.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No priced lines in this pool.</p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Book value {formatINR(plan.bookValue)} · tolerable error {formatINR(plan.tolerableError)} ·{" "}
                      {plan.fullReview ? "every line is checked (the sample would cover the pool)" : `n = ${plan.n}, interval ${formatINR(plan.interval)}`}
                    </p>
                    <ul className="space-y-1">
                      {plan.selected.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span>{s.id} · {formatINR(s.book)}{s.topStratum ? " · top stratum" : ""}</span>
                          <span className="flex gap-2">
                            {s.id in findings ? (
                              <span className="text-xs text-muted-foreground">Checked: {findings[s.id] === s.book ? "no difference" : `found ${formatINR(findings[s.id])}`} (demo)</span>
                            ) : (
                              <>
                                <button type="button" onClick={() => setFindings((f) => ({ ...f, [s.id]: s.book }))} className="rounded border px-2 py-1 text-xs hover:bg-muted">No difference (demo)</button>
                                <button type="button" onClick={() => setFindings((f) => ({ ...f, [s.id]: Math.round(s.book * 0.9) }))} className="rounded border px-2 py-1 text-xs hover:bg-muted">10% difference (demo)</button>
                              </>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-sm">
                      {!e.complete
                        ? `${e.awaiting.length} sampled line(s) awaiting a check.`
                        : e.uel == null
                          ? "Too many differences to evaluate: review every line in the pool."
                          : `Upper error limit (95%): ${formatINR(e.uel)} — ${e.withinTolerance ? "within" : "exceeds"} the tolerable error.`}
                    </p>
                    {e.recommendation === "widen" && (
                      <button type="button" onClick={() => setWidened((w) => ({ ...w, [plan.pool]: widenMus(plan, items, 0).n }))} className="rounded-md border px-3 py-2 text-sm hover:bg-muted">
                        Widen the sample
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}

          <div className="space-y-2 rounded-xl border bg-card p-4">
            <h3 className="font-semibold">{regionPlan.pool}</h3>
            <p className="text-sm text-muted-foreground">
              {regionPlan.m} of {regionPlan.population} region(s) sampled; any region found to contain unbilled work fails the pool.
            </p>
            <ul className="space-y-1">
              {regionPlan.selected.map((id) => (
                <li key={id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{id}</span>
                  {id in regionMisses ? (
                    <span className="text-xs text-muted-foreground">{regionMisses[id] ? "Unbilled work found" : "Nothing missed"} (demo)</span>
                  ) : (
                    <span className="flex gap-2">
                      <button type="button" onClick={() => setRegionMisses((m) => ({ ...m, [id]: false }))} className="rounded border px-2 py-1 text-xs hover:bg-muted">Nothing missed (demo)</button>
                      <button type="button" onClick={() => setRegionMisses((m) => ({ ...m, [id]: true }))} className="rounded border px-2 py-1 text-xs hover:bg-muted">Unbilled work (demo)</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <details className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">Method and assumptions</summary>
            <p className="mt-2">
              Monetary-unit sampling at 95% confidence with zero expected errors (n = ⌈book value × 3.0 ÷ tolerable error⌉), systematic selection from a seeded start;
              upper error limit from Poisson factors. Tolerable error is split between pools by book value. Regions use attribute sampling (10% tolerable miss rate).
              Key items, pending quantities and lines with no DSR match are never sampled. Reviewer {reviewer}; drawing revision {drawingRevision}; a change to a line's inputs or the revision resets its check.
            </p>
          </details>
        </div>

        <aside className="space-y-3 rounded-xl border bg-card p-5">
          <div className="text-sm font-semibold">Certification status</div>
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-950">
            Not certified
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground" aria-label="Blockers">
            {blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
          <button type="button" disabled className="w-full cursor-not-allowed rounded-md border px-3 py-2 text-sm text-muted-foreground opacity-70">
            Certification unavailable
          </button>
        </aside>
      </div>
    </SurfacePanel>
  );
}
