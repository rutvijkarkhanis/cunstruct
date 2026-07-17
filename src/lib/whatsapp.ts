/**
 * Click-to-chat helpers. Instead of sending through a WhatsApp Business API,
 * we open WhatsApp (Web on desktop, the app on mobile) with the recipient and
 * message pre-filled so the operator reviews and presses send themselves.
 */

/** Normalize a phone to WhatsApp digits: country code, no "+", no separators. */
export function normalizeWhatsAppPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10) d = "91" + d;                       // bare Indian mobile
  else if (d.length === 11 && d.startsWith("0")) d = "91" + d.slice(1); // leading 0
  return d;
}

/** Build a wa.me click-to-chat URL with the message pre-filled, or null if no valid phone. */
export function buildWhatsAppUrl(phone: string | null | undefined, message: string): string | null {
  const num = normalizeWhatsAppPhone(phone);
  if (!num) return null;
  return `https://wa.me/${num}?text=${encodeURIComponent(message)}`;
}

export interface BriefingItem {
  product_name?: string | null;
  product_id?: string | null;
  qty_estimated?: number | null;
  unit?: string | null;
  budget_estimated?: number | null;
  order_by_date?: string | null;
}

export interface BriefingContext {
  projectName: string;
  customerName?: string | null;
  stageName?: string | null;
  progressPct?: number | null;
}

const inr = (n: number) => "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n));

const formatDay = (iso?: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

/** A short check-in message when there are no forecasted materials yet. */
export function buildCheckInMessage(ctx: BriefingContext): string {
  const hi = ctx.customerName?.trim() ? `Hi ${ctx.customerName.trim()} 👋` : "Hi 👋";
  const stage = ctx.stageName ?? "your current stage";
  const pct = ctx.progressPct != null ? ` (${Math.round(Number(ctx.progressPct))}% done)` : "";
  return (
    `${hi}\n\n` +
    `Quick check-in on *${ctx.projectName}* — you're in *${stage}*${pct}. ` +
    `How's progress since we last spoke?\n\n` +
    `Reply with an update and we'll line up your next materials.\n\n— Team Cunstruct`
  );
}

/**
 * Build a customer-facing procurement briefing: greeting, project/stage context,
 * a numbered material list with per-item cost, the total, an order-by nudge, and
 * a clear reply prompt. WhatsApp uses *asterisks* for bold.
 */
export function buildBriefingMessage(items: BriefingItem[], ctx: BriefingContext): string {
  if (!items.length) return buildCheckInMessage(ctx);

  const hi = ctx.customerName?.trim() ? `Hi ${ctx.customerName.trim()} 👋` : "Hi 👋";
  const pct = ctx.progressPct != null ? ` (${Math.round(Number(ctx.progressPct))}% done)` : "";
  const header = ctx.stageName
    ? `Here's the material plan for *${ctx.projectName}* — currently at *${ctx.stageName}*${pct}:`
    : `Here's the material plan for *${ctx.projectName}*:`;

  const lines = items.map((i, idx) => {
    const name = (i.product_name || i.product_id || "Item").toString();
    const qty = i.qty_estimated != null ? `${Number(i.qty_estimated)} ${i.unit ?? ""}`.trim() : "";
    const price = i.budget_estimated != null && Number(i.budget_estimated) > 0
      ? `  (${inr(Number(i.budget_estimated))})` : "";
    return `${idx + 1}. ${name}${qty ? ` — ${qty}` : ""}${price}`;
  });

  const total = items.reduce((s, i) => s + Number(i.budget_estimated ?? 0), 0);
  const totalLine = total > 0 ? `\n\n*Estimated total: ${inr(total)}*` : "";

  const earliest = items.map(i => i.order_by_date).filter(Boolean).sort()[0];
  const orderLine = earliest
    ? `\n📦 Best to arrange these by *${formatDay(earliest)}* to keep work on schedule.`
    : "";

  return (
    `${hi}\n\n` +
    `${header}\n\n` +
    `${lines.join("\n")}` +
    totalLine +
    orderLine +
    `\n\nReply:\n1️⃣ Confirm — we'll line up the order\n2️⃣ Modify quantities\n3️⃣ Call me\n\n— Team Cunstruct`
  );
}
