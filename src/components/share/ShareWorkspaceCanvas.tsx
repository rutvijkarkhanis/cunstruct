// SHARE CANVAS — the read-only equivalent of
// src/components/ops/workspace/WorkspaceCanvas.tsx, for the public,
// unauthenticated share link. Renders the EXISTING PdfEvidenceViewer
// unmodified (it's already pure/read-only — fileUrl/source/documentName/
// pageTitles props only, no mutating callbacks to strip).
//
// The one real difference from WorkspaceCanvas.tsx: a signed drawing URL
// cannot be obtained via the client-side signedDrawingUrl() helper here —
// that helper rides on the CALLER's own auth.uid() under storage RLS, and an
// anonymous visitor has no session for it to check. Instead this resolves
// the URL through the workspace-share Edge Function's "drawing_url" action,
// which validates the share token server-side (service-role key) before
// signing anything.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PdfEvidenceViewer from "@/components/review/PdfEvidenceViewer";
import { FileText } from "lucide-react";

export interface ShareWorkspaceCanvasProps {
  token: string;
  documentId: string | null;
  /** Initial page only — PdfEvidenceViewer owns page navigation internally
   *  once mounted, same convention as WorkspaceCanvas.tsx. */
  page: number | null;
}

interface DrawingUrlResponse {
  ok: boolean;
  name?: string;
  pageTitles?: Record<string, string> | null;
  fileUrl?: string;
  error?: string;
}

export default function ShareWorkspaceCanvas({ token, documentId, page }: ShareWorkspaceCanvasProps) {
  const { data } = useQuery({
    queryKey: ["share-canvas-url", token, documentId],
    enabled: !!documentId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<DrawingUrlResponse>("workspace-share", {
        body: { token, action: "drawing_url", documentId },
      });
      if (error || !data?.ok) return null;
      return data;
    },
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
        fileUrl={data?.fileUrl ?? null}
        source={page ? { page, evidence: [] } : undefined}
        documentName={data?.name ?? null}
        pageTitles={data?.pageTitles ?? null}
      />
    </div>
  );
}
