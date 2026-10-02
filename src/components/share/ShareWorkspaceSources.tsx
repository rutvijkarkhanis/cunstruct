// SHARE SOURCES RAIL — the read-only equivalent of
// src/components/ops/workspace/WorkspaceSources.tsx, for the public,
// unauthenticated share link. Deliberately forked rather than given a
// `readOnly` prop: this file never imports useDocumentManagement or
// WorkspaceSourceManager at all, so "no upload/delete" is structural, not a
// hidden button — a page an anonymous visitor can reach must never even
// import the authenticated-client CRUD path, conditionally rendered or not.
//
// Data comes from the workspace-share Edge Function's "bootstrap" response
// (already fetched by PublicWorkspaceShare.tsx), not a direct Supabase query
// — this component is presentation-only.

import { cn } from "@/lib/utils";
import { FileText } from "lucide-react";
import { groupSourcesByDiscipline, type SourceDocument } from "@/lib/review/workspaceSources";

export interface ShareWorkspaceSourcesProps {
  documents: SourceDocument[];
  activeDocumentId: string | null;
  onSelectDocument: (documentId: string) => void;
}

export default function ShareWorkspaceSources({ documents, activeDocumentId, onSelectDocument }: ShareWorkspaceSourcesProps) {
  const groups = groupSourcesByDiscipline(documents);

  return (
    <div className="flex flex-col w-full h-full min-h-0 border-r bg-card">
      <div className="px-3 py-2.5 border-b shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sources</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-3 min-h-0">
        {groups.length === 0 && (
          <div className="text-xs text-muted-foreground px-1 py-2">No drawings available.</div>
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
