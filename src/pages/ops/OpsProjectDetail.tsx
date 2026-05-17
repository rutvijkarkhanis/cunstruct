import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, MessageSquare, Camera, Mic } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function OpsProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data: project } = useQuery({
    queryKey: ["project", id],
    enabled: !!id,
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
    queryKey: ["updates", id],
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

  const [stageId, setStageId] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [source, setSource] = useState<string>("app");
  const [note, setNote] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const logUpdate = async () => {
    if (!stageId) return toast.error("Select a stage");
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from("stage_updates").insert({
        project_id: id,
        stage_id: stageId,
        progress_pct: progress,
        source,
        note,
        created_by: user?.id,
      });
      await supabase.from("projects").update({
        current_stage_id: stageId,
        progress_pct: progress,
      }).eq("id", id!);
      toast.success("Update logged");
      setNote("");
      qc.invalidateQueries({ queryKey: ["project", id] });
      qc.invalidateQueries({ queryKey: ["updates", id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  if (!project) return <div className="p-8 text-muted-foreground">Loading…</div>;
  const stageName = (project as any).stage_master?.name;
  const stageSeq = (project as any).stage_master?.sequence ?? 0;

  return (
    <div className="p-8 space-y-6">
      <Link to="/ops/projects" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1">
        <ArrowLeft className="w-3 h-3" /> All projects
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-sm text-muted-foreground">
            {project.client_name} · {project.location} · {project.project_type} · {project.scope}
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>{project.floors ?? "—"} floors · {project.area_sqft ?? "—"} sqft</div>
          <div>Target: {project.estimated_completion ?? "—"}</div>
        </div>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-xs text-muted-foreground">Current stage</div>
            <div className="font-semibold">{stageName ?? "Not set"}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Progress</div>
            <div className="font-semibold">{Number(project.progress_pct).toFixed(0)}%</div>
          </div>
        </div>
        <Progress value={Number(project.progress_pct)} />

        <div className="grid grid-cols-8 gap-1 mt-4">
          {stages?.slice(0, 16).map((s) => (
            <div
              key={s.id}
              title={s.name}
              className={`h-2 rounded ${
                s.sequence < stageSeq
                  ? "bg-primary"
                  : s.sequence === stageSeq
                  ? "bg-primary/50"
                  : "bg-muted"
              }`}
            />
          ))}
        </div>
        <div className="text-[10px] text-muted-foreground mt-1">Pre-Construction → Handover</div>
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-semibold">Log stage update</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Stage</Label>
            <Select value={stageId} onValueChange={setStageId}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {stages?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.sequence}. {s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Progress %</Label>
            <Input type="number" min={0} max={100} value={progress} onChange={(e) => setProgress(+e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Source</Label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="app">App (ops entry)</SelectItem>
              <SelectItem value="whatsapp">WhatsApp text</SelectItem>
              <SelectItem value="photo">WhatsApp photo</SelectItem>
              <SelectItem value="voice">WhatsApp voice</SelectItem>
              <SelectItem value="call">Phone call</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Note</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. shuttering up on floor 3" />
        </div>
        <Button onClick={logUpdate} disabled={busy}>{busy ? "…" : "Log update"}</Button>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold mb-3">Update history</h2>
        {(!updates || updates.length === 0) && (
          <div className="text-sm text-muted-foreground">No updates yet</div>
        )}
        <div className="space-y-3">
          {updates?.map((u) => {
            const Icon = u.source === "photo" ? Camera : u.source === "voice" ? Mic : MessageSquare;
            return (
              <div key={u.id} className="flex gap-3 text-sm">
                <Icon className="w-4 h-4 mt-0.5 text-muted-foreground" />
                <div className="flex-1">
                  <div>
                    <span className="font-medium">{(u as any).stage_master?.name}</span>
                    <span className="text-muted-foreground"> at {Number(u.progress_pct).toFixed(0)}%</span>
                  </div>
                  {u.note && <div className="text-xs text-muted-foreground">{u.note}</div>}
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    {u.source} · {formatDistanceToNow(new Date(u.recorded_at))} ago
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}