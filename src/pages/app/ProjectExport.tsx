// Step 4 — Export & History. Exports the working BOQ with the BOQ builder's
// own export functions (lib/boqLiveExport — same lines, same documents), and
// lists the BOQ's frozen commercial revisions, each exported from its own
// saved rows (useBoqRevisions). Read-only: freezing a revision stays in the
// builder, where its limitations must be acknowledged first.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, FileDown, FileText, Sheet } from "lucide-react";
import { db } from "@/lib/untypedDb";
import { downloadCsv, openDsrQuote } from "@/lib/boqDsrDocument";
import {
  commercialsFor, exportDate, groupSubheads, includedTotal, liveCsv, liveFileStem, liveQuotePayload,
  quoteContextFor, workingSubheadsFrom,
} from "@/lib/boqLiveExport";
import { loadProjectDrawings, resolveDrawingSource } from "@/lib/review/drawingStorage";
import { latestRunForBoq, loadReviewItems } from "@/lib/review/reviewStore";
import { boqStatusLabel } from "@/lib/boqStatus";
import type { Spec } from "@/lib/boqSpec";
import { useBoqRevisions, REVISIONS_UNAVAILABLE_MESSAGE } from "@/hooks/useBoqRevisions";
import { appBoqLinesKey, loadAppBoqLines } from "@/lib/app/boqLines";
import { boqTotals, incompleteWarning } from "@/lib/app/boqTable";
import { revisionLabel } from "@/lib/app/labels";
import { useProjectShell } from "@/components/app/projectShellContext";
import { useSelectedBoq } from "@/components/app/useSelectedBoq";
import BoqPicker from "@/components/app/BoqPicker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function ProjectExport() {
  const { projectId, project } = useProjectShell();
  const sel = useSelectedBoq(projectId);
  const boqId = sel.selected?.id ?? null;

  const boqQ = useQuery({
    queryKey: ["app-export-boq", boqId],
    enabled: !!boqId,
    queryFn: async () => {
      const { data, error } = await db.from("boq").select("id, name, status, spec").eq("id", boqId!).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("BOQ not found");
      return data as { id: string; name: string; status: string | null; spec: Spec | null };
    },
  });
  const linesQ = useQuery({ queryKey: appBoqLinesKey(boqId), enabled: !!boqId, queryFn: () => loadAppBoqLines(boqId!) });
  const drawingsQ = useQuery({ queryKey: ["boq-drawings", projectId], queryFn: () => loadProjectDrawings(projectId) });
  // Same rule (and cache key) as the builder: review items of the latest
  // analysis not verified or edited are stated on the export, never implied absent.
  const reviewQ = useQuery({
    queryKey: ["boq-unresolved-review", boqId],
    enabled: !!boqId,
    queryFn: async () => {
      const run = await latestRunForBoq(boqId!);
      if (!run) return 0;
      const items = await loadReviewItems(run.id);
      return items.filter((it) => it.reviewStatus !== "VERIFIED" && it.reviewStatus !== "EDITED").length;
    },
  });
  const revs = useBoqRevisions(boqId);

  const drawingsById = useMemo(() => new Map((drawingsQ.data ?? []).map((d) => [d.documentId, d])), [drawingsQ.data]);
  const lines = useMemo(() => linesQ.data ?? [], [linesQ.data]);
  const totals = boqTotals(lines);
  const warning = incompleteWarning(totals);
  const unresolved = reviewQ.data ?? 0;
  // Exports wait for everything they print: lines, the BOQ's spec, drawing
  // names (else sources would be missing) and the unfinished-review count.
  const ready = !!boqQ.data && linesQ.isSuccess && !drawingsQ.isLoading && reviewQ.isSuccess;

  const build = () => {
    const spec = (boqQ.data!.spec ?? {}) as Spec;
    const subheads = workingSubheadsFrom(groupSubheads(lines), (l) =>
      resolveDrawingSource(l.source_document_id, l.source_page, drawingsById, drawingsQ.isLoading));
    return { spec, subheads, generatedOn: exportDate() };
  };
  const exportPdf = (blankRates: boolean) => {
    const { spec, subheads, generatedOn } = build();
    const payload = liveQuotePayload({
      boqName: boqQ.data!.name, context: quoteContextFor(project, spec), generatedOn, blankRates,
      subheads, commercials: commercialsFor(includedTotal(lines), spec), unresolvedReviewCount: unresolved,
    });
    if (!payload) return toast.error("Nothing to export yet");
    if (!openDsrQuote(payload, { autoPrint: !blankRates })) toast.error("Allow pop-ups to export");
  };
  const exportCsv = () => {
    const { subheads, generatedOn } = build();
    const csv = liveCsv({ boqName: boqQ.data!.name, projectName: project.name, generatedOn, subheads, unresolvedReviewCount: unresolved });
    if (!csv) return toast.error("Nothing to export yet");
    downloadCsv(`${liveFileStem(boqQ.data!.name)}_BOQ.csv`, csv);
  };

  if (sel.loading) return <div role="status" aria-label="Loading BOQ"><Skeleton className="h-40 w-full" /></div>;
  if (sel.error) return <div role="alert" className="rounded-md border p-4 text-sm">Could not load this project's BOQs.</div>;
  if (!sel.selected) {
    return (
      <div className="rounded-md border p-8 text-center space-y-2">
        <h2 className="font-semibold">Nothing to export yet</h2>
        <p className="text-sm text-muted-foreground">This project has no BOQ. <Link to={`/ops/projects/${projectId}/boqs/manage`} className="underline">Create one</Link> in the Ops console.</p>
      </div>
    );
  }
  const builderHref = `/ops/projects/${projectId}/boqs/${sel.selected.id}`;
  const failed = boqQ.isError || linesQ.isError || reviewQ.isError || drawingsQ.isError;

  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold mr-auto">Export &amp; History</h2>
        <BoqPicker boqs={sel.boqs} value={sel.selected.id} onChange={sel.select} />
      </div>

      <section aria-labelledby="exp-current" className="rounded-md border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="exp-current" className="font-semibold">Current BOQ</h3>
          {boqQ.data && <span className="text-sm text-muted-foreground">Status: {boqStatusLabel(boqQ.data.status)}</span>}
        </div>
        {failed ? (
          <p role="alert" className="text-sm">Could not load everything this export needs, so exporting is unavailable. Reload to try again.</p>
        ) : !ready ? (
          <div role="status" aria-label="Preparing export" className="space-y-2"><Skeleton className="h-5 w-64" /><Skeleton className="h-9 w-80" /></div>
        ) : (
          <>
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div><dt className="inline text-muted-foreground">Complete lines: </dt><dd className="inline">{totals.complete}</dd></div>
              <div><dt className="inline text-muted-foreground">Quantity pending: </dt><dd className="inline">{totals.pending}</dd></div>
              <div><dt className="inline text-muted-foreground">No rate: </dt><dd className="inline">{totals.unpriced}</dd></div>
              <div><dt className="inline text-muted-foreground">Review items not finished: </dt><dd className="inline">{unresolved}</dd></div>
            </dl>
            {(warning || unresolved > 0) && (
              <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  {warning && <p>{warning}</p>}
                  {unresolved > 0 && <p>{unresolved} drawing review item{unresolved === 1 ? " is" : "s are"} not finished and not in this BOQ.</p>}
                  <p>Exports state these; nothing is hidden.</p>
                </div>
              </div>
            )}
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">This BOQ has no lines yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="gap-1.5" onClick={() => exportPdf(false)}><FileDown className="h-4 w-4" aria-hidden="true" />PDF (priced)</Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => exportPdf(true)}><FileText className="h-4 w-4" aria-hidden="true" />PDF — specs &amp; quantities</Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={exportCsv}><Sheet className="h-4 w-4" aria-hidden="true" />Excel (CSV)</Button>
              </div>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="exp-history" className="rounded-md border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="exp-history" className="font-semibold">History — frozen revisions</h3>
          <Link to={builderHref} className="text-sm underline">Freeze a revision in the BOQ builder</Link>
        </div>
        {revs.loading ? (
          <div role="status" aria-label="Loading revisions"><Skeleton className="h-16 w-full" /></div>
        ) : !revs.available ? (
          <p className="text-sm text-muted-foreground">{REVISIONS_UNAVAILABLE_MESSAGE}</p>
        ) : revs.revisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No revisions frozen yet. A frozen revision keeps an exact, re-exportable copy of the BOQ as issued.</p>
        ) : (
          <ul className="divide-y" aria-label="Frozen revisions">
            {revs.revisions.map((r) => {
              const name = revisionLabel(r.label) ?? `Revision ${r.revision_no}`;
              return (
                <li key={r.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{name}</div>
                    <div className="text-xs text-muted-foreground">
                      Issued {day(r.issued_at)} · {boqStatusLabel(r.boq_status_at_issue)} · {inr(r.grand_total)} · {r.priced_line_count} of {r.line_count} lines priced
                      {r.limitations.length > 0 && ` · ${r.limitations.length} limitation${r.limitations.length === 1 ? "" : "s"} acknowledged`}
                    </div>
                    {r.issue_note && <p className="text-xs text-muted-foreground mt-0.5 break-words">{r.issue_note}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" aria-label={`PDF of ${name}`} onClick={() => revs.exportRevision(r, "pdf")}>PDF</Button>
                    <Button size="sm" variant="outline" aria-label={`PDF with blank rates of ${name}`} onClick={() => revs.exportRevision(r, "pdf_blank")}>PDF, blank rates</Button>
                    <Button size="sm" variant="outline" aria-label={`CSV of ${name}`} onClick={() => revs.exportRevision(r, "csv")}>CSV</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
