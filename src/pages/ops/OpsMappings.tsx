import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { supabase as catalogSupabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const PRIORITIES = ["Critical", "Recommended", "Optional"];

export default function OpsMappings() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filterStage, setFilterStage] = useState<string>("all");

  const { data: stages } = useQuery({
    queryKey: ["stage_master"],
    queryFn: async () => {
      const { data } = await supabase.from("stage_master").select("*").order("sequence");
      return data ?? [];
    },
  });

  const { data: mappings } = useQuery({
    queryKey: ["mappings", filterStage],
    queryFn: async () => {
      let q = supabase
        .from("stage_material_mapping")
        .select("*, stage_master:stage_id(name, sequence)")
        .order("created_at", { ascending: false });
      if (filterStage !== "all") q = q.eq("stage_id", filterStage);
      const { data } = await q;
      return data ?? [];
    },
  });

  const remove = async (id: string) => {
    if (!confirm("Delete mapping?")) return;
    await supabase.from("stage_material_mapping").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["mappings"] });
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Stage → Material Mapping</h1>
          <p className="text-sm text-muted-foreground">
            Links construction stages to product SKUs with lead time and reliability metadata.
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={filterStage} onValueChange={setFilterStage}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {stages?.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.sequence}. {s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-1" /> Add mapping</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>New stage → product mapping</DialogTitle></DialogHeader>
              <MappingForm stages={stages ?? []} onDone={() => {
                setOpen(false);
                qc.invalidateQueries({ queryKey: ["mappings"] });
              }} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {mappings && mappings.length === 0 && (
        <Card className="p-12 text-center text-muted-foreground">
          No mappings yet. Seed the top SKUs per stage to power the forecast engine.
        </Card>
      )}

      <div className="space-y-2">
        {mappings?.map((m) => (
          <Card key={m.id} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-medium ${
                    m.priority === "Critical" ? "bg-destructive/15 text-destructive" :
                    m.priority === "Recommended" ? "bg-primary/15 text-primary" :
                    "bg-muted text-muted-foreground"
                  }`}>{m.priority}</span>
                  <span className="text-xs text-muted-foreground">
                    {(m as any).stage_master?.sequence}. {(m as any).stage_master?.name}
                  </span>
                </div>
                <div className="font-medium mt-1">{m.product_name ?? m.product_id}</div>
                <div className="text-xs text-muted-foreground">
                  Lead time: {m.lead_time_days}d · Trigger offset: {m.trigger_offset_days}d ·
                  Buffer: {m.buffer_pct}% · Reliability: {Number(m.reliability_score) * 100}%
                </div>
                {m.notes && <div className="text-xs text-muted-foreground mt-1">{m.notes}</div>}
              </div>
              <Button variant="ghost" size="icon" onClick={() => remove(m.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function MappingForm({ stages, onDone }: { stages: any[]; onDone: () => void }) {
  const [stageId, setStageId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [productName, setProductName] = useState("");
  const [priority, setPriority] = useState("Recommended");
  const [leadTime, setLeadTime] = useState(3);
  const [triggerOffset, setTriggerOffset] = useState(5);
  const [buffer, setBuffer] = useState(10);
  const [reliability, setReliability] = useState(0.9);
  const [unit, setUnit] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: products } = useQuery({
    queryKey: ["catalog-search", productSearch],
    enabled: productSearch.length >= 2,
    queryFn: async () => {
      const { data } = await catalogSupabase
        .from("product")
        .select("id, name, brand")
        .ilike("name", `%${productSearch}%`)
        .limit(10);
      return data ?? [];
    },
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stageId || !productId) return toast.error("Stage and product required");
    setBusy(true);
    try {
      const { error } = await supabase.from("stage_material_mapping").insert({
        stage_id: stageId,
        product_id: productId,
        product_name: productName,
        priority,
        lead_time_days: leadTime,
        trigger_offset_days: triggerOffset,
        buffer_pct: buffer,
        reliability_score: reliability,
        unit: unit || null,
        notes: notes || null,
      });
      if (error) throw error;
      toast.success("Mapping added");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 max-h-[70vh] overflow-y-auto">
      <div>
        <Label>Stage</Label>
        <Select value={stageId} onValueChange={setStageId}>
          <SelectTrigger><SelectValue placeholder="Select stage" /></SelectTrigger>
          <SelectContent>
            {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.sequence}. {s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Search product catalog</Label>
        <Input
          value={productSearch}
          onChange={(e) => setProductSearch(e.target.value)}
          placeholder="Type product name…"
        />
        {products && products.length > 0 && (
          <div className="border rounded mt-1 max-h-40 overflow-y-auto">
            {products.map((p: any) => (
              <button
                type="button"
                key={p.id}
                onClick={() => {
                  setProductId(p.id);
                  setProductName(p.name);
                  setProductSearch(p.name);
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-accent ${productId === p.id ? "bg-accent" : ""}`}
              >
                <div>{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.brand}</div>
              </button>
            ))}
          </div>
        )}
        {productId && (
          <div className="text-xs text-muted-foreground mt-1">Selected: {productName}</div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Priority</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Unit</Label>
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="bags, m, pcs…" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Lead time (days)</Label>
          <Input type="number" value={leadTime} onChange={(e) => setLeadTime(+e.target.value)} />
        </div>
        <div>
          <Label>Trigger offset (days)</Label>
          <Input type="number" value={triggerOffset} onChange={(e) => setTriggerOffset(+e.target.value)} />
        </div>
        <div>
          <Label>Buffer %</Label>
          <Input type="number" value={buffer} onChange={(e) => setBuffer(+e.target.value)} />
        </div>
        <div>
          <Label>Reliability (0-1)</Label>
          <Input type="number" step="0.05" min="0" max="1" value={reliability} onChange={(e) => setReliability(+e.target.value)} />
        </div>
      </div>

      <div>
        <Label>Notes</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "…" : "Add mapping"}
      </Button>
    </form>
  );
}