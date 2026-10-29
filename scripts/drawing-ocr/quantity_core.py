"""Deterministic quantity take-off: drawing facts -> calculated quantities.

Pure: no files, no OCR, no network. Exact decimal arithmetic throughout;
rounding happens only at the output boundary (to_analysis_item).

A calculated quantity is a QuantityRecord (see quantity_record) holding
everything needed to reproduce and review it: the BOQ item and element type,
the quantity and its canonical unit, the measurement method, the formula and
calculation version, every input with its unit, kind (observed on the drawing
or derived from observed values) and evidence, what was included and
excluded, deductions, dependencies on other results, a status, and the
reasons it is not resolved.

Statuses, from most to least severe when results combine:
  conflicting   two drawing sources give different values; none is chosen
  ambiguous     the drawing can be read more than one way
  insufficient  a needed value is missing or unusable
  pending_review  computed, but a source it depends on needs a reviewer
  calculated    every input resolved; the number is reproducible
Only `calculated` carries a quantity. Everything else has quantity None and
its reasons; missing values are never treated as zero or as known.

Formulas map onto the app's existing allowlist (analysisSchemaV1.ts
CALCULATION_FORMULA_IDS) so the app can recompute what it imports:
SUM_OF_SEGMENTS, LENGTH_TIMES_WIDTH, COUNT_TIMES_MULTIPLIER, UNIT_CONVERSION.
A net quantity (gross minus deductions) has no allowlisted formula yet: it
is computed and recorded here, but exported with its calculation as text,
not as calculation_data (see to_analysis_item).
"""
import re
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

CALC_VERSION = "quantity-core 0.1"

# ---------------------------------------------------------------- units

# exact factors to the canonical unit of each dimension (the same units the
# app's measurementValidator.ts recognises)
LENGTH_TO_M = {"m": Decimal(1), "mm": Decimal("0.001"), "cm": Decimal("0.01"), "in": Decimal("0.0254"), "ft": Decimal("0.3048")}
UNITS = {u: ("LENGTH", f) for u, f in LENGTH_TO_M.items()}
UNITS.update({"sqm": ("AREA", Decimal(1)), "sqft": ("AREA", Decimal("0.3048") ** 2), "nos": ("COUNT", Decimal(1))})
CANONICAL = {"LENGTH": "m", "AREA": "sqm", "COUNT": "nos"}
UNIT_SPELLINGS = {"m2": "sqm", "m²": "sqm", "sq.m": "sqm", "sqm": "sqm", "sft": "sqft", "sq.ft": "sqft", "sqft": "sqft", "ft2": "sqft",
                  "nr": "nos", "no": "nos", "nos": "nos", "count": "nos", "mm": "mm", "m": "m", "cm": "cm", "in": "in", "ft": "ft"}

SEVERITY = ["conflicting", "ambiguous", "insufficient", "pending_review", "calculated"]


class QuantityError(ValueError):
    """An input that can never be calculated with (malformed, non-finite)."""


def unit_of(text):
    """Canonical spelling of a unit, or None when it is not one we support."""
    return UNIT_SPELLINGS.get((text or "").strip().lower())


def dimension(unit):
    return UNITS[unit][0] if unit in UNITS else None


def dec(value):
    """An exact Decimal from a printed value ('1,234.50', 210, '18.4').
    Floats are read through their shortest repr, never their binary expansion."""
    if isinstance(value, Decimal):
        d = value
    elif isinstance(value, bool) or value is None:
        raise QuantityError(f"not a number: {value!r}")
    else:
        try:
            d = Decimal(str(value).replace(",", "").strip())
        except InvalidOperation:
            raise QuantityError(f"not a number: {value!r}") from None
    if not d.is_finite():
        raise QuantityError(f"not a finite number: {value!r}")
    return d


def convert(value, from_unit, to_unit):
    """Exact conversion within one dimension. Different dimensions never mix."""
    a, b = UNITS.get(from_unit), UNITS.get(to_unit)
    if a is None or b is None:
        raise QuantityError(f"unsupported unit: {from_unit if a is None else to_unit}")
    if a[0] != b[0]:
        raise QuantityError(f"can't convert {from_unit} ({a[0].lower()}) to {to_unit} ({b[0].lower()})")
    return dec(value) * a[1] / b[1]


# ---------------------------------------------------------------- records

