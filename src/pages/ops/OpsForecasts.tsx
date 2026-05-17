import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Sparkles } from "lucide-react";
import { formatINR, formatDateShort } from "@/lib/forecastEngine";
import { formatDistanceToNow } from "date-fns";

export default function OpsForecasts() {
  const { data: forecasts, isLoading } = useQuery({
    queryKey: ["all-forecasts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("forecasts")
        .select(
          "id, project_id, horizon_days, status, generated_at, projects:project_id(name, location), forecast_items(id, product_name, qty_estimated, unit, budget_estimated, order_by_date, risk_flag, confidence, notes, status)"
        )
        .order("generated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" /> Forecasts
        </h1>
        <p className="text-sm text-muted-foreground">
          Auto-generated from stage material mappings on every project change
        </p>
      </div>

      {isLoading && <Card className="p-8 text-center text-muted-foreground">Loading…</Card>}
      {!isLoading && (!forecasts || forecasts.length === 0) && (
        <Card className="p-12 text-center text-muted-foreground">
          No forecasts yet. They generate automatically when projects or stages change.
        </Card>
      )}

      <div className="space-y-4">
        {forecasts?.map((f: any) => {
          const items = f.forecast_items ?? [];
          const risks = items.filter((i: any) => i.risk_flag);
          const total = items.reduce(
            (s: number, i: any) => s + Number(i.budget_estimated ?? 0),
            0,
          );
          return (
            <Card key={f.id} className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <Link
                    to={`/ops/projects/${f.project_id}`}
                    className="font-semibold hover:underline"
                  >
                    {f.projects?.name ?? "Project"}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {f.projects?.location} · {f.horizon_days}-day horizon ·{" "}
                    {formatDistanceToNow(new Date(f.generated_at))} ago
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize">{f.status}</Badge>
                  {risks.length > 0 && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="w-3 h-3" /> {risks.length} at risk
                    </Badge>
                  )}
                </div>
              </div>
              <div className="text-xs text-muted-foreground mb-3">
                {items.length} items · estimated {formatINR(total)}
              </div>
              <div className="grid gap-2">
                {items.slice(0, 6).map((i: any) => (
                  <div
                    key={i.id}
                    className={`flex items-center justify-between p-2 rounded text-sm border ${
                      i.risk_flag ? "border-destructive/40 bg-destructive/5" : "border-border"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate flex items-center gap-2">
                        {i.product_name}
                        {i.notes === "critical" && (
                          <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-destructive/15 text-destructive">
                            critical
                          </span>
                        )}
                        <span
                          className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                            i.confidence === "high"
                              ? "bg-primary/15 text-primary"
                              : i.confidence === "medium"
                                ? "bg-muted text-muted-foreground"
                                : "bg-destructive/15 text-destructive"
                          }`}
                        >
                          {i.confidence}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {i.qty_estimated} {i.unit ?? ""} ·{" "}
                        {formatINR(i.budget_estimated)} · order by{" "}
                        {formatDateShort(i.order_by_date)}
                      </div>
                    </div>
                  </div>
                ))}
                {items.length > 6 && (
                  <Link
                    to={`/ops/projects/${f.project_id}`}
                    className="text-xs text-primary hover:underline text-center pt-1"
                  >
                    View all {items.length} items →
                  </Link>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}