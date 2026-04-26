import { supabase } from "@/lib/supabase";

/**
 * Best-effort search analytics. Logs to a `search_events` table if it exists.
 * Fails silently if the table is missing or RLS blocks the insert — analytics
 * must never break search UX.
 *
 * Expected table (run once in your Supabase project):
 *   create table public.search_events (
 *     id uuid primary key default gen_random_uuid(),
 *     created_at timestamptz not null default now(),
 *     query text not null,
 *     event_type text not null check (event_type in ('search','click','zero_result')),
 *     result_type text,        -- 'kit' | 'product' | 'category' | null
 *     result_id text,
 *     session_id text
 *   );
 *   alter table public.search_events enable row level security;
 *   create policy "anon insert search_events" on public.search_events
 *     for insert to anon with check (true);
 */

type SearchEvent = {
  query: string;
  event_type: "search" | "click" | "zero_result";
  result_type?: "kit" | "product" | "category";
  result_id?: string;
};

function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  const KEY = "cunstruct_sid";
  let sid = window.sessionStorage.getItem(KEY);
  if (!sid) {
    sid =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `sid_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(KEY, sid);
  }
  return sid;
}

export async function logSearchEvent(ev: SearchEvent): Promise<void> {
  try {
    await supabase.from("search_events").insert({
      ...ev,
      session_id: getSessionId(),
    });
  } catch {
    /* ignore — analytics never breaks UX */
  }
}