def measure(name, value, unit, kind="observed", evidence=None, source=None):
    """One input value: observed on the drawing, or derived from observed values."""
    u = unit_of(unit)
    if u is None:
        raise QuantityError(f"{name}: unsupported unit {unit!r}")
    return dict(name=name, value=dec(value), unit=u, kind=kind, evidence=list(evidence or []), source=source)


def quantity_record(key, boq_item, element_type, unit, method, formula, inputs, status, quantity=None, reasons=(),
                    included=(), excluded=(), deductions=(), dependencies=(), candidates=(), multiplier=None):
    if status not in SEVERITY:
        raise QuantityError(f"unknown status {status}")
    if (status == "calculated") != (quantity is not None):
        raise QuantityError("only a calculated record carries a quantity")
    return dict(key=key, boq_item=boq_item, element_type=element_type, quantity=quantity, unit=unit, method=method,
                formula=formula, calc_version=CALC_VERSION, inputs=list(inputs), status=status, reasons=list(reasons),
                included=list(included), excluded=list(excluded), deductions=list(deductions), dependencies=list(dependencies),
                candidates=list(candidates), multiplier=multiplier)


def worst(statuses):
    return min(statuses, key=SEVERITY.index) if statuses else "calculated"


# ---------------------------------------------------------------- calculations

def rect_area(length, width, out_unit="sqm"):
    """length x width, both lengths. Returns (area, None) or (None, reason)."""
    for m in (length, width):
        if dimension(m["unit"]) != "LENGTH":
            return None, f"{m['name']} is not a length ({m['unit']})"
        if m["value"] <= 0:
            return None, f"{m['name']} is {m['value']} {m['unit']}: a length must be positive"
    area_sqm = convert(length["value"], length["unit"], "m") * convert(width["value"], width["unit"], "m")
    return convert(area_sqm, "sqm", out_unit), None


def sum_measures(parts, out_unit):
    """Exact sum of same-dimension measures in out_unit. Every part must
    resolve; a missing part is never read as zero."""
    total = Decimal(0)
    for m in parts:
        if dimension(m["unit"]) != dimension(out_unit):
            raise QuantityError(f"{m['name']}: {m['unit']} can't be added to {out_unit}")
        total += convert(m["value"], m["unit"], out_unit)
    return total


def net_of_deductions(gross, deductions):
    """gross minus deductions, with integrity rules:
      * each deduction is identified by its physical opening (`opening_id`);
        the same opening twice is deducted once, and a repeat with a
        different value is a conflict;
      * a deduction whose own status isn't `calculated` (e.g. an opening
        count still pending) leaves the net quantity unresolved;
      * a deduction larger than the gross is refused.
    gross: dict(value, unit, status). deductions: [dict(opening_id, value,
    unit, status, reason)]. Returns dict(status, quantity, reasons, applied, skipped)."""
    reasons, applied, skipped = [], [], []
    statuses = [gross.get("status", "calculated")]
    if gross.get("status", "calculated") != "calculated":
        reasons.append(f"gross quantity is {gross['status']}")
    seen = {}
    for d in sorted(deductions, key=lambda d: str(d["opening_id"])):
        oid = d["opening_id"]
        if oid in seen:
            if seen[oid]["value"] != d.get("value") or seen[oid]["unit"] != d.get("unit"):
                statuses.append("conflicting")
                reasons.append(f"opening {oid} is listed twice with different sizes")
            skipped.append(dict(opening_id=oid, reason="already deducted"))
            continue
        seen[oid] = d
        st = d.get("status", "calculated")
        if st != "calculated" or d.get("value") is None:
            statuses.append(st if st != "calculated" else "insufficient")
            reasons.append(f"opening {oid}: {d.get('reason') or 'size or count not resolved'}")
            continue
        if dimension(d["unit"]) != dimension(gross["unit"]):
            statuses.append("insufficient")
            reasons.append(f"opening {oid}: {d['unit']} can't be deducted from {gross['unit']}")
            continue
        applied.append(dict(opening_id=oid, value=convert(d["value"], d["unit"], gross["unit"]), unit=gross["unit"]))
    status = worst(statuses)
    if status != "calculated":
        return dict(status=status, quantity=None, reasons=reasons, applied=applied, skipped=skipped)
    total = sum((a["value"] for a in applied), Decimal(0))
    net = dec(gross["value"]) - total
    if net < 0:
        return dict(status="conflicting", quantity=None, reasons=[f"deductions ({total}) exceed the gross quantity ({gross['value']})"],
                    applied=applied, skipped=skipped)
    return dict(status="calculated", quantity=net, reasons=[], applied=applied, skipped=skipped)


