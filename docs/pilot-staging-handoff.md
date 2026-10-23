# Pilot staging hand-off — staff estimator on a Vercel Preview backed by staging

**Scope.** The staff-estimator workbench on a Vercel Preview, backed by a separate staging Supabase project. Nothing here touches production `dkgjsobfljqoggalivzt`. Detail on migrations and SQL checks is in `docs/staging-validation-stage3-6.md`.

**Status.** No staging project exists yet, so every result so far is from the in-memory test mock (Playwright). No check below has been run against a real backend.

## A. Owner actions (each one needs owner access)

Run the shell commands on your own machine. This cloud container cannot reach Postgres on port 5432, and its network policy blocks `*.vercel.app`. Never paste a database password or a key into chat or logs. Every script here prints project refs only.

| # | Action (exact setting or command) | Expected | Stop if |
|---|---|---|---|
| 1 | Supabase dashboard → **New project** (separate from production). Note its 20-character ref. | A new ref, not `dkgjsobfljqoggalivzt` | You are about to use an existing project |
| 2 | In your checkout, copy `.env.staging.example` to `.env.staging.local` (git-ignored) and fill in `STAGING_SUPABASE_PROJECT_REF`, `STAGING_SUPABASE_URL` (`https://<ref>.supabase.co`), `STAGING_SUPABASE_PUBLISHABLE_KEY` and `STAGING_DB_URL`. Then run `npm run staging:check`. | `Staging target verified: <ref> (not production) · app config OK · database URL OK.` | Any `Refusing to use the staging target` line |
| 3 | Run `node scripts/staging-migrate.mjs --base`, then `node scripts/staging-migrate.mjs --base --apply --confirm-ref=<ref>`. | The dry run lists 45 files. The apply ends `All 45 base migrations applied to staging.` | `FAILED on <file>`. That file is rolled back; investigate before rerunning. |
| 4 | *Only for check 15 (revisions).* Run `node scripts/staging-migrate.mjs`, then `node scripts/staging-migrate.mjs --apply --confirm-ref=<ref>`. Then run the SQL in `docs/staging-validation-stage3-6.md` §3. | Six files, ending `All 6 Stage 3–6 migrations applied to staging.` In §3: `anon_exec` false and `auth_exec` true for both functions; revision tables SELECT only; the adoption table SELECT + INSERT only. | Any other policy or privilege. **Production does not have these six (R8 is open), so revisions on staging prove nothing about production.** |
| 4b | **Drawing fingerprints:** `npx supabase functions deploy ai-analysis --project-ref <staging-ref>`. Run it from your own machine, logged in with your own Supabase CLI. **Always pass `--project-ref`**: `supabase/config.toml` is pinned to production. Set no `OPENAI_API_KEY` on staging, so AI generation stays off. | Staging dashboard → Edge Functions lists `ai-analysis`. Opening Workspace → **Analyze Project** for a project shows no "Failed to send a request" error. | The deploy names any other project ref. Without this function, an imported take-off can never be applied (Apply stays blocked: "no record of which revision"). |
| 5 | DSR data, in the staging SQL editor. Run `select count(*) from public.dsr_item;`. Check `sha256sum docs/benchmarks/e3/proposed-dsr-correction.sql` = `ce4f1bbca4d46574771d9df20a93073a761d3319eafa53e85cdba70361dc338e`, run that file unchanged, then count again. | `2758` before, `3121` after, as in production since 2026-10-21 | The file raises an exception, or the counts differ |
| 6 | Users. Dashboard → Authentication → Users → **Add user** twice, with auto-confirm on: a staff user and an owner (non-staff) user. Then in the SQL editor: `insert into public.user_roles (user_id, role) select id, 'ops' from auth.users where email = '<staff email>';` | `select u.email, r.role from auth.users u left join public.user_roles r on r.user_id = u.id;` shows the staff user as `ops` and the owner user with no role | The owner user has `ops` or `admin` |
| 7 | Staging dashboard → Authentication → URL Configuration → **Redirect URLs**: add `https://cunstruct-git-*-whistleblower.vercel.app/**`. This is the preview host pattern seen on PR #208. | Password-reset and sign-up emails link back to the preview | Links open another site. Sign-in itself is email and password and needs no redirect. |
| 8 | **Prove the guard runs on Vercel before setting anything.** Authorise one push of `local/contractor-workspace` with no `STAGING_*` variables set for Preview. | The Preview build **fails** with `Vercel Preview build refused` | **The build succeeds.** The guard did not run (Vercel did not expose `VERCEL_ENV`/`VERCEL`). Delete that deployment, turn on "Automatically expose System Environment Variables", and repeat. |
| 9 | Vercel → Settings → Environment Variables, **Preview scope only**: `STAGING_SUPABASE_PROJECT_REF`, `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_PUBLISHABLE_KEY`, `VITE_CUNSTRUCT_WORKBENCH_PREVIEW=true`, `VITE_IS_APP_SUBDOMAIN=true`. Do not set `STAGING_DB_URL` in Vercel. Then **Redeploy** the preview. | The build succeeds | Any of these set for Production |
| 10 | **Verify the deployed target**, either way: (a) `node scripts/check-deployed-target.mjs https://<preview-host>/`, with `VERCEL_AUTOMATION_BYPASS_SECRET` exported in your shell if the preview is protected; it sends that value as a header and never prints it. (b) Open the preview with DevTools → Network, filter `supabase.co`, and sign in. | (a) `Target: non-production`, client URL `https://<staging-ref>.supabase.co`, workbench code present, exit 0. (b) Every request goes to `<staging-ref>.supabase.co`. | Any `dkgjsobfljqoggalivzt`, `Target: production` or `unverifiable`. Stop and delete the deployment. |
| 11 | Sign in on the preview at `/auth` as each user. | Staff reaches `/ops` and `/app/projects`; the owner user is sent to `/my-projects` | The owner user reaches `/app` or `/ops` |
| 12 | **Hand over the real-backend run.** Either run section B yourself, or give the session `*.vercel.app` and `<staging-ref>.supabase.co` under Network access → Allowed domains, plus the staff user's password as an environment secret. | — | — |
| 13 | **Cleanup after the pilot.** Delete or pause the staging project; remove the Preview variables; delete `.env.staging.local`; reset the staging database password. | — | — |

