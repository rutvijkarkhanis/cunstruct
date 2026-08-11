import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { BOQ_SPEC, defaultSpec, type SpecField, type Spec, type SpecValue } from "@/lib/boqSpec";
import { DISCIPLINES } from "@/lib/disciplines";
import { ARCHETYPES, archetypeSpec } from "@/lib/archetypes";
import { openIntakeForm } from "@/lib/boqIntakeForm";
import { buildChatGptPrompt, carrySeed, parseChatGptEvaluation, type ChatGptEval } from "@/lib/chatgptEval";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Loader2, ClipboardList, ChevronDown, Sparkles, Copy, Check, MessageSquare } from "lucide-react";
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

  // Step 1: ChatGPT drawing evaluation (copy/paste — no API). Then the Anchor.
  const [stage, setStage] = useState<"chatgpt" | "anchor">("chatgpt");
  const [prompt] = useState(() => buildChatGptPrompt());
  const [pasteText, setPasteText] = useState("");
  const [copied, setCopied] = useState(false);
  const [evalData, setEvalData] = useState<ChatGptEval | null>(null);

  const copyPrompt = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { toast.error("Couldn't copy — select the text and copy manually"); }
  };

  // Turn a parsed evaluation into pre-filled Anchor inputs. The operator's edits
  // downstream remain the source of truth — nothing here is auto-generated.
  const applyEval = (e: ChatGptEval) => {
    const a = e.archetypeKey ? ARCHETYPES.find((x) => x.key === e.archetypeKey) : undefined;
    const base: Spec = a ? archetypeSpec(a) : defaultSpec();
    if (e.area?.value) base._area_sqft = e.area.value;
    if (e.floors) base._floors = e.floors;
    if (e.area?.type) base._area_type = e.area.type;
    if (e.requirements.length) (base as Record<string, unknown>)._drawing = { items: e.requirements };
    if (e.measurements.length) (base as Record<string, unknown>)._measurements = e.measurements;
    if (e.spaces.length) (base as Record<string, unknown>)._spaces = e.spaces;
    (base as Record<string, unknown>)._source = "chatgpt";
    setSpec(base);
    setArch(e.archetypeKey ?? null);
    if (!project) setName(`${a?.label ?? e.projectType ?? "Project"} — BOQ`);
    setEvalData(e);
    setStage("anchor");
  };

  const analyseEvaluation = () => {
    const e = parseChatGptEvaluation(pasteText);
    if (!e.ok) { toast.error("Couldn't identify structured project information from this response."); return; }
    applyEval(e);
    toast.success("Evaluation structured — review the project setup below");
  };

  const enterManually = () => { setEvalData(null); setStage("anchor"); };

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
    // Rebuild the base spec for the new archetype but keep the ChatGPT seed
    // (drawing requirements, measurements, provenance) — never drop it.
    setSpec((s) => carrySeed(archetypeSpec(a) as unknown as Record<string, unknown>, s as unknown as Record<string, unknown>) as unknown as Spec);
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

  if (stage === "chatgpt") return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Analyse your drawing with ChatGPT</h1>
          <p className="text-sm text-muted-foreground">
            Cunstruct prepares the prompt. Copy it, open ChatGPT, attach your drawing, paste the prompt, then paste ChatGPT's evaluation back here.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { setEvalData(null); setStage("anchor"); }}>Skip ChatGPT analysis</Button>
      </div>

      <Card>
        <CardHeader className="pb-2 flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">1 · Copy the ChatGPT prompt</CardTitle>
            <p className="text-xs text-muted-foreground">You don't write anything — copy this, then attach your drawing in ChatGPT and paste it.</p>
          </div>
          <Button size="sm" onClick={copyPrompt} className="shrink-0">
            {copied ? <><Check className="h-4 w-4 mr-2" />Prompt copied</> : <><Copy className="h-4 w-4 mr-2" />Copy ChatGPT prompt</>}
          </Button>
        </CardHeader>
        <CardContent>
          <textarea readOnly value={prompt} onFocus={(e) => e.currentTarget.select()}
            className="w-full min-h-[150px] rounded-md border bg-muted/30 px-3 py-2 text-xs font-mono" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">2 · Paste ChatGPT's evaluation</CardTitle>
          <p className="text-xs text-muted-foreground">Paste the whole response — prose, bullets or tables all work.</p>
        </CardHeader>
        <CardContent className="space-y-2">
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste the response from ChatGPT here…"
            className="w-full min-h-[150px] rounded-md border bg-background px-3 py-2 text-sm" />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={analyseEvaluation} disabled={!pasteText.trim()}><MessageSquare className="h-4 w-4 mr-2" />Analyse &amp; Continue</Button>
            <Button variant="outline" onClick={enterManually}>Enter manually</Button>
            <span className="text-[11px] text-muted-foreground">ChatGPT understands the drawing · you verify it · Cunstruct structures it.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">New BOQ</h1>
          <p className="text-sm text-muted-foreground">Pick a project like yours, adjust a couple of things, get an estimate.</p>
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

      {evalData && (
        <Card className="border-accent/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><MessageSquare className="h-4 w-4" />ChatGPT drawing evaluation</CardTitle>
            <p className="text-xs text-muted-foreground">Source: ChatGPT drawing evaluation — a recommendation only. Everything below is editable and your values are used.</p>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {([
                ["Project type", evalData.projectType ?? "—", evalData.confidence["project type"]],
                ["Archetype", evalData.archetype ?? "—", evalData.confidence["archetype"]],
                ["Floors", evalData.floors != null ? String(evalData.floors) : "—", evalData.confidence["floors"]],
                ["Area", evalData.area ? `${evalData.area.value.toLocaleString("en-IN")} sqft · ${evalData.area.type}` : "Not provided", evalData.confidence["area"]],
              ] as [string, string, string | undefined][]).map(([label, value, conf]) => (
                <div key={label} className="rounded-md border px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">{label}</div>
                  <div className="font-medium">{value}</div>
                  {conf && <Badge variant="outline" className="mt-1 text-[10px]">{conf} confidence</Badge>}
                </div>
              ))}
            </div>
            {evalData.disciplines.length > 0 && (
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-xs text-muted-foreground">Disciplines:</span>
                {evalData.disciplines.map((d) => <Badge key={d} variant="secondary" className="text-[11px]">{d}</Badge>)}
              </div>
            )}
            {evalData.spaces.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Spaces</div>
                <div className="flex flex-wrap gap-1.5">
                  {evalData.spaces.map((s, i) => <Badge key={i} variant="outline" className="text-[11px]">{s.name} — {s.qty}</Badge>)}
                </div>
              </div>
            )}
            {evalData.measurements.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Drawing measurements (kept as specs, not quantities)</div>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {evalData.measurements.map((m, i) => <li key={i}>• {m.label} — <b className="text-foreground">{m.value}</b>{m.note ? ` · ${m.note}` : ""}</li>)}
                </ul>
              </div>
            )}
            {evalData.keyInfo.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
                <div className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">
                  Seen on the drawing but not counted by ChatGPT — add the quantities in the Drawing step
                </div>
                <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
                  {evalData.keyInfo.map((k, i) => <li key={i}>• {k}</li>)}
                </ul>
              </div>
            )}
            {evalData.confirmations.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
                <div className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">Confirm before generating</div>
                <ul className="text-xs space-y-0.5">
                  {evalData.confirmations.map((c, i) => <li key={i} className="text-amber-700 dark:text-amber-400">☐ {c}</li>)}
                </ul>
              </div>
            )}
            {evalData.requirements.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {evalData.requirements.length} drawing requirement{evalData.requirements.length === 1 ? "" : "s"} captured — you'll review and edit them in the <b>Drawing</b> section of the builder before they're applied.
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
          Adjust finishes &amp; details (optional)
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
          {evalData ? "Confirm & Generate BOQ" : "Prepare estimate"}
        </Button>
      </div>
    </div>
  );
}
