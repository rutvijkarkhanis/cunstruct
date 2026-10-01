// CONTEXT PANEL — Phase 11 Stage B. Mode-switched right-hand panel.
//
// "review" is NOT handled here — ProjectWorkspace renders the existing,
// unmodified BoqReviewWorkstation full-bleed for that mode (it already
// supplies its own drawing canvas + rail + inspector; this panel would only
// duplicate it). This component covers the remaining four modes: the
// drawing-mode "home" (mode switcher + document info), BOQ summary,
// Materials (real catalog_product_id linkage only), and an honest
// Procurement placeholder.
//
// Reuses EXISTING tables/columns exactly as discovered in the Phase 11
// architecture review — boq/boq_line (OpsBoqBuilder's own data layer),
// products_master (ProductPicker's own catalog). No new persistence.

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { supabase as catalogSupabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { ClipboardCheck, Calculator, PackageSearch, Boxes, FileText } from "lucide-react";
import { formatINR } from "@/lib/forecastEngine";
import type { WorkspaceMode } from "@/lib/review/workspaceState";
import WorkspaceBoqPanel from "./WorkspaceBoqPanel";

export interface WorkspaceContextProps {
  mode: Exclude<WorkspaceMode, "review">;
  projectId: string;
  activeDocumentId: string | null;
  activeBoqId: string | null;
  onEnterMode: (mode: WorkspaceMode, boqId?: string) => void;
}

export default function WorkspaceContext({ mode, projectId, activeDocumentId, activeBoqId, onEnterMode }: WorkspaceContextProps) {
  return (
    <div className="flex flex-col w-full h-full min-h-0 border-l bg-card">
      <div className="px-3 py-2.5 border-b shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {mode === "drawing" ? "Workspace" : mode === "boq" ? "BOQ" : mode === "materials" ? "Materials" : "Procurement"}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 min-h-0">
        {mode === "drawing" && <DrawingHome projectId={projectId} activeDocumentId={activeDocumentId} onEnterMode={onEnterMode} />}
        {mode === "boq" && <WorkspaceBoqPanel projectId={projectId} activeBoqId={activeBoqId} onEnterMode={onEnterMode} />}
        {mode === "materials" && <MaterialsPanel projectId={projectId} activeBoqId={activeBoqId} />}
        {mode === "procurement" && <ProcurementPlaceholder />}
      </div>
    </div>
  );
}

function useProjectBoqs(projectId: string) {
  return useQuery({
    queryKey: ["workspace-project-boqs", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from("boq").select("id, name, created_at").eq("project_id", projectId).order("created_at", { ascending: false });
      return data ?? [];
    },
  });
}

function useActiveDocumentInfo(activeDocumentId: string | null) {
  return useQuery({
    queryKey: ["workspace-active-doc-info", activeDocumentId],
    enabled: !!activeDocumentId,
    queryFn: async () => {
      const { data } = await supabase.from("project_document").select("id, name, doc_type, discipline, status").eq("id", activeDocumentId!).single();
      return data ?? null;
    },
  });
}

/** mode="drawing" — the workspace's own home panel: what's open, and quick
 *  entry into the other contexts. Never fabricates a BOQ to review — if the
 *  project has none yet, says so and points at the existing BOQ list. */
function DrawingHome({ projectId, activeDocumentId, onEnterMode }: { projectId: string; activeDocumentId: string | null; onEnterMode: WorkspaceContextProps["onEnterMode"] }) {
  const { data: boqs } = useProjectBoqs(projectId);
  const { data: docInfo } = useActiveDocumentInfo(activeDocumentId);
  const defaultBoq = boqs?.[0] ?? null;

  return (
    <div className="space-y-4">
      {activeDocumentId ? (
        <div className="rounded border p-2.5 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
            {docInfo?.name ?? "Drawing"}
          </div>
          {(docInfo?.discipline || docInfo?.doc_type) && (
            <div className="text-[11px] text-muted-foreground">{docInfo?.discipline ?? docInfo?.doc_type}</div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No drawing selected yet.</p>
      )}

      <div className="space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Contexts</div>
        <Button
          variant="outline" size="sm" className="w-full justify-start gap-2"
          disabled={!defaultBoq}
          onClick={() => defaultBoq && onEnterMode("review", defaultBoq.id)}
        >
          <ClipboardCheck className="w-3.5 h-3.5" /> Review
        </Button>
        {/* Unlike Review/Materials, BOQ is always reachable — even with zero
            BOQs yet, since WorkspaceBoqPanel itself shows the honest "no BOQ
            yet, create one" state rather than needing an existing BOQ first. */}
        <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={() => onEnterMode("boq", defaultBoq?.id)}>
          <Calculator className="w-3.5 h-3.5" /> BOQ
        </Button>
        <Button variant="outline" size="sm" className="w-full justify-start gap-2" disabled={!defaultBoq} onClick={() => defaultBoq && onEnterMode("materials", defaultBoq.id)}>
          <Boxes className="w-3.5 h-3.5" /> Materials
        </Button>
        <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={() => onEnterMode("procurement")}>
          <PackageSearch className="w-3.5 h-3.5" /> Procurement
        </Button>
        {!defaultBoq && (
          <p className="text-[11px] text-muted-foreground pt-1">
            This project has no BOQ yet — open <b>BOQ</b> above to create one, which also unlocks Review and Materials.
          </p>
        )}
      </div>
    </div>
  );
}

/** mode="materials" — surfaces ONLY the real, already-populated
 *  boq_line.catalog_product_id / catalog_price linkage joined against the
 *  real products_master catalog. No procurement workflow, no invented
 *  supplier relationships — an honest empty state when nothing is linked
 *  yet (today's reality for every BOQ built through OpsBoqBuilder, since
 *  only the orphaned, unrouted quote-builder page ever wrote this column). */
function MaterialsPanel({ projectId, activeBoqId }: { projectId: string; activeBoqId: string | null }) {
  const { data: boqs } = useProjectBoqs(projectId);
  const boqId = activeBoqId ?? boqs?.[0]?.id ?? null;

  const { data: linkedLines, isLoading } = useQuery({
    queryKey: ["workspace-materials-lines", boqId],
    enabled: !!boqId,
    queryFn: async () => {
      const { data } = await supabase.from("boq_line")
        .select("id, description, catalog_product_id, catalog_price, unit, qty")
        .eq("boq_id", boqId!).not("catalog_product_id", "is", null);
      return data ?? [];
    },
  });

  const productIds = (linkedLines ?? []).map((l) => l.catalog_product_id as string).filter(Boolean);
  const { data: products } = useQuery({
    queryKey: ["workspace-materials-products", productIds.join(",")],
    enabled: productIds.length > 0,
    queryFn: async () => {
      const { data } = await catalogSupabase.from("products_master").select("id, name, selling_price, unit, brand").in("id", productIds);
      return data ?? [];
    },
  });
  const productById = new Map((products ?? []).map((p) => [p.id, p]));

  if (!boqId) {
    return <p className="text-xs text-muted-foreground">No BOQ to show materials for yet.</p>;
  }
  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (!linkedLines || linkedLines.length === 0) {
    return (
      <div className="text-xs text-muted-foreground space-y-2">
        <p>No BOQ lines are linked to a catalog product yet.</p>
        <p>Materials appear here once a line is matched to a real product — nothing is inferred.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {linkedLines.map((line) => {
        const product = line.catalog_product_id ? productById.get(line.catalog_product_id) : null;
        return (
          <div key={line.id} className="rounded border p-2 space-y-0.5">
            <div className="text-xs font-medium truncate">{product?.name ?? "Linked product"}</div>
            <div className="text-[11px] text-muted-foreground truncate">{line.description}</div>
            <div className="text-[11px] text-muted-foreground">
              {line.qty} {line.unit} · {line.catalog_price != null ? formatINR(line.catalog_price) : (product?.selling_price != null ? formatINR(product.selling_price) : "—")}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** mode="procurement" — explicitly, honestly a placeholder. No procurement
 *  schema exists yet; this must never imply otherwise. */
function ProcurementPlaceholder() {
  return (
    <div className="text-center py-6 space-y-2">
      <PackageSearch className="w-6 h-6 mx-auto text-muted-foreground/60" />
      <p className="text-sm font-medium">Procurement</p>
      <p className="text-xs text-muted-foreground max-w-[220px] mx-auto">
        Procurement workflows are not connected to this project workspace yet.
      </p>
    </div>
  );
}
