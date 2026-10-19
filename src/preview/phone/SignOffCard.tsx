// B10 (a): owner sign-off approval card, phone width. Illustrative fixture.
import { useState } from "react";
import { formatINRCompact } from "@/design/money";
import { t, type Locale } from "./messages";
import type { SignOffFixture } from "./fixtures";
import type { QueuedActionKind } from "./offlineQueue";

export function SignOffCard({
  locale, data, onQueue,
}: {
  locale: Locale;
  data: SignOffFixture;
  onQueue: (kind: QueuedActionKind, payload: Record<string, string | number | null>) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState(false);
  const [decision, setDecision] = useState<"approved" | "returned" | null>(null);

  const approve = () => {
    onQueue("signoff_approve", { project: data.project });
    setDecision("approved");
    setError(false);
  };
  const giveBack = () => {
    if (!reason.trim()) { setError(true); return; }
    onQueue("signoff_return", { project: data.project, reason: reason.trim() });
    setDecision("returned");
    setError(false);
  };

  return (
    <article className="space-y-3 rounded-lg border bg-card p-3" aria-labelledby="signoff-title">
      <h3 id="signoff-title" className="text-base font-semibold">{t(locale, "signoffTitle")}</h3>
      <div className="text-sm font-medium">{data.project}</div>
      <p className="text-sm">{data.summary}</p>
      <div>
        <div className="text-xs text-muted-foreground">{t(locale, "signoffRange")}</div>
        <div className="text-xl font-semibold tabular-nums" data-testid="signoff-range">
          {formatINRCompact(data.lowInr)} – {formatINRCompact(data.highInr)}
        </div>
        <p className="text-xs text-muted-foreground">{t(locale, "signoffRangeNote")}</p>
        <p className="text-xs">{t(locale, "signoffPending", { count: data.pendingLines })}</p>
      </div>
      <div>
        <div className="text-sm font-medium">{t(locale, "keyRisks")}</div>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {data.risks.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </div>
      <label className="block text-sm">
        <span className="font-medium">{t(locale, "returnReason")}</span>
        <textarea
          className="mt-1 block w-full rounded-md border p-2 text-sm"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={error}
        />
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{t(locale, "returnReasonRequired")}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="min-h-11 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" onClick={approve}>
          {t(locale, "approve")}
        </button>
        <button type="button" className="min-h-11 rounded-md border px-3 text-sm font-medium" onClick={giveBack}>
          {t(locale, "returnForChanges")}
        </button>
      </div>
      {decision && (
        <p role="status" className="text-sm">
          {t(locale, "decisionQueued", { decision: t(locale, decision === "approved" ? "decisionApproved" : "decisionReturned") })}
        </p>
      )}
    </article>
  );
}
