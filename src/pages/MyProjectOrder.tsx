import { useParams, useNavigate, Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { supabase as catalogSupabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Minus, Plus, Send, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { formatINR } from "@/lib/forecastEngine";
import { placeOrder, type BoqLine } from "@/lib/boq";
import { computeBoqLine } from "@/lib/boqGenerate";
import { computeDimensions, type Room } from "@/lib/dimensions";
import { logGaps, type GapItem } from "@/lib/catalogGaps";
import { buildBriefingMessage, buildWhatsAppUrl } from "@/lib/whatsapp";
import { InfoHint } from "@/components/InfoHint";
import { BoqGuideHint } from "@/components/boq/BoqExplainer";
import { suggestRooms, canSuggestRooms, tierWastageDelta, type ProjectBasics } from "@/lib/smartSuggest";
import { NOTE } from "@/lib/boqGlossary";

const ROOM_TYPES = ["bedroom", "bathroom", "kitchen", "living", "balcony", "room"];

interface RoomRow extends Room {
  name: string; room_type: string; length_ft: number; width_ft: number;
  height_ft: number; count: number; electrical_points: number;
}
const blankRoom = (): RoomRow => ({
  name: "", room_type: "bedroom", length_ft: 10, width_ft: 10, height_ft: 10, count: 1, electrical_points: 4,
});

export default function MyProjectOrder() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate("/auth?returnUrl=" + encodeURIComponent(window.location.pathname));
  }, [user, loading, navigate]);

  const { data: project } = useQuery({
    queryKey: ["my-project", id],
    enabled: !!id && !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, stage_master:current_stage_id(name, sequence)")
        .eq("id", id!).eq("owner_id", user!.id).single();
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

  // ---- Rooms -------------------------------------------------------------
  const { data: roomData } = useQuery({
    queryKey: ["project-rooms", id],
    enabled: !!id && !!user,
    queryFn: async () => {
      const { data } = await supabase.from("project_rooms").select("*").eq("project_id", id!).order("created_at");
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

  const [savingRooms, setSavingRooms] = useState(false);
  const setRoom = (i: number, patch: Partial<RoomRow>) =>
    setRooms((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const saveRooms = async () => {
    setSavingRooms(true);
    try {
      await supabase.from("project_rooms").delete().eq("project_id", id!);
      if (rooms.length) {
        const { error } = await supabase.from("project_rooms").insert(
          rooms.map((r) => ({
            project_id: id!, name: r.name || null, room_type: r.room_type,
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
    const p: any = project ?? {};
    const basics: ProjectBasics = {
      quality_tier: p.quality_tier, bedrooms: p.bedrooms, bathrooms: p.bathrooms, kitchens: p.kitchens,
    };
    if (!canSuggestRooms(basics)) {
      toast.error("Add bedroom / bathroom counts in Project basics first");
      return;
    }
    const suggested = suggestRooms(basics);
    setRooms(suggested.map((r) => ({ ...r })));
    const total = suggested.reduce((s, r) => s + r.count, 0);
    toast.success(`Suggested ${total} room${total === 1 ? "" : "s"} — adjust sizes, then Save`);
  };

  const dims = useMemo(() => computeDimensions(rooms), [rooms]);
  const builtUp = project?.area_sqft != null ? Number(project.area_sqft) : dims.floorAreaSqft || null;
  const tier = (project as any)?.quality_tier ?? "standard";

  // ---- Stage + BOQ template ----------------------------------------------
  const [stageId, setStageId] = useState("");
  useEffect(() => {
    if (project?.current_stage_id && !stageId) setStageId(project.current_stage_id);
  }, [project?.current_stage_id, stageId]);

  const projectType = (project as any)?.project_type ?? null;
  const { data: rawItems, isLoading: itemsLoading } = useQuery({
    queryKey: ["boq-template", stageId, projectType],
    enabled: !!stageId,
    queryFn: async () => {
      let q = supabase
        .from("boq_template")
        .select("id, item_name, match_keyword, unit, qty_formula, product_id, sort, project_type")
        .eq("stage_id", stageId)
        .order("sort");
      // Generic items (no type) apply to everyone; type-specific items apply
      // only to this project's type.
      q = projectType ? q.or(`project_type.is.null,project_type.eq.${projectType}`) : q.is("project_type", null);
      const { data } = await q;
      return data ?? [];
    },
  });

  // A type-specific item overrides a generic one with the same name.
  const items = useMemo(() => {
    const byName = new Map<string, any>();
    (rawItems ?? []).forEach((it: any) => {
      const prev = byName.get(it.item_name);
      if (!prev || (it.project_type && !prev.project_type)) byName.set(it.item_name, it);
    });
    return Array.from(byName.values()).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  }, [rawItems]);

  // Resolve each template item to a catalog product (explicit id or keyword).
  const { data: catalogMatches } = useQuery({
    queryKey: ["boq-catalog-match", (items ?? []).map((i: any) => i.id)],
    enabled: (items ?? []).length > 0,
    queryFn: async () => {
      const ids = (items ?? []).map((i: any) => i.product_id).filter(Boolean);
      const kws = (items ?? []).map((i: any) => i.match_keyword).filter(Boolean);
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
          .limit(1000);
        if (error) throw error;
        return data ?? [];
      } catch {
        return [];
      }
    },
  });

  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const lineFor = (item: any) => {
    const l = computeBoqLine(item, dims, builtUp, tier, catalogMatches ?? []);
    // Mobile lets the contractor nudge quantities by hand; apply that override.
    return { ...l, qty: overrides[item.id] ?? l.qty };
  };

  const setQ = (pid: string, v: number) => setOverrides((o) => ({ ...o, [pid]: Math.max(0, v) }));

  const orderTotal = (items ?? []).reduce((s: number, it: any) => {
    const l = lineFor(it);
    return s + (l.inCatalog && l.price != null ? l.price * l.qty : 0);
  }, 0);
  const orderCount = (items ?? []).filter((it: any) => { const l = lineFor(it); return l.inCatalog && l.qty > 0; }).length;
  const gapCount = (items ?? []).filter((it: any) => { const l = lineFor(it); return !l.inCatalog && l.qty > 0; }).length;
  const selectedStageName = (stages ?? []).find((s: any) => s.id === stageId)?.name as string | undefined;

  const doPlace = async () => {
    if (!items) return;
    setBusy(true);
    try {
      const resolved = items.map((it: any) => ({ it, l: lineFor(it) })).filter(({ l }) => l.qty > 0);
      const inLines: BoqLine[] = resolved.filter(({ l }) => l.inCatalog).map(({ it, l }) => ({
        product_id: l.catalogProductId!, product_name: it.item_name, unit: l.unit, qty: l.qty, unit_price: l.price, stage_id: stageId,
      }));
      const gapLines: GapItem[] = resolved.filter(({ l }) => !l.inCatalog).map(({ it, l }) => ({
        item_name: it.item_name, requested_qty: l.qty, unit: l.unit,
      }));

      if (!inLines.length && !gapLines.length) { toast.error("Add at least one item first."); return; }

      let placedTotal = 0;
      if (inLines.length) {
        const res = await placeOrder({ projectId: id!, customerPhone: (project as any)?.customer_phone ?? null, lines: inLines });
        placedTotal = res.total;
      }
      let gapsLogged = 0;
      if (gapLines.length) gapsLogged = await logGaps(id!, stageId, gapLines);

      const parts = [];
      if (inLines.length) parts.push(`ordered ${inLines.length} item${inLines.length === 1 ? "" : "s"} · ${formatINR(placedTotal)}`);
      if (gapsLogged) parts.push(`${gapsLogged} sent for onboarding`);
      toast.success(parts.join(" · ") || "Done");

      if (inLines.length) {
        const briefItems = inLines.map((l) => ({
          product_name: l.product_name, qty_estimated: l.qty, unit: l.unit,
          budget_estimated: (Number(l.unit_price) || 0) * l.qty, order_by_date: null,
        }));
        const msg = buildBriefingMessage(briefItems, {
          projectName: project?.name ?? "your project",
          customerName: (project as any)?.customer_name ?? null,
          stageName: selectedStageName ?? null,
        });
        const url = buildWhatsAppUrl((project as any)?.customer_phone, msg) ?? `https://wa.me/?text=${encodeURIComponent(msg)}`;
        window.open(url, "_blank");
      }
      navigate(`/my-projects/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to place order");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-28">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-5 py-4">
          <Link to={`/my-projects/${id}`} className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" /> {project?.name ?? "Project"}
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-6 space-y-6">
        <div className="space-y-3">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-1.5">
              Bill of quantities
              <BoqGuideHint />
            </h1>
            <p className="text-sm text-muted-foreground">
              Enter your rooms once — every material's quantity is calculated from the right dimension. In-catalog items can be ordered now; the rest we'll onboard.
            </p>
          </div>
        </div>

        {/* Rooms editor */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold flex items-center gap-1.5">
              Rooms
              <InfoHint title="Why rooms?">{NOTE.whyRooms}</InfoHint>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={applySuggestedRooms} className="gap-1" title="Auto-build rooms from your Project basics">
                <Sparkles className="w-4 h-4 text-primary" /> Suggest
              </Button>
              <Button variant="outline" size="sm" onClick={() => setRooms((r) => [...r, blankRoom()])} className="gap-1">
                <Plus className="w-4 h-4" /> Add room
              </Button>
            </div>
          </div>
          {rooms.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">
              Add your rooms to calculate accurate quantities — or hit <span className="text-foreground font-medium">Suggest</span> to
              auto-build them from your Project basics.
            </p>
          )}
          {rooms.map((r, i) => (
            <div key={i} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Input placeholder="Room name (optional)" value={r.name} onChange={(e) => setRoom(i, { name: e.target.value })} className="h-8" />
                <Select value={r.room_type} onValueChange={(v) => setRoom(i, { room_type: v })}>
                  <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROOM_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setRooms((rs) => rs.filter((_, idx) => idx !== i))}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              <div className="grid grid-cols-5 gap-2">
                <LabeledNum label="L (ft)" value={r.length_ft} onChange={(v) => setRoom(i, { length_ft: v })} />
                <LabeledNum label="W (ft)" value={r.width_ft} onChange={(v) => setRoom(i, { width_ft: v })} />
                <LabeledNum label="H (ft)" value={r.height_ft} onChange={(v) => setRoom(i, { height_ft: v })} />
                <LabeledNum label="Qty" value={r.count} onChange={(v) => setRoom(i, { count: v })} />
                <LabeledNum label="Points" value={r.electrical_points} onChange={(v) => setRoom(i, { electrical_points: v })} />
              </div>
            </div>
          ))}
          {rooms.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
                <span className="inline-flex items-center gap-1 font-medium text-foreground">
                  Totals
                  <InfoHint title="Calculated dimensions" side="top">
                    These are the drivers behind every quantity. <b>Floor</b> = length × width of all
                    rooms. <b>Wall</b> = perimeter × height − 15% for doors/windows. <b>Points</b> = the
                    electrical points you entered. Change a room and every material re-calculates.
                  </InfoHint>
                </span>
                <span>Floor: <b className="text-foreground">{dims.floorAreaSqft.toLocaleString("en-IN")}</b> sq.ft</span>
                <span>Wall: <b className="text-foreground">{dims.wallAreaSqft.toLocaleString("en-IN")}</b> sq.ft</span>
                <span>Rooms: <b className="text-foreground">{dims.rooms}</b></span>
                <span>Baths: <b className="text-foreground">{dims.bathrooms}</b></span>
                <span>Points: <b className="text-foreground">{dims.points}</b></span>
              </div>
              <Button variant="secondary" size="sm" onClick={saveRooms} disabled={savingRooms}>
                {savingRooms ? "Saving…" : "Save rooms"}
              </Button>
            </>
          )}
        </Card>

        {/* Stage + materials */}
        <div>
          <label className="text-xs uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1">
            Stage
            <InfoHint title="Construction stage">
              {NOTE.whatIsStage} Pick the stage you're buying for and its checklist appears below, each
              line pre-filled with a quantity from your rooms.
            </InfoHint>
          </label>
          <Select value={stageId} onValueChange={(v) => { setStageId(v); setOverrides({}); }}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Pick a stage" /></SelectTrigger>
            <SelectContent>
              {stages?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.sequence}. {s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {itemsLoading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading checklist…</p>
        ) : (items ?? []).length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No standard checklist for this stage yet. Ops can add items under BOQ templates.
          </Card>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
              <span className="inline-flex items-center gap-1">
                How to read each line
                <InfoHint title="Reading a line" side="bottom">
                  <div><b>The small grey text</b> shows the maths, e.g. <code>340 wall sq.ft × 0.025 = 9 (+10% wastage) → 10</code>.</div>
                  <div className="pt-1">{NOTE.wastage}</div>
                  <div className="pt-1">{NOTE.packRounding}</div>
                  <div className="pt-1"><b>“onboard” badge:</b> {NOTE.onboard}</div>
                  <div className="pt-1">Use − / + to override any quantity.</div>
                </InfoHint>
              </span>
              <span className="capitalize">
                {tier} finish · buffer {tierWastageDelta(tier) >= 0 ? "+" : ""}{tierWastageDelta(tier)}%
              </span>
            </div>
            {items!.map((it: any) => {
              const l = lineFor(it);
              return (
                <Card key={it.id} className={`p-3 ${l.qty === 0 ? "opacity-60" : ""}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate flex items-center gap-2">
                        {it.item_name}
                        {!l.inCatalog && (
                          <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
                            onboard
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {l.inCatalog
                          ? (l.price != null
                            ? <>{formatINR(l.price)}/{l.unit || "unit"}{l.qty > 0 && <> · <span className="text-foreground font-medium">{formatINR(l.price * l.qty)}</span></>}</>
                            : "in catalog · price unavailable")
                          : "not in catalog yet — we'll onboard it"}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{l.explanation}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQ(it.id, l.qty - 1)} disabled={l.qty <= 0}>
                        <Minus className="w-4 h-4" />
                      </Button>
                      <div className="w-12 text-center text-sm tabular-nums">
                        {l.qty}<div className="text-[10px] text-muted-foreground leading-none">{l.unit}</div>
                      </div>
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQ(it.id, l.qty + 1)}>
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      {(items ?? []).length > 0 && (
        <div className="fixed bottom-0 inset-x-0 border-t bg-card/95 backdrop-blur">
          <div className="max-w-2xl mx-auto px-5 py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
                {orderCount} to order{gapCount > 0 ? ` · ${gapCount} to onboard` : ""}
                <InfoHint title="What happens on submit?" side="top">{NOTE.orderVsOnboard}</InfoHint>
              </div>
              <div className="text-lg font-bold">{formatINR(orderTotal)}</div>
            </div>
            <Button onClick={doPlace} disabled={busy || (orderCount === 0 && gapCount === 0)} className="gap-1">
              <Send className="w-4 h-4" />
              {busy ? "Submitting…" : orderCount > 0 ? "Place order" : "Send BOQ"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function LabeledNum({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground">{label}</label>
      <Input type="number" min="0" step="any" value={value} onChange={(e) => onChange(+e.target.value)} className="h-8 px-2" />
    </div>
  );
}
