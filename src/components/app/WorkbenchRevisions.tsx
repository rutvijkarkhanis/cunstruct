// WORKBENCH PREVIEW — finalising and freezing in the Export section: the
// existing BoqStatusControl (Draft ⇄ Finalized, compare-and-swap on the
// status shown) and BoqRevisionsPanel (prepare, freeze, compare and export
// commercial revisions), fed the same snapshot the BOQ builder freezes:
// freshly re-read lines and spec (a failed spec read throws — never an empty
// spec), DSR sub-head grouping, drawing sources, adoption provenance and
// commercials (lib/boqLiveExport, lib/boqRevision). Loaded only in builds with
// the preview (ProjectExport imports it behind WORKBENCH_PREVIEW_ENABLED).
import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import BoqStatusControl from "@/components/ops/BoqStatusControl";
import BoqRevisionsPanel from "@/components/ops/BoqRevisionsPanel";
import { db } from "@/lib/untypedDb";
import type { Spec } from "@/lib/boqSpec";
import { buildRevisionLines } from "@/lib/boqRevision";
import { commercialsFor, groupSubheads, includedDsrTotal, includedTotal, quoteContextFor, workingSubheadsFrom } from "@/lib/boqLiveExport";
import { loadProjectDrawings, resolveDrawingSource } from "@/lib/review/drawingStorage";
import { appBoqLinesKey, loadAppBoqLines, type AppBoqLine } from "@/lib/app/boqLines";
import type { ShellProject } from "./projectShellContext";
import WorkbenchCommercials from "./WorkbenchCommercials";

async function specStrict(boqId: string): Promise<Spec> {
  const { data, error } = await db.from("boq").select("spec").eq("id", boqId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("the BOQ could not be read");
  return ((data as { spec: Spec | null }).spec ?? {}) as Spec;
}

export default function WorkbenchRevisions({ boqId, boqName, status, spec, lines, project, onBoqPersisted }: {
  boqId: string; boqName: string; status: string | null; spec: Spec; lines: AppBoqLine[];
  project: ShellProject; onBoqPersisted: () => Promise<unknown> | void;
}) {
  const qc = useQueryClient();
  const drawingsQ = useQuery({ queryKey: ["boq-drawings", project.id], queryFn: () => loadProjectDrawings(project.id) });
  const workingGrandTotal = useMemo(() => commercialsFor(includedTotal(lines), spec, includedDsrTotal(lines)).grandTotal, [lines, spec]);
  return (
    <>
    <WorkbenchCommercials boqId={boqId} spec={spec} lines={lines} onSaved={async () => { await onBoqPersisted(); }} />
    <section aria-labelledby="wb-finalise" className="rounded-md border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="wb-finalise" className="font-semibold">Finalise and freeze</h3>
        <BoqStatusControl boqId={boqId} status={status} onPersisted={onBoqPersisted} />
      </div>
      <BoqRevisionsPanel boqId={boqId} source={{
        boqStatus: status,
        workingGrandTotal,
        // Re-reads what is saved at the moment of freezing, never this screen's copy.
        build: async (adoptions) => {
          if (drawingsQ.isLoading) throw new Error("the project's drawings are still loading, so each line's drawing source can't be frozen yet. Try again in a moment.");
          if (drawingsQ.isError) throw new Error("the project's drawings could not be loaded, so each line's drawing source would be frozen as unavailable. Reload the page and try again.");
          const drawingsById = new Map((drawingsQ.data ?? []).map((d) => [d.documentId, d]));
          const [fresh, freshSpec] = await Promise.all([loadAppBoqLines(boqId), specStrict(boqId)]);
          void qc.invalidateQueries({ queryKey: appBoqLinesKey(boqId) });
          const subheads = workingSubheadsFrom(groupSubheads(fresh), (l) => resolveDrawingSource(l.source_document_id, l.source_page, drawingsById, false));
          const revLines = buildRevisionLines(subheads, adoptions);
          const c = commercialsFor(includedTotal(fresh), freshSpec, includedDsrTotal(fresh));
          const builtUp = project.area_sqft ?? (Number(freshSpec._area_sqft) || 0);
          return {
            lines: revLines,
            header: {
              boq_name: boqName, project_name: project.name ?? null,
              context: { quote: quoteContextFor(project, freshSpec), built_up_sqft: builtUp || null },
              commercials: c, works_total: c.works, grand_total: c.grandTotal,
              priced_line_count: revLines.filter((l) => l.amount != null).length,
            },
          };
        },
      }} />
    </section>
    </>
  );
}
