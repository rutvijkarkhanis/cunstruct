import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import ProjectWorkflow from "@/components/ops/ProjectWorkflow";
import { FileText, Calculator, PackageSearch, Layers } from "lucide-react";

// Project overview — the workflow (DRAWING → AI → REVIEW → BOQ → EXPORT) is the
// first meaningful thing a new user sees here. The counts below it are a light
// secondary summary of the project's shape, not the headline.
export default function ProjectOverview() {
  const { id } = useParams<{ id: string }>();

  const { data } = useQuery({
    queryKey: ["project-overview", id],
    enabled: !!id,
    queryFn: async () => {
      const [docs, scopes, boqs] = await Promise.all([
        supabase.from("project_document").select("id, status", { count: "exact" }).eq("project_id", id!),
        supabase.from("project_scope").select("id", { count: "exact" }).eq("project_id", id!),
        supabase.from("boq").select("id, name", { count: "exact" }).eq("project_id", id!),
      ]);
      return {
        documents: docs.count ?? (docs.data?.length ?? 0),
        analysed: (docs.data ?? []).filter((d: { status: string }) => d.status === "analysed").length,
        scopes: scopes.count ?? (scopes.data?.length ?? 0),
        boqs: boqs.count ?? (boqs.data?.length ?? 0),
      };
    },
  });

  const cards = [
    { label: "Documents", value: data?.documents ?? 0, sub: `${data?.analysed ?? 0} analysed`, to: "documents", icon: FileText },
    { label: "Scopes", value: data?.scopes ?? 0, sub: "physical scopes", to: "boqs", icon: Layers },
    { label: "BOQs", value: data?.boqs ?? 0, sub: "bills of quantities", to: "boqs", icon: Calculator },
    { label: "Procurement", value: "—", sub: "coming soon", to: "procurement", icon: PackageSearch },
  ];

  return (
    <div className="space-y-5">
      <ProjectWorkflow hasDocuments={(data?.documents ?? 0) > 0} />

      {/* Secondary — a light shape-of-the-project summary, deliberately quieter
          (smaller type, muted rule) than the workflow above it. */}
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-2">At a glance</div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {cards.map((c) => (
            <Link key={c.label} to={c.to} className="rounded-md border px-3 py-2 hover:border-primary/40 transition-colors">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{c.label}</span>
                <c.icon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-lg font-semibold tabular-nums">{c.value}</span>
                <span className="text-[11px] text-muted-foreground">{c.sub}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
