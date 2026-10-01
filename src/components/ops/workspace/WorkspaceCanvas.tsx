// DRAWING CANVAS — Phase 11 Stage B. Thin wrapper around the EXISTING
// PdfEvidenceViewer (Phase 9/10) — no second PDF renderer. Resolves the
// active document's current revision to a signed URL via the existing
// drawingStorage.ts helper, then hands rendering/zoom/fit/page-nav entirely
// to PdfEvidenceViewer, unmodified.
//
// Outside Review mode there is no AI evidence/geometry to show (no analysis
// item is selected), so `source` carries only the requested initial page —
// PdfEvidenceViewer already renders that honestly as a bare page view with
// no overlays, exactly the behavior it has always had for a source with no
// evidence.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { signedDrawingUrl } from "@/lib/review/drawingStorage";
import PdfEvidenceViewer from "@/components/review/PdfEvidenceViewer";
import { FileText } from "lucide-react";

export interface WorkspaceCanvasProps {
  documentId: string | null;
  /** Initial page only — PdfEvidenceViewer owns page navigation internally
   *  once mounted (it has no page-change callback), so this seeds the
   *  deep-linked page but doesn't stay synced afterward. */
  page: number | null;
}

export default function WorkspaceCanvas({ documentId, page }: WorkspaceCanvasProps) {
  const { data: doc } = useQuery({
    queryKey: ["workspace-canvas-doc", documentId],
    enabled: !!documentId,
    queryFn: async () => {
      const { data: d } = await supabase.from("project_document")
        .select("id, name, current_revision_id").eq("id", documentId!).single();
      if (!d?.current_revision_id) return { name: (d?.name as string | undefined) ?? null, filePath: null, pageTitles: null as Record<string, string> | null };
      const { data: rev } = await supabase.from("document_revision")
        .select("file_path, page_titles").eq("id", d.current_revision_id as string).single();
      return {
        name: d.name as string,
        filePath: (rev?.file_path as string | undefined) ?? null,
        pageTitles: (rev?.page_titles as Record<string, string> | null | undefined) ?? null,
      };
    },
  });

  const { data: fileUrl } = useQuery({
    queryKey: ["workspace-canvas-url", doc?.filePath],
    enabled: !!doc?.filePath,
    queryFn: () => signedDrawingUrl(doc!.filePath!),
  });

  if (!documentId) {
    return (
      <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <FileText className="w-6 h-6 text-muted-foreground/60" />
        <span>Select a drawing from Sources to begin.</span>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 min-h-0 h-full p-2">
      <PdfEvidenceViewer
        fileUrl={fileUrl ?? null}
        source={page ? { page, evidence: [] } : undefined}
        documentName={doc?.name ?? null}
        pageTitles={doc?.pageTitles ?? null}
      />
    </div>
  );
}
