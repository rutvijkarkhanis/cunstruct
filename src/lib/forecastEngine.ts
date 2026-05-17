import { supabase } from "@/integrations/supabase/client";

export const formatINR = (n: number | null | undefined): string => {
  if (n == null || isNaN(Number(n))) return "—";
  return "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(n));
};

export const formatDateShort = (d: Date | string | null | undefined): string => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

const addDays = (date: Date, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const daysBetween = (a: Date, b: Date) =>
  Math.max(0.01, (b.getTime() - a.getTime()) / 86_400_000);

export interface VelocityResult {
  velocity_pct_per_day: number | null;
  projected_completion_date: string | null;
  has_enough_data: boolean;
  current_progress: number;
}

/** Recalculate velocity for the project's active stage and persist on project. */
export async function recalcProjectVelocity(projectId: string): Promise<VelocityResult> {
  const { data: project } = await supabase
    .from("projects")
    .select("id, current_stage_id, progress_pct")
    .eq("id", projectId)
    .single();

  const stageId = project?.current_stage_id;
  if (!stageId) {
    return { velocity_pct_per_day: null, projected_completion_date: null, has_enough_data: false, current_progress: 0 };
  }

  const { data: updates } = await supabase
    .from("stage_updates")
    .select("progress_pct, recorded_at")
    .eq("project_id", projectId)
    .eq("stage_id", stageId)
    .order("recorded_at", { ascending: true });

  const rows = updates ?? [];
  const current_progress = Number(project?.progress_pct ?? 0);

  if (rows.length < 2) {
    await supabase.from("projects")
      .update({ velocity_days_per_pct: null, projected_completion_date: null })
      .eq("id", projectId);
    return { velocity_pct_per_day: null, projected_completion_date: null, has_enough_data: false, current_progress };
  }

  const first = rows[0];
  const last = rows[rows.length - 1];
  const days = daysBetween(new Date(first.recorded_at), new Date(last.recorded_at));
  const pctDelta = Number(last.progress_pct) - Number(first.progress_pct);
  const velocity_pct_per_day = pctDelta > 0 ? pctDelta / days : null;

  let projected: Date | null = null;
  if (velocity_pct_per_day && velocity_pct_per_day > 0) {
    const remaining = Math.max(0, 100 - Number(last.progress_pct));
    projected = addDays(new Date(), Math.ceil(remaining / velocity_pct_per_day));
  }

  const days_per_pct = velocity_pct_per_day ? 1 / velocity_pct_per_day : null;
  const projected_iso = projected ? projected.toISOString().slice(0, 10) : null;

  await supabase.from("projects").update({
    velocity_days_per_pct: days_per_pct,
    projected_completion_date: projected_iso,
  }).eq("id", projectId);

  return {
    velocity_pct_per_day,
    projected_completion_date: projected_iso,
    has_enough_data: true,
    current_progress,
  };
}

/** Compute order_by_date from a projected stage start date and mapping fields. */
export function computeOrderByDate(stageStart: Date, leadTime: number, bufferDays: number): Date {
  return addDays(stageStart, -(leadTime + bufferDays));
}

/** Confidence per spec: high if velocity AND lead time set; medium if one; low if neither. */
export function scoreConfidence(hasVelocity: boolean, hasLeadTime: boolean): "high" | "medium" | "low" {
  if (hasVelocity && hasLeadTime) return "high";
  if (hasVelocity || hasLeadTime) return "medium";
  return "low";
}

/** Generate forecasts for all three horizons for a project. */
export async function generateForecasts(projectId: string): Promise<{ created: number }> {
  // Ensure velocity is current
  const vel = await recalcProjectVelocity(projectId);

  const { data: project } = await supabase
    .from("projects")
    .select("id, current_stage_id, progress_pct, area_sqft, velocity_days_per_pct")
    .eq("id", projectId).single();
  if (!project) throw new Error("Project not found");

  const { data: stages } = await supabase
    .from("stage_master").select("*").order("sequence");
  const allStages = stages ?? [];

  const currentStageIdx = allStages.findIndex(s => s.id === project.current_stage_id);
  const todayStageIdx = currentStageIdx >= 0 ? currentStageIdx : 0;

  // Project completion date of current stage
  const remainingPct = Math.max(0, 100 - Number(project.progress_pct ?? 0));
  const daysPerPct = project.velocity_days_per_pct ? Number(project.velocity_days_per_pct) : 1.5; // fallback benchmark
  const today = new Date();
  let cursorDate = addDays(today, Math.ceil(remainingPct * daysPerPct));

  // Build projected start dates per upcoming stage
  const upcoming: { stageId: string; startDate: Date; sequence: number; name: string }[] = [];
  for (let i = todayStageIdx + 1; i < allStages.length; i++) {
    const s = allStages[i];
    upcoming.push({ stageId: s.id, startDate: new Date(cursorDate), sequence: s.sequence, name: s.name });
    cursorDate = addDays(cursorDate, s.typical_duration_days ?? 14);
  }

  // Pull mappings for upcoming stages
  const upcomingIds = upcoming.map(u => u.stageId);
  const { data: mappings } = upcomingIds.length
    ? await supabase.from("stage_material_mapping")
        .select("*")
        .in("stage_id", upcomingIds)
    : { data: [] as any[] };

  const horizons: (7 | 14 | 30)[] = [7, 14, 30];
  let created = 0;

  for (const horizon of horizons) {
    const horizonEnd = addDays(today, horizon);
    const itemsForHorizon: any[] = [];

    for (const stage of upcoming) {
      if (stage.startDate > horizonEnd) continue;
      const stageMappings = (mappings ?? []).filter((m: any) => m.stage_id === stage.stageId);
      for (const m of stageMappings) {
        const leadTime = Number(m.lead_time_days ?? 3);
        const buffer = Number(m.buffer_days ?? 1);
        const orderBy = computeOrderByDate(stage.startDate, leadTime, buffer);

        // Qty: use qty_formula.per_sqft if present else default 1
        let qty = 1;
        const formula = m.qty_formula as any;
        if (formula?.per_sqft && project.area_sqft) {
          qty = Number(formula.per_sqft) * Number(project.area_sqft);
        } else if (formula?.fixed) {
          qty = Number(formula.fixed);
        }
        qty = Math.ceil(qty * (1 + Number(m.buffer_pct ?? 0) / 100));

        const unitPrice = formula?.unit_price ? Number(formula.unit_price) : null;
        const budget = unitPrice ? unitPrice * qty : null;

        const hasVelocity = vel.has_enough_data;
        const hasLeadTime = m.lead_time_days != null;
        const confidence = scoreConfidence(hasVelocity, hasLeadTime);

        const daysToOrderBy = (orderBy.getTime() - today.getTime()) / 86_400_000;
        const risk = daysToOrderBy <= 3;

        itemsForHorizon.push({
          product_id: m.product_id,
          product_name: m.product_name,
          stage_id: m.stage_id,
          qty_estimated: qty,
          unit: m.unit,
          unit_price: unitPrice,
          budget_estimated: budget,
          order_by_date: orderBy.toISOString().slice(0, 10),
          delivery_date: stage.startDate.toISOString().slice(0, 10),
          confidence,
          risk_flag: risk,
          initiated_by: "cunstruct",
        });
      }
    }

    const { data: forecast, error } = await supabase
      .from("forecasts")
      .insert({ project_id: projectId, horizon_days: horizon, status: "draft" })
      .select().single();
    if (error) throw error;
    if (itemsForHorizon.length) {
      const { error: itemsErr } = await supabase
        .from("forecast_items")
        .insert(itemsForHorizon.map(i => ({ ...i, forecast_id: forecast.id })));
      if (itemsErr) throw itemsErr;
      created += itemsForHorizon.length;
    }
  }

  return { created };
}

/** Build the Monday WhatsApp briefing text from an approved forecast. */
export async function buildBriefingText(forecastId: string): Promise<string> {
  const { data: forecast } = await supabase
    .from("forecasts")
    .select("*, projects:project_id(name, location)")
    .eq("id", forecastId).single();
  if (!forecast) throw new Error("Forecast not found");

  const { data: items } = await supabase
    .from("forecast_items")
    .select("*, stage_master:stage_id(name, sequence)")
    .eq("forecast_id", forecastId)
    .neq("confidence", "low")
    .order("order_by_date", { ascending: true });

  const project = (forecast as any).projects;
  const today = new Date();
  const twoWeeks = addDays(today, 14);

  const orderNow = (items ?? []).filter((i: any) => i.risk_flag).slice(0, 3);
  const coming = (items ?? []).filter((i: any) =>
    !i.risk_flag && new Date(i.order_by_date) <= twoWeeks && i.status !== "ordered"
  );
  const arranged = (items ?? []).filter((i: any) => i.status === "ordered");

  const orderNowTotal = orderNow.reduce((s: number, i: any) => s + Number(i.budget_estimated ?? 0), 0);

  // Pull current stage info
  const { data: proj } = await supabase
    .from("projects")
    .select("current_stage_id, projected_completion_date, stage_master:current_stage_id(name, sequence)")
    .eq("id", forecast.project_id).single();
  const currentStageName = (proj as any)?.stage_master?.name ?? "current stage";
  const currentSeq = (proj as any)?.stage_master?.sequence ?? 0;
  const { data: nextStage } = await supabase
    .from("stage_master").select("name").eq("sequence", currentSeq + 1).maybeSingle();

  const lines: string[] = [];
  lines.push(`📍 ${project?.name ?? "Project"}, ${project?.location ?? ""}`);
  lines.push(`📅 Week of ${formatDateShort(today)}`);
  lines.push("");
  lines.push(`Your site is on track to complete ${currentStageName} and begin ${nextStage?.name ?? "the next stage"} around ${formatDateShort(proj?.projected_completion_date)}.`);
  lines.push("");

  if (orderNow.length) {
    lines.push("🔴 ORDER NOW — lead time risk:");
    for (const i of orderNow) {
      lines.push(`- ${i.product_name ?? i.product_id} — ${i.qty_estimated} ${i.unit ?? ""} — order by ${formatDateShort(i.order_by_date)} — ${formatINR(i.budget_estimated)}`);
    }
    lines.push("");
  }

  if (coming.length) {
    lines.push("🟡 COMING IN 2 WEEKS:");
    for (const i of coming) {
      const stageName = (i as any).stage_master?.name ?? "upcoming stage";
      lines.push(`- ${i.product_name ?? i.product_id} (needed for ${stageName} starting ~${formatDateShort(i.delivery_date)})`);
    }
    lines.push("");
  }

  if (arranged.length) {
    lines.push("✅ ALREADY ARRANGED:");
    for (const i of arranged) {
      lines.push(`- ${i.product_name ?? i.product_id} confirmed for ${formatDateShort(i.delivery_date)} delivery`);
    }
    lines.push("");
  }

  lines.push(`Reply ORDER to confirm urgent items (Total: ${formatINR(orderNowTotal)})`);
  lines.push("Reply CALL to discuss");
  lines.push("Reply SKIP to dismiss");

  return lines.join("\n");
}

/** Run anomaly detection across all projects, write open flags into project_alerts. */
export async function runAnomalyDetection(): Promise<{ created: number }> {
  const today = new Date();
  const fiveDaysAgo = addDays(today, -5);

  const { data: projects } = await supabase
    .from("projects").select("id, name, historical_avg_velocity, velocity_days_per_pct");
  let created = 0;

  // Clear unresolved auto-flags (regenerate fresh)
  await supabase.from("project_alerts").delete().eq("resolved", false);

  for (const p of projects ?? []) {
    // Stale: latest stage_update older than 5 days
    const { data: last } = await supabase
      .from("stage_updates").select("recorded_at")
      .eq("project_id", p.id)
      .order("recorded_at", { ascending: false }).limit(1).maybeSingle();
    if (!last || new Date(last.recorded_at) < fiveDaysAgo) {
      await supabase.from("project_alerts").insert({
        project_id: p.id, kind: "stale", severity: "warning",
        message: "No stage update in over 5 days — check in",
      });
      created++;
    }

    // Pace drop: current vs historical
    if (p.historical_avg_velocity && p.velocity_days_per_pct) {
      const current = 1 / Number(p.velocity_days_per_pct);
      const hist = Number(p.historical_avg_velocity);
      if (hist > 0 && current < hist * 0.6) {
        await supabase.from("project_alerts").insert({
          project_id: p.id, kind: "pace_drop", severity: "critical",
          message: `Pace dropped ${Math.round((1 - current / hist) * 100)}% vs historical average`,
        });
        created++;
      }
    }

    // Overdue order: forecast items past order_by_date not ordered
    const { data: overdue } = await supabase
      .from("forecast_items")
      .select("id, product_name, product_id, order_by_date, forecasts:forecast_id(project_id, status)")
      .lt("order_by_date", today.toISOString().slice(0, 10))
      .neq("status", "ordered");
    for (const item of overdue ?? []) {
      if ((item as any).forecasts?.project_id !== p.id) continue;
      if ((item as any).forecasts?.status === "draft") continue;
      await supabase.from("project_alerts").insert({
        project_id: p.id, kind: "overdue_order", severity: "critical",
        message: `${item.product_name ?? item.product_id} order was due ${formatDateShort(item.order_by_date)}`,
        related_item_id: item.id,
      });
      created++;
    }
  }

  return { created };
}