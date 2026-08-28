import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Calculator, PackageSearch, Layers } from "lucide-react";

// Project overview — a light dashboard of the project's shape (documents, scopes,
// BOQs). Phase 2: counts + quick links. Richer coverage metrics come in Phase 4.
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
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <Link key={c.label} to={c.to}>
            <Card className="hover:border-primary/50 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{c.label}</span>
                  <c.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="mt-2 text-2xl font-bold tabular-nums">{c.value}</div>
                <div className="text-xs text-muted-foreground">{c.sub}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Getting started</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>1. Add the project drawings and documents in <Link to="documents" className="text-primary hover:underline">Documents</Link>.</p>
          <p>2. Define the BOQ structure in <Link to="boqs" className="text-primary hover:underline">BOQs</Link> — one scope can have several BOQs (e.g. Floor 2 → Architectural, Electrical, Plumbing).</p>
          <p>3. Open a BOQ to quantify, price and generate its outputs.</p>
        </CardContent>
      </Card>
    </div>
  );
}
