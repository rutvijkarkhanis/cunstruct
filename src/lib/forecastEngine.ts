import { supabase } from "@/integrations/supabase/client";
import { supabase as catalogSupabase } from "@/lib/supabase";
import { toast } from "sonner";

const FORECASTS_TABLE_SCHEMA = {
  columns: [
    "id",
    "project_id",
    "generated_at",
    "horizon_days",
    "status",
    "approved_at",
    "approved_by",
    "created_at",
    "whatsapp_sent_at",
  ],
  notNull: ["id", "project_id", "generated_at", "horizon_days", "status", "created_at"],
  defaults: {
    id: "gen_random_uuid()",
    generated_at: "now()",
    status: "draft",
    created_at: "now()",
  },
  statusValues: ["draft", "approved", "sent"],
} as const;

// Diagnostic logger prefix for easy filtering in console
const LOG = (label: string, data?: any) => {
  const prefix = "[ForecastDiag]";
  if (data !== undefined) {
    console.log(prefix, label, data);
  } else {
    console.log(prefix, label);
  }
};

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

  // Join stage_material_mapping → product by SKU (product.id is the SKU)
  const mappedSkus = Array.from(new Set((mappings ?? []).map((m: any) => m.product_id)));
  let productMap = new Map<string, any>();
  if (mappedSkus.length) {
    let { data: productRows, error: prodErr } = await supabase
      .from("product")
      .select("id, name, selling_price, unit, lead_time_days")
      .in("id", mappedSkus);
    if (prodErr) {
      console.warn("[ForecastDiag] Main DB product lookup failed, trying catalog", prodErr);
    }
    if (!productRows || productRows.length === 0) {
      const { data: catalogRows } = await catalogSupabase
        .from("products_master")
        .select("id, name, selling_price")
        .in("id", mappedSkus);
      productRows = (catalogRows ?? []) as any[];
    }
    productMap = new Map((productRows ?? []).map((p: any) => [p.id, p]));
  }

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

        const prod: any = productMap.get(m.product_id);

        // Qty: use qty_formula.per_sqft if present else default 1
        let qty = 1;
        const formula = m.qty_formula as any;
        if (formula?.per_sqft && project.area_sqft) {
          qty = Number(formula.per_sqft) * Number(project.area_sqft);
        } else if (formula?.fixed) {
          qty = Number(formula.fixed);
        }
        qty = Math.ceil(qty * (1 + Number(m.buffer_pct ?? 0) / 100));

        const unitPrice = prod?.selling_price != null
          ? Number(prod.selling_price)
          : (formula?.unit_price ? Number(formula.unit_price) : null);
        const budget = unitPrice ? unitPrice * qty : null;

        const hasVelocity = vel.has_enough_data;
        const hasLeadTime = m.lead_time_days != null;
        const confidence = scoreConfidence(hasVelocity, hasLeadTime);

        const daysToOrderBy = (orderBy.getTime() - today.getTime()) / 86_400_000;
        const risk = daysToOrderBy <= 3;

        itemsForHorizon.push({
          product_id: m.product_id,
          product_name: prod?.name ?? m.product_name ?? m.product_id,
          stage_id: m.stage_id,
          qty_estimated: qty,
          unit: prod?.unit ?? m.unit,
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

    if (itemsForHorizon.length === 0) continue;

    // Find existing forecast for this project+horizon in draft/sent/approved
    const { data: existing } = await supabase
      .from("forecasts")
      .select("id, status")
      .eq("project_id", projectId)
      .eq("horizon_days", horizon)
      .in("status", ["draft", "sent", "approved"])
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let forecastId: string;
    if (existing) {
      forecastId = existing.id;
      await supabase.from("forecast_items").delete().eq("forecast_id", forecastId);
      await supabase.from("forecasts")
        .update({ generated_at: new Date().toISOString() })
        .eq("id", forecastId);
    } else {
      const { data: forecast, error } = await supabase
        .from("forecasts")
        .insert({ project_id: projectId, horizon_days: horizon, status: "draft" })
        .select().single();
      if (error) throw error;
      forecastId = forecast.id;
    }
    const { error: itemsErr } = await supabase
      .from("forecast_items")
      .insert(itemsForHorizon.map(i => ({ ...i, forecast_id: forecastId })));
    if (itemsErr) throw itemsErr;
    created += itemsForHorizon.length;
  }

  await cleanupEmptyForecasts(projectId);
  return { created };
}

/**
 * Auto-generate a forecast for a project's CURRENT stage from stage_material_mapping,
 * joined with the `product` table. Approves immediately so contractors see it.
 * Triggered on project creation, stage change, and progress updates.
 */