def apply_multiplier(quantity, multiplier):
    """quantity x a floor/repeat multiplier. multiplier: dict(value, status,
    reason). An unsupported multiplier (unknown floor count) never multiplies."""
    if multiplier is None:
        return dict(status="calculated", quantity=quantity, reasons=[])
    st = multiplier.get("status", "calculated")
    v = multiplier.get("value")
    if st != "calculated" or v is None:
        return dict(status=st if st != "calculated" else "insufficient", quantity=None,
                    reasons=[multiplier.get("reason") or "the number of repeats is not supported by the drawing"])
    v = dec(v)
    if v != v.to_integral_value() or v < 1:
        return dict(status="insufficient", quantity=None, reasons=[f"repeat count {v} is not a whole number of at least 1"])
    return dict(status="calculated", quantity=quantity * v, reasons=[])


def output_value(d, places=4):
    """The output boundary: exact values pass through; only values with more
    than `places` decimals are rounded (half-up). Returns (float, rounded?)."""
    q = d.normalize()
    exp = -q.as_tuple().exponent if q.as_tuple().exponent < 0 else 0
    if exp <= places:
        return float(q), False
    return float(q.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)), True


# ---------------------------------------------------------------- floor-finish take-off

FINISH_CODE_HEAD = re.compile(r"^(?:FLOOR(?:ING)?|FLOOR\s+FINISH|FIN(?:ISH)?\.?\s*CODE|FLR)$", re.I)
FINISH_TEXT_HEAD = re.compile(r"^(?:FLOOR(?:ING)?\s+)?(?:FINISH|SPECIFICATION|MATERIAL)$", re.I)
SIZE_HEAD = re.compile(r"\b(?:SIZE|DIMENSIONS?|L\s*[xX×]\s*[WB])\b", re.I)
HEAD_UNIT = re.compile(r"\(?\b(mm|cm|m|ft|in)\b\)?", re.I)
CODE_LIKE = re.compile(r"^[A-Z]{1,4}[-/.]?[A-Z0-9]{1,4}$", re.I)
SPLIT = re.compile(r"\s*(?:/|\+|&|,|\bAND\b|\bOR\b)\s*", re.I)
SIZE_PAIR = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*$")


def _room_tables(tables):
    """Columnar schedules that carry rooms with a floor finish."""
    for t in tables:
        if t.get("kind") != "columnar" or "row_cells" not in t:
            continue
        head = [" ".join(h.split()) for h in t["header"]]
        code_col = next((i for i, h in enumerate(head) if FINISH_CODE_HEAD.match(h)), None)
        text_col = next((i for i, h in enumerate(head) if FINISH_TEXT_HEAD.match(h) and i != code_col), None)
        if code_col is None and text_col is None:
            continue
        yield t, head, code_col, text_col