**Test data**, done as the staff user on the preview, not with owner access (`docs/pilot/estimator-guide.md` §2–3):
1. Ops → Projects → **Onboard project** `ZZ-STAGING fit-out`.
2. Open it in the workbench → **New BOQ**.
3. Upload a drawing named `ZZ-STAGING-plan.pdf` in Drawings.
4. Ops → the project → Workspace → **Analyze Project**. This computes the drawing fingerprint and runs no AI.
5. Review → **Import JSON**: paste `docs/samples/staging-analysis-sample.json` **with** `"source_drawing": { "sha256": "<the PDF's SHA-256>" }` added. It holds two measured items and one pending.
6. In the SQL editor, set the project's `owner_id` to the owner user.

**The acceptance run does all of this itself**, apart from the owner user (`e2e/acceptance`, staging mode):

```
ACCEPTANCE_MODE=staging ACCEPTANCE_BASE_URL=https://<preview-host>/ ACCEPTANCE_STAGING_REF=<ref> \
ACCEPTANCE_STAFF_EMAIL=<staff email> ACCEPTANCE_STAFF_PASSWORD=<from your password manager> \
ACCEPTANCE_DRAWING_PDF=/path/to/plan.pdf [VERCEL_AUTOMATION_BYPASS_SECRET=…] \
npx playwright test -c playwright.acceptance.config.ts
```

- It refuses to start unless the deployment's own JavaScript targets `<ref>` and no production project.
- It types the password without logging it, and records no traces.
- Its result file `acceptance-result.json` names the mode.
- The same journey runs against the mock in `npx playwright test`; that run is labelled "MOCK — not a backend acceptance run".

