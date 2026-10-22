---
title: "Cunstruct UX/UI Revamp Charter"
---

# Cunstruct UX/UI Revamp Charter

**Version:** 1.1 (owner-approved, frozen)  
**Status:** Owner-approved and frozen on 22 October 2026; repository installation is pending.  
**Date:** 22 October 2026  
**Supersedes:** v1.0 (22 October 2026, draft). See the revision history.  
**Intended repository location:** `docs/UX-UI-REVAMP-CHARTER.md` (§11.3)  
**Purpose:** Binding direction and scope boundaries for the UX/UI revamp of Cunstruct.

> **The goal is not to reskin historical screens. The goal is to make Cunstruct feel and behave like one deliberately designed construction-estimation product, while preserving the correctness and capabilities already built.**

This charter is the source of truth for the revamp. Audits, mockups, implementation plans and prompts must conform to it. New evidence can challenge a decision, but changing a locked decision requires explicit owner approval and a recorded revision of this charter.

## 1. Product north star

Cunstruct’s primary product experience is a single-user construction-estimation workbench. It helps the owner take a construction project from drawings to a trustworthy Bill of Quantities (BOQ), through quantity review and correction, rate entry and validation, to export.

The product must make complex work easier without making uncertain quantities appear more certain than they are.

The primary journey is:

1. Open or resume a project.

2. Inspect project drawings and their revisions.
3. Review extracted items against evidence: verify, correct, flag or leave unresolved as appropriate.

4. Edit and price the BOQ, keeping the meaning of quantity provenance and rate sources.

5. Check unresolved issues and drawing freshness.

6. Export an honest representation of the current saved BOQ and its limitations.

The system must support iterative expert work. The steps orient the owner; they must not force a rigid, one-way wizard. Going back to a drawing, returning to a BOQ line, resuming unfinished work and correcting a decision are normal activities, not exceptions.

## 2. The problem this revamp is meant to solve

The current platform shows successive product generations coexisting instead of converging. Prior repository inspection identified:

- Separate staff-facing /app and /ops shells and navigation systems.

- A guided project journey that hands work to the Ops-based review workstation and BOQ builder.

- A project workspace that mounts the review workstation in a takeover mode and hands BOQ editing to another screen.

- Multiple ways of representing progress and review state.

- Duplicate or overlapping BOQ interfaces, with different affordances and different feature coverage.

- Historical procurement and forecasting surfaces mixed into the daily estimation path.

- Independent UX defects, including misleading rate-source wording, disabled actions whose reasons are hard to discover, hidden undo/redo and a reported broken DSR-mapping route.

These are findings from a prior code-and-screenshot review, not a claim that every detail has been independently rechecked against the latest deployed build. The implementation phase must revalidate the relevant facts before acting on them.

The central failure is a lack of product coherence: internal historical boundaries are unnecessarily exposed to the owner. Visual polish alone will not fix that.

## 3. Locked product decisions

These decisions are the default constraints for all revamp work.

### 3.1 One canonical project experience

There must be one canonical project route hierarchy and one persistent project context. Project work must not require switching between the /app and /ops product shells.

A task may open a distinct specialist work surface, including a full-screen drawing-review workstation or BOQ editor, but it must stay inside the same coherent project experience. It must preserve the relevant project, BOQ, drawing, page, filter and review context, and provide a predictable way back.

One shell does not mean one giant screen. Specialist screens can have different layouts when their work demands it. They may not introduce a competing application identity, duplicate global navigation, or make the owner relearn where they are.

During the transition (§8.2), a hand-off from the canonical shell to an older surface is allowed only as a documented exception that preserves context and names the phase gate by which it will be removed.

### 3.2 Use the guided journey as structural input, not as a finished UI

The guided journey contains useful concepts: project-level sections, the selected BOQ in URL state, evidence links and honest export checks. Reuse those ideas where they are demonstrably sound.

Do not keep its current layouts, numbered steps or screen composition merely because it is newer. Redesign them against the task and the target architecture.

### 3.3 Preserve valuable engines; consolidate presentation

Reuse and protect established business logic where it is sound, especially:

- Guarded, auditable BOQ writes.

- Quantity edit rules and save-conflict handling.

