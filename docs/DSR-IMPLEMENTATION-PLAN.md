# DSR Intelligence: What Is Built, and What Is Not

Branch `feat/app-journey`, uncommitted working tree, 16 Oct 2026; matching, spill-over and decision concurrency revised 17 Oct 2026 (§3a, §5). This document describes the code as it is, not intentions. Where something is not built, it says so.

Evidence labels:
- **[TEST-REAL-DSR]**: Vitest against the real DSR 2023 schedule, parsed from `supabase/migrations/20260731001000_dsr_seed_civil.sql` (2,758 items).
- **[TEST-MEM]**: Vitest against an in-memory database (real store code, no network).
- **[NOT RUN]**: not exercised against staging or production.

---

## 1. Where it sits in the journey

Project & Drawings → Review Quantities → Build BOQ → **Check & finalise** → Export.

The schedule check is a section on the existing Check & finalise step (`src/pages/app/ProjectExport.tsx`, `mode="check"`), rendered by `src/components/app/DsrCheckSection.tsx`. There is no second workflow:
- Accepted work appears in Build BOQ as pending lines.
- It is counted in the same "Quantity pending" total.
- It is exported in the same "pending quantification" section.
- It is frozen into revisions by the same snapshot code.

The schedule is the BOQ's own `boq.rate_year` (`DSR <year>`). If that schedule is not loaded in `dsr_item`, the section says so, and matches and rates are not assumed.

## 2. Modules

