// PUBLIC WORKSPACE SHARE — the public, unauthenticated, read-only page a
// share link (see src/components/ops/workspace/ShareLinksDialog.tsx) points
// to. No login, no OpsLayout, no sidebar nav into /ops/* — this page is
// reachable with zero Supabase session at all, via the workspace-share Edge
// Function (service-role key server-side) as its only data source.
//
// Deliberately simpler than ProjectWorkspace.tsx: there is no mode switcher
// (no Review/Materials/Procurement contexts exist here) — just Sources +
// Canvas + BOQ, always all three, since that's the entirety of what a share
// link exposes.

import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Menu, PanelRight, X, AlertTriangle } from "lucide-react";
import ShareWorkspaceSources from "@/components/share/ShareWorkspaceSources";
import ShareWorkspaceCanvas from "@/components/share/ShareWorkspaceCanvas";
import ShareBoqPanel from "@/components/share/ShareBoqPanel";
import { parsePublicShareQuery, buildPublicShareQuery } from "@/lib/review/publicShareState";
import type { ShareSourceDoc, ShareScope, ShareBoqSummary } from "../../supabase/functions/workspace-share/handler";

interface BootstrapResponse {
  ok: boolean;
  project?: { id: string; name: string };
  documents?: ShareSourceDoc[];
  scopes?: ShareScope[];
  boqs?: ShareBoqSummary[];
  error?: string;
}

export default function PublicWorkspaceShare() {
  const { token } = useParams<{ token: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = parsePublicShareQuery(searchParams);
  const [mobilePanel, setMobilePanel] = useState<"sources" | "canvas" | "context">(state.document ? "canvas" : "sources");

  const { data, isLoading } = useQuery({
    queryKey: ["public-share-bootstrap", token],
    enabled: !!token,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<BootstrapResponse>("workspace-share", {
        body: { token, action: "bootstrap" },
      });
      if (error) return { ok: false, error: "This link is no longer available." } as BootstrapResponse;
      return data;
    },
  });

  const onSelectDocument = (documentId: string) => {
    setSearchParams(buildPublicShareQuery({ ...state, document: documentId, page: null }), { replace: true });
    setMobilePanel("canvas");
  };

  if (!token) return null;

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (!data?.ok) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-sm text-center space-y-3">
          <AlertTriangle className="w-8 h-8 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">This link is no longer available.</p>
        </div>
      </div>
    );
  }

  const documents = data.documents ?? [];
  const boqs = data.boqs ?? [];

  return (
    <div className="flex flex-col h-[100dvh] lg:h-screen min-h-0 bg-background">
      <header className="shrink-0 flex items-center gap-2 px-3 py-2 border-b bg-card">
        <div className="min-w-0 flex items-baseline gap-1.5 text-sm">
          <span className="font-semibold truncate">{data.project?.name ?? "Project"}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground truncate">Shared, view-only</span>
        </div>
        <div className="ml-auto flex items-center gap-1 lg:hidden">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setMobilePanel("sources")} aria-label="Sources" title="Sources">
            <Menu className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setMobilePanel("context")} aria-label="BOQ" title="BOQ">
            <PanelRight className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Desktop — all three panes at once, same layout convention as
          ProjectWorkspace.tsx's own desktop columns. */}
      <div className="hidden lg:flex flex-1 min-h-0">
        <div className="w-56 shrink-0 min-h-0">
          <ShareWorkspaceSources documents={documents} activeDocumentId={state.document} onSelectDocument={onSelectDocument} />
        </div>
        <ShareWorkspaceCanvas token={token} documentId={state.document} page={state.page} />
        <div className="w-72 shrink-0 min-h-0 border-l overflow-y-auto">
          <ShareBoqPanel token={token} boqs={boqs} />
        </div>
      </div>

      {/* Mobile — one pane at a time, same drill-down convention as
          ProjectWorkspace.tsx. */}
      <div className="flex lg:hidden flex-1 min-h-0">
        {mobilePanel === "sources" && (
          <ShareWorkspaceSources documents={documents} activeDocumentId={state.document} onSelectDocument={onSelectDocument} />
        )}
        {mobilePanel === "canvas" && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="shrink-0 flex items-center justify-between px-2 py-1.5 border-b bg-card">
              <Button variant="ghost" size="sm" className="gap-1 h-7 px-2" onClick={() => setMobilePanel("sources")}>Sources</Button>
              <Button variant="ghost" size="sm" className="gap-1 h-7 px-2" onClick={() => setMobilePanel("context")}>
                BOQ <PanelRight className="w-3.5 h-3.5" />
              </Button>
            </div>
            <ShareWorkspaceCanvas token={token} documentId={state.document} page={state.page} />
          </div>
        )}
        {mobilePanel === "context" && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="shrink-0 flex items-center justify-end px-2 py-1.5 border-b bg-card">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setMobilePanel(state.document ? "canvas" : "sources")} aria-label="Close">
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <ShareBoqPanel token={token} boqs={boqs} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