- Undo/redo and removed-line recovery.

- BOQ commercial calculations, revisions and export logic.

- Drawing/revision freshness checks.

- Review decisions, evidence mapping and Apply semantics.

- Shared project, document and BOQ persistence.

Capability preservation is not limited to line-level editing. The Phase 0 capability inventory (§8.1) covers the full set of existing capabilities listed there.

A single user experience is not the same thing as one component, one data-fetching function or one monolithic implementation. Keep the code modular while making the experience coherent.

### 3.4 Estimation first; unrelated capabilities are not automatically deleted

The default signed-in destination for the owner should be the project index or workbench, not a procurement- forecasting dashboard or a contractor-facing view. This depends on the canonical route tree decided in Phase 0.

Forecasting, procurement, storefront and contractor-facing capabilities must be taken out of the primary estimation path unless there is evidence they are needed for the core journey. Their final disposition (a separate area, a separate product, frozen or retired) requires an explicit capability and dependency review. Do not delete them merely to make navigation look cleaner.

### 3.5 One meaningful vocabulary for each state

Use one agreed vocabulary across screens, statuses, counters, warnings and exports. At minimum, distinguish:

- Verified.

- Corrected. Use this term consistently; do not alternate with “Edited” to mean the same review outcome.

- Flagged. Pending / unresolved. Choose and document the precise distinction if both are needed.

- Assumed.

- Missing quantity.

- Unpriced / no rate.

- No DSR code / unmapped rate source.

- Excluded.

This vocabulary governs the labels shown in the interface and in exports. It does not require renaming stored database values (for example the review status EDITED); a schema change for vocabulary alone is out of scope (§6).

Do not imply a commercial decision has been made when the system merely lacks a DSR mapping. In particular, do not use “Priced separately” as a fallback label for an unmapped line unless it reflects a genuine, explicit user decision.

### 3.6 Evidence and uncertainty must remain honest

A number is not verified just because it is displayed in a polished table. Its state, basis and available source evidence must remain understandable.

Do not invent measurement provenance, classification, quantities, completion, freshness or export readiness. A missing or unresolvable source must be described honestly. Drawing freshness checks and guarded review/apply rules must not be weakened to make the interface feel smoother.

The existing unvalidated-draft disclosures on BOQ totals and exports ( src/lib/boqDraftDisclaimer.ts) are product-trust features. They must be retained, or replaced only by equally explicit wording that the owner has approved.

### 3.7 Design decisions must become actual UI

The revamp is not complete when someone writes recommendations, creates a design-system page or generates mockups. The implemented product must visibly express the approved design, and key interactions must work against real data paths, validated under §8.3.

## 4. Target architecture and information hierarchy

The target is a persistent project shell with focused specialist surfaces. The exact component boundaries remain an implementation decision. The canonical shell and route tree are decided in Phase 0 (§8.1). The user-facing hierarchy below is the product direction.

**Application level**

- Projects is the owner’s primary entry point.

- Administration and reference capabilities are secondary to the daily estimation task.

- Procurement storefront, forecasting and contractor functions must not compete with the core workbench in primary navigation.

**Project level**

A project has one identity and a persistent context. The owner should be able to move freely between these functional areas:

1. Status / Resume: where the project stands, what was last being worked on, the next useful action, source and revision currency, and actionable issues.

2. Drawings & Review: inspect drawings and revisions, move through review items, see evidence, make review decisions and apply them under the existing correctness rules.

3. BOQ: edit the working BOQ and its line-level properties, including quantity, description, unit, rate, inclusion, source/evidence, grouping and other supported capabilities.

4. Check & Export: understand what remains unresolved, what the export will state, which checks block an action and what can be exported now.

This is a functional hierarchy, not a requirement that every area be a tab or occupy one persistent screen. During the design slice, test whether Status and Check & Export work better as separate sections or as a single Status page with an export action. Resolve that with concrete task evidence and record the decision. Do not reintroduce multiple competing progress models.

**Specialist surfaces**

- Drawing inspection needs enough canvas area and clear revision and evidence context.

- BOQ editing needs a serious, information-dense editing surface, not a narrow dashboard card.

