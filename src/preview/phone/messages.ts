// Message catalogue for the B10 phone surfaces (preview lane). Every visible
// UI string in the phone views goes through `t()`. English is complete; Hindi
// is a STUB: a few keys are translated and every other key falls back to
// English. The Hindi strings have not been reviewed by a native speaker.

export type Locale = "en" | "hi";

const en = {
  title: "Phone views",
  frameNote: "Preview at phone width (360 px). Illustrative fixtures; nothing is sent.",
  language: "Language",
  navSignoff: "Sign-off",
  navCalloffs: "Call-offs",
  navMeasure: "Measure",
  navShare: "Share",
  pendingSync: "Pending sync — preview, nothing is sent",
  pendingCount: "{count} action(s) queued on this device",
  queueEmpty: "No queued actions",
  storageUnavailable: "Device storage unavailable — queue kept in memory for this tab only",
  discardQueue: "Discard queued actions",
  illustrative: "Illustrative fixture",
  // Sign-off
  signoffTitle: "Owner sign-off",
  signoffRange: "Estimated range",
  signoffRangeNote: "Illustrative range, not a project estimate. Lines with pending quantity are not in it.",
  signoffPending: "{count} line(s) with pending quantity excluded",
  keyRisks: "Key risks",
  approve: "Approve",
  returnForChanges: "Return",
  returnReason: "Reason for returning",
  returnReasonRequired: "Enter a reason to return it.",
  decisionQueued: "Decision queued: {decision}",
  decisionApproved: "approved",
  decisionReturned: "returned",
  // Call-offs
  calloffsTitle: "Call-offs against certified lines",
  neededWeek: "Needed week {week} · place by week {placeBy}",
  toDealer: "To: {dealer}",
  queueCalloff: "Queue call-off",
  calloffQueued: "Queued",
  notProcurable: "Not procurable yet",
  // Measurement
  measureTitle: "Site measurement",
  measureLine: "Line: {line}",
  row: "Row {n}",
  fieldNo: "No",
  fieldL: "L",
  fieldB: "B",
  fieldD: "D",
  addRow: "Add row",
  removeRow: "Remove row {n}",
  lineTotal: "Total",
  totalPending: "Pending — enter every value",
  totalInvalid: "Invalid — check the rows",
  attachPhoto: "Attach photo",
  photoNote: "Photos stay in this tab's memory only; they are not uploaded or saved.",
  removePhoto: "Remove photo {n}",
  saveMeasurement: "Queue measurement",
  // Share
  shareTitle: "WhatsApp share link",
  sharePhone: "Phone (optional)",
  shareMessage: "Message",
  shareDefault: "Call-off {id}: needed week {week}. Preview only — please do not act on this message.",
  shareLink: "Link",
  shareOpen: "Open in WhatsApp",
  shareNote: "The link is only built here; it never opens by itself. You review and press send in WhatsApp.",
  shareBadPhone: "Phone number not recognised.",
  shareSecret: "The message looks like it contains a token or key; the link is not built.",
  shareEmpty: "Enter a message.",
} as const;

export type MessageKey = keyof typeof en;

/** Hindi stub: only these keys are translated; the rest fall back to English. */
const hi: Partial<Record<MessageKey, string>> = {
  title: "फ़ोन दृश्य",
  language: "भाषा",
  approve: "स्वीकृत करें",
  returnForChanges: "वापस भेजें",
  pendingSync: "सिंक बाकी — प्रीव्यू, कुछ भी भेजा नहीं जाता",
  navSignoff: "स्वीकृति",
  keyRisks: "मुख्य जोखिम",
};

const CATALOGUE: Record<Locale, Partial<Record<MessageKey, string>>> = { en, hi };

/** Look up a message, falling back to English, and fill {placeholders}. */
export function t(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  const template = CATALOGUE[locale][key] ?? en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** True when `key` has its own translation in `locale` (not the English fallback). */
export function isTranslated(locale: Locale, key: MessageKey): boolean {
  return locale === "en" || hi[key] !== undefined;
}