| File | Role |
|---|---|
| `src/lib/dsr/catalogue.ts` | Pure helpers over `dsr_item` rows: unit aliases and comparison, text normalisation and synonyms, specification features, exclusion clauses, measurement wording, and seed clean-up. |
| `src/lib/dsr/match.ts` | BOQ line → schedule item matching, with a verdict and reasons. |
| `src/lib/dsr/scope.ts` | Missing-scope suggestions (the reliable subset only). |
| `src/lib/dsr/scopeStore.ts` | Persistence: decisions, Accept (pending lines), the audited schedule rate, and paged schedule loading. |
| `src/components/app/DsrCheckSection.tsx` | The UI in Check & finalise. |
| `src/lib/dsr/seedFixture.ts` | Test-only: reads the real seed migration as the test catalogue. |
| `src/lib/boqSpecWrite.ts` | The one guarded way to change keys of `boq.spec` (used by the DSR decisions and by the builder's commercials). See §5. |

## 3. Matching (B1)

`matchLine(line, buildDsrIndex(items, "DSR", year))` searches **one schedule version only**. Items from other sources or years are never considered.

**Code first.**
- If the line has a `dsr_code` and it is in the selected schedule:
  - **reliable** when the unit is identical and there is no specification conflict;
  - **possible** otherwise, stating the unit or specification conflict, or a description that shares little with the coded item.
- A code not in the schedule is reported ("not an item in DSR 2023"), and the description is matched instead.

**Description.**
- Candidates: an item is considered only if it shares at least two of the line's distinctive terms (or the only one, for a one-term line), and at least one of them is in the item's headline or variant. This was added after the real-data run (§9): "Window type 1" was matching a casement window fastener, and "External Door" a GFRG panel item.
- Scoring:
  - IDF-weighted share of the line's distinctive terms found in the item;
  - weighted 60/40 between the whole description and the item's headline plus variant (the part after "—").
- Ranking penalises unit mismatches and specification conflicts.
- Verdicts:
  - **reliable**: score ≥ 0.6, identical unit, no specification conflict, a lead of ≥ 0.1 over every other candidate with no more conflicts, **and** (added 17 Oct, §3a):
    - the line's most distinctive term is in the item;
    - coverage ≥ 0.85 (the line's description is essentially all in the item);
    - when the item is one variant of a family (same text before "—"), the line names that variant;
    - the item is not a seed row holding several sub-items under one code and rate;
  - **possible**: score ≥ 0.35;
  - **none**: anything below that.
- **Ambiguous** when any other candidate is within 0.1 and has no more conflicts (all candidates are checked, not only the runner-up). The items named in the reason are exactly the ones listed, and none is chosen.
- **"Extra for …" / "Add for …" / "Deduct for …" items** (155 in the seed, plus "— Extra for …" variants) adjust another item's rate. They are candidates only when the line itself says extra/add/deduct.
- **Labels and single words.** "type 1", "mark W2" are removed before matching. A line left with one distinctive term ("window", "plastering") is **none**: one word does not identify an item.
- **Terms the schedule never uses** are named: "DSR 2023 never uses: sprinkler, heads — this work may not be in this schedule".
- Tags and sizes the schedule never uses ("D1", "900x2100") are left out of matching. Sizes are still compared as specification features.
- **Absent coverage**: if the best item lacks the line's most distinctive term and something else also fails, the verdict is "none". "Something else" means a unit or specification conflict, a term the schedule never uses, or coverage below 50%. Example: "Solar panel installation" → none.

**Units.**
- Aliases only (Nos → each, m2 → sqm, …).
- Same dimension but a different unit (sqft vs sqm, cft vs cum) is reported as **convertible**: "a stated conversion is needed — none is assumed". It never counts as a match.
- "pair" is kept apart from "each".

**Specification.**
- Mix ratio, concrete grade, thickness, diameter and **concrete type** (plain vs reinforced, read from the item's headline and variant only) are compared.
- A conflict is reported only when **both** sides state the feature and share no value. "M20" against a nominal-mix item is not a conflict and not a match; it stays ambiguous.

**Tests** (`src/lib/dsr/match.test.ts`, 36 tests; the table lists the original cases, §3a the regressions) [TEST-REAL-DSR]:

| Case | Example | Result |
|---|---|---|
| Exact code | 5.1.3 | reliable |
| Code with wrong unit | 5.1.3 in sqm | possible, conflict stated |
| Code with mix conflict | 5.1.3 for 1:1.5:3 | possible |
| Code not in schedule | 99.9 | reported, then matched by description |
| Near match, different wording | earthwork in trenches | 2.8.1, reliable |
| Unit decides (variant named) | anti-termite treatment of soil under existing floors, sqm | 2.35.3.1, reliable (the bare "Anti-termite treatment" is now possible, §3a) |
| Wrong unit by description | — | possible |
| Convertible unit | cft vs cum | possible, never reliable |
| Specification mismatch | 12 mm plaster vs the schedule's 15 mm | possible |
| Ambiguous | formwork for columns | lists 4.3.3, 5.9.x |
| Tags and sizes the schedule never uses | "Door D1 900x2100 flush door" | flush door shutters, unit mismatch |
| Absent coverage | solar, or an empty description | none |
| Thin lines from the real project BOQ | "Window type 1", "External Door" | none, "does not describe the work enough" |
| Work the schedule has no word for | "Fire Sprinkler Heads" | none, "never uses: sprinkler" |
| Other schedule version | — | no items, none |

### 3a. Probe of residential civil BOQ wording (17 Oct) [TEST-REAL-DSR]

46 representative lines (excavation, PCC, RCC by element, brickwork, plaster, flooring, painting, waterproofing, doors/windows, steel) were matched against the real seed. Wrong or unexplained verdicts found, each fixed and regression-tested in `match.test.ts` ("representative residential BOQ lines (regressions)"):

| Line | Before | Cause | Now |
|---|---|---|---|
| AAC block masonry 200 mm thick | reliable 6.5 "Extra for brick work / AAC … above floor V" | add-on items were candidates | not reliable; 6.5 not offered |
| Aluminium sliding windows | reliable 9.147 (uPVC) | text of 9.147.A1 ("sliding window with Aluminium channel") spilled into 9.147 | not reliable; 9.147 not top |
| uPVC window | reliable 9.147 | 9.147 holds sub-items 9.147.A1, 9.147.A1.1 under one rate | possible; reason names the sub-items |
| Centering and shuttering for slab | (after the plural fix) reliable 5.9.16.2 "Edges of slabs" | line does not name the variant | possible; reason quotes the variant |
| Enamel paint on steel work | reliable 13.53.1 (painting on G.S. sheet) | "steel" only from "steel primer" | possible; variant reason |
| 6 mm cement plaster 1:3 to ceiling | reliable 13.16.1 while saying "ceiling" was missing | missing key term allowed | possible; reason consistent |
| Anti-termite treatment (sqm) | reliable 2.35.3.1 | the only sqm item is POST-constructional treatment under EXISTING floors | possible; the existing test now uses "… of soil under existing floors" for the reliable case and a new test pins the bare line as possible |
| Earthwork in excavation … | "DSR 2023 never uses: earthwork" (false) | spelling | "earth work"; 2.8.1 listed |
| Ceramic glazed wall tiles dado | reliable, but "Not in the item: dado" (false — item says "dados") | plurals | reliable 8.31, nothing missing |
| RCC in footings M20 | top 4.20.1.3 (PLAIN concrete), no conflict stated | plain/reinforced not compared | "concrete type" conflict stated |
| Plain cement concrete 1:2:4 in sunshade | top 26.60 (waterproofing of RCC sunshade) | same | 4.1.x on top |
| Window type 1 | possible (after the plural fix) | "type" counted as a term | none, "“window” alone does not identify an item" |
| 12 mm plaster … ambiguous list | listed a 15 mm item with a conflict as "about equally well" | close list ignored conflicts | close list = items with no more conflicts |

A cross-check test asserts, over 21 of the probe lines, that a reliable verdict never carries a unit/spec issue, an ambiguity, a missing key term, a variant or merged-row reason, and that an ambiguous verdict lists exactly the items its reason names.

Still reliable in the probe and judged correct: TMT bars Fe-500D → 5.22.6; structural steel in trusses → 10.2; ceramic dado → 8.31; integral cement waterproofing on roof → 22.7.1.

**Still imperfect (not fixed, stated):**
- "Waterproofing treatment to terrace" → reliable 22.7.1 (integral cement based). The line does not say which system; 22.7.1 is the one item naming terraces.
- "Reinforcement steel TMT …" → reliable 5.22.6 (*up to plinth level*). The line does not say the level; the above-plinth TMT text sits inside merged row 5.22A and is not matchable.
- Typical residential wording such as "IPS flooring", "Stair railing MS", "Backfilling" gets none or a weak match: the schedule uses other words. No synonyms were invented for them.

**Seed data defect found.**
- A few dozen seed descriptions carry PDF spill-over: the next capitalised heading, "SUB HEAD : …", or an appendix such as "COEFFICIENTS FOR CEMENT CONSUMPTION …".
- Item 26.96.2 holds about 42 kB of appended text and would otherwise have matched almost anything.
- Matching uses `matchableDescription()`, which cuts the spill-over. The stored description is unchanged, and the seed is not modified.
- 17 Oct, after a survey of the whole seed (tests: "seed spill-over clean-up, across all 2,758 items"):
  - Cuts, in order: "SUB HEAD" / "COEFFICIENTS FOR"; the text of a following item introduced by its own code ("… 18.100.A Providing …", "… 9.147.A1 Two track …"; a reference "over item 26.76.1" is kept); a run of three or more capitalised words; and a shorter capitalised heading left at the very end ("… excluding cost of hangers. STEEL REINFORCEMENT", "… pipe C.I. SLUICE VALVES/ FIRE HYDRANTS & FIXTURES").
  - Kept: a capitalised sub-heading directly followed by the item's variant. 18.1.1–18.1.6 ("INTERNAL WORK - EXPOSED ON WALL — 1216 (16 mm OD) pipe") had lost their pipe sizes and were six identical texts; they are distinct again. Also kept: "POST-CONSTRUCTIONAL", "MORTH SPECIFICATION", "EOTA ETAG", "Type II IS: 12823".
  - Result: 100 of 2,758 items are cut (was 54). Every cut is a tail, so the matching text is always a prefix of the stored description. No item keeps a sub-head, appendix, trailing heading or following item's text. The longest matching text is under 2,500 characters.
- **Merged rows.** 34 rows hold their own sub-items under one code and one rate: 5.22A (5.22A.1 … 5.22A.6), 5.22B, 5.22C, 9.147, 4.20A, 11.41A, 26.50.1 (A, B), many 18.xxA fittings, and others. The seed does not say which sub-item the rate is for. These rows are matched on their own stem only, are **never reliable** (by description or by code), and so never get "Use schedule rate". The reason says so.

## 4. Missing-scope suggestions (B2)

`scopeSuggestions(lines, matches, index)`.

**Implemented rule: the schedule's own exclusion.**
- When an included line **reliably** matches an item whose description says "excluding the cost of … centering/shuttering …" or "… reinforcement …", that work is paid under separate items.
- If no line covers it, one suggestion is made per work type per schedule chapter (`excluded_formwork:5`, `excluded_reinforcement:5`), however many lines trigger it.

Each suggestion states:
- **what** the work is;
- **why** it was surfaced: the trigger item code, the matched line, and the schedule's clause quoted;
- the **trigger lines**;
- the **missing evidence**: no quantity; it has to be measured from drawings;
- **possible duplicates**: lines whose own wording names the work but carry no matching code. An "excluding reinforcement" clause in a line's own text does not count;
- the **next decision**;
- the schedule **options**: the "Centering and shuttering …" items, or the "Steel reinforcement for R.C.C. work …" items. The trigger's chapter is used when it has them. None is pre-chosen.

**Covered work is not suggested.** Cover means an included line coded to, or reliably matching, any item of that work, in any chapter.

**Not implemented (stated in the UI under "What this check does not do"):**
- other exclusion clauses: fittings, purlins/rafters, pipes, specials, finishing, chemical emulsion, …;
- estimating-practice companions the schedule does not state (masonry → plaster → paint, excavation → backfill);
- anything inferred from drawings;
- suggestions from lines without a reliable match.

The exclusion clauses found across the whole seed were surveyed. Only centering/shuttering (chapters 4 and 5) and reinforcement (chapters 5, 20 and 26) map unambiguously to schedule items.

**Tests** (`src/lib/dsr/scope.test.ts`, 8 tests) [TEST-REAL-DSR]:
- the RCC trigger, with the clause quoted;
- PCC → formwork only, from chapter 4;
- one suggestion for several lines;
- cover by a code in another chapter;
- possible duplicate by wording;
- "excluding reinforcement" in a line's text is not cover;
- unreliable or excluded lines do not trigger;
- accepted lines stay linked to their suggestion.

## 5. Decisions: Accept, Reject, Defer, Undo (B3)

**Storage: no migration.**
- Decisions live in `boq.spec._dsr_scope_decisions` (key → `{decision, at, by, note, schedule, codes?, lineIds?}`).
- **One guarded writer for `boq.spec`** (`src/lib/boqSpecWrite.ts`, 17 Oct). PostgREST can only replace the whole jsonb column, so every writer:
  - reads `spec` and `updated_at`;
  - changes only its own keys on what it read (`undefined` removes a key);
  - writes with a compare-and-swap on `updated_at` and moves `updated_at` strictly forward (`max(now, previous + 1 ms)`, so a slow clock or a same-millisecond write cannot reuse the old value);
  - on a lost compare-and-swap, re-reads and re-applies, up to 3 attempts, then reports a conflict and writes nothing.
- Both writers use it: the DSR decisions (`saveScopeDecision`) and the builder's `setSpecKeys` (commercials, letterhead). Before, the builder wrote the whole spec with no guard and without bumping `updated_at`, so a decision could overwrite a commercial change made between its read and write, and vice versa. The builder's write also ignored errors and showed unsaved values as saved; it now reports and throws (see "Requests" below for the caller).
- A decision changed by someone else since it was shown is refused ("decided elsewhere"); it is not overwritten.
- **Repeats are no-ops.** If the stored decision already is the same person's same decision (a double click, or a retry whose reply was lost), the result is `saved, unchanged`: nothing is written, no second history row, and the UI says "Already saved — nothing changed". Undo of an already-undone decision is the same.
- The UI also runs one action at a time (a ref guard), so a double click does not start a second request.
- "Save as contractor's usual choices" now copies the BOQ's spec as stored (not the screen's cached copy) and **without** `_dsr_scope_decisions` (`reusableSpec`): those decisions refer to this BOQ's lines and must not reach another BOQ.
- Every decision also writes a `boq_line_change_log` row (`field = "dsr_scope_decision"`) when that table exists. Otherwise the decision is saved and the user is told that it is not in the history.

**Accept.**
- The person chooses one or more schedule items.
- Each becomes a line with:
  - `qty 0`, `quantity_status PENDING`, `basis PENDING` ("Awaiting quantity");
  - the item's code, description and unit, and the trigger line's section;
  - **no rate**;
  - `external_key dsr-scope:<suggestion>:<code>`;
  - a basis note naming the trigger item and clause.
- A retry reuses existing lines instead of duplicating them. Two accepts at the same moment: the second insert is refused by the line identity index (23505) and the existing line is reused. (That index exists in the in-memory harness; whether it is deployed in production is not verified.)
- A retry with a stale view of the decision is accepted as a no-op when the stored decision is the same person's acceptance of those items; anyone else's decision is still a conflict.
- Adding further items later keeps the earlier ones, and the earlier note when no new note is typed (it was being cleared).
- Accept does **not** establish a quantity. The shared quantity rule treats these lines as pending: excluded from totals, and listed as pending in the check, the BOQ filter, CSV, PDF and revision.

**Reject and Defer** write only the decision. Rejecting after Accept does **not** delete the added lines. Defer blocks nothing. Accept after Reject replaces the decision.

**Undo** clears the decision, guarded on the record that was saved. Undo after Accept leaves the lines (pending, unpriced). The card used to keep saying "Accepted: measure the quantity…" with no decision recorded; it now says "Decision undone: the line already added is still in the BOQ. Nothing is deleted here — remove it in the BOQ if not needed", and "Next" says how to proceed. The same note covers Reject or Defer after Accept.

**Tests:**
- `src/lib/dsr/scopeStore.test.ts`, 16 tests [TEST-MEM]. New: a double click (two accepts at once) adds each line once; a retry after a lost reply; Accept after Reject and Reject after Accept; Undo after Accept keeps the lines; a later item keeps the note.
- `src/lib/boqSpecWrite.test.ts`, 12 tests [TEST-MEM]. Covers:
  - only the patched keys change, and `updated_at` moves forward;
  - two writers at once (read, read, write, write);
  - a write injected between read and compare-and-swap;
  - a writer that does not bump `updated_at` is invisible to the guard (why all writers must use it);
  - bounded conflict;
  - abort and missing BOQ;
  - a builder change and a decision at the same moment;
  - two people deciding one suggestion at once;
  - repeated clicks and repeated Undo;
  - `reusableSpec`.
- `src/pages/app/DsrCheck.integration.test.tsx`, 3 tests [TEST-MEM], through the real journey shell and page. New: a double click on Defer and on "Add 1 pending line" saves once; Undo after Accept shows the lines-remain note; a line that only possibly matches does not trigger a suggestion.

## 6. Measurement guidance and rates (B4)

**Measurement guidance.**
- The schedule's own parenthetical wording ("Measurements to be taken of …", "rate is over …") is shown verbatim on Accept options.
- It is labelled "guidance, not a quantity".
- It is never written to a quantity or a basis.

**Schedule rate: a separate, audited step.**
- `applyScheduleRate` is offered ("Use schedule rate") only for an included line where:
  - the line's own code is in the BOQ's schedule;
  - the match is reliable;
  - the units are identical;
  - the item has a rate;
  - the line has no `dsr_rate` yet.
- It writes `dsr_rate` (and `dsr_code`), guarded on the line's current `dsr_rate`, `dsr_code`, `custom_rate` and unit.
- It records a `dsr_rate` change-log row: "961.3 (DSR 2023 5.9.6)".
- It **fails closed** when the change-log table is absent, as manual rate edits do.
- A failed history insert is compensated.
- A pending quantity stays pending. A manual `custom_rate` still takes precedence, and the user is told.
- `scheduleRateProblem` explains each refusal: another schedule, another code, a missing rate, or a unit mismatch or convertible unit.

**Non-schedule rates.** `custom_rate` remains the manual or adopted rate (labelled as such by the existing rate-evidence code). The schedule rate is only ever written from a validated schedule item.

## 7. Export and revision trace (C)

- Pending lines (including accepted DSR-check work) now carry their **schedule code** in the pending section:
  - CSV Code column (previously always blank for pending rows);
  - PDF pending row.
- They still show no quantity, no rate and no amount.
- The revision snapshot (`buildRevisionLines`) holds them with `quantity_status PENDING`, `basis PENDING`, the code, and `amount null`.

Covered by:
- `src/lib/boqDsrDocument.test.ts` (2 new tests);
- `src/pages/app/DsrCheck.integration.test.tsx`;
- the updated `OpsBoqBuilder.exportGuard.test.tsx`, where a pending row now shows its code "2.1".

## 8. Limitations and open items

- **Concurrency on `boq.spec`.** Closed for the two writers in this codebase: both go through `writeBoqSpecKeys`, as described in §5. [TEST-MEM]
  - Not verified on PostgREST: that `.eq("updated_at", <value read back>)` matches the stored timestamptz exactly. Postgres compares the values, not the text, so it should. [NOT RUN]
  - Any future writer of `boq.spec` that bypasses the helper re-opens the window; a test documents this.
  - A dedicated decisions table (migration) would still be the cleaner design.
- **Decisions are not tied to a schedule version.** A decision record carries its schedule label, but if a BOQ's `rate_year` changes, the old decisions still show on suggestions with the same key. [CODE]
- **Catalogue load.** All billable items of the schedule (2,758 rows, three pages) are fetched once per session in Check & finalise. They are not cached across reloads.
- **No staging or production run.**
  - `loadDsrSchedule` paging, the `boq` compare-and-swap, the line insert and the rate write have not run against real PostgREST or RLS. [NOT RUN]
  - In production today the change log is absent, so:
    - decisions save without history;
    - "Use schedule rate" is refused;
    - Accept works, and creates pending lines.
- **Thresholds** (0.6 / 0.35 / 0.1, coverage 0.85 and variant share 0.5 for reliable) were tuned on the real schedule against the cases in §3 and §3a. They are not validated on real project BOQs. Matching is lexical; it has no knowledge that "slab" formwork is the schedule's "suspended floors", for example.
- **Indicative costing / `boq_line_dsr_mapping`** (deferred migration `20261003000000`) is untouched and remains a separate, undeployed reference-benchmark feature.

## 9. Read-only run on production data [LIVE-RO]

A real login was used against production in Chromium, with every non-read request blocked. Only `POST /auth/v1/token` (sign-in) was allowed, and **0 writes were attempted**. Nothing was clicked that writes.

**Check & finalise, on the first project.**
- `dsr_item` returned all 2,758 DSR 2023 items in three pages (`0-999`, `1000-1999`, `2000-2757`).
- The section rendered "Schedule check — DSR 2023 … (2,758 items)".

**The real BOQ** (18 lines of doors, windows and services from drawing analysis):
- Before the candidate rule: 0 reliable, 8 possible, 10 none.
- After it: 0 reliable, 3 possible, 15 none.
- Bare marks ("D3", "W2") say "no distinctive terms to match on".
- No scope suggestions, which is correct: no line matches an item with a formwork or reinforcement exclusion.

**Build BOQ evidence row, on the same project.** The first line rendered its reviewed item ("D1"):
- decision "Corrected in review";
- extracted and corrected values;
- the reviewer's note;
- "Show the measured region on SD-AR-101 DOOR SCHEDULE, p.1".

**What this does not show.** Accept, Reject, Defer, Undo and the schedule rate on real data. Those are writes, and were tested only in memory.
