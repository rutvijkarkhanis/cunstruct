import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WHATSAPP_VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN")!;
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN")!;
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function sendWhatsApp(to: string, message: string) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body: message },
        }),
      },
    );
    return await res.json();
  } catch (err) {
    console.error("sendWhatsApp error", err);
    return null;
  }
}

function normalizePhone(p: string | null | undefined): string {
  return (p ?? "").replace(/[^0-9]/g, "");
}

// Find the latest 'sent' forecast for a given phone by traversing
// profiles.phone -> projects.owner_id -> forecasts
async function findLatestSentForecastForPhone(phone: string) {
  const candidates = [phone, phone.startsWith("91") ? phone.slice(2) : `91${phone}`];

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, phone")
    .in("phone", candidates);

  if (!profiles || profiles.length === 0) return null;
  const ownerIds = profiles.map((p) => p.id);

  const { data: projects } = await admin
    .from("projects")
    .select("id, owner_id")
    .in("owner_id", ownerIds);

  if (!projects || projects.length === 0) return null;
  const projectIds = projects.map((p) => p.id);

  const { data: forecasts } = await admin
    .from("forecasts")
    .select("id, project_id, status, generated_at, forecast_items(id, budget_estimated)")
    .in("project_id", projectIds)
    .eq("status", "sent")
    .order("generated_at", { ascending: false })
    .limit(1);

  if (!forecasts || forecasts.length === 0) return null;
  return forecasts[0];
}

async function handleConfirm(phone: string) {
  const forecast = await findLatestSentForecastForPhone(phone);
  if (!forecast) {
    await sendWhatsApp(
      phone,
      "We couldn't find an active forecast linked to your number. Our team will reach out.",
    );
    return;
  }

  // Mark forecast approved
  await admin
    .from("forecasts")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", forecast.id);

  // Confirm all items
  await admin
    .from("forecast_items")
    .update({ status: "confirmed", decided_at: new Date().toISOString() })
    .eq("forecast_id", forecast.id);

  const total = (forecast.forecast_items ?? []).reduce(
    (s: number, i: any) => s + Number(i.budget_estimated ?? 0),
    0,
  );

  await admin.from("sales_orders").insert({
    project_id: forecast.project_id,
    forecast_id: forecast.id,
    customer_phone: phone,
    total_amount: total,
    status: "pending",
    source: "whatsapp",
  });

  await sendWhatsApp(
    phone,
    "✅ Your requirement has been confirmed. Our team is processing your order.",
  );
}

async function handleModify(phone: string) {
  await sendWhatsApp(phone, "Please tell us what quantity you would like to change.");
}

async function handleCallback(phone: string) {
  const forecast = await findLatestSentForecastForPhone(phone);
  await admin.from("callback_tasks").insert({
    project_id: forecast?.project_id ?? null,
    customer_phone: phone,
    status: "open",
    notes: "Requested callback via WhatsApp option 3",
  });
  await sendWhatsApp(phone, "📞 Our team will call you shortly.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Webhook verification
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("ok", { status: 200 });
  }

  let payload: any = null;
  try {
    payload = await req.json();
  } catch {
    return new Response("ok", { status: 200 });
  }

  try {
    const entries = payload?.entry ?? [];
    for (const entry of entries) {
      const changes = entry?.changes ?? [];
      for (const change of changes) {
        const value = change?.value ?? {};
        const messages = value?.messages ?? [];
        for (const msg of messages) {
          if (msg.type !== "text") continue;
          const from = normalizePhone(msg.from);
          const text = (msg.text?.body ?? "").trim();
          const waId = msg.id ?? null;

          // Resolve project for logging
          const forecast = await findLatestSentForecastForPhone(from);
          const projectId = forecast?.project_id ?? null;

          // Save inbound message (skip duplicates by wa_message_id)
          if (projectId) {
            await admin.from("whatsapp_messages").insert({
              project_id: projectId,
              message_type: "inbound",
              content: text,
              direction: "inbound",
              from_phone: from,
              wa_message_id: waId,
              sent_at: new Date().toISOString(),
            });
          }

          // Route reply
          if (text === "1") await handleConfirm(from);
          else if (text === "2") await handleModify(from);
          else if (text === "3") await handleCallback(from);
        }
      }
    }
  } catch (err) {
    console.error("webhook processing error", err);
  }

  return new Response("ok", { status: 200 });
});
