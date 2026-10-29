"""Schedule tables from words and ruling lines, whatever the source.

Pure: no files, no OCR, no network. A source adapter (schedule_sources.py)
supplies, per page, the words (PDF text layer, OCR or CAD text) and the
straight horizontal and vertical line segments; this module finds schedule
tables in them and turns each row into cunstruct.analysis.v1 items.

Two table shapes:
  * columnar: a header row names the columns (TAG, QTY, SFT, SIZE, RATE ...);
    each body cell is read from its column. Quantities come only from count,
    area and item-type count columns. Money columns (rate, amount, value,
    premium, Rs/...) are never read as quantities.
  * graphical: a column of tags (D1, D2 ... / W1 ...), one per ruled row, each
    row drawn as an elevation with its size dimensioned. A size is MEASURED
    only when the row prints exactly one width and one height.

Rules that hold everywhere:
  * every tagged row becomes an item; a value that can't be read, or that
    has two printed readings, is PENDING with every candidate;
  * a printed TOTAL is checked against the sum of its column; a mismatch
    becomes a PENDING inconsistency item with both values;
  * a tag that appears on the drawing but has no schedule row is reported
    as a PENDING item, not left out;
  * nothing is scaled off a drawing and no value is invented.

Coordinates: page units with y increasing downward (PDF points; DXF y is
flipped by the adapter).
"""
import re
from statistics import median

# ---------------------------------------------------------------- vocabulary

TAG = re.compile(r"^([A-Z]{1,3})-?(\d{1,3}[A-Z]?)$")
NUMBER = re.compile(r"^\d{1,3}(?:,\d{3})+(?:\.\d+)?$|^\d+(?:\.\d+)?$")
SIZE_PAIR = re.compile(r"(\d{3,5})\s*[xX×]\s*(\d{3,5})")
MONEY = re.compile(r"\bRS\b|\bINR\b|RATE|AMOUNT|VALUE|PREMIUM|COST|PRICE|₹|\$|/\s*(?:SFT|SQ\.?\s*FT|SQFT|SQM|M2|NOS?|UNIT)", re.I)
AREA_UNITS = ((re.compile(r"\bS\.?\s*F\.?\s*T\b|\bSQ\.?\s*FT\b|\bSQFT\b|\bFT2\b", re.I), "sqft"),
              (re.compile(r"\bSQ\.?\s*M\b|\bSQM\b|\bM2\b|M²", re.I), "m2"))
AREA_WORD = re.compile(r"\bAREA\b", re.I)
COUNT_HEAD = re.compile(r"^(QTY|QUANTITY|NOS?\.?|NUMBER|COUNT)$", re.I)
DIM_HEAD = re.compile(r"^(SIZE|WIDTH|HEIGHT|DIMENSIONS?|W\s*[xX×]\s*H)\b", re.I)
TAG_HEAD = re.compile(r"^(TAG|MARK|CODE|REF\.?|TYPE|ID)$", re.I)
SERIAL_HEAD = re.compile(r"^(S\.?\s*NO\.?|SL\.?\s*NO\.?|SR\.?\s*NO\.?|SERIAL(\s+NO\.?)?|S\.?\s*N\.?)$", re.I)
# a column headed DOOR / WINDOW may hold the marks themselves; its cells decide (see _retag)
OPENING_HEAD = re.compile(r"^(DOORS?|WINDOWS?|VENTILATORS?|OPENINGS?)$", re.I)
WIDTH_HEAD = re.compile(r"^(WIDTH|WD\.?)(\s*\(\s*MM\s*\)|\s+MM|\s+IN\s+MM)?$", re.I)
HEIGHT_HEAD = re.compile(r"^(HEIGHT|HT\.?)(\s*\(\s*MM\s*\)|\s+MM|\s+IN\s+MM)?$", re.I)
# a sheet note stating the unit of every dimension, e.g. "ALL DIMENSIONS ARE IN MILLIMETERS"
UNIT_NOTE = re.compile(r"DIMENSIONS?\s+(?:ARE\s+|IS\s+)?(?:GIVEN\s+)?IN\s+(MM|MILLIMET(?:ER|RE)S?)\b", re.I)
LABEL_HEAD = re.compile(r"^(DESCRIPTION|SPACE|ROOM|ITEM|NAME|LOCATION|ELEMENT)$", re.I)
TOTAL = re.compile(r"^(GRAND\s+)?TOTAL\b", re.I)
KIND_NAME = {"D": "Door", "W": "Window", "V": "Ventilator", "DW": "Door-window", "SD": "Sliding door", "FD": "Fire door"}
# marks that name openings; a schedule of other marks (beams, slabs) is not an opening schedule
OPENING_PREFIXES = frozenset(KIND_NAME)


def tag_of(text):
    m = TAG.match(text.strip())
    return (m.group(1), m.group(2)) if m else None


def number(text):
    t = text.strip()
    return float(t.replace(",", "")) if NUMBER.match(t) else None


def header_kind(label):
    """(kind, unit) for one header cell. Money is checked first so 'Rs/SFT'
    is a rate, never an area."""
    s = " ".join(label.split())
    if MONEY.search(s):
        return "money", None
    for rx, unit in AREA_UNITS:
        if rx.search(s):
            return "area", unit
    if AREA_WORD.search(s):
        return "area", None  # area with no stated unit: values stay PENDING
    if SERIAL_HEAD.match(s):
        return "serial", None  # a row number: never a quantity
    if COUNT_HEAD.match(s):
        return "count", "nr"
    if OPENING_HEAD.match(s):
        return "opening", None
    if DIM_HEAD.match(s):
        return "dimension", "mm"
    if TAG_HEAD.match(s):
        return "tag", None
    if LABEL_HEAD.match(s):
        return "label", None
    return "other", None


