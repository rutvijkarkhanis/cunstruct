#!/usr/bin/env python3
"""Local drawing extractor: vector-PDF drawing -> Cunstruct analysis JSON.

For drawings whose text is vector geometry (CAD exports with no usable text
layer). Each page is rendered, table ruling lines are removed, and the page is
read with local Tesseract OCR. No network calls and no model.

What becomes a quantity (status MEASURED):
  * a schedule row's count, only from an explicit QTY / NO. column;
  * a printed "N No." count;
  * a printed total row ("TOTAL a / b / c ... SUM n");
  * a room-tag area, only when the printed area and the printed L x W agree;
  * a floor-finish total, only when every room of that finish code has an
    agreed area (sum, with its inputs).
Everything else is left unresolved (PENDING), never guessed: rows with no
printed count, an area whose two printed readings disagree, unreadable values.

Supported input (V1): PDF pages whose drawing and text are vector geometry,
at a print size where text is at least ~1.4 mm high (16 px at 300 dpi).
  * Read: ruled tables (also when drawn against the sheet frame), unruled
    left-aligned lists (legends), room tags "NAME / area m2 | L x W".
  * Sent to review, not read: a table or list whose text is too small or
    unclear (each becomes an unresolved item with its page and box), and every
    unruled list (its entries listed; a list prints no quantities).
  * Refused: raster (scanned) pages.
  * Not attempted: counting symbols, measuring geometry, reading dimension
    chains — nothing is scaled off a drawing.

Usage:
  python3 scripts/drawing-ocr/drawing_ocr.py drawing.pdf --out analysis.json \\
      [--observations observations.json] [--pages 1,2]
Import analysis.json in BOQ Review -> Import JSON. Its source_drawing.sha256
must match the drawing uploaded to the project, or the import is refused.

Requires: poppler-utils (pdfinfo, pdftoppm, pdfimages), tesseract, numpy, Pillow.
"""
import argparse, csv, difflib, hashlib, io, json, os, re, subprocess, sys, tempfile
from pathlib import Path

import numpy as np
from PIL import Image

import layout

Image.MAX_IMAGE_PIXELS = None
EXTRACTOR = "drawing-ocr 1.0 (tesseract)"
DPI = 300
PT = 72 / DPI  # 300-dpi pixels -> PDF points

# ---------------------------------------------------------------- pure parsing

CONFUSABLE = str.maketrans("OSIlZ", "05112")
AREA = re.compile(r"(\d{1,3})[.,:](\d{2})\s*m")
DIMS = re.compile(r"(\d{3,5})\s*[xX×]\s*(\d{3,5})")
TAG = re.compile(r"^([A-Z]{1,5})[-—–]?([0-9OSIlZ]{1,3}[A-Z]?(?:/[0-9]{1,3})?)$")
HEADER_WORDS = {"TAG", "MARK", "QTY", "NO.", "NO", "NOS", "DESCRIPTION", "TYPE", "ROOM", "FLOOR", "SIZE", "CODE", "ELEMENT"}


def norm_dash(s):
    return s.replace("—", "-").replace("–", "-")


def tag_of(token):
    """('D', '1') for 'D1', 'D-1', 'DO' ... or None. The numeric part has OCR
    letter/digit confusions mapped (O->0, S->5, I/l->1, Z->2)."""
    m = TAG.match(norm_dash(token).strip("|[]_.,;:"))
    if not m or not re.search(r"\d", m.group(2)):  # "NO", "TO": words, not tags
        return None
    return m.group(1), m.group(2).translate(CONFUSABLE)


def split_letter_tag(token, known_prefixes):
    """'WS' -> ('W','5') when 'W' is the table's own tag prefix (OCR read the
    digit as a letter). Only for prefixes the same table already uses."""
    t = token.strip("|[]_.,;:")
    if len(t) >= 2 and t[:-1] in known_prefixes and t[-1] in "OSIlZ":
        return t[:-1], t[-1].translate(CONFUSABLE)
    return None


def header_columns(line):
    words = [w.strip("|[]_.,;:()").upper() for w in line.split()]
    hits = [w for w in words if w in HEADER_WORDS]
    return hits if len(set(hits)) >= 2 else None


