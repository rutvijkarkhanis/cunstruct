import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { Plus, Pencil, Trash2, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import {
  QtyBasisFields, EMPTY_QTY, qtyFromFormula, qtyToFormula, formulaLabel, type QtyState,
} from "@/components/ops/qtyFormula";
import { InfoHint } from "@/components/InfoHint";
import { BoqGuideHint } from "@/components/boq/BoqExplainer";
import { QTY_BASES, NOTE } from "@/lib/boqGlossary";

const PROJECT_TYPES = ["Residential", "Commercial", "Retail", "Office", "Hospital", "Other"];
const ALL_TYPES = "__all__";

export default function OpsBoqTemplates() {
  const qc = useQueryClient();
  const [stageId, setStageId] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data: stages } = useQuery({
    queryKey: ["stage_master"],
    queryFn: async () => {
      const { data } = await supabase.from("stage_master").select("*").order("sequence");
      return data ?? [];
    },
  });
  useEffect(() => {
    if (stages?.length && !stageId) setStageId(stages[0].id);
  }, [stages, stageId]);

  const { data: items } = useQuery({
    queryKey: ["boq-template-admin", stageId],
    enabled: !!stageId,
    queryFn: async () => {
      const { data } = await supabase.from("boq_template").select("*").eq("stage_id", stageId).order("sort");
      return data ?? [];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["boq-template-admin"] });
  const remove = async (id: string) => {
    if (!confirm("Delete this checklist item?")) return;
    const { error } = await supabase.from("boq_template").delete().eq("id", id);
    if (error) return toast.error(error.message);
    invalidate();
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="w-6 h-6" /> BOQ templates
            <InfoHint title="What is a BOQ template?" width="w-96">
              <p>A per-stage checklist of the standard materials a contractor needs — <b>independent of your catalog</b>. It's the master list the BOQ builder works from.</p>
              <p className="pt-1">Each item carries a <b>quantity formula</b> (how to size it from room dimensions) and an optional <b>catalog keyword/SKU</b>. Stocked items become orders; the rest become onboarding opportunities.</p>
              <p className="pt-1 text-xs">Tip: stages with no physical materials (Pre-Construction, Handover) are intentionally empty.</p>
            </InfoHint>
            <BoqGuideHint />
          </h1>
          <p className="text-sm text-muted-foreground">
            The standard material checklist per stage that drives BOQ generation — independent of the catalog.
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={stageId} onValueChange={setStageId}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Stage" /></SelectTrigger>
            <SelectContent>
              {stages?.map((s) => <SelectItem key={s.id} value={s.id}>{s.sequence}. {s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button onClick={() => setEditing(null)}><Plus className="w-4 h-4 mr-1" /> Add item</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>{editing ? "Edit checklist item" : "New checklist item"}</DialogTitle></DialogHeader>
              <TemplateForm
                stages={stages ?? []}
                defaultStageId={stageId}
                existing={editing}
                onDone={() => { setOpen(false); setEditing(null); invalidate(); }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {items && items.length === 0 && (
        <Card className="p-12 text-center text-muted-foreground">
          No checklist items for this stage yet. Add the standard materials contractors need here.
          <div className="text-xs mt-2">
            (Stages like Pre-Construction, Excavation, Final Finishing and Handover have no standard
            materials, so they stay empty by design.)
          </div>
        </Card>
      )}

      <div className="space-y-2">
        {items?.map((it) => (
          <Card key={it.id} className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium flex items-center gap-2">
                  {it.item_name}
                  <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                    it.project_type ? "bg-accent/20 text-amber-600 dark:text-amber-400" : "bg-muted text-muted-foreground"
                  }`}>
                    {it.project_type ?? "All types"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="text-foreground font-medium">{formulaLabel(it.qty_formula)}</span>
                  {it.unit ? ` · ${it.unit}` : ""}
                  {it.match_keyword ? ` · matches "${it.match_keyword}"` : " · no catalog keyword"}
                  {it.product_id ? " · linked SKU" : ""}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon" onClick={() => { setEditing(it); setOpen(true); }}>
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => remove(it.id)}>
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

function TemplateForm({ stages, defaultStageId, existing, onDone }: {
  stages: any[]; defaultStageId: string; existing: any; onDone: () => void;
}) {
  const [stageId, setStageId] = useState(existing?.stage_id ?? defaultStageId);
  const [projectType, setProjectType] = useState<string>(existing?.project_type ?? ALL_TYPES);
  const [itemName, setItemName] = useState(existing?.item_name ?? "");
  const [unit, setUnit] = useState(existing?.unit ?? "");
  const [keyword, setKeyword] = useState(existing?.match_keyword ?? "");
  const [sort, setSort] = useState<number>(existing?.sort ?? 0);
  const [qty, setQty] = useState<QtyState>(existing ? qtyFromFormula(existing.qty_formula) : EMPTY_QTY);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stageId || !itemName.trim()) return toast.error("Stage and item name required");
    setBusy(true);
    try {
      const payload = {
        stage_id: stageId,
        project_type: projectType === ALL_TYPES ? null : projectType,
        item_name: itemName.trim(),
        unit: unit || null,
        match_keyword: keyword || null,
        sort,
        qty_formula: qtyToFormula(qty),
      };
      const { error } = existing
        ? await supabase.from("boq_template").update(payload).eq("id", existing.id)
        : await supabase.from("boq_template").insert(payload);
      if (error) throw error;
      toast.success(existing ? "Item updated" : "Item added");
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 max-h-[70vh] overflow-y-auto">
      <div className="grid grid-cols-2 gap-3">
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
          <Label>Project type</Label>
          <Select value={projectType} onValueChange={setProjectType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TYPES}>All types</SelectItem>
              {PROJECT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Item name</Label>
          <Input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="e.g. Wall Putty" />
        </div>
        <div>
          <Label>Unit</Label>
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="bag, m, pc…" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="flex items-center gap-1">
            Catalog match keyword
            <InfoHint title="Catalog match keyword">{NOTE.matchKeyword}</InfoHint>
          </Label>
          <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="e.g. putty" />
        </div>
        <div>
          <Label>Sort order</Label>
          <Input type="number" value={sort} onChange={(e) => setSort(+e.target.value)} />
        </div>
      </div>
      <div className="flex items-center gap-1 pt-1">
        <Label className="text-sm font-medium">Quantity formula</Label>
        <InfoHint title="Quantity formula" width="w-96">
          <p>{NOTE.qtyFormula}</p>
          <div className="pt-1.5 space-y-1">
            {QTY_BASES.map((b) => (
              <div key={b.key} className="text-xs">
                <code>{b.label}</code> — {b.plain}
              </div>
            ))}
          </div>
        </InfoHint>
      </div>
      <QtyBasisFields value={qty} onChange={setQty} />
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "…" : existing ? "Save item" : "Add item"}
      </Button>
    </form>
  );
}
