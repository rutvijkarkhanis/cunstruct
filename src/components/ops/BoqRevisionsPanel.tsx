// Commercial revisions for one BOQ: freeze the current working BOQ as an
// immutable revision (after reviewing its status and limitations), and export
// any saved revision from its own snapshot. The working BOQ is never locked or
// changed. A revision means "frozen/issued by X at T" — not sent, awarded or
// executed; none of those events is recorded here.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Eye, FileDown, FileText, Lock, Sheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { useRateAdoption } from "@/hooks/useRateAdoption";
import { useBoqRevisions, REVISIONS_UNAVAILABLE_MESSAGE, type RevisionHeaderDraft } from "@/hooks/useBoqRevisions";
import RevisionViewer from "@/components/ops/RevisionViewer";
import { BOQ_STATUS_HELP, boqStatusLabel } from "@/lib/boqStatus";
import {
  assessRevisionLimitations, limitationText, snapshotSignature, type AdoptionRef, type RevisionLine,
} from "@/lib/boqRevision";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

export interface RevisionSnapshot {
  header: Omit<RevisionHeaderDraft, "limitations" | "limitations_acknowledged" | "issue_note">;
  lines: RevisionLine[];
}

export interface RevisionDraftSource {
  boqStatus: string | null;
  /** Builds the snapshot from the working BOQ's persisted data at the moment it's called. */
  build: (adoptions: AdoptionRef[]) => RevisionSnapshot | Promise<RevisionSnapshot>;
  /** Current working grand total, to flag revisions the BOQ has since moved away from. */
  workingGrandTotal: number;
}