def room_facts(tables):
    """Rooms read from finish schedules: identity, area (printed and/or from a
    printed size), finish, evidence. One fact per schedule row."""
    rooms = []
    for t, head, code_col, text_col in _room_tables(tables):
        kinds, units = t["kinds"], t.get("units") or [None] * len(head)
        id_cols = [i for i, k in enumerate(kinds) if k in ("tag", "label")]
        area_col = next((i for i, k in enumerate(kinds) if k == "area"), None)
        size_col = next((i for i, h in enumerate(head) if SIZE_HEAD.search(h)), None)
        size_unit = None
        if size_col is not None:
            m = HEAD_UNIT.search(re.sub(SIZE_HEAD, "", head[size_col]))
            size_unit = unit_of(m.group(1)) if m else None
        for ri, r in enumerate(t["row_cells"]):
            if r["total"]:
                continue
            cells = {int(k): v for k, v in r["cells"].items()}
            ident = [cells[i]["text"] for i in id_cols if i in cells]
            if not ident:
                continue
            ev = [dict(page=t["page"], bbox=c["bbox"], label=head[i]) for i, c in sorted(cells.items())]
            fact = dict(room=" — ".join(ident), code=cells[id_cols[0]]["text"] if id_cols and id_cols[0] in cells else ident[0],
                        page=t["page"], table=tuple(t["bbox"]), row=ri + 1, evidence=ev, area=None, area_problem=None,
                        derived=None, finish_codes=[], finish_text=None, table_check=None, area_unit=None)
            if area_col is not None:
                c = cells.get(area_col)
                unit = unit_of(units[area_col]) if units[area_col] else None
                fact["area_unit"] = unit
                if c is None:
                    fact["area_problem"] = f"nothing printed in column {head[area_col]}"
                elif unit is None:
                    fact["area_problem"] = f"column {head[area_col]} states no unit"
                else:
                    try:
                        v = dec(c["text"])
                        fact["area"] = measure(f"{fact['room']} area", v, unit, "observed", [dict(page=t["page"], bbox=c["bbox"], label=head[area_col])])
                        if v <= 0:
                            fact["area"], fact["area_problem"] = None, f"printed area {v} is not positive"
                    except QuantityError:
                        fact["area_problem"] = f"column {head[area_col]} reads {c['text']!r}, not a number"
            if size_col is not None and size_col in cells:
                m = SIZE_PAIR.match(cells[size_col]["text"])
                if m and size_unit:
                    evs = [dict(page=t["page"], bbox=cells[size_col]["bbox"], label=head[size_col])]
                    a, why = rect_area(measure("length", m.group(1), size_unit, evidence=evs), measure("width", m.group(2), size_unit, evidence=evs),
                                       fact["area"]["unit"] if fact["area"] else "sqm")
                    fact["derived"] = dict(value=a, problem=why, text=cells[size_col]["text"], size_unit=size_unit, evidence=evs)
                elif m:
                    fact["derived"] = dict(value=None, problem=f"the size column states no unit ({head[size_col]})", text=cells[size_col]["text"])
            if code_col is not None and code_col in cells:
                parts = [p for p in SPLIT.split(cells[code_col]["text"].strip()) if p]
                fact["finish_codes"] = parts if all(CODE_LIKE.match(p) for p in parts) else [" ".join(cells[code_col]["text"].split())]
            if text_col is not None and text_col in cells:
                fact["finish_text"] = " ".join(cells[text_col]["text"].split())
            if code_col is None and fact["finish_text"]:
                fact["finish_codes"] = [fact["finish_text"]]
            failing = [c for c in t.get("total_checks", []) if area_col is not None and c["column"] == " ".join(head[area_col].split())
                       and abs(dec(c["printed"]) - dec(c["row_sum"])) > 0]
            if failing:
                fact["table_check"] = failing[0]
            rooms.append(fact)
    return rooms


def _room_area(f):
    """(measure, status, reason) for one room's floor area."""
    a, d = f["area"], f["derived"]
    if a is not None and d is not None and d.get("value") is not None:
        printed_places = max(0, -a["value"].normalize().as_tuple().exponent)
        derived = d["value"].quantize(Decimal(1).scaleb(-printed_places), rounding=ROUND_HALF_UP)
        if derived != a["value"].normalize().quantize(Decimal(1).scaleb(-printed_places)):
            return None, "conflicting", f"{f['room']}: printed area {a['value']} {a['unit']} but printed size {d['text']} gives {d['value'].normalize()} {a['unit']}"
        return a, "calculated", None
    if a is not None:
        return a, "calculated", None
    if d is not None and d.get("value") is not None:
        return measure(f"{f['room']} area", d["value"], "sqm", "derived", d["evidence"]), "calculated", None
    reason = f["area_problem"] or (d or {}).get("problem") or "no area or size printed"
    return None, "insufficient", f"{f['room']}: {reason}"