## B. Real-backend matrix (19 checks; all **not run**)

Mock evidence names the test in `e2e/workbenchPreview.spec.ts`. It shows what the interface sends and reads back from a store that applies the same filters. It does **not** show real Auth, RLS, constraints, triggers or durability.

For every check on staging, record who ran it, when, the staging ref, a screenshot, and the SQL read-back of the rows it changed. **Never mark a check passed from the mock.** In one run, the staging acceptance scenario covers checks 1, 4, 6, 10, 11, 12, 16 and 17 for the paths it takes.

| # | Check | Mock evidence (test) | Passes on staging when |
|---|---|---|---|
| 1 | Staff sign-in and workbench | "the workbench route is mounted, says it is a preview…" | A real session reaches `/app/projects/:id/workbench`; refresh and sign-out work |
| 2 | Non-staff refused | "the embedded review keeps the existing role restriction…" | The owner user is redirected; no workbench data loads |
| 3 | RLS denies owner writes | "writes the database refuses (row-level security) are reported…" | Direct REST writes with the owner's token to `boq_line`, `boq`, `boq_line_change_log` and `project_scope` are denied; the app says "not saved"; no undo step |
| 4 | Staff writes succeed | every write test | Inserts, updates and deletes succeed; `boq_line_change_log.changed_by` = the staff user's id |
| 5 | Stale writes refused | "a stale edit is refused…", "a stale rate edit, and a stale rate undo…", "renaming a BOQ is guarded…" | Two tabs: the stale tab's quantity, rate, include, remove, spec, status and rename writes change 0 rows |
| 6 | History recorded | "each line shows what changed and why…" | `boq_line_change_log` rows with field, old and new value, and user survive a reload; the History panel shows them |
| 7 | History failure compensated | "a save whose history record fails is put back…" | Optional: revoke INSERT on the history table (staging only); the edit is put back and no undo step is recorded |
| 8 | Add, remove and restore lines | "adding lines…", "removing a line asks first…" | Restore re-links history; the `line_removed` row holds the full line |
| 9 | Removal refused for linked records | "removal is refused when it would destroy linked records…" | A real `vendor_quotation` row blocks removal; "Exclude instead" works |
| 10 | Rates | "rates are edited in the BOQ through the audited path…" | Own rate saved and recorded; clearing it falls back to the DSR rate |
| 11 | Commercials | "commercials: the abstract shows what is persisted…", "commercial changes are undoable…" | Guarded on the real `boq.updated_at`; a concurrent change is not overwritten |
| 12 | Review → Apply | "Apply from the embedded review…", "a quantity corrected in review reaches the BOQ…", the estimator acceptance scenario | The imported sample (with `source_drawing`, after Analyze Project) applies; the corrected quantity has basis "…corrected in review" and a history row with `review_item_id`. Without `source_drawing`, Apply stays blocked. |
| 13 | Check flags removed reviewed lines | "Check flags a verified review quantity whose line was removed…" | Uses real `line_removed` rows |
| 14 | Status | "finalising and preparing a revision happen in the workbench…" | Compare-and-swap on the real `boq.status` |
| 15 | Revisions (needs step 4) | Same test as 14: freeze not simulated | `create_boq_commercial_revision` freezes and refuses a stale snapshot |
| 16 | Totals and exports agree | "pilot path: … the export states the totals the documents carry", "excluded and pending lines are treated the same…" | Real data: screen grand total = CSV grand total = PDF grand total; unpriced lines blank, never ₹0 |
| 17 | Projects and BOQs | "a project onboarded in Ops opens in the workbench…", "a new BOQ is created in the workbench…" | Real inserts into `projects`, `boq` and `project_scope` under RLS |
| 18 | Failed reads | "when the lines cannot be read, the BOQ says so and offers a retry…" | DevTools offline shows Retry, never an empty BOQ |
| 19 | Boundary | build matrix rows 12–13; `src/lib/stagingGuard.test.ts` | Steps 8–10 above: a refused build without staging; a staging target after |