export default function BoqRevisionsPanel({ boqId, source }: { boqId: string; source: RevisionDraftSource }) {
  const { user } = useAuth();
  const { revisions, available, busy, createRevision, exportRevision } = useBoqRevisions(boqId);
  const adoption = useRateAdoption(boqId);
  const [draft, setDraft] = useState<RevisionSnapshot | null>(null);
  const [building, setBuilding] = useState(false);
  /** Set when the BOQ changed between preview and Freeze; the preview was refreshed instead of freezing. */
  const [refreshed, setRefreshed] = useState(false);
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const openRevision = revisions.find((r) => r.id === openId) ?? null;
  // The working BOQ in snapshot shape — used ONLY to show what has changed
  // since a revision; never written to or merged into one.
  const [workingLines, setWorkingLines] = useState<RevisionLine[]>([]);
  useEffect(() => {
    if (!openRevision) return;
    let live = true;
    Promise.resolve(source.build(adoption.records as AdoptionRef[]))
      .then((snap) => { if (live) setWorkingLines(snap.lines); })
      .catch(() => { if (live) setWorkingLines([]); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt when a revision is opened or the working total moves
  }, [openRevision?.id, source.workingGrandTotal, adoption.records]);
  const issuerLabel = (id: string) => (id === user?.id ? "you" : id.slice(0, 8));

  const limitations = draft
    ? assessRevisionLimitations(draft.lines, { boqStatus: source.boqStatus, adoptionRecordsAvailable: adoption.adoptionAvailable })
    : [];
  const canFreeze = !!draft && available && !busy && !building && (limitations.length === 0 || ack);

  const snapshotNow = async (): Promise<RevisionSnapshot | null> => {
    setBuilding(true);
    try {
      return await source.build(adoption.records as AdoptionRef[]);
    } catch (e) {
      toast.error(`Couldn't read the current BOQ: ${(e as { message?: string } | null)?.message ?? "unknown error"}`);
      return null;
    } finally { setBuilding(false); }
  };

  const prepare = async () => {
    const snap = await snapshotNow();
    if (!snap) return;
    setDraft(snap);
    setAck(false);
    setRefreshed(false);
  };

  // Freeze exactly what the user previewed — or nothing. The BOQ stays
  // editable while this panel is open, so re-read it now; if it no longer
  // matches the preview, show the current figures and ask again.
  const freeze = async () => {
    if (!draft) return;
    const current = await snapshotNow();
    if (!current) return;
    if (snapshotSignature(current) !== snapshotSignature(draft)) {
      setDraft(current);
      setAck(false);
      setRefreshed(true);
      return;
    }
    const currentLimitations = assessRevisionLimitations(current.lines, { boqStatus: source.boqStatus, adoptionRecordsAvailable: adoption.adoptionAvailable });
    const id = await createRevision({
      ...current.header, limitations: currentLimitations,
      limitations_acknowledged: currentLimitations.length === 0 || ack, issue_note: note.trim() || null,
    }, current.lines);
    if (id) { setDraft(null); setNote(""); setAck(false); setRefreshed(false); }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Lock className="h-4 w-4" />Commercial revisions</CardTitle>
        <p className="text-xs text-muted-foreground">
          A revision freezes this BOQ's lines, quantities, rates, amounts and sources exactly as they are now. The working BOQ stays
          editable, and later edits never change a saved revision. Freezing records who issued it and when — it does not record that it
          was sent to a client, awarded or executed.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs" data-testid="working-status">
          Working BOQ status: <span className="font-medium">{boqStatusLabel(source.boqStatus)}</span>
          {source.boqStatus && BOQ_STATUS_HELP[source.boqStatus] ? ` — ${BOQ_STATUS_HELP[source.boqStatus]}` : ""}
          {" "}A revision keeps the status it had when frozen; changing it later doesn't alter saved revisions.
        </p>
        {!available && <p className="text-xs text-destructive">{REVISIONS_UNAVAILABLE_MESSAGE}</p>}

        {!draft ? (
          <Button size="sm" onClick={prepare} disabled={!available || building}>Prepare a new revision…</Button>
        ) : (
          <section role="region" aria-label="New revision" className="rounded-md border-2 border-primary/40 p-3 space-y-3">
            {refreshed && (
              <p role="alert" className="text-xs font-medium text-amber-700 dark:text-amber-400">
                The BOQ changed after you prepared this revision, so nothing was frozen. These are the current figures — review them and confirm again.
              </p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              <div><div className="text-[11px] text-muted-foreground">BOQ status</div>{boqStatusLabel(source.boqStatus)}</div>
              <div><div className="text-[11px] text-muted-foreground">Works total</div>{inr(draft.header.works_total)}</div>
              <div><div className="text-[11px] text-muted-foreground">Grand total</div><span data-testid="draft-grand-total">{inr(draft.header.grand_total)}</span></div>
              <div><div className="text-[11px] text-muted-foreground">Priced lines</div>{draft.header.priced_line_count} of {draft.lines.length}</div>
            </div>
            {limitations.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs font-medium inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" />This revision will be saved with these limitations recorded on it:
                </p>
                <ul className="list-disc pl-5 text-xs" aria-label="Revision limitations">
                  {limitations.map((l) => <li key={l.code}>{limitationText(l)}</li>)}
                </ul>
                <label className="flex items-start gap-2 text-xs">
                  <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  I understand these limitations and want to freeze the BOQ as it stands.
                </label>
              </div>
            ) : <p className="text-xs text-muted-foreground">No pricing or quantity limitations found.</p>}
            <label className="block text-xs">
              <span className="font-medium">Issue note (optional)</span>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Purpose of this revision, recipient, etc." />
            </label>
            <div className="flex gap-2">
              <Button size="sm" disabled={!canFreeze} onClick={freeze}>Freeze revision</Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            </div>
          </section>
        )}

        {revisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No revisions frozen yet.</p>
        ) : (
          <ul className="space-y-2" aria-label="Saved revisions">
            {revisions.map((r) => (
              <li key={r.id} className="rounded-md border p-2 text-sm space-y-1" data-testid={`revision-${r.label}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.label}</span>
                  <Badge variant="outline">Frozen {r.issued_at.slice(0, 10)}</Badge>
                  <span className="text-xs text-muted-foreground">
                    by {issuerLabel(r.issued_by)} · BOQ status then: {r.boq_status_at_issue ? boqStatusLabel(r.boq_status_at_issue) : "not recorded"}
                  </span>
                  <span className="ml-auto tabular-nums">{inr(r.grand_total)}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.priced_line_count} of {r.line_count} lines priced
                  {r.limitations.length > 0 && ` · ${r.limitations.length} limitation${r.limitations.length === 1 ? "" : "s"} recorded`}
                  {Math.round(r.grand_total) !== Math.round(source.workingGrandTotal) && " · the working BOQ has changed since"}
                  {r.issue_note && ` · ${r.issue_note}`}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                    <Eye className="h-3.5 w-3.5 mr-1" />{openId === r.id ? "Close" : "Open"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => exportRevision(r, "pdf")}><FileText className="h-3.5 w-3.5 mr-1" />PDF</Button>
                  <Button size="sm" variant="outline" onClick={() => exportRevision(r, "pdf_blank")}><FileDown className="h-3.5 w-3.5 mr-1" />PDF / Spec &amp; Qty</Button>
                  <Button size="sm" variant="outline" onClick={() => exportRevision(r, "csv")}><Sheet className="h-3.5 w-3.5 mr-1" />CSV</Button>
                </div>
                {openId === r.id && (
                  <RevisionViewer rev={r} issuedByLabel={issuerLabel(r.issued_by)} workingLines={workingLines}
                    onExport={(kind) => exportRevision(r, kind)} onClose={() => setOpenId(null)} />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
