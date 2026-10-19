// WhatsApp share-link builder for the B10 phone surfaces (preview lane).
// Builds a wa.me click-to-chat URL with the text encoded. It never opens the
// link itself; the person taps it and presses send in WhatsApp. No tokens or
// keys are ever put in the link: a message that looks like it carries one is
// refused.
import { normalizeWhatsAppPhone } from "@/lib/whatsapp";

export type ShareLinkResult =
  | { ok: true; url: string }
  | { ok: false; error: "empty_message" | "bad_phone" | "looks_like_secret" };

/** Patterns that suggest a credential: query tokens, bearer/JWT, API keys. */
const SECRET_PATTERNS = [
  /\b(?:access_?token|refresh_?token|token|api_?key|apikey|secret|password|sig)\s*[=:]/i,
  /\bbearer\s+[a-z0-9._-]{10,}/i,
  /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{5,}/, // JWT
  /\b(?:sk|pk|rk)_[a-zA-Z0-9]{12,}/,
];

export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text));
}

/** wa.me URL with the message encoded; with a phone it opens that chat, without one WhatsApp asks for a contact. */
export function buildShareLink(message: string, phone?: string | null): ShareLinkResult {
  const text = message.trim();
  if (!text) return { ok: false, error: "empty_message" };
  if (looksLikeSecret(text)) return { ok: false, error: "looks_like_secret" };
  const rawPhone = phone?.trim();
  if (rawPhone) {
    const num = normalizeWhatsAppPhone(rawPhone);
    if (!num || num.length < 11 || num.length > 15) return { ok: false, error: "bad_phone" };
    return { ok: true, url: `https://wa.me/${num}?text=${encodeURIComponent(text)}` };
  }
  return { ok: true, url: `https://wa.me/?text=${encodeURIComponent(text)}` };
}