def floor_finish_takeoff(tables, doc_name="drawing"):
    """Flooring quantity per floor finish = sum of the floor areas of the
    rooms that schedule assigns that finish. Returns quantity records."""
    facts = room_facts(tables)
    # one physical room may appear on more than one row (or sheet): identical
    # rows are one room; different readings are a conflict
    by_room = {}
    for f in facts:
        by_room.setdefault(f["code"].upper(), []).append(f)
    rooms = []
    for code, fs in sorted(by_room.items()):
        first = fs[0]
        sig = {(str(x["area"]["value"]) if x["area"] else None, x["area"]["unit"] if x["area"] else None, tuple(x["finish_codes"])) for x in fs}
        if len(sig) > 1:
            rooms.append(dict(first, conflict=f"{first['room']} is scheduled {len(fs)} times with different area or finish", copies=fs))
        else:
            rooms.append(dict(first, evidence=[e for x in fs for e in x["evidence"]], copies=fs))
    finishes = {}
    excluded = []
    for r in rooms:
        codes = r["finish_codes"]
        if not codes:
            excluded.append(dict(room=r["room"], reason="no floor finish given in the schedule"))
            continue
        for c in codes:
            finishes.setdefault(c, []).append(r)
    records = []
    for code in sorted(finishes):
        rs = sorted(finishes[code], key=lambda r: (r["page"], r["row"]))
        statuses, reasons, parts, included, deps = [], [], [], [], []
        texts = sorted({r["finish_text"] for r in rs if r["finish_text"]})
        for r in rs:
            deps.append(dict(kind="schedule_row", key=f"page {r['page']} row {r['row']}", room=r["room"]))
            if r.get("conflict"):
                statuses.append("conflicting"); reasons.append(r["conflict"]); continue
            if len(r["finish_codes"]) > 1:
                statuses.append("ambiguous")
                reasons.append(f"{r['room']} lists {len(r['finish_codes'])} floor finishes ({' / '.join(r['finish_codes'])}); its area isn't split between them")
                continue
            m, st, why = _room_area(r)
            if st != "calculated":
                statuses.append(st); reasons.append(why); continue
            parts.append(m); included.append(r["room"])
            if r["table_check"]:
                c = r["table_check"]
                statuses.append("pending_review")
                reasons.append(f"the schedule's printed total ({c['printed']:g}) differs from the sum of its rows ({c['row_sum']:g}), so a printed room area may be wrong")
        reasons = list(dict.fromkeys(reasons))  # one reason per cause, not per room
        # the schedule's own area unit; sqm (exact conversion) only when rooms mix units
        units = sorted({m["unit"] for m in parts} | {r["area_unit"] for r in rs if r["area_unit"]})
        unit = units[0] if len(units) == 1 else "sqm"
        status = worst(statuses)
        name = f"Flooring {code}" + (f" — {texts[0]}" if len(texts) == 1 and texts[0] != code else "")
        if len(texts) > 1:
            reasons.append(f"rooms give different descriptions for {code}: {'; '.join(texts)}")
        common = dict(key=f"FLOOR:{code}", boq_item=name, element_type="floor_finish", unit=unit,
                      method="sum of the floor areas the schedule assigns this finish (printed areas; areas from printed sizes where no area is printed)",
                      formula="SUM_OF_SEGMENTS" if len(parts) > 1 else "UNIT_CONVERSION", inputs=parts, included=included,
                      dependencies=deps,
                      deductions=[dict(note="none: a schedule area is the room's floor area; no openings or fixtures are deducted from it")])
        if status == "calculated":
            records.append(quantity_record(status="calculated", quantity=sum_measures(parts, unit), reasons=[], **common))
        else:
            cands = []
            if status == "pending_review" and parts:
                cands = [dict(value=sum_measures(parts, unit), unit=unit, basis="sum of the printed room areas")]
            records.append(quantity_record(status=status, reasons=reasons, candidates=cands, **common))
    if excluded:
        # rooms the schedule gives no floor finish: reported, never dropped
        records.append(quantity_record(key="FLOOR:(no finish)", boq_item="Flooring — rooms with no floor finish in the schedule",
                                       element_type="floor_finish", unit="sqm", method="none", formula="none", inputs=[],
                                       status="insufficient", excluded=excluded,
                                       reasons=[f"{len(excluded)} room(s) have no floor finish in the schedule: " + ", ".join(e["room"] for e in excluded)]))
    return records, dict(rooms=len(rooms), excluded=excluded)


def skirting_takeoff(tables):
    """Skirting needs room perimeters, which a finish schedule does not print.
    Each skirting type the schedule names is reported as insufficient; its
    length is never estimated or scaled off the drawing."""
    out = []
    for t, head, _c, _t in _room_tables(tables):
        col = next((i for i, h in enumerate(head) if re.match(r"^SKIRTING|^DADO|^BASE", h, re.I)), None)
        if col is None:
            continue
        kinds = {}
        for ri, r in enumerate(t["row_cells"]):
            cells = {int(k): v for k, v in r["cells"].items()}
            if r["total"] or col not in cells:
                continue
            kinds.setdefault(" ".join(cells[col]["text"].split()), []).append(ri + 1)
        for k in sorted(kinds):
            out.append(quantity_record(key=f"SKIRT:{k}", boq_item=f"Skirting — {k}", element_type="skirting", unit="m",
                                       method="room perimeter less door openings", formula="none", inputs=[], status="insufficient",
                                       reasons=["room perimeters are not printed in the schedule; skirting length can't be derived without measuring the plan, "
                                                "which this engine does not do"],
                                       dependencies=[dict(kind="schedule_row", key=f"page {t['page']} row {r}") for r in kinds[k]]))
    return out


