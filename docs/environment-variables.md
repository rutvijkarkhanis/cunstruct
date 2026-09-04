# Environment variables

Two hard rules:

1. **Anything prefixed `VITE_` is shipped to the browser.** Never put a secret
   behind a `VITE_` name.
2. **Server secrets live only server-side** — in Supabase Edge Function env or
   the deploy platform's secret store — never in `src/`, never in the committed
   `.env`, never in the database, never returned in an API response.

## Client-safe (frontend) — `VITE_` prefixed

These are public by design (the browser needs them; Supabase RLS is what protects
data, not the anon key). They belong in the committed `.env`.

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable/anon key (RLS-guarded) |
| `VITE_SUPABASE_PROJECT_ID` | Supabase project ref |
| `VITE_APP_URL` / `VITE_MAIN_URL` / `VITE_IS_APP_SUBDOMAIN` | App routing/config |

`.env.example` documents the required set for local development.

## Server-only (never `VITE_`, never committed)

Set these in **Supabase → Edge Functions → Secrets** (or the deploy platform),
and locally in `.env.local` (git-ignored). They must never appear in the client
bundle.

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Edge functions | Full DB access — server only |
| `WHATSAPP_ACCESS_TOKEN` | `whatsapp-send/webhook` | Secret |
| `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | webhook | Config/secret |
| *(future)* `AI_PROVIDER_API_KEY` | future AI edge function | **Server only.** Never `VITE_`. Pick the name when a provider is chosen. |

## Local development

- Copy `.env.example` → `.env` (public `VITE_` keys only).
- Put any secret you need locally in **`.env.local`** (git-ignored). Never add a
  secret to `.env`.

## Enforcement

`src/lib/security/secrets.test.ts` fails the build if:
- any `src` file references a service-role key,
- any `import.meta.env.VITE_*` var is named like a secret,
- a hardcoded provider key pattern appears,
- the committed `.env` contains a non-`VITE_` assignment.
