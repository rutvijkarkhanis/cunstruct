// Plan B11 (preview lane): procurement from the BOQ. Deterministic fixtures and
// repository-seed coefficients only; nothing is read from or written to a
// database, and nothing is sent to a dealer.
import { useMemo } from "react";
import { formatQuantity } from "@/design/money";
import { buildPreviewProcurementPlan, PREVIEW_LEAD_WEEKS, PREVIEW_TOLERANCE_PCT, type CoefficientSource, type ReconcileStatus } from "@/lib/procurement";
import { Notice, SurfacePanel } from "@/preview/shared";

const STATUS_LABEL: Record<ReconcileStatus, string> = {
  within_tolerance: "Within tolerance",
  over_issue: "Over-issue",
  under_issue: "Under-issue",
  unmatched_issue: "Issued, no matching work",
};

function sourceLabel(s: CoefficientSource): string {
  if (s.kind === "illustrative_fixture") return "Illustrative fixture";
  return `${s.dataset}, ${s.file.split("/").pop()} line ${s.lines.join(", ")} — not verified`;
}

const IllustrativeTag = () => (
  <span className="ml-1 rounded border border-amber-300 bg-amber-50 px-1 text-[11px] font-medium text-amber-900">illustrative fixture</span>
);

export function ProcurementPanel() {
  const plan = useMemo(() => buildPreviewProcurementPlan(), []);
  const { requirements, phasing, reconciliation } = plan;

  return (
    <SurfacePanel
      title="Procurement"
      description="Certified BOQ lines × material coefficients → requirement per material → weekly call-offs to the contractor's own dealer, then issued-vs-work-done reconciliation (plan B11, preview only)."
    >
      <Notice>
        BOQ lines, schedule, dealer, lead time ({PREVIEW_LEAD_WEEKS} week), tolerance (±{PREVIEW_TOLERANCE_PCT}%), work done and issues are
        illustrative fixtures. Coefficients marked “DAR 2023 (repository seed)” are copied from the repository’s transcribed seed and are not
        verified against the published DAR; all others are illustrative fixtures. Nothing is ordered or sent.
      </Notice>

      <section aria-labelledby="proc-req" className="space-y-2">
        <h3 id="proc-req" className="text-base font-semibold">Material requirement</h3>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="p-2">Material</th><th className="p-2 text-right">Quantity</th><th className="p-2">From lines</th><th className="p-2">Coefficient source</th></tr>
            </thead>
            <tbody>
              {requirements.materials.map((m) => (
                <tr key={`${m.materialKey}|${m.unit}`} className="border-t">
                  <td className="p-2">{m.material}{m.illustrative && <IllustrativeTag />}</td>
                  <td className="p-2 text-right tabular-nums">{formatQuantity(m.quantity, 3)} {m.unit}</td>
                  <td className="p-2">{m.contributions.map((c) => c.lineId).join(", ")}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {[...new Set(m.contributions.map((c) => sourceLabel(c.source)))].join(" · ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="proc-np" className="space-y-2">
        <h3 id="proc-np" className="text-base font-semibold">Not procurable yet</h3>
        <ul className="space-y-1 text-sm">
          {requirements.notProcurable.map((n) => (
            <li key={n.lineId} className="rounded border p-2">
              <span className="font-medium">{n.lineId} · {n.description}</span> — {n.reason}{" "}
              <span className="text-muted-foreground">(no quantity, no amount)</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="proc-co" className="space-y-2">
        <h3 id="proc-co" className="text-base font-semibold">Call-offs</h3>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {phasing.callOffs.map((c) => (
            <article key={c.id} className="rounded-lg border p-3 text-sm">
              <div className="font-semibold">{c.id} · needed week {c.needWeek}</div>
              <div className="text-xs text-muted-foreground">Place by week {c.placeByWeek} · to {c.dealer.name}</div>
              <ul className="mt-2 space-y-1">
                {c.items.map((i) => (
                  <li key={`${i.materialKey}|${i.unit}`} className="flex justify-between gap-2">
                    <span>{i.material}{i.illustrative && <IllustrativeTag />}</span>
                    <span className="tabular-nums">{formatQuantity(i.quantity, 3)} {i.unit}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        {phasing.unscheduled.length > 0 && (
          <p className="text-sm">Unscheduled: {phasing.unscheduled.map((u) => `${u.lineId} (${u.reason})`).join(", ")}</p>
        )}
      </section>

      <section aria-labelledby="proc-rec" className="space-y-2">
        <h3 id="proc-rec" className="text-base font-semibold">Reconciliation — issued vs work done</h3>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2">Material</th><th className="p-2 text-right">Theoretical</th><th className="p-2 text-right">Issued</th>
                <th className="p-2 text-right">Variance</th><th className="p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {reconciliation.rows.map((r) => (
                <tr key={`${r.materialKey}|${r.unit}`} className="border-t">
                  <td className="p-2">{r.material}{r.illustrative && <IllustrativeTag />}</td>
                  <td className="p-2 text-right tabular-nums">{formatQuantity(r.theoretical, 3)} {r.unit}</td>
                  <td className="p-2 text-right tabular-nums">{formatQuantity(r.issued, 3)} {r.unit}</td>
                  <td className="p-2 text-right tabular-nums">{r.variancePct == null ? "—" : `${r.variancePct > 0 ? "+" : ""}${r.variancePct}%`}</td>
                  <td className="p-2" data-status={r.status}>{STATUS_LABEL[r.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {reconciliation.warnings.map((w) => (
          <p key={`${w.lineId}-${w.code}`} className="text-sm text-muted-foreground">{w.lineId}: {w.message}</p>
        ))}
      </section>
    </SurfacePanel>
  );
}

export default ProcurementPanel;
