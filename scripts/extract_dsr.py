#!/usr/bin/env python3
"""
Extract a CPWD/DSR-style rate schedule PDF into a flat CSV the Cunstruct BOQ
engine can ingest.

The DSR is a 4-column table — Code No | Description | Unit | Rate — with:
  * hierarchical codes (4.1, 4.1.5, 4.1.5A, 4.2.2, 9.15.1.1)
  * "SUB HEAD : 4.0 CONCRETE WORK" chapter markers
  * child rows whose description only makes sense with the parent's
    (e.g. 4.2.2 "1:1½:3 ..." belongs under 4.2 "Providing and laying cement
    concrete in retaining walls ...")

This script stitches parent context into each leaf and emits one row per code.

USAGE
-----
    pip install pdfplumber
    python extract_dsr.py DSR.pdf --out dsr_item.csv
    # only a chapter range of pages (faster while calibrating):
    python extract_dsr.py DSR.pdf --out dsr_item.csv --pages 100-160

Then upload dsr_item.csv back to the chat (it will be a few MB), or load it
straight into the `dsr_item` table.

This is a FIRST-PASS extractor calibrated from sample pages. Run it on a small
--pages range first, eyeball the CSV, and tell me what's off — column drift and
odd wrapping are expected on a 225-page doc and easy to tune.
"""
import argparse, csv, re, sys

CODE_RE = re.compile(r"^\d+(?:\.\d+)*[A-Za-z]?$")           # 4, 4.1, 4.1.5A, 9.15.1.1
SUBHEAD_RE = re.compile(r"SUB\s*HEAD\s*[:\-]\s*(.+)", re.I)
RATE_RE = re.compile(r"^\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$|^\d+(?:\.\d{1,2})?$")
UNITS = {"cum", "sqm", "rmt", "rm", "metre", "meter", "each", "nos", "no",
         "kg", "quintal", "qtl", "mt", "litre", "liter", "ltr", "sqm.", "cum.",
         "day", "hectare", "tonne", "kw", "point", "pair", "set", "%"}

def parse_pages(spec, n):
    if not spec:
        return range(n)
    out = set()
    for part in spec.split(","):
        if "-" in part:
            a, b = part.split("-"); out.update(range(int(a) - 1, int(b)))
        else:
            out.add(int(part) - 1)
    return sorted(p for p in out if 0 <= p < n)

def column_bands(page):
    """Find x-boundaries from the header row if present, else fall back to
    fractions of the page width tuned to the DSR layout."""
    w = page.width
    words = page.extract_words()
    hx = {}
    for wd in words:
        t = wd["text"].strip().lower()
        if t in ("description", "unit", "rate", "code"):
            hx[t] = wd["x0"]
    if {"description", "unit", "rate"} <= hx.keys():
        return {"code_end": hx["description"] - 4,
                "desc_end": hx["unit"] - 6,
                "unit_end": hx["rate"] - 6}
    return {"code_end": 0.20 * w, "desc_end": 0.78 * w, "unit_end": 0.88 * w}

def line_groups(words, tol=3.0):
    """Group words into visual lines by their top y (within tol px)."""
    lines = []
    for wd in sorted(words, key=lambda w: (round(w["top"] / tol), w["x0"])):
        if lines and abs(wd["top"] - lines[-1][0]) <= tol:
            lines[-1][1].append(wd)
        else:
            lines.append([wd["top"], [wd]])
    for _, ws in lines:
        ws.sort(key=lambda w: w["x0"])
    return [ws for _, ws in lines]

def split_line(ws, bands):
    code_toks, desc_toks, unit_tok, rate_tok = [], [], None, None
    for wd in ws:
        x, t = wd["x0"], wd["text"].strip()
        if not t:
            continue
        if x < bands["code_end"]:
            code_toks.append(t)
        elif x < bands["desc_end"]:
            desc_toks.append(t)
        elif x < bands["unit_end"]:
            if t.lower().strip(".") in UNITS:
                unit_tok = t
            else:
                desc_toks.append(t)
        else:
            if RATE_RE.match(t.replace(",", "")):
                rate_tok = t.replace(",", "")
            elif t.lower().strip(".") in UNITS and unit_tok is None:
                unit_tok = t
    code = "".join(code_toks).strip()
    if code and not CODE_RE.match(code):
        # not a real code — treat as description text
        desc_toks = code_toks + desc_toks
        code = ""
    return code, " ".join(desc_toks).strip(), unit_tok, rate_tok

def ancestors(code):
    """Dotted-prefix ancestors, ignoring a trailing letter variant."""
    base = re.sub(r"[A-Za-z]$", "", code)
    segs = base.split(".")
    return [".".join(segs[:i]) for i in range(1, len(segs))]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--out", default="dsr_item.csv")
    ap.add_argument("--pages", help="e.g. 100-160 or 5,9,12-14 (1-indexed)")
    ap.add_argument("--year", default="", help="DSR rate year, e.g. 2023")
    args = ap.parse_args()

    try:
        import pdfplumber
    except ImportError:
        sys.exit("Install first:  pip install pdfplumber")

    items, order = {}, []          # code -> row
    subhead = ""

    with pdfplumber.open(args.pdf) as pdf:
        pages = parse_pages(args.pages, len(pdf.pages))
        cur = None
        for pi in pages:
            page = pdf.pages[pi]
            bands = column_bands(page)
            for ws in line_groups(page.extract_words()):
                raw = " ".join(w["text"] for w in ws).strip()
                m = SUBHEAD_RE.search(raw)
                if m:
                    subhead = re.sub(r"\s+", " ", m.group(1)).strip()
                    continue
                if re.fullmatch(r"\d{1,4}", raw):        # bare page number
                    continue
                code, desc, unit, rate = split_line(ws, bands)
                if code:                                  # new item row
                    if cur:
                        pass
                    cur = {"code": code, "chapter": (subhead or code.split(".")[0]),
                           "subhead": subhead, "desc": desc, "unit": unit or "",
                           "rate": rate or ""}
                    if code not in items:
                        order.append(code)
                    items[code] = cur
                elif cur:                                 # continuation line
                    if desc:
                        cur["desc"] = (cur["desc"] + " " + desc).strip()
                    if unit and not cur["unit"]:
                        cur["unit"] = unit
                    if rate and not cur["rate"]:
                        cur["rate"] = rate

    # Stitch parent context into each leaf description.
    def full_desc(code):
        parts = []
        for a in ancestors(code):
            if a in items and items[a]["desc"]:
                parts.append(items[a]["desc"])
        if items[code]["desc"]:
            parts.append(items[code]["desc"])
        seen, out = set(), []
        for p in parts:                                   # de-dupe repeats
            if p not in seen:
                seen.add(p); out.append(p)
        return " — ".join(out)

    with open(args.out, "w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(["code", "chapter", "subhead", "description", "unit", "rate", "rate_year", "billable"])
        n = 0
        for code in order:
            it = items[code]
            billable = bool(it["rate"] and it["unit"])
            wr.writerow([code, it["chapter"], it["subhead"], full_desc(code),
                         it["unit"], it["rate"], args.year, int(billable)])
            n += 1
    print(f"Wrote {n} rows to {args.out}  ({sum(1 for c in order if items[c]['rate'])} billable)")

if __name__ == "__main__":
    main()
