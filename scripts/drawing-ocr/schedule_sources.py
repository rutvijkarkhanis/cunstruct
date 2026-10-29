"""Words and ruling lines for schedule_core, from a PDF or a DXF.

Order of preference per page: the PDF's own text layer, then local OCR when
the page has no usable text layer. A DXF is read from its TEXT/MTEXT and
LINE/LWPOLYLINE entities (needs the optional `ezdxf` package). No network.

Ruling lines in a PDF come from the rendered page (straight dark runs of at
least 10 mm), so a rule drawn as many short touching segments reads as one.
"""
import html, re, subprocess
from pathlib import Path

import numpy as np

import drawing_ocr

RULE_DPI = 150
MIN_RULE_MM = 10


def rotated(t, x0, y0, x1, y1):
    """Text set at 90 degrees: a word of 3+ characters whose box is taller than
    wide. Shorter words can't tell (a digit's own box is taller than wide)."""
    return len(t) >= 3 and (y1 - y0) > (x1 - x0)


def pdf_text_words(pdf):
    """{page: [word]} from the PDF text layer (pdftotext -bbox), in points.
    A word of 3+ characters whose box is taller than it is wide is rotated (vertical)."""
    out = subprocess.run(["pdftotext", "-bbox", str(pdf), "-"], capture_output=True, text=True, check=True).stdout
    pages = {}
    for n, body in enumerate(re.findall(r"<page[^>]*>(.*?)</page>", out, re.S), 1):
        ws = []
        for a, b, c, d, t in re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', body):
            x0, y0, x1, y1, t = float(a), float(b), float(c), float(d), html.unescape(t).strip()
            if t:
                ws.append(dict(t=t, x0=x0, y0=y0, x1=x1, y1=y1, vertical=rotated(t, x0, y0, x1, y1)))
        pages[n] = ws
    return pages


def ocr_words(pdf, page):
    """Words by local Tesseract, in points. Horizontal text only."""
    gray = drawing_ocr.render(pdf, page)
    k = 72 / drawing_ocr.DPI
    return [dict(t=w["t"], x0=w["x"] * k, y0=w["y"] * k, x1=(w["x"] + w["w"]) * k, y1=(w["y"] + w["h"]) * k, vertical=False)
            for w in drawing_ocr.ocr(gray, 11, tsv=True) if w["conf"] >= 60]


def _segments(mask, k):
    """Merge per-row runs of a boolean mask into line segments (pos, a, b),
    scaled by k. Runs on adjacent rows with matching ends are one line."""
    segs = []
    for y in np.nonzero(mask.any(axis=1))[0]:
        row = np.concatenate([[0], mask[y].astype(np.int8), [0]])
        d = np.diff(row)
        for a, b in zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]):
            segs.append([y, a, b, y])
    segs.sort(key=lambda s: (s[1], s[2], s[0]))
    merged = []
    for s in segs:
        m = next((m for m in reversed(merged[-8:]) if abs(m[1] - s[1]) <= 2 and abs(m[2] - s[2]) <= 2 and s[0] - m[3] <= 2), None)
        if m:
            m[3] = s[0]
        else:
            merged.append(list(s))
    return [((m[0] + m[3]) / 2 * k, m[1] * k, m[2] * k) for m in merged]


def pdf_rules(pdf, page):
    """(hsegs, vsegs) in points from the page rendered at RULE_DPI."""
    gray = drawing_ocr.render(pdf, page, RULE_DPI)
    dark = gray < 140
    L = int(MIN_RULE_MM / 25.4 * RULE_DPI)
    k = 72 / RULE_DPI
    h = drawing_ocr._runs(dark, L)
    v = drawing_ocr._runs(dark.T, L)
    return _segments(h, k), _segments(v, k)


def pdf_pages(pdf, pages=None, min_text_words=20):
    pdf = Path(pdf)
    kinds, sizes = drawing_ocr.page_kinds(pdf)
    text = pdf_text_words(pdf)
    out = []
    for p in pages or sorted(sizes):
        ws = text.get(p, [])
        src = "text layer"
        if len(ws) < min_text_words:
            ws = ocr_words(pdf, p)
            src = "OCR (no text layer)"
        hs, vs = pdf_rules(pdf, p)
        out.append(dict(page=p, words=ws, hsegs=hs, vsegs=vs, size=dict(width=sizes[p][0], height=sizes[p][1]), source=src))
    return out


def dxf_pages(path):
    """One 'page' for the DXF model space. y is flipped so it grows downward."""
    try:
        import ezdxf
    except ImportError as e:  # optional dependency
        raise SystemExit("Reading DXF needs the ezdxf package (pip install ezdxf).") from e
    msp = ezdxf.readfile(str(path)).modelspace()
    words, hs, vs = [], [], []
    for e in msp.query("TEXT MTEXT"):
        t = (e.plain_text() if e.dxftype() == "MTEXT" else e.dxf.text or "").strip()
        if not t:
            continue
        h = (e.dxf.char_height if e.dxftype() == "MTEXT" else e.dxf.height) or 1.0
        rot = float(e.dxf.get("rotation", 0) or 0) % 180
        x, y = e.dxf.insert.x, -e.dxf.insert.y
        if 60 < rot < 120:
            words.append(dict(t=t, x0=x - h, y0=y - 0.6 * h * len(t), x1=x, y1=y, vertical=True))
        else:
            words.append(dict(t=t, x0=x, y0=y - h, x1=x + 0.6 * h * len(t), y1=y, vertical=False))

    def seg(a, b):
        (x0, y0), (x1, y1) = (a[0], -a[1]), (b[0], -b[1])
        if abs(y1 - y0) < 1e-6 * max(1, abs(x1 - x0)) + 1e-9:
            hs.append((y0, min(x0, x1), max(x0, x1)))
        elif abs(x1 - x0) < 1e-6 * max(1, abs(y1 - y0)) + 1e-9:
            vs.append((x0, min(y0, y1), max(y0, y1)))

    for e in msp.query("LINE"):
        seg(e.dxf.start, e.dxf.end)
    for e in msp.query("LWPOLYLINE"):
        pts = [(p[0], p[1]) for p in e.get_points("xy")]
        if e.closed and pts:
            pts.append(pts[0])
        for a, b in zip(pts, pts[1:]):
            seg(a, b)
    return [dict(page=1, words=words, hsegs=hs, vsegs=vs, size=None, source="CAD text")]
