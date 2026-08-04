import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { supabase as catalogSupabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Trash2, Sparkles, Save, CheckCircle2, PackageSearch, FileText, Building2,
  Link2, AlertTriangle, Printer,
} from "lucide-react";
import { toast } from "sonner";
import { formatINR } from "@/lib/forecastEngine";
import { computeDimensions, type Room } from "@/lib/dimensions";
import { computeBoqLine, type MatchType } from "@/lib/boqGenerate";
import { suggestRooms, canSuggestRooms, tierWastageDelta, type ProjectBasics } from "@/lib/smartSuggest";
import { InfoHint } from "@/components/InfoHint";
import { NOTE } from "@/lib/boqGlossary";
import { ProductPicker, type PickedProduct } from "@/components/ops/ProductPicker";
import { DsrPicker, type PickedDsr } from "@/components/ops/DsrPicker";
import { openBoqDocument } from "@/lib/boqDocument";

const ROOM_TYPES = ["bedroom", "bathroom", "kitchen", "living", "balcony", "room"];
const TIERS = ["economy", "standard", "premium"];
const uid = () => (globalThis.crypto?.randomUUID?.() ?? `c${Date.now()}${Math.floor(Math.random() * 1e6)}`);

interface RoomRow extends Room {
  name: string; room_type: string; length_ft: number; width_ft: number;
  height_ft: number; count: number; electrical_points: number;
}
const blankRoom = (): RoomRow => ({
  name: "", room_type: "bedroom", length_ft: 10, width_ft: 10, height_ft: 10, count: 1, electrical_points: 4,
});

interface DsrRef { dsrCode?: string; dsrDesc?: string; dsrUnit?: string; dsrRate?: number }
interface Override extends DsrRef { qty?: number; price?: number; productId?: string; productName?: string; unit?: string }
interface CustomLine extends DsrRef {
  id: string; stageId: string; item_name: string; unit: string; qty: number;
  price?: number; productId?: string; productName?: string;
}
type LineMatch = MatchType | "chosen";

interface Line {
  key: string; refId: string; isCustom: boolean;
  name: string; qty: number; unit: string; price: number | null;
  priced: boolean; lineTotal: number; match: LineMatch;
  productName: string | null; explanation?: string;
  dsrCode: string | null; dsrRate: number | null; dsrUnit: string | null;
}

const MATCH_BADGE: Record<LineMatch, { label: string; cls: string; icon: any }> = {
  linked:  { label: "SKU",      cls: "text-green-700",  icon: Link2 },
  chosen:  { label: "Linked",   cls: "text-green-700",  icon: CheckCircle2 },
  keyword: { label: "≈ match",  cls: "text-amber-700",  icon: AlertTriangle },
  none:    { label: "Unlinked", cls: "text-muted-foreground", icon: PackageSearch },
};

/**
 * Structural stages are sized off gross built-up area (concrete, steel, blocks —
 * the volume of the structure). Everything downstream is finishing/services and
 * is sized off the actual rooms. This split decides which basis feeds the qty
 * engine per stage, so adding rooms moves finishing quantities but leaves the
 * structural quote pinned to built-up area.
 */
const STRUCTURAL_STAGE = /excavation|foundation|footing|plinth|rcc|structure|concrete|masonry|brick|block/i;
const isStructuralStage = (name?: string | null) => STRUCTURAL_STAGE.test(name ?? "");

/**
 * Ops-side BOQ generation — the desktop onboarding flow, as a service.
 *
 * Input split by stage (built-up area×floors → structural; rooms → finishing).
 * Output: Part 1 Bill of Quantities (the deliverable) + Part 2 "what we can
 * supply" (the priced offer). Every line is editable: override qty/price, bind
 * to a real catalog product, add or remove lines. Export produces a branded,
 * printable BOQ + quote. Edits are session-local (persistence is next).
 */
