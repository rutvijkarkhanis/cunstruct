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
