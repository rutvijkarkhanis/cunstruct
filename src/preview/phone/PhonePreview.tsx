// Plan B10 (preview lane): mobile-first phone surfaces at 360 px — owner
// sign-off, call-offs, site measurement, WhatsApp share link. Offline-first:
// actions are queued on this device (localStorage, wrapped in try/catch) and
// shown as "pending sync"; there is no sync target, so nothing is ever sent.
// All UI strings go through the message catalogue (en + hi stub).
import { useMemo, useState } from "react";
import { buildPreviewProcurementPlan } from "@/lib/procurement";
import { CallOffList } from "./CallOffList";
import { PREVIEW_SIGNOFF } from "./fixtures";
import { t, type Locale, type MessageKey } from "./messages";
import { appendAction, defaultStorage, loadQueue, saveQueue, type QueuedAction, type QueuedActionKind, type StorageLike } from "./offlineQueue";
import { ShareLinkBuilder } from "./ShareLinkBuilder";
import { SignOffCard } from "./SignOffCard";
import { SiteMeasureEntry } from "./SiteMeasureEntry";

type View = "signoff" | "calloffs" | "measure" | "share";
const VIEWS: { id: View; key: MessageKey }[] = [
  { id: "signoff", key: "navSignoff" },
  { id: "calloffs", key: "navCalloffs" },
  { id: "measure", key: "navMeasure" },
  { id: "share", key: "navShare" },
];

export function PhonePreview({ storage = defaultStorage() }: { storage?: StorageLike | null }) {
  const [locale, setLocale] = useState<Locale>("en");
  const [view, setView] = useState<View>("signoff");
  const [queue, setQueue] = useState<QueuedAction[]>(() => loadQueue(storage));
  const [persisted, setPersisted] = useState(storage != null);
  const plan = useMemo(() => buildPreviewProcurementPlan(), []);

  const enqueue = (kind: QueuedActionKind, payload: QueuedAction["payload"]) => {
    const next = appendAction(queue, kind, payload);
    setPersisted(saveQueue(storage, next));
    setQueue(next);
  };
  const discard = () => {
    setPersisted(saveQueue(storage, []));
    setQueue([]);
  };

  const firstCallOff = plan.phasing.callOffs[0];
  const shareDefault = firstCallOff
    ? t(locale, "shareDefault", { id: firstCallOff.id, week: firstCallOff.needWeek })
    : "";

  return (
    <div
      data-testid="phone-frame"
      lang={locale}
      className="mx-auto w-full max-w-[360px] space-y-3 rounded-2xl border-4 border-foreground/20 bg-background p-3 text-foreground"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t(locale, "title")}</h2>
        <div role="group" aria-label={t(locale, "language")} className="flex gap-1">
          {(["en", "hi"] as const).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={locale === l}
              lang={l}
              onClick={() => setLocale(l)}
              className={`min-h-9 min-w-9 rounded-md border px-2 text-sm ${locale === l ? "bg-primary text-primary-foreground" : ""}`}
            >
              {l === "en" ? "EN" : "हिं"}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t(locale, "frameNote")}</p>

      <div role="status" aria-live="polite" data-testid="sync-state" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
        {queue.length > 0 ? (
          <>
            <div className="font-semibold">{t(locale, "pendingSync")}</div>
            <div>{t(locale, "pendingCount", { count: queue.length })}</div>
          </>
        ) : (
          <div>{t(locale, "queueEmpty")}</div>
        )}
        {!persisted && <div>{t(locale, "storageUnavailable")}</div>}
        {queue.length > 0 && (
          <button type="button" className="mt-1 min-h-9 underline" onClick={discard}>
            {t(locale, "discardQueue")}
          </button>
        )}
      </div>

      <nav aria-label={t(locale, "title")} className="grid grid-cols-4 gap-1">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-current={view === v.id ? "page" : undefined}
            onClick={() => setView(v.id)}
            className={`min-h-11 rounded-md border px-1 text-xs font-medium ${view === v.id ? "bg-primary text-primary-foreground" : ""}`}
          >
            {t(locale, v.key)}
          </button>
        ))}
      </nav>

      {view === "signoff" && <SignOffCard locale={locale} data={PREVIEW_SIGNOFF} onQueue={enqueue} />}
      {view === "calloffs" && <CallOffList locale={locale} plan={plan} onQueue={enqueue} />}
      {view === "measure" && <SiteMeasureEntry locale={locale} onQueue={enqueue} />}
      {view === "share" && <ShareLinkBuilder locale={locale} defaultMessage={shareDefault} />}
    </div>
  );
}

export default PhonePreview;