# ---------------------------------------------------------------- geometry

def word_height(words):
    hs = [w["y1"] - w["y0"] for w in words if not w.get("vertical") and w["y1"] > w["y0"]]
    return median(hs) if hs else 1.0


def lines_of(words, h):
    """Words grouped by baseline (horizontal words only), top to bottom."""
    out = []
    for w in sorted((w for w in words if not w.get("vertical")), key=lambda w: ((w["y0"] + w["y1"]) / 2, w["x0"])):
        cy = (w["y0"] + w["y1"]) / 2
        if out and abs(out[-1]["cy"] - cy) <= 0.5 * h:
            out[-1]["words"].append(w)
        else:
            out.append(dict(cy=cy, words=[w]))
    for l in out:
        l["words"].sort(key=lambda w: w["x0"])
    return out


def phrases(line_words, h, gap=1.2):
    """Adjacent words on one line joined into cells (gap < gap*h)."""
    cells = []
    for w in line_words:
        if cells and w["x0"] - cells[-1]["x1"] < gap * h:
            c = cells[-1]
            c.update(t=c["t"] + " " + w["t"], x1=max(c["x1"], w["x1"]), y0=min(c["y0"], w["y0"]), y1=max(c["y1"], w["y1"]))
            c["words"].append(w)
        else:
            cells.append(dict(t=w["t"], x0=w["x0"], x1=w["x1"], y0=w["y0"], y1=w["y1"], words=[w]))
    return cells


def covered(segs, lo, hi):
    """Length of [lo, hi] covered by the union of segments (a, b)."""
    total, cur = 0.0, None
    for a, b in sorted((max(a, lo), min(b, hi)) for a, b in segs if min(b, hi) > max(a, lo)):
        if cur and a <= cur[1]:
            cur = (cur[0], max(cur[1], b))
        else:
            if cur:
                total += cur[1] - cur[0]
            cur = (a, b)
    return total + (cur[1] - cur[0] if cur else 0.0)


def row_rules(hsegs, x0, x1, col_lines, h, y_lo=float("-inf"), y_hi=float("inf")):
    """y of every horizontal rule that separates schedule rows: its joined
    segments cover >= 50% of the table width and it starts at the table's
    left border or at a full-height column line (a merged cell leaves the
    rule starting at a column line). Short dimension lines inside a row's
    elevation fail both tests."""
    by_y = {}
    for y, a, b in hsegs:
        if y_lo <= y <= y_hi and min(b, x1) > max(a, x0):
            by_y.setdefault(round(y / (0.15 * h)), []).append((y, a, b))
    ys = []
    for group in by_y.values():
        segs = [(a, b) for _, a, b in group]
        start = min(max(a, x0) for a, _ in segs)
        if covered(segs, x0, x1) >= 0.5 * (x1 - x0) and (start <= x0 + 1.5 * h or any(abs(start - c) <= 0.5 * h for c in col_lines)):
            ys.append(sum(y for y, _, _ in group) / len(group))
    out = []
    for y in sorted(ys):
        if not out or y - out[-1] > 0.3 * h:
            out.append(y)
    return out


def spanning(vsegs, y0, y1, frac=0.9):
    """x of vertical lines spanning >= frac of [y0, y1] (joined segments)."""
    by_x = {}
    for x, a, b in vsegs:
        by_x.setdefault(round(x), []).append((a, b))
    return sorted(x for x, segs in by_x.items() if covered(segs, y0, y1) >= frac * (y1 - y0))


def bbox_of(ws):
    return [min(w["x0"] for w in ws), min(w["y0"] for w in ws), max(w["x1"] for w in ws), max(w["y1"] for w in ws)]


# ---------------------------------------------------------------- items

def evidence(page, box, label, claim="quantity"):
    return dict(page=page, bbox=[round(v, 2) for v in box], label=label, claim=claim)


def item(key, name, qty, unit, page, ev, doc, page_size, **extra):
    status = "MEASURED" if qty is not None else "PENDING"
    src = dict(document_id=None, document=doc, page=page, evidence=ev)
    if page_size:
        src["pageSize"] = page_size
    return dict(key=key, item=name, quantity=qty, unit=unit, status=status, location=None, confidence=None, source=src, **extra)


# ---------------------------------------------------------------- graphical schedules

def tag_columns(words, h):
    """Groups of >= 2 distinct tags with one prefix whose left edges align."""
    tags = [(tag_of(w["t"]), w) for w in words if not w.get("vertical") and tag_of(w["t"])]
    cols = []
    for (pre, _), w in sorted(tags, key=lambda t: (t[0][0], t[1]["x0"])):
        for c in cols:
            if c["prefix"] == pre and abs(c["x"] - w["x0"]) <= 1.5 * h:
                c["words"].append(w)
                break
        else:
            cols.append(dict(prefix=pre, x=w["x0"], words=[w]))
    return [c for c in cols if len({w["t"] for w in c["words"]}) >= 2]


