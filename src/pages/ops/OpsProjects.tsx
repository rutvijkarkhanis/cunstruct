import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Building2, Trash2, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { autoGenerateForecastForCurrentStage } from "@/lib/forecastEngine";
import { estimateFollowUp } from "@/lib/followup";

const TYPES = ["Residential", "Commercial", "Retail", "Office", "Hospital", "Other"];
const SCOPES = ["Civil", "MEP", "Finishing", "Turnkey"];

export default function OpsProjects() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "pending_review" | "active">("all");

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: stageMap } = useQuery({
    queryKey: ["stage_master_map"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stage_master")
        .select("id, name, sequence, typical_duration_days");
      if (error) throw error;
      const map: Record<string, { name: string; sequence: number; typical_duration_days: number | null }> = {};
      (data ?? []).forEach(s => {
        map[s.id] = { name: s.name, sequence: s.sequence, typical_duration_days: s.typical_duration_days };
      });
      return map;
    },
  });

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const deleteProject = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("projects").delete().eq("id", deleteTarget.id);
      if (error) throw error;
      toast.success(`Deleted "${deleteTarget.name}"`);
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["pending-review-count"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete project");
    } finally {
      setDeleting(false);
    }
  };

  const pendingCount = projects?.filter(p => p.status === "pending_review").length ?? 0;
  const filtered = projects?.filter(p =>
    tab === "all" ? true : (p.status ?? "active") === tab
  );

  const activate = async (projectId: string) => {
    try {
      const { error } = await supabase.from("projects")
        .update({ status: "active" }).eq("id", projectId);
      if (error) throw error;

      toast.success("Project activated");

      // Fix #5: only call autoGenerateForecastForCurrentStage — generateForecasts targets
      // upcoming stages using the same horizon_days keys and would overwrite the approved
      // current-stage forecast with a draft. Ops can click Generate Forecast manually.
      try {
        const { created } = await autoGenerateForecastForCurrentStage(projectId);
        if (created > 0) toast.success(`${created} forecast items ready for review`);
      } catch (err) {
        console.error("[Forecast] autoGenerateForecastForCurrentStage failed:", err);
      }

      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["pending-review-count"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to activate");
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-sm text-muted-foreground">All active construction sites</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-1" /> Onboard project</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Project onboarding</DialogTitle>
            </DialogHeader>
            <OnboardWizard onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: ["projects"] }); }} />
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="pending_review">
            Pending review
            {pendingCount > 0 && (
              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500 text-white">
                {pendingCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
        </TabsList>
      </Tabs>

      {projects && projects.length === 0 && (
        <Card className="p-12 text-center text-muted-foreground">
          <Building2 className="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p>No projects yet. Onboard your first site.</p>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered?.map((p) => (
          <Card key={p.id} className="p-5 hover:border-primary transition-colors space-y-3">
            <Link to={`/ops/projects/${p.id}`} className="block space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.client_name} · {p.location}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {p.status === "pending_review" && (
                    <span className="text-[10px] uppercase px-2 py-1 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400">
                      Pending
                    </span>
                  )}
                  <div className="text-xs px-2 py-1 rounded bg-primary/10 text-primary">
                    {p.project_type}
                  </div>
                </div>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Current stage: </span>
                <span className="font-medium">
                  {(p.current_stage_id && stageMap?.[p.current_stage_id]?.name) ?? "—"}
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Progress</span>
                  <span>{Number(p.progress_pct).toFixed(0)}%</span>
                </div>
                <Progress value={Number(p.progress_pct)} />
              </div>
              <div className="text-xs text-muted-foreground">
                {p.floors ?? "—"} floors · {p.area_sqft ? `${p.area_sqft} sqft` : "—"}
              </div>
              {p.status !== "pending_review" && (() => {
                const stage = p.current_stage_id ? stageMap?.[p.current_stage_id] : undefined;
                const est = estimateFollowUp({
                  stageDurationDays: stage?.typical_duration_days,
                  areaSqft: p.area_sqft,
                  floors: p.floors,
                  progressPct: p.progress_pct,
                  velocityPctPerDay: p.velocity_days_per_pct ? 1 / Number(p.velocity_days_per_pct) : null,
                  lastUpdate: p.updated_at,
                });
                const tone = {
                  overdue: "text-red-600 dark:text-red-400",
                  urgent: "text-amber-600 dark:text-amber-400",
                  soon: "text-blue-600 dark:text-blue-400",
                  routine: "",
                }[est.priority];
                return (
                  <div className="flex items-center gap-1.5 text-xs">
                    <Clock className="w-3 h-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Next check-in:</span>
                    <span className={`font-medium ${tone}`}>
                      {est.overdue
                        ? "Due now"
                        : est.daysUntil === 0
                          ? "Today"
                          : `in ${est.daysUntil}d`}
                    </span>
                    <span className="text-muted-foreground">· ~every {est.intervalDays}d</span>
                  </div>
                );
              })()}
            </Link>
            <div className="flex items-center gap-2">
              {p.status === "pending_review" && (
                <Button
                  size="sm" className="flex-1"
                  onClick={(e) => { e.preventDefault(); activate(p.id); }}
                >
                  Review & activate
                </Button>
              )}
              <Button
                size="sm" variant="ghost"
                className="text-muted-foreground hover:text-destructive"
                onClick={(e) => { e.preventDefault(); setDeleteTarget({ id: p.id, name: p.name }); }}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <span className="font-medium">{deleteTarget?.name}</span> and all its
              stage updates, forecasts, alerts and messages. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); deleteProject(); }}
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

