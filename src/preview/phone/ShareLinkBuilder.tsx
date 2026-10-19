// B10 (d): WhatsApp share-link builder. Builds the wa.me link only; it never
// opens it automatically. Tapping the link is the person's own action.
import { useState } from "react";
import { t, type Locale, type MessageKey } from "./messages";
import { buildShareLink, type ShareLinkResult } from "./shareLink";

type ShareError = Extract<ShareLinkResult, { ok: false }>["error"];

const ERROR_KEY: Record<ShareError, MessageKey> = {
  empty_message: "shareEmpty",
  bad_phone: "shareBadPhone",
  looks_like_secret: "shareSecret",
};

export function ShareLinkBuilder({ locale, defaultMessage }: { locale: Locale; defaultMessage: string }) {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState(defaultMessage);
  const result = buildShareLink(message, phone);
  // Read the error through `in`: the app tsconfig is not strict, so `ok` alone does not narrow.
  const error: ShareError | null = "error" in result ? result.error : null;

  return (
    <section className="space-y-3" aria-labelledby="share-title">
      <h3 id="share-title" className="text-base font-semibold">{t(locale, "shareTitle")}</h3>
      <label className="block text-sm">
        <span className="font-medium">{t(locale, "sharePhone")}</span>
        <input
          type="tel"
          inputMode="tel"
          className="mt-1 block min-h-11 w-full rounded-md border px-2"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium">{t(locale, "shareMessage")}</span>
        <textarea className="mt-1 block w-full rounded-md border p-2" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      {result.ok ? (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">{t(locale, "shareLink")}</div>
          <code className="block break-all rounded bg-muted/50 p-2 text-xs" data-testid="share-url">{result.url}</code>
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center justify-center rounded-md border text-sm font-medium"
          >
            {t(locale, "shareOpen")}
          </a>
        </div>
      ) : (
        <p role="alert" className="text-sm text-destructive">{error && t(locale, ERROR_KEY[error])}</p>
      )}
      <p className="text-xs text-muted-foreground">{t(locale, "shareNote")}</p>
    </section>
  );
}
