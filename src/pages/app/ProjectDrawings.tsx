// Step 2 — Drawings. Reuses the existing source list (WorkspaceSources), the
// existing upload/manage drawer (WorkspaceSourceManager — upload, folders,
// revisions, delete-with-reference-warning) and the existing drawing viewer
// (WorkspaceCanvas → PdfEvidenceViewer) unchanged. The open drawing lives in
// ?document= so it survives reloads and step switches.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Upload } from "lucide-react";
import WorkspaceSources from "@/components/ops/workspace/WorkspaceSources";
import WorkspaceSourceManager from "@/components/ops/workspace/WorkspaceSourceManager";
import WorkspaceCanvas from "@/components/ops/workspace/WorkspaceCanvas";
import { useDocumentManagement } from "@/hooks/useDocumentManagement";
import { useProjectShell } from "@/components/app/projectShellContext";
import { revisionLabel } from "@/lib/app/labels";
import { Button } from "@/components/ui/button";

export default function ProjectDrawings() {
  const { projectId } = useProjectShell();
  const [params, setParams] = useSearchParams();
  const documentId = params.get("document");
  // Seeds the viewer's first page (e.g. from a BOQ line's source link).
  const page = Number(params.get("page")) || null;
  const [managerOpen, setManagerOpen] = useState(false);
  const viewerRef = useRef<HTMLElement>(null);

  // Same hook (same query keys) the source list and drawer use, so this reads
  // the cached rows rather than fetching them again.
  const dm = useDocumentManagement(projectId);
  const doc = documentId ? dm.docs?.find((d) => d.id === documentId) : undefined;
  const current = doc ? dm.revsFor(doc.id).find((r) => r.id === doc.current_revision_id) : undefined;
  const rev = revisionLabel(current?.label);

  const select = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("document", id);
    next.delete("page");
    setParams(next, { replace: true });
  };
  // On narrow screens the viewer sits below the list: bring it into view.
  useEffect(() => {
    if (documentId && window.matchMedia?.("(max-width: 1023px)").matches) viewerRef.current?.scrollIntoView?.({ block: "start" });
  }, [documentId]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Drawings</h2>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setManagerOpen(true)}>
          <Upload className="h-4 w-4" aria-hidden="true" /> Upload or manage
        </Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-[16rem_minmax(0,1fr)] min-w-0">
        <section aria-label="Project drawings" className="rounded-md border overflow-hidden h-72 lg:h-[72vh]">
          <WorkspaceSources projectId={projectId} activeDocumentId={documentId}
            onSelectDocument={select} onManageSources={() => setManagerOpen(true)} />
        </section>
        <section ref={viewerRef} aria-label="Drawing viewer" className="rounded-md border bg-card min-w-0 flex flex-col lg:h-[72vh]">
          {doc && (
            <div className="px-3 py-2 border-b flex flex-wrap items-baseline gap-x-2 text-sm min-w-0">
              <h3 className="font-medium break-words min-w-0">{doc.name}</h3>
              {rev && <span className="text-muted-foreground">{rev}</span>}
              {current?.page_count != null && <span className="text-muted-foreground">· {current.page_count} page{current.page_count === 1 ? "" : "s"}</span>}
            </div>
          )}
          <div className="flex-1 min-h-[360px] flex min-w-0">
            <WorkspaceCanvas key={`${documentId}:${page}`} documentId={documentId} page={page} />
          </div>
        </section>
      </div>
      <WorkspaceSourceManager projectId={projectId} open={managerOpen} onOpenChange={setManagerOpen}
        activeDocumentId={documentId} onSelectDocument={(id) => { select(id); setManagerOpen(false); }} />
    </div>
  );
}
