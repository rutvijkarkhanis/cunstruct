// LOCAL ONLY. A real Postgres 16 database (PGlite, in-process) carrying the
// repository's migrations, plus a small client with the same query-builder
// surface the app's write paths use (`from().select/insert/update/upsert/
// delete`, filters, `rpc`, `auth.getUser`). Every query runs as the
// `authenticated` role with the session's user id in the JWT claim, so the
// migrations' row-level-security policies, grants, constraints and functions
// are the ones that decide. What it does NOT have: PostgREST itself, Supabase
// Auth, Storage or the network — results are evidence about the SQL, labelled
// LOCAL, never staging or production.
import { PGlite, types } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "supabase");

/** Supabase-platform objects the migrations reference but do not create. */
const PLATFORM_STUBS = `
create schema if not exists auth; create schema if not exists storage; create schema if not exists extensions;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now(), owner uuid);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz default now());
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
alter table storage.objects enable row level security;
-- Supabase's default privileges: API roles get table/function access; RLS decides rows.
grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated;
`;

export const migrationFiles = (dir: "migrations" | "deferred-migrations") =>
  readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".sql")).sort();
export const migrationSql = (dir: "migrations" | "deferred-migrations", file: string) =>
  readFileSync(join(ROOT, dir, file), "utf8");

/** Return values as PostgREST's JSON would: timestamps as text, numerics as numbers. */
const PARSERS = {
  [types.TIMESTAMPTZ]: (v: string) => v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"),
  [types.TIMESTAMP]: (v: string) => v.replace(" ", "T"),
  [types.NUMERIC]: (v: string) => Number(v),
  [types.INT8]: (v: string) => Number(v),
};

export async function newDatabase(): Promise<PGlite> {
  const db = new PGlite({ parsers: PARSERS });
  await db.exec(PLATFORM_STUBS);
  return db;
}

/** Apply files in order; returns the file names applied. Throws with the file name on failure. */
export async function applyMigrations(db: PGlite, dir: "migrations" | "deferred-migrations", files: string[]): Promise<string[]> {
  for (const f of files) {
    try { await db.exec(migrationSql(dir, f)); }
    catch (e) { throw new Error(`${dir}/${f}: ${(e as Error).message}`); }
  }
  return files;
}

