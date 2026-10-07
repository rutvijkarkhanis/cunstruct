// PROJECT WORKSPACE — Phase 11 Stage B shell.
//
// "One project. One workspace. One drawing as the primary object." The
// drawing stays the visual center of gravity; Documents/Review/BOQ/
// Materials/Procurement become contextual MODES around it rather than
// separate pages. This file composes EXISTING data/components — it owns no
// new persistence, no second document/BOQ/Review model (see workspaceState.ts,
// WorkspaceSources.tsx, WorkspaceCanvas.tsx, WorkspaceContext.tsx).
//
// mode="review" is a full takeover: the existing, UNMODIFIED
// BoqReviewWorkstation already supplies its own drawing canvas + rail +
// inspector (that IS the approved Phase 9/10 layout) — rendering the
// generic Sources/Canvas/Context columns around it would only duplicate
// that UI. Every other mode uses the generic 3-column shell below.

import { useParams, useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ClipboardCheck, Menu, PanelRight, Share2, X } from "lucide-react";
import BoqReviewWorkstation from "./BoqReviewWorkstation";
import WorkspaceSources from "@/components/ops/workspace/WorkspaceSources";
import WorkspaceSourceManager from "@/components/ops/workspace/WorkspaceSourceManager";
import WorkspaceCanvas from "@/components/ops/workspace/WorkspaceCanvas";
import WorkspaceContext from "@/components/ops/workspace/WorkspaceContext";
import { useProjectBoqs, useMostRecentlyAnalyzedBoqId } from "@/hooks/useProjectBoqs";
import ShareLinksDialog from "@/components/ops/workspace/ShareLinksDialog";
import { parseWorkspaceQuery, buildWorkspaceQuery, type WorkspaceMode } from "@/lib/review/workspaceState";