- Review needs fast movement through items, clear actionable controls and an obvious relationship between an item, its drawing evidence and the BOQ line it affects.

- Export needs explicit validation and trustworthy status.

A full-screen specialist surface is acceptable if it stays within the canonical project shell, keeps the project’s identity and context, and provides predictable navigation. A URL change by itself is not a problem; an unexplained shell change or lost context is.

## 5. UI and interaction standards

### 5.1 Visual direction

The intended visual character is precise, professional, calm and purpose-built for construction estimation, not a generic SaaS dashboard, marketing site or collection of cards.

The UI must have:

- Clear hierarchy and alignment.

- Deliberate typography and spacing.

- A restrained palette with consistent semantic states.

- Density suited to each task.

- A consistent pattern for headings, navigation, actions, tables, side panels, dialogs, status and feedback.

- Clear loading, empty, error, saving, saved and conflict states.

- No decorative metrics or cards that displace actual work.

Do not begin with a blind global component reskin. Establish the canonical screen structures and task hierarchy, then apply a coherent design system across them.

### 5.2 BOQ editing

The target is one primary line-editing experience with feature parity across supported line-level work. It must preserve, or deliberately redesign with equivalent capability:

- Description, quantity and unit editing.

- Rate entry, rate source and supported schedule-rate behaviour.

- Adding, removing, including and excluding lines.

- Grouping and sections, ordering, filtering and search.

- Amounts and commercial calculations.

- Evidence and quantity provenance.

- Visible undo/redo, with clear save and conflict feedback.

- Revision behaviour and all supported exports.

BOQ-level settings such as commercials, revision management or export configuration may use focused sheets, dialogs or separate specialist sections where appropriate. Do not cram every function into a single toolbar.

Long construction and DSR descriptions are essential data. Do not assume fixed 32–36 px rows or single-line inputs are appropriate. The prior review of the DSR snapshot reported a median description length of 288 characters, a 90th percentile of 780 characters, and 89% longer than one line. Revalidate these figures where they affect implementation, and design a legible way to inspect full descriptions without hiding necessary specification detail.

Do not adopt the engineering preview wholesale. Reuse only interaction patterns shown to be useful, then connect them to real guarded writes, save-conflict handling, undo/redo and actual data. The previous review found the preview was backed by fixtures and limited to quantity and rate editing, with no production persistence or undo.

Undo model. Decide the undo model (§11.4, decision 7) before locking the BOQ interaction design. Whatever model is chosen:

Compatible BOQ edits remain recoverable when the owner moves between the project’s surfaces within a session.

Undo never blindly applies a stale inverse edit after a conflicting change. A conflict is shown and resolved explicitly.

Durable change history ( boq_line_change_log) is an audit record. It must not be presented as, or confused with, an actual undo capability.

### 5.3 Drawing evidence and review

Evidence must be reachable from the relevant quantity and, where helpful, visible while editing. A selected review item must be recognisable by a human, not primarily by a raw machine ID.

Show why an action is disabled inline or in clearly associated text, not only in a browser tooltip. Surface keyboard shortcuts in the interface where they materially improve efficiency. Keep the existing source-freshness safeguards unless an explicitly reviewed, correctness-preserving replacement is approved.

Whether evidence appears in a resizable split pane, a contextual panel or a separate specialist surface is an open design question. Decide it through a real edit-with-evidence task, not aesthetic preference.

### 5.4 Interaction and accessibility

The target for the core workflow is WCAG 2.2 Level AA. Test real workflows for:

- keyboard operation and focus management;

- accessible names and states;

- target sizes;

- zoom and responsive behaviour;

- editing cancellation, save-conflict recovery and recovery from destructive actions.

Supported viewports are defined explicitly (§11.4, decision 8) and tested. Behaviour outside them is documented, not assumed.

Do not apply role="grid" as a styling shortcut. A spreadsheet-like interactive grid requires deliberate keyboard and focus management. Choose between an accessible table with editable controls and a fully interactive grid based on requirements and tested implementation cost.

### 5.5 Error, warning and export behaviour

Errors must say what failed, preserve work where possible and offer a useful recovery action. Export readiness must be based on actual saved state and actual checks. Never state that an export succeeded before it is produced, or silently drop unresolved limitations.