# ---------------------------------------------------------------- openings take-off

TAG_MARK = re.compile(r"^([A-Z]{1,3})-?(\d{1,3}[A-Z]?)$")
COUNT_UNITS = {"nos", "nr", "no", "no.", "nos.", "count", "each", "ea"}
OPENING_KIND = {"D": "Door", "W": "Window", "V": "Ventilator", "SD": "Sliding door", "FD": "Fire door"}


def _mark(key):
    m = TAG_MARK.match((key or "").strip())
    return f"{m.group(1)}{m.group(2)}" if m else None


def _boxes(item, label=None):
    return [dict(page=e.get("page", (item.get("source") or {}).get("page")), bbox=e["bbox"], label=label or e.get("label", ""))
            for e in (item.get("source") or {}).get("evidence", []) if e.get("bbox")]


def opening_sizes(schedule_items):
    """{mark: size fact} from the schedule reader's door/window items
    (key 'SCHED:<mark>'). A size is resolved only when the schedule printed
    exactly one width and one height."""
    out = {}
    for it in schedule_items:
        key = it.get("key", "")
        if not key.startswith("SCHED:") or key.count(":") != 1:
            continue
        mark = _mark(key[6:])
        if not mark:
            continue
        notes = it.get("notes") or ""
        fact = dict(mark=mark, name=it.get("specification") or it.get("item"), evidence=_boxes(it), status=None, width=None, height=None,
                    candidates=[], reason=None)
        cd = it.get("calculation_data")
        if it.get("status") == "MEASURED" and cd and cd.get("formula") == "LENGTH_TIMES_WIDTH" and len(cd["inputs"]) == 2:
            w, h = cd["inputs"]
            fact.update(status="calculated", width=measure(f"{mark} width", w["value"], w["unit"], "observed", fact["evidence"]),
                        height=measure(f"{mark} height", h["value"], h["unit"], "observed", fact["evidence"]))
        elif it.get("candidates"):
            fact.update(status="conflicting", candidates=[dict(value=dec(c["value"]), unit=unit_of(c.get("unit")) or "sqm", basis=c.get("basis", "")) for c in it["candidates"]],
                        reason=f"schedule prints more than one size for {mark}: {notes}")
        elif "no row in any schedule" in notes:
            fact.update(status="insufficient", reason=f"{mark} has no row in any schedule found, so its size is unknown")
        else:
            fact.update(status="insufficient", reason=f"schedule gives no usable size for {mark}: {notes or 'nothing printed'}")
        out[mark] = fact
    return out


def opening_counts(count_items):
    """{mark: count fact} from any instance counter's analysis items (one per
    mark, or one per mark per floor). Floors add up only when every one is
    resolved; a count check that disagrees, or two items for one mark on one
    floor, is a conflict. Nothing is guessed from a pending count."""
    groups, checks = {}, {}
    for it in count_items:
        key = it.get("key", "")
        if key.startswith("CHECK:count:"):
            checks.setdefault(_mark(key[12:]) or key[12:], []).append(it)
            continue
        mark = _mark(key)
        if not mark or (it.get("unit") or "").strip().lower() not in COUNT_UNITS:
            continue
        groups.setdefault(mark, []).append(it)
    out = {}
    for mark in sorted(set(groups) | set(checks)):
        its = groups.get(mark, [])
        ev = [b for it in its for b in _boxes(it)]
        floors = [it.get("location") or "" for it in its]
        reasons, status, candidates = [], "calculated", []
        if len(set(floors)) != len(floors):
            status = "conflicting"
            reasons.append(f"{mark} is counted more than once for the same floor ({len(its)} count items)")
        pending = [it for it in its if it.get("status") != "MEASURED" or it.get("quantity") is None]
        if pending:
            status = worst([status, "pending_review"])
            reasons += [f"{mark} count unresolved upstream: {(it.get('notes') or 'no reason given').strip()}" for it in pending]
            if len(its) == 1 and pending[0].get("candidates"):
                candidates = [dict(value=dec(c["value"]), basis=c.get("basis", "")) for c in pending[0]["candidates"]]
        for c in checks.get(mark, []):
            status = "conflicting"
            reasons.append(f"{c.get('item') or 'count check'}: {c.get('notes') or ''}".strip())
            candidates = [dict(value=dec(x["value"]), basis=x.get("basis", "")) for x in c.get("candidates", [])]
        n = sum(int(it["quantity"]) for it in its) if status == "calculated" else None
        out[mark] = dict(mark=mark, status=status if its else "insufficient", count=n, evidence=ev, reasons=reasons if its else [f"no count item for {mark}"],
                         candidates=candidates, floors=[f or "(floor not stated)" for f in floors])
    return out


