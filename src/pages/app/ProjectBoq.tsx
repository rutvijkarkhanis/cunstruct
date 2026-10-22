// Step 3 — BOQ. The selected BOQ's lines in an editable table (see BoqTable).
// Edits write the same boq_line columns the BOQ builder writes for these
// fields, with the builder's quantity rule (quantityEditPatch); every saved
// edit is undoable for this session. Commercials, rates, adding/removing lines
// and status stay in the BOQ builder, linked from here.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, Undo2 } from "lucide-react";
import { db } from "@/lib/untypedDb";
import { BOQ_DRAFT_UI_DISCLAIMER } from "@/lib/boqDraftDisclaimer";
import { saveErrorMessage } from "@/lib/saveError";
import { loadProjectDrawings, resolveDrawingSource } from "@/lib/review/drawingStorage";
import { basisNotice, boqTotals, incompleteWarning, inversePatch, pageParam, statusParam, type BoqTableLine } from "@/lib/app/boqTable";
import { appBoqLinesKey, loadAppBoqLines } from "@/lib/app/boqLines";
import { useProjectShell } from "@/components/app/projectShellContext";
import { EMPTY_UNDO, dismissRefused, popUndo, pushUndo, refuseNewest, useSessionUndoHistory, type UndoState } from "@/components/app/undoHistory";
import { useStepLink } from "@/components/app/useStepLink";
import { useSelectedBoq } from "@/components/app/useSelectedBoq";
import BoqPicker from "@/components/app/BoqPicker";
import BoqTable, { type LineSource } from "@/components/app/BoqTable";
import ApplyReceiptNote from "@/components/app/ApplyReceiptNote";
import { editTookEffect, lineEditMessage, saveLineEdit } from "@/lib/lineEdit";
import { boqEvidenceKey, evidenceForLine, loadBoqEvidenceItems, type LineEvidence } from "@/lib/lineEvidence";
import { useAuth } from "@/context/AuthContext";
import { ASSUMPTION_SEARCH, UNKNOWN_BASIS_SEARCH, boqFilterPath, builderPath, journeyPath, manageBoqsPath } from "@/lib/app/journey";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { adoptionStateFor, applyManualRateEdit, manualRateFailureMessage, type AdoptionSummary } from "@/lib/manualRateEdit";
import { fetchAdoptionHistory } from "@/hooks/useRateAdoption";
import { addLineRecorded, lineAddMessage } from "@/lib/lineEdit";
import { LineRemovalError, isStaleRemoval, removalGuard, removeLineWithSnapshot, restoreRemovedLine, type RemovedLine } from "@/lib/lineRemoval";
import { WORKBENCH_PREVIEW_ENABLED } from "@/lib/workbenchPreview";

// Workbench-only (historyScope "session"): imported only in builds with the preview.
const AddLineForm = WORKBENCH_PREVIEW_ENABLED ? lazy(() => import("@/components/app/AddLineForm")) : null;
import { describeSpecChange, undoSpecChange } from "@/lib/app/commercials";

const FIELD_LABEL: Record<string, string> = { description: "Description", qty: "Quantity", unit: "Unit" };
const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
function describeRate(line: BoqTableLine, to: number | null): string {
  const name = (line.description || line.dsr_code || "line").slice(0, 40);
  const shown = (custom: number | null) => (custom != null ? inr(custom) : line.dsr_rate != null ? `DSR ${inr(line.dsr_rate)}` : "no rate");
  return `Rate of “${name}”: ${shown(line.custom_rate)} → ${shown(to)}`;
}
function describeEdit(line: BoqTableLine, patch: Partial<BoqTableLine>): string {
  if ("included" in patch) return `${patch.included ? "Included" : "Excluded"} “${(line.description || line.dsr_code || "line").slice(0, 40)}” ${patch.included ? "in" : "from"} the total`;
  const field = (["qty", "description", "unit"] as const).find((k) => k in patch) ?? "qty";
  const name = (line.description || line.dsr_code || "line").slice(0, 40);
  return `${FIELD_LABEL[field]} of “${name}”: ${line[field] ?? "—"} → ${patch[field] ?? "—"}`;
}

