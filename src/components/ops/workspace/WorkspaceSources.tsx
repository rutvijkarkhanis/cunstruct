// SOURCES RAIL — Phase 11 Stage B/C2. Reuses the EXISTING project_document /
// document_revision data model, now through the SAME shared
// useDocumentManagement hook the Documents page and the source-management
// drawer both consume — never a second, independent read path for the same
// data. The drawer (opened via "+ Add source") carries the actual
// upload/folder/delete/revision CRUD; this rail only reads and selects.
//
// Compact, Phase-9/10-styled list (border-l accent on the active row, same
// convention as BoqReviewWorkstation's type/category rows) — not a card grid,
// not a dashboard table.

import { cn } from "@/lib/utils";
import { FileText, Plus, Upload } from "lucide-react";
import { groupSourcesByDiscipline, type SourceDocument } from "@/lib/review/workspaceSources";
import { useDocumentManagement } from "@/hooks/useDocumentManagement";

export interface WorkspaceSourcesProps {
  projectId: string;
  activeDocumentId: string | null;
  onSelectDocument: (documentId: string) => void;
  onManageSources: () => void;
}

export default function WorkspaceSources({ projectId, activeDocumentId, onSelectDocument, onManageSources }: WorkspaceSourcesProps) {
  const dm = useDocumentManagement(projectId);
  const isLoading = dm.docs === undefined;

  // Resolve each document's CURRENT revision's page count, if any — never a
  // different/older revision, matching the same current-revision convention
  // ProjectDocuments.tsx and drawingStorage.ts use.
  const sourceDocuments: SourceDocument[] = (dm.docs ?? []).map((d) => {
    const current = dm.revsFor(d.id).find((r) => r.id === d.current_revision_id);
    return {
      id: d.id,
      name: d.name,
      docType: d.doc_type,
      discipline: d.discipline,
      status: d.status ?? "uploaded",
      pageCount: current?.page_count ?? null,
    };
  });
  const groups = groupSourcesByDiscipline(sourceDocuments);

  return (
    <div className="flex flex-col w-full h-full min-h-0 border-r bg-card">
      <div className="px-3 py-2.5 border-b flex items-center justify-between shrink-0 gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sources</span>
        <button
          type="button"
          onClick={onManageSources}
          className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1 text-xs font-medium"
          title="Add source"
          aria-label="Add source"
        >
          <Plus className="w-3.5 h-3.5" /> Add source
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-3 min-h-0">
        {isLoading && <div className="text-xs text-muted-foreground px-1 py-1">Loading…</div>}
        {!isLoading && groups.length === 0 && (
          <div className="text-xs text-muted-foreground px-1 py-2 space-y-2">
            <p>No drawings uploaded yet.</p>
            <button type="button" onClick={onManageSources} className="inline-flex items-center gap-1 text-primary hover:underline">
              <Upload className="w-3 h-3" /> Upload a drawing
            </button>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-1 mb-1">{g.label}</div>
            <div className="space-y-0.5">
              {g.documents.map((d) => {
                const active = d.id === activeDocumentId;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => onSelectDocument(d.id)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs rounded-sm border-l-[3px] transition-colors",
                      active ? "bg-primary/10 border-l-primary font-semibold text-foreground" : "border-l-transparent hover:bg-muted/50 text-foreground/90",
                    )}
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate flex-1">{d.name}</span>
                    {d.pageCount != null && <span className="text-muted-foreground shrink-0 tabular-nums">{d.pageCount}p</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
