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
import { Plus, Trash2, Sparkles, Save, CheckCircle2, PackageSearch } from "lucide-react";
import { toast } from "sonner";
import { formatINR } from "@/lib/forecastEngine";
import { computeDimensions, type Room } from "@/lib/dimensions";
import { computeBoqLine } from "@/lib/boqGenerate";
import { suggestRooms, canSuggestRooms, tierWastageDelta, type ProjectBasics } from "@/lib/smartSuggest";
import { BoqGuideHint } from "@/components/boq/BoqExplainer";
import { InfoHint } from "@/components/InfoHint";
import { NOTE } from "@/lib/boqGlossary";

const ROOM_TYPES = ["bedroom", "bathroom", "kitchen", "living", "balcony", "room"];
const TIERS = ["economy", "standard", "premium"];

interface RoomRow extends Room {
  name: string; room_type: string; length_ft: number; width_ft: number;
  height_ft: number; count: number; electrical_points: number;
}
const blankRoom = (): RoomRow => ({
  name: "", room_type: "bedroom", length_ft: 10, width_ft: 10, height_ft: 10, count: 1, electrical_points: 4,
});

/**
 * Ops-side "BOQ generation" — the desktop onboarding flow. You sit with a
 * contractor, enter the project's rooms and basics, and generate a priced
 * bill of quantities across every stage: what you can supply now (catalog) and
 * what needs sourcing (gaps).
 */