def graphical_tables(page, words, hsegs, vsegs, h):
    """Tag-column schedules bounded by ruling lines. Each tag must sit in its
    own ruled row; a column of tags without those rules (tags on a plan
    lined up by chance) is not a schedule."""
    found = []
    if not any("SCHEDULE" in w["t"].upper() for w in words):
        return found  # a graphical schedule is titled; elevations with tags are not schedules
    for col in tag_columns(words, h):
        ws = sorted(col["words"], key=lambda w: w["y0"])
        ty0, ty1 = ws[0]["y0"], ws[-1]["y1"]
        tx = min(w["x0"] for w in ws)
        span = spanning(vsegs, ty0, ty1)
        lefts = [x for x in span if x < tx]
        rights = [x for x in span if x > max(w["x1"] for w in ws)]
        if not lefts or not rights:
            continue
        x0 = max(lefts)
        near = (ty0 - 40 * h, ty1 + 40 * h)
        # the table's right edge is where its own horizontal rules end (rules
        # starting at its left border), so a title block beside it is outside
        ends = [b for y, a, b in hsegs if abs(a - x0) <= 1.5 * h and near[0] <= y <= near[1]]
        inside = [x for x in rights if ends and x <= max(ends) + 1.5 * h]
        if not inside:
            continue
        x1 = max(inside)
        cols_in = [x for x in span if x0 <= x <= x1]
        ys = row_rules(hsegs, x0, x1, cols_in, h, *near)
        bands = []
        for w in ws:
            cy = (w["y0"] + w["y1"]) / 2
            above = [y for y in ys if y <= cy]
            below = [y for y in ys if y > cy]
            bands.append((w, (above[-1], below[0]) if above and below else None))
        own = [b for _, b in bands if b]
        inferred = False
        if len(own) < len(ws) or len(set(own)) != len(own):
            # no rule between some rows: split at the tag spacing, from the
            # table's top and bottom rules (each tag heads its own row)
            top = [y for y in ys if y < ty0]
            bot = [y for y in ys if y > ty1]
            if not top or not bot:
                continue
            off = ws[0]["y0"] - top[-1]
            starts = [top[-1]] + [w["y0"] - off for w in ws[1:]]
            bands = [(w, (a, b)) for w, a, b in zip(ws, starts, starts[1:] + [bot[0]])]
            if any(b <= a for _, (a, b) in bands):
                continue
            inferred = True
        own = [b for _, b in bands]
        bx0, by0, bx1, by1 = x0, min(b[0] for b in own), x1, max(b[1] for b in own)
        # a column-header row over the tags decides what the table is: with a
        # size column it is a columnar schedule (read by columnar_tables); a
        # header naming views ('NO. NAME PLAN VIEW ELEVATION VIEW') or a
        # SCHEDULE title close by makes it a graphical schedule. Tags lined up
        # on a plan have neither.
        region = [w for w in words if bx0 - 2 * h <= w["x0"] <= bx1 and by0 - 25 * h <= w["y0"] <= by1]
        heads = header_lines(lines_of(region, h), h)
        if any(c["kind"] == "dimension" for hd_ in heads for c in hd_["cells"]):
            continue
        width = max(bx1 - bx0, h)
        titled = any("SCHEDULE" in w["t"].upper() and bx0 - 0.5 * width <= (w["x0"] + w["x1"]) / 2 <= bx1 + 0.5 * width
                     and by0 - 30 * h <= w["y1"] <= by1 for w in words)
        if not heads and not titled:
            continue
        found.append(dict(page=page, kind="graphical", prefix=col["prefix"], rows_inferred=inferred,
                          bbox=[x0, min(b[0] for b in own), x1, max(b[1] for b in own)], rows=bands))
    return found


def read_graphical(t, words, h, doc, page_size):
    items, seen = [], []
    x0, _, x1, _ = t["bbox"]
    for tw, band in t["rows"]:
        tg = tw["t"].replace("-", "")
        kind = KIND_NAME.get(t["prefix"], "Type")
        key = f"SCHED:{tg}"
        if band is None:
            items.append(item(key, f"{kind} {tg} opening area", None, "m2", t["page"], [evidence(t["page"], [tw["x0"], tw["y0"], tw["x1"], tw["y1"]], f"{tg} row")], doc, page_size,
                              notes="Schedule row boundaries not found; check the drawing."))
            continue
        top, bot = band
        inb = [w for w in words if w is not tw and top < (w["y0"] + w["y1"]) / 2 < bot and w["x0"] >= x0 and w["x1"] <= x1 + h]
        seen.append(tg)
        name = " ".join(w["t"] for w in sorted(inb, key=lambda w: (round(w["y0"] / h), w["x0"]))
                        if not w.get("vertical") and re.fullmatch(r"[A-Z][A-Z&/\-.']+", w["t"]) and not tag_of(w["t"]))
        dims = [w for w in inb if re.fullmatch(r"\d{3,4}", w["t"])]
        widths = sorted({int(w["t"]) for w in dims if not w.get("vertical")})
        heights = sorted({int(w["t"]) for w in dims if w.get("vertical")})
        row_box = [x0, top, x1, bot]
        label = f"{name.title() or kind} ({tg})"
        ev = [evidence(t["page"], row_box, f"schedule row {tg}" + (" (row edges from tag spacing; no drawn row rule)" if t.get("rows_inferred") else ""))] + [evidence(t["page"], [w["x0"], w["y0"], w["x1"], w["y1"]], f"{'height' if w.get('vertical') else 'width'} {w['t']}", "dimension") for w in dims]
        base_name = f"{kind} {tg} opening area — {name}" if name else f"{kind} {tg} opening area"
        if len(widths) == 1 and len(heights) == 1:
            w_, h_ = widths[0], heights[0]
            items.append(item(key, base_name, round(w_ * h_ / 1e6, 6), "m2", t["page"], ev, doc, page_size, dimension=f"{w_} x {h_} mm",
                              specification=label, notes="Area of one opening, from the schedule's printed width and height. Not a count of openings.",
                              calculation_data=dict(formula="LENGTH_TIMES_WIDTH", inputs=[dict(name="width", value=w_ / 1000, unit="m"), dict(name="height", value=h_ / 1000, unit="m")])))
        elif not widths and not heights:
            items.append(item(key, base_name, None, "m2", t["page"], ev, doc, page_size, specification=label,
                              notes="No size printed in this schedule row; check the drawing."))
        else:
            cands = [dict(value=round(a * b / 1e6, 6), unit="m2", basis=f"width {a} x height {b} printed in schedule row {tg}") for a in widths for b in heights]
            why = []
            if len(widths) != 1:
                why.append(f"{len(widths)} widths printed ({', '.join(map(str, widths))})" if widths else "no horizontal (width) dimension identified")
            if len(heights) != 1:
                why.append(f"{len(heights)} heights printed ({', '.join(map(str, heights))})" if heights else "no vertical (height) dimension identified")
            items.append(item(key, base_name, None, "m2", t["page"], ev, doc, page_size, specification=label,
                              notes=f"Not one size: {'; '.join(why)}. Pick the opening size on review (e.g. leaf vs frame).",
                              **({"candidates": cands} if len(cands) > 1 else {})))
    return items, seen


