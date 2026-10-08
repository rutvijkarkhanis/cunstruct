-- BOQ AUDIT FINDING — SIGNAL KEY (PR #156). Gives an internal, deterministic
-- Finding producer (Coverage's generateCoverageSignals()) a way to persist
-- idempotently into the EXISTING boq_audit_finding table, without touching
-- the existing pasted-external-audit workflow (auditImport.ts's
-- importAuditRun()) at all.
--
-- boq_audit_finding today has NO identity/dedup mechanism of its own — every
-- import is a deliberate human paste, so two imports are always meant to be
-- two independent sets of rows, even if they happen to repeat a finding
-- (see auditImport.ts: a plain bulk `.insert()`, no uniqueness anywhere).
-- That is correct for a human-pasted audit and WRONG for Coverage: the same
-- deterministic (boq, document, normalized key) gap will be regenerated
-- every time the user re-runs analysis, reopens the project, or refreshes
-- readiness, and must resolve to the SAME logical finding every time — never
-- a fresh duplicate row, and never silently reopening/resetting a human's
-- prior Accept/Dismiss/Resolve/Keep-Pending decision on it (that decision
-- lives entirely on the one row this index lets Coverage find again).
--
-- signal_key is nullable and, for every existing/future human-pasted
-- finding, is simply never set (NULL forever) — those rows keep today's
-- exact behavior, no dedup, unconstrained. Only a row that sets a real
-- signal_key (today: only Coverage, via its own
-- `coverage¦${boqId}¦${documentId}¦${normalizedKey}` identity —
-- coverageSignals.ts's CoverageSignal.signalKey, verbatim) is constrained to
-- be globally unique.
--
-- This mirrors the EXACT existing precedent for this problem shape —
-- 20260929000000_boq_line_identity_constraint.sql's partial unique indexes
-- on boq_line, paired with insert-then-catch-23505 at the application layer
-- (src/lib/applyFinding.ts's isBoqLineIdentityConflict) rather than a
-- Supabase `.upsert()` — a bulk multi-row insert aborts entirely on a single
-- conflicting row, and `.upsert({onConflict})` cannot target a PARTIAL
-- unique index via PostgREST, only a full one (see boq_document's own full,
-- non-partial `unique(boq_id, document_id)` for the one case that works).
-- src/lib/auditImport.ts's persistCoverageFindings() therefore inserts one
-- candidate finding at a time and treats this exact index's 23505 as "this
-- signal already has a finding" — a no-op, never a fabricated success and
-- never an overwrite of the existing row's lifecycle state.
--
-- Purely additive: one nullable column, one partial index, no existing
-- column/row touched, no existing constraint altered.

alter table public.boq_audit_finding
  add column if not exists signal_key text;

create unique index if not exists boq_audit_finding_signal_key_idx
  on public.boq_audit_finding (signal_key)
  where signal_key is not null;
