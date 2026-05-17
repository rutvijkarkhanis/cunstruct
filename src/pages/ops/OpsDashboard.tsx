import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Building2, Layers, Link2, AlertTriangle, RefreshCw } from "lucide-react";
import { runAnomalyDetection, formatINR } from "@/lib/forecastEngine";
import { toast } from "sonner";
import { useState } from "react";

export default function OpsDashboard() {
  const qc = useQueryClient();
  const [scanning, setScanning] = useState(false);

  const { data: stats } = useQuery({
    queryKey: ["ops-stats"],
    queryFn: async () => {
      const since = new Date(); since.setDate(since.getDate() - 7);
      const [projects, stages, mappings, forecastsWeek, ordered, cunstructOrdered, riskItems, pendingApprovals, accuracy, allItems, decidedItems, proactiveRevenue] =
        await Promise.all([
          supabase.from("projects").select("id", { count: "exact", head: true }),
          supabase.from("stage_master").select("id", { count: "exact", head: true }),
          supabase.from("stage_material_mapping").select("id", { count: "exact", head: true }),
          supabase.from("forecasts").select("id", { count: "exact", head: true }).gte("generated_at", since.toISOString()),
          supabase.from("forecast_items").select("id", { count: "exact", head: true }).eq("status", "ordered"),
          supabase.from("forecast_items").select("id", { count: "exact", head: true }).eq("status", "ordered").eq("initiated_by", "cunstruct"),
          supabase.from("forecast_items").select("id", { count: "exact", head: true }).eq("risk_flag", true).neq("status", "ordered"),
          supabase.from("forecasts").select("id", { count: "exact", head: true }).eq("status", "draft"),
          supabase.from("forecast_accuracy").select("variance_pct"),
          supabase.from("forecast_items").select("id", { count: "exact", head: true }),
          supabase.from("forecast_items").select("id", { count: "exact", head: true }).in("status", ["confirmed", "modified", "rejected", "ordered", "delivered"]),
          supabase.from("forecast_items").select("confirmed_qty,confirmed_price,qty_estimated,unit_price").eq("initiated_by", "cunstruct").in("status", ["ordered", "delivered"]),
        ]);
      const accRows = accuracy.data ?? [];
      const sysAccuracy = accRows.length >= 5
        ? Math.max(0, 100 - accRows.reduce((s: number, r: any) => s + Math.abs(Number(r.variance_pct)), 0) / accRows.length)
        : null;
      const proactiveRate = (ordered.count ?? 0) > 0
        ? ((cunstructOrdered.count ?? 0) / (ordered.count ?? 1)) * 100
        : 0;
      const totalItems = allItems.count ?? 0;
      const acceptedCount = (decidedItems.count ?? 0) - 0;
      // acceptance = (confirmed + modified + ordered + delivered) / decided. Reject excluded.
      const acceptanceRate = totalItems > 0 ? ((decidedItems.count ?? 0) / totalItems) * 100 : 0;
      const proactiveRevenue_ = (proactiveRevenue.data ?? []).reduce((s: number, r: any) => {
        const qty = Number(r.confirmed_qty ?? r.qty_estimated ?? 0);
        const price = Number(r.confirmed_price ?? r.unit_price ?? 0);
        return s + qty * price;
      }, 0);
      return {
        projects: projects.count ?? 0,
        stages: stages.count ?? 0,
        mappings: mappings.count ?? 0,
        forecastsWeek: forecastsWeek.count ?? 0,
        risk: riskItems.count ?? 0,
        pending: pendingApprovals.count ?? 0,
        proactiveRate,
        sysAccuracy,
        acceptanceRate,
        proactiveRevenue: proactiveRevenue_,
        totalItems,
        decidedItems: decidedItems.count ?? 0,
      };
    },
  });

  const { data: alerts } = useQuery({
    queryKey: ["alerts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("project_alerts")
        .select("*, projects:project_id(name)")
        .eq("resolved", false)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const runScan = async () => {
    setScanning(true);
    try {
      const { created } = await runAnomalyDetection();
      toast.success(`Anomaly scan complete · ${created} flags`);
      qc.invalidateQueries({ queryKey: ["alerts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setScanning(false); }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Operations Overview</h1>
          <p className="text-sm text-muted-foreground">Predictive procurement engine</p>
        </div>
        <Button variant="outline" onClick={runScan} disabled={scanning}>
          <RefreshCw className={`w-4 h-4 mr-1 ${scanning ? "animate-spin" : ""}`} />
          Run anomaly scan
        </Button>
      </div>

      <Card className="p-5 bg-primary/5 border-primary/20">
        <div className="flex items-baseline gap-4">
          <div className="text-5xl font-bold text-primary">{(stats?.proactiveRate ?? 0).toFixed(0)}%</div>
          <div>
            <div className="font-medium">Proactive Order Rate</div>
            <div className="text-xs text-muted-foreground">
              Cunstruct-initiated orders ÷ total ordered items
            </div>
            <div className="text-xs text-muted-foreground mt-1">Target: 30% by Week 8</div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Forecast Acceptance Rate</div>
          <div className="text-3xl font-bold">{(stats?.acceptanceRate ?? 0).toFixed(0)}%</div>
          <div className="text-xs text-muted-foreground mt-1">
            {stats?.decidedItems ?? 0} of {stats?.totalItems ?? 0} items actioned
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Forecast Accuracy</div>
          <div className="text-3xl font-bold">
            {stats?.sysAccuracy != null
              ? `${stats.sysAccuracy.toFixed(0)}%`
              : <span className="text-sm text-muted-foreground font-normal italic">Need 5+ data points</span>}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Predicted vs actual quantity</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground">Revenue from Proactive Orders</div>
          <div className="text-3xl font-bold">{formatINR(stats?.proactiveRevenue ?? 0)}</div>
          <div className="text-xs text-muted-foreground mt-1">Cunstruct-initiated, ordered or delivered</div>
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Mini label="Active projects" value={stats?.projects ?? 0} />
        <Mini label="Forecasts this week" value={stats?.forecastsWeek ?? 0} />
        <Mini label="Risk-flagged items" value={stats?.risk ?? 0} tone={stats?.risk ? "danger" : undefined} />
        <Mini label="Approvals pending" value={stats?.pending ?? 0} tone={stats?.pending ? "warn" : undefined} />
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            Alerts {alerts && alerts.length > 0 && (
              <span className="text-xs bg-destructive text-destructive-foreground px-2 py-0.5 rounded-full">{alerts.length}</span>
            )}
          </h2>
        </div>
        {(!alerts || alerts.length === 0) && (
          <div className="text-sm text-muted-foreground">No open alerts. Run scan to refresh.</div>
        )}
        <div className="space-y-2">
          {alerts?.map((a) => (
            <Link key={a.id} to={`/ops/projects/${a.project_id}`} className="block">
              <div className={`p-3 rounded border text-sm hover:bg-accent ${
                a.severity === "critical" ? "border-destructive/40 bg-destructive/5" : "border-border"
              }`}>
                <div className="flex justify-between items-center">
                  <span className="font-medium">{(a as any).projects?.name}</span>
                  <span className="text-[10px] uppercase text-muted-foreground">{a.kind.replace("_", " ")}</span>
                </div>
                <div className="text-xs text-muted-foreground">{a.message}</div>
              </div>
            </Link>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard to="/ops/projects" icon={Building2} label="Projects" value={stats?.projects ?? 0} />
        <StatCard to="/ops/stages" icon={Layers} label="Stages" value={stats?.stages ?? 0} />
        <StatCard to="/ops/mappings" icon={Link2} label="Mappings" value={stats?.mappings ?? 0} />
      </div>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: number; tone?: "warn" | "danger" }) {
  const color = tone === "danger" ? "text-destructive" : tone === "warn" ? "text-amber-600" : "";
  return (
    <Card className="p-4">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  );
}

function StatCard({ to, icon: Icon, label, value }: { to: string; icon: React.ElementType; label: string; value: number }) {
  return (
    <Link to={to}>
      <Card className="p-5 hover:border-primary transition-colors">
        <Icon className="w-5 h-5 text-primary mb-2" />
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </Card>
    </Link>
  );
}
