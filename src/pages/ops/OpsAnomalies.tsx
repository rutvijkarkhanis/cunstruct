import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, RefreshCw, CheckCircle2, Clock, PackageX, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { runAnomalyDetection } from "@/lib/forecastEngine";
import { formatDistanceToNow } from "date-fns";

const KIND_META: Record<string, { label: string; icon: React.ElementType }> = {
  stale: { label: "Stale — no update", icon: Clock },
  overdue_order: { label: "Overdue order", icon: PackageX },
  pace_drop: { label: "Pace drop", icon: TrendingDown },
};

export default function OpsAnomalies() {
  const qc = useQueryClient();
  const [scanning, setScanning] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [tab, setTab] = useState<"open" | "resolved" | "all">("open");

  const { data: alerts, isLoading } = useQuery({
    queryKey: ["anomalies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_alerts")
        .select("*, projects:project_id(name)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const counts = useMemo(() => ({
    open: (alerts ?? []).filter((a: any) => !a.resolved).length,
    resolved: (alerts ?? []).filter((a: any) => a.resolved).length,
    all: (alerts ?? []).length,
  }), [alerts]);

  const visible = useMemo(() => (alerts ?? []).filter((a: any) =>
    tab === "all" ? true : tab === "open" ? !a.resolved : a.resolved
  ), [alerts, tab]);

  const runScan = async () => {
    setScanning(true);
    try {
      const { created } = await runAnomalyDetection();
      toast.success(`Scan complete · ${created} flag${created === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["anomalies"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally { setScanning(false); }
  };

  const resolve = async (id: string) => {
    setResolvingId(id);
    try {
      const { error } = await supabase.from("project_alerts")
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["anomalies"] });
      qc.invalidateQueries({ queryKey: ["alerts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to resolve");
    } finally { setResolvingId(null); }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" /> Anomalies
          </h1>
          <p className="text-sm text-muted-foreground">
            Stale sites, overdue orders and pace drops across all projects.
          </p>
        </div>
        <Button variant="outline" onClick={runScan} disabled={scanning}>
          <RefreshCw className={`w-4 h-4 mr-1 ${scanning ? "animate-spin" : ""}`} />
          {scanning ? "Scanning…" : "Run scan"}
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="open">Open ({counts.open})</TabsTrigger>
          <TabsTrigger value="resolved">Resolved ({counts.resolved})</TabsTrigger>
          <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading && <Card className="p-8 text-center text-muted-foreground">Loading…</Card>}
      {!isLoading && visible.length === 0 && (
        <Card className="p-12 text-center text-muted-foreground">
          {tab === "open"
            ? "No open anomalies. Run a scan to refresh."
            : "Nothing here."}
        </Card>
      )}

      <div className="space-y-2">
        {visible.map((a: any) => {
          const meta = KIND_META[a.kind] ?? { label: a.kind, icon: AlertTriangle };
          const Icon = meta.icon;
          const critical = a.severity === "critical";
          return (
            <Card key={a.id} className={`p-4 ${critical && !a.resolved ? "border-destructive/40 bg-destructive/5" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${critical ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link to={`/ops/projects/${a.project_id}`} className="font-semibold hover:underline">
                        {a.projects?.name ?? "Project"}
                      </Link>
                      <Badge variant={critical ? "destructive" : "outline"} className="text-[10px]">{meta.label}</Badge>
                      {a.resolved && (
                        <span className="text-[10px] inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="w-3 h-3" /> resolved
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">{a.message}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(a.created_at))} ago
                    </div>
                  </div>
                </div>
                {!a.resolved && (
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => resolve(a.id)}
                    disabled={resolvingId === a.id}
                    className="shrink-0 gap-1"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {resolvingId === a.id ? "…" : "Resolve"}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