def parse_count(cells_text, qty_after_description):
    """The printed count of a schedule row (QTY column), or None.
    qty_after_description: the QTY column sits right of DESCRIPTION, so the
    count is the row's last standalone integer; otherwise it is the last
    standalone integer before the description text starts."""
    toks = norm_dash(cells_text).replace("|", " ").split()
    ints = []
    for i, t in enumerate(toks):
        if re.fullmatch(r"\d{1,4}", t.strip("_.,;:")):
            ints.append((i, int(t.strip("_.,;:"))))
    if not ints:
        return None
    if qty_after_description:
        i, v = ints[-1]
        return v if i >= len(toks) - 2 else None  # must actually end the row
    words = [i for i, t in enumerate(toks) if re.fullmatch(r"[A-Za-z][A-Za-z.,\-]{2,}", t)]
    if not words:
        return None
    before = [v for i, v in ints if i < words[0]]
    # a size "W x H" (and a sill height) precede the count; the count is last
    return before[-1] if before else None


def parse_total_row(line):
    """'TOTAL T10 / T12 / T16 (kg) 2,267 / 4,120 / 2,575 SUM kg 8,962' ->
    labels, values, sum and unit, when the row states as many values as labels."""
    if not re.search(r"\b(TOTAL|SUM)\b", line, re.I):
        return None
    nums = re.findall(r"(?<![A-Za-z\d,])\d[\d,]*(?:\.\d+)?(?:\s*/\s*\d[\d,]*(?:\.\d+)?)+", line)
    if not nums:
        return None
    values = [float(v.replace(",", "")) for v in re.split(r"\s*/\s*", nums[-1])]
    head = line[: line.find(nums[-1])]
    lab = re.search(r"([A-Za-z0-9]{1,5}(?:\s*/\s*[A-Za-z0-9]{1,5})+)", head)
    labels = [l.strip() for l in re.split(r"\s*/\s*", lab.group(1))] if lab else []
    # OCR reads a label's leading letter as "1" ("112" beside "T10"): repaired
    # only from the sibling labels' own prefix, never invented.
    pre = [re.match(r"[A-Z]+", l).group(0) for l in labels if re.match(r"[A-Z]+\d+$", l)]
    if pre and len(set(pre)) == 1:
        labels = [pre[0] + l[1:] if re.fullmatch(r"1\d+", l) and len(l) == len(labels[0]) else l for l in labels]
    s = re.search(r"SUM\s*(?:kg)?\s*([\d,]+(?:\.\d+)?)", line, re.I)
    unit = "kg" if re.search(r"\bkg\b", line, re.I) else None
    total = float(s.group(1).replace(",", "")) if s else None
    return dict(labels=labels if len(labels) == len(values) else [], values=values, total=total, unit=unit,
                consistent=total is None or abs(sum(values) - total) < 0.5)


def agreed_area(area_texts, dims):
    """A printed area and a printed L x W (mm) that agree to the printed
    precision -> (area, (L, W)); otherwise None."""
    for a in sorted(area_texts):
        for d in sorted(dims):
            if abs(d[0] * d[1] / 1e6 - float(a)) <= 0.006:
                return float(a), d
    return None


def canonical(name, known):
    if not known:
        return name
    best = max(known, key=lambda k: difflib.SequenceMatcher(None, name, k).ratio())
    return best if difflib.SequenceMatcher(None, name, best).ratio() >= 0.75 else name


# ---------------------------------------------------------------- image + OCR

def run(cmd, **kw):
    # One OCR thread per process: parallel runs otherwise oversubscribe the CPU.
    return subprocess.run(cmd, capture_output=True, check=True, env={**os.environ, "OMP_THREAD_LIMIT": "1"}, **kw)


def page_kinds(pdf):
    """Per page: 'raster' when one image covers most of the page (a scan)."""
    info = run(["pdfinfo", "-f", "1", "-l", "9999", str(pdf)], text=True).stdout
    sizes = {int(m.group(1)): (float(m.group(2)), float(m.group(3)))
             for m in re.finditer(r"Page\s+(\d+) size:\s+([\d.]+) x ([\d.]+)", info)}
    kinds = {p: "vector" for p in sizes}
    for line in run(["pdfimages", "-list", str(pdf)], text=True).stdout.splitlines()[2:]:
        f = line.split()
        if len(f) < 14 or f[2] != "image":
            continue
        page, w, h, xppi, yppi = int(f[0]), int(f[3]), int(f[4]), float(f[12]), float(f[13])
        pw, ph = sizes[page]
        if w / xppi * 72 >= 0.8 * min(pw, ph) and h / yppi * 72 >= 0.8 * min(pw, ph):
            kinds[page] = "raster"
    return kinds, sizes


