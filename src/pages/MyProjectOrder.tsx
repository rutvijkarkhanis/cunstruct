import { useParams, useNavigate, Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { supabase as catalogSupabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Minus, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { formatINR } from "@/lib/forecastEngine";
import { suggestQty, placeOrder, type BoqLine } from "@/lib/boq";
import { buildBriefingMessage, buildWhatsAppUrl } from "@/lib/whatsapp";

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
        .eq("id", id!)
        .eq("owner_id", user!.id)
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

  // Live prices from the catalog project, keyed by product_id.
  const productIds = useMemo(
    () => (mappings ?? []).map((m: any) => m.product_id).filter(Boolean),
    [mappings],
  );
  const { data: priceMap } = useQuery({
    queryKey: ["boq-prices", productIds],
    enabled: productIds.length > 0,
    queryFn: async () => {
      try {
        const { data, error } = await catalogSupabase
          .from("products_master")
          .select("id, selling_price, unit")
          .in("id", productIds);
        if (error) throw error;
        const m: Record<string, { price: number | null; unit: string | null }> = {};
        (data ?? []).forEach((r: any) => {
          m[r.id] = { price: r.selling_price != null ? Number(r.selling_price) : null, unit: r.unit ?? null };
        });
        return m;
      } catch {
        return {} as Record<string, { price: number | null; unit: string | null }>;
      }
    },
  });

  // Only user overrides are stored; the rest derive from suggestQty(area).
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const area = project?.area_sqft != null ? Number(project.area_sqft) : null;
  const effQty = (m: any): number => overrides[m.product_id] ?? suggestQty(m, area);
  const linePrice = (m: any): number | null =>
    priceMap?.[m.product_id]?.price ?? (m.qty_formula?.unit_price != null ? Number(m.qty_formula.unit_price) : null);
  const setQ = (pid: string, v: number) => setOverrides((o) => ({ ...o, [pid]: Math.max(0, v) }));

  const grandTotal = (mappings ?? []).reduce((s: number, m: any) => {
    const p = linePrice(m);
    return s + (p != null ? p * effQty(m) : 0);
  }, 0);
  const itemCount = (mappings ?? []).filter((m: any) => effQty(m) > 0).length;

  const selectedStageName = (stages ?? []).find((s: any) => s.id === stageId)?.name as string | undefined;

  const doPlace = async () => {
    if (!mappings) return;
    setBusy(true);
    try {
      const lines: BoqLine[] = mappings
        .map((m: any) => ({
          product_id: m.product_id,
          product_name: m.product_name,
          unit: m.unit ?? priceMap?.[m.product_id]?.unit ?? null,
          qty: effQty(m),
          unit_price: linePrice(m),
          stage_id: stageId,
        }))
        .filter((l) => l.qty > 0);

      if (!lines.length) { toast.error("Add at least one item first."); return; }

      const res = await placeOrder({
        projectId: id!,
        customerPhone: (project as any)?.customer_phone ?? null,
        lines,
      });
      toast.success(`Order placed — ${res.lineCount} items · ${formatINR(res.total)}`);

      // Fire the WhatsApp briefing as the notification (not the system of record).
      const briefItems = lines.map((l) => ({
        product_name: l.product_name,
        qty_estimated: l.qty,
        unit: l.unit,
        budget_estimated: (Number(l.unit_price) || 0) * l.qty,
        order_by_date: null,
      }));
      const msg = buildBriefingMessage(briefItems, {
        projectName: project?.name ?? "your project",
        customerName: (project as any)?.customer_name ?? null,
        stageName: selectedStageName ?? null,
      });
      const phone = (project as any)?.customer_phone;
      const url = buildWhatsAppUrl(phone, msg) ?? `https://wa.me/?text=${encodeURIComponent(msg)}`;
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

      <main className="max-w-2xl mx-auto px-5 py-6 space-y-5">
        <div>
          <h1 className="text-xl font-bold">Order materials</h1>
          <p className="text-sm text-muted-foreground">
            Quantities are pre-filled from your area{area ? ` (${area.toLocaleString("en-IN")} sq.ft)` : ""}. Adjust and place the order.
          </p>
        </div>

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
            No materials mapped to this stage yet. Ops can add them under Stage → Material Mapping.
          </Card>
        ) : (
          <div className="space-y-2">
            {mappings!.map((m: any) => {
              const q = effQty(m);
              const price = linePrice(m);
              const unit = m.unit ?? priceMap?.[m.product_id]?.unit ?? "";
              return (
                <Card key={m.product_id} className={`p-3 ${q === 0 ? "opacity-60" : ""}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{m.product_name ?? m.product_id}</div>
                      <div className="text-xs text-muted-foreground">
                        {price != null ? `${formatINR(price)}/${unit || "unit"}` : "price unavailable"}
                        {price != null && q > 0 && <> · <span className="text-foreground font-medium">{formatINR(price * q)}</span></>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQ(m.product_id, q - 1)} disabled={q <= 0}>
                        <Minus className="w-4 h-4" />
                      </Button>
                      <div className="w-12 text-center text-sm tabular-nums">
                        {q}<div className="text-[10px] text-muted-foreground leading-none">{unit}</div>
                      </div>
                      <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQ(m.product_id, q + 1)}>
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