# ---------------------------------------------------------------- columnar schedules

def header_lines(lines, h):
    """Lines holding a header: >= 3 cells, >= 2 of a known kind, one of them
    a tag or label column. A line may hold several tables side by side; it is
    split where the gap between cells is far wider than the usual gap."""
    out = []
    for l in lines:
        cells = phrases(l["words"], h)
        if len(cells) < 3:
            continue
        gaps = [b["x0"] - a["x1"] for a, b in zip(cells, cells[1:])]
        cut = 4 * median(gaps) if gaps else 0
        groups, cur = [], [cells[0]]
        for g, c in zip(gaps, cells[1:]):
            if g > cut and g > 6 * h:
                groups.append(cur); cur = [c]
            else:
                cur.append(c)
        groups.append(cur)
        for g in groups:
            kinds = [header_kind(c["t"]) for c in g]
            known = [k for k, _ in kinds if k != "other"]
            if len(g) >= 3 and len(known) >= 2 and ({"tag", "label", "opening"} & set(known)):
                out.append(dict(cy=l["cy"], cells=[dict(c, kind=k, unit=u) for c, (k, u) in zip(g, kinds)]))
    return out


def columnar_tables(page, words, hsegs, vsegs, h):
    lines = lines_of(words, h)
    found = []
    headers = header_lines(lines, h)
    for hd in headers:
        cells = hd["cells"]
        x0 = cells[0]["x0"] - 2 * h
        x1 = cells[-1]["x1"] + 12 * h
        span = spanning(vsegs, hd["cy"] - h, hd["cy"] + h, 0.5)
        lefts = [x for x in span if x <= cells[0]["x0"] + 0.5 * h and x >= cells[0]["x0"] - 4 * h]
        x0 = max(lefts) if lefts else x0
        bounds = []
        for i, c in enumerate(cells):
            a = c["x0"] - h if i == 0 else bounds[-1][1]
            if i + 1 < len(cells):
                nxt = cells[i + 1]
                inside = [x for x in span if c["x1"] - 0.2 * h <= x <= nxt["x0"] + 0.2 * h]
                b = inside[0] if inside else nxt["x0"] - 0.5 * h
            else:
                b = x1
            bounds.append((a, b))
        # body: following lines inside the table, until a gap or a line whose
        # identity column is empty (continuation lines are joined to the row
        # above). The identity column is the first code or name column, not
        # column 0: a SYMBOL column prints graphics, never text.
        id0 = next(i for i, c in enumerate(cells) if c["kind"] in ("tag", "label", "opening"))
        # a ruled table: rows are the bands between its own row rules (a cell
        # may wrap over several lines, and a value need not share a baseline
        # with its description); the table ends at its last rule
        ends = [b for y, a, b in hsegs if abs(a - x0) <= 1.5 * h and y > hd["cy"]]
        rx1 = min(x1, max(ends)) if ends else x1
        ys = [y for y in row_rules(hsegs, x0, rx1, span, h, hd["cy"], float("inf"))]
        # keep the run of rules that starts right under the header (no big gap)
        run = []
        for y in ys:
            if not run and y - hd["cy"] > 4 * h:
                break
            if run and y - run[-1] > 40 * h:
                break
            run.append(y)
        if len(run) >= 2:
            body = []
            for top, bot in zip(run, run[1:]):
                if any(top < o["cy"] < bot and o["cells"][0]["x0"] < rx1 and o["cells"][-1]["x1"] > x0 for o in headers if o is not hd):
                    break  # another table's header: this table has ended
                row = {}
                for wd in words:
                    cy = (wd["y0"] + wd["y1"]) / 2
                    if wd.get("vertical") or not (top < cy < bot) or not (x0 - h <= wd["x0"] <= rx1):
                        continue
                    ci = next((i for i, (a, b) in enumerate(bounds) if a <= wd["x0"] < b), None)
                    if ci is not None:
                        row.setdefault(ci, []).append(wd)
                if not row:
                    continue
                stop = False
                for sub in _split_band(row, cells, h):
                    is_total = any(TOTAL.match(_cell_text(ws)) for ws in sub.values())
                    body.append(dict(cy=(top + bot) / 2, cells=sub, total=is_total, band=(top, bot)))
                    if is_total:
                        stop = True
                        break
                if stop:
                    break
            _retag(cells, body)
            if body:
                found.append(dict(page=page, kind="columnar", ruled=True, header=cells, bounds=bounds, rows=body,
                                  bbox=[x0, hd["cy"] - h, rx1, body[-1]["band"][1]]))
            continue
        body, prev = [], hd["cy"]
        pitch = None
        for l in lines:
            if l["cy"] <= hd["cy"] + 0.5 * h:
                continue
            part = [w for w in l["words"] if x0 - h <= w["x0"] <= x1]
            if not part:
                continue
            gap = l["cy"] - prev
            if pitch and gap > 3.5 * pitch:
                break
            row = {}
            for w in part:
                ci = next((i for i, (a, b) in enumerate(bounds) if a <= w["x0"] < b), None)
                if ci is not None:
                    row.setdefault(ci, []).append(w)
            if not row:
                continue
            is_total = any(TOTAL.match(" ".join(x["t"] for x in ws)) for ws in row.values())
            # a line with a number in a quantity-like column is a row of its own,
            # even when its code or name was not read; only a line of plain text
            # with an empty first column continues the row above (wrapped text)
            numeric = any(number(_cell_text(ws)) is not None for ci, ws in row.items()
                          if cells[ci]["kind"] not in ("tag", "label", "money", "dimension"))
            if id0 not in row and not is_total and not numeric:
                if body and gap <= 1.6 * (pitch or 2 * h):
                    for ci, ws in row.items():
                        body[-1]["cells"].setdefault(ci, []).extend(ws)
                    prev = l["cy"]
                    continue
                break
            pitch = gap if pitch is None else min(pitch, gap)
            body.append(dict(cy=l["cy"], cells=row, total=is_total))
            prev = l["cy"]
            if is_total:
                break
        _retag(cells, body)
        if body:
            found.append(dict(page=page, kind="columnar", header=cells, bounds=bounds, rows=body,
                              bbox=[x0, hd["cy"] - h, x1, body[-1]["cy"] + h]))
    return found


