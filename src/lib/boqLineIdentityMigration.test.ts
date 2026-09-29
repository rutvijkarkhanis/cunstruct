import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Validate the boq_line identity migration ARTIFACT — additive, idempotent,
// and structurally correct for the NULL-scope semantics it must guarantee.
// No live Postgres is available in this environment (see boqAuditMigration
// .test.ts / scopeTaxonomy.test.ts for the same established pattern), so
// this reads and asserts against the raw SQL rather than exercising a real
// database; the application-side 23505 handling is exercised separately in
// boqLineIdentityConstraint.test.ts against a mock that simulates exactly
// the invariant this migration establishes.
const SQL = readFileSync(
  join(__dirname, "../../supabase/migrations/20260929000000_boq_line_identity_constraint.sql"),
  "utf8",
);
const sql = SQL.toLowerCase();

describe("boq_line identity migration — additive & idempotent", () => {
  it("creates both partial unique indexes idempotently", () => {
    expect(sql).toContain("create unique index if not exists boq_line_identity_scoped_idx");
    expect(sql).toContain("create unique index if not exists boq_line_identity_unscoped_idx");
  });

  it("scoped index covers (boq_id, external_key, scope_id) only when both are set", () => {
    expect(sql).toMatch(
      /create unique index if not exists boq_line_identity_scoped_idx\s+on public\.boq_line \(boq_id, external_key, scope_id\)\s+where external_key is not null and scope_id is not null/,
    );
  });

  it("unscoped index covers (boq_id, external_key) only when scope_id is null", () => {
    expect(sql).toMatch(
      /create unique index if not exists boq_line_identity_unscoped_idx\s+on public\.boq_line \(boq_id, external_key\)\s+where external_key is not null and scope_id is null/,
    );
  });

  it("excludes rows with no external_key from both indexes (no identity to protect)", () => {
    // Every WHERE clause in this file requires external_key is not null —
    // a manually-added line with no mark code is never constrained.
    const whereClauses = sql.match(/where external_key is not null[^;]*/g) ?? [];
    expect(whereClauses.length).toBe(2);
  });

  it("is additive only — never drops, deletes, truncates, or alters an existing column", () => {
    expect(sql).not.toMatch(/drop table|drop column|drop index|delete from|truncate|alter column/);
  });

  it("touches only boq_line, and only by adding indexes — no new table, no new column", () => {
    expect(sql).not.toMatch(/create table/);
    expect(sql).not.toMatch(/add column/);
    expect(sql).toContain("on public.boq_line");
  });
});
