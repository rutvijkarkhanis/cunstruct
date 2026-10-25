# Owner actions still outstanding (as of pilot-4)

**Status:** no staging project exists, and no real-backend check has run. Steps refer to `docs/pilot-staging-handoff.md` §A, which has the exact settings, expected results and stop conditions.

1. **Create the staging Supabase project and verify it from your checkout** (steps 1–2). `npm run staging:check` must say "Staging target verified".
2. **Apply the base migrations** to staging from your machine (step 3, 45 files). Optionally apply the six deferred ones (step 4), for the revision check only.
3. **Deploy `ai-analysis` to staging** (step 4b), with `--project-ref <staging-ref>`, no OpenAI key. *New in pilot-4:* without it, an imported take-off can never be applied.
4. **Run the DSR correction and create two users**, staff (`ops`) and owner (steps 5–6).
5. **Add the preview domain to staging Auth redirect URLs** (step 7).
6. **Authorise one push** of `local/contractor-workspace` with no staging variables for Preview. That build **must fail** with "Vercel Preview build refused" (step 8). Only you can authorise this push.
7. **Set the five Preview-only variables and redeploy, then verify the target** with `node scripts/check-deployed-target.mjs <preview-url>` (steps 9–10).
8. **Run the acceptance scenario in staging mode** (command in the handoff), or allow `*.vercel.app` and `<staging-ref>.supabase.co` in this environment's network settings and provide the staff password as a secret, so it can be run here (step 12).
9. **Decide the "Changed manually" wording.** It is shared with the deployed `workspace-share` edge function, so changing it needs your release decision. It is unchanged now.

**Not needed for the pilot:** contractor accounts, approvals, an OpenAI key, a Supabase personal access token in this environment, or any production change.
