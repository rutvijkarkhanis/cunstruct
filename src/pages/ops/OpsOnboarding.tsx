import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PackagePlus, Check, X } from "lucide-react";
import { toast } from "sonner";
import { InfoHint } from "@/components/InfoHint";
import { NOTE } from "@/lib/boqGlossary";

const STATUSES = ["open", "onboarded", "dismissed"];

export default function OpsOnboarding() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("open");

  const { data: gaps } = useQuery({
    queryKey: ["catalog-gaps", status],
    queryFn: async () => {
      const { data } = await supabase
        .from("catalog_gaps")
        .select("*, stage_master:stage_id(name), projects:project_id(name)")
        .eq("status", status)
        .order("created_at", { ascending: false })
        .limit(2000);
      return data ?? [];
    },
  });

  // Group by item name so the highest-demand gaps rise to the top.
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; count: number; qty: number; unit: string | null; ids: string[]; projects: Set<string> }>();
    (gaps ?? []).forEach((g: any) => {
      const key = (g.item_name ?? "").toLowerCase();
      const cur = map.get(key) ?? { name: g.item_name, count: 0, qty: 0, unit: g.unit, ids: [], projects: new Set<string>() };
      cur.count += 1;
      cur.qty += Number(g.requested_qty) || 0;
      cur.ids.push(g.id);
      if ((g as any).projects?.name) cur.projects.add((g as any).projects.name);
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [gaps]);

  const setStatusFor = async (ids: string[], newStatus: string) => {
    const { error } = await supabase.from("catalog_gaps").update({ status: newStatus }).in("id", ids);
    if (error) return toast.error(error.message);
    toast.success(`${ids.length} marked ${newStatus}`);
    qc.invalidateQueries({ queryKey: ["catalog-gaps"] });
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PackagePlus className="w-6 h-6" /> Onboarding queue
            <InfoHint title="What lands here?" width="w-96">
              <p>{NOTE.onboard}</p>
              <p className="pt-1">Rows are grouped by item and ranked by <b>demand</b> (how many BOQs asked for it), so you expand the catalog where it pays off most. Mark <b>Onboarded</b> once you stock it, or <b>Dismiss</b> if it's not worth carrying.</p>
            </InfoHint>
          </h1>
          <p className="text-sm text-muted-foreground">
            Materials contractors need that aren't in the catalog yet. Onboard the high-demand ones first.
          </p>
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40 capitalize"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {grouped.length === 0 ? (
        <Card className="p-12 text-center text-muted-foreground">
          Nothing {status}. Missing BOQ items land here as contractors build their bills of quantities.
        </Card>
      ) : (
        <div className="space-y-2">
          {grouped.map((g) => (
            <Card key={g.name} className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium flex items-center gap-2">
                    {g.name}
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                      {g.count} request{g.count === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ~{g.qty.toLocaleString("en-IN")} {g.unit ?? ""} total demand
                    {g.projects.size > 0 && ` · ${g.projects.size} project${g.projects.size === 1 ? "" : "s"}`}
                  </div>
                </div>
                {status === "open" && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => setStatusFor(g.ids, "onboarded")}>
                      <Check className="w-4 h-4" /> Onboarded
                    </Button>
                    <Button size="sm" variant="ghost" className="gap-1" onClick={() => setStatusFor(g.ids, "dismissed")}>
                      <X className="w-4 h-4" /> Dismiss
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