def _split_band(row, cells, h):
    """A ruled band normally holds one row (its text may wrap). When two or
    more of its lines each print a value in a quantity-like column, a row rule
    is missing (e.g. lost in rendering): split it at those lines; plain text
    lines stay with the row above them."""
    qcols = {i for i, c in enumerate(cells) if c["kind"] not in ("tag", "label", "money", "dimension")}
    ws = [(ci, w) for ci, cell in row.items() for w in cell]
    lines = []
    for ci, w in sorted(ws, key=lambda t: (t[1]["y0"] + t[1]["y1"]) / 2):
        cy = (w["y0"] + w["y1"]) / 2
        if lines and abs(lines[-1][0] - cy) <= 0.5 * h:
            lines[-1][1].append((ci, w))
        else:
            lines.append([cy, [(ci, w)]])
    numeric = [any(ci in qcols and number(w["t"]) is not None for ci, w in l) for _, l in lines]
    if sum(numeric) < 2:
        return [row]
    subs = []
    for (_, l), is_num in zip(lines, numeric):
        if is_num or not subs:
            subs.append({})
        for ci, w in l:
            subs[-1].setdefault(ci, []).append(w)
    return subs


def _retag(cells, body):
    """'NO.' heads a mark column as often as a count column, and 'DOOR' heads
    a mark column as often as a description: the cells decide."""
    for i, c in enumerate(cells):
        vals = [_cell_text(r["cells"][i]) for r in body if i in r["cells"] and not r["total"]]
        tags = vals and sum(bool(tag_of(v)) for v in vals) > len(vals) / 2
        if c["kind"] == "count" and tags:
            c["kind"], c["unit"] = "tag", None
        elif c["kind"] == "opening":
            c["kind"], c["unit"] = ("tag", None) if tags else ("label", None)


def _cell_text(ws):
    """Cell words in reading order: by line (words whose vertical centres are
    within half a text height share a line), then left to right."""
    lines = []
    for w in sorted(ws, key=lambda w: (w["y0"] + w["y1"]) / 2):
        cy, hh = (w["y0"] + w["y1"]) / 2, max(w["y1"] - w["y0"], 1e-9)
        if lines and abs(lines[-1][0] - cy) <= 0.5 * hh:
            lines[-1][1].append(w)
        else:
            lines.append([cy, [w]])
    return " ".join(w["t"] for _, l in lines for w in sorted(l, key=lambda w: w["x0"]))


def decimals(text):
    t = text.strip().replace(",", "")
    return len(t.split(".")[1]) if "." in t else 0