def render(pdf, page, dpi=DPI):
    png = run(["pdftoppm", "-r", str(dpi), "-gray", "-png", "-f", str(page), "-l", str(page), str(pdf)]).stdout
    return np.asarray(Image.open(io.BytesIO(png)).convert("L"))


def _runs(dark, L):
    c = np.concatenate([np.zeros((dark.shape[0], 1), np.int32), np.cumsum(dark, axis=1, dtype=np.int32)], axis=1)
    full = (c[:, L:] - c[:, :-L]) == L
    s = np.concatenate([np.zeros((dark.shape[0], 1), np.int32), np.cumsum(full, axis=1, dtype=np.int32)], axis=1)
    idx = np.arange(dark.shape[1])
    lo = np.clip(idx - L + 1, 0, full.shape[1]); hi = np.clip(idx + 1, 0, full.shape[1])
    return (s[:, hi] - s[:, lo]) > 0


def line_mask(gray, L=120):
    """Pixels on straight horizontal/vertical runs >= L px (~10 mm at 300 dpi):
    table rules, walls, borders — never a character stroke."""
    dark = gray < 140
    return _runs(dark, L) | _runs(dark.T, L).T


def tables(mask, page_shape, cell=8):
    """Bounding boxes (300-dpi px) of connected ruling-line structures that look
    like tables: not the sheet frame/title block, not tiny marks."""
    h, w = mask.shape
    g = mask[: h // cell * cell, : w // cell * cell].reshape(h // cell, cell, w // cell, cell).any(axis=(1, 3))
    g = g | np.roll(g, 1, 0) | np.roll(g, -1, 0) | np.roll(g, 1, 1) | np.roll(g, -1, 1)
    seen = np.zeros_like(g); boxes = []
    for y0, x0 in zip(*np.nonzero(g)):
        if seen[y0, x0]:
            continue
        stack = [(y0, x0)]; seen[y0, x0] = True; ys = [y0]; xs = [x0]
        while stack:
            y, x = stack.pop()
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < g.shape[0] and 0 <= nx < g.shape[1] and g[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True; stack.append((ny, nx)); ys.append(ny); xs.append(nx)
        bx0, by0, bx1, by1 = min(xs) * cell, min(ys) * cell, (max(xs) + 1) * cell, (max(ys) + 1) * cell
        bw, bh = bx1 - bx0, by1 - by0
        if bw < 400 or bh < 80 or bw > 0.45 * page_shape[1] or bh > 0.45 * page_shape[0]:
            continue
        boxes.append((bx0, by0, bx1, by1))
    return boxes


def ocr(img, psm, tsv=False):
    with tempfile.NamedTemporaryFile(suffix=".png") as f:
        Image.fromarray(img).save(f.name)
        out = run(["tesseract", f.name, "-", "--psm", str(psm)] + (["tsv"] if tsv else []), text=True).stdout
    if not tsv:
        return out
    rows = [r for r in csv.DictReader(io.StringIO(out), delimiter="\t", quoting=csv.QUOTE_NONE) if (r.get("text") or "").strip()]
    return [dict(t=r["text"].strip(), x=int(r["left"]), y=int(r["top"]), w=int(r["width"]), h=int(r["height"]),
                 conf=float(r["conf"]), line=(r["block_num"], r["par_num"], r["line_num"])) for r in rows]


# ---------------------------------------------------------------- extraction

def read_table(gray, cleaned, box, page, hi=None):
    """Parse one table. With `hi` (the page at 400 dpi), the table is read a
    second time from it and every printed number must agree between the two
    readings; a number they disagree on is left unresolved."""
    t = _read_table_text(cleaned, box, page)
    if hi is None:
        return t
    x0, y0, x1, y1 = box
    k = 4 / 3
    crop = hi[int(max(0, y0 - 140) * k):int((y1 + 10) * k), int(max(0, x0 - 10) * k):int((x1 + 10) * k)].copy()
    crop[line_mask(crop, 160)] = 255
    u = _read_table_text(crop, None, page)
    second = {r["tag"]: r["count"] for r in u["rows"]}
    for r in t["rows"]:
        if r["count"] is not None and second.get(r["tag"]) != r["count"]:
            r["readings"] = [r["count"], second.get(r["tag"])]; r["count"] = None
    second_no = {c["label"]: c["count"] for c in u["printed_counts"]}
    for c in t["printed_counts"]:
        if second_no.get(c["label"]) != c["count"]:
            c["readings"] = [c["count"], second_no.get(c["label"])]; c["count"] = None
    second_tot = [x["values"] for x in u["totals"]]
    for x in t["totals"]:
        if x["values"] not in second_tot:
            x["readings"] = [x["values"], second_tot]; x["consistent"] = False
    return t


def _read_table_text(cleaned, box, page):
    if box is None:
        text = ocr(cleaned, 6)
    else:
        x0, y0, x1, y1 = box
        top = max(0, y0 - 140)  # the heading sits just above the grid
        text = ocr(cleaned[top:y1 + 10, max(0, x0 - 10):x1 + 10], 6)
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    heading = next((l for l in lines if re.search(r"SCHEDULE|SUMMARY|LEGEND|TABLE", l, re.I)), lines[0] if lines else "")
    cols = None; rows = []; totals = []
    for i, l in enumerate(lines):
        cols = cols or header_columns(l)
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if re.search(r"\bTOTAL\b", l, re.I) and re.search(r"\bSUM\b", nxt, re.I) and "/" in nxt:
            l = f"{l} {nxt}"; lines[i + 1] = ""  # labels and values printed on two lines
        if (t := parse_total_row(l)):
            totals.append(dict(text=l, **t)); continue
        first = l.split()[0] if l.split() else ""
        rows.append(dict(text=l, first=first))
    prefixes = {tag_of(r["first"])[0] for r in rows if tag_of(r["first"])}
    qty_col = bool(cols) and any(c in ("QTY", "NO.", "NO", "NOS") for c in cols)
    qty_after = qty_col and "DESCRIPTION" in cols and max(i for i, c in enumerate(cols) if c in ("QTY", "NO.", "NO", "NOS")) > cols.index("DESCRIPTION")
    parsed = []
    for r in rows:
        tg = tag_of(r["first"]) or split_letter_tag(r["first"], prefixes)
        if not tg:
            continue
        rest = r["text"][len(r["first"]):]
        size = DIMS.search(rest)
        parsed.append(dict(tag=f"{tg[0]}{tg[1]}" if len(tg[0]) == 1 else f"{tg[0]}-{tg[1]}", text=r["text"],
                           size=f"{size.group(1)} x {size.group(2)}" if size else None,
                           count=parse_count(rest, qty_after) if qty_col else None))
    printed_no = [dict(text=l, label=re.sub(r"[-—]?\s*\d+\s*No\.?.*", "", l).strip(" -|"), count=int(m.group(1)))
                  for l in lines for m in [re.search(r"(\d+)\s*No\b\.?", l)] if m]
    room_rows = []
    if cols and "ROOM" in cols and "FLOOR" in cols:
        for l in lines:
            m = re.match(r"^([A-Z][A-Z /]+?)\s+([A-Z]{2})[-—–]+([0-9OI]{1,3})(?![0-9OI])", l)
            if m and m.group(1).strip() not in HEADER_WORDS:
                room_rows.append(dict(room=m.group(1).strip(), floor=f"{m.group(2)}-{int(m.group(3).translate(CONFUSABLE)):02d}"))
    return dict(page=page, bbox=box, heading=heading, columns=cols, rows=parsed, totals=totals,
                printed_counts=printed_no, room_finishes=room_rows, raw=lines)


def room_tags(page, gray, cleaned, hi, known_rooms, words):
    """Room tags: 'NAME / area m2 | L x W'. Anchored on an area token or on an
    'L x W' pair (either may be unreadable); one tag per location. `words`:
    the page's sparse-text OCR words (raw and line-cleaned renders)."""
    anchors = [(w["x"], w["y"]) for w in words if re.fullmatch(r"\d{1,3}[.,:]\d{2}", w["t"])]
    for w in words:  # "4000 x 4600": an anchor ~1000 px right of where the area starts
        if re.fullmatch(r"\d{4}", w["t"]) and any(o["t"] in ("x", "X", "×") and 0 < o["x"] - w["x"] < 160 and abs(o["y"] - w["y"]) < 30 for o in words):
            anchors.append((max(0, w["x"] - 330), w["y"]))
    tags = []; taken = []
    for ax, ay in anchors:
        if any(abs(ax - tx) < 400 and abs(ay - ty) < 80 for tx, ty in taken):
            continue
        taken.append((ax, ay))
        w = dict(x=ax, y=ay)
        box = (max(0, w["x"] - 300), max(0, w["y"] - 170), w["x"] + 1300, w["y"] + 60)
        x0, y0, x1, y1 = box
        variants = [ocr(gray[y0:y1, x0:x1], p) for p in (6, 7)] + [ocr(cleaned[y0:y1, x0:x1], p) for p in (6, 7)]
        variants.append(ocr(hi[y0 * 4 // 3:y1 * 4 // 3, x0 * 4 // 3:x1 * 4 // 3], 6))
        areas = {f"{m.group(1)}.{m.group(2)}" for v in variants for m in AREA.finditer(v)}
        dims = {(int(a), int(b)) for v in variants for a, b in DIMS.findall(v)}
        if not areas:  # no printed area read: a size in a schedule or a dimension, not a room tag
            continue
        name = ""
        for v in variants:
            vl = [l for l in v.splitlines() if l.strip()]
            for i, l in enumerate(vl):
                if AREA.search(l):
                    for prev in vl[max(0, i - 2):i]:  # the name, possibly above a second-language line
                        cand = " ".join(t for t in prev.split() if re.fullmatch(r"[A-Z][A-Z&.']+|/", t) and t not in ("FFL", "SSL", "FCL"))
                        if len(cand) > len(name):
                            name = cand
        if not name:  # name line outside the crop: the page's own words just above the tag
            above = sorted((o for o in words if 20 < w["y"] - o["y"] < 200 and abs(o["x"] - (w["x"] + 250)) < 500
                            and re.fullmatch(r"[A-Z][A-Z&.']+|/", o["t"]) and o["t"] not in ("FFL", "SSL", "FCL")), key=lambda o: (o["y"] // 25, o["x"]))
            name = " ".join(dict.fromkeys(o["t"] for o in above))
        tags.append(dict(page=page, x=w["x"], y=w["y"], bbox=box, name=canonical(name, known_rooms) or None,
                         areas=sorted(areas), dims=sorted(dims), agreed=agreed_area(areas, dims), reads=variants))
    return tags


def sheet_id(gray):
    """The sheet number printed largest on the page (title-block drawing number);
    sheet indexes list every sheet in small text."""
    words = [w for w in ocr(gray[::2, ::2], 11, tsv=True) if re.fullmatch(r"[A-Z]{2}-[A-Z]{2}-\d{3}", norm_dash(w["t"]))]
    return norm_dash(max(words, key=lambda w: w["h"])["t"]) if words else None


def unresolved_region(key, what, sheet, p, box, size, q, entries=None):
    """A region the extractor found but will not turn into quantities — sent
    to review instead of silently dropped."""
    why = "" if q["readable"] else (f" — text too small or unclear to read reliably (median height {q['median_height_px']} px at {DPI} dpi, "
                                    f"OCR confidence {q['mean_confidence']}); check it on the drawing")
    return dict(key=key, item=f"{what}{why}", quantity=None, unit=None, status="PENDING", location=None, confidence=None,
                specification="; ".join(entries)[:500] if entries and q["readable"] else None,
                source=dict(document_id=None, document=f"{sheet} {what.split(' (')[0].lower()}", page=p, evidence=[evidence(p, box, size)], pageSize=size))


def evidence(page, box, size):
    x0, y0, x1, y1 = box
    return dict(page=page, bbox=[round(x0 * PT, 1), round(y0 * PT, 1), round(x1 * PT, 1), round(y1 * PT, 1)], claim="quantity")


def extract(pdf, pages=None, log=print):
    pdf = Path(pdf)
    sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    kinds, sizes = page_kinds(pdf)
    pages = pages or sorted(kinds)
    obs = dict(drawing=dict(file=pdf.name, sha256=sha, pages=pages), refused_pages=[], tables=[], lists=[], unreadable=[], uninterpreted=[], room_tags=[])
    items = []
    known_rooms = []
    for p in pages:
        if kinds.get(p) == "raster":
            obs["refused_pages"].append(dict(page=p, reason="raster image (scanned) page — not supported"))
            log(f"page {p}: refused (raster scan)"); continue
        gray = render(pdf, p)
        mask = line_mask(gray)
        cleaned = gray.copy(); cleaned[mask] = 255
        sheet = sheet_id(gray) or f"page {p}"
        size = dict(width=sizes[p][0], height=sizes[p][1])
        hi = render(pdf, p, 400)
        words_raw, words_clean = ocr(gray, 11, tsv=True), ocr(cleaned, 11, tsv=True)
        boxes = tables(layout.frame_free(mask), gray.shape)
        for box in boxes:
            x0, y0, x1, y1 = box
            q = layout.quality(ocr(cleaned[max(0, y0 - 140):y1 + 10, max(0, x0 - 10):x1 + 10], 6, tsv=True))
            if not q["readable"]:
                obs["unreadable"].append(dict(page=p, sheet=sheet, kind="ruled table", bbox=box, **q))
                items.append(unresolved_region(f"{sheet}:TABLE:{x0},{y0}", "Ruled table (schedule) not read", sheet, p, box, size, q))
                continue
            t = read_table(gray, cleaned, box, p, hi)
            if not (t["rows"] or t["totals"] or t["printed_counts"] or t["room_finishes"]):
                # Readable, but no tagged rows, counts or totals it can interpret:
                # shown for review rather than dropped.
                obs["uninterpreted"].append(dict(page=p, sheet=sheet, bbox=box, heading=t["heading"], lines=t["raw"][:12], **q))
                items.append(unresolved_region(f"{sheet}:TABLE:{x0},{y0}", f"Ruled table not interpreted ({t['heading'][:60]})", sheet, p, box, size, q, t["raw"][:12]))
                continue
            t["sheet"] = sheet; obs["tables"].append(t)
            known_rooms += [r["room"] for r in t["room_finishes"]]
            src = lambda: dict(document_id=None, document=f"{sheet} {t['heading']}".strip(), page=p, evidence=[evidence(p, box, size)], pageSize=size)
            for r in t["rows"]:
                base = dict(key=r["tag"], item=r["tag"], unit="nr", dimension=r["size"], specification=None, location=None, confidence=None, source=src())
                if r["count"] is not None:
                    items.append(dict(base, quantity=r["count"], status="MEASURED"))
                else:
                    items.append(dict(base, quantity=None, status="PENDING"))  # listed, count not printed
            for c in t["printed_counts"]:
                items.append(dict(key=f"{sheet}:{c['label'] or 'count'}", item=c["label"] or "Printed count", quantity=c["count"], unit="nr",
                                  location=None, confidence=None, status="MEASURED" if c["count"] is not None else "PENDING", source=src()))
            for tot in t["totals"]:
                for i, v in enumerate(tot["values"]):
                    lab = tot["labels"][i] if tot["labels"] else f"total {i + 1}"
                    readable = bool(re.fullmatch(r"[A-Z]+\d+", lab)) and tot["consistent"]
                    items.append(dict(key=f"{sheet}:TOTAL:{lab}", item=f"Printed total {lab}", quantity=v if readable else None, unit=tot["unit"] or "nr",
                                      location=None, confidence=None, status="MEASURED" if readable else "PENDING", source=src()))
        for b in layout.list_blocks(layout.group_lines(words_raw), exclude_boxes=boxes):
            q = layout.quality(b["words"])
            obs["lists"].append(dict(page=p, sheet=sheet, bbox=b["box"], entries=b["entries"], **q))
            what = f"Unruled list ({len(b['entries'])} entries), no quantities printed" if q["readable"] else f"Unruled list ({len(b['entries'])} lines) not read"
            items.append(unresolved_region(f"{sheet}:LIST:{b['box'][0]},{b['box'][1]}", what, sheet, p, b["box"], size, q, b["entries"]))
        tags = room_tags(p, gray, cleaned, hi, known_rooms, words_raw + words_clean)
        for tg in tags:
            tg["sheet"] = sheet
        obs["room_tags"] += [{k: v for k, v in tg.items() if k != "reads"} for tg in tags]
        for tg in tags:
            if not tg["name"]:
                continue
            base = dict(key=f"AREA:{tg['name']}", item=f"Floor area — {tg['name'].title()}", unit="m2", location=None, confidence=None,
                        source=dict(document_id=None, document=f"{sheet} room tag", page=p, evidence=[evidence(p, tg["bbox"], size)], pageSize=size))
            if tg["agreed"]:
                a, (l, w) = tg["agreed"]
                items.append(dict(base, quantity=a, status="MEASURED", dimension=f"{l} x {w}", calculation_data=dict(
                    formula="LENGTH_TIMES_WIDTH", inputs=[dict(name="length", value=l / 1000, unit="m"), dict(name="width", value=w / 1000, unit="m")])))
            else:
                items.append(dict(base, quantity=None, status="PENDING"))
        log(f"page {p} ({sheet}): {len([t for t in obs['tables'] if t['page'] == p])} tables read, "
            f"{len([u for u in obs['unreadable'] if u['page'] == p])} unreadable, {len([u for u in obs['uninterpreted'] if u['page'] == p])} not interpreted, "
            f"{len([l for l in obs['lists'] if l['page'] == p])} lists, {len(tags)} room tags")
    # Floor-finish totals: only when every room of the code has an agreed area.
    finishes = {}
    for t in obs["tables"]:
        for r in t["room_finishes"]:
            finishes.setdefault(r["floor"], []).append(r["room"])
    agreed = {i["key"][5:]: i for i in items if i["key"].startswith("AREA:") and i["status"] == "MEASURED"}
    for code, rooms in sorted(finishes.items()):
        parts = [agreed.get(r) for r in rooms]
        ok = all(parts)
        items.append(dict(key=f"FINISH:{code}", item=f"Floor finish {code}", unit="m2", location=None, confidence=None,
                          quantity=round(sum(x["quantity"] for x in parts), 2) if ok else None, status="MEASURED" if ok else "PENDING",
                          source=dict(document_id=None, document="room finish schedule + room tags", page=None, evidence=[]),
                          **(dict(calculation_data=dict(formula="SUM_OF_SEGMENTS", inputs=[dict(name=r, value=x["quantity"], unit="m2") for r, x in zip(rooms, parts)])) if ok else {})))
    # One item per key: a repeated key keeps the first reading unless they disagree (then unresolved).
    merged = {}
    for it in items:
        k = it["key"]
        if k not in merged:
            merged[k] = it
        elif merged[k]["quantity"] != it["quantity"]:
            merged[k] = dict(merged[k], quantity=None, status="PENDING")
    analysis = dict(schema_version="cunstruct.analysis.v1", source_drawing=dict(sha256=sha, filename=pdf.name, extractor=EXTRACTOR),
                    items=list(merged.values()))
    return analysis, obs


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdf"); ap.add_argument("--out", required=True); ap.add_argument("--observations")
    ap.add_argument("--pages", help="comma-separated page numbers (default: all)")
    a = ap.parse_args(argv)
    pages = [int(p) for p in a.pages.split(",")] if a.pages else None
    analysis, obs = extract(a.pdf, pages, log=lambda m: print(m, file=sys.stderr))
    Path(a.out).write_text(json.dumps(analysis, indent=1))
    if a.observations:
        Path(a.observations).write_text(json.dumps(obs, indent=1, default=str))
    n = len(analysis["items"]); m = sum(1 for i in analysis["items"] if i["status"] == "MEASURED")
    print(f"{n} items ({m} measured, {n - m} unresolved); refused pages: {[r['page'] for r in obs['refused_pages']]}", file=sys.stderr)


if __name__ == "__main__":
    main()
