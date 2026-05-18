import { useParams, Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Clock, Sparkles, Package, Truck, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { recalcProjectVelocity, formatINR, autoGenerateForecastForCurrentStage } from "@/lib/forecastEngine";

export default function MyProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (!loading && !user) navigate("/auth");
  }, [user, loading, navigate]);

  const { data: project } = useQuery({
    queryKey: ["my-project", id],
    enabled: !!id && !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, stage_master:current_stage_id(name, sequence)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: stages } = useQuery({
    queryKey: ["stage_master"],
    queryFn: async () => {
      const { data } = await supabase.from("stage_master").select("*").order("sequence");
      return data ?? [];
    },
  });

  const { data: updates } = useQuery({
    queryKey: ["my-updates", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from("stage_updates")
        .select("*, stage_master:stage_id(name)")
        .eq("project_id", id!)
        .order("recorded_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: forecastItems } = useQuery({
    queryKey: ["my-forecast-items", id],
    enabled: !!id,
    queryFn: async () => {
      // RLS already filters to approved/sent + medium/high confidence
      const { data } = await supabase
        .from("forecast_items")
        .select("*, stage_master:stage_id(name), forecasts:forecast_id(status, generated_at)")
        .order("order_by_date", { ascending: true });
      return (data ?? []).filter((i: any) =>
        i.forecasts && (i.forecasts.status === "approved" || i.forecasts.status === "sent")
      );
    },
  });

  const [logStageId, setLogStageId] = useState("");
  const [logProgress, setLogProgress] = useState(0);
  const [logNote, setLogNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (project && !logStageId) {
      setLogStageId(project.current_stage_id ?? "");
      setLogProgress(Number(project.progress_pct) || 0);
    }
  }, [project, logStageId]);

  const submitUpdate = async () => {
    if (!logStageId) return toast.error("Pick a stage");
    setBusy(true);
    try {
      const { error: updateLogError } = await supabase.from("stage_updates").insert({
        project_id: id, stage_id: logStageId, progress_pct: logProgress,
        source: "app", note: logNote, created_by: user?.id,
      });
      if (updateLogError) throw updateLogError;
      const { error: projectUpdateError } = await supabase.from("projects").update({
        current_stage_id: logStageId, progress_pct: logProgress,
      }).eq("id", id!);
      if (projectUpdateError) throw projectUpdateError;
      try { await recalcProjectVelocity(id!); } catch { /* ignore */ }
      await autoGenerateForecastForCurrentStage(id!);
      toast.success("Progress logged");
      setLogNote("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["my-project", id] }),
        qc.invalidateQueries({ queryKey: ["my-updates", id] }),
        qc.invalidateQueries({ queryKey: ["my-forecast-items", id] }),
        qc.invalidateQueries({ queryKey: ["all-forecasts"] }),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  if (!project) return <div className="min-h-screen bg-background p-8 text-muted-foreground">Loading…</div>;

  const pending = project.status === "pending_review";
  const stageName = (project as any).stage_master?.name;
  const updatesCount = updates?.length ?? 0;
  const hasVelocity = project.projected_completion_date && updatesCount >= 2;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <Link to="/my-projects" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" /> My projects
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <p className="text-sm text-muted-foreground">{project.location} · {project.project_type}</p>
          </div>
          {pending && (
            <span className="text-[10px] uppercase tracking-wide px-2 py-1 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 inline-flex items-center gap-1">
              <Clock className="w-3 h-3" /> Pending review
            </span>
          )}
        </div>

        {pending && (
          <Card className="p-5 bg-amber-500/5 border-amber-500/30">
            <div className="flex gap-3">
              <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">We're reviewing your project</div>
                <p className="text-sm text-muted-foreground mt-1">
                  Our team will activate your procurement plan within 24 hours. You'll start receiving
                  proactive material recommendations as soon as it's live.
                </p>
              </div>
            </div>
          </Card>
        )}

        <Card className="p-5 space-y-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Current stage</div>
          <div className="text-xl font-semibold">{stageName ?? "—"}</div>
          <Progress value={Number(project.progress_pct)} />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{Number(project.progress_pct).toFixed(0)}% complete</span>
            <span>{updatesCount} update{updatesCount === 1 ? "" : "s"} logged</span>
          </div>
          {!pending && (
            <div className="text-sm pt-2 border-t">
              {hasVelocity ? (
                <>
                  <Sparkles className="w-3 h-3 inline mr-1 text-primary" />
                  At current pace, <span className="font-medium">{stageName}</span> completes around{" "}
                  <span className="font-medium">
                    {new Date(project.projected_completion_date!).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">Log a few updates to start tracking your pace.</span>
              )}
            </div>
          )}
        </Card>

        {!pending && (
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">Upcoming materials</div>
                <p className="text-xs text-muted-foreground">Planned by Cunstruct based on your pace</p>
              </div>
            </div>
            {(!forecastItems || forecastItems.length === 0) ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No approved recommendations yet. We'll notify you as your stage progresses.
              </p>
            ) : (
              <div className="space-y-2">
                {forecastItems.map((i: any) => (
                  <div key={i.id} className="flex items-center justify-between p-3 rounded-md border">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{i.product_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {Number(i.qty_estimated).toLocaleString("en-IN")} {i.unit ?? ""}
                        {i.budget_estimated ? ` · ${formatINR(Number(i.budget_estimated))}` : ""}
                        {i.order_by_date ? ` · order by ${new Date(i.order_by_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
                      </div>
                    </div>
                    <ReservationBadge status={i.status} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        <Card className="p-5 space-y-4">
          <div>
            <div className="font-semibold">Log progress update</div>
            <p className="text-xs text-muted-foreground">Tell us how the site is moving</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Stage</Label>
              <Select value={logStageId} onValueChange={setLogStageId}>
                <SelectTrigger><SelectValue placeholder="Stage" /></SelectTrigger>
                <SelectContent>
                  {stages?.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.sequence}. {s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Progress: {logProgress}%</Label>
              <input
                type="range" min={0} max={100} step={5} value={logProgress}
                onChange={e => setLogProgress(+e.target.value)}
                className="w-full mt-3"
              />
            </div>
          </div>
          <div>
            <Label>Note (optional)</Label>
            <Textarea value={logNote} onChange={e => setLogNote(e.target.value)} placeholder="e.g. Slab work started on east block" rows={2} />
          </div>
          <Button onClick={submitUpdate} disabled={busy} className="w-full">
            {busy ? "Logging…" : "Log update"}
          </Button>
        </Card>

        {updates && updates.length > 0 && (
          <Card className="p-5 space-y-3">
            <div className="font-semibold">Recent updates</div>
            <div className="space-y-2">
              {updates.slice(0, 5).map((u: any) => (
                <div key={u.id} className="text-sm border-l-2 border-primary/30 pl-3">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{u.stage_master?.name}</span>
                    <span>{new Date(u.recorded_at).toLocaleDateString("en-IN")}</span>
                  </div>
                  <div>{Number(u.progress_pct).toFixed(0)}% {u.note ? `· ${u.note}` : ""}</div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}

function ReservationBadge({ status }: { status: string }) {
  if (status === "ordered") {
    return (
      <span className="text-[10px] uppercase tracking-wide px-2 py-1 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1 shrink-0">
        <Truck className="w-3 h-3" /> Confirmed
      </span>
    );
  }
  if (status === "delivered") {
    return (
      <span className="text-[10px] uppercase tracking-wide px-2 py-1 rounded bg-primary/15 text-primary inline-flex items-center gap-1 shrink-0">
        <CheckCircle2 className="w-3 h-3" /> Delivered
      </span>
    );
  }
  return (
    <span className="text-[10px] uppercase tracking-wide px-2 py-1 rounded bg-muted text-muted-foreground inline-flex items-center gap-1 shrink-0">
      <Package className="w-3 h-3" /> Arranging
    </span>
  );
}