## 6. Scope boundaries

**In scope**

- Product and navigation architecture for the owner’s estimation workflow.

- Project index, project status/resume, drawings, quantity review, BOQ editing, and check and export experiences.

- Elimination of unnecessary shell changes and duplicate user-facing editors. The visual design system and component behaviour required by the canonical workbench.

- State vocabulary, source/evidence clarity, status accuracy and interaction recovery.

- Responsive behaviour and accessibility of the core workflow, within the supported viewports.

- Reconciling existing functionality before old surfaces are retired.

**Out of scope unless separately approved**

- New AI integration or new drawing-analysis capability.

- New procurement, forecasting, WhatsApp or supplier workflows.

- Database redesign, schema changes, migrations, production data changes, or changes to RLS, auth or security. This includes applying the deferred migrations that unavailable capabilities depend on (§8.1).

- Broad refactoring of business logic unrelated to the user-facing revamp.

- Rewriting reliable BOQ calculation, save, revision or export logic merely to fit a new component architecture.

- Deleting the storefront, contractor views, forecasting tools, user data or production routes just to simplify navigation. A large-scale “big bang” replacement of multiple functional surfaces at once.

A defect that prevents the approved core workflow may be fixed within scope, provided its cause, impact and tests are documented.

## 7. Required investigation before retiring any surface

Every screen or capability proposed for retirement must be traced through:

1. Routes and entry points.

2. User-visible actions and less obvious actions (menus, shortcuts, dialogs and deep links).

3. Business-logic functions and validation rules.

4. Persistence, data relationships and write guards.

5. Undo/redo, conflict, revision and export behaviour.

6. The tests that currently protect each capability, inventoried against the current source, and current production evidence.

7. An explicit replacement for every valuable capability.

Assign each item one disposition: KEEP, CONSOLIDATE, RELOCATE, RETIRE or INVESTIGATE.

“Not visible in the main navigation” is not sufficient evidence that something is dead.

“It writes to the same table” is not sufficient evidence that two screens are functionally equivalent.

Keep compatibility routes only where they are useful; they must not preserve an obsolete visible journey indefinitely. Retirement happens after demonstrated capability parity, including ported test coverage (§8.6), and the owner’s approval of the disposition. It is never an incidental part of a UI redesign.

## 8. Delivery sequence and acceptance gates

Work in small, verifiable slices. Do not redesign every screen before validating the product architecture.

### 8.1 Phase 0: Freeze the architecture and inventory

Deliver the following. Distinguish observed facts, inferences and unknowns. Do not change application code in this phase.

1. A verified route and shell map of the current product.

2. The canonical shell and route tree: which existing project shell is evolved, its URL structure, the owner’s signed-in landing route, and the compatibility redirects for superseded routes.

3. A capability inventory and matrix covering project, documents, folders, revisions, analysis, Identify, BOQ management, line-level BOQ editing, Make, Materials, client presentation, DSR checks, sharing, commercial functionality and exports. For each capability, record:

   - its current owning component(s);
   - its persistence functions;
   - the tests that currently protect it;
   - whether it works in production.

Capabilities that depend on migrations not applied in production (for example DSR mapping, rate adoption, vendor quotations and commercial revisions) are marked unavailable. They are not presented as functional, not treated as parity requirements, and their future status remains an explicit owner decision.

4. A disposition table (§7).

5. A usage record and baseline: which existing surfaces the owner actually uses, and a baseline of the Phase 2 slice task on the current UI. Capture elapsed time, shell transitions, context loss, interaction steps and errors wherever these can be observed reliably.

6. The supported viewports (§11.4, decision 8).

**Gate: the owner approves the canonical shell and route tree, the capability inventory and the major retire/consolidate decisions.**

### 8.2 Transition rule

Once Phase 0 has selected the canonical shell and route tree, that architecture is evolved in place. No further parallel shell is introduced.

Whenever a task reaches parity in the canonical shell, its superseded entry points are redirected or hidden in the same phase. Retirement of the superseded interface is then proposed under §7.

Any remaining hand-off to an older surface is a temporary exception, governed as follows:

