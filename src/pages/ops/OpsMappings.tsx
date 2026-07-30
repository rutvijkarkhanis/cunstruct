import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { supabase as catalogSupabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, DownloadCloud, Pencil } from "lucide-react";
import { toast } from "sonner";
import { mapCategoryToStage } from "@/lib/stageMapping";

const PRIORITIES = ["Critical", "Recommended", "Optional"];

export default function OpsMappings() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
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
        .order("created_at", { ascending: false })
        .limit(5000);
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
        .select("stage_id, priority")
        .limit(20000);
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
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <DownloadCloud className="w-4 h-4 mr-1" /> Import from catalog
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>Import materials from the product catalog</DialogTitle></DialogHeader>
              <ImportFromCatalog stages={stages ?? []} onDone={() => {
                setImportOpen(false);
                qc.invalidateQueries({ queryKey: ["mappings"] });
                qc.invalidateQueries({ queryKey: ["mapping-coverage"] });
              }} />
            </DialogContent>
          </Dialog>
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
                  Coverage:{" "}
                  {(m as any).qty_formula && formulaLabel((m as any).qty_formula) !== "not set" ? (
                    <span className="text-foreground font-medium">{formulaLabel((m as any).qty_formula)}</span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400 font-medium">not set</span>
                  )}
                  {" "}· Buffer: {m.buffer_pct}% · Lead: {m.lead_time_days}d · Reliability: {Number(m.reliability_score) * 100}%
                </div>
                {m.notes && <div className="text-xs text-muted-foreground mt-1">{m.notes}</div>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <EditMappingDialog
                  mapping={m}
                  onDone={() => {
                    qc.invalidateQueries({ queryKey: ["mappings"] });
                    qc.invalidateQueries({ queryKey: ["mapping-coverage"] });
                  }}
                />
                <Button variant="ghost" size="icon" onClick={() => remove(m.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---- Quantity basis (qty_formula) editing ---------------------------------
// qty_formula drives the BOQ pre-fill: { per_sqft } (coverage) or { fixed },
// plus an optional { unit_price } override. These helpers convert between the
// stored jsonb and editable form state.
type QtyBasis =
  | "per_floor_sqft" | "per_wall_sqft" | "per_point"
  | "per_room" | "per_bathroom" | "per_sqft" | "fixed";
type QtyState = { basis: QtyBasis; amount: string; unitPrice: string; packSize: string };

const BASIS_KEYS: QtyBasis[] = [
  "per_floor_sqft", "per_wall_sqft", "per_point", "per_room", "per_bathroom", "per_sqft", "fixed",
];
const BASIS_META: Record<QtyBasis, { label: string; short: string; hint: string; placeholder: string }> = {
  per_floor_sqft: { label: "Per floor sq.ft", short: "/floor sq.ft", hint: "Units per sq.ft of floor/carpet area (tiles, flooring, adhesive).", placeholder: "e.g. 0.025" },
  per_wall_sqft: { label: "Per wall sq.ft", short: "/wall sq.ft", hint: "Units per sq.ft of wall area (paint, putty, plaster).", placeholder: "e.g. 0.02" },
  per_point: { label: "Per electrical point", short: "/point", hint: "Units per electrical point (wire, switches, conduit).", placeholder: "e.g. 15" },
  per_room: { label: "Per room", short: "/room", hint: "Units per room (doors, lights).", placeholder: "e.g. 1" },
  per_bathroom: { label: "Per bathroom", short: "/bathroom", hint: "Units per bathroom (sanitaryware).", placeholder: "e.g. 1" },
  per_sqft: { label: "Per built-up sq.ft", short: "/sq.ft", hint: "Units per sq.ft of built-up area (cement, steel, generic).", placeholder: "e.g. 0.4" },
  fixed: { label: "Fixed quantity", short: " fixed", hint: "A flat quantity regardless of project size.", placeholder: "e.g. 4" },
};

const EMPTY_QTY: QtyState = { basis: "per_floor_sqft", amount: "", unitPrice: "", packSize: "" };

function qtyFromFormula(f: any): QtyState {
  const found = BASIS_KEYS.find((k) => f?.[k] != null);
  return {
    basis: found ?? "per_floor_sqft",
    amount: found && f[found] != null ? String(f[found]) : "",
    unitPrice: f?.unit_price != null ? String(f.unit_price) : "",
    packSize: f?.pack_size != null ? String(f.pack_size) : "",
  };
}

function qtyToFormula(q: QtyState): Record<string, number> | null {
  const out: Record<string, number> = {};
  const amt = parseFloat(q.amount);
  if (!isNaN(amt)) out[q.basis] = amt;
  const up = parseFloat(q.unitPrice);
  if (!isNaN(up)) out.unit_price = up;
  const ps = parseFloat(q.packSize);
  if (!isNaN(ps) && ps > 0) out.pack_size = ps;
  return Object.keys(out).length ? out : null;
}

function formulaLabel(f: any): string {
  const found = BASIS_KEYS.find((k) => f?.[k] != null);
  if (!found) return "not set";
  return `${f[found]}${BASIS_META[found].short}`;
}

function QtyBasisFields({ value, onChange }: { value: QtyState; onChange: (v: QtyState) => void }) {
  return (
    <div className="space-y-2">
      <Label>Quantity basis</Label>
      <div className="flex gap-2">
        <Select value={value.basis} onValueChange={(v) => onChange({ ...value, basis: v as QtyBasis })}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            {BASIS_KEYS.map((k) => <SelectItem key={k} value={k}>{BASIS_META[k].label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          type="number" step="any" min="0"
          placeholder={BASIS_META[value.basis].placeholder}
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">{BASIS_META[value.basis].hint}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Pack size (optional)</Label>
          <Input
            type="number" step="any" min="0" placeholder="round up to multiples of"
            value={value.packSize}
            onChange={(e) => onChange({ ...value, packSize: e.target.value })}
          />
        </div>
        <div>
          <Label>Unit price override (optional)</Label>
          <Input
            type="number" step="any" min="0" placeholder="use live catalog price"
            value={value.unitPrice}
            onChange={(e) => onChange({ ...value, unitPrice: e.target.value })}
          />
        </div>
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
  const [qty, setQty] = useState<QtyState>(EMPTY_QTY);
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
        qty_formula: qtyToFormula(qty),
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

      <QtyBasisFields value={qty} onChange={setQty} />

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

function EditMappingDialog({ mapping, onDone }: { mapping: any; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<QtyState>(() => qtyFromFormula(mapping.qty_formula));
  const [buffer, setBuffer] = useState<string>(String(mapping.buffer_pct ?? 10));
  const [unit, setUnit] = useState<string>(mapping.unit ?? "");
  const [busy, setBusy] = useState(false);

  // Re-seed from the row each time the dialog opens.
  useEffect(() => {
    if (open) {
      setQty(qtyFromFormula(mapping.qty_formula));
      setBuffer(String(mapping.buffer_pct ?? 10));
      setUnit(mapping.unit ?? "");
    }
  }, [open, mapping]);

  const save = async () => {
    setBusy(true);
    try {
      const { error } = await supabase
        .from("stage_material_mapping")
        .update({
          qty_formula: qtyToFormula(qty),
          buffer_pct: parseFloat(buffer) || 0,
          unit: unit || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", mapping.id);
      if (error) throw error;
      toast.success("Coverage updated");
      setOpen(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Edit coverage / quantity">
          <Pencil className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Coverage · {mapping.product_name ?? mapping.product_id}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <QtyBasisFields value={qty} onChange={setQty} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Wastage buffer %</Label>
              <Input type="number" min="0" value={buffer} onChange={(e) => setBuffer(e.target.value)} />
            </div>
            <div>
              <Label>Unit</Label>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="bags, m, pcs…" />
            </div>
          </div>
          <Button onClick={save} disabled={busy} className="w-full">
            {busy ? "Saving…" : "Save coverage"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImportFromCatalog({ stages, onDone }: { stages: any[]; onDone: () => void }) {
  const [priority, setPriority] = useState("Recommended");
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [includeAll, setIncludeAll] = useState(false);
  const [fallbackStage, setFallbackStage] = useState(""); // stage name for unmatched, "" = skip
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  // Product IDs already mapped (in the main app DB) so we don't create duplicates.
  const { data: existing } = useQuery({
    queryKey: ["mapped-product-ids"],
    queryFn: async () => {
      const { data } = await supabase.from("stage_material_mapping").select("product_id").limit(20000);
      return new Set((data ?? []).map((r: any) => String(r.product_id)));
    },
  });

  // Products from the catalog project — published only by default, or every status.
  const { data: products, isLoading, error } = useQuery({
    queryKey: ["catalog-import-products", includeAll],
    queryFn: async () => {
      let q = catalogSupabase
        .from("products_master")
        .select("id, name, main_category, unit, status")
        .limit(10000);
      if (!includeAll) q = q.eq("status", "published");
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Plan: new products grouped by the stage they map to; unmatched kept aside.
  const plan = useMemo(() => {
    const byStage: Record<string, any[]> = {};
    const uncategorized: any[] = [];
    let alreadyMapped = 0;
    (products ?? []).forEach((p: any) => {
      if (existing?.has(String(p.id))) { alreadyMapped++; return; }
      const stage = mapCategoryToStage(p.main_category, p.name);
      if (!stage) { uncategorized.push(p); return; }
      (byStage[stage] ??= []).push(p);
    });
    return { byStage, uncategorized, alreadyMapped };
  }, [products, existing]);

  // Fold unmatched products into the chosen fallback stage (if any).
  const effectiveByStage = useMemo(() => {
    const m: Record<string, any[]> = {};
    Object.entries(plan.byStage).forEach(([k, v]) => { m[k] = v; });
    if (fallbackStage && plan.uncategorized.length) {
      m[fallbackStage] = [...(m[fallbackStage] ?? []), ...plan.uncategorized];
    }
    return m;
  }, [plan, fallbackStage]);

  const orderedStages = (stages ?? []).filter((s) => effectiveByStage[s.name]?.length);
  const totalSelected = orderedStages.reduce(
    (sum, s) => sum + (excluded[s.name] ? 0 : effectiveByStage[s.name].length),
    0,
  );

  const doImport = async () => {
    setBusy(true);
    try {
      const rows: any[] = [];
      orderedStages.forEach((s) => {
        if (excluded[s.name]) return;
        effectiveByStage[s.name].forEach((p: any) => {
          rows.push({
            stage_id: s.id,
            product_id: String(p.id),
            product_name: p.name,
            priority,
            unit: p.unit ?? null,
            lead_time_days: 3,
            trigger_offset_days: 5,
            buffer_pct: 10,
            reliability_score: 0.9,
            buffer_days: 1,
            stock_reliability_score: 70,
          });
        });
      });
      if (!rows.length) { toast.error("Nothing selected to import"); return; }
      const CHUNK = 200;
      for (let i = 0; i < rows.length; i += CHUNK) {
        setProgress(`Importing ${Math.min(i + CHUNK, rows.length)}/${rows.length}…`);
        const { error } = await supabase.from("stage_material_mapping").insert(rows.slice(i, i + CHUNK));
        if (error) throw error;
      }
      toast.success(`Imported ${rows.length} mappings`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading catalog…</div>;
  if (error) return <div className="py-8 text-center text-sm text-destructive">Couldn't load the catalog. {(error as Error).message}</div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {products?.length ?? 0} catalog products ({includeAll ? "all statuses" : "published only"}) ·{" "}
        {plan.alreadyMapped} already mapped · {plan.uncategorized.length} unmatched.
      </p>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <Checkbox checked={includeAll} onCheckedChange={(v) => setIncludeAll(!!v)} />
        Include products that aren't published yet
      </label>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label>Priority for imported items</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Unmatched products ({plan.uncategorized.length})</Label>
          <Select value={fallbackStage || "__skip__"} onValueChange={(v) => setFallbackStage(v === "__skip__" ? "" : v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__skip__">Skip them</SelectItem>
              {(stages ?? []).map((s) => (
                <SelectItem key={s.id} value={s.name}>Put in {s.sequence}. {s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {orderedStages.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Nothing new to import — every matchable product is already mapped.
          {plan.uncategorized.length > 0 && " Pick a stage under “Unmatched products” to import the rest."}
        </Card>
      ) : (
        <div className="border rounded max-h-72 overflow-y-auto divide-y">
          {orderedStages.map((s) => (
            <label key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-accent/50">
              <Checkbox
                checked={!excluded[s.name]}
                onCheckedChange={(v) => setExcluded((e) => ({ ...e, [s.name]: !v }))}
              />
              <span className="flex-1">{s.sequence}. {s.name}</span>
              <span className="text-muted-foreground">{effectiveByStage[s.name].length} products</span>
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{progress}</span>
        <Button onClick={doImport} disabled={busy || totalSelected === 0 || existing === undefined}>
          {busy ? "Importing…" : `Import ${totalSelected} mapping${totalSelected === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}