/** "page" (default): undo history lives and dies with this page. "session":
 *  kept per BOQ until the tab reloads, so it survives leaving for the BOQ
 *  builder and coming back (workbench preview only). The workbench scope also
 *  edits rates in the table (the builder's audited path and its adopted-rate
 *  confirmation) and shows each line's recorded history. */
export default function ProjectBoq({ historyScope = "page" }: { historyScope?: "page" | "session" } = {}) {
  const { projectId } = useProjectShell();
  const sel = useSelectedBoq(projectId);
  const boqId = sel.selected?.id ?? null;
  const [params] = useSearchParams();
  const initialStatus = statusParam(params.get("status"));
  const initialQuery = (params.get("q") ?? "").slice(0, 100);
  const { pathname, search } = useLocation();
  const here = `${pathname}${search}`;
  const qc = useQueryClient();
  const { user } = useAuth();
  const step = useStepLink();
  const [pageHistory, setPageHistory] = useState<UndoState>(EMPTY_UNDO);
  const [sessionHistory, setSessionHistory] = useSessionUndoHistory(historyScope === "session" ? boqId : null);
  const { entries: history, refused } = historyScope === "session" ? sessionHistory : pageHistory;
  const setHistory = historyScope === "session" ? setSessionHistory : setPageHistory;
  const [undoing, setUndoing] = useState(false);
  // Set synchronously: a second Ctrl+Z before the re-render must not replay the same step.
  const undoingRef = useRef(false);
  const [announcement, setAnnouncement] = useState("");

  // Undo is per BOQ: switching BOQs starts a fresh history (the session
  // history is already kept per BOQ).
  useEffect(() => { setPageHistory(EMPTY_UNDO); }, [boqId]);

  const linesQ = useQuery({ queryKey: appBoqLinesKey(boqId), enabled: !!boqId, queryFn: () => loadAppBoqLines(boqId!) });
  // Same key + loader as the BOQ builder's source badge, so the two share one fetch.
  const drawingsQ = useQuery({ queryKey: ["boq-drawings", projectId], queryFn: () => loadProjectDrawings(projectId) });
  const drawingsById = useMemo(() => new Map((drawingsQ.data ?? []).map((d) => [d.documentId, d])), [drawingsQ.data]);
  // Review evidence, linked to lines by their stable key (lib/lineEvidence).
  const evidenceQ = useQuery({ queryKey: boqEvidenceKey(boqId), enabled: !!boqId, queryFn: () => loadBoqEvidenceItems(boqId!) });
  const evidenceOf = useCallback((l: BoqTableLine) => (evidenceQ.data ? evidenceForLine(l, evidenceQ.data) : null), [evidenceQ.data]);
  const regionHref = useCallback((e: LineEvidence) => {
    if (!e.documentId || !drawingsById.has(e.documentId)) return null;
    const q = new URLSearchParams({ boq: boqId ?? "", document: e.documentId, item: e.reviewItemId, run: e.runId });
    if (e.page) q.set("page", String(e.page));
    return `../drawings?${q}`;
  }, [boqId, drawingsById]);

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: appBoqLinesKey(boqId) });
    qc.invalidateQueries({ queryKey: ["boq-lines", boqId] }); // the builder's cache of the same rows
    qc.invalidateQueries({ queryKey: ["boq-line-history"] });
  }, [qc, boqId]);

  // Rates (workbench only): the same rate-adoption history the builder reads
  // (shared query key), to confirm before an adopted rate is replaced.
  // The workbench's extra editing (rates, add/remove, history). The constant
  // first, so builds without the preview drop all of it (WORKBENCH_PREVIEW_ENABLED folds).
  const rateEditing = WORKBENCH_PREVIEW_ENABLED && historyScope === "session";
  const adoptionQ = useQuery({ queryKey: ["rate-adoption", boqId], enabled: !!boqId && rateEditing, queryFn: () => fetchAdoptionHistory(boqId!) });
  const [pendingRate, setPendingRate] = useState<{ line: BoqTableLine; rate: number | null; record: AdoptionSummary; resolve: (ok: boolean) => void } | null>(null);

  const sourceOf = useCallback((l: BoqTableLine): LineSource | null => {
    const r = resolveDrawingSource(l.source_document_id, l.source_page, drawingsById, drawingsQ.isLoading);
    if (!r.sourceDocument) return null;
    const resolved = !!l.source_document_id && drawingsById.has(l.source_document_id);
    const page = pageParam(r.sourcePage);
    const q = new URLSearchParams({ boq: boqId ?? "", document: l.source_document_id ?? "" });
    if (page) q.set("page", page);
    return { name: r.sourceDocument, page: r.sourcePage, href: resolved ? `../drawings?${q}` : null };
  }, [drawingsById, drawingsQ.isLoading, boqId]);

  // One write path for both an edit and its undo: every change is guarded
  // (only if the line still has the values it was edited from) and recorded
  // in the line's history (lib/lineEdit). Any failure re-reads the lines, so the screen shows what the
  // database holds rather than what was typed.
  // Returns "done" when the line now holds the change — also when its history
  // failed and could not be put back (reported as an error), so the undo
  // list always matches the database; "conflict" when the line no longer held
  // the expected values (nothing written); "failed" otherwise (nothing taken
  // effect: an error, or a history failure that was put back).
  const write = useCallback(async (line: BoqTableLine, patch: Partial<BoqTableLine>, what: string): Promise<"done" | "conflict" | "failed"> => {
    let r;
    try {
      r = await saveLineEdit({ boqId: boqId!, line, patch, changedBy: user?.id ?? null });
    } catch (e) {
      toast.error(`${what === "Undo" ? "Undo failed" : "Not saved"} — ${saveErrorMessage(e as { message?: string })}`); refresh(); return "failed";
    }
    const msg = lineEditMessage(r, what);
    if (!editTookEffect(r)) { toast.error(msg!); refresh(); return r.status === "conflict" ? "conflict" : "failed"; }
    // The line as saved, right away: a further edit of it before the re-read
    // lands is guarded on these values, not refused as "changed elsewhere".
    qc.setQueryData(appBoqLinesKey(boqId), (old: BoqTableLine[] | undefined) => old?.map((l) => (l.id === line.id ? { ...l, ...patch } : l)));
    if (r.status !== "saved") toast.error(msg!);
    else if (msg) toast.warning(msg, { id: "line-history-unavailable" });
    return "done";
  }, [boqId, user?.id, refresh, qc]);

  // The rate write: lib/manualRateEdit (compare-and-swap on the rate shown,
  // then its boq_line_change_log row; an unaudited change is never a success).
  // Same outcomes as `write`.
  const writeRate = useCallback(async (line: BoqTableLine, to: number | null, what: string): Promise<"done" | "conflict" | "failed"> => {
    let r;
    try {
      r = await applyManualRateEdit({ boqId: boqId!, line: { id: line.id, custom_rate: line.custom_rate, dsr_rate: line.dsr_rate, unit: line.unit }, newRate: to, changedBy: user?.id ?? null });
    } catch (e) {
      toast.error(`${what === "Undo" ? "Undo failed" : "Rate not saved"} — ${saveErrorMessage(e as { message?: string })}`); refresh(); return "failed";
    }
    if (r.status === "applied" || (r.status === "audit_failed" && !r.reverted)) {
      qc.setQueryData(appBoqLinesKey(boqId), (old: BoqTableLine[] | undefined) => old?.map((l) => (l.id === line.id ? { ...l, custom_rate: to } : l)));
      if (r.status !== "applied") toast.error(manualRateFailureMessage(r, to));
      return "done";
    }
    toast.error(`${what === "Undo" ? "Undo not saved: " : ""}${manualRateFailureMessage(r, to)}`);
    refresh();
    return r.status === "conflict" ? "conflict" : "failed";
  }, [boqId, user?.id, refresh, qc]);

  const saveRate = useCallback(async (line: BoqTableLine, to: number | null) => {
    const adopted = adoptionStateFor(line, (adoptionQ.data?.records ?? []) as AdoptionSummary[]);
    if (adopted.kind === "adopted" && !(await new Promise<boolean>((resolve) => setPendingRate({ line, rate: to, record: adopted.record, resolve })))) return false;
    if ((await writeRate(line, to, "Change")) !== "done") return false;
    const label = describeRate(line, to);
    setHistory(pushUndo({ kind: "rate", lineId: line.id, label, undo: { custom_rate: line.custom_rate }, after: { ...line, custom_rate: to } }));
    setAnnouncement(`Saved. ${label}`);
    refresh();
    return true;
  }, [adoptionQ.data, writeRate, refresh, setHistory]);

  // Adding (workbench): lib/lineEdit addLineRecorded inserts the line and
  // records its creation. Undo takes it out through the guarded removal,
  // only while it is still exactly as added.
  const addLine = useCallback(async (row: Record<string, unknown>, label: string) => {
    let r;
    try { r = await addLineRecorded({ boqId: boqId!, row, changedBy: user?.id ?? null }); }
    catch (e) { toast.error(`Line not added — ${saveErrorMessage(e as { message?: string })}`); refresh(); return false; }
    const msg = lineAddMessage(r);
    refresh();
    // Its history failed and it was taken out again: nothing was added.
    if (r.status === "history_failed" && r.removed) { toast.error(msg!); return false; }
    if (r.status === "history_failed") toast.error(msg!); // it exists: keep the step so it can be undone
    else if (msg) toast.warning(msg, { id: "line-history-unavailable" });
    setHistory(pushUndo({ kind: "add", lineId: r.id, label, undo: {}, after: r.row as unknown as BoqTableLine }));
    setAnnouncement(`Added. ${label}`);
    return true;
  }, [boqId, user?.id, refresh, setHistory]);


  const save = useCallback(async (line: BoqTableLine, patch: Partial<BoqTableLine>) => {
    if ((await write(line, patch, "Change")) !== "done") return false;
    const label = describeEdit(line, patch);
    setHistory(pushUndo({ lineId: line.id, label, undo: inversePatch(line, patch), after: { ...line, ...patch } }));
    setAnnouncement(`Saved. ${label}`);
    refresh();
    return true;
  }, [write, refresh, setHistory]);

  // Removing (workbench): confirmed first, then lib/lineRemoval — guarded on
  // what is shown, refused when it would destroy linked records undo cannot
  // restore (offering to exclude instead), recorded in the change history.
  const [pendingRemove, setPendingRemove] = useState<BoqTableLine | null>(null);
  const removeLine = useCallback(async (line: BoqTableLine) => {
    const label = `Removed “${(line.description || line.dsr_code || "line").slice(0, 40)}”`;
    let removed: RemovedLine;
    try {
      removed = await removeLineWithSnapshot(line.id, undefined, { expected: removalGuard(line), history: { boqId: boqId!, changedBy: user?.id ?? null } });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Line not removed";
      if (e instanceof LineRemovalError && e.excludeInstead && line.included) {
        toast.error(message, { action: { label: "Exclude instead", onClick: () => { void save(line, { included: false }); } } });
      } else toast.error(message);
      refresh();
      // Removed although its history failed and it could not be put back: keep the step, so Undo can restore it.
      if (!(e instanceof LineRemovalError && e.removed)) return;
      removed = e.removed;
    }
    setHistory(pushUndo({ kind: "remove", lineId: line.id, label, undo: {}, after: line, removed }));
    setAnnouncement(`${label}.`);
    refresh();
  }, [boqId, user?.id, refresh, setHistory, save]);

  // Undo an add: take the line out again, only if it is still exactly as added.
  const undoAdd = useCallback(async (added: BoqTableLine): Promise<"done" | "conflict" | "failed"> => {
    try {
      await removeLineWithSnapshot(added.id, undefined, { expected: removalGuard(added), history: { boqId: boqId!, changedBy: user?.id ?? null, requireHistory: false } });
      return "done";
    } catch (e) {
      toast.error(`Undo not saved: ${e instanceof Error ? e.message : "the line was not removed"}`);
      return e instanceof LineRemovalError && e.removed ? "done" : isStaleRemoval(e) ? "conflict" : "failed";
    } finally { refresh(); }
  }, [boqId, user?.id, refresh]);
  // Undo a removal: put back the exact row and re-attach its links.
  const undoRemove = useCallback(async (removed: RemovedLine): Promise<"done" | "conflict" | "failed"> => {
    try {
      const r = await restoreRemovedLine(removed, undefined, { boqId: boqId!, changedBy: user?.id ?? null });
      if (r.unrestoredLinks.length) toast.warning(`Line restored, but ${r.unrestoredLinks.map((u) => `${u.expected - u.restored} link${u.expected - u.restored === 1 ? "" : "s"} in ${u.table}`).join(", ")} could not be re-attached.`);
      if (r.historyRecorded === false) toast.warning(`Line restored, but the restore is not in the BOQ's history (${r.historyError}).`);
      return "done";
    } catch (e) {
      toast.error(`Undo failed — ${e instanceof Error ? e.message : "the line was not restored"}`);
      return "failed";
    } finally { refresh(); }
  }, [boqId, user?.id, refresh]);

  // Undo a commercial-input change (made on the Export page; one undo history per BOQ).
  const undoSpec = useCallback(async (c: { key: string; before: unknown; after: unknown }): Promise<"done" | "conflict" | "failed"> => {
    const r = await undoSpecChange(boqId!, c.key, c.before, c.after);
    if (r === "conflict") toast.error(`Undo not saved: ${describeSpecChange(c.key, c.before, c.after).split(":")[0]} was changed elsewhere since. The current value is kept.`);
    else if (r === "failed") toast.error("Undo failed — the BOQ could not be saved. Nothing was changed.");
    void qc.invalidateQueries({ queryKey: ["app-export-boq", boqId] });
    return r;
  }, [boqId, qc]);

  const undo = useCallback(async () => {
    const last = history[history.length - 1];
    if (!last || undoingRef.current) return;
    undoingRef.current = true;
    setUndoing(true);
    // Guarded on the values this edit left: someone else's later change is
    // never reverted. In the workbench ("session"), a step refused because
    // the line changed elsewhere (and earlier steps on that line) leave the
    // stack, listed as not undone (components/app/undoHistory). The journey
    // ("page") keeps its released behaviour: a refused step stays. Any other
    // failure keeps the step; nothing is assumed reverted.
    const r = last.kind === "spec" ? await undoSpec(last.spec)
      : last.kind === "rate" ? await writeRate(last.after, last.undo.custom_rate ?? null, "Undo")
      : last.kind === "add" ? await undoAdd(last.after)
      : last.kind === "remove" ? await undoRemove(last.removed!)
      : await write(last.after, last.undo, "Undo");
    undoingRef.current = false;
    setUndoing(false);
    if (r === "conflict" && historyScope === "session") {
      setHistory(refuseNewest);
      setAnnouncement(`Not undone: ${last.label}. ${last.kind === "spec" ? "It" : "The line"} was changed elsewhere.`);
      return;
    }
    if (r !== "done") return;
    setHistory(popUndo);
    setAnnouncement(`Undone. ${last.label}`);
    refresh();
  }, [history, historyScope, write, writeRate, undoAdd, undoRemove, undoSpec, refresh, setHistory]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
      if ((e.target as HTMLElement | null)?.closest("input,textarea,select,[contenteditable]")) return;
      e.preventDefault();
      void undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  if (sel.loading) return <div role="status" aria-label="Loading BOQ" className="space-y-2"><Skeleton className="h-9 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (sel.error) return <div role="alert" className="rounded-md border p-4 text-sm">Could not load this project's BOQs.</div>;
  if (!sel.selected) {
    return (
      <div className="rounded-md border p-8 text-center space-y-2">
        <h2 className="font-semibold">No BOQ yet</h2>
        <p className="text-sm text-muted-foreground">
          <Link to={manageBoqsPath(projectId, here)} className="underline">Create a BOQ</Link> for this project in the Ops console.
        </p>
      </div>
    );
  }

  const lines = linesQ.data ?? [];
  const totals = boqTotals(lines);
  const warning = incompleteWarning(totals);
  const basis = basisNotice(totals);
  const builderHref = builderPath(projectId, sel.selected.id, here);
  const filterHref = (f: { status?: string; q?: string }) => step(boqFilterPath(projectId, sel.selected!.id, f));
  const lastEdit = history[history.length - 1];

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold mr-auto">BOQ</h2>
        <BoqPicker boqs={sel.boqs} value={sel.selected.id} onChange={sel.select} />
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void undo()}
          disabled={!lastEdit || undoing}
          aria-label={lastEdit ? `Undo: ${lastEdit.label}` : "Undo (nothing to undo)"}
          title={lastEdit ? `Undo: ${lastEdit.label} (Ctrl+Z)` : "Nothing to undo"}>
          <Undo2 className="h-4 w-4" aria-hidden="true" /> Undo{history.length ? ` (${history.length})` : ""}
        </Button>
        <Link to={builderHref} className="inline-flex items-center gap-1 text-sm underline">
          Open in BOQ builder <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
      <p className="sr-only" aria-live="polite">{announcement}</p>
      {rateEditing && <AlertDialog open={!!pendingRemove} onOpenChange={(open) => { if (!open) setPendingRemove(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this line?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemove && <>“{(pendingRemove.description || pendingRemove.dsr_code || "line").slice(0, 120)}” is taken out of the BOQ.
                The removal is recorded in the BOQ's change history with the complete line, and Undo in this tab puts it back exactly.
                To keep the line but leave it out of the total, exclude it instead.
                {(() => {
                  const ev = evidenceOf(pendingRemove);
                  return ev?.kind === "linked" ? (
                    <span role="note" className="block mt-2 font-medium text-amber-900 dark:text-amber-200">
                      This line carries drawing-review item “{ev.itemKey}” ({ev.decision === "EDITED" ? "corrected" : "verified"} on the drawings). Removing it leaves that reviewed quantity out of the BOQ.
                    </span>
                  ) : null;
                })()}</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep line</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const l = pendingRemove; setPendingRemove(null); if (l) void removeLine(l); }}>Remove line</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>}
      {rateEditing && <AlertDialog open={!!pendingRate} onOpenChange={(open) => { if (!open && pendingRate) { pendingRate.resolve(false); setPendingRate(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the adopted rate?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRate && <>
                This line's rate of ₹{Number(pendingRate.record.adopted_rate).toLocaleString("en-IN")} was adopted from{" "}
                {pendingRate.record.source_label} on {pendingRate.record.confirmed_at.slice(0, 10)}. Changing it to{" "}
                {pendingRate.rate != null ? `₹${pendingRate.rate.toLocaleString("en-IN")}` : "the DSR rate"} makes it a manual rate.
                The adoption record stays in history, and the change is logged.
              </>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { pendingRate?.resolve(false); setPendingRate(null); }}>Keep adopted rate</AlertDialogCancel>
            <AlertDialogAction onClick={() => { pendingRate?.resolve(true); setPendingRate(null); }}>Replace with manual rate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>}
      {rateEditing && (
        <p className="text-xs text-muted-foreground">Undo history is kept for this BOQ in this browser tab until the page is reloaded.</p>
      )}
      {rateEditing && (
        <p className="text-xs text-muted-foreground">
          Still in the <Link to={builderHref} className="underline">BOQ builder</Link> (Ops console, returns here): DSR mapping, audit review, the margin (cost) view and lines from a JSON evaluation. Moving or ordering BOQs is on the project's BOQ management page.
        </p>
      )}
      {refused.length > 0 && (
        <section aria-label="Changes that could not be undone" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <p className="font-medium">Not undone — these lines were changed elsewhere since your edit, so their current values were kept:</p>
          <ul className="list-disc pl-5">
            {refused.map((x, i) => (
              <li key={i}>{x.label}{x.reason === "earlier-on-changed-line" ? " (an earlier edit of the same line)" : ""}</li>
            ))}
          </ul>
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setHistory(dismissRefused)}>Dismiss</Button>
        </section>
      )}

      <ApplyReceiptNote projectId={projectId} boqId={sel.selected.id} here="boq" />

      {sel.requestedMissing && (
        <p role="note" className="text-sm text-muted-foreground">The BOQ in this link is not part of this project; showing “{sel.selected.name}”.</p>
      )}

      {linesQ.isLoading ? (
        <div role="status" aria-label="Loading BOQ lines"><Skeleton className="h-64 w-full" /></div>
      ) : linesQ.isError ? (
        <div role="alert" className="rounded-md border p-4 text-sm space-y-2">
          <p>Could not load the lines of this BOQ.</p>
          <Button size="sm" variant="outline" onClick={() => linesQ.refetch()}>Retry</Button>
        </div>
      ) : (
        <>
          {basis && (
            <p className="text-sm text-muted-foreground">
              {basis}{" "}
              {totals.basisUnknown > 0 && <Link className="underline" to={filterHref({ q: UNKNOWN_BASIS_SEARCH })}>Show lines with no recorded basis</Link>}
              {totals.basisUnknown > 0 && totals.assumed > 0 && " · "}
              {totals.assumed > 0 && <Link className="underline" to={filterHref({ q: ASSUMPTION_SEARCH })}>Show assumptions</Link>}
            </p>
          )}
          {warning && (
            <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1">
                <p>{warning}</p>
                <p className="flex flex-wrap gap-x-4">
                  {totals.pending > 0 && initialStatus !== "pending" && <Link className="underline" to={filterHref({ status: "pending" })}>Show pending lines</Link>}
                  {totals.pending > 0 && <span>Enter a quantity on a pending line to confirm it, or resolve it in <Link className="underline" to={step(journeyPath(projectId, "review", sel.selected.id))}>Review quantities</Link>.</span>}
                  {totals.unpriced > 0 && <Link className="underline" to={builderHref}>Add rates in the BOQ builder</Link>}
                </p>
              </div>
            </div>
          )}
          {rateEditing && AddLineForm && (
            <Suspense fallback={null}><AddLineForm boqId={sel.selected.id} sections={[...new Set(lines.map((l) => l.section).filter((x): x is string => !!x))]}
              nextSort={lines.reduce((m, l) => Math.max(m, l.sort ?? 0), 0) + 1} onAdd={addLine} /></Suspense>
          )}
          {/* Keyed on the arriving filter so a "Show …" link applies it. */}
          <BoqTable key={`${sel.selected.id}:${initialStatus}:${initialQuery}`} lines={lines} sourceOf={sourceOf} onSave={save} disabled={undoing} rateEditHref={builderHref} initialStatus={initialStatus} initialQuery={initialQuery}
            evidenceOf={evidenceOf} regionHref={regionHref}
            onRateSave={rateEditing ? saveRate : undefined} showHistory={rateEditing}
            onRemove={rateEditing ? setPendingRemove : undefined} />
          {evidenceQ.isError && <p role="note" className="text-xs text-muted-foreground">Review evidence could not be loaded, so lines show their recorded basis only.</p>}
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div><dt className="inline text-muted-foreground">Priced works subtotal: </dt><dd className="inline font-semibold tabular-nums">₹{totals.pricedTotal.toLocaleString("en-IN")}</dd></div>
            <div><dt className="inline text-muted-foreground">Priced: </dt><dd className="inline">{totals.complete}</dd></div>
            <div><dt className="inline text-muted-foreground">Quantity pending: </dt><dd className="inline">{totals.pending}</dd></div>
            <div><dt className="inline text-muted-foreground">No rate: </dt><dd className="inline">{totals.unpriced}</dd></div>
            <div><dt className="inline text-muted-foreground">Excluded: </dt><dd className="inline">{totals.excluded}</dd></div>
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">{BOQ_DRAFT_UI_DISCLAIMER}</p>
          <p className="text-xs text-muted-foreground">Before overheads, contingency and taxes — see the BOQ builder or Export for the full commercial total.</p>
        </>
      )}
    </div>
  );
}