- **Recorded.** Each exception is recorded with its reason, its user impact, and the specific phase gate (for example, the Phase 3 gate) by which it will be removed. It must preserve context while it exists.

- **Blocking.** That phase gate cannot pass while the exception remains unresolved.

- **Carried forward only with approval.** Carrying an exception past its removal gate requires the owner’s explicit approval. The reason, the impact and the revised removal gate are recorded with the approval.

### 8.3 Validation environment

Production is the only live environment. Real-data validation therefore follows these rules:

- **Ownership of live checks.** Live visual checks are performed and approved by the owner (Rutvij Karkhanis), in the owner’s own authenticated session.

- **Explicit authorisation for the specific task.** No agent creates sessions, signs in, re-enables accounts or performs any production action without the owner’s explicit authorisation for that specific task. Authorisation for one task does not carry over to another.

- **Production test scope.** Production testing is limited to the designated test project (currently ZZ-TEST). Each production test is narrowly scoped and reversible, and its state is verified before and after.

- **Reversal is planned, not assumed.** Before a production test runs, its reversal method is stated and shown to be sound for that specific operation. The application’s undo is used only where it demonstrably reverses that operation; it is not treated as a universal rollback mechanism. Operations that cannot be reliably reversed are not performed in production.

- **Persistence testing.** Uses the local Postgres migration rehearsal (`scripts/migration-rehearsal`) where appropriate. It is evidence for persistence behaviour, not for visual or session behaviour.

### 8.4 Phase 1: Fix independent trust and usability defects

Address independently verified defects, such as:

- misleading rate-source labels;

- inconsistent state vocabulary;

- hidden explanations for disabled actions;

- hard-to-discover undo/redo;

- broken links.

Recheck each one against the current code and production schema before modifying it. Keep these fixes narrow. The landing-route change (§3.4) follows the Phase 0 route tree.

For links to capabilities that are unavailable because their required migrations are not applied in production, remove or hide the misleading entry point where appropriate; do not attempt to restore the capability by applying migrations or changing the production schema under this charter.

**Gate: specific tests or reproducible steps show each defect is corrected, with no unrelated behaviour changes.**

### 8.5 Phase 2: Build the canonical shell and one complete vertical slice

Implement the canonical project shell (by evolving the shell chosen in Phase 0) and prove this task end to end:

Open a project → find a quantity → inspect its drawing evidence → correct the quantity and rate → undo/redo or recover from a save conflict → check the resulting saved BOQ and export state.

The undo model (§5.2) is decided before the BOQ interaction design is locked.

The task must not hand the owner over to a competing application shell.

Keep the real guarded business logic.

The slice is exercised against real data under §8.3. Screenshots or fixture-only prototypes do not count as functional validation.

**Gate:**

- capability parity for the operations exercised, with their protective tests retained or ported;

- verified preservation of project, BOQ and drawing context;

- passing focused tests;

- comparison against the Phase 0 baseline;

- the owner’s review of the rendered UI.

### 8.6 Phase 3: Consolidate BOQ editing

Expand line-editor capability only after the first slice is sound. Use the parity matrix to verify:

- rates and schedule-rate behaviour;

- add/remove and include/exclude;

- grouping;

- commercials;

- revisions and status;

- conflicts and undo/redo;

- export.

Preserve long specification text and provenance.

Test parity is established against the current source. Historical test counts are a dated snapshot, not a permanent requirement. The behavioural coverage that protects each capability must be preserved or ported before any existing interface is retired.

**Gate: all required capabilities are implemented or explicitly marked out of scope; their protective tests pass in the canonical editor; automated and manual regression checks pass.**

### 8.7 Phase 4: Consolidate drawing review and export checks

Unify state vocabulary and navigation. Integrate drawing/review and BOQ context while keeping the freshness guards and accurate export limitations.

**Gate: review decisions affect the correct saved BOQ rows; superseded drawings cannot silently pass freshness checks; exports reflect current saved data.**

### 8.8 Phase 5: Retire superseded surfaces and complete the visual system

Remove the obsolete visible routes and shells that the owner has approved for retirement and that §8.2 has not already redirected. Apply and validate the design system across all retained surfaces.

**Gate:**

- no capability lost and no deep link broken;

- no temporary exception from §8.2 remains open;

