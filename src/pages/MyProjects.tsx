import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Building2, Clock, CheckCircle2, LogOut } from "lucide-react";
import { toast } from "sonner";

const TYPES = ["Residential", "Commercial", "Retail", "Office", "Hospital"];

export default function MyProjects() {
  const { user, loading, isStaff, signOut } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate("/auth?returnUrl=" + encodeURIComponent("/my-projects"));
  }, [user, loading, navigate]);

  const { data: projects } = useQuery({
    queryKey: ["my-projects", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, stage_master:current_stage_id(name)")
        .eq("owner_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  if (loading || !user) return <div className="p-8 text-muted-foreground">Loading…</div>;

  const hasProjects = (projects?.length ?? 0) > 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <div className="font-bold text-lg">Cunstruct</div>
            <div className="text-xs text-muted-foreground">My Projects</div>
          </div>
          <div className="flex items-center gap-3">
            {isStaff && <Link to="/ops" className="text-sm text-primary hover:underline">Ops console →</Link>}
            <span className="text-xs text-muted-foreground hidden sm:inline">{user.email}</span>
            <Button variant="outline" size="sm" onClick={signOut}><LogOut className="w-3 h-3 mr-1" />Sign out</Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
        {hasProjects && (
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Your projects</h1>
              <p className="text-sm text-muted-foreground">Track progress and get proactive material plans</p>
            </div>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="w-4 h-4 mr-1" />New project</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Start a new project</DialogTitle></DialogHeader>
                <ProjectWizard
                  userId={user.id}
                  onDone={(pid) => {
                    setOpen(false);
                    qc.invalidateQueries({ queryKey: ["my-projects"] });
                    if (pid) navigate(`/my-projects/${pid}`);
                  }}
                />
              </DialogContent>
            </Dialog>
          </div>
        )}

        {!hasProjects && (
          <Card className="p-16 text-center space-y-5">
            <Building2 className="w-12 h-12 mx-auto text-muted-foreground" />
            <div>
              <h2 className="text-xl font-semibold">Start your first project</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Tell us about your site and we'll plan your material orders before you need them.
              </p>
            </div>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="lg"><Plus className="w-4 h-4 mr-1" />Start a new project</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Start a new project</DialogTitle></DialogHeader>
                <ProjectWizard
                  userId={user.id}
                  onDone={(pid) => {
                    setOpen(false);
                    qc.invalidateQueries({ queryKey: ["my-projects"] });
                    if (pid) navigate(`/my-projects/${pid}`);
                  }}
                />
              </DialogContent>
            </Dialog>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects?.map((p) => {
            const pending = p.status === "pending_review";
            return (
              <Link to={`/my-projects/${p.id}`} key={p.id}>
                <Card className="p-5 hover:border-primary transition-colors space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{p.location || "—"}</div>
                    </div>
                    {pending ? (
                      <span className="text-[10px] uppercase tracking-wide px-2 py-1 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Pending review
                      </span>
                    ) : (
                      <span className="text-[10px] uppercase tracking-wide px-2 py-1 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Active
                      </span>
                    )}
                  </div>
                  <div className="text-sm">
                    <span className="text-muted-foreground">Current stage: </span>
                    <span className="font-medium">{(p as any).stage_master?.name ?? "—"}</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Progress</span>
                      <span>{Number(p.progress_pct).toFixed(0)}%</span>
                    </div>
                    <Progress value={Number(p.progress_pct)} />
                  </div>
                  {p.projected_completion_date && !pending && (
                    <div className="text-xs text-muted-foreground">
                      Projected stage completion: {new Date(p.projected_completion_date).toLocaleDateString("en-IN")}
                    </div>
                  )}
                </Card>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function ProjectWizard({ userId, onDone }: { userId: string; onDone: (id?: string) => void }) {
  const [step, setStep] = useState(1);
  const [projectType, setProjectType] = useState("Residential");
  const [floors, setFloors] = useState(1);
  const [areaSqft, setAreaSqft] = useState(1000);
  const [stageId, setStageId] = useState("");
  const [progress, setProgress] = useState(0);
  const [estCompletion, setEstCompletion] = useState("");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);

  const { data: stages } = useQuery({
    queryKey: ["stage_master"],
    queryFn: async () => {
      const { data } = await supabase.from("stage_master").select("*").order("sequence");
      return data ?? [];
    },
  });

  const submit = async () => {
    setBusy(true);
    try {
      const { data: project, error } = await supabase
        .from("projects")
        .insert({
          name,
          location,
          project_type: projectType,
          floors,
          area_sqft: areaSqft,
          current_stage_id: stageId || null,
          progress_pct: progress,
          estimated_completion: estCompletion || null,
          owner_id: userId,
          status: "pending_review",
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
          note: "Initial progress at onboarding",
          created_by: userId,
        });
      }
      setSubmitted(project.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create project");
    } finally { setBusy(false); }
  };

  if (submitted) {
    return (
      <div className="space-y-4 text-center py-4">
        <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500" />
        <div>
          <h3 className="font-semibold text-lg">Project submitted</h3>
          <p className="text-sm text-muted-foreground mt-2">
            Our team will review and activate your procurement plan within 24 hours.
          </p>
        </div>
        <Button className="w-full" onClick={() => onDone(submitted)}>View project</Button>
      </div>
    );
  }

  const next = () => setStep(s => Math.min(5, s + 1));
  const back = () => setStep(s => Math.max(1, s - 1));
  const canNext = () => {
    if (step === 3) return !!stageId;
    if (step === 5) return name.trim().length > 0 && location.trim().length > 0 && !!estCompletion;
    return true;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1">
        {[1,2,3,4,5].map(i => (
          <div key={i} className={`h-1 flex-1 rounded ${i <= step ? "bg-primary" : "bg-muted"}`} />
        ))}
      </div>
      <div className="text-xs text-muted-foreground">Step {step} of 5</div>

      {step === 1 && (
        <div className="space-y-3">
          <Label>What type of project is this?</Label>
          <Select value={projectType} onValueChange={setProjectType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div>
            <Label>Number of floors</Label>
            <Input type="number" min={1} value={floors} onChange={e => setFloors(+e.target.value)} />
          </div>
          <div>
            <Label>Built-up area (sq ft)</Label>
            <Input type="number" min={1} value={areaSqft} onChange={e => setAreaSqft(+e.target.value)} />
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <Label>Which stage is the site currently in?</Label>
          <Select value={stageId} onValueChange={setStageId}>
            <SelectTrigger><SelectValue placeholder="Select current stage" /></SelectTrigger>
            <SelectContent>
              {stages?.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.sequence}. {s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <Label>Approximate stage progress: {progress}%</Label>
          <input
            type="range" min={0} max={100} step={5} value={progress}
            onChange={e => setProgress(+e.target.value)}
            className="w-full"
          />
          <Progress value={progress} />
        </div>
      )}

      {step === 5 && (
        <div className="space-y-3">
          <div>
            <Label>Project name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sector 57 Villa" />
          </div>
          <div>
            <Label>Site location</Label>
            <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Gurgaon, Sector 57" />
          </div>
          <div>
            <Label>Target completion date</Label>
            <Input type="date" value={estCompletion} onChange={e => setEstCompletion(e.target.value)} />
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        {step > 1 && <Button type="button" variant="outline" onClick={back} className="flex-1">Back</Button>}
        {step < 5 && <Button type="button" onClick={next} disabled={!canNext()} className="flex-1">Next</Button>}
        {step === 5 && (
          <Button type="button" onClick={submit} disabled={!canNext() || busy} className="flex-1">
            {busy ? "Submitting…" : "Submit project"}
          </Button>
        )}
      </div>
    </div>
  );
}