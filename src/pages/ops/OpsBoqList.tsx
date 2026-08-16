import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { disciplineByKey } from "@/lib/disciplines";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Loader2, Plus, Calculator, Trash2 } from "lucide-react";

interface BoqRow { id: string; name: string; status: string; discipline: string; project_id: string | null; updated_at: string; }
interface LineRow { boq_id: string; qty: number; dsr_rate: number | null; custom_rate: number | null; included: boolean; }

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const GST = 0.18;

export default function OpsBoqList() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Deleting a BOQ removes its line items too (boq_line cascades on boq.id).
  const deleteBoq = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("boq").delete().eq("id", deleteTarget.id);
      if (error) throw error;
      toast.success(`Deleted "${deleteTarget.name}"`);
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["boq-list"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  const { data, isLoading } = useQuery({
    queryKey: ["boq-list"],
    queryFn: async () => {
      const { data: boqs, error } = await supabase.from("boq")
        .select("id, name, status, discipline, project_id, updated_at").order("updated_at", { ascending: false });
      if (error) throw error;
      const rows = (boqs ?? []) as BoqRow[];

      // Per-BOQ works total (sum of included lines at the effective rate).
      const totals = new Map<string, number>();
      if (rows.length) {
        const { data: lines } = await supabase.from("boq_line")
          .select("boq_id, qty, dsr_rate, custom_rate, included").in("boq_id", rows.map((r) => r.id));
        for (const l of (lines ?? []) as LineRow[]) {
          if (!l.included) continue;
          const rate = l.custom_rate ?? l.dsr_rate ?? 0;
          totals.set(l.boq_id, (totals.get(l.boq_id) ?? 0) + l.qty * rate);
        }
      }

      const ids = [...new Set(rows.map((r) => r.project_id).filter(Boolean))] as string[];
      const names = new Map<string, string>();
      if (ids.length) {
        const { data: projects } = await supabase.from("projects").select("id, name").in("id", ids);
        (projects ?? []).forEach((p: { id: string; name: string }) => names.set(p.id, p.name));
      }

      // Group by project (standalone bucketed under a null key).
      const groups = new Map<string, { name: string; boqs: (BoqRow & { works: number })[] }>();
      for (const r of rows) {
        const key = r.project_id ?? "__standalone";
        if (!groups.has(key)) groups.set(key, { name: r.project_id ? names.get(r.project_id) ?? "—" : "Standalone", boqs: [] });
        groups.get(key)!.boqs.push({ ...r, works: totals.get(r.id) ?? 0 });
      }
      return [...groups.values()];
    },
  });

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Calculator className="h-5 w-5" /> BOQ</h1>
          <p className="text-sm text-muted-foreground">Multi-discipline bills of quantities, rolled up per project.</p>
        </div>
        <Button onClick={() => navigate("/ops/boq/new")}><Plus className="h-4 w-4 mr-2" /> New BOQ</Button>
      </div>

      {isLoading ? (
        <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>
      ) : !data?.length ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          No BOQs yet. Click <b>New BOQ</b> to create one — pick a discipline (Civil, Electrical, Plumbing, HVAC, Fire).
        </CardContent></Card>
      ) : (
        data.map((g) => {
          const works = g.boqs.reduce((s, b) => s + b.works, 0);
          const grand = works * (1 + GST);
          return (
            <Card key={g.name}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{g.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {g.boqs.map((b) => (
                  <div key={b.id} className="flex items-center gap-3 py-2 border-b last:border-0 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded"
                    onClick={() => navigate(`/ops/boq/${b.id}`)}>
                    <Badge variant="secondary" className="shrink-0">{disciplineByKey(b.discipline).short}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{b.name}</div>
                    </div>
                    <Badge variant="outline" className="shrink-0">{b.status}</Badge>
                    <span className="text-sm tabular-nums w-28 text-right">{b.works > 0 ? inr(b.works) : "—"}</span>
                    <Button
                      size="icon" variant="ghost"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      title="Delete this BOQ"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: b.id, name: b.name }); }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {/* Grand abstract — d21 style */}
                <div className="mt-2 pt-2 border-t space-y-0.5 text-sm">
                  <div className="flex justify-between text-muted-foreground"><span>Total (excl. GST)</span><span className="tabular-nums">{inr(works)}</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>GST @ 18%</span><span className="tabular-nums">{inr(works * GST)}</span></div>
                  <div className="flex justify-between font-semibold"><span>Grand total</span><span className="tabular-nums">{inr(grand)}</span></div>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this BOQ?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <span className="font-medium">{deleteTarget?.name}</span> and all of its
              line items. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); deleteBoq(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
