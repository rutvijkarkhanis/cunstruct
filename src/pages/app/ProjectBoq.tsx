// Step 3 — BOQ. The selected BOQ's lines in an editable table (see BoqTable).
// Edits write the same boq_line columns the BOQ builder writes for these
// fields, with the builder's quantity rule (quantityEditPatch); every saved
// edit is undoable for this session. Commercials, rates, adding/removing lines
// and status stay in the BOQ builder, linked from here.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/** `after` is the line as this edit left it — what undo expects to find. */
interface UndoEntry { lineId: string; label: string; undo: Partial<BoqTableLine>; after: BoqTableLine }

const FIELD_LABEL: Record<string, string> = { description: "Description", qty: "Quantity", unit: "Unit" };
function describeEdit(line: BoqTableLine, patch: Partial<BoqTableLine>): string {
  const field = (["qty", "description", "unit"] as const).find((k) => k in patch) ?? "qty";
  const name = (line.description || line.dsr_code || "line").slice(0, 40);
  return `${FIELD_LABEL[field]} of “${name}”: ${line[field] ?? "—"} → ${patch[field] ?? "—"}`;
}

export default function ProjectBoq() {
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
  const [history, setHistory] = useState<UndoEntry[]>([]);
  const [undoing, setUndoing] = useState(false);
  // Set synchronously: a second Ctrl+Z before the re-render must not replay the same step.
  const undoingRef = useRef(false);
  const [announcement, setAnnouncement] = useState("");

  // Undo is per BOQ: switching BOQs starts a fresh history.
  useEffect(() => { setHistory([]); }, [boqId]);

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
  }, [qc, boqId]);

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
  // Returns whether the line now holds the change — also when its history
  // failed and could not be put back (reported as an error), so the undo
  // list always matches the database.
  const write = useCallback(async (line: BoqTableLine, patch: Partial<BoqTableLine>, what: string): Promise<boolean> => {
    let r;
    try {
      r = await saveLineEdit({ boqId: boqId!, line, patch, changedBy: user?.id ?? null });
    } catch (e) {
      toast.error(`${what === "Undo" ? "Undo failed" : "Not saved"} — ${saveErrorMessage(e as { message?: string })}`); refresh(); return false;
    }
    const msg = lineEditMessage(r, what);
    if (!editTookEffect(r)) { toast.error(msg!); refresh(); return false; }
    // The line as saved, right away: a further edit of it before the re-read
    // lands is guarded on these values, not refused as "changed elsewhere".
    qc.setQueryData(appBoqLinesKey(boqId), (old: BoqTableLine[] | undefined) => old?.map((l) => (l.id === line.id ? { ...l, ...patch } : l)));
    if (r.status !== "saved") toast.error(msg!);
    else if (msg) toast.warning(msg, { id: "line-history-unavailable" });
    return true;
  }, [boqId, user?.id, refresh, qc]);

  const save = useCallback(async (line: BoqTableLine, patch: Partial<BoqTableLine>) => {
    if (!(await write(line, patch, "Change"))) return false;
    const label = describeEdit(line, patch);
    setHistory((h) => [...h, { lineId: line.id, label, undo: inversePatch(line, patch), after: { ...line, ...patch } }]);
    setAnnouncement(`Saved. ${label}`);
    refresh();
    return true;
  }, [write, refresh]);

  const undo = useCallback(async () => {
    const last = history[history.length - 1];
    if (!last || undoingRef.current) return;
    undoingRef.current = true;
    setUndoing(true);
    // Guarded on the values this edit left: someone else's later change is
    // never reverted. A failed undo keeps the entry; nothing is assumed reverted.
    const ok = await write(last.after, last.undo, "Undo");
    undoingRef.current = false;
    setUndoing(false);
    if (!ok) return;
    setHistory((h) => h.slice(0, -1));
    setAnnouncement(`Undone. ${last.label}`);
    refresh();
  }, [history, write, refresh]);

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
  const filterHref = (f: { status?: string; q?: string }) => boqFilterPath(projectId, sel.selected!.id, f);
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
                  {totals.pending > 0 && <span>Enter a quantity on a pending line to confirm it, or resolve it in <Link className="underline" to={journeyPath(projectId, "review", sel.selected.id)}>Review quantities</Link>.</span>}
                  {totals.unpriced > 0 && <Link className="underline" to={builderHref}>Add rates in the BOQ builder</Link>}
                </p>
              </div>
            </div>
          )}
          {/* Keyed on the arriving filter so a "Show …" link applies it. */}
          <BoqTable key={`${sel.selected.id}:${initialStatus}:${initialQuery}`} lines={lines} sourceOf={sourceOf} onSave={save} disabled={undoing} rateEditHref={builderHref} initialStatus={initialStatus} initialQuery={initialQuery}
            evidenceOf={evidenceOf} regionHref={regionHref} />
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