def read_columnar(t, h, doc, page_size):
    page, hd = t["page"], t["header"]
    lab_cols = [i for i, c in enumerate(hd) if c["kind"] == "label"]
    tag_cols = [i for i, c in enumerate(hd) if c["kind"] == "tag"]
    qty_cols = [i for i, c in enumerate(hd) if c["kind"] in ("count", "area")]
    data = [r for r in t["rows"] if not r["total"]]
    totals = [r for r in t["rows"] if r["total"]]
    # item-type count matrix (e.g. fixtures per space): only when the table has
    # no explicit quantity column, and only columns of small whole numbers
    if not qty_cols:
        for i, c in enumerate(hd):
            if c["kind"] != "other":
                continue
            vals = [number(_cell_text(r["cells"][i])) for r in data if i in r["cells"]]
            if len(vals) > 1 and vals == list(range(1, len(vals) + 1)):
                c["kind"] = "serial"  # an unlabelled row-number column, not counts
                continue
            # counts per space are small; 3-4 digit numbers there are sizes in mm
            if vals and all(v is not None and float(v).is_integer() and v < 100 for v in vals):
                qty_cols.append(i)
                c["kind"], c["unit"] = "matrix", "nr"
    items, excluded = [], [hd[i]["t"] for i, c in enumerate(hd) if c["kind"] == "money"]
    sums = {i: [] for i in qty_cols}
    places = {i: 0 for i in qty_cols}  # printed precision, for the total check
    title = " ".join(c["t"] for c in hd)[:80]
    for ri, r in enumerate(data):
        ident = [_cell_text(r["cells"][i]) for i in tag_cols + lab_cols if i in r["cells"]]
        row_ws = [w for ws in r["cells"].values() for w in ws]
        row_box = [t["bbox"][0], min(w["y0"] for w in row_ws), t["bbox"][2], max(w["y1"] for w in row_ws)]
        if not ident:
            # a row whose code and name were not read: its values are flagged,
            # never attached to a neighbouring row and never dropped
            for i in qty_cols:
                cell = r["cells"].get(i)
                head = " ".join(hd[i]["t"].split())
                if cell:
                    items.append(item(f"SCHED:{title}:row {ri + 1}:{head}", f"Unidentified row {ri + 1} — {head}", None, hd[i]["unit"], page,
                                      [evidence(page, row_box, f"row {ri + 1}"), evidence(page, bbox_of(cell), f"{head} cell")], doc, page_size,
                                      notes=f"Column {head} prints '{_cell_text(cell)}' but this row's code and name were not read; check the drawing."))
                sums[i].append(None if cell or hd[i]["kind"] != "matrix" else 0)
            continue
        label = " — ".join(ident)
        dims = [SIZE_PAIR.search(_cell_text(r["cells"][i])) for i, c in enumerate(hd) if c["kind"] == "dimension" and i in r["cells"]]
        dim = next((f"{m.group(1)} x {m.group(2)} mm" for m in dims if m), None)
        for i in qty_cols:
            c = hd[i]
            head = " ".join(c["t"].split())
            key = f"SCHED:{label}:{head}"
            cell = r["cells"].get(i)
            ev = [evidence(page, row_box, f"row {ri + 1} ({label})")]
            what = {"area": "Area", "count": "Quantity", "matrix": head.title()}[c["kind"]]
            name = f"{what} — {label}" if c["kind"] != "area" else f"Area — {label} ({head})"
            if not cell:
                if c["kind"] == "matrix":
                    # a blank cell in a count-per-space matrix prints no count: no
                    # item, and 0 in the total check (which then shows if that holds)
                    sums[i].append(0)
                    continue
                items.append(item(key, name, None, c["unit"], page, ev, doc, page_size, dimension=dim,
                                  notes=f"Nothing printed in column {head}; check the drawing."))
                sums[i].append(None)
                continue
            ev.append(evidence(page, bbox_of(cell), f"{head} cell"))
            v = number(_cell_text(cell))
            if v is None or (c["kind"] in ("count", "matrix") and not float(v).is_integer()):
                items.append(item(key, name, None, c["unit"], page, ev, doc, page_size, dimension=dim,
                                  notes=f"Column {head} reads '{_cell_text(cell)}', not a quantity; check the drawing."))
                sums[i].append(None)
                continue
            if c["unit"] is None:
                items.append(item(key, name, None, None, page, ev, doc, page_size, dimension=dim,
                                  notes=f"Column {head} prints {v:g} but states no unit; check the drawing."))
                sums[i].append(v)
                continue
            items.append(item(key, name, int(v) if c["kind"] != "area" else v, c["unit"], page, ev, doc, page_size, dimension=dim,
                              notes=f"Printed in schedule column {head}."))
            sums[i].append(v)
            places[i] = max(places[i], decimals(_cell_text(cell)))
    for r in totals:
        for i in qty_cols:
            cell = r["cells"].get(i)
            printed = number(_cell_text(cell)) if cell else None
            if printed is None:
                continue
            head = " ".join(hd[i]["t"].split())
            vals = sums[i]
            ev = [evidence(page, bbox_of(cell), f"printed total {head}")]
            if not vals or any(v is None for v in vals):
                items.append(item(f"CHECK:{title}:{head}", f"Total check — {head}", None, hd[i]["unit"], page, ev, doc, page_size,
                                  notes=f"Printed total {printed:g} can't be checked: {sum(v is None for v in vals)} of {len(vals)} rows unresolved."))
                continue
            t.setdefault("checks", []).append(dict(column=head, printed=printed, row_sum=round(sum(vals), 6), rows=len(vals),
                                                   blank_as_zero=sum(1 for r in data if i not in r["cells"]) if hd[i]["kind"] == "matrix" else 0))
            s = round(sum(vals), 6)
            # printed values add up exactly, to half a unit of the finest printed digit
            tol = 0.5 * 10 ** -max(places[i], decimals(_cell_text(cell)))
            if abs(s - printed) > tol:
                items.append(item(f"CHECK:{title}:{head}", f"Total mismatch — {head}: printed {printed:g}, rows sum to {s:g}", None, hd[i]["unit"], page, ev, doc, page_size,
                                  candidates=[dict(value=printed, unit=hd[i]["unit"], basis=f"printed TOTAL in column {head}"),
                                              dict(value=s, unit=hd[i]["unit"], basis=f"sum of {len(vals)} rows in column {head}")],
                                  notes="The schedule's printed total and the sum of its rows disagree. The row values are kept; check which is right."))
    return items, excluded


def opening_table_marks(t):
    """The mark column of a columnar schedule of openings (its marks mostly
    door/window/ventilator prefixes), or None for any other schedule."""
    for i, c in enumerate(t["header"]):
        if c["kind"] != "tag":
            continue
        marks = [tag_of(_cell_text(r["cells"][i])) for r in t["rows"] if not r["total"] and i in r["cells"]]
        marks = [m for m in marks if m]
        if marks and sum(m[0] in OPENING_PREFIXES for m in marks) > len(marks) / 2:
            return i
    return None


def unit_note(lines, h):
    """('mm', box) when the sheet prints a note stating every dimension is in
    millimetres; else (None, None). Nothing is assumed without it."""
    for l in lines:
        text = " ".join(w["t"] for w in l["words"])
        if UNIT_NOTE.search(text):
            return "mm", bbox_of(l["words"])
    return None, None