- the canonical workflow has no unnecessary cross-shell transition;

- retained screens share a coherent interaction and visual system.

## 9. Definition of done

The revamp is not done just because the new shell is live or the screens look consistent.

The core experience must demonstrate all of the following:

- There is one obvious starting point for estimation projects.

- A project has one persistent identity and context across all retained work surfaces.

- The owner can move from a quantity to its drawing evidence and back without losing meaningful context.

- The principal BOQ line-level operations exist in one coherent editing experience.

- Review states, quantity provenance and rate-source meanings are consistent across screens and exports.

- No uncertain quantity is silently presented as verified, and the draft disclosures are retained (§3.6). Save, conflict, undo/redo, revision freshness and export limitations are explicit and trustworthy.

- Long construction descriptions can be inspected without losing critical details.

- Keyboard and responsive behaviour are intentionally designed and tested to WCAG 2.2 AA within the supported viewports.

- Every retired capability has a replacement or has been explicitly approved for retirement.

- Compared with the Phase 0 baseline, the first vertical slice shows less navigation overhead without regressions in business logic.

- The actual rendered interface, not just the design file, has been reviewed against real tasks.

Where useful, collect before/after measures on the owner’s real work against the Phase 0 baseline: time to find and correct a line, shell changes, context loss, repeated actions, save errors and confidence that the exported quantity is properly sourced. Do not invent quantitative targets before a baseline exists.

## 10. Rules for Claude and any implementation agent

1. Read this charter before every revamp task. State which charter section the task serves.

2. Inspect before changing. Revalidate current main, the relevant production behaviour (only under §8.3, through

the owner’s own session or with explicit authorisation for the specific task) and the affected code. Do not rely on old screenshots as current evidence.

3. No opportunistic scope expansion. Do not add features, perform unrelated refactors or redesign unrelated

product surfaces within a task.

4. No additive-by-default UX. New user-facing screens need an explicit place in the canonical architecture and a

disposition for any screen they supersede. Follow the transition rule (§8.2).

5. No destructive simplification. Do not retire routes, components or capabilities before tracing dependencies and

demonstrating parity, including test coverage.

6. Preserve business correctness. Avoid changes to persistence, calculations, guarded writes, drawing freshness

and export logic unless they are required and specifically scoped.

7. No mock-only proof. A mockup can establish design intent but cannot prove that the workflow is implemented

or functionally equivalent.

8. Be exact about evidence. Separate code-confirmed, visually confirmed, production-verified and inferred

findings. Never claim a screen was inspected if it was not.

9. Validate the actual task. Every UI slice needs reproducible acceptance criteria, focused tests and an inspection

of the rendered interface.

10. Protect working state. Do not switch or reset the owner’s checkout, discard work, make production changes or

deploy without explicit authorisation. No database, schema, auth or security changes as part of this charter. Production validation follows §8.3; never create sessions, sign in or re-enable accounts without explicit authorisation for the specific task.

11. Report deviations. If a task appears to require changing a locked decision, stop and present the evidence,

alternatives and consequences for owner approval, instead of silently rewriting the charter.

12. End each implementation report with: what changed, what was tested, what remains unverified, any

capability-parity gaps, and the single highest-priority next step.

## 11. Change control for this frozen charter

### 11.1 Status

This document is frozen as the revamp’s governing direction once the owner approves it.

- Implementation plans, PRs and design files must be consistent with it.

- A discovery may show that a detail needs to change. Document the evidence and proposed amendment; do not silently reinterpret the charter.

- Changes to the product north star, the canonical project architecture, scope boundaries, correctness safeguards or the retirement policy require explicit owner approval.

- The agent may make minor implementation decisions if they preserve the charter, are reversible and are justified by evidence.

### 11.2 Relationship to other governing documents

- docs/PLAN-OF-RECORD-v1.2.md: on UX/UI matters, this charter governs where the two conflict. The plan’s evidence requirements and release gates are unchanged. Revamp work does not count as acceptance of any commercial B-series item.

- CLAUDE.md: its product description (“a procurement forecasting platform”) is outdated. It is to be updated to the §1 north star, with a pointer to this charter. PR #204 (plan v1.3 limited-launch draft): superseded by the single-user product direction, and to be marked as such.

