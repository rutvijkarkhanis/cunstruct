# Cunstruct Predictive Procurement Engine — Phase 1 Build Plan

The spec covers 15 modules and is sequenced over 8 weeks. I'll deliver it in 4 iterations. This first turn covers **Iteration 1** end-to-end; subsequent iterations require a "continue" from you.

## Architecture

- **Lovable Cloud** for database, auth, RLS, edge functions
- **Roles**: `contractor`, `site_engineer`, `ops`, `admin` (stored in `user_roles` table, never on profiles)
- **Ops dashboard** lives at `/ops/*` (gated to `ops` + `admin`)
- **Contractor portal** lives at `/portal/*` (read-only forecast view; WhatsApp is simulated as a preview card in ops)
- Existing storefront (`/`, `/products`, etc.) remains untouched

## Iteration 1 — Foundation (this turn)

**Database (migration)**
- `profiles`, `user_roles` + `app_role` enum + `has_role()` security-definer function
- `projects` (name, type, location, floors, area_sqft, current_stage_id, progress_pct, velocity_days_per_pct, scope, account_manager_id, onboarded_at)
- `stage_master` (16 stages seeded)
- `project_stages` (history: started_at, completed_at, velocity)
- `stage_updates` (project_id, stage_id, progress_pct, recorded_at, source, note)
- `stage_material_mapping` (stage_id, product_id, priority, qty_formula JSON, lead_time_days, reliability_score, trigger_offset_days, buffer_pct, notes)
- ALTER `product`: add `lead_time_days int`, `reliability_score numeric` (nullable)
- RLS: ops/admin full access; contractors see only projects they own

**Frontend**
- `/auth` — email/password + Google sign-in
- `/ops` — dashboard shell with sidebar (Projects, Stage Master, Mappings, Forecasts, Anomalies, Briefings)
- `/ops/projects` — list + onboarding wizard (5-question intake → creates project, seeds first `stage_updates` row)
- `/ops/projects/:id` — project detail with stage timeline + update log
- `/ops/stages` — view 16-stage master (read-only seeded data)
- `/ops/mappings` — CRUD for stage→product mappings, with SKU picker from existing `product` table
- Design follows existing navy/amber Cunstruct system

## Iteration 2 — Velocity + Lead Time + Forecast Engine

- Velocity calculation edge function (recalcs on every `stage_updates` insert)
- Lead time editor on product detail (ops only)
- `forecasts` + `forecast_items` tables
- "Generate Forecast" action on project → 7/14/30-day horizons
- Confidence scoring (5-factor weighted)
- Forecast dashboard with Proactive Order Rate metric (Module 10)

## Iteration 3 — Anomaly Detection + Weekly Briefing + Reservations

- Anomaly detection edge function (cron-eligible): stale updates, missed order triggers, velocity drops, low reliability
- Anomaly inbox in ops dashboard
- WhatsApp briefing card composer (Module 9) — formatted preview, approve → marks as sent, no real WhatsApp send
- `supplier_reservations` table + workflow (Not Contacted → Reserved → Ordered → Delivered)

## Iteration 4 — Accuracy Tracking + Copilot + Opportunity Gen

- `forecast_accuracy` table; predicted vs actual capture when orders flow in
- Quality metrics dashboard (forecast accuracy, lead time saved, on-time delivery)
- AI Copilot (Lovable AI Gateway, server-side) — Q&A over projects/forecasts
- One-click "Convert forecast to quotation" (Module 13)

## Out of scope for Phase 1 (per spec)

- Real WhatsApp send (Twilio) — simulated only
- AI photo recognition for stage updates
- BOQ import, price escalation, credit, auto-PO
- Multi-site portfolio view

## Notes

- North-star metric "Proactive Order Rate" shown on every ops screen header from Iteration 2 onward
- No automated WhatsApp sends until forecast accuracy ≥65% — enforced by keeping send button manual through Phase 1
- Will not touch existing storefront routes or `CartContext`

After Iteration 1 ships, reply "continue" (or steer differently) and I'll move on to Iteration 2.
