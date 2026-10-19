// B10 (b): call-offs against certified lines, from the B11 preview plan.
import { useState } from "react";
import { formatQuantity } from "@/design/money";
import type { PreviewProcurementPlan } from "@/lib/procurement";
import { t, type Locale } from "./messages";
import type { QueuedActionKind } from "./offlineQueue";

export function CallOffList({
  locale, plan, onQueue,
}: {
  locale: Locale;
  plan: PreviewProcurementPlan;
  onQueue: (kind: QueuedActionKind, payload: Record<string, string | number | null>) => void;
}) {
  const [queued, setQueued] = useState<Set<string>>(new Set());
  const { callOffs } = plan.phasing;
  const { notProcurable } = plan.requirements;

  return (
    <section className="space-y-3" aria-labelledby="calloffs-title">
      <h3 id="calloffs-title" className="text-base font-semibold">{t(locale, "calloffsTitle")}</h3>
      {callOffs.map((c) => (
        <article key={c.id} className="space-y-2 rounded-lg border bg-card p-3 text-sm">
          <div className="font-semibold">{c.id}</div>
          <div className="text-xs text-muted-foreground">{t(locale, "neededWeek", { week: c.needWeek, placeBy: c.placeByWeek })}</div>
          <div className="text-xs">{t(locale, "toDealer", { dealer: c.dealer.name })}</div>
          <ul className="space-y-1">
            {c.items.map((i) => (
              <li key={`${i.materialKey}|${i.unit}`} className="flex justify-between gap-2">
                <span>
                  {i.material}
                  {i.illustrative && <span className="ml-1 text-[11px] text-amber-900">({t(locale, "illustrative")})</span>}
                </span>
                <span className="shrink-0 tabular-nums">{formatQuantity(i.quantity, 3)} {i.unit}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="min-h-11 w-full rounded-md border px-3 font-medium disabled:opacity-60"
            disabled={queued.has(c.id)}
            onClick={() => {
              onQueue("calloff_queue", { callOff: c.id, needWeek: c.needWeek, dealer: c.dealer.id });
              setQueued((s) => new Set(s).add(c.id));
            }}
          >
            {queued.has(c.id) ? t(locale, "calloffQueued") : t(locale, "queueCalloff")}
          </button>
        </article>
      ))}
      <div className="rounded-lg border p-3 text-sm">
        <div className="font-medium">{t(locale, "notProcurable")}</div>
        <ul className="mt-1 space-y-1">
          {notProcurable.map((n) => (
            <li key={n.lineId}>{n.lineId} · {n.description} — {n.reason}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
