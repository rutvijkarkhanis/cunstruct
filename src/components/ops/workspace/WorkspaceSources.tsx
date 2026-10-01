// SOURCES RAIL — Phase 11 Stage B. Reuses the EXISTING project_document /
// document_revision data model verbatim (the same tables ProjectDocuments.tsx
// already owns) — this component only READS and groups them for selection;
// all upload/rename/delete/folder CRUD stays on the existing Documents page,
// reached here through a single "Manage" link rather than being rebuilt.
//
// Compact, Phase-9/10-styled list (border-l accent on the active row, same
// convention as BoqReviewWorkstation's type/category rows) — not a card grid,
// not a dashboard table.

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { FileText, Settings, Upload } from "lucide-react";
import { groupSourcesByDiscipline, type SourceDocument } from "@/lib/review/workspaceSources";

export interface WorkspaceSourcesProps {
  projectId: string;
  activeDocumentId: string | null;
  onSelectDocument: (documentId: string) => void;
}

export default function WorkspaceSources({ projectId, activeDocumentId, onSelectDocument }: WorkspaceSourcesProps) {
  const { data: documents, isLoading } = useQuery({
    queryKey: ["workspace-sources", projectId],
    enabled: !!projectId,
    queryFn: async (): Promise<SourceDocument[]> => {
      const { data: docs } = await supabase.from("project_document")
        .select("id, name, doc_type, discipline, status, current_revision_id")
        .eq("project_id", projectId).order("created_at");
      // Resolve each document's CURRENT revision's page count, if any —
      // never a different/older revision, matching the same current-
      // revision convention ProjectDocuments.tsx and drawingStorage.ts use.
      const revIds = (docs ?? []).map((d) => d.current_revision_id).filter((x): x is string => !!x);
      const { data: currentRevs } = revIds.length
        ? await supabase.from("document_revision").select("id, page_count").in("id", revIds)
        : { data: [] as { id: string; page_count: number | null }[] };
      const pageCountByRevId = new Map((currentRevs ?? []).map((r) => [r.id, r.page_count]));
      return (docs ?? []).map((d) => ({
        id: d.id as string,
        name: d.name as string,
        docType: (d.doc_type as string | null) ?? null,
        discipline: (d.discipline as string | null) ?? null,
        status: (d.status as string) ?? "uploaded",
        pageCount: d.current_revision_id ? pageCountByRevId.get(d.current_revision_id as string) ?? null : null,
      }));
    },
  });

  const groups = groupSourcesByDiscipline(documents ?? []);
  const manageHref = `/ops/projects/${projectId}/documents`;

  return (
    <div className="flex flex-col w-full h-full min-h-0 border-r bg-card">
      <div className="px-3 py-2.5 border-b flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sources</span>
        <Link to={manageHref} className="text-muted-foreground hover:text-foreground transition-colors" title="Manage documents" aria-label="Manage documents">
          <Settings className="w-3.5 h-3.5" />
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-3 min-h-0">
        {isLoading && <div className="text-xs text-muted-foreground px-1 py-1">Loading…</div>}
        {!isLoading && groups.length === 0 && (
          <div className="text-xs text-muted-foreground px-1 py-2 space-y-2">
            <p>No drawings uploaded yet.</p>
            <Link to={manageHref} className="inline-flex items-center gap-1 text-primary hover:underline">
              <Upload className="w-3 h-3" /> Upload a drawing
            </Link>
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