def read_opening_rows(t, page_note, doc, page_size):
    """Opening sizes from a columnar door/window schedule: one 'SCHED:<mark>'
    item per row, the same shape a graphical schedule row gives. The size is
    a 'W x H' pair in a size column, or separate WIDTH and HEIGHT columns. It
    is MEASURED only with exactly one size and a unit stated by the header or
    by a sheet note; everything else is PENDING with the reason."""
    page, hd = t["page"], t["header"]
    mark_col = opening_table_marks(t)
    if mark_col is None:
        return [], {}
    width_cols = [i for i, c in enumerate(hd) if WIDTH_HEAD.match(" ".join(c["t"].split()))]
    height_cols = [i for i, c in enumerate(hd) if HEIGHT_HEAD.match(" ".join(c["t"].split()))]
    size_cols = [i for i, c in enumerate(hd) if c["kind"] == "dimension" and i not in width_cols + height_cols]
    desc_cols = [i for i, c in enumerate(hd) if c["kind"] in ("label", "other") and re.search(r"REMARK|DESCRIPTION|DETAIL|NAME|TYPE OF", c["t"], re.I)]
    header_unit = "mm" if any(re.search(r"\bMM\b", c["t"], re.I) for c in hd if c["kind"] == "dimension") else None
    unit, note_box = (header_unit, None) if header_unit else page_note
    items, sizes = [], {}
    for r in (x for x in t["rows"] if not x["total"]):
        cell = r["cells"].get(mark_col)
        tg = tag_of(_cell_text(cell)) if cell else None
        if not tg:
            continue  # a row with no readable mark: reported by read_columnar's own rules
        mark = _cell_text(cell).replace("-", "")
        kind = KIND_NAME.get(tg[0], "Opening")
        row_ws = [w for ws in r["cells"].values() for w in ws]
        ev = [evidence(page, [t["bbox"][0], min(w["y0"] for w in row_ws), t["bbox"][2], max(w["y1"] for w in row_ws)], f"schedule row {mark}")]
        desc = " ".join(_cell_text(r["cells"][i]) for i in desc_cols if i in r["cells"]).strip()
        pairs = []
        for i in size_cols:
            if i in r["cells"]:
                m = SIZE_PAIR.search(_cell_text(r["cells"][i]))
                if m:
                    pairs.append((int(m.group(1)), int(m.group(2)), r["cells"][i]))
        if not pairs and width_cols and height_cols:
            wv = [number(_cell_text(r["cells"][i])) for i in width_cols if i in r["cells"]]
            hv = [number(_cell_text(r["cells"][i])) for i in height_cols if i in r["cells"]]
            if len(wv) == 1 and len(hv) == 1 and wv[0] and hv[0]:
                pairs.append((int(wv[0]), int(hv[0]), r["cells"][width_cols[0]] + r["cells"][height_cols[0]]))
        name = f"{kind} {mark} opening area" + (f" — {desc}" if desc else "")
        if len(pairs) != 1:
            if pairs:
                why = f"{len(pairs)} sizes printed in this row"
            elif width_cols and not height_cols:
                why = "The schedule has a width column but no height column, so the size is incomplete"
            elif height_cols and not width_cols:
                why = "The schedule has a height column but no width column, so the size is incomplete"
            else:
                why = "No size printed in this schedule row"
            items.append(item(f"SCHED:{mark}", name, None, "m2", page, ev, doc, page_size, specification=desc or None, notes=f"{why}; check the drawing."))
            continue
        w_, h_, cell_ws = pairs[0]
        ev.append(evidence(page, bbox_of(cell_ws), f"size {w_} x {h_}", "dimension"))
        sizes.setdefault(mark, set()).add(f"{w_} x {h_}")
        if unit != "mm":
            items.append(item(f"SCHED:{mark}", name, None, "m2", page, ev, doc, page_size, dimension=f"{w_} x {h_}", specification=desc or None,
                              notes=f"Size {w_} x {h_} is printed, but neither the schedule header nor a sheet note states its unit; it is not assumed."))
            continue
        if note_box:
            ev.append(evidence(page, note_box, "sheet note: dimensions in millimetres", "dimension"))
        items.append(item(f"SCHED:{mark}", name, round(w_ * h_ / 1e6, 6), "m2", page, ev, doc, page_size, dimension=f"{w_} x {h_} mm",
                          specification=desc or None,
                          notes="Area of one opening, from the size printed in the schedule row" + (" (unit from the sheet's dimensions note)" if note_box else "") + ". Not a count of openings.",
                          calculation_data=dict(formula="LENGTH_TIMES_WIDTH", inputs=[dict(name="width", value=w_ / 1000, unit="m"), dict(name="height", value=h_ / 1000, unit="m")])))
    return items, sizes


# ---------------------------------------------------------------- whole document

def merge(items):
    """One item per key. Equal values merge their evidence; different values
    become one PENDING item with both as candidates."""
    out = {}
    for it in items:
        k = it["key"]
        if k not in out:
            out[k] = it
            continue
        a = out[k]
        a["source"]["evidence"] = a["source"]["evidence"] + it["source"]["evidence"]
        if a["quantity"] != it["quantity"] or (a.get("dimension") and it.get("dimension") and a["dimension"] != it["dimension"]):
            def basis(x):
                return f"page {x['source']['page']}" + (f", size {x['dimension']}" if x.get("dimension") else "")
            cands = a.get("candidates") or ([dict(value=a["quantity"], unit=a["unit"], basis=basis(a))] if a["quantity"] is not None else [])
            if it["quantity"] is not None:
                cands.append(dict(value=it["quantity"], unit=it["unit"], basis=basis(it)))
            a.update(quantity=None, status="PENDING", candidates=cands or None,
                     notes=(a.get("notes") or "") + " The same entry is printed more than once with different values.")
    return list(out.values())


