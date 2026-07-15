import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { ArrowLeft, MessageSquare, Camera, Mic, AlertTriangle, Sparkles, UserCog } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  recalcProjectVelocity, generateForecasts, buildBriefingText,
  formatINR, formatDateShort, autoGenerateForecastForCurrentStage,
} from "@/lib/forecastEngine";

export default function OpsProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data: project } = useQuery({
    queryKey: ["project", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, stage_master:current_stage_id(name, sequence)")
        .eq("id", id!)
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

  const { data: updates } = useQuery({
    queryKey: ["updates", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from("stage_updates")
        .select("*, stage_master:stage_id(name)")
        .eq("project_id", id!)
        .order("recorded_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: forecasts } = useQuery({
    queryKey: ["forecasts", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase
        .from("forecasts")
        .select("*, forecast_items(*, stage_master:stage_id(name))")
        .eq("project_id", id!)
        .order("generated_at", { ascending: false });
      return data ?? [];
    },
  });

  const [stageId, setStageId] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [source, setSource] = useState<string>("app");
  const [note, setNote] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);

  // Edit customer dialog state (hoisted so ForecastsPanel can request opening it)
  const [editOpen, setEditOpen] = useState(false);
  const afterSaveRef = useRef<((phone: string) => void) | null>(null);
  const requestEditPhone = (cb?: (phone: string) => void) => {
    afterSaveRef.current = cb ?? null;
    setEditOpen(true);
  };

  const logUpdate = async () => {
    if (!stageId) return toast.error("Select a stage");
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // Fix #1a: parallelize the two independent DB writes
      const [{ error: updateLogError }, { error: projectUpdateError }] = await Promise.all([
        supabase.from("stage_updates").insert({
          project_id: id, stage_id: stageId, progress_pct: progress,
          source, note, created_by: user?.id,
        }),
        supabase.from("projects").update({
          current_stage_id: stageId, progress_pct: progress,
        }).eq("id", id!),
      ]);
      if (updateLogError) throw updateLogError;
      if (projectUpdateError) throw projectUpdateError;

      // Fix #1b: confirm success before running side effects
      toast.success("Update logged");
      setNote("");

      // Fix #1c: best-effort side effects — never surface their errors to the user
      try { await recalcProjectVelocity(id!); } catch { /* silent */ }
      try {
        const generated = await autoGenerateForecastForCurrentStage(id!);
        qc.setQueryData(["last-forecast-generation", id], generated);
      } catch { /* silent */ }

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["project", id] }),
        qc.invalidateQueries({ queryKey: ["updates", id] }),
        qc.invalidateQueries({ queryKey: ["forecasts", id] }),
        qc.invalidateQueries({ queryKey: ["all-forecasts"] }),
      ]);
    } catch (e) {
      console.error("[logUpdate] failed:", e);
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  };

  const runForecast = async () => {
    setGenBusy(true);
    try {
      const { created } = await generateForecasts(id!);
      toast.success(`Generated ${created} forecast items`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["forecasts", id] }),
        qc.invalidateQueries({ queryKey: ["all-forecasts"] }),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setGenBusy(false); }
  };

  if (!project) return <div className="p-8 text-muted-foreground">Loading…</div>;
  const stageName = (project as any).stage_master?.name;
  const stageSeq = (project as any).stage_master?.sequence ?? 0;
  const hasVelocity = project.velocity_days_per_pct != null && project.projected_completion_date;
  const updateCount = updates?.length ?? 0;

  return (
    <div className="p-8 space-y-6">
      <Link to="/ops/projects" className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1">
        <ArrowLeft className="w-3 h-3" /> All projects
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-sm text-muted-foreground">
            {project.client_name} · {project.location} · {project.project_type} · {project.scope}
          </p>
        </div>
        <Button onClick={runForecast} disabled={genBusy}>
          <Sparkles className="w-4 h-4 mr-1" />
          {genBusy ? "Generating…" : "Generate Forecast"}
        </Button>
      </div>

      <div>
        <Button variant="outline" size="sm" onClick={() => requestEditPhone()}>
          <UserCog className="w-4 h-4 mr-1" /> Edit Customer Details
        </Button>
        <span className="ml-3 text-xs text-muted-foreground">
          {project.customer_name || "—"}
          {project.customer_phone ? ` · ${project.customer_phone}` : " · no phone"}
        </span>
      </div>

      <EditCustomerDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        projectId={id!}
        initialName={project.customer_name ?? ""}
        initialPhone={project.customer_phone ?? ""}
        onSaved={(phone) => {
          qc.invalidateQueries({ queryKey: ["project", id] });
          const cb = afterSaveRef.current;
          afterSaveRef.current = null;
          if (cb) cb(phone);
        }}
      />

      <Card className="p-5">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-xs text-muted-foreground">Current stage</div>
            <div className="font-semibold">{stageName ?? "Not set"}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Progress</div>
            <div className="font-semibold">{Number(project.progress_pct).toFixed(0)}%</div>
          </div>
        </div>
        <Progress value={Number(project.progress_pct)} />

        <div className="mt-4 text-sm">
          {updateCount < 2 ? (
            <span className="text-muted-foreground italic">
              Tracking — add more updates to enable prediction
            </span>
          ) : hasVelocity ? (
            <span>
              At current pace, <strong>{stageName}</strong> completes around{" "}
              <strong>{formatDateShort(project.projected_completion_date)}</strong>
            </span>
          ) : (
            <span className="text-muted-foreground italic">
              No measurable progress between updates yet
            </span>
          )}
        </div>

        <div className="grid grid-cols-8 gap-1 mt-4">
          {stages?.slice(0, 16).map((s) => (
            <div key={s.id} title={s.name}
              className={`h-2 rounded ${
                s.sequence < stageSeq ? "bg-primary"
                  : s.sequence === stageSeq ? "bg-primary/50"
                  : "bg-muted"
              }`} />
          ))}
        </div>
      </Card>

      <Tabs defaultValue="timeline">
        <TabsList>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="forecasts">Forecasts</TabsTrigger>
          <TabsTrigger value="accuracy">Accuracy</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="space-y-4 mt-4">
          <Card className="p-5 space-y-3">
            <h2 className="font-semibold">Log stage update</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Stage</Label>
                <Select value={stageId} onValueChange={setStageId}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {stages?.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.sequence}. {s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Progress %</Label>
                <Input type="number" min={0} max={100} value={progress} onChange={(e) => setProgress(+e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Source</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="app">App</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp text</SelectItem>
                  <SelectItem value="photo">WhatsApp photo</SelectItem>
                  <SelectItem value="voice">WhatsApp voice</SelectItem>
                  <SelectItem value="call">Phone call</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Note</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button onClick={logUpdate} disabled={busy}>{busy ? "…" : "Log update"}</Button>
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold mb-3">Update history</h2>
            {(!updates || updates.length === 0) && (
              <div className="text-sm text-muted-foreground">No updates yet</div>
            )}
            <div className="space-y-3">
              {updates?.map((u) => {
                const Icon = u.source === "photo" ? Camera : u.source === "voice" ? Mic : MessageSquare;
                return (
                  <div key={u.id} className="flex gap-3 text-sm">
                    <Icon className="w-4 h-4 mt-0.5 text-muted-foreground" />
                    <div className="flex-1">
                      <div>
                        <span className="font-medium">{(u as any).stage_master?.name}</span>
                        <span className="text-muted-foreground"> at {Number(u.progress_pct).toFixed(0)}%</span>
                      </div>
                      {u.note && <div className="text-xs text-muted-foreground">{u.note}</div>}
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        {u.source} · {formatDistanceToNow(new Date(u.recorded_at))} ago
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="forecasts" className="mt-4">
          <ForecastsPanel
            forecasts={forecasts ?? []}
            projectId={id!}
            qc={qc}
            project={project}
            requestEditPhone={requestEditPhone}
          />
        </TabsContent>

        <TabsContent value="accuracy" className="mt-4">
          <AccuracyPanel projectId={id!} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ForecastsPanel({ forecasts, projectId, qc, project, requestEditPhone }: { forecasts: any[]; projectId: string; qc: any; project: any; requestEditPhone: (cb?: (phone: string) => void) => void }) {
  const [horizon, setHorizon] = useState<"7" | "14" | "30">("7");
  const filtered = forecasts.filter(f => String(f.horizon_days) === horizon);
  // pick latest per horizon
  const latest = filtered[0];

  if (!forecasts.length) {
    return (
      <Card className="p-12 text-center text-muted-foreground">
        No forecasts yet. Click <strong>Generate Forecast</strong> to create 7/14/30-day plans.
      </Card>
    );
  }

  // Fix #4: handle approval errors
  const approve = async (id: string) => {
    try {
      const { error } = await supabase.from("forecasts").update({
        status: "approved", approved_at: new Date().toISOString(),
      }).eq("id", id);
      if (error) throw error;
      toast.success("Forecast approved");
      qc.invalidateQueries({ queryKey: ["forecasts", projectId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to approve forecast");
    }
  };

  // Fix #2: removed window.__brief global leak — data already in React Query cache
  const generateBrief = async (forecastId: string) => {
    const text = await buildBriefingText(forecastId);
    qc.setQueryData(["brief", forecastId], text);
  };

  const [sending, setSending] = useState(false);
  const doSend = async (forecast: any, phoneRaw: string) => {
    try {
      setSending(true);
      const items = forecast.forecast_items ?? [];
      if (!items.length) {
        toast.error("No forecast items to send");
        return;
      }
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

      const to = phoneRaw.replace(/[^0-9]/g, "");
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session) {
        toast.error("Please sign in again.");
        return;
      }
      console.log('Sending WhatsApp to:', to);
      console.log('Message body:', message);
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: { to, message },
      });
      console.log("whatsapp-send response:", { data, error });
      if (error) {
        toast.error(error.message || "Failed to send WhatsApp message.");
        return;
      }
      if (data?.success === false) {
        toast.error(data.error || "Failed to send WhatsApp message.");
        return;
      }

      await supabase.from("forecasts").update({
        whatsapp_sent_at: new Date().toISOString(),
        status: "sent",
      }).eq("id", forecast.id);

      toast.success("WhatsApp message sent successfully.");
      qc.invalidateQueries({ queryKey: ["forecasts", projectId] });
    } catch (err: any) {
      toast.error(err?.message || "Failed to send forecast");
    } finally {
      setSending(false);
    }
  };

  const sendToCustomer = async (forecast: any) => {
    const phone = project?.customer_phone ?? "";
    if (!phone) {
      requestEditPhone((newPhone) => { void doSend(forecast, newPhone); });
      return;
    }
    await doSend(forecast, phone);
  };

  return (
    <Tabs value={horizon} onValueChange={(v) => setHorizon(v as any)}>
      <TabsList>
        <TabsTrigger value="7">7 days</TabsTrigger>
        <TabsTrigger value="14">14 days</TabsTrigger>
        <TabsTrigger value="30">30 days</TabsTrigger>
      </TabsList>
      <TabsContent value={horizon} className="space-y-3 mt-4">
        {!latest && (
          <Card className="p-8 text-center text-muted-foreground text-sm">
            No items for {horizon}-day horizon
          </Card>
        )}
        {latest && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-xs text-muted-foreground">
                  Generated {formatDistanceToNow(new Date(latest.generated_at))} ago · {(latest.forecast_items ?? []).length} items
                </div>
                <div className="text-sm font-medium capitalize">{latest.status}</div>
              </div>
              <div className="flex gap-2">
                {latest.status === "draft" && (
                  <Button size="sm" onClick={() => approve(latest.id)}>Approve</Button>
                )}
                {latest.status === "approved" && (
                  <Button size="sm" variant="outline" onClick={() => generateBrief(latest.id)}>
                    Generate WhatsApp Brief
                  </Button>
                )}
                {(latest.forecast_items ?? []).length > 0 && (
                  <Button
                    size="sm"
                    onClick={() => sendToCustomer(latest)}
                    disabled={sending}
                  >
                    {sending ? "Sending…" : latest.status === "sent" ? "Resend to Customer" : "Send to Customer"}
                  </Button>
                )}
              </div>
            </div>
            <BriefPreview forecastId={latest.id} />
            <ForecastItemsList items={latest.forecast_items ?? []} qc={qc} projectId={projectId} />
          </Card>
        )}
      </TabsContent>
    </Tabs>
  );
}

function BriefPreview({ forecastId }: { forecastId: string }) {
  const { data: brief } = useQuery({
    queryKey: ["brief", forecastId],
    enabled: false,
    queryFn: async () => "",
  });
  if (!brief) return null;
  return (
    <div className="mb-4">
      <Label className="text-xs">WhatsApp brief (copy & paste)</Label>
      <Textarea value={brief} readOnly rows={14} className="font-mono text-xs mt-1" />
      <Button size="sm" variant="ghost" className="mt-1"
        onClick={() => { navigator.clipboard.writeText(brief); toast.success("Copied"); }}>
        Copy to clipboard
      </Button>
    </div>
  );
}

function ForecastItemsList({ items, qc, projectId }: { items: any[]; qc: any; projectId: string }) {
  const sorted = [...items].sort((a, b) => {
    if (a.risk_flag !== b.risk_flag) return a.risk_flag ? -1 : 1;
    return (a.order_by_date ?? "").localeCompare(b.order_by_date ?? "");
  });

  return (
    <div className="space-y-2">
      {sorted.map((i) => (
        <div key={i.id}
          className={`p-3 rounded border text-sm flex items-center justify-between ${
            i.risk_flag ? "border-destructive/40 bg-destructive/5" : "border-border"
          }`}>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              {i.risk_flag && <AlertTriangle className="w-3 h-3 text-destructive" />}
              <span className="font-medium">{i.product_name ?? i.product_id}</span>
              <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                i.confidence === "high" ? "bg-primary/15 text-primary" :
                i.confidence === "medium" ? "bg-muted text-muted-foreground" :
                "bg-destructive/15 text-destructive"
              }`}>{i.confidence}</span>
              <StatusBadge status={i.status} />
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Qty {i.qty_estimated} {i.unit ?? ""} · {formatINR(i.budget_estimated)} · order by {formatDateShort(i.order_by_date)}
              {i.supplier_name && <> · supplier {i.supplier_name}</>}
              {i.actual_order_date && <> · ordered {formatDateShort(i.actual_order_date)}</>}
              {i.actual_delivery_date && <> · delivered {formatDateShort(i.actual_delivery_date)}</>}
            </div>
          </div>
          <ItemActionDialog item={i} qc={qc} projectId={projectId} />
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = (status ?? "pending").toLowerCase();
  const map: Record<string, string> = {
    pending: "bg-muted text-muted-foreground",
    confirmed: "bg-primary/15 text-primary",
    modified: "bg-amber-500/15 text-amber-700",
    rejected: "bg-destructive/15 text-destructive",
    ordered: "bg-blue-500/15 text-blue-700",
    delivered: "bg-green-500/15 text-green-700",
  };
  return (
    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${map[s] ?? map.pending}`}>{s}</span>
  );
}

function ItemActionDialog({ item, qc, projectId }: { item: any; qc: any; projectId: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string>(item.status ?? "pending");
  const [confirmedQty, setConfirmedQty] = useState<string>(
    String(item.confirmed_qty ?? item.qty_estimated ?? ""),
  );
  const [confirmedPrice, setConfirmedPrice] = useState<string>(
    String(item.confirmed_price ?? item.unit_price ?? ""),
  );
  const [supplier, setSupplier] = useState<string>(item.supplier_name ?? "");
  const [orderDate, setOrderDate] = useState<string>(
    item.actual_order_date ?? new Date().toISOString().slice(0, 10),
  );
  const [deliveryDate, setDeliveryDate] = useState<string>(item.actual_delivery_date ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const patch: any = {
        status,
        decided_at: new Date().toISOString(),
        decided_by: user?.id ?? null,
      };
      const qty = confirmedQty === "" ? null : Number(confirmedQty);
      const price = confirmedPrice === "" ? null : Number(confirmedPrice);
      if (qty != null) patch.confirmed_qty = qty;
      if (price != null) patch.confirmed_price = price;
      if (supplier) patch.supplier_name = supplier;
      if (["ordered", "delivered"].includes(status)) {
        patch.actual_order_date = orderDate || null;
        patch.ordered_at = new Date().toISOString();
      }
      if (status === "delivered") {
        patch.actual_delivery_date = deliveryDate || null;
      }
      await supabase.from("forecast_items").update(patch).eq("id", item.id);

      // Record accuracy on order/delivery when qty known
      if (["ordered", "delivered"].includes(status) && qty != null && Number(item.qty_estimated) > 0) {
        const variance = ((qty - Number(item.qty_estimated)) / Number(item.qty_estimated)) * 100;
        await supabase.from("forecast_accuracy").insert({
          forecast_item_id: item.id,
          predicted_qty: item.qty_estimated,
          actual_qty: qty,
          variance_pct: variance,
        });
      }

      toast.success(`Marked ${status}`);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["forecasts", projectId] });
      qc.invalidateQueries({ queryKey: ["accuracy", projectId] });
      qc.invalidateQueries({ queryKey: ["ops-stats"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Update</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item.product_name ?? item.product_id}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Action</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="modified">Modified</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="ordered">Ordered</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {status !== "rejected" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Confirmed qty</Label>
                <Input type="number" value={confirmedQty} onChange={(e) => setConfirmedQty(e.target.value)} />
              </div>
              <div>
                <Label>Confirmed price (₹/unit)</Label>
                <Input type="number" value={confirmedPrice} onChange={(e) => setConfirmedPrice(e.target.value)} />
              </div>
            </div>
          )}
          {status !== "rejected" && (
            <div>
              <Label>Supplier</Label>
              <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier name" />
            </div>
          )}
          {["ordered", "delivered"].includes(status) && (
            <div>
              <Label>Actual order date</Label>
              <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
            </div>
          )}
          {status === "delivered" && (
            <div>
              <Label>Actual delivery date</Label>
              <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Predicted: {item.qty_estimated} {item.unit ?? ""} · {formatINR(item.unit_price)} /unit
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccuracyPanel({ projectId }: { projectId: string }) {
  const { data } = useQuery({
    queryKey: ["accuracy", projectId],
    queryFn: async () => {
      // Fix #3: scope to this project server-side — get item IDs first, then accuracy rows
      const { data: itemRows } = await supabase
        .from("forecast_items")
        .select("id, forecasts!inner:forecast_id(project_id)")
        .eq("forecasts.project_id", projectId);
      const itemIds = (itemRows ?? []).map((r: any) => r.id);
      if (!itemIds.length) return [];
      const { data } = await supabase
        .from("forecast_accuracy")
        .select("*, forecast_items:forecast_item_id(product_name, product_id)")
        .in("forecast_item_id", itemIds)
        .order("recorded_at", { ascending: false });
      return data ?? [];
    },
  });
  const rows = data ?? [];
  if (!rows.length) {
    return <Card className="p-12 text-center text-muted-foreground">No accuracy data yet — mark forecast items as ordered to start tracking.</Card>;
  }
  const avgVariance = rows.reduce((s, r) => s + Math.abs(Number(r.variance_pct)), 0) / rows.length;
  const accuracy = Math.max(0, 100 - avgVariance);

  return (
    <Card className="p-5">
      <div className="mb-4">
        <div className="text-xs text-muted-foreground">Running forecast accuracy</div>
        <div className="text-3xl font-bold">{accuracy.toFixed(0)}%</div>
        <div className="text-xs text-muted-foreground">across {rows.length} ordered items</div>
      </div>
      <div className="space-y-2">
        {rows.map((r: any) => (
          <div key={r.id} className="text-sm flex items-center justify-between border-b pb-2">
            <span className="font-medium">{r.forecast_items?.product_name ?? r.forecast_items?.product_id}</span>
            <span className="text-xs text-muted-foreground">
              predicted {Number(r.predicted_qty)} · actual {Number(r.actual_qty)} ·
              variance {Number(r.variance_pct).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function EditCustomerDialog({
  open, onOpenChange, projectId, initialName, initialPhone, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  initialName: string;
  initialPhone: string;
  onSaved: (phone: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setPhone(initialPhone);
    }
  }, [open, initialName, initialPhone]);

  const save = async () => {
    const cleaned = phone.replace(/[\s+\-]/g, "");
    if (!cleaned) return toast.error("Customer phone is required");
    if (!/^\d{10,15}$/.test(cleaned)) return toast.error("Phone must be 10–15 digits");
    setSaving(true);
    try {
      const { error } = await supabase
        .from("projects")
        .update({ customer_name: name || null, customer_phone: cleaned })
        .eq("id", projectId);
      if (error) throw error;
      toast.success("Customer details updated");
      onOpenChange(false);
      onSaved(cleaned);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Customer Details</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Customer Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          </div>
          <div>
            <Label>Customer Phone</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="10–15 digits (with country code)"
              inputMode="tel"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Spaces, + and dashes are removed automatically.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
