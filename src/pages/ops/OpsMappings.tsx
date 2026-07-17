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
  const [presetStage, setPresetStage] = useState("");
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

  // Coverage: how many products (and how many Critical) each stage has.
  const { data: coverage } = useQuery({
    queryKey: ["mapping-coverage"],
    queryFn: async () => {
      const { data } = await supabase
        .from("stage_material_mapping")
        .select("stage_id, priority");
      const map: Record<string, { total: number; critical: number }> = {};
      (data ?? []).forEach((r: any) => {
        const c = map[r.stage_id] ?? { total: 0, critical: 0 };
        c.total += 1;
        if (r.priority === "Critical") c.critical += 1;
        map[r.stage_id] = c;
      });
      return map;
    },
  });

  const remove = async (id: string) => {
    if (!confirm("Delete mapping?")) return;
    await supabase.from("stage_material_mapping").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["mappings"] });
    qc.invalidateQueries({ queryKey: ["mapping-coverage"] });
  };

  // empty = no products at all; thin = has products but no Critical staple.
  const stageLevel = (total: number, critical: number) =>
    total === 0 ? "empty" : critical === 0 ? "thin" : "ok";

  const emptyCount = (stages ?? []).filter((s) => !(coverage?.[s.id]?.total)).length;
  const thinCount = (stages ?? []).filter((s) => {
    const c = coverage?.[s.id];
    return c && c.total > 0 && c.critical === 0;
  }).length;

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
              <Button onClick={() => setPresetStage("")}>
                <Plus className="w-4 h-4 mr-1" /> Add mapping
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>New stage → product mapping</DialogTitle></DialogHeader>
              <MappingForm stages={stages ?? []} initialStageId={presetStage} onDone={() => {
                setOpen(false);
                qc.invalidateQueries({ queryKey: ["mappings"] });
                qc.invalidateQueries({ queryKey: ["mapping-coverage"] });
              }} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stage coverage — where do I have products, and where should I add more? */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 className="font-semibold">Stage coverage</h2>
            <p className="text-xs text-muted-foreground">
              Products mapped per stage. Click a stage to filter; use + to add one there.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {emptyCount > 0 && (
              <span className="flex items-center gap-1 text-destructive">
                <span className="w-2 h-2 rounded-full bg-destructive inline-block" />
                {emptyCount} empty
              </span>
            )}
            {thinCount > 0 && (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                {thinCount} no critical item
              </span>
            )}
            <span className="flex items-center gap-1 text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              covered
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
          {stages?.map((s) => {
            const c = coverage?.[s.id] ?? { total: 0, critical: 0 };
            const level = stageLevel(c.total, c.critical);
            const tone =
              level === "empty"
                ? "border-destructive/40 bg-destructive/5"
                : level === "thin"
                  ? "border-amber-500/40 bg-amber-500/5"
                  : "border-emerald-500/40 bg-emerald-500/5";
            const active = filterStage === s.id;
            return (
              <div
                key={s.id}
                className={`relative rounded-lg border p-3 ${tone} ${active ? "ring-2 ring-primary" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => setFilterStage(active ? "all" : s.id)}
                  className="text-left w-full"
                >
                  <div className="text-xs text-muted-foreground truncate">
                    {s.sequence}. {s.name}
                  </div>
                  <div className="text-2xl font-bold leading-tight mt-1">{c.total}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {c.total === 0
                      ? "no products yet"
                      : `${c.critical} critical · ${c.total - c.critical} other`}
                  </div>
                </button>
                <button
                  type="button"
                  title={`Add a product to ${s.name}`}
                  onClick={() => {
                    setPresetStage(s.id);
                    setOpen(true);
                  }}
                  className="absolute top-2 right-2 w-6 h-6 rounded flex items-center justify-center hover:bg-background/80 text-muted-foreground"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      </Card>

      {mappings && mappings.length === 0 && (
        <Card className="p-12 text-center text-muted-foreground">
          {filterStage === "all"
            ? "No mappings yet. Seed the top SKUs per stage to power the forecast engine."
            : "No products mapped to this stage yet. Click + on the stage above to add one."}
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

function MappingForm({ stages, onDone, initialStageId = "" }: { stages: any[]; onDone: () => void; initialStageId?: string }) {
  const [stageId, setStageId] = useState(initialStageId);
  const [productSearch, setProductSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [productName, setProductName] = useState("");
  const [priority, setPriority] = useState("Recommended");
  const [leadTime, setLeadTime] = useState(3);
  const [triggerOffset, setTriggerOffset] = useState(5);
  const [buffer, setBuffer] = useState(10);
  const [reliability, setReliability] = useState(0.9);
  const [bufferDays, setBufferDays] = useState(1);
  const [stockReliability, setStockReliability] = useState(70);
  const [unit, setUnit] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: products } = useQuery({
    queryKey: ["catalog-search", productSearch],
    enabled: productSearch.length >= 2,
    queryFn: async () => {
      const { data } = await catalogSupabase
        .from("products_master")
        .select("id, name, brand")
        .eq("status", "published")
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
        buffer_days: bufferDays,
        stock_reliability_score: stockReliability,
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
        <div>
          <Label>Buffer days</Label>
          <Input type="number" min="0" value={bufferDays} onChange={(e) => setBufferDays(+e.target.value)} />
        </div>
        <div>
          <Label>Stock reliability (0-100)</Label>
          <Input type="number" min="0" max="100" value={stockReliability} onChange={(e) => setStockReliability(+e.target.value)} />
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