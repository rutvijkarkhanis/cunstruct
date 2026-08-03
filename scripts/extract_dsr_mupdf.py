#!/usr/bin/env python3
"""
Extract DSR work-item rates from CPWD DSR Vol-1 (Civil) PDFs using PyMuPDF.

PyMuPDF serialises each table cell as its own line, in reading order:
    <code> \n <description lines...> \n <unit> \n <rate>
so a small state machine reconstructs each item. Parent codes (4.1) carry the
real item text; children (4.1.2) carry only the variant — we stitch parents in.

Only rows inside a "SUB HEAD : n.0 NAME" chapter are treated as billable work
items, which keeps the front-matter / specification text out.

    python extract_dsr_mupdf.py out.csv file1.pdf file2.pdf ...
"""
import sys, csv, re

CODE = re.compile(r"^\d{1,2}\.\d+(?:\.\d+)*[A-Za-z]?$")
def valid_code(s):
    if not CODE.match(s): return False
    segs = re.sub(r"[A-Za-z]$", "", s).split(".")
    if int(segs[0]) > 30: return False          # no chapter beyond ~26
    if any(len(x) >= 4 for x in segs): return False   # reject dates/years (2023)
    return True
SUBHEAD = re.compile(r"SUB\s*HEAD\s*[:\-]?\s*(\d+\.\d+)\s+(.+)", re.I)
NUM = re.compile(r"^\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$|^\d+\.\d{1,2}$")
UNITS = {"cum","sqm","rmt","rm","metre","meter","each","nos","no","kg","quintal",
         "qtl","mt","litre","liter","ltr","day","hour","tonne","point","pair","set",
         "hectare","tonne km","kw","kg.","cum.","sqm.","%","km"}
HEADERS = {"code no","code no.","description","unit","rate","code","basic rate"}

def is_unit(s): return s.strip().lower().rstrip(".") in UNITS
def is_rate(s): return bool(NUM.match(s.strip().replace(",", "")))

def ancestors(code):
    base = re.sub(r"[A-Za-z]$", "", code)
    segs = base.split(".")
    return [".".join(segs[:i]) for i in range(1, len(segs))]

def extract(paths):
    import fitz
    items, order = {}, []
    chapter = subhead = ""
    cur = None
    def flush():
        nonlocal cur
        if cur and cur["code"] not in items:
            order.append(cur["code"])
        if cur:
            items[cur["code"]] = cur
        cur = None
    for path in paths:
        doc = fitz.open(path)
        for pi in range(doc.page_count):
            for raw in doc[pi].get_text().splitlines():
                s = raw.strip()
                if not s or s.lower() in HEADERS:
                    continue
                m = SUBHEAD.search(s)
                if m:
                    flush(); chapter = m.group(1); subhead = re.sub(r"\s+"," ",m.group(2)).strip()
                    continue
                if not chapter:                      # still in front-matter
                    continue
                if valid_code(s) and int(s.split(".")[0]) == int(chapter.split(".")[0]):
                    flush()
                    cur = {"code": s, "chapter": chapter, "subhead": subhead,
                           "desc": [], "unit": "", "rate": ""}
                elif cur is None:
                    continue
                elif is_unit(s) and not cur["unit"]:
                    cur["unit"] = s.strip().rstrip(".")
                elif is_rate(s) and cur["unit"] and not cur["rate"]:
                    cur["rate"] = s.replace(",", "")
                else:
                    if not is_rate(s):               # skip stray page numbers
                        cur["desc"].append(s)
        flush()

    def full_desc(code):
        parts = []
        for a in ancestors(code):
            if a in items and items[a]["desc"]:
                parts.append(" ".join(items[a]["desc"]))
        if items[code]["desc"]:
            parts.append(" ".join(items[code]["desc"]))
        out, seen = [], set()
        for p in parts:
            p = re.sub(r"\s+", " ", p).strip()
            if p and p not in seen:
                seen.add(p); out.append(p)
        return " — ".join(out)

    rows = []
    for code in order:
        it = items[code]
        rows.append({"code": code, "chapter": it["chapter"], "subhead": it["subhead"],
                     "description": full_desc(code), "unit": it["unit"],
                     "rate": it["rate"], "billable": int(bool(it["unit"] and it["rate"]))})
    return rows

if __name__ == "__main__":
    out, paths = sys.argv[1], sys.argv[2:]
    rows = extract(paths)
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["code","chapter","subhead","description","unit","rate","billable"])
        w.writeheader(); w.writerows(rows)
    billable = [r for r in rows if r["billable"]]
    print(f"rows={len(rows)} billable={len(billable)} -> {out}")
    chs = {}
    for r in billable:
        chs.setdefault(f'{r["chapter"]} {r["subhead"]}', 0); chs[f'{r["chapter"]} {r["subhead"]}'] += 1
    for k in sorted(chs): print(f"  {k}: {chs[k]}")