export default function ProjectWorkspace() {
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = parseWorkspaceQuery(searchParams);

  const updateQuery = (patch: Partial<ReturnType<typeof parseWorkspaceQuery>>) => {
    const next = { ...state, ...patch };
    setSearchParams(buildWorkspaceQuery(next), { replace: true });
  };

  const { data: project } = useQuery({
    queryKey: ["workspace-project", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, name").eq("id", projectId!).single();
      return data ?? null;
    },
  });

  // Same query (and queryKey) DrawingHome's own "Review" button already
  // uses to decide whether Review is reachable — reused here, not
  // duplicated-with-different-logic, so the mobile canvas CTA below and the
  // Context panel's CTA can never disagree about whether a BOQ exists.
  const { data: boqs } = useProjectBoqs(projectId ?? "");
  const defaultBoq = boqs?.[0] ?? null;
  // Which boq_id the CTA below actually opens — the project's most recently
  // analyzed BOQ when one exists (same hook DrawingHome's own "Review"
  // button now uses, so the two can never disagree), else defaultBoq
  // (newest-created) exactly as before. The CTA's own visibility still
  // gates on defaultBoq (any boq at all), unchanged.
  const { data: analyzedBoqId } = useMostRecentlyAnalyzedBoqId(projectId ?? "");
  const reviewBoqId = analyzedBoqId ?? defaultBoq?.id ?? null;

  // Mobile-only drill-down panel — pure UI state, never persisted/shared:
  // which of the three panes is currently full-screen on a narrow viewport.
  // Desktop (lg+) ignores this and shows all three at once.
  //
  // Stage C3: a non-drawing mode (boq/materials/procurement) deep link —
  // e.g. ?mode=boq with no document selected yet, a real case once BOQ
  // context no longer requires an existing BOQ — must land on Context, not
  // be forced back to Sources just because nothing is open in the canvas.
  // "drawing" mode keeps its original document-driven behavior untouched.
  //
  // Stage C4: mode="documents" (the /documents redirect's landing state)
  // opens the Sources drawer rather than the Context panel — once the
  // drawer closes, Sources (not Context) is the natural pane underneath.
  const initialMobilePanel = state.mode === "documents" ? "sources" : state.mode !== "drawing" ? "context" : state.document ? "canvas" : "sources";
  const [mobilePanel, setMobilePanel] = useState<"sources" | "canvas" | "context">(initialMobilePanel);
  useEffect(() => {
    if (state.mode === "drawing" && !state.document) setMobilePanel("sources");
  }, [state.document, state.mode]);

  // Source-management drawer — local UI state only, never part of the URL.
  // Opening/closing it must never disturb ?document=&page=&mode=&boq=, so the
  // drawing underneath is exactly as the user left it when the drawer closes.
  //
  // Stage C4: mode="documents" is how the old /documents route now redirects
  // here (?mode=documents). It isn't a sustained contextual mode like
  // boq/materials/procurement — it's a one-shot trigger that opens this same
  // drawer, then the URL immediately normalizes back to the default
  // ("drawing") so reloading/sharing the link doesn't re-trigger it and the
  // URL honestly reflects that the drawer is just local UI state.
  const [sourceManagerOpen, setSourceManagerOpen] = useState(state.mode === "documents");
  useEffect(() => {
    if (state.mode === "documents") {
      setSourceManagerOpen(true);
      updateQuery({ mode: "drawing" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mode]);

  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  const onSelectDocument = (documentId: string) => {
    updateQuery({ document: documentId, page: null });
    setMobilePanel("canvas");
  };

  const onEnterMode = (mode: WorkspaceMode, boqId?: string) => {
    updateQuery({ mode, boq: boqId ?? state.boq });
    if (mode !== "drawing") setMobilePanel("context");
  };

  if (!projectId) return null;

  // Review takes over the full workspace body — see file header. A missing
  // `boq` here (e.g. a stale/typed deep link) falls back to the mode
  // switcher's own honest "no BOQ yet" state rather than rendering Review
  // with nothing to review.
  if (state.mode === "review" && state.boq) {
    return <BoqReviewWorkstation boqId={state.boq} />;
  }

  return (
    <div className="flex flex-col h-[100dvh] lg:h-screen min-h-0 bg-background">
      <header className="shrink-0 flex items-center gap-2 px-3 py-2 border-b bg-card">
        {/* Stage C1: Workspace IS the project home now (the bare project
            root redirects here) — linking back to that root would just
            redirect right back to this page. Projects is the real "up"
            destination. */}
        <Link to="/ops/projects" className="text-muted-foreground hover:text-foreground" aria-label="Back to projects">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="min-w-0 flex items-baseline gap-1.5 text-sm">
          <span className="font-semibold truncate">{project?.name ?? "Project"}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground truncate">Workspace</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2" onClick={() => setShareDialogOpen(true)}>
            <Share2 className="w-3.5 h-3.5" /> Share
          </Button>
          <div className="flex items-center gap-1 lg:hidden">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setMobilePanel("sources")} aria-label="Sources" title="Sources">
              <Menu className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setMobilePanel("context")} aria-label="Context" title="Context">
              <PanelRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <ShareLinksDialog projectId={projectId} open={shareDialogOpen} onOpenChange={setShareDialogOpen} />

      {/* Desktop — all three panes at once; the drawing gets the majority
          of the width (Sources/Context are fixed, compact rails). */}
      <div className="hidden lg:flex flex-1 min-h-0">
        <div className="w-56 shrink-0 min-h-0">
          <WorkspaceSources
            projectId={projectId}
            activeDocumentId={state.document}
            onSelectDocument={onSelectDocument}
            onManageSources={() => setSourceManagerOpen(true)}
          />
        </div>
        <WorkspaceCanvas documentId={state.document} page={state.page} />
        <div className="w-72 shrink-0 min-h-0">
          <WorkspaceContext
            mode={state.mode === "review" || state.mode === "documents" ? "drawing" : state.mode}
            projectId={projectId}
            activeDocumentId={state.document}
            activeBoqId={state.boq}
            onEnterMode={onEnterMode}
          />
        </div>
      </div>

      {/* Mobile — deliberate drill-down: one pane at a time, never the
          desktop columns compressed. */}
      <div className="flex lg:hidden flex-1 min-h-0">
        {mobilePanel === "sources" && (
          <WorkspaceSources
            projectId={projectId}
            activeDocumentId={state.document}
            onSelectDocument={(docId) => { onSelectDocument(docId); }}
            onManageSources={() => setSourceManagerOpen(true)}
          />
        )}
        {mobilePanel === "canvas" && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="shrink-0 flex items-center justify-between px-2 py-1.5 border-b bg-card">
              <Button variant="ghost" size="sm" className="gap-1 h-7 px-2" onClick={() => setMobilePanel("sources")}>
                <ArrowLeft className="w-3.5 h-3.5" /> Sources
              </Button>
              <Button variant="ghost" size="sm" className="gap-1 h-7 px-2" onClick={() => setMobilePanel("context")}>
                Context <PanelRight className="w-3.5 h-3.5" />
              </Button>
            </div>
            {/* Mobile-only CTA: the drawing canvas here is intentionally a
                read-only source viewer — it has no Identify of its own (see
                WorkspaceCanvas.tsx's own header comment) — so without this,
                a mobile visitor has no on-screen indication that Review
                (full drawing canvas + Click-to-Identify) is one tap away
                behind the generic, unlabeled "Context" button above. Reuses
                onEnterMode exactly as DrawingHome's own "Review" button
                does (same mode/boqId, same takeover at the top of this
                component) — no new navigation path, no Identify logic here.
                Targets reviewBoqId (the project's analyzed BOQ when one
                exists, else the newest one) rather than always assuming the
                newest-created BOQ is reviewable — see
                useMostRecentlyAnalyzedBoqId. Still gated on defaultBoq (any
                boq at all) so it never offers a Review when the project has
                none. Desktop is untouched — the right rail there already
                shows this same Review entry permanently. */}
            {defaultBoq && (
              <div className="shrink-0 border-b bg-card px-2 py-2">
                <Button
                  size="sm" className="w-full h-9 gap-1.5"
                  onClick={() => reviewBoqId && onEnterMode("review", reviewBoqId)}
                >
                  <ClipboardCheck className="w-4 h-4" /> Review &amp; Identify
                </Button>
              </div>
            )}
            <WorkspaceCanvas documentId={state.document} page={state.page} />
          </div>
        )}
        {mobilePanel === "context" && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="shrink-0 flex items-center justify-end px-2 py-1.5 border-b bg-card">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setMobilePanel(state.document ? "canvas" : "sources")} aria-label="Close context">
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
            <WorkspaceContext
              mode={state.mode === "review" || state.mode === "documents" ? "drawing" : state.mode}
              projectId={projectId}
              activeDocumentId={state.document}
              activeBoqId={state.boq}
              onEnterMode={onEnterMode}
            />
          </div>
        )}
      </div>

      <WorkspaceSourceManager
        projectId={projectId}
        open={sourceManagerOpen}
        onOpenChange={setSourceManagerOpen}
        activeDocumentId={state.document}
        onSelectDocument={onSelectDocument}
      />
    </div>
  );
}
