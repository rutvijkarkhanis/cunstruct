import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { BOQ_SPEC, defaultSpec, type SpecField, type Spec, type SpecValue } from "@/lib/boqSpec";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";

interface ProjectLite {
  id: string; name: string; project_type: string | null; scope: string | null;
  floors: number | null; area_sqft: number | null;
}

/** BOQ questionnaire — captures the parameters generation uses to pull DSR items. */
export default function OpsBoqNew() {
  const [params] = useSearchParams();
  const projectId = params.get("project");
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectLite | null>(null);
  const [spec, setSpec] = useState<Spec>(() => defaultSpec());
  const [name, setName] = useState("BOQ");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!projectId);

  useEffect(() => {
    if (!projectId) return;
    supabase.from("projects")
      .select("id, name, project_type, scope, floors, area_sqft")
      .eq("id", projectId).single()
      .then(({ data }) => {
        if (data) {
          setProject(data as ProjectLite);
          setName(`${data.name} — BOQ`);
          // Seed the questionnaire from what onboarding already knows.
          setSpec((s) => ({ ...s, plot_area: s.plot_area ?? data.area_sqft ?? undefined }));
        }
        setLoading(false);
      });
  }, [projectId]);

  const set = (key: string, value: SpecValue) => setSpec((s) => ({ ...s, [key]: value }));

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
      const { data, error } = await supabase.from("boq").insert({
        project_id: projectId, name, spec, created_by: user?.id,
      }).select("id").single();
      if (error) throw error;
      toast.success("BOQ questionnaire saved");
      navigate(projectId ? `/ops/projects/${projectId}` : "/ops/projects");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const summary = useMemo(() => {
    const n = (k: string) => Number(spec[k]) || 0;
    const rooms = n("bedrooms") + n("bathrooms") + n("kitchens") + n("living");
    return `${rooms} keyed rooms · ${spec.quality_tier ?? "standard"} tier`;
  }, [spec]);

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /></Button>
        <div>
          <h1 className="text-lg font-semibold">BOQ questionnaire</h1>
          <p className="text-sm text-muted-foreground">
            {project ? project.name : "Standalone BOQ"} · {summary}
          </p>
        </div>
      </div>

      <div>
        <Label>BOQ name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>

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

      <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t py-3 flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate(-1)} disabled={busy}>Cancel</Button>
        <Button onClick={save} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save BOQ
        </Button>
      </div>
    </div>
  );
}
