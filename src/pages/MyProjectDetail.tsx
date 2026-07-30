import { useParams, Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Clock, Sparkles, Package, Truck, CheckCircle2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { recalcProjectVelocity, formatINR, autoGenerateForecastForCurrentStage } from "@/lib/forecastEngine";
import { InfoHint } from "@/components/InfoHint";
import { QUALITY_TIERS, NOTE } from "@/lib/boqGlossary";

const PROJECT_TYPES = ["Residential", "Commercial", "Retail", "Office", "Hospital", "Other"];

export default function MyProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Fix #4: include returnUrl so the user lands back here after login
  useEffect(() => {
    if (!loading && !user) navigate("/auth?returnUrl=" + encodeURIComponent(window.location.pathname));
  }, [user, loading, navigate]);

  // Fix #5 + #6: destructure isError; add owner_id filter so any RLS misconfiguration
  // can't expose another user's project
  const { data: project, isError: isProjectError } = useQuery({
    queryKey: ["my-project", id],
    enabled: !!id && !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, stage_master:current_stage_id(name, sequence)")
        .eq("id", id!)
        .eq("owner_id", user!.id)
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

  // Fix #2: scope forecast_items to this project via the !inner join + project_id filter
  const { data: forecastItems } = useQuery({
    queryKey: ["my-forecast-items", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from("forecast_items")
        .select("*, stage_master:stage_id(name), forecasts!inner:forecast_id(status, generated_at)")
        .eq("forecasts.project_id", id)
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

  // ---- Project basics (drive smart BOQ suggestions) ----------------------
  const [basics, setBasics] = useState({
    project_type: "", area_sqft: "", floors: "",
    quality_tier: "standard", bedrooms: "", bathrooms: "", kitchens: "",
  });
  const [basicsLoaded, setBasicsLoaded] = useState(false);
  const [savingBasics, setSavingBasics] = useState(false);
  useEffect(() => {
    if (project && !basicsLoaded) {
      const p: any = project;
      setBasics({
        project_type: p.project_type ?? "",
        area_sqft: p.area_sqft != null ? String(p.area_sqft) : "",
        floors: p.floors != null ? String(p.floors) : "",
        quality_tier: p.quality_tier ?? "standard",
        bedrooms: p.bedrooms != null ? String(p.bedrooms) : "",
        bathrooms: p.bathrooms != null ? String(p.bathrooms) : "",
        kitchens: p.kitchens != null ? String(p.kitchens) : "",
      });
      setBasicsLoaded(true);
    }
  }, [project, basicsLoaded]);
  const setB = (patch: Partial<typeof basics>) => setBasics((b) => ({ ...b, ...patch }));
  const saveBasics = async () => {
    setSavingBasics(true);
    try {
      const patch: any = {
        project_type: basics.project_type || null,
        area_sqft: basics.area_sqft ? Number(basics.area_sqft) : null,
        floors: basics.floors ? Number(basics.floors) : null,
        quality_tier: basics.quality_tier || "standard",
        bedrooms: Number(basics.bedrooms) || 0,
        bathrooms: Number(basics.bathrooms) || 0,
        kitchens: Number(basics.kitchens) || 0,
      };
      const { error } = await supabase.from("projects").update(patch).eq("id", id!);
      if (error) throw error;
      toast.success("Project basics saved — they'll drive your BOQ suggestions");
      qc.invalidateQueries({ queryKey: ["my-project", id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save basics");
    } finally {
      setSavingBasics(false);
    }
  };

  // Fix #3: sync form to the server values whenever stage or progress changes
  // (removes the !logStageId guard that prevented re-sync after background refetches)
  useEffect(() => {
    if (project) {
      setLogStageId(project.current_stage_id ?? "");
      setLogProgress(Number(project.progress_pct) || 0);
    }
  }, [project?.current_stage_id, project?.progress_pct]);

  const submitUpdate = async () => {
    if (!logStageId) return toast.error("Pick a stage");
    setBusy(true);
    try {
      // Fix #1a: parallelize the two independent DB writes
      const [{ error: updateLogError }, { error: projectUpdateError }] = await Promise.all([
        supabase.from("stage_updates").insert({
          project_id: id, stage_id: logStageId, progress_pct: logProgress,
          source: "app", note: logNote, created_by: user?.id,
        }),
        supabase.from("projects").update({
          current_stage_id: logStageId, progress_pct: logProgress,
        }).eq("id", id!),
      ]);
      if (updateLogError) throw updateLogError;
      if (projectUpdateError) throw projectUpdateError;

      // Fix #1b: primary write succeeded — confirm immediately before side effects
      toast.success("Progress logged");
      setLogNote("");

      // Fix #1c: best-effort side effects — never surface their errors to the user
      try { await recalcProjectVelocity(id!); } catch { /* silent */ }
      // Fix #9: only regenerate forecast when the stage actually changes
      if (logStageId !== project?.current_stage_id) {
        try { await autoGenerateForecastForCurrentStage(id!); } catch { /* silent */ }
      }

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["my-project", id] }),
        qc.invalidateQueries({ queryKey: ["my-updates", id] }),
        qc.invalidateQueries({ queryKey: ["my-forecast-items", id] }),
        qc.invalidateQueries({ queryKey: ["all-forecasts"] }),
      ]);
    } catch (e) {
      console.error("[submitUpdate] failed:", e);
      toast.error(e instanceof Error ? e.message : "Failed to log update");
    } finally { setBusy(false); }
  };

  // Fix #5: separate error state from loading state
  if (!project) {
    if (isProjectError) {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8 gap-4">
          <p className="text-muted-foreground">Could not load project.</p>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["my-project", id] })}>
            Retry
          </Button>
        </div>
      );
    }
    return <div className="min-h-screen bg-background p-8 text-muted-foreground">Loading…</div>;
  }

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

        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold flex items-center gap-1.5">
                <SlidersHorizontal className="w-4 h-4 text-primary" /> Project basics
                <InfoHint title="Why fill this in?">
                  These few details power your Bill of Quantities. Built-up area sizes structural
                  materials, the room counts auto-build your room list, and the quality tier tunes how
                  much buffer we add. Fill it once — the BOQ screen does the rest.
                </InfoHint>
              </div>
              <p className="text-xs text-muted-foreground">Drives smart suggestions on your BOQ screen</p>
            </div>
            <Button asChild variant="outline" size="sm" className="gap-1 shrink-0">
              <Link to={`/my-projects/${id}/order`}><Package className="w-4 h-4" /> Build BOQ</Link>
            </Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <Label className="flex items-center gap-1">Type</Label>
              <Select value={basics.project_type} onValueChange={(v) => setB({ project_type: v })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {PROJECT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="flex items-center gap-1">
                Built-up area
                <InfoHint title="Built-up area (sq.ft)">
                  The total constructed area. Drives all <b>per built-up sq.ft</b> materials —
                  cement, sand, aggregate, steel. If left blank, we fall back to the floor area of
                  your rooms.
                </InfoHint>
              </Label>
              <Input type="number" min="0" className="mt-1 h-9" placeholder="sq.ft"
                value={basics.area_sqft} onChange={(e) => setB({ area_sqft: e.target.value })} />
            </div>
            <div>
              <Label>Floors</Label>
              <Input type="number" min="0" className="mt-1 h-9" placeholder="e.g. 2"
                value={basics.floors} onChange={(e) => setB({ floors: e.target.value })} />
            </div>
            <div className="col-span-2 sm:col-span-3">
              <Label className="flex items-center gap-1">
                Quality tier
                <InfoHint title="Finish quality">
                  {QUALITY_TIERS.map((t) => (
                    <div key={t.key}><b>{t.label}:</b> {t.note}</div>
                  ))}
                </InfoHint>
              </Label>
              <Select value={basics.quality_tier} onValueChange={(v) => setB({ quality_tier: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {QUALITY_TIERS.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="flex items-center gap-1">
                Bedrooms
                <InfoHint title="Room counts">
                  Bedrooms, bathrooms and kitchens let the BOQ screen <b>auto-generate your room
                  list</b> with typical dimensions — so you can skip measuring every room to get a
                  first estimate. You can fine-tune sizes afterwards.
                </InfoHint>
              </Label>
              <Input type="number" min="0" className="mt-1 h-9"
                value={basics.bedrooms} onChange={(e) => setB({ bedrooms: e.target.value })} />
            </div>
            <div>
              <Label>Bathrooms</Label>
              <Input type="number" min="0" className="mt-1 h-9"
                value={basics.bathrooms} onChange={(e) => setB({ bathrooms: e.target.value })} />
            </div>
            <div>
              <Label>Kitchens</Label>
              <Input type="number" min="0" className="mt-1 h-9"
                value={basics.kitchens} onChange={(e) => setB({ kitchens: e.target.value })} />
            </div>
          </div>

          <Button onClick={saveBasics} disabled={savingBasics} size="sm">
            {savingBasics ? "Saving…" : "Save basics"}
          </Button>
        </Card>

        {!pending && (
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold">Upcoming materials</div>
                <p className="text-xs text-muted-foreground">Planned by Cunstruct based on your pace</p>
              </div>
              <Button asChild size="sm" className="gap-1 shrink-0">
                <Link to={`/my-projects/${id}/order`}>
                  <Package className="w-4 h-4" /> Order materials
                </Link>
              </Button>
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