export async function autoGenerateForecastForCurrentStage(
  projectId: string,
): Promise<{ created: number; forecastId: string | null; skipped?: string }> {
  // 1. Load project
  const { data: project } = await supabase
    .from("projects")
    .select("id, current_stage_id, area_sqft, owner_id, name, location, status")
    .eq("id", projectId)
    .single();

  if (!project) {
    LOG("Project loaded: NONE", { projectId });
    throw new Error("Project not found");
  }

  LOG("Project loaded", {
    id: project.id,
    name: project.name,
    current_stage_id: project.current_stage_id,
  });
  LOG("project.current_stage_id", project.current_stage_id);

  if (!project.current_stage_id) {
    LOG("Skipped: project has no current_stage_id", { projectId: project.id });
    throw new Error("Project has no current_stage_id.");
  }
  const currentStageId = project.current_stage_id;

  // 2. Load stage info
  const { data: stage } = await supabase
    .from("stage_master")
    .select("name, typical_duration_days")
    .eq("id", currentStageId)
    .single();

  // 3. Load stage mappings
  const { data: mappings } = await supabase
    .from("stage_material_mapping")
    .select("*")
    .eq("stage_id", currentStageId);

  LOG("Stage mappings query", {
    current_stage_id: currentStageId,
    count: mappings?.length ?? 0,
    product_ids: mappings?.map((m: any) => m.product_id) ?? [],
  });

  if (!mappings || mappings.length === 0) {
    LOG("Skipped: zero mappings for stage", {
      current_stage_id: currentStageId,
      stage_name: stage?.name,
      reason: "No stage_material_mapping rows matched project.current_stage_id",
    });
    throw new Error("No stage mappings found for current_stage_id.");
  }

  // 4. Load products
  const productIds = Array.from(new Set(mappings.map((m: any) => m.product_id)));
  let { data: products } = await supabase
    .from("product")
    .select("id, name, selling_price, lead_time_days, unit")
    .in("id", productIds);

  if (!products || products.length === 0) {
    LOG("Main DB product table empty, falling back to catalog DB", { productIds });
    const { data: catalogProducts } = await catalogSupabase
      .from("products_master")
      .select("id, name, selling_price")
      .in("id", productIds);
    products = (catalogProducts ?? []) as any[];
  }

  LOG("Product query", {
    count: products?.length ?? 0,
    ids: products?.map((p: any) => p.id) ?? [],
  });

  const productMap = new Map((products ?? []).map((p: any) => [p.id, p]));

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  // forecasts.horizon_days has a CHECK constraint: must be 7, 14, or 30.
  const rawDuration = Number(stage?.typical_duration_days ?? 30);
  const horizonDays: 7 | 14 | 30 =
    rawDuration <= 7 ? 7 : rawDuration <= 14 ? 14 : 30;
  LOG("Horizon resolved", { typical_duration_days: rawDuration, horizonDays });

  // 5. Generate items
  const items = mappings.map((m: any) => {
    const p: any = productMap.get(m.product_id);
    const leadTime = Number(m.lead_time_days ?? p?.lead_time_days ?? 3);
    const buffer = Number(m.buffer_days ?? 1);
    const stageStart = new Date(today);
    const orderBy = computeOrderByDate(stageStart, leadTime, buffer);
    const orderByIso = orderBy.toISOString().slice(0, 10);
    const deliveryIso = stageStart.toISOString().slice(0, 10);

    const formula = (m.qty_formula ?? {}) as any;
    let qty = 1;
    if (formula?.per_sqft && project.area_sqft) {
      qty = Number(formula.per_sqft) * Number(project.area_sqft);
    } else if (formula?.fixed) {
      qty = Number(formula.fixed);
    }
    qty = Math.ceil(qty * (1 + Number(m.buffer_pct ?? 0) / 100));

    const unitPrice = p?.selling_price != null ? Number(p.selling_price) : null;
    const budget = unitPrice != null ? unitPrice * qty : null;

    const priority = String(m.priority ?? "").toLowerCase();
    const isCritical = priority === "critical";
    const risk = orderByIso <= todayIso || isCritical;

    const hasLead = m.lead_time_days != null || p?.lead_time_days != null;
    const confidence: "high" | "medium" | "low" =
      isCritical && hasLead ? "high" : hasLead ? "medium" : "low";

    LOG("Generated item", {
      product_id: m.product_id,
      qty,
      unit_price: unitPrice,
      total_value: budget,
    });

    return {
      product_id: m.product_id,
      product_name: p?.name ?? m.product_name ?? m.product_id,
      stage_id: m.stage_id,
      qty_estimated: qty,
      unit: p?.unit ?? m.unit ?? null,
      unit_price: unitPrice,
      budget_estimated: budget,
      order_by_date: orderByIso,
      delivery_date: deliveryIso,
      confidence,
      risk_flag: risk,
      initiated_by: "cunstruct",
      notes: isCritical ? "critical" : (m.priority ?? null),
    };
  });

  LOG("Forecast items generated", {
    count: items.length,
  });

  if (items.length === 0) {
    LOG("Skipped: zero items after generation", {
      mappings_count: mappings.length,
      products_count: products.length,
      reason:
        "mappings.map() produced empty array — check mapping/product join logic",
    });
    await cleanupEmptyForecasts(projectId);
    throw new Error("Forecast generation produced zero items.");
  }

  const totalForecastValue = items.reduce(
    (sum: number, i: any) => sum + Number(i.budget_estimated ?? 0),
    0,
  );

  // 6. Reuse or create forecast
  const { data: existing } = await supabase
    .from("forecasts")
    .select("id, status")
    .eq("project_id", projectId)
    .eq("horizon_days", horizonDays)
    .in("status", ["draft", "sent", "approved"])
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let forecast: { id: string };
  if (existing) {
    forecast = { id: existing.id };
    await supabase.from("forecast_items").delete().eq("forecast_id", existing.id);
    await supabase.from("forecasts")
      .update({ generated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    const forecastPayload = {
      project_id: projectId,
      horizon_days: horizonDays,
      status: "approved",
    } as const;
    const payloadKeys = Object.keys(forecastPayload);
    const invalidKeys = payloadKeys.filter(
      (key) => !FORECASTS_TABLE_SCHEMA.columns.includes(key as any),
    );
    const missingRequiredKeys = FORECASTS_TABLE_SCHEMA.notNull.filter(
      (key) =>
        !(key in FORECASTS_TABLE_SCHEMA.defaults) &&
        !payloadKeys.includes(key),
    );
    LOG("Forecasts insert payload", forecastPayload);
    LOG("Forecasts schema comparison", {
      schema: FORECASTS_TABLE_SCHEMA,
      payload_keys: payloadKeys,
      invalid_payload_keys: invalidKeys,
      missing_required_without_defaults: missingRequiredKeys,
      status_is_valid: FORECASTS_TABLE_SCHEMA.statusValues.includes(forecastPayload.status),
    });
    if (invalidKeys.length > 0) {
      throw new Error(`Forecast payload contains invalid fields: ${invalidKeys.join(", ")}`);
    }
    if (missingRequiredKeys.length > 0) {
      throw new Error(`Forecast payload missing required fields: ${missingRequiredKeys.join(", ")}`);
    }
    if (!FORECASTS_TABLE_SCHEMA.statusValues.includes(forecastPayload.status)) {
      throw new Error(`Invalid forecast status: ${forecastPayload.status}`);
    }

    try {
      const { data: created, error: fErr } = await supabase
        .from("forecasts")
        .insert(forecastPayload)
        .select()
        .single();
      if (fErr || !created) {
        const message = fErr?.message ?? "Failed to create forecast";
        console.error("[ForecastDiag] Forecasts insert error (full):", fErr);
        LOG("Forecasts insert error", {
          message: fErr?.message,
          details: (fErr as any)?.details,
          hint: (fErr as any)?.hint,
          code: (fErr as any)?.code,
          payload: forecastPayload,
        });
        throw new Error(message);
      }
      forecast = { id: created.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create forecast";
      console.error("[ForecastDiag] Forecasts insert exception (full):", err);
      LOG("Forecasts insert exception", {
        message,
        details: (err as any)?.details,
        hint: (err as any)?.hint,
        code: (err as any)?.code,
        payload: forecastPayload,
      });
      toast.error(message);
      throw err instanceof Error ? err : new Error(message);
    }
  }

  const itemsPayload = items.map((i) => ({ ...i, forecast_id: forecast.id }));
  LOG("Forecast items insert payload (first row)", itemsPayload[0]);
  const { error: itemsErr } = await supabase
    .from("forecast_items")
    .insert(itemsPayload);
  if (itemsErr) {
    console.error("[ForecastDiag] forecast_items insert error (full):", itemsErr);
    LOG("forecast_items insert error", {
      message: itemsErr.message,
      details: (itemsErr as any).details,
      hint: (itemsErr as any).hint,
      code: (itemsErr as any).code,
    });
    throw new Error(
      `Failed to insert forecast items: ${itemsErr.message}${
        (itemsErr as any).details ? ` — ${(itemsErr as any).details}` : ""
      }`,
    );
  }

  // 7. Final result log
  LOG("Final result", {
    forecast_items_inserted: items.length,
    total_forecast_value: totalForecastValue,
    forecast_id: forecast.id,
    horizon_days: horizonDays,
  });

  // Generate WhatsApp briefing draft (best-effort)
  try {
    const content = await buildBriefingText(forecast.id);
    await supabase.from("whatsapp_messages").insert({
      project_id: projectId,
      message_type: "weekly_brief",
      content,
    });
  } catch {
    /* non-fatal */
  }

  await cleanupEmptyForecasts(projectId);
  return { created: items.length, forecastId: forecast.id };
}

/** Delete forecasts that have no items and zero estimated value. */
export async function cleanupEmptyForecasts(projectId?: string): Promise<number> {
  let query = supabase
    .from("forecasts")
    .select("id, forecast_items(id, budget_estimated)");
  if (projectId) query = query.eq("project_id", projectId);
  const { data: rows } = await query;
  const empties = (rows ?? []).filter((f: any) => {
    const items = f.forecast_items ?? [];
    if (items.length > 0) return false;
    const total = items.reduce(
      (s: number, i: any) => s + Number(i.budget_estimated ?? 0), 0,
    );
    return total === 0;
  });
  if (!empties.length) return 0;
  await supabase.from("forecasts").delete().in("id", empties.map((e: any) => e.id));
  return empties.length;
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