export default function OpsProjectBoq({
  projectId, project, stages,
}: {
  projectId: string;
  project: any;
  stages: any[];
}) {
  // ---- Project basics (persisted on the projects row) ---------------------
  const [tier, setTier] = useState<string>(project?.quality_tier ?? "standard");
  const [bedrooms, setBedrooms] = useState<number>(Number(project?.bedrooms) || 0);
  const [bathrooms, setBathrooms] = useState<number>(Number(project?.bathrooms) || 0);
  const [kitchens, setKitchens] = useState<number>(Number(project?.kitchens) || 0);
  const [savingBasics, setSavingBasics] = useState(false);

  useEffect(() => {
    setTier(project?.quality_tier ?? "standard");
    setBedrooms(Number(project?.bedrooms) || 0);
    setBathrooms(Number(project?.bathrooms) || 0);
    setKitchens(Number(project?.kitchens) || 0);
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveBasics = async () => {
    setSavingBasics(true);
    try {
      const { error } = await supabase
        .from("projects")
        .update({ quality_tier: tier, bedrooms, bathrooms, kitchens })
        .eq("id", projectId);
      if (error) throw error;
      toast.success("Project basics saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save basics");
    } finally {
      setSavingBasics(false);
    }
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
        const { error } = await supabase.from("project_rooms").insert(
          rooms.map((r) => ({
            project_id: projectId, name: r.name || null, room_type: r.room_type,
            length_ft: r.length_ft, width_ft: r.width_ft, height_ft: r.height_ft,
            count: r.count, electrical_points: r.electrical_points,
          })),
        );
        if (error) throw error;
      }
      toast.success("Rooms saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save rooms");
    } finally {
      setSavingRooms(false);
    }
  };

  const applySuggestedRooms = () => {
    const basics: ProjectBasics = { quality_tier: tier as any, bedrooms, bathrooms, kitchens };
    if (!canSuggestRooms(basics)) {
      toast.error("Enter bedroom / bathroom counts above first");
      return;
    }
    const suggested = suggestRooms(basics);
    setRooms(suggested.map((r) => ({ ...r })));
    const total = suggested.reduce((s, r) => s + r.count, 0);
    toast.success(`Suggested ${total} room${total === 1 ? "" : "s"} — adjust sizes, then Save & Generate`);
  };

  const dims = useMemo(() => computeDimensions(rooms), [rooms]);
  const builtUp = project?.area_sqft != null ? Number(project.area_sqft) : dims.floorAreaSqft || null;
  const projectType = project?.project_type ?? null;

  // ---- BOQ template across ALL stages -------------------------------------
  const { data: rawItems } = useQuery({
    queryKey: ["ops-boq-template-all", projectType],
    queryFn: async () => {
      let q = supabase
        .from("boq_template")
        .select("id, item_name, match_keyword, unit, qty_formula, product_id, sort, project_type, stage_id")
        .order("sort");
      q = projectType ? q.or(`project_type.is.null,project_type.eq.${projectType}`) : q.is("project_type", null);
      const { data } = await q;
      return data ?? [];
    },
  });

  // Resolve every template item to a catalog product (explicit id or keyword).
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
        const { data, error } = await catalogSupabase
          .from("products_master")
          .select("id, name, selling_price, unit")
          .or(orParts.join(","))
          .eq("status", "published")
          .limit(2000);
        if (error) throw error;
        return data ?? [];
      } catch {
        return [];
      }
    },
  });

  // Group items by stage, dedupe (a type-specific item overrides a generic one
  // of the same name within its stage), then compute a priced line for each.
  const stageBlocks = useMemo(() => {
    const byStage = new Map<string, any[]>();
    (rawItems ?? []).forEach((it: any) => {
      const arr = byStage.get(it.stage_id) ?? [];
      arr.push(it);
      byStage.set(it.stage_id, arr);
    });

    return (stages ?? [])
      .map((stage: any) => {
        const raw = byStage.get(stage.id) ?? [];
        const byName = new Map<string, any>();
        raw.forEach((it) => {
          const prev = byName.get(it.item_name);
          if (!prev || (it.project_type && !prev.project_type)) byName.set(it.item_name, it);
        });
        const items = Array.from(byName.values()).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
        const lines = items.map((it) => {
          const l = computeBoqLine(it, dims, builtUp, tier, catalogMatches ?? []);
          return { item: it, ...l, lineTotal: l.inCatalog && l.price != null ? l.price * l.qty : 0 };
        }).filter((l) => l.qty > 0);
        const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
        return { stage, lines, subtotal };
      })
      .filter((b) => b.lines.length > 0);
  }, [rawItems, stages, dims, builtUp, tier, catalogMatches]);

  const allLines = stageBlocks.flatMap((b) => b.lines);
  const grandTotal = allLines.reduce((s, l) => s + l.lineTotal, 0);
  const orderableCount = allLines.filter((l) => l.inCatalog).length;
  const gapCount = allLines.filter((l) => !l.inCatalog).length;
  const hasRooms = rooms.length > 0;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-1.5">
          Generate BOQ
          <BoqGuideHint />
        </h2>
        <p className="text-sm text-muted-foreground">
          Enter the project's basics and rooms — the full bill of quantities is priced live across every stage.
        </p>
      </div>

      {/* Project basics */}
      <Card className="p-5 space-y-4">
        <div className="font-medium">Project basics</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">Quality tier <InfoHint title="Quality tier">Sets the expected finish level and tunes the wastage buffer on every line — economy trims it, premium adds to it.</InfoHint></Label>
            <Select value={tier} onValueChange={setTier}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TIERS.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Bedrooms</Label>
            <Input type="number" min={0} value={bedrooms} onChange={(e) => setBedrooms(Math.max(0, +e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Bathrooms</Label>
            <Input type="number" min={0} value={bathrooms} onChange={(e) => setBathrooms(Math.max(0, +e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Kitchens</Label>
            <Input type="number" min={0} value={kitchens} onChange={(e) => setKitchens(Math.max(0, +e.target.value))} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={saveBasics} disabled={savingBasics} className="gap-1">
            <Save className="w-4 h-4" /> {savingBasics ? "Saving…" : "Save basics"}
          </Button>
          <Button size="sm" variant="ghost" onClick={applySuggestedRooms} className="gap-1" title="Auto-build the room list from these counts">
            <Sparkles className="w-4 h-4 text-primary" /> Suggest rooms
          </Button>
          <span className="text-xs text-muted-foreground">
            {tier} finish · buffer {tierWastageDelta(tier) >= 0 ? "+" : ""}{tierWastageDelta(tier)}%
          </span>
        </div>
      </Card>

      {/* Rooms editor */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-medium flex items-center gap-1.5">
            Rooms
            <InfoHint title="Why rooms?">{NOTE.whyRooms}</InfoHint>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setRooms((r) => [...r, blankRoom()])} className="gap-1">
              <Plus className="w-4 h-4" /> Add room
            </Button>
            <Button size="sm" onClick={saveRooms} disabled={savingRooms} className="gap-1">
              <Save className="w-4 h-4" /> {savingRooms ? "Saving…" : "Save rooms"}
            </Button>
          </div>
        </div>

        {!hasRooms && (
          <p className="text-sm text-muted-foreground py-2">
            No rooms yet. Add them, or set the counts above and hit <b>Suggest rooms</b>.
          </p>
        )}

        {hasRooms && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b">
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Label</th>
                  <th className="py-2 pr-3 font-medium">L (ft)</th>
                  <th className="py-2 pr-3 font-medium">W (ft)</th>
                  <th className="py-2 pr-3 font-medium">H (ft)</th>
                  <th className="py-2 pr-3 font-medium">Count</th>
                  <th className="py-2 pr-3 font-medium">Elec. pts</th>
                  <th className="py-2 w-8" />
                </tr>
              </thead>
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
                    <td className="py-1.5 pr-3"><Input className="h-8 w-16" type="number" value={r.length_ft} onChange={(e) => setRoom(i, { length_ft: +e.target.value })} /></td>
                    <td className="py-1.5 pr-3"><Input className="h-8 w-16" type="number" value={r.width_ft} onChange={(e) => setRoom(i, { width_ft: +e.target.value })} /></td>
                    <td className="py-1.5 pr-3"><Input className="h-8 w-16" type="number" value={r.height_ft} onChange={(e) => setRoom(i, { height_ft: +e.target.value })} /></td>
                    <td className="py-1.5 pr-3"><Input className="h-8 w-16" type="number" min={1} value={r.count} onChange={(e) => setRoom(i, { count: Math.max(1, +e.target.value) })} /></td>
                    <td className="py-1.5 pr-3"><Input className="h-8 w-16" type="number" min={0} value={r.electrical_points} onChange={(e) => setRoom(i, { electrical_points: Math.max(0, +e.target.value) })} /></td>
                    <td className="py-1.5">
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setRooms((rs) => rs.filter((_, idx) => idx !== i))}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Generated BOQ */}
      {!hasRooms ? null : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Quote value (in-catalog)</div>
              <div className="text-2xl font-bold">{formatINR(grandTotal)}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> Orderable now</div>
              <div className="text-2xl font-bold">{orderableCount}<span className="text-sm font-normal text-muted-foreground"> items</span></div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><PackageSearch className="w-3.5 h-3.5 text-amber-600" /> Catalog gaps to source</div>
              <div className="text-2xl font-bold">{gapCount}<span className="text-sm font-normal text-muted-foreground"> items</span></div>
            </Card>
          </div>

          {stageBlocks.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No BOQ items generated. Check that this stage has template items, or that rooms have real dimensions.
            </Card>
          )}

          {stageBlocks.map(({ stage, lines, subtotal }) => (
            <Card key={stage.id} className="overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-muted/40 border-b">
                <div className="font-medium text-sm">{stage.sequence}. {stage.name}</div>
                <div className="text-sm font-semibold">{formatINR(subtotal)}</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-2 px-4 font-medium">Material</th>
                      <th className="py-2 px-3 font-medium text-right">Qty</th>
                      <th className="py-2 px-3 font-medium">Status</th>
                      <th className="py-2 px-3 font-medium text-right">Unit price</th>
                      <th className="py-2 px-4 font-medium text-right">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.item.id} className="border-b last:border-0">
                        <td className="py-2 px-4">
                          <div className="flex items-center gap-1.5">
                            {l.item.item_name}
                            {l.explanation && <InfoHint title={l.item.item_name}><span className="text-xs">{l.explanation}</span></InfoHint>}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">{l.qty} {l.unit}</td>
                        <td className="py-2 px-3">
                          {l.inCatalog ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-700"><CheckCircle2 className="w-3.5 h-3.5" /> In catalog</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-700"><PackageSearch className="w-3.5 h-3.5" /> Gap</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">{l.price != null ? formatINR(l.price) : "—"}</td>
                        <td className="py-2 px-4 text-right whitespace-nowrap font-medium">{l.inCatalog && l.price != null ? formatINR(l.lineTotal) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}

          {stageBlocks.length > 0 && (
            <div className="flex items-center justify-end gap-4 px-4 py-3 border-t">
              <span className="text-sm text-muted-foreground">Grand total (orderable)</span>
              <span className="text-xl font-bold">{formatINR(grandTotal)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
