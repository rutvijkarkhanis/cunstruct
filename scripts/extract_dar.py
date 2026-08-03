#!/usr/bin/env python3
"""
Extract material/labour COEFFICIENTS from CPWD DAR (Delhi Analysis of Rates) PDFs.

Each DAR item is a rate analysis: under a DSR-style code, resource rows read
    <resource-code> <name...> <unit> <quantity> <rate> <amount>
where `quantity` is the consumption per 1 unit of the item — the coefficient.
e.g. item 3.6 (Cement mortar 1:6): Portland Cement 0.25 tonne, Fine sand 1.07 cum.

    python extract_dar.py out.csv dar1.pdf dar2.pdf ...
Emits: item_code, chapter, resource_code, resource, unit, qty, kind
"""
import sys, csv, re

CODE = re.compile(r"^\d{1,2}\.\d+(?:\.\d+)*[A-Za-z]?$")     # item codes (3.6, 5.22.6)
RES = re.compile(r"^\d{3,4}$")                              # resource codes (0367, 9999)
SUBHEAD = re.compile(r"SUB\s*HEAD\s*[:\-]?\s*(\d+)\b\s*(.*)", re.I)
NUM = re.compile(r"^\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^\d+\.\d+$")
UNITS = {"tonne","cum","sqm","kg","bag","day","metre","meter","each","quintal","qtl",
         "litre","liter","no","nos","rmt","rm","hour","l.s","ls","%","pair","set","km","point"}
LABOUR = {"beldar","bhisti","bhishti","mason","coolie","mate","mazdoor","carpenter",
          "blacksmith","fitter","painter","plumber","mistry","helper"}
def is_unit(s): return s.strip().lower().rstrip(".") in UNITS
def is_num(s):  return bool(NUM.match(s.strip().replace(",", "")))

def kind_of(code, name, unit):
    n = name.lower()
    if any(w in n.split() for w in LABOUR) or n in LABOUR: return "labour"
    if code == "9999" or unit.lower().rstrip(".") in ("l.s","ls") or "hire" in n or "sundr" in n or "charges" in n:
        return "plant"
    return "material"

def extract(paths):
    import fitz
    lines = []
    for p in paths:
        d = fitz.open(p)
        for pi in range(d.page_count):
            for ln in d[pi].get_text().splitlines():
                s = ln.strip()
                if s: lines.append(s)
    N = len(lines); i = 0; chapter = None; cur = None; out = []
    while i < N:
        s = lines[i]
        m = SUBHEAD.match(s)
        if m:
            chapter = int(m.group(1)); i += 1; continue
        if chapter is not None and CODE.match(s) and int(s.split(".")[0]) == chapter:
            cur = {"code": s, "chapter": chapter}; i += 1; continue
        if cur and RES.match(s):
            rcode = s; j = i + 1; name = []
            while (j < N and not is_unit(lines[j]) and not RES.match(lines[j])
                   and not CODE.match(lines[j])
                   and not lines[j].lower().startswith(("cost of","say","total","add "))):
                name.append(lines[j]); j += 1
            if j < N and is_unit(lines[j]):
                unit = lines[j]; k = j + 1; nums = []
                while k < N and len(nums) < 3 and is_num(lines[k]):
                    nums.append(lines[k]); k += 1
                if nums and name:
                    nm = re.sub(r"\s+", " ", " ".join(name)).strip()
                    out.append({"item_code": cur["code"], "chapter": cur["chapter"],
                                "resource_code": rcode, "resource": nm, "unit": unit.rstrip("."),
                                "qty": nums[0].replace(",", ""), "kind": kind_of(rcode, nm, unit)})
                    i = k; continue
            i = j + 1; continue
        i += 1
    return out

if __name__ == "__main__":
    out, paths = sys.argv[1], sys.argv[2:]
    rows = extract(paths)
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["item_code","chapter","resource_code","resource","unit","qty","kind"])
        w.writeheader(); w.writerows(rows)
    from collections import Counter
    print(f"coefficients={len(rows)}  items={len(set(r['item_code'] for r in rows))}")
    print("by kind:", dict(Counter(r["kind"] for r in rows)))
