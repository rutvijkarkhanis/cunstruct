import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Sparkles, Send } from "lucide-react";
import { formatINR, formatDateShort } from "@/lib/forecastEngine";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";

export default function OpsForecasts() {
  const qc = useQueryClient();
  const [sendingId, setSendingId] = useState<string | null>(null);

  const { data: forecasts, isLoading } = useQuery({
    queryKey: ["all-forecasts"],
    queryFn: async () => {
      const { data: baseForecasts, error } = await supabase
        .from("forecasts")
        .select("id, project_id, horizon_days, status, generated_at, whatsapp_sent_at")
        .order("generated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      if (!baseForecasts || baseForecasts.length === 0) return [];

      const projectIds = [...new Set(baseForecasts.map((f) => f.project_id).filter(Boolean))];
      const forecastIds = baseForecasts.map((f) => f.id);

      const [projectsRes, itemsRes] = await Promise.all([
        projectIds.length
          ? supabase
              .from("projects")
              .select("id, name, location, owner_id, customer_phone")
              .in("id", projectIds)
          : Promise.resolve({ data: [], error: null } as any),
        supabase
          .from("forecast_items")
          .select("id, forecast_id, product_name, qty_estimated, unit, budget_estimated, order_by_date, risk_flag, confidence, notes, status")
          .in("forecast_id", forecastIds),
      ]);
      if (projectsRes.error) throw projectsRes.error;
      if (itemsRes.error) throw itemsRes.error;

      const projectsById = new Map((projectsRes.data ?? []).map((p: any) => [p.id, p]));
      const itemsByForecast = new Map<string, any[]>();
      for (const it of itemsRes.data ?? []) {
        const arr = itemsByForecast.get(it.forecast_id) ?? [];
        arr.push(it);
        itemsByForecast.set(it.forecast_id, arr);
      }

      return baseForecasts.map((f) => ({
        ...f,
        projects: projectsById.get(f.project_id) ?? null,
        forecast_items: itemsByForecast.get(f.id) ?? [],
      }));
    },
  });

  const sendToCustomer = async (f: any) => {
    const phone = f.projects?.customer_phone;
    const items = f.forecast_items ?? [];
    if (!items.length) return;
    if (!phone) {
      toast.error("No customer phone on file for this project");
      return;
    }
    setSendingId(f.id);
    try {
      const lines = items.map((i: any) =>
        `• ${i.qty_estimated} ${i.unit ?? ""} ${i.product_name}`.replace(/\s+/g, " ").trim()
      );
      const total = items.reduce(
        (s: number, i: any) => s + Number(i.budget_estimated ?? 0), 0,
      );
      const message =
        `🏗️ Based on your site progress, you may need:\n\n` +
        `${lines.join("\n")}\n\n` +
        `Estimated Total: ₹${Math.round(total).toLocaleString("en-IN")}\n\n` +
        `Reply:\n1 - Confirm\n2 - Modify\n3 - Call Me`;
      const to = String(phone).replace(/[^0-9]/g, "");
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session) {
        toast.error("Please sign in again.");
        return;
      }
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: { to, message },
      });
      if (error || !data?.success) {
        console.error("whatsapp-send error:", { error, data });
        throw new Error(error?.message || data?.error || "WhatsApp send failed");
      }
      await supabase.from("forecasts").update({
        whatsapp_sent_at: new Date().toISOString(),
        status: "sent",
      }).eq("id", f.id);
      toast.success("Forecast sent successfully.");
      qc.invalidateQueries({ queryKey: ["all-forecasts"] });
    } catch (err: any) {
      toast.error(err?.message || "Failed to send forecast");
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" /> Forecasts
        </h1>
        <p className="text-sm text-muted-foreground">
          Auto-generated from stage material mappings on every project change
        </p>
      </div>

      {isLoading && <Card className="p-8 text-center text-muted-foreground">Loading…</Card>}
      {!isLoading && (!forecasts || forecasts.length === 0) && (
        <Card className="p-12 text-center text-muted-foreground">
          No forecasts yet. They generate automatically when projects or stages change.
        </Card>
      )}

      <div className="space-y-4">
        {forecasts?.map((f: any) => {
          const items = f.forecast_items ?? [];
          const risks = items.filter((i: any) => i.risk_flag);
          const total = items.reduce(
            (s: number, i: any) => s + Number(i.budget_estimated ?? 0),
            0,
          );
          const canSend = items.length > 0;
          return (
            <Card key={f.id} className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <Link
                    to={`/ops/projects/${f.project_id}`}
                    className="font-semibold hover:underline"
                  >
                    {f.projects?.name ?? "Project"}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {f.projects?.location} · {f.horizon_days}-day horizon ·{" "}
                    {formatDistanceToNow(new Date(f.generated_at))} ago
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize">{f.status}</Badge>
                  {risks.length > 0 && (
                    <Badge variant="destructive" className="gap-1">
                      <AlertTriangle className="w-3 h-3" /> {risks.length} at risk
                    </Badge>
                  )}
                  {canSend && (
                    <Button
                      size="sm"
                      onClick={() => sendToCustomer(f)}
                      disabled={sendingId === f.id}
                      className="gap-1"
                    >
                      <Send className="w-3 h-3" />
                      {sendingId === f.id
                        ? "Sending…"
                        : f.whatsapp_sent_at
                          ? "Resend"
                          : "Send to Customer"}
                    </Button>
                  )}
                </div>
              </div>
              <div className="text-xs text-muted-foreground mb-3">
                {items.length} items · estimated {formatINR(total)}
              </div>
              <div className="grid gap-2">
                {items.slice(0, 6).map((i: any) => (
                  <div
                    key={i.id}
                    className={`flex items-center justify-between p-2 rounded text-sm border ${
                      i.risk_flag ? "border-destructive/40 bg-destructive/5" : "border-border"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate flex items-center gap-2">
                        {i.product_name}
                        {i.notes === "critical" && (
                          <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-destructive/15 text-destructive">
                            critical
                          </span>
                        )}
                        <span
                          className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                            i.confidence === "high"
                              ? "bg-primary/15 text-primary"
                              : i.confidence === "medium"
                                ? "bg-muted text-muted-foreground"
                                : "bg-destructive/15 text-destructive"
                          }`}
                        >
                          {i.confidence}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {i.qty_estimated} {i.unit ?? ""} ·{" "}
                        {formatINR(i.budget_estimated)} · order by{" "}
                        {formatDateShort(i.order_by_date)}
                      </div>
                    </div>
                  </div>
                ))}
                {items.length > 6 && (
                  <Link
                    to={`/ops/projects/${f.project_id}`}
                    className="text-xs text-primary hover:underline text-center pt-1"
                  >
                    View all {items.length} items →
                  </Link>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}