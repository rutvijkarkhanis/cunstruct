// Working-BOQ status: Draft ⇄ Finalized, persisted in the existing boq.status
// column. "Finalized" only means the working BOQ has been finalized
// internally — it is NOT sent to a client, awarded or executed. "sent" is a
// value the schema allows but this app never records, so it is shown if
// present and never offered.
//
// The update touches ONLY boq.status (no line, quantity, unit, description or
// rate), and is conditional on the status the user saw (compare-and-swap), so
// a change made elsewhere in the meantime is never silently overwritten.
// Afterwards the persisted value is always re-read.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BOQ_STATUS_HELP, boqStatusLabel, nextBoqStatus, saveBoqStatus } from "@/lib/boqStatus";

export default function BoqStatusControl({ boqId, status, readOnly, onPersisted }: {
  boqId: string;
  status: string | null;
  readOnly?: boolean;
  /** Re-read the persisted BOQ (always called after an attempt, success or not). */
  onPersisted: () => Promise<unknown> | void;
}) {
  const [saving, setSaving] = useState(false);
  const next = nextBoqStatus(status);

  const change = async () => {
    if (!status || !next) return;
    setSaving(true);
    try {
      const result = await saveBoqStatus(boqId, status, next);
      if (result === "conflict") toast.error("The BOQ's status was changed elsewhere. Showing the saved status.");
      else toast.success(next === "finalized" ? "BOQ finalized (internal only — not sent to a client)" : "BOQ returned to draft");
    } catch (e) {
      // Supabase errors are plain { message } objects, not always Error instances.
      const message = (e as { message?: unknown } | null)?.message;
      toast.error(`Couldn't change the BOQ status: ${typeof message === "string" && message ? message : "unknown error"}`);
    } finally {
      await onPersisted();
      setSaving(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5" data-testid="boq-status">
      <Badge variant={status === "finalized" ? "default" : "outline"} title={status ? BOQ_STATUS_HELP[status] : undefined}>
        {boqStatusLabel(status)}
      </Badge>
      {!readOnly && next && (
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={saving} onClick={change}
          title={next === "finalized" ? BOQ_STATUS_HELP.finalized : "Reopen the working BOQ for changes. Existing revisions are not affected."}>
          {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          {next === "finalized" ? "Mark finalized" : "Return to draft"}
        </Button>
      )}
    </span>
  );
}