def openings_takeoff(schedule_items, count_items):
    """Per door/window type: a joinery line (count, in nos, described with
    its scheduled size) and an opening-area line (per-unit width x height x
    count, in sqm: the shutter/opening area, and the deduction a wall-finish
    take-off will need). Each line is calculated only when both its count
    and its size are resolved; otherwise it carries the reasons and, where
    one side is known, candidates."""
    sizes, counts = opening_sizes(schedule_items), opening_counts(count_items)
    records = []
    for mark in sorted(set(sizes) | set(counts), key=lambda m: (TAG_MARK.match(m).group(1), int(re.match(r"\d+", TAG_MARK.match(m).group(2)).group(0)), m)):
        size = sizes.get(mark) or dict(status="insufficient", reason=f"{mark} is counted but has no row in any schedule found", candidates=[], evidence=[],
                                       width=None, height=None, name=None)
        cnt = counts.get(mark) or dict(status="insufficient", count=None, reasons=[f"{mark} is scheduled but no count was supplied for it"],
                                       candidates=[], evidence=[], floors=[])
        kind = OPENING_KIND.get(TAG_MARK.match(mark).group(1), "Opening")
        size_text = None
        if size["status"] == "calculated":
            w_mm, h_mm = convert(size["width"]["value"], size["width"]["unit"], "mm"), convert(size["height"]["value"], size["height"]["unit"], "mm")
            size_text = f"{w_mm.normalize():f} x {h_mm.normalize():f} mm"
        label = " ".join(x for x in [f"{kind} {mark}", "—" if size.get("name") or size_text else "", ", ".join(x for x in [
            (size.get("name") or "").split(" (")[0] or None, size_text] if x)] if x)
        count_m = measure(f"{mark} count", cnt["count"], "nos", "derived", cnt["evidence"]) if cnt["count"] is not None else None
        deps = [dict(kind="instance_count", key=mark, status=cnt["status"], floors=cnt.get("floors", [])),
                dict(kind="schedule_size", key=f"SCHED:{mark}", status=size["status"])]
        size_reasons = [size["reason"]] if size.get("reason") else []
        # joinery line: the count is the quantity; the size completes its description
        j_status = worst([cnt["status"], "pending_review" if size["status"] != "calculated" else "calculated"])
        j_reasons = cnt["reasons"] + ([f"size not resolved: {size_reasons[0]}"] if size_reasons else [])
        j_cands = [dict(value=dec(cnt["count"]), unit="nos", basis="tags counted on floor plans; the size is unresolved")] \
            if cnt["status"] == "calculated" and j_status != "calculated" else \
            [dict(value=c["value"], unit="nos", basis=c["basis"]) for c in cnt["candidates"]]
        records.append(quantity_record(key=mark, boq_item=label, element_type="joinery", unit="nos", method="instances counted on floor plans",
                                       formula="none", inputs=[count_m] if count_m else [], status=j_status,
                                       quantity=dec(cnt["count"]) if j_status == "calculated" else None, reasons=[] if j_status == "calculated" else j_reasons,
                                       dependencies=deps, candidates=[] if j_status == "calculated" else j_cands))
        # opening area: per-unit area x count (QUANTITY_PER_UNIT_TIMES_UNIT_COUNT)
        a_status = worst([cnt["status"], size["status"]])
        inputs, a_cands = [], []
        if size["status"] == "calculated":
            unit_area, _ = rect_area(size["width"], size["height"])
            inputs.append(measure(f"{mark} area of one opening ({size_text})", unit_area, "sqm", "derived", size["evidence"]))
        if count_m:
            inputs.append(count_m)
        if a_status != "calculated":
            if size["status"] == "calculated" and cnt["candidates"]:
                a_cands = [dict(value=inputs[0]["value"] * c["value"], unit="sqm", basis=f"one opening x {c['value']} ({c['basis']})") for c in cnt["candidates"]]
            elif cnt["status"] == "calculated" and size["candidates"]:
                a_cands = [dict(value=c["value"] * cnt["count"], unit="sqm", basis=f"{c['basis']} x {cnt['count']} counted") for c in size["candidates"]
                           if c["unit"] == "sqm"]
        records.append(quantity_record(key=f"AREA:{mark}", boq_item=f"{label} — opening area", element_type="opening_area", unit="sqm",
                                       method="area of one opening (scheduled width x height) x openings counted on floor plans",
                                       formula="QUANTITY_PER_UNIT_TIMES_UNIT_COUNT", inputs=inputs, status=a_status,
                                       quantity=inputs[0]["value"] * count_m["value"] if a_status == "calculated" else None,
                                       reasons=[] if a_status == "calculated" else list(dict.fromkeys(cnt["reasons"] + size_reasons)),
                                       dependencies=deps, candidates=a_cands,
                                       deductions=[dict(note="none: the opening area itself; it is the deduction a wall-finish take-off applies")]))
    return records