function OnboardWizard({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [location, setLocation] = useState("");
  const [projectType, setProjectType] = useState("Residential");
  const [scope, setScope] = useState("Turnkey");
  const [floors, setFloors] = useState(1);
  const [areaSqft, setAreaSqft] = useState(1000);
  const [stageId, setStageId] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [estCompletion, setEstCompletion] = useState("");
  const [busy, setBusy] = useState(false);

  const [stages, setStages] = useState<{ id: string; name: string; sequence: number }[]>([]);

  useEffect(() => {
    supabase.from("stage_master").select("id, name, sequence").order("sequence")
      .then(({ data }) => { if (data) setStages(data); });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: project, error } = await supabase
        .from("projects")
        .insert({
          name,
          client_name: clientName,
          customer_name: customerName || null,
          customer_phone: customerPhone || null,
          location,
          project_type: projectType,
          scope,
          floors,
          area_sqft: areaSqft,
          current_stage_id: stageId || null,
          progress_pct: progress,
          estimated_completion: estCompletion || null,
          account_manager_id: user?.id,
        })
        .select()
        .single();
      if (error) throw error;

      if (stageId) {
        await supabase.from("stage_updates").insert({
          project_id: project.id,
          stage_id: stageId,
          progress_pct: progress,
          source: "app",
          note: "Initial onboarding",
          created_by: user?.id,
        });
        await supabase.from("project_stages").insert({
          project_id: project.id,
          stage_id: stageId,
          started_at: new Date().toISOString(),
        });
        // Generate the current stage's material forecast right away so the
        // project shows a forecast the moment it's onboarded.
        try {
          const { created } = await autoGenerateForecastForCurrentStage(project.id);
          if (created > 0) toast.success(`${created} forecast item${created === 1 ? "" : "s"} ready`);
        } catch (e) {
          console.warn("[Onboard] forecast generation:", e);
        }
      }
      toast.success("Project onboarded");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label>Project name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Client</Label>
          <Input value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </div>
        <div>
          <Label>Location</Label>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Customer name</Label>
          <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        </div>
        <div>
          <Label>Customer phone</Label>
          <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="9198XXXXXXXX" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Type</Label>
          <Select value={projectType} onValueChange={setProjectType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Scope</Label>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{SCOPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Floors</Label>
          <Input type="number" value={floors} onChange={(e) => setFloors(+e.target.value)} />
        </div>
        <div>
          <Label>Built-up area (sqft)</Label>
          <Input type="number" value={areaSqft} onChange={(e) => setAreaSqft(+e.target.value)} />
        </div>
      </div>
      <div>
        <Label>Current stage</Label>
        <div className="border rounded-md divide-y max-h-56 overflow-y-auto">
          {stages.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Loading stages…</p>
          )}
          {stages.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStageId(s.id)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors",
                stageId === s.id && "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              {s.sequence}. {s.name}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Progress %</Label>
          <Input type="number" min={0} max={100} value={progress} onChange={(e) => setProgress(+e.target.value)} />
        </div>
        <div>
          <Label>Target completion</Label>
          <Input type="date" value={estCompletion} onChange={(e) => setEstCompletion(e.target.value)} />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Creating…" : "Create project"}
      </Button>
    </form>
  );
}