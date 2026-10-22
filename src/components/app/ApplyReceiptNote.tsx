// The result of the last Apply-to-BOQ for this BOQ, exactly as the review
// screen recorded it (lib/review/applyReceipt — this browser tab only), with
// where to continue. Shown on the journey's Review and Build BOQ steps so the
// outcome of Apply is still visible after returning from the review screen.
// Absent = nothing recorded in this tab; it never claims more than the receipt
// holds (no receipt is not "not applied", and a receipt is not an audit record).
import { Link } from "react-router-dom";
import { loadReceipt } from "@/lib/review/applyReceipt";
import { journeyPath } from "@/lib/app/journey";
import { useStepLink } from "./useStepLink";

const time = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function ApplyReceiptNote({ projectId, boqId, currentRunId, here }: {
  projectId: string; boqId: string;
  /** The BOQ's latest analysis run, when known: a receipt from another run is labelled as such. */
  currentRunId?: string | null;
  /** The step this note is shown on — its own link is left out. */
  here: "review" | "boq";
}) {
  const step = useStepLink();
  const r = loadReceipt(boqId);
  if (!r) return null;
  const earlier = currentRunId != null && r.runId !== currentRunId;
  const parts = [`${r.appliedCount} item${r.appliedCount === 1 ? "" : "s"} applied`];
  if (r.correctedCount) parts.push(`${r.correctedCount} from corrected items`);
  if (r.failedCount) parts.push(`stopped part-way — ${r.failedCount} not written`);
  if (r.unresolvedCount) parts.push(`${r.unresolvedCount} not applied (unresolved)`);
  if (r.conflictedCount) parts.push(`${r.conflictedCount} refused because the line changed`);
  if (r.unauditedCount) parts.push(`change history not recorded for ${r.unauditedCount}`);
  const followUp = r.unresolvedCount + r.conflictedCount;
  return (
    <div role="status" aria-label="Last Apply result" className="rounded-md border px-3 py-2 text-sm space-y-1">
      <p>
        Last applied from review in this browser tab, {time(r.appliedAt)}{earlier ? " (from an earlier analysis of this BOQ)" : ""}: {parts.join(" · ")}.
      </p>
      <p className="flex flex-wrap gap-x-4">
        {here !== "boq" && <Link className="underline" to={step(journeyPath(projectId, "boq", boqId))}>See the updated BOQ</Link>}
        {followUp > 0 && here !== "review" && <Link className="underline" to={step(journeyPath(projectId, "review", boqId))}>Resolve the {followUp} not applied in Review quantities</Link>}
        {followUp === 0 && <Link className="underline" to={step(journeyPath(projectId, "check", boqId))}>Continue to Check &amp; finalise</Link>}
      </p>
    </div>
  );
}