export default function OpsProjectBoq({
  projectId, project, stages,
}: {
  projectId: string;
  project: any;
  stages: any[];
}) {
  // ---- Building basics (persisted) ----------------------------------------
  const [area, setArea] = useState<number>(Number(project?.area_sqft) || 0);
  const [floors, setFloors] = useState<number>(Number(project?.floors) || 1);
  const [tier, setTier] = useState<string>(project?.quality_tier ?? "standard");
  const [bedrooms, setBedrooms] = useState<number>(Number(project?.bedrooms) || 0);
  const [bathrooms, setBathrooms] = useState<number>(Number(project?.bathrooms) || 0);
  const [kitchens, setKitchens] = useState<number>(Number(project?.kitchens) || 0);
  const [savingBasics, setSavingBasics] = useState(false);

  useEffect(() => {
    setArea(Number(project?.area_sqft) || 0);
    setFloors(Number(project?.floors) || 1);
    setTier(project?.quality_tier ?? "standard");
    setBedrooms(Number(project?.bedrooms) || 0);
    setBathrooms(Number(project?.bathrooms) || 0);
    setKitchens(Number(project?.kitchens) || 0);
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveBasics = async () => {
    setSavingBasics(true);
    try {
      const { error } = await supabase.from("projects")
        .update({ area_sqft: area, floors, quality_tier: tier, bedrooms, bathrooms, kitchens })
        .eq("id", projectId);
      if (error) throw error;
      toast.success("Project basics saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save basics");
    } finally { setSavingBasics(false); }
  };

  // ---- Rooms --------------------------------------------------------------
  const { data: roomData } = useQuery({
    queryKey: ["ops-project-rooms", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await supabase.from("project_rooms").select("*").eq("project_id", projectId).order("created_at");
      return data ?? [];
    },
  });

  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  useEffect(() => {
    if (roomData && !roomsLoaded) {
      setRooms(roomData.map((r: any) => ({
        name: r.name ?? "", room_type: r.room_type ?? "room",
        length_ft: Number(r.length_ft) || 0, width_ft: Number(r.width_ft) || 0,
        height_ft: Number(r.height_ft) || 10, count: Number(r.count) || 1,
        electrical_points: Number(r.electrical_points) || 0,
      })));
      setRoomsLoaded(true);
    }
  }, [roomData, roomsLoaded]);

  const setRoom = (i: number, patch: Partial<RoomRow>) =>
    setRooms((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const [savingRooms, setSavingRooms] = useState(false);
  const saveRooms = async () => {
    setSavingRooms(true);
    try {
      await supabase.from("project_rooms").delete().eq("project_id", projectId);
      if (rooms.length) {
        const { error } = await supabase.from("project_rooms").insert(rooms.map((r) => ({
          project_id: projectId, name: r.name || null, room_type: r.room_type,
          length_ft: r.length_ft, width_ft: r.width_ft, height_ft: r.height_ft,
          count: r.count, electrical_points: r.electrical_points,
        })));
        if (error) throw error;
      }
      toast.success("Rooms saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save rooms");
    } finally { setSavingRooms(false); }
  };

  const applySuggestedRooms = () => {
    const basics: ProjectBasics = { quality_tier: tier as any, bedrooms, bathrooms, kitchens };
    if (!canSuggestRooms(basics)) { toast.error("Enter bedroom / bathroom counts above first"); return; }
    const suggested = suggestRooms(basics);
    setRooms(suggested.map((r) => ({ ...r })));
    const total = suggested.reduce((s, r) => s + r.count, 0);
    toast.success(`Suggested ${total} room${total === 1 ? "" : "s"} — adjust, then Save rooms`);
  };

  const roomDims = useMemo(() => computeDimensions(rooms), [rooms]);
  const builtUp = area || roomDims.floorAreaSqft || null;
  const hasRooms = rooms.length > 0;
  const engineDims = useMemo(
    () => ({ ...roomDims, floorAreaSqft: roomDims.floorAreaSqft || (builtUp ?? 0) }),
    [roomDims, builtUp],
  );
  const projectType = project?.project_type ?? null;

  // ---- Template + catalog -------------------------------------------------
  const { data: rawItems } = useQuery({
    queryKey: ["ops-boq-template-all", projectType],
    queryFn: async () => {
      let q = supabase.from("boq_template")
        .select("id, item_name, match_keyword, unit, qty_formula, product_id, sort, project_type, stage_id")
        .order("sort");
      q = projectType ? q.or(`project_type.is.null,project_type.eq.${projectType}`) : q.is("project_type", null);
      const { data } = await q;
      return data ?? [];
    },
  });

  const { data: catalogMatches } = useQuery({
    queryKey: ["ops-boq-catalog-match", (rawItems ?? []).map((i: any) => i.id)],
    enabled: (rawItems ?? []).length > 0,
    queryFn: async () => {
      const ids = (rawItems ?? []).map((i: any) => i.product_id).filter(Boolean);
      const kws = (rawItems ?? []).map((i: any) => i.match_keyword).filter(Boolean);
      const orParts: string[] = [];
      if (ids.length) orParts.push(`id.in.(${ids.join(",")})`);
      kws.forEach((k: string) => orParts.push(`name.ilike.%${k}%`));
      if (!orParts.length) return [];
      try {
        const { data, error } = await catalogSupabase.from("products_master")
          .select("id, name, selling_price, unit").or(orParts.join(",")).eq("status", "published").limit(2000);
        if (error) throw error;
        return data ?? [];
      } catch { return []; }
    },
  });

  // ---- Edits (session-local) ----------------------------------------------
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [removed, setRemoved] = useState<Record<string, boolean>>({});
  const [customLines, setCustomLines] = useState<CustomLine[]>([]);
  const [picker, setPicker] = useState<{ kind: "tmpl" | "custom"; id: string; query: string } | null>(null);
  const [dsrPicker, setDsrPicker] = useState<{ kind: "tmpl" | "custom"; id: string; query: string } | null>(null);

  const patchOverride = (id: string, patch: Override) =>
    setOverrides((o) => ({ ...o, [id]: { ...o[id], ...patch } }));
  const removeLine = (id: string) => setRemoved((r) => ({ ...r, [id]: true }));
  const patchCustom = (id: string, patch: Partial<CustomLine>) =>
    setCustomLines((cl) => cl.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const removeCustom = (id: string) => setCustomLines((cl) => cl.filter((c) => c.id !== id));
  const addCustom = (stageId: string) =>
    setCustomLines((cl) => [...cl, { id: uid(), stageId, item_name: "", unit: "", qty: 1 }]);

  const onPick = (p: PickedProduct) => {
    if (!picker) return;
    if (picker.kind === "tmpl") {
      patchOverride(picker.id, { productId: p.id, productName: p.name, price: p.selling_price ?? undefined, unit: p.unit ?? undefined });
    } else {
      patchCustom(picker.id, { productId: p.id, productName: p.name, price: p.selling_price ?? undefined, unit: p.unit ?? (undefined as any), item_name: p.name });
    }
    toast.success(`Linked “${p.name}”`);
  };

  const onPickDsr = (d: PickedDsr) => {
    if (!dsrPicker) return;
    const patch = { dsrCode: d.code, dsrDesc: d.description, dsrUnit: d.unit ?? undefined, dsrRate: d.rate ?? undefined };
    if (dsrPicker.kind === "tmpl") patchOverride(dsrPicker.id, patch);
    else patchCustom(dsrPicker.id, patch);
    toast.success(`Linked DSR ${d.code}`);
  };
  const openDsrTmpl = (id: string, query: string) => setDsrPicker({ kind: "tmpl", id, query });
  const openDsrCustom = (id: string, query: string) => setDsrPicker({ kind: "custom", id, query });

  const hasEdits = Object.keys(overrides).length > 0 || Object.values(removed).some(Boolean) || customLines.length > 0;
  const resetEdits = () => { setOverrides({}); setRemoved({}); setCustomLines([]); };

  // ---- Assemble priced, editable lines per stage --------------------------
  const stageBlocks = useMemo(() => {
    const byStage = new Map<string, any[]>();
    (rawItems ?? []).forEach((it: any) => {
      const arr = byStage.get(it.stage_id) ?? []; arr.push(it); byStage.set(it.stage_id, arr);
    });
    return (stages ?? []).map((stage: any) => {
      const raw = byStage.get(stage.id) ?? [];
      const byName = new Map<string, any>();
      raw.forEach((it) => {
        const prev = byName.get(it.item_name);
        if (!prev || (it.project_type && !prev.project_type)) byName.set(it.item_name, it);
      });
      const items = Array.from(byName.values()).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

      // Structural stages quote from built-up area; finishing stages pass no
      // built-up so per-sqft items fall through to the room-derived floor area.
      const stageBuiltUp = isStructuralStage(stage.name) ? builtUp : null;
      const tmplLines: Line[] = items.filter((it) => !removed[it.id]).map((it) => {
        const c = computeBoqLine(it, engineDims, stageBuiltUp, tier, catalogMatches ?? []);
        const ov = overrides[it.id] ?? {};
        const qty = ov.qty ?? c.qty;
        const price = ov.price ?? c.price;
        const priced = price != null;
        const match: LineMatch = ov.productId ? "chosen" : c.matchType;
        return {
          key: it.id, refId: it.id, isCustom: false, name: it.item_name, qty,
          unit: ov.unit ?? c.unit, price, priced, lineTotal: priced ? Number(price) * qty : 0,
          match, productName: ov.productName ?? c.catalogProductName, explanation: c.explanation,
          dsrCode: ov.dsrCode ?? null, dsrRate: ov.dsrRate ?? null, dsrUnit: ov.dsrUnit ?? null,
        };
      }).filter((l) => l.qty > 0);

      const custLines: Line[] = customLines.filter((c) => c.stageId === stage.id).map((c) => {
        const priced = c.price != null;
        return {
          key: c.id, refId: c.id, isCustom: true, name: c.item_name, qty: c.qty,
          unit: c.unit, price: c.price ?? null, priced, lineTotal: priced ? Number(c.price) * c.qty : 0,
          match: c.productId ? "chosen" : "none", productName: c.productName ?? null,
          dsrCode: c.dsrCode ?? null, dsrRate: c.dsrRate ?? null, dsrUnit: c.dsrUnit ?? null,
        };
      });

      return { stage, lines: [...tmplLines, ...custLines] };
    }).filter((b) => b.lines.length > 0);
  }, [rawItems, stages, engineDims, builtUp, tier, catalogMatches, overrides, removed, customLines]);

  const allLines = stageBlocks.flatMap((b) => b.lines);
  const pricedCount = allLines.filter((l) => l.priced).length;
  const keywordCount = allLines.filter((l) => l.match === "keyword").length;
  const gapCount = allLines.length - pricedCount;
  const grandTotal = allLines.reduce((s, l) => s + l.lineTotal, 0);
  const offerBlocks = stageBlocks
    .map((b) => ({ stage: b.stage, lines: b.lines.filter((l) => l.priced) }))
    .filter((b) => b.lines.length > 0);
  const gapLines = allLines.filter((l) => !l.priced && l.name.trim());
  const canGenerate = !!builtUp && allLines.length > 0;

  const openPickerTmpl = (id: string, query: string) => setPicker({ kind: "tmpl", id, query });
  const openPickerCustom = (id: string, query: string) => setPicker({ kind: "custom", id, query });

  const exportDoc = () => {
    const ok = openBoqDocument({
      projectName: project?.name ?? "Project",
      customerName: project?.customer_name ?? null,
      location: project?.location ?? null,
      builtUpSqft: builtUp, floors, qualityTier: tier,
      generatedOn: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
      stages: stageBlocks.map((b) => ({
        name: b.stage.name, sequence: b.stage.sequence,
        lines: b.lines.filter((l) => l.name.trim()).map((l) => ({
          name: l.name, qty: l.qty, unit: l.unit, price: l.price, lineTotal: l.lineTotal, priced: l.priced, dsrCode: l.dsrCode,
        })),
      })),
      offerTotal: grandTotal,
      gapNames: gapLines.map((l) => l.name),
    });
    if (!ok) toast.error("Allow pop-ups to export the BOQ document.");
  };

  return (
    <div className="space-y-5 pb-20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Generate BOQ</h2>
          <p className="text-sm text-muted-foreground">
            Built-up area &amp; floors size the <b>structural</b> stages; rooms size the <b>finishing</b> stages.
          </p>
        </div>
        {hasEdits && (
          <Button size="sm" variant="ghost" onClick={resetEdits} className="text-xs text-muted-foreground shrink-0">Reset edits</Button>
        )}
      </div>

      {/* Building basics */}
      <Card className="p-5 space-y-4">
        <div className="font-medium flex items-center gap-2"><Building2 className="w-4 h-4" /> Building</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">Built-up area (sqft) <InfoHint title="Built-up area">Drives structural quantities (cement, steel, blocks). You can quote structure from this alone, before entering rooms.</InfoHint></Label>
            <Input type="number" min={0} value={area} onChange={(e) => setArea(Math.max(0, +e.target.value))} />
          </div>
          <div className="space-y-1.5"><Label>Floors</Label><Input type="number" min={1} value={floors} onChange={(e) => setFloors(Math.max(1, +e.target.value))} /></div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">Quality tier <InfoHint title="Quality tier">Sets the finish level and nudges the wastage buffer on every line — economy trims it, premium adds to it.</InfoHint></Label>
            <Select value={tier} onValueChange={setTier}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TIERS.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 flex flex-col justify-end">
            <span className="text-xs text-muted-foreground">{tier} finish · buffer {tierWastageDelta(tier) >= 0 ? "+" : ""}{tierWastageDelta(tier)}%</span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 max-w-md">
          <div className="space-y-1.5"><Label>Bedrooms</Label><Input type="number" min={0} value={bedrooms} onChange={(e) => setBedrooms(Math.max(0, +e.target.value))} /></div>
          <div className="space-y-1.5"><Label>Bathrooms</Label><Input type="number" min={0} value={bathrooms} onChange={(e) => setBathrooms(Math.max(0, +e.target.value))} /></div>
          <div className="space-y-1.5"><Label>Kitchens</Label><Input type="number" min={0} value={kitchens} onChange={(e) => setKitchens(Math.max(0, +e.target.value))} /></div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={saveBasics} disabled={savingBasics} className="gap-1"><Save className="w-4 h-4" /> {savingBasics ? "Saving…" : "Save basics"}</Button>
          <Button size="sm" variant="ghost" onClick={applySuggestedRooms} className="gap-1" title="Auto-build the room list from the counts"><Sparkles className="w-4 h-4 text-primary" /> Suggest rooms</Button>
        </div>
      </Card>

      {/* Rooms */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-medium flex items-center gap-1.5">
            Rooms <span className="text-xs font-normal text-muted-foreground">— drive finishing stages</span>
            <InfoHint title="Why rooms?">{NOTE.whyRooms}</InfoHint>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setRooms((r) => [...r, blankRoom()])} className="gap-1"><Plus className="w-4 h-4" /> Add room</Button>
            <Button size="sm" onClick={saveRooms} disabled={savingRooms} className="gap-1"><Save className="w-4 h-4" /> {savingRooms ? "Saving…" : "Save rooms"}</Button>
          </div>
        </div>
        {!hasRooms && (
          <p className="text-sm text-muted-foreground py-2">No rooms yet — structural stages still quote from built-up area. Add rooms (or set counts and hit <b>Suggest rooms</b>) to unlock finishing stages.</p>
        )}
        {hasRooms && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-2 pr-3 font-medium">Type</th><th className="py-2 pr-3 font-medium">Label</th>
                <th className="py-2 pr-3 font-medium">L</th><th className="py-2 pr-3 font-medium">W</th><th className="py-2 pr-3 font-medium">H</th>
                <th className="py-2 pr-3 font-medium">Count</th><th className="py-2 pr-3 font-medium">Elec.</th><th className="py-2 w-8" />
              </tr></thead>
              <tbody>
                {rooms.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1.5 pr-3">
                      <Select value={r.room_type} onValueChange={(v) => setRoom(i, { room_type: v })}>
                        <SelectTrigger className="h-8 w-28 capitalize"><SelectValue /></SelectTrigger>
                        <SelectContent>{ROOM_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="py-1.5 pr-3"><Input className="h-8 w-32" value={r.name} placeholder="e.g. Master" onChange={(e) => setRoom(i, { name: e.target.value })} /></td>
                    <td className="py-1.5 pr-3"><Input className="h-8 w-14" type="number" value={r.length_ft} onChange={(e) => setRoom(i, { length_ft: +e.target.value })} /></td>
                    <td className="py-1.5 pr-3"><Input className="h-8 w-14" type="number" value={r.width_ft} onChange={(e) => setRoom(i, { width_ft: +e.target.value })} /></td>
                    <td className="py-1.5 pr-3"><Input className="h-8 w-14" type="number" value={r.height_ft} onChange={(e) => setRoom(i, { height_ft: +e.target.value })} /></td>
                    <td className="py-1.5 pr-3"><Input className="h-8 w-14" type="number" min={1} value={r.count} onChange={(e) => setRoom(i, { count: Math.max(1, +e.target.value) })} /></td>
                    <td className="py-1.5 pr-3"><Input className="h-8 w-14" type="number" min={0} value={r.electrical_points} onChange={(e) => setRoom(i, { electrical_points: Math.max(0, +e.target.value) })} /></td>
                    <td className="py-1.5"><Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setRooms((rs) => rs.filter((_, idx) => idx !== i))}><Trash2 className="w-4 h-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!builtUp ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Enter a built-up area (or add rooms) to generate the BOQ.</Card>
      ) : (
        <>
          {keywordCount > 0 && (
            <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {keywordCount} line{keywordCount === 1 ? "" : "s"} matched a product by keyword (not a confirmed SKU). Click the product on any line to confirm or swap it before you send the quote.
            </div>
          )}

          {/* PART 1 — Bill of Quantities */}
          <div className="flex items-center gap-2 pt-1">
            <FileText className="w-4 h-4 text-primary" />
            <h3 className="font-semibold">Bill of Quantities</h3>
            <span className="text-xs text-muted-foreground">{allLines.length} items · {stageBlocks.length} stages</span>
          </div>

          {stageBlocks.map(({ stage, lines }) => (
            <Card key={stage.id} className="overflow-hidden">
              <div className="px-4 py-2.5 bg-muted/40 border-b font-medium text-sm flex items-center justify-between">
                <span>{stage.sequence}. {stage.name}</span>
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => addCustom(stage.id)}><Plus className="w-3.5 h-3.5" /> Add material</Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2 px-4 font-medium">Material</th>
                    <th className="py-2 px-3 font-medium w-40">Quantity</th>
                    <th className="py-2 px-3 font-medium">DSR reference</th>
                    <th className="py-2 px-3 font-medium">Catalog product</th>
                    <th className="py-2 px-3 w-8" />
                  </tr></thead>
                  <tbody>
                    {lines.map((l) => {
                      const badge = MATCH_BADGE[l.match];
                      const Icon = badge.icon;
                      return (
                        <tr key={l.key} className="border-b last:border-0">
                          <td className="py-2 px-4">
                            {l.isCustom ? (
                              <Input className="h-8 w-48" value={l.name} placeholder="Material name" onChange={(e) => patchCustom(l.refId, { item_name: e.target.value })} />
                            ) : (
                              <div className="flex items-center gap-1.5">
                                {l.name}
                                {l.explanation && <InfoHint title={l.name}><span className="text-xs">{l.explanation}</span></InfoHint>}
                              </div>
                            )}
                          </td>
                          <td className="py-1.5 px-3">
                            <div className="flex items-center gap-1.5">
                              <Input className="h-8 w-20" type="number" min={0} value={l.qty}
                                onChange={(e) => l.isCustom ? patchCustom(l.refId, { qty: Math.max(0, +e.target.value) }) : patchOverride(l.refId, { qty: Math.max(0, +e.target.value) })} />
                              {l.isCustom
                                ? <Input className="h-8 w-16" value={l.unit} placeholder="unit" onChange={(e) => patchCustom(l.refId, { unit: e.target.value })} />
                                : <span className="text-xs text-muted-foreground">{l.unit}</span>}
                            </div>
                          </td>
                          <td className="py-1.5 px-3">
                            <button
                              onClick={() => l.isCustom ? openDsrCustom(l.refId, l.name) : openDsrTmpl(l.refId, l.name)}
                              className="group inline-flex items-center gap-1.5 text-left max-w-[15rem]"
                              title="Link an official DSR item (code + govt rate)"
                            >
                              <FileText className={`w-3.5 h-3.5 shrink-0 ${l.dsrCode ? "text-primary" : "text-muted-foreground/70"}`} />
                              {l.dsrCode
                                ? <span className="text-xs whitespace-nowrap"><code className="bg-muted px-1 rounded text-foreground">{l.dsrCode}</code>{l.dsrRate != null && <span className="text-muted-foreground"> · {formatINR(l.dsrRate)}/{l.dsrUnit}</span>}</span>
                                : <span className="text-xs text-muted-foreground group-hover:text-foreground underline decoration-dotted">Link DSR…</span>}
                            </button>
                          </td>
                          <td className="py-1.5 px-3">
                            <button
                              onClick={() => l.isCustom ? openPickerCustom(l.refId, l.name) : openPickerTmpl(l.refId, l.name)}
                              className="group inline-flex items-center gap-1.5 text-left max-w-[16rem]"
                              title="Click to link or change the catalog product"
                            >
                              <Icon className={`w-3.5 h-3.5 shrink-0 ${badge.cls}`} />
                              {l.productName
                                ? <span className="truncate text-xs">{l.productName}</span>
                                : <span className="text-xs text-muted-foreground group-hover:text-foreground underline decoration-dotted">Link product…</span>}
                              {l.match === "keyword" && <span className="text-[10px] text-amber-700">≈</span>}
                            </button>
                          </td>
                          <td className="py-2 px-3">
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => l.isCustom ? removeCustom(l.refId) : removeLine(l.refId)}><Trash2 className="w-3.5 h-3.5" /></Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}

          {/* PART 2 — What we can supply */}
          <div className="flex items-center gap-2 pt-3">
            <PackageSearch className="w-4 h-4" />
            <h3 className="font-semibold">What we can supply</h3>
            <span className="text-xs text-muted-foreground">{pricedCount} of {allLines.length} priced · {gapCount} to source</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="p-4"><div className="text-xs text-muted-foreground">Offer value</div><div className="text-2xl font-bold">{formatINR(grandTotal)}</div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> We supply</div><div className="text-2xl font-bold">{pricedCount}<span className="text-sm font-normal text-muted-foreground"> items</span></div></Card>
            <Card className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><PackageSearch className="w-3.5 h-3.5 text-amber-600" /> To source</div><div className="text-2xl font-bold">{gapCount}<span className="text-sm font-normal text-muted-foreground"> items</span></div></Card>
          </div>

          {offerBlocks.map(({ stage, lines }) => {
            const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
            return (
              <Card key={stage.id} className="overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b">
                  <span className="font-medium text-sm">{stage.sequence}. {stage.name}</span>
                  <span className="text-sm font-semibold">{formatINR(subtotal)}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-2 px-4 font-medium">Material</th>
                      <th className="py-2 px-3 font-medium text-right">Qty</th>
                      <th className="py-2 px-3 font-medium w-32">Unit price</th>
                      <th className="py-2 px-4 font-medium text-right">Line total</th>
                    </tr></thead>
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l.key} className="border-b last:border-0">
                          <td className="py-2 px-4">{l.name || <span className="text-muted-foreground">Unnamed</span>}</td>
                          <td className="py-2 px-3 text-right whitespace-nowrap">{l.qty} {l.unit}</td>
                          <td className="py-1.5 px-3"><Input className="h-8 w-24" type="number" min={0} value={l.price ?? ""} onChange={(e) => { const v = e.target.value === "" ? undefined : Math.max(0, +e.target.value); l.isCustom ? patchCustom(l.refId, { price: v }) : patchOverride(l.refId, { price: v }); }} /></td>
                          <td className="py-2 px-4 text-right whitespace-nowrap font-medium">{formatINR(l.lineTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}

          {gapLines.length > 0 && (
            <Card className="p-4">
              <div className="text-sm font-medium mb-2 flex items-center gap-1.5"><PackageSearch className="w-4 h-4 text-amber-600" /> To source — not priced yet ({gapLines.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {gapLines.map((l) => (
                  <button key={l.key} onClick={() => l.isCustom ? openPickerCustom(l.refId, l.name) : openPickerTmpl(l.refId, l.name)} className="text-xs bg-muted hover:bg-muted/70 rounded px-2 py-1">
                    {l.name} · {l.qty} {l.unit} <span className="text-primary">link</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">Link a catalog product (or set a price above) to move an item into your offer.</p>
            </Card>
          )}
        </>
      )}

      {/* Sticky action bar */}
      {canGenerate && (
        <div className="sticky bottom-0 -mx-1 mt-4">
          <div className="flex items-center justify-between gap-4 bg-card/95 backdrop-blur border rounded-lg shadow-lg px-4 py-3">
            <div className="text-sm">
              <span className="text-muted-foreground">Offer total</span> <span className="font-bold text-base">{formatINR(grandTotal)}</span>
              <span className="text-muted-foreground"> · {pricedCount}/{allLines.length} priced{keywordCount ? ` · ${keywordCount} to confirm` : ""}</span>
            </div>
            <Button size="sm" onClick={exportDoc} className="gap-1.5"><Printer className="w-4 h-4" /> Export BOQ &amp; quote</Button>
          </div>
        </div>
      )}

      <ProductPicker
        key={picker?.id ?? "none"}
        open={!!picker}
        onOpenChange={(o) => { if (!o) setPicker(null); }}
        initialQuery={picker?.query}
        onPick={onPick}
      />
      <DsrPicker
        key={dsrPicker?.id ?? "dsr-none"}
        open={!!dsrPicker}
        onOpenChange={(o) => { if (!o) setDsrPicker(null); }}
        initialQuery={dsrPicker?.query}
        onPick={onPickDsr}
      />
    </div>
  );
}