def read_document(pages, doc_name="drawing"):
    """pages: [{page, words, hsegs, vsegs, size, source}] -> (items, observations).
    hsegs: (y, x0, x1); vsegs: (x, y0, y1)."""
    items, obs = [], dict(tables=[], excluded_columns=[], unscheduled=[], schedule_marks={})
    scheduled = {}  # prefix -> set of tags
    opening_prefixes = set()  # prefixes scheduled as door/window elevations
    in_tables = []  # (page, bbox) of every schedule found
    for p in pages:
        words, h = p["words"], word_height(p["words"])
        doc = f"{doc_name} page {p['page']} schedule ({p.get('source', 'text')})"
        page_note = unit_note(lines_of(words, h), h)
        for t in graphical_tables(p["page"], words, p["hsegs"], p["vsegs"], h):
            if t["prefix"] not in OPENING_PREFIXES:
                # tag-column tables of other marks (beam, slab, column schedules) are not opening schedules
                obs["tables"].append(dict(page=p["page"], kind="graphical (not openings)", prefix=t["prefix"], bbox=t["bbox"], rows=len(t["rows"])))
                continue
            its, seen = read_graphical(t, words, h, doc, p.get("size"))
            items += its
            scheduled.setdefault(t["prefix"], set()).update(seen)
            opening_prefixes.add(t["prefix"])
            for tw, band in t["rows"]:
                mark = tw["t"].replace("-", "")
                obs["schedule_marks"].setdefault(mark, dict(page=p["page"], bbox=[tw["x0"], tw["y0"], tw["x1"], tw["y1"]], qty=None, kind="graphical"))
            in_tables.append((p["page"], t["bbox"]))
            obs["tables"].append(dict(page=p["page"], kind="graphical", prefix=t["prefix"], bbox=t["bbox"], rows=len(t["rows"])))
        for t in columnar_tables(p["page"], words, p["hsegs"], p["vsegs"], h):
            if any(pg == p["page"] and _overlap(t["bbox"], b) > 0.3 for pg, b in in_tables):
                continue  # the header row of a schedule already read as graphical
            its, excl = read_columnar(t, h, doc, p.get("size"))
            items += its
            size_items, sizes = read_opening_rows(t, page_note, doc, p.get("size"))
            items += size_items
            if opening_table_marks(t) is not None:
                opening_prefixes.update(tag_of(it["key"][6:])[0] for it in size_items)
            for m, szs in sizes.items():
                obs.setdefault("schedule_sizes", {}).setdefault(m, set()).update(szs)
                # per sheet: a schedule printed on a plan sheet belongs to that sheet's plans
                obs.setdefault("page_schedule_sizes", {}).setdefault(p["page"], {}).setdefault(m, set()).update(szs)
            in_tables.append((p["page"], t["bbox"]))
            obs["tables"].append(dict(page=p["page"], kind="columnar", header=[c["t"] for c in t["header"]],
                                      kinds=[c["kind"] for c in t["header"]], bbox=t["bbox"], rows=len(t["rows"]), total_checks=t.get("checks", [])))
            obs["excluded_columns"] += [dict(page=p["page"], column=c, reason="money (rate/amount/value) — never a quantity") for c in excl]
            for r in t["rows"]:
                for i, c in enumerate(t["header"]):
                    if c["kind"] == "tag" and i in r["cells"] and tag_of(_cell_text(r["cells"][i])):
                        pre, _ = tag_of(_cell_text(r["cells"][i]))
                        mark = _cell_text(r["cells"][i]).replace("-", "")
                        scheduled.setdefault(pre, set()).add(mark)
                        qty = [number(_cell_text(r["cells"][j])) for j, cj in enumerate(t["header"]) if cj["kind"] == "count" and j in r["cells"]]
                        obs["schedule_marks"].setdefault(mark, dict(page=p["page"], bbox=bbox_of(r["cells"][i]),
                                                                    qty=qty[0] if len(qty) == 1 and qty[0] is not None and float(qty[0]).is_integer() else None,
                                                                    kind="columnar"))
    # tags on the drawing with no schedule row: flagged, never dropped
    elsewhere = {}
    for p in pages:
        for w in p["words"]:
            tg = tag_of(w["t"])
            if not tg or tg[0] not in scheduled:
                continue
            name = w["t"].replace("-", "")
            if name in scheduled[tg[0]] or any(pg == p["page"] and _inside([w["x0"], w["y0"], w["x1"], w["y1"]], b) for pg, b in in_tables):
                continue
            elsewhere.setdefault(name, []).append((p, w))
    for name, hits in sorted(elsewhere.items()):
        p0, _ = hits[0]
        pre = tag_of(name)[0]
        ev = [evidence(p["page"], [w["x0"], w["y0"], w["x1"], w["y1"]], f"{name} on page {p['page']}", "location") for p, w in hits[:6]]
        where = f"{name} appears on the drawing ({len(hits)} place(s), pages {sorted({p['page'] for p, _ in hits})}) but has no row in any schedule found."
        if pre in opening_prefixes:
            name_, unit, why = f"{KIND_NAME.get(pre, 'Type')} {name} opening area", "m2", f"{where} Size unknown; check the drawing."
        else:  # a code from a columnar schedule (a room, a finish): no unit implied
            name_, unit, why = f"Schedule entry {name}", None, f"{where} Nothing is printed for it; check the drawing."
        items.append(item(f"SCHED:{name}", name_, None, unit, p0["page"], ev, f"{doc_name} page {p0['page']}", p0.get("size"), notes=why))
        obs["unscheduled"].append(dict(tag=name, pages=sorted({p["page"] for p, _ in hits})))
    return merge(items), obs


def _overlap(a, b):
    """Intersection area over the smaller box's area."""
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    small = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
    return ix * iy / small if small > 0 else 0.0


def _inside(box, outer, pad=2.0):
    return box[0] >= outer[0] - pad and box[1] >= outer[1] - pad and box[2] <= outer[2] + pad and box[3] <= outer[3] + pad