export async function createUser(db: PGlite, id: string, opts: { staff?: boolean } = {}) {
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(0, 8)}@rehearsal.local`]);
  if (opts.staff) await db.query("insert into public.user_roles (user_id, role) values ($1, 'ops')", [id]);
}

type Row = Record<string, unknown>;
type Err = { code?: string; message: string };
type Result = { data: unknown; error: Err | null };
type Filter = (push: (v: unknown) => string) => string;

const ident = (c: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(c)) throw new Error(`rehearsal client: unsupported column "${c}"`);
  return `"${c}"`;
};
const colList = (cols?: string) => (!cols || cols.trim() === "*" ? "*" : cols.split(",").map((c) => ident(c.trim())).join(", "));
const pgError = (e: unknown): Err => ({ code: (e as { code?: string }).code, message: (e as Error).message });

/**
 * A client bound to one signed-in user. Two clients on the same database are
 * two sessions (two tabs or two people).
 */
export function clientFor(db: PGlite, userId: string) {
  const colTypes = new Map<string, Map<string, string>>();
  const typesOf = async (table: string) => {
    if (!colTypes.has(table)) {
      const r = await db.query<{ column_name: string; data_type: string }>(
        "select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = $1", [table]);
      colTypes.set(table, new Map(r.rows.map((x) => [x.column_name, x.data_type])));
    }
    return colTypes.get(table)!;
  };
  const value = (types: Map<string, string>, col: string, v: unknown) =>
    v !== null && typeof v === "object" && (types.get(col) === "jsonb" || types.get(col) === "json") ? JSON.stringify(v) : v;

  /** Run one statement as the authenticated user, inside its own transaction. */
  const asUser = async (sql: string, params: unknown[]): Promise<Row[]> =>
    db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)", [userId]);
      await tx.exec("set local role authenticated");
      const r = await tx.query<Row>(sql, params);
      return r.rows;
    });

  function query(table: string, op: "select" | "insert" | "update" | "upsert" | "delete", payload?: Row | Row[], opts?: { onConflict?: string }) {
    const filters: Filter[] = [];
    let returning: string | null = op === "select" ? "*" : null;
    const order: string[] = [];
    let limit: number | null = null;
    let offset = 0;

    const run = async (): Promise<Result> => {
      const params: unknown[] = [];
      const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
      const where = () => (filters.length ? ` where ${filters.map((f) => f(push)).join(" and ")}` : "");
      try {
        const t = `public.${ident(table)}`;
        const types = op === "select" || op === "delete" ? new Map<string, string>() : await typesOf(table);
        let sql: string;
        if (op === "select") {
          sql = `select ${returning} from ${t}${where()}`;
          if (order.length) sql += ` order by ${order.join(", ")}`;
          if (limit != null) sql += ` limit ${limit}`;
          if (offset) sql += ` offset ${offset}`;
        } else if (op === "insert" || op === "upsert") {
          const rows = Array.isArray(payload) ? payload : [payload!];
          const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
          const values = rows.map((r) => `(${cols.map((c) => (c in r ? push(value(types, c, r[c])) : "default")).join(", ")})`).join(", ");
          sql = `insert into ${t} (${cols.map(ident).join(", ")}) values ${values}`;
          if (op === "upsert") {
            const target = (opts?.onConflict ?? "id").split(",").map((c) => ident(c.trim())).join(", ");
            const set = cols.filter((c) => !target.includes(`"${c}"`)).map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ");
            sql += ` on conflict (${target}) ${set ? `do update set ${set}` : "do nothing"}`;
          }
        } else if (op === "update") {
          const p = payload as Row;
          const set = Object.keys(p).map((c) => `${ident(c)} = ${push(value(types, c, p[c]))}`).join(", ");
          sql = `update ${t} set ${set}${where()}`;
        } else {
          sql = `delete from ${t}${where()}`;
        }
        if (op !== "select" && returning) sql += ` returning ${returning}`;
        const rows = await asUser(sql, params);
        return { data: op === "select" || returning ? rows : null, error: null };
      } catch (e) {
        return { data: null, error: pgError(e) };
      }
    };

    const one = async (required: boolean): Promise<Result> => {
      const res = await run();
      if (res.error) return res;
      const list = (res.data ?? []) as Row[];
      if (list.length > 1) return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
      if (list.length === 0) return required ? { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } } : { data: null, error: null };
      return { data: list[0], error: null };
    };

    const filter = (f: Filter) => { filters.push(f); return builder; };
    const builder = {
      select(cols?: string) { returning = colList(cols); return builder; },
      eq: (c: string, v: unknown) => filter((p) => `${ident(c)} = ${p(v)}`),
      neq: (c: string, v: unknown) => filter((p) => `${ident(c)} <> ${p(v)}`),
      gt: (c: string, v: unknown) => filter((p) => `${ident(c)} > ${p(v)}`),
      in: (c: string, vs: readonly unknown[]) => filter((p) => `${ident(c)}::text = any(${p(vs.map(String))}::text[])`),
      is: (c: string, v: null | boolean) => filter(() => `${ident(c)} is ${v === null ? "null" : String(v)}`),
      not(c: string, operator: string, v: unknown) {
        if (operator !== "is" || v !== null) throw new Error(`rehearsal client: unsupported .not(${c}, ${operator})`);
        return filter(() => `${ident(c)} is not null`);
      },
      ilike: (c: string, pattern: string) => filter((p) => `${ident(c)} ilike ${p(pattern)}`),
      or() { throw new Error("rehearsal client: .or() is not supported"); },
      order(c: string, o?: { ascending?: boolean }) { order.push(`${ident(c)} ${o?.ascending === false ? "desc" : "asc"}`); return builder; },
      limit(n: number) { limit = n; return builder; },
      range(from: number, to: number) { offset = from; limit = to - from + 1; return builder; },
      single: () => one(true),
      maybeSingle: () => one(false),
      then<T>(ok: (v: Result) => T, bad?: (e: unknown) => T) { return run().then(ok, bad); },
    };
    return builder;
  }

  return {
    userId,
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from(table: string) {
      return {
        select: (cols?: string) => query(table, "select").select(cols),
        insert: (p: Row | Row[]) => query(table, "insert", p),
        upsert: (p: Row | Row[], o?: { onConflict?: string }) => query(table, "upsert", p, o),
        update: (p: Row) => query(table, "update", p),
        delete: () => query(table, "delete"),
      };
    },
    async rpc(fn: string, args: Record<string, unknown>): Promise<Result> {
      if (!/^[a-z_][a-z0-9_]*$/.test(fn)) return { data: null, error: { message: `bad function ${fn}` } };
      const keys = Object.keys(args);
      const params = keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
      try {
        const rows = await asUser(`select public.${fn}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(", ")}) as result`, params);
        return { data: rows[0]?.result ?? null, error: null };
      } catch (e) { return { data: null, error: pgError(e) }; }
    },
  };
}
export type RehearsalClient = ReturnType<typeof clientFor>;