# ---------------------------------------------------------------- output

ANALYSIS_STATUS = {"calculated": "MEASURED"}
# formulas the app can recompute (analysisSchemaV1.ts CALCULATION_FORMULA_IDS); anything else travels as text only
APP_FORMULAS = ("SUM_OF_SEGMENTS", "UNIT_CONVERSION", "LENGTH_TIMES_WIDTH", "COUNT_TIMES_MULTIPLIER", "QUANTITY_PER_UNIT_TIMES_UNIT_COUNT")


def to_analysis_item(rec, doc_name="drawing", page_size=None):
    """A cunstruct.analysis.v1 item. MEASURED only for a calculated record;
    every other status is PENDING with its reasons (and candidates). The
    calculation travels as calculation_data when its formula is in the app's
    allowlist, and always as readable text."""
    q, rounded = (output_value(rec["quantity"]) if rec["quantity"] is not None else (None, False))
    ev = []
    for m in rec["inputs"]:
        for e in m["evidence"]:
            ev.append(dict(page=e["page"], bbox=[round(v, 2) for v in e["bbox"]], label=f"{m['name']}: {e.get('label', '')}".strip(": "), claim="quantity"))
    pages = sorted({e["page"] for e in ev})
    item = dict(key=rec["key"], item=rec["boq_item"], quantity=q, unit=rec["unit"], status=ANALYSIS_STATUS.get(rec["status"], "PENDING"),
                location=None, confidence=None,
                source=dict(document_id=None, document=f"{doc_name}" + (f" page {pages[0]}" if pages else ""), page=pages[0] if pages else None,
                            evidence=ev, **({"pageSize": page_size} if page_size else {})))
    if rec["inputs"]:
        terms = " + ".join(f"{m['name']} {m['value'].normalize():f} {m['unit']}" + (" (from printed size)" if m["kind"] == "derived" else "") for m in rec["inputs"])
        item["calculation"] = f"{rec['method']}: {terms}" + (f" = {rec['quantity'].normalize():f} {rec['unit']}" if rec["quantity"] is not None else "") + \
            f". {rec['deductions'][0]['note'] if rec['deductions'] and 'note' in rec['deductions'][0] else ''} [{rec['calc_version']}]"
    if rec["status"] == "calculated" and rec["formula"] in APP_FORMULAS and rec["inputs"]:
        # the app's validator calls a dimensionless count "count" (measurementValidator.ts)
        item["calculation_data"] = dict(formula=rec["formula"], inputs=[dict(name=m["name"], value=float(m["value"]), unit="count" if m["unit"] == "nos" else m["unit"])
                                                                        for m in rec["inputs"]])
    notes = []
    if rec["status"] != "calculated":
        notes.append(f"{rec['status'].replace('_', ' ').capitalize()}: " + "; ".join(r.strip().rstrip(".") for r in rec["reasons"]) + ".")
    if rec["excluded"]:
        notes.append("Not included: " + "; ".join(f"{e['room']} ({e['reason']})" for e in rec["excluded"]) + ".")
    if rounded:
        notes.append(f"Unrounded: {rec['quantity'].normalize():f} {rec['unit']}.")
    if notes:
        item["notes"] = " ".join(notes)
    if rec["candidates"]:
        item["candidates"] = [dict(value=output_value(c["value"])[0], unit=c["unit"], basis=c["basis"]) for c in rec["candidates"]]
    return item
