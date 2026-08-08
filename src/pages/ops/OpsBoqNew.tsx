import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { BOQ_SPEC, defaultSpec, type SpecField, type Spec, type SpecValue } from "@/lib/boqSpec";
import { DISCIPLINES } from "@/lib/disciplines";
import { ARCHETYPES, archetypeSpec } from "@/lib/archetypes";
import { openIntakeForm } from "@/lib/boqIntakeForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, Loader2, ClipboardList, ChevronDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProjectLite {
  id: string; name: string; project_type: string | null; scope: string | null;
  floors: number | null; area_sqft: number | null;
}

/** Anchor: pick a project archetype + a couple of levers, then land on a draft BOQ. */
export default function OpsBoqNew() {
  const [params] = useSearchParams();
  const urlProjectId = params.get("project");
  const navigate = useNavigate();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(urlProjectId);
  const [project, setProject] = useState<ProjectLite | null>(null);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [spec, setSpec] = useState<Spec>(() => defaultSpec());
  const [discipline, setDiscipline] = useState("civil");
  const [arch, setArch] = useState<string | null>(null);
  const [name, setName] = useState("BOQ");
  const [showDetails, setShowDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!urlProjectId);

  // Contractor memory
  const [contractors, setContractors] = useState<{ id: string; name: string; spec: Spec }[]>([]);
  const [contractorId, setContractorId] = useState<string | null>(null);
  const [newContractor, setNewContractor] = useState("");

  useEffect(() => {
    if (urlProjectId) return;
    supabase.from("projects").select("id, name").order("created_at", { ascending: false })
      .then(({ data }) => { if (data) setProjects(data); });
  }, [urlProjectId]);

  useEffect(() => {
    supabase.from("contractor_profile").select("id, name, spec").order("name")
      .then(({ data }) => { if (data) setContractors(data as { id: string; name: string; spec: Spec }[]); });
  }, []);

  // Applying a contractor overlays their usual choices on top of the archetype.
  const pickContractor = (id: string) => {
    setContractorId(id);
    setNewContractor("");
    const c = contractors.find((x) => x.id === id);
    if (c) setSpec((s) => ({ ...s, ...c.spec }));
  };

  useEffect(() => {
    if (!selectedProjectId) { setProject(null); return; }
    setLoading(true);
    supabase.from("projects")
      .select("id, name, project_type, scope, floors, area_sqft")
      .eq("id", selectedProjectId).single()
      .then(({ data }) => {
        if (data) {
          setProject(data as ProjectLite);
          setName(`${data.name} — BOQ`);
          setSpec((s) => ({ ...s, _area_sqft: s._area_sqft ?? data.area_sqft ?? undefined, _floors: s._floors ?? data.floors ?? undefined }));
        }
        setLoading(false);
      });
  }, [selectedProjectId]);

  const set = (key: string, value: SpecValue) => setSpec((s) => ({ ...s, [key]: value }));

  const pickArchetype = (key: string) => {
    const a = ARCHETYPES.find((x) => x.key === key);
    if (!a) return;
    setArch(key);
    setSpec(archetypeSpec(a));
    if (!project) setName(`${a.label} — BOQ`);
  };

  const field = (f: SpecField) => {
    const v = spec[f.key];
    if (f.type === "toggle")
      return (
        <div key={f.key} className="flex items-center justify-between gap-3 py-1">
          <Label className="font-normal">{f.label}</Label>
          <Switch checked={!!v} onCheckedChange={(c) => set(f.key, c)} />
        </div>
      );
    if (f.type === "number")
      return (
        <div key={f.key}>
          <Label className="text-xs text-muted-foreground">{f.label}{f.suffix ? ` (${f.suffix})` : ""}</Label>
          <Input type="number" value={(v as number) ?? ""} min={0}
            onChange={(e) => set(f.key, e.target.value === "" ? undefined : Number(e.target.value))} />
        </div>
      );
    return (
      <div key={f.key}>
        <Label className="text-xs text-muted-foreground">{f.label}</Label>
        <Select value={(v as string) ?? undefined} onValueChange={(val) => set(f.key, val)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {f.options!.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  };

  const save = async () => {
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // Resolve the contractor: existing selection, or create from a typed name.
      let cid = contractorId;
      if (!cid && newContractor.trim()) {
        const { data: c } = await supabase.from("contractor_profile")
          .insert({ name: newContractor.trim(), spec, created_by: user?.id }).select("id").single();
        cid = c?.id ?? null;
      }
      const { data, error } = await supabase.from("boq").insert({
        project_id: selectedProjectId, name, spec, discipline, contractor_id: cid, created_by: user?.id,
      }).select("id").single();
      if (error) throw error;
      // Land on the builder — it generates the draft on arrival (output before input).
      navigate(`/ops/boq/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const readyToBuild = arch != null || Number(spec._area_sqft) > 0;

  const areaVal = (spec._area_sqft as number) ?? "";
  const floorsVal = (spec._floors as number) ?? "";

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">New BOQ</h1>
          <p className="text-sm text-muted-foreground">Pick a project like yours, adjust a couple of things, get a draft.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => openIntakeForm({
          projectName: project?.name, projectType: project?.project_type, scope: project?.scope,
          builtUpSqft: project?.area_sqft, floors: project?.floors,
          generatedOn: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
          spec, rooms: [], blank: true,
        })}>
          <ClipboardList className="h-4 w-4 mr-2" />Print blank form
        </Button>
      </div>

      {/* Anchor — start from a reference project */}
      <div>
        <Label className="text-xs text-muted-foreground mb-2 block">Start from a project like…</Label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {ARCHETYPES.map((a) => (
            <button key={a.key} type="button" onClick={() => pickArchetype(a.key)}
              className={cn("rounded-lg border p-3 text-left transition-colors hover:border-primary/50",
                arch === a.key ? "border-primary bg-primary/5 ring-1 ring-primary" : "bg-card")}>
              <div className="text-sm font-medium">{a.label}</div>
              <div className="text-xs text-muted-foreground">{a.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Levers — the few things that move the number */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Built-up area (sqft)</Label>
          <Input type="number" value={areaVal} min={0} placeholder="e.g. 1200"
            onChange={(e) => set("_area_sqft", e.target.value === "" ? undefined : Number(e.target.value))} />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Floors</Label>
          <Input type="number" value={floorsVal} min={1} placeholder="1"
            onChange={(e) => set("_floors", e.target.value === "" ? undefined : Number(e.target.value))} />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Finish tier</Label>
          <Select value={(spec.quality_tier as string) ?? "standard"} onValueChange={(v) => set("quality_tier", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="economy">Economy</SelectItem>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="premium">Premium</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Discipline</Label>
          <Select value={discipline} onValueChange={setDiscipline}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DISCIPLINES.map((d) => <SelectItem key={d.key} value={d.key}>{d.short}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Contractor memory — pick a known contractor to pre-fill their usual choices */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Contractor</Label>
          <Select value={contractorId ?? "none"} onValueChange={(v) => v === "none" ? setContractorId(null) : pickContractor(v)}>
            <SelectTrigger><SelectValue placeholder="New / none" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">New / none</SelectItem>
              {contractors.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {!contractorId && (
          <div>
            <Label className="text-xs text-muted-foreground">…or add a new contractor</Label>
            <Input value={newContractor} placeholder="Contractor name (saves their choices)"
              onChange={(e) => setNewContractor(e.target.value)} />
          </div>
        )}
        {contractorId && (
          <div className="flex items-end text-xs text-emerald-600 dark:text-emerald-400 pb-2">
            Pre-filled {contractors.find((c) => c.id === contractorId)?.name}'s usual choices — change any below.
          </div>
        )}
      </div>

      {!urlProjectId && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-muted-foreground">Attach to project (optional)</Label>
            <Select value={selectedProjectId ?? "none"} onValueChange={(v) => setSelectedProjectId(v === "none" ? null : v)}>
              <SelectTrigger><SelectValue placeholder="Standalone BOQ" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Standalone (no project)</SelectItem>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">BOQ name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
      )}

      {/* Fine-tune — optional, not the gate */}
      <div>
        <button type="button" onClick={() => setShowDetails((s) => !s)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ChevronDown className={cn("h-4 w-4 transition-transform", showDetails && "rotate-180")} />
          Fine-tune finishes &amp; details (optional)
        </button>
        {showDetails && (
          <div className="space-y-4 mt-3">
            {BOQ_SPEC.map((section) => (
              <Card key={section.key}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{section.title}</CardTitle>
                  {section.hint && <p className="text-xs text-muted-foreground">{section.hint}</p>}
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {section.fields.map(field)}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t py-3 flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate(-1)} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy || !readyToBuild}>
          {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          Build draft BOQ
        </Button>
      </div>
    </div>
  );
}
