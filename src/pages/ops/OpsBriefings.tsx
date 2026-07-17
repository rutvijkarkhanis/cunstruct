import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageSquare, Send, Clock, Phone, PackageOpen, Copy } from "lucide-react";
import { toast } from "sonner";
import { formatINR, formatDateShort } from "@/lib/forecastEngine";
import { estimateFollowUp } from "@/lib/followup";
import { buildWhatsAppUrl } from "@/lib/whatsapp";

interface StageInfo { name: string; sequence: number; typical_duration_days: number | null; }

/**
 * WhatsApp Briefings — one place to send each site its forecasted products
 * (materials to order next) together with the follow-up check-in, via the
 * whatsapp-send edge function.
 */
export default function OpsBriefings() {
  const qc = useQueryClient();
  const [sendingId, setSendingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["briefings"],
    queryFn: async () => {
      const { data: projects, error: pErr } = await supabase
        .from("projects")
        .select("id, name, location, customer_name, customer_phone, area_sqft, floors, progress_pct, current_stage_id, velocity_days_per_pct, historical_avg_velocity, updated_at, status")
        .neq("status", "pending_review")
        .order("updated_at", { ascending: false });
      if (pErr) throw pErr;

      const { data: stages, error: sErr } = await supabase
        .from("stage_master").select("id, name, sequence, typical_duration_days");
      if (sErr) throw sErr;
      const stageMap: Record<string, StageInfo> = {};
      (stages ?? []).forEach((s: any) => {
        stageMap[s.id] = { name: s.name, sequence: s.sequence, typical_duration_days: s.typical_duration_days };
      });

      // Latest forecast per project + its pending items.
      const { data: fRows, error: fErr } = await supabase
        .from("forecasts")
        .select("id, project_id, status, generated_at, whatsapp_sent_at")
        .order("generated_at", { ascending: false });
      if (fErr) throw fErr;
      const latestByProject = new Map<string, any>();
      for (const f of fRows ?? []) {
        if (f.project_id && !latestByProject.has(f.project_id)) latestByProject.set(f.project_id, f);
      }
      const latestIds = [...latestByProject.values()].map((f) => f.id);
      const itemsByForecast = new Map<string, any[]>();
      if (latestIds.length) {
        const { data: items, error: iErr } = await supabase
          .from("forecast_items")
          .select("id, forecast_id, product_name, qty_estimated, unit, budget_estimated, order_by_date, status")
          .in("forecast_id", latestIds)
          .eq("status", "pending");
        if (iErr) throw iErr;
        for (const it of items ?? []) {
          const arr = itemsByForecast.get(it.forecast_id) ?? [];
          arr.push(it);
          itemsByForecast.set(it.forecast_id, arr);
        }
      }

      return (projects ?? []).map((p: any) => {
        const forecast = latestByProject.get(p.id) ?? null;
        const items = forecast ? (itemsByForecast.get(forecast.id) ?? []) : [];
        return { project: p, forecast, items, stage: p.current_stage_id ? stageMap[p.current_stage_id] : undefined };
      });
    },
  });

  const briefings = useMemo(() => {
    const rows = (data ?? []).map((row) => {
      const { project: p, items } = row;
      const nextOrderByDate = items
        .map((it: any) => it.order_by_date)
        .filter(Boolean)
        .sort()[0] ?? null;
      const followUp = estimateFollowUp({
        stageDurationDays: row.stage?.typical_duration_days,
        areaSqft: p.area_sqft,
        floors: p.floors,
        progressPct: p.progress_pct,
        velocityPctPerDay: p.velocity_days_per_pct ? 1 / Number(p.velocity_days_per_pct) : null,
        lastUpdate: p.updated_at,
        nextOrderByDate,
        historicalVelocityPctPerDay: p.historical_avg_velocity ? Number(p.historical_avg_velocity) : null,
      });
      return { ...row, followUp };
    });
    // Most urgent first: overdue → urgent → soon → routine, then soonest-due within a tier.
    const rank = { overdue: 0, urgent: 1, soon: 2, routine: 3 } as const;
    rows.sort((a, b) =>
      rank[a.followUp.priority] - rank[b.followUp.priority] ||
      a.followUp.daysUntil - b.followUp.daysUntil
    );
    return rows;
  }, [data]);

  const counts = useMemo(() => ({
    due: briefings.filter(b => b.followUp.priority === "overdue" || b.followUp.priority === "urgent").length,
    week: briefings.filter(b => b.followUp.priority === "soon").length,
    all: briefings.length,
  }), [briefings]);

  const [filter, setFilter] = useState<"due" | "week" | "all">("all");
  const visible = useMemo(() => briefings.filter(b => {
    if (filter === "all") return true;
    if (filter === "due") return b.followUp.priority === "overdue" || b.followUp.priority === "urgent";
    return b.followUp.priority !== "routine"; // "week": everything except routine
  }), [briefings, filter]);

  const composeMessage = (row: (typeof briefings)[number]): string => {
    const { project: p, items, stage, followUp } = row;
    const stageName = stage?.name ?? "your current stage";
    const progress = Number(p.progress_pct ?? 0).toFixed(0);
    const checkIn = followUp.overdue
      ? "We'll check in with you shortly."
      : `We'll check in again around ${formatDateShort(followUp.nextFollowUpDate.toISOString())}.`;

    if (items.length === 0) {
      return (
        `🏗️ ${p.name} — quick check-in\n\n` +
        `You're in *${stageName}* (${progress}% done). How's progress since we last spoke?\n\n` +
        `Reply with an update and we'll line up your next materials.\n${checkIn}`
      );
    }

    const lines = items.map((i: any) =>
      `• ${i.qty_estimated} ${i.unit ?? ""} ${i.product_name}`.replace(/\s+/g, " ").trim()
    );
    const total = items.reduce((s: number, i: any) => s + Number(i.budget_estimated ?? 0), 0);
    return (
      `🏗️ ${p.name} — procurement update\n\n` +
      `Current stage: *${stageName}* (${progress}%)\n\n` +
      `Based on your site progress, you may need:\n${lines.join("\n")}\n\n` +
      `Estimated total: ₹${Math.round(total).toLocaleString("en-IN")}\n\n` +
      `${checkIn}\n\n` +
      `Reply:\n1 - Confirm\n2 - Modify\n3 - Call Me`
    );
  };

  const send = async (row: (typeof briefings)[number]) => {
    const { project: p, forecast } = row;
    const url = buildWhatsAppUrl(p.customer_phone, composeMessage(row));
    if (!url) {
      toast.error("No valid customer phone on file — add it on the project page");
      return;
    }
    // Open WhatsApp (Web on desktop) with the message pre-filled; the operator sends it.
    window.open(url, "_blank", "noopener,noreferrer");

    // Record that a briefing was prepared/sent for this forecast (best-effort).
    if (forecast) {
      setSendingId(p.id);
      try {
        await supabase.from("forecasts").update({
          whatsapp_sent_at: new Date().toISOString(),
          status: "sent",
        }).eq("id", forecast.id);
        qc.invalidateQueries({ queryKey: ["briefings"] });
      } catch {
        /* non-fatal — the message still opened in WhatsApp */
      } finally {
        setSendingId(null);
      }
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-primary" /> WhatsApp Briefings
        </h1>
        <p className="text-sm text-muted-foreground">
          Send each site its forecasted materials and the next follow-up in one message.
        </p>
      </div>

      {!isLoading && briefings.length > 0 && (
        <div className="flex items-center gap-3">
          {counts.due > 0 && (
            <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
              {counts.due} check-in{counts.due === 1 ? "" : "s"} due now
            </span>
          )}
          <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <TabsList>
              <TabsTrigger value="due">Due now ({counts.due})</TabsTrigger>
              <TabsTrigger value="week">Upcoming ({counts.due + counts.week})</TabsTrigger>
              <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      {isLoading && <Card className="p-8 text-center text-muted-foreground">Loading…</Card>}
      {!isLoading && briefings.length === 0 && (
        <Card className="p-12 text-center text-muted-foreground">
          No active projects yet. Onboard and activate a project to send briefings.
        </Card>
      )}
      {!isLoading && briefings.length > 0 && visible.length === 0 && (
        <Card className="p-10 text-center text-muted-foreground text-sm">
          Nothing in this view. {filter !== "all" && "No check-ins are due — switch to \"All\" to see every project."}
        </Card>
      )}

      <div className="space-y-4">
        {visible.map((row) => {
          const { project: p, items, stage, forecast, followUp } = row;
          const total = items.reduce((s: number, i: any) => s + Number(i.budget_estimated ?? 0), 0);
          const hasPhone = !!p.customer_phone;
          const toneCls = {
            overdue: "text-red-600 dark:text-red-400",
            urgent: "text-amber-600 dark:text-amber-400",
            soon: "text-blue-600 dark:text-blue-400",
            routine: "text-muted-foreground",
          }[followUp.priority];
          return (
            <Card key={p.id} className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link to={`/ops/projects/${p.id}`} className="font-semibold hover:underline">{p.name}</Link>
                  <div className="text-xs text-muted-foreground truncate">
                    {stage?.name ?? "—"} · {Number(p.progress_pct ?? 0).toFixed(0)}% · {p.location || "—"}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs">
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Phone className="w-3 h-3" />
                      {p.customer_phone || "no phone"}
                    </span>
                    <span className={`inline-flex items-center gap-1 ${toneCls}`}>
                      <Clock className="w-3 h-3" />
                      {followUp.overdue ? "check-in due" : `check-in in ${followUp.daysUntil}d`}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <Badge variant="outline" className="capitalize">{followUp.priority}</Badge>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm" variant="ghost" className="gap-1"
                      onClick={() => {
                        navigator.clipboard.writeText(composeMessage(row))
                          .then(() => toast.success("Message copied"))
                          .catch(() => toast.error("Couldn't copy"));
                      }}
                    >
                      <Copy className="w-3 h-3" /> Copy
                    </Button>
                    <Button size="sm" className="gap-1" disabled={!hasPhone || sendingId === p.id} onClick={() => send(row)}>
                      <Send className="w-3 h-3" />
                      {forecast?.whatsapp_sent_at ? "Open again" : "Open in WhatsApp"}
                    </Button>
                  </div>
                </div>
              </div>

              {items.length > 0 ? (
                <div className="rounded-md border divide-y">
                  {items.slice(0, 6).map((i: any) => (
                    <div key={i.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                      <span className="truncate">
                        <span className="text-muted-foreground">{i.qty_estimated} {i.unit ?? ""}</span> {i.product_name}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0 ml-2">
                        {i.order_by_date ? `order by ${formatDateShort(i.order_by_date)}` : ""}
                      </span>
                    </div>
                  ))}
                  {items.length > 6 && (
                    <div className="px-3 py-1.5 text-xs text-muted-foreground">+{items.length - 6} more</div>
                  )}
                  <div className="px-3 py-1.5 text-xs text-muted-foreground flex justify-between">
                    <span>{items.length} items</span>
                    <span>estimated {formatINR(total)}</span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <PackageOpen className="w-4 h-4" />
                  No forecasted materials yet — a follow-up check-in will be sent instead.
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
