// Persistent result of the last Apply-to-BOQ on the Review screen (see
// lib/review/applyReceipt). Stays until dismissed, so the outcome — and any
// warning about unaudited lines or changed drawings — is never lost to a toast.
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApplyReceipt } from "@/lib/review/applyReceipt";

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export default function ApplyReceiptPanel({ receipt, onViewBoq, onDismiss }: {
  receipt: ApplyReceipt; onViewBoq: () => void; onDismiss: () => void;
}) {
  const failed = receipt.failedCount ?? 0;
  const warn = failed > 0 || receipt.unauditedCount > 0 || receipt.conflictedCount > 0 || receipt.revisionChanged.length > 0;
  return (
    <section aria-labelledby="apply-receipt-title"
      className={warn
        ? "rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50"
        : "rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-50"}>
      <div className="flex items-start gap-2">
        {warn ? <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />}
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id="apply-receipt-title" className="font-semibold">
            Applied {n(receipt.appliedCount, "change")} to the BOQ <span className="font-normal">· {when(receipt.appliedAt)}</span>
          </h2>
          <p>
            {n(receipt.reviewedCount, "item")} reviewed · {receipt.verifiedCount} verified · {receipt.correctedCount} corrected
            {receipt.unresolvedCount > 0 && ` · ${receipt.unresolvedCount} not applied (unresolved)`}
          </p>
          {failed > 0 && (
            <p role="alert">Apply stopped part-way: {n(failed, "item")} {failed === 1 ? "was" : "were"} not written{receipt.failureMessage ? ` (${receipt.failureMessage})` : ""}. The {n(receipt.appliedCount, "change")} above {receipt.appliedCount === 1 ? "is" : "are"} saved. Apply again to finish — items already applied are not applied twice.</p>
          )}
          {receipt.conflictedCount > 0 && (
            <p>{n(receipt.conflictedCount, "item")} not applied because the BOQ line changed while applying. Review them again.</p>
          )}
          {receipt.unauditedCount > 0 && (
            <p>Change history was NOT recorded for {n(receipt.unauditedCount, "item")}. The quantities are saved.</p>
          )}
          {receipt.revisionChanged.length > 0 && (
            <p>A source drawing changed while applying ({receipt.revisionChanged.join(", ")}). The applied lines record the revision that was analysed. Re-analyse before applying anything else.</p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" className="h-7 bg-background" onClick={onViewBoq}>View updated BOQ</Button>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onDismiss} aria-label="Dismiss apply result">
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
