# Limited-launch rollback and support runbook

**Status: prepared; owner/contact confirmation still required.** This runbook supports v1.3's L7 only. It is not a launch approval and does not make v1.3 effective.

## 1. Deployment references checked on 22 Oct 2026

Verified via the Vercel deployment read API. Re-check the latest Production deployment immediately before any limited launch.

| Role | Deployment | Git commit | State | URL |
|---|---|---|---|---|
| Current Production at time checked | `dpl_C6L7cWwj97tNjBuNeL6kWrNrUGuN` | `ed09dc25d96a904100d9d46858a430f1efa30de8` | READY | [Inspect deployment](https://vercel.com/whistleblower/cunstruct/C6L7cWwj97tNjBuNeL6kWrNrUGuN) · [deployment URL](https://cunstruct-aevyjycj4-whistleblower.vercel.app) |
| Previous Ready Production rollback candidate | `dpl_CGCTfg5PVvfcpC8dCcx2XKRePUpp` | `ec41c693fd61336bb40a221292725602c25e0135` | READY | [Inspect rollback candidate](https://vercel.com/whistleblower/cunstruct/CGCTfg5PVvfcpC8dCcx2XKRePUpp) · [deployment URL](https://cunstruct-b3o1c6xhi-whistleblower.vercel.app) |

The rollback target is a **candidate**, not a promise that every later feature exists in that deployment. Before a launch, the operator must open the deployment details and confirm that promoting it is an acceptable recovery for the current release. Do not invent an alias or assume the production alias is still attached to this exact deployment.

## 2. Named incident contact — required before launch

- **Primary incident contact:** `[OWNER TO FILL: name]`
- **Contact method:** `[OWNER TO FILL: phone or email]`
- **Coverage / availability:** `[OWNER TO FILL]`
- **Backup contact, if any:** `[OWNER TO FILL or N/A]`

This placeholder is deliberately not treated as complete. L7 stays open until the contact is named and invited users know where to report an incident.

## 3. No new database migration in the limited-launch change

The limited-launch code change covered by L3 must not include:
- a new Supabase migration or deferred migration;
- schema changes or database writes introduced for the launch warning;
- production configuration or secret changes.

Before release, compare the release diff against `supabase/migrations/` and `supabase/deferred-migrations/`. If either contains a launch-related change, stop and review the database plan separately. This runbook does not authorise any migration or production data change. Existing production history is not rolled back by promoting an older frontend deployment.

## 4. Incident triggers

Treat any of the following as a stop-use incident:
- a quantity appears to be shown as established when it is still pending or unverified;
- an amount or total is inconsistent with the displayed quantity state;
- an export omits its draft/unvalidated warning;
- a share link exposes another project's information or otherwise appears to cross a project boundary;
- users cannot open the workspace or export the BOQ during the limited launch.

## 5. Immediate response

1. **Stop use:** tell affected users not to submit, order from, or treat the affected output as final. All quantities and rates remain drafts to be checked by a qualified construction professional.
2. **Capture minimal evidence:** time and timezone, release commit/deployment ID, route or export format, expected versus observed behaviour, and a redacted screenshot if useful. Do not paste share tokens, credentials, private drawings, or identifiable project content into a public issue.
3. **Notify the named incident contact** from section 2. If no contact is recorded, the limited launch is not ready to start.
4. **Triage:** determine whether the problem is confined to an output, or suggests a privacy/security issue or incorrect persisted data. For suspected cross-project access or data exposure, stop sharing affected links immediately and escalate to the owner/operator before further investigation.
5. **Decide recovery:** if a new frontend deployment is the cause and the candidate in section 1 is acceptable, use Vercel's deployment interface to promote that prior Ready deployment. Verify the new Production state and the affected path after rollback. The person performing the rollback must have authorised Vercel access.
6. **Database incidents:** do not attempt to reverse data with a frontend rollback. Do not run compensating SQL or migrations under this runbook. Preserve evidence and obtain the separate required approval and recovery procedure.
7. **Closeout:** record the incident, affected deployment, user notification, recovery decision, and follow-up work. Do not describe it as resolved until the affected behaviour has been verified.

## 6. Pre-launch checklist

- [ ] Current `main` has a Ready Production deployment and no newer failed deployment.
- [ ] Current release has no unapproved migration, production data change, or configuration change.
- [ ] The previous Ready Production deployment is still available and has been reviewed as a usable rollback candidate.
- [ ] The incident contact and contact method in section 2 are filled in.
- [ ] Invited users have accepted the limited-launch terms and know how to report issues.
- [ ] The signed v1.3 decision exists and L1–L7 have passed.

**Do not launch on the basis of this document alone.** An incomplete checkbox or placeholder means the related gate remains open.