These two updates are separate actions, each requiring explicit owner authorisation. Approving this charter does not perform them.

### 11.3 Repository source of truth and version history

Once approved and frozen, this charter lives at docs/UX-UI-REVAMP-CHARTER.md, which is the repository’s source of truth for the revamp. Changes are made only through reviewed PRs that update the version number and the revision history below. Historical rationale is never overwritten without recording what changed and why.

### 11.4 Open decisions permitted by this charter

These are deliberately left open to evidence. They are closed during Phase 0 or Phase 2, not decided by taste:

1. Whether Status and Check & Export are separate project sections, or one status page with export actions.

2. Whether evidence should default to a resizable split pane, a contextual pane or a separate review surface for

each task.

3. Whether the production BOQ editor should use an accessible native table with editable cells or a fully

interactive grid.

4. Which operations/reference, procurement, forecasting, contractor and storefront capabilities are genuinely still

required, and where retained capabilities should live.

5. The source of the observed poor item classification: the analysis output, the display logic, or both.

6. Whether review Apply should remain gated on a decision for every item. Do not alter this business rule without

explicit owner approval.

7. The undo model: per surface, per BOQ session across surfaces, or another design. It must meet the constraints in

§5.2 and is decided before the BOQ interaction design is locked.

8. The supported viewports (for example, desktop as the primary target, plus any tablet or phone support and its

scope). Decided in Phase 0 and tested.

9. The future status of capabilities marked unavailable because they depend on unapplied production migrations.

These open choices do not permit a second competing project shell or unbounded scope expansion.

## 12. Approval record

| Field | Value |
|---|---|
| Owner approval | Approved — final owner sign-off on 22 October 2026 |
| Canonical architecture | Persistent project shell with focused specialist work surfaces, derived from the useful structure of the guided journey and the proven capabilities of existing engines. The specific shell and route tree are decided in Phase 0. |
| First validation slice | Correct and price a quantity while inspecting its source, then verify recovery and the saved/export state, without leaving the canonical project experience. |
| Live visual checks performed by | The owner (Rutvij Karkhanis), in the owner’s own authenticated session |
| Live visual checks approved by | The owner (Rutvij Karkhanis) |
| Production test project | ZZ-TEST, with explicit authorisation for each specific task (§8.3) |
| Frozen version | 1.1, owner-approved and frozen; repository installation at `docs/UX-UI-REVAMP-CHARTER.md` is pending the review PR. |
| Separate authorised actions | `CLAUDE.md` product description update is included in the installation PR; PR #204 supersession is tracked separately. |

## Revision history

| Version | Date | Change |
|---|---|---|
| 1.0 | 22 Oct 2026 | Initial draft. |
| 1.1 | 22 Oct 2026 | Owner-approved review amendments E1–E7 and O1–O5: governance relationship (§11.2); production validation environment (§8.3); transition rule and Phase 0 shell/route-tree decision (§8.1–8.2); test-parity inventory (§7, §8.1, §8.6); usage record and baseline (§8.1, §9); full capability inventory with unavailable-migration rule (§3.3, §8.1); undo model constraints (§5.2, §11.4); vocabulary vs stored values (§3.5); WCAG 2.2 AA and supported viewports (§5.4, §11.4); repository location and version control (§11.3); retention of draft disclosures (§3.6). |
| 1.1 (final amendments) | 22 Oct 2026 | Pre-sign-off amendments: production validation owned by the owner in the owner’s own session, with task-specific authorisation and planned (not undo-assumed) reversal (§8.3, §10, §12); transition exceptions bound to a named phase gate that cannot pass while they are open, with owner-approved carry-forward (§3.1, §8.2). |
| 1.1 (final clarification) | 22 Oct 2026 | §8.4 (Phase 1): added the rule that links to capabilities unavailable because their required migrations are not applied in production are removed or hidden where appropriate, and that such capabilities are not restored by applying migrations or changing the production schema under this charter. No other change. |
| 1.1 (owner sign-off) | 22 Oct 2026 | Owner approved and froze v1.1 as the governing UX/UI revamp direction; the repository source-of-truth installation proceeds through a reviewed PR. |