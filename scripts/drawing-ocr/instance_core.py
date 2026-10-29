"""Door and window instance counting on architectural floor plans.

Pure: no files, no OCR, no network. Takes the same pages schedule_core reads
(words and ruling lines from schedule_sources.py, plus optional opening
symbols such as CAD door-swing arcs) and the schedule marks schedule_core
found, and returns:
  * count items (cunstruct.analysis.v1, keyed by the mark itself, e.g. "D1",
    as typeInstances.ts matches observations to items) for Import JSON review;
  * one `opening` observation per counted instance and one `schedule_entry`
    per schedule row (cunstruct.observation.v1), the shape the app's
    typeInstances / reconcileInstances already consume.

What is counted, and what is not:
  * A tag on a FLOOR PLAN is one candidate instance. Tags on elevations,
    sections, details and schedules are other representations of the same
    openings: kept as corroborating evidence, never counted.
  * Each tag is given the view titled beneath it (in that title's column);
    a tag on the boundary between two views, or with no title below and two
    different views about equally near, is ambiguous, not guessed.
  * One floor-plan view is counted per level. Other plans of that level
    (furniture, electrical, ceiling ...) corroborate. Two counted views of
    one level that disagree are a conflict.
  * A "TYPICAL" plan counts once per floor it stands for, only when the
    title states how many floors; otherwise the count stays PENDING.
  * Two detections of one mark at one place merge into one instance; tags of
    different marks that overlap are ambiguous; a tag that is part of a
    detail reference ("D1/A501") is not an instance.
  * A count is MEASURED only when every candidate for that mark is resolved.
    Anything uncertain is PENDING with the lower and upper counts as
    candidates. A schedule mark never found on a plan, and an opening symbol
    with no tag, are reported for review. Nothing is invented.
"""
import re
from statistics import median

from schedule_core import tag_of, lines_of, phrases, word_height, evidence, item, KIND_NAME, _overlap

# ---------------------------------------------------------------- views

SECONDARY_PLAN = re.compile(r"\b(SITE|ROOF|CEILING|REFLECTED|RCP|FURNITURE|FURNISHING|ELECTRICAL|LIGHTING|POWER|PLUMBING|DRAINAGE|"
                            r"FINISH(?:ES)?|FLOORING|FRAMING|FOUNDATION|STRUCTURAL|DIMENSION(?:S|ED)?|DEMOLITION|SETTING[- ]OUT|"
                            r"HVAC|MECHANICAL|LANDSCAPE|KEY|CALLOUT|ENLARGED|PART|PARTIAL)\b", re.I)
ROLE_WORDS = (("schedule", re.compile(r"\bSCHEDULE\b", re.I)), ("elevation", re.compile(r"\bELEVATIONS?\b", re.I)),
              ("section", re.compile(r"\bSECTIONS?\b", re.I)), ("detail", re.compile(r"\bDETAILS?\b", re.I)),
              ("plan", re.compile(r"\bPLAN\b", re.I)))
ORDINAL = {"BASEMENT": -1, "LOWER GROUND": -0.5, "GROUND": 0, "FIRST": 1, "SECOND": 2, "THIRD": 3, "FOURTH": 4, "FIFTH": 5,
           "SIXTH": 6, "SEVENTH": 7, "EIGHTH": 8, "NINTH": 9, "TENTH": 10, "MEZZANINE": 0.5, "ATTIC": 99, "LOFT": 98}
MULT = (re.compile(r"(?:[xX×]\s*(\d{1,2})\b|\b(\d{1,2})\s*(?:NOS?\.?|FLOORS|LEVELS|STOREYS|STORIES)\b)"),
        re.compile(r"\b(?:FLOORS?|LEVELS?)\s*(\d{1,2})\s*(?:-|–|TO)\s*(\d{1,2})\b", re.I))


NOTE_START = re.compile(r"^(?:SEE|REFER|REF\.?|AS|TO|FOR|NOTE|NOTES|PROVIDE|ALL)\b", re.I)


def view_role(text):
    """(role, subtype) of a view title, or None when the text is not a title.
    subtype for plans: 'floor' (counted) or 'secondary'. Notes ('SEE D1
    DETAIL', 'REFER PLAN') name views without being their titles."""
    t = " ".join(text.split())
    if len(t.split()) > 9 or len(t) < 4 or NOTE_START.match(t):
        return None
    for role, rx in ROLE_WORDS:
        if rx.search(t):
            if role != "plan":
                return role, None
            return "plan", "secondary" if SECONDARY_PLAN.search(t) else "floor"
    return None


def level_of(text):
    """(level key, multiplier) from a plan title. Multiplier is 1 for an
    ordinary plan, an int for a typical plan that states its floors, and
    None for a typical plan that does not."""
    t = " ".join(text.upper().split())
    m = re.search(r"\bLEVEL\s*(\d{1,2})\b|\b(\d{1,2})(?:ST|ND|RD|TH)\s+FLOOR\b|\bFLOOR\s*(\d{1,2})\b", t)
    key = None
    if m:
        key = f"L{int(next(g for g in m.groups() if g))}"
    else:
        for word in sorted(ORDINAL, key=len, reverse=True):
            if re.search(rf"\b{word}\b", t):
                key = f"L{ORDINAL[word]:g}"
                break
    if "TYPICAL" in t:
        r = MULT[1].search(t)
        if r:
            a, b = int(r.group(1)), int(r.group(2))
            return key or f"TYPICAL {a}-{b}", (b - a + 1 if b >= a else None)
        n = MULT[0].search(t)
        return key or "TYPICAL", (int(n.group(1) or n.group(2)) if n else None)
    return key or "(unnamed level)", 1


SCALE = re.compile(r"\b1\s*:\s*\d{1,4}\b|\bSCALE\b|\bN\.?T\.?S\b", re.I)
LEVEL_NAME = re.compile(r"^(?:(?:LOWER\s+)?GROUND|BASEMENT|FIRST|SECOND|THIRD|FOURTH|FIFTH|MEZZANINE|ATTIC|LOFT|ROOF)\s+(?:FLOOR|LEVEL)$"
                        r"|^(?:LEVEL|FLOOR)\s*\d{1,2}$|^\d{1,2}(?:ST|ND|RD|TH)\s+FLOOR$", re.I)


def _scale_below(c, lines, h):
    """A scale ('1 : 50', 'SCALE', 'NTS') printed just beneath a phrase marks it as a view title."""
    for l in lines:
        if 0 < l["cy"] - c["y1"] <= 2.5 * h:
            near = [w for w in l["words"] if w["x1"] >= c["x0"] - 3 * h and w["x0"] <= c["x1"] + 3 * h]
            if near and SCALE.search(" ".join(w["t"] for w in near)):
                return True
    return False


def view_titles(page, words, h, exclude=()):
    """View titles on a page. A phrase naming a view type (PLAN, ELEVATION,
    SECTION, DETAIL, SCHEDULE) is a title. A bare level name ('Ground Floor')
    is a floor-plan title only when a scale is printed beneath it; without
    one it is a level marker on an elevation or section. Phrases inside a
    schedule table (its 'PLAN VIEW' column header) are not titles."""
    titles = []
    lines = lines_of(words, h)
    for l in lines:
        for c in phrases(l["words"], h, gap=1.5):
            box = [c["x0"], c["y0"], c["x1"], c["y1"]]
            if any(_overlap(box, b) > 0.5 for b in exclude):
                continue
            text = " ".join(c["t"].split())
            core = re.sub(r"^\d{1,3}\s+|\s+\d{1,3}$", "", text)  # a view number beside the name
            scaled = _scale_below(c, lines, h)
            r = view_role(text)
            if r is None and scaled and LEVEL_NAME.match(core):
                r = ("plan", "floor")
            if r:
                titles.append(dict(page=page, text=text, role=r[0], subtype=r[1], bbox=box, scaled=scaled))
    return titles


def _dist(box, pt):
    dx = max(box[0] - pt[0], 0, pt[0] - box[2])
    dy = max(box[1] - pt[1], 0, pt[1] - box[3])
    return (dx * dx + dy * dy) ** 0.5


def _columns(titles, h):
    """Each title's column: halfway to the neighbouring titles on its row."""
    cols = {}
    rows = []
    for t in sorted(titles, key=lambda t: (t["bbox"][1], t["bbox"][0])):
        for r in rows:
            if abs(r[0]["bbox"][1] - t["bbox"][1]) <= 3 * h:
                r.append(t)
                break
        else:
            rows.append([t])
    for r in rows:
        r.sort(key=lambda t: (t["bbox"][0] + t["bbox"][2]) / 2)
        cx = [(t["bbox"][0] + t["bbox"][2]) / 2 for t in r]
        for i, t in enumerate(r):
            lo = (cx[i - 1] + cx[i]) / 2 if i else float("-inf")
            hi = (cx[i] + cx[i + 1]) / 2 if i + 1 < len(r) else float("inf")
            cols[id(t)] = (lo, hi)
    return cols


def view_of(word, titles, h, ratio=1.5):
    """The view a tag belongs to. Architectural sheets title each view
    beneath it, so the tag takes the first title below it within that
    title's column (a column runs halfway to the neighbouring titles on the
    same row). A tag within 2 text heights of a column boundary is ambiguous.
    With no title below, the nearest title is used, unless a title of a
    different view is about equally near (ambiguous). Returns (title, why)."""
    if not titles:
        return None, "no view title on this page"
    c = ((word["x0"] + word["x1"]) / 2, (word["y0"] + word["y1"]) / 2)
    cols = _columns(titles, h)
    below = sorted((t for t in titles if t["bbox"][1] >= word["y1"] - 0.5 * h and cols[id(t)][0] <= c[0] < cols[id(t)][1]),
                   key=lambda t: (t["bbox"][1], t["bbox"][0]))
    if below:
        t = below[0]
        lo, hi = cols[id(t)]
        if min(c[0] - lo, hi - c[0]) < 2 * h:
            return None, f"on the boundary between '{t['text']}' and the view beside it"
        return t, None
    ranked = sorted(titles, key=lambda t: (_dist(t["bbox"], c), t["bbox"][1], t["bbox"][0]))
    best = ranked[0]
    for other in ranked[1:]:
        if (other["role"], other["subtype"], other["text"]) == (best["role"], best["subtype"], best["text"]):
            continue
        if _dist(other["bbox"], c) < ratio * max(_dist(best["bbox"], c), 1e-9):
            return None, f"about equally near '{best['text']}' and '{other['text']}'"
        break
    return best, None


# ---------------------------------------------------------------- tags on a page

def _same_line_neighbours(w, words, h, reach=2.5):
    """Words on the tag's line whose near edge is within reach*h of it, either side."""
    cy = (w["y0"] + w["y1"]) / 2
    out = []
    for o in words:
        if o is w or abs((o["y0"] + o["y1"]) / 2 - cy) > 0.6 * h:
            continue
        gap = o["x0"] - w["x1"] if o["x0"] >= w["x0"] else w["x0"] - o["x1"]
        if -0.2 * h <= gap <= reach * h:
            out.append(o)
    return out


def detail_reference(w, words, h):
    """'D1/A501', 'D1 / A-501', '1/D1': a callout to a detail or sheet, not a placed opening."""
    if "/" in w["t"]:
        return True
    near = _same_line_neighbours(w, words, h, reach=1.0)
    return any(o["t"].startswith("/") or o["t"].endswith("/") or o["t"] == "/" for o in near)


MULT_WORD = re.compile(r"^\(?(?:[xX×]\d{0,2}|\d{1,2}|NOS?\.?|NO\.?|TYP\.?|TYPICAL)\)?$", re.I)


def in_text(w, words, h):
    """A placed tag stands alone. A tag that is one word of a phrase
    ('W2 - WALL FRAMING', 'REFER D1 DETAIL') is text: a title or a note,
    not an opening. Sizes, counts and TYP. beside a tag are allowed."""
    near = _same_line_neighbours(w, words, h, reach=1.2)
    return any(sum(ch.isalpha() for ch in o["t"]) >= 2 and not MULT_WORD.match(o["t"]) for o in near) or \
        any(o["t"] in ("-", "–", "—", ":") for o in near)


def multiplicity(w, words, h):
    """('n', k) when the tag states k openings ('W2 x3', 'W2 (3 NOS)'),
    ('typ', None) for 'TYP.' with no number, else ('one', 1)."""
    after = sorted((o for o in _same_line_neighbours(w, words, h) if o["x0"] >= w["x1"] - 0.1 * h), key=lambda o: o["x0"])
    text = " ".join(o["t"] for o in after[:3])
    m = re.match(r"^\(?\s*(?:[xX×]\s*(\d{1,2})|(\d{1,2})\s*(?:NOS?\.?|NO\.?))\s*\)?", text)
    if m:
        return "n", int(m.group(1) or m.group(2))
    if re.match(r"^\(?\s*TYP", text, re.I):
        return "typ", None
    return "one", 1


def candidates_on_page(p, prefixes, schedule_boxes, h):
    """Every tag word of a counted prefix on this page, classified."""
    words = p["words"]
    # a schedule's own header row ('NO. NAME PLAN VIEW ELEVATION VIEW') sits just above its first row rule
    titles = view_titles(p["page"], words, h, [[b[0], b[1] - 6 * h, b[2], b[3]] for b in schedule_boxes])
    out = []
    for w in words:
        if w.get("vertical"):
            continue
        tg = tag_of(w["t"].strip("()[]."))
        if not tg and "/" in w["t"]:
            # 'D1/A501' or '1/D1' in one token: a detail callout naming the mark
            part = next((x for x in w["t"].split("/") if tag_of(x) and tag_of(x)[0] in prefixes), None)
            if part:
                out.append(dict(mark=part.replace("-", ""), page=p["page"], bbox=[w["x0"], w["y0"], w["x1"], w["y1"]], word=w, state="detail_ref"))
            continue
        if not tg or tg[0] not in prefixes:
            continue
        box = [w["x0"], w["y0"], w["x1"], w["y1"]]
        mark = w["t"].strip("()[].").replace("-", "")
        rec = dict(mark=mark, page=p["page"], bbox=box, word=w)
        if any(_overlap(box, b) > 0.5 for b in schedule_boxes):
            rec.update(state="schedule")
        elif detail_reference(w, words, h):
            rec.update(state="detail_ref")
        elif in_text(w, words, h):
            rec.update(state="text")
        else:
            view, why = view_of(w, [t for t in titles if t["role"] != "schedule"] or titles, h)
            if view is None:
                rec.update(state="ambiguous", why=f"view unknown: {why}")
            else:
                rec.update(state=view["role"], view=view)
                kind, k = multiplicity(w, words, h)
                rec.update(mult_kind=kind, mult=k)
        out.append(rec)
    return out, titles


def dedupe(recs, h):
    """Merge detections of one mark at one place (overprinted text, a tag
    read twice). Different marks that overlap are both ambiguous."""
    kept = []
    for r in sorted(recs, key=lambda r: (r["page"], r["bbox"][1], r["bbox"][0], r["mark"])):
        twin = next((k for k in kept if k["page"] == r["page"] and k["mark"] == r["mark"]
                     and (_overlap(k["bbox"], r["bbox"]) > 0.3 or _centre_gap(k["bbox"], r["bbox"]) <= 1.0 * h)), None)
        if twin:
            twin.setdefault("duplicates", []).append(r["bbox"])
            continue
        kept.append(r)
    for a in kept:
        for b in kept:
            if a is not b and a["page"] == b["page"] and a["mark"] != b["mark"] and _overlap(a["bbox"], b["bbox"]) > 0:
                for r in (a, b):
                    if r["state"] not in ("schedule", "detail_ref"):
                        r.update(state="ambiguous", why=f"overlaps tag {(b if r is a else a)['mark']}")
    return kept


def _centre_gap(a, b):
    return (((a[0] + a[2]) - (b[0] + b[2])) ** 2 / 4 + ((a[1] + a[3]) - (b[1] + b[3])) ** 2 / 4) ** 0.5


# ---------------------------------------------------------------- symbols

def attach_symbols(p, recs, h):
    """Opening symbols (e.g. door swings) on floor plans: each takes the
    nearest tag within reach; a symbol with no tag in reach is untagged;
    a symbol equally near two different marks is ambiguous."""
    flags = []
    for s in sorted(p.get("symbols", []), key=lambda s: (s["bbox"][1], s["bbox"][0])):
        sb = s["bbox"]
        size = max(sb[2] - sb[0], sb[3] - sb[1])
        reach = max(1.5 * size, 6 * h)
        c = ((sb[0] + sb[2]) / 2, (sb[1] + sb[3]) / 2)
        near = sorted(((_dist(r["bbox"], c), r) for r in recs if r["page"] == p["page"] and r["state"] == "plan"
                       and r["view"]["subtype"] == "floor" and _dist(r["bbox"], c) <= reach), key=lambda t: (t[0], t[1]["mark"]))
        if not near:
            flags.append(dict(kind="untagged", symbol=s, page=p["page"]))
        elif len(near) > 1 and near[1][1]["mark"] != near[0][1]["mark"] and near[1][0] < 1.25 * max(near[0][0], 1e-9):
            flags.append(dict(kind="symbol_ambiguous", symbol=s, page=p["page"], marks=sorted({near[0][1]["mark"], near[1][1]["mark"]})))
        else:
            near[0][1].setdefault("symbols", []).append(s)
    return flags


# ---------------------------------------------------------------- counting

def count_document(pages, schedule_marks, schedule_tables, doc_name="drawing"):
    """pages: schedule_sources pages (+ optional 'symbols': [{kind, bbox}]).
    schedule_marks: {mark: {page, bbox, qty, kind}} from schedule_core.
    schedule_tables: [(page, bbox)] of every schedule table found.
    Returns (items, observations, report)."""
    # only door/window marks are counted: rows of door/window (graphical)
    # schedules and door/window prefixes; room or finish codes from an area
    # schedule are not openings
    schedule_marks = {m: v for m, v in schedule_marks.items()
                      if tag_of(m) and (v.get("kind") == "graphical" or tag_of(m)[0] in KIND_NAME)}
    prefixes = {tag_of(m)[0] for m in schedule_marks} | {"D", "W"}
    recs, flags, all_titles = [], [], []
    hs = {}
    pages = sorted(pages, key=lambda p: p["page"])
    for p in pages:
        h = word_height(p["words"]) if p["words"] else 1.0
        hs[p["page"]] = h
        boxes = [b for pg, b in schedule_tables if pg == p["page"]] + \
                [m["bbox"] for m in schedule_marks.values() if m["page"] == p["page"]]
        page_recs, titles = candidates_on_page(p, prefixes, boxes, h)
        all_titles += titles
        page_recs = dedupe(page_recs, h)
        flags += attach_symbols(p, page_recs, h)
        recs += page_recs

    # floor-plan views, grouped by level
    by_mark = {}
    for r in recs:
        by_mark.setdefault(r["mark"], []).append(r)
    marks = sorted(set(by_mark) | set(schedule_marks), key=_mark_sort)

    items, observations, report = [], [], dict(marks={}, titles=all_titles, flags=[])
    size_of = {p["page"]: p.get("size") for p in pages}
    for mark in marks:
        rs = by_mark.get(mark, [])
        sched = schedule_marks.get(mark)
        floor = [r for r in rs if r["state"] == "plan" and r["view"]["subtype"] == "floor"]
        levels = {}
        for r in floor:
            lv, mult = level_of(r["view"]["text"])
            view_id = (r["page"], r["view"]["text"], tuple(round(v) for v in r["view"]["bbox"]))
            L = levels.setdefault(lv, dict(mult=mult, views={}))
            if mult != L["mult"]:
                L["mult_conflict"] = True
            L["views"].setdefault(view_id, []).append(r)
        ambiguous = [r for r in rs if r["state"] == "ambiguous"]
        typ = [r for r in floor if r["mult_kind"] == "typ"]
        corroborating = [r for r in rs if r["state"] in ("elevation", "section", "detail") or
                         (r["state"] == "plan" and r["view"]["subtype"] == "secondary")]
        problems, total, upper, calc_inputs = [], 0, 0, []
        level_report = {}
        for lv in sorted(levels, key=str):
            L = levels[lv]
            per_view = {vid: sum(r["mult"] if r["mult_kind"] == "n" else 1 for r in v) for vid, v in L["views"].items()}
            counts = sorted(set(per_view.values()))
            n = counts[0]
            level_report[lv] = dict(views={f"page {vid[0]}: {vid[1]}": c for vid, c in sorted(per_view.items())}, multiplier=L["mult"])
            if len(counts) > 1:
                problems.append(f"{lv}: plan views disagree ({', '.join(f'page {vid[0]} {vid[1]!r}: {c}' for vid, c in sorted(per_view.items()))})")
                upper += max(counts) * (L["mult"] or 1)
            else:
                upper += n * (L["mult"] or 1)
            if L["mult"] is None or L.get("mult_conflict"):
                problems.append(f"{lv}: typical plan does not state how many floors it stands for")
            total += n * (L["mult"] or 1)
            calc_inputs.append((lv, n, L["mult"]))
        if typ:
            problems.append(f"{len(typ)} tag(s) marked TYP. with no number of openings")
        if ambiguous:
            problems.append(f"{len(ambiguous)} tag(s) not counted: " + "; ".join(sorted({r['why'] for r in ambiguous})))
            upper += len(ambiguous)
        kind = KIND_NAME.get(tag_of(mark)[0], "Type") if tag_of(mark) else "Type"
        key = mark  # the app maps observations to an item by key == mark (typeInstances.ts)
        ev = []
        for r in sorted(floor, key=lambda r: (r["page"], r["bbox"][1], r["bbox"][0])):
            ev.append(evidence(r["page"], r["bbox"], f"{mark} on {r['view']['text']} (page {r['page']})", "location"))
            for s in r.get("symbols", []):
                ev.append(evidence(r["page"], s["bbox"], f"{s.get('kind', 'opening')} symbol at {mark}", "location"))
        for r in sorted(ambiguous, key=lambda r: (r["page"], r["bbox"][1], r["bbox"][0])):
            ev.append(evidence(r["page"], r["bbox"], f"{mark} not counted: {r['why']}", "location"))
        page0 = (floor or ambiguous or corroborating or [dict(page=sched["page"] if sched else None)])[0]["page"]
        corr = f" Also shown on {len(corroborating)} other view(s) (elevations, sections, other plans); not counted again." if corroborating else ""
        sched_note = ""
        cands = None
        if sched is None:
            sched_note = " No schedule row found for this mark."
        elif sched.get("qty") is not None and not problems and floor:
            if int(sched["qty"]) == total:
                sched_note = f" The schedule's QTY ({int(sched['qty'])}) agrees."
            else:
                problems.append(f"schedule QTY {int(sched['qty'])} differs from the plan count {total}")
                cands = [dict(value=total, unit="nr", basis="tags counted on floor plans"),
                         dict(value=int(sched["qty"]), unit="nr", basis="QTY printed in the schedule")]
        report["marks"][mark] = dict(levels=level_report, ambiguous=len(ambiguous), corroborating=len(corroborating),
                                     detail_refs=sum(r["state"] == "detail_ref" for r in rs), in_schedule=sched is not None,
                                     merged_duplicates=sum(len(r.get("duplicates", [])) for r in rs), problems=problems)
        if not floor and not ambiguous:
            if sched is None:
                continue  # only seen off-plan and in no schedule: nothing to count
            items.append(item(key, f"{kind} {mark} — count", None, "nr", sched["page"], [evidence(sched["page"], sched["bbox"], f"{mark} schedule row")],
                              f"{doc_name} page {sched['page']}", size_of.get(sched["page"]),
                              notes=f"{mark} is in the schedule but no tag for it was found on any floor plan.{corr} Count unknown; check the drawing."))
        elif problems:
            if cands is None and upper != total:
                cands = [dict(value=total, unit="nr", basis="resolved floor-plan tags only"),
                         dict(value=upper, unit="nr", basis="including the uncertain tags")]
            items.append(item(key, f"{kind} {mark} — count", None, "nr", page0, ev, f"{doc_name} page {page0}", size_of.get(page0),
                              notes="Count not resolved: " + "; ".join(problems) + "." + corr + sched_note,
                              **({"candidates": cands} if cands and len(cands) > 1 else {})))
        else:
            extra = {}
            mults = [(lv, n, m) for lv, n, m in calc_inputs if m and m > 1]
            if len(calc_inputs) == 1 and mults:
                lv, n, m = mults[0]
                # "count" is the app's dimensionless unit (measurementValidator.ts); "nr" would not recompute
                extra["calculation_data"] = dict(formula="COUNT_TIMES_MULTIPLIER", inputs=[dict(name=f"tags on {lv} plan", value=n, unit="count"),
                                                                                       dict(name="floors the typical plan stands for", value=m, unit="count")])
            breakdown = ", ".join(f"{lv}: {n}{f' x {m} floors' if m and m > 1 else ''}" for lv, n, m in calc_inputs)
            items.append(item(key, f"{kind} {mark} — count", total, "nr", page0, ev, f"{doc_name} page {page0}", size_of.get(page0),
                              notes=f"Tags counted on floor plans, one plan per level ({breakdown}).{corr}{sched_note}", **extra))
        for r in sorted(floor, key=lambda r: (r["page"], r["bbox"][1], r["bbox"][0])):
            lv, mult = level_of(r["view"]["text"])
            observations.append(dict(observation_type="opening", mark=mark, scope_hint=kind.lower(),
                                     location_text=f"{r['view']['text']} (page {r['page']})" + (f"; typical plan for {mult} floors" if mult and mult > 1 else ""),
                                     attributes={}, evidence_completeness="FULL",
                                     source=dict(document=f"{doc_name} page {r['page']}", page=r["page"],
                                                 evidence=[evidence(r["page"], r["bbox"], f"{mark} tag", "location")] +
                                                          [evidence(r["page"], s["bbox"], "opening symbol", "location") for s in r.get("symbols", [])],
                                                 **({"pageSize": size_of[r["page"]]} if size_of.get(r["page"]) else {}))))
    for mark in sorted(schedule_marks, key=_mark_sort):
        s = schedule_marks[mark]
        observations.append(dict(observation_type="schedule_entry", mark=mark, attributes={}, evidence_completeness="FULL",
                                 source=dict(document=f"{doc_name} page {s['page']} schedule", page=s["page"],
                                             evidence=[evidence(s["page"], s["bbox"], f"{mark} schedule row", "location")],
                                             **({"pageSize": size_of[s["page"]]} if size_of.get(s["page"]) else {}))))
    for i, f in enumerate(sorted(flags, key=lambda f: (f["page"], f["symbol"]["bbox"][1], f["symbol"]["bbox"][0]))):
        sb = f["symbol"]["bbox"]
        what = f["symbol"].get("kind", "opening")
        if f["kind"] == "untagged":
            name, note = f"Untagged {what} symbol (page {f['page']})", f"A {what} symbol on a floor plan has no tag within reach; its type and count are unknown. Check the drawing."
        else:
            name, note = f"Ambiguous {what} symbol (page {f['page']})", f"A {what} symbol is about equally near tags {' and '.join(f['marks'])}; it was not counted for either."
        items.append(item(f"FLAG:{f['kind']}:{f['page']}:{round(sb[0])},{round(sb[1])}", name, None, "nr", f["page"],
                          [evidence(f["page"], sb, f"{what} symbol", "location")], f"{doc_name} page {f['page']}", size_of.get(f["page"]), notes=note))
        report["flags"].append(dict(kind=f["kind"], page=f["page"], bbox=sb))
    return items, observations, report


def _mark_sort(m):
    t = tag_of(m)
    return (t[0], int(re.match(r"\d+", t[1]).group(0)), t[1]) if t else (m, 0, "")
