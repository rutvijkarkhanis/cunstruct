import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Plus, Calculator } from "lucide-react";

interface BoqRow { id: string; name: string; status: string; project_id: string | null; updated_at: string; }

export default function OpsBoqList() {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["boq-list"],
    queryFn: async () => {
      const { data: boqs, error } = await supabase.from("boq")
        .select("id, name, status, project_id, updated_at").order("updated_at", { ascending: false });
      if (error) throw error;
      const rows = (boqs ?? []) as BoqRow[];
      const ids = [...new Set(rows.map((r) => r.project_id).filter(Boolean))] as string[];
      const names = new Map<string, string>();
      if (ids.length) {
        const { data: projects } = await supabase.from("projects").select("id, name").in("id", ids);
        (projects ?? []).forEach((p: { id: string; name: string }) => names.set(p.id, p.name));
      }
      return rows.map((r) => ({ ...r, projectName: r.project_id ? names.get(r.project_id) ?? "—" : "Standalone" }));
    },
  });

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Calculator className="h-5 w-5" /> DSR BOQ</h1>
          <p className="text-sm text-muted-foreground">Full-scale bills of quantities built from the DSR knowledge bank.</p>
        </div>
        <Button onClick={() => navigate("/ops/boq/new")}><Plus className="h-4 w-4 mr-2" /> New BOQ</Button>
      </div>

      {isLoading ? (
        <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>
      ) : !data?.length ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          No BOQs yet. Click <b>New BOQ</b> to run the questionnaire and generate one.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {data.map((b) => (
            <Card key={b.id} className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => navigate(`/ops/boq/${b.id}`)}>
              <CardContent className="py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{b.name}</div>
                  <div className="text-xs text-muted-foreground">{b.projectName}</div>
                </div>
                <Badge variant="outline">{b.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
