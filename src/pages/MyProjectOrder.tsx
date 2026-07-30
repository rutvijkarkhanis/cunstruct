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
import { ArrowLeft, Minus, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatINR } from "@/lib/forecastEngine";
import { placeOrder, suggestQtyDetailed, type BoqLine } from "@/lib/boq";
import { computeDimensions, type Room } from "@/lib/dimensions";
import { resolveCoverage, hasBasis } from "@/lib/coverageDefaults";
import { buildBriefingMessage, buildWhatsAppUrl } from "@/lib/whatsapp";

const ROOM_TYPES = ["bedroom", "bathroom", "kitchen", "living", "balcony", "room"];

interface RoomRow extends Room {
  name: string;
  room_type: string;
  length_ft: number;
  width_ft: number;
  height_ft: number;
  count: number;
  electrical_points: number;
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

  const dims = useMemo(() => computeDimensions(rooms), [rooms]);
  const builtUp = project?.area_sqft != null ? Number(project.area_sqft) : dims.floorAreaSqft || null;

  // ---- Stage + materials --------------------------------------------------
  const [stageId, setStageId] = useState("");
  useEffect(() => {
    if (project?.current_stage_id && !stageId) setStageId(project.current_stage_id);
  }, [project?.current_stage_id, stageId]);

  const { data: mappings, isLoading: mappingsLoading } = useQuery({
    queryKey: ["boq-mappings", stageId],
    enabled: !!stageId,
    queryFn: async () => {
      const { data } = await supabase
        .from("stage_material_mapping")
        .select("product_id, product_name, unit, qty_formula, buffer_pct, priority")
        .eq("stage_id", stageId);
      return data ?? [];
    },
  });

  const productIds = useMemo(() => (mappings ?? []).map((m: any) => m.product_id).filter(Boolean), [mappings]);
  const { data: priceMap } = useQuery({
    queryKey: ["boq-prices", productIds],
    enabled: productIds.length > 0,
    queryFn: async () => {
      try {
        const { data, error } = await catalogSupabase
          .from("products_master")
          .select("id, selling_price, unit, main_category")
          .in("id", productIds);
        if (error) throw error;
        const m: Record<string, { price: number | null; unit: string | null; category: string | null }> = {};
        (data ?? []).forEach((r: any) => {
          m[r.id] = {
            price: r.selling_price != null ? Number(r.selling_price) : null,
            unit: r.unit ?? null,
            category: r.main_category ?? null,
          };
        });
        return m;
      } catch {
        return {} as Record<string, { price: number | null; unit: string | null; category: string | null }>;
      }
    },
  });

  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  // Resolve the effective coverage for a mapping: its own qty_formula, or a
  // seeded default matched by product name/category.
  const lineFor = (m: any) => {
    const cat = priceMap?.[m.product_id]?.category ?? null;
    const own = hasBasis(m.qty_formula);
    const def = own ? null : resolveCoverage(m.product_name, cat);
    const formula = own ? m.qty_formula : (def ?? {});
    const bufferPct = own ? (m.buffer_pct ?? 0) : (def?.wastage_pct ?? m.buffer_pct ?? 0);
    const detail = suggestQtyDetailed({ product_id: m.product_id, qty_formula: formula, buffer_pct: bufferPct }, dims, builtUp);
    const suggested = detail.qty;
    const qty = overrides[m.product_id] ?? suggested;
    const price = priceMap?.[m.product_id]?.price ?? (formula.unit_price != null ? Number(formula.unit_price) : null);
    const unit = m.unit ?? priceMap?.[m.product_id]?.unit ?? def?.unit ?? "";
    return { qty, price, unit, explanation: detail.explanation, isFallback: detail.isFallback && !own };
  };

  const setQ = (pid: string, v: number) => setOverrides((o) => ({ ...o, [pid]: Math.max(0, v) }));

  const grandTotal = (mappings ?? []).reduce((s: number, m: any) => {
    const l = lineFor(m);
    return s + (l.price != null ? l.price * l.qty : 0);
  }, 0);
  const itemCount = (mappings ?? []).filter((m: any) => lineFor(m).qty > 0).length;
  const selectedStageName = (stages ?? []).find((s: any) => s.id === stageId)?.name as string | undefined;

  const doPlace = async () => {
    if (!mappings) return;
    setBusy(true);
    try {
      const lines: BoqLine[] = mappings
        .map((m: any) => {
          const l = lineFor(m);
          return { product_id: m.product_id, product_name: m.product_name, unit: l.unit, qty: l.qty, unit_price: l.price, stage_id: stageId };
        })
        .filter((l) => l.qty > 0);
      if (!lines.length) { toast.error("Add at least one item first."); return; }

      const res = await placeOrder({ projectId: id!, customerPhone: (project as any)?.customer_phone ?? null, lines });
      toast.success(`Order placed — ${res.lineCount} items · ${formatINR(res.total)}`);

      const briefItems = lines.map((l) => ({
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
        <div>
          <h1 className="text-xl font-bold">Order materials</h1>
          <p className="text-sm text-muted-foreground">
            Enter your rooms once — quantities are calculated per material from the right dimension.
          </p>
        </div>

        {/* Rooms editor */}
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Rooms</div>
            <Button variant="outline" size="sm" onClick={() => setRooms((r) => [...r, blankRoom()])} className="gap-1">
              <Plus className="w-4 h-4" /> Add room
            </Button>
          </div>

          {rooms.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">Add your rooms to calculate accurate quantities.</p>
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
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
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
          <label className="text-xs uppercase tracking-wide text-muted-foreground">Stage</label>
          <Select value={stageId} onValueChange={(v) => { setStageId(v); setOverrides({}); }}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Pick a stage" /></SelectTrigger>
            <SelectContent>
              {stages?.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.sequence}. {s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {mappingsLoading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading checklist…</p>
        ) : (mappings ?? []).length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            No materials mapped to this stage yet.
          </Card>
        ) : (
          <div className="space-y-2">
            {mappings!.map((m: any) => {
              const l = lineFor(m);
              return (
                <Card key={m.product_id} className={`p-3 ${l.qty === 0 ? "opacity-60" : ""}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{m.product_name ?? m.product_id}</div>
                      <div className="text-xs text-muted-foreground">
                        {l.price != null ? `${formatINR(l.price)}/${l.unit || "unit"}` : "price unavailable"}
                        {l.price != null && l.qty > 0 && <> · <span className="text-foreground font-medium">{formatINR(l.price * l.qty)}</span></>}
                      </div>
                      <div className={`text-[11px] ${l.isFallback ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                        {l.explanation}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQ(m.product_id, l.qty - 1)} disabled={l.qty <= 0}>
                        <Minus className="w-4 h-4" />
                      </Button>
                      <div className="w-12 text-center text-sm tabular-nums">
                        {l.qty}<div className="text-[10px] text-muted-foreground leading-none">{l.unit}</div>
                      </div>
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQ(m.product_id, l.qty + 1)}>
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

      {(mappings ?? []).length > 0 && (
        <div className="fixed bottom-0 inset-x-0 border-t bg-card/95 backdrop-blur">
          <div className="max-w-2xl mx-auto px-5 py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs text-muted-foreground">{itemCount} item{itemCount === 1 ? "" : "s"}</div>
              <div className="text-lg font-bold">{formatINR(grandTotal)}</div>
            </div>
            <Button onClick={doPlace} disabled={busy || itemCount === 0} className="gap-1">
              <Send className="w-4 h-4" />
              {busy ? "Placing…" : "Place order"}
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
