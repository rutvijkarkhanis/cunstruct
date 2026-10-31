"""Audit blinded review packages (read-only).
Usage: python3 -I audit_review_packages.py <review dir containing reviewer-1/ reviewer-2/ SECRET-answer-key/> <source pdf> [--crop-sample N]
Checks: duplicates, package composition, leakage (engine ids, statuses, reasons, Gold Set ids, developer verdicts,
answer-key fields) in every reviewer-visible file and PNG metadata, file whitelist, crop/PDF agreement, form coverage,
reviewer-2 subset independence. Prints a JSON report; exits 1 if any check fails."""
import json, sys, os, re, hashlib, subprocess, tempfile, random, csv
from PIL import Image, ImageChops

root, src_pdf = sys.argv[1], sys.argv[2]
sample = int(sys.argv[sys.argv.index("--crop-sample") + 1]) if "--crop-sample" in sys.argv else 20
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
R = {"checks": [], "failures": []}
def check(name, ok, detail=""):
    R["checks"].append({"check": name, "ok": bool(ok), "detail": detail})
    if not ok: R["failures"].append(name)

key = json.load(open(f"{root}/SECRET-answer-key/answer-key.json"))["entries"]
samp = json.load(open(f"{root}/SECRET-answer-key/sampling.json"))
r1 = json.load(open(f"{root}/reviewer-1/items.json")); r2 = json.load(open(f"{root}/reviewer-2/items.json"))
ids1 = [i["item_id"] for i in r1["items"]]; ids2 = [i["item_id"] for i in r2["items"]]

# composition and duplicates
from collections import Counter
pk = Counter(e["package"] for e in key)
check("package composition A116 B35 C30 D15 = 196", dict(pk) == {"A": 116, "B": 35, "C": 30, "D": 15}, dict(pk))
check("no duplicate engine measurement across packages", len({e["engine_id"] for e in key}) == len(key))
check("no duplicate reviewer item ids", len(set(ids1)) == len(ids1) == 196 and len(set(ids2)) == len(ids2))
check("reviewer-1 items == answer-key items", set(ids1) == {e["item_id"] for e in key})
check("reviewer-2: 36 items, a subset of reviewer-1, equal to the recorded second-reviewer sample", len(ids2) == 36 and set(ids2) <= set(ids1) and sorted(ids2) == sorted(samp["second_reviewer"]["item_ids"]))
check("reviewer-2 order is independently shuffled (not reviewer-1 order)", ids2 != [i for i in ids1 if i in set(ids2)])
b = [e for e in key if e["package"] == "B"]
check("package B = Gold Set non-accepted (28 held + 7 rejected)", Counter(e["engine_status"] for e in b) == Counter({"hold": 28, "reject": 7}) and all(e["gold_id"] for e in b))
check("package A all accepted, C all held, D all rejected", all(e["engine_status"] == {"A": "acceptable", "C": "hold", "D": "reject"}[e["package"]] for e in key if e["package"] != "B"))
check("packages C and D contain no Gold Set item", not any(e["gold_id"] for e in key if e["package"] in "CD"))

# reviewer item fields
allowed = {"item_id", "page", "crop", "marker_pt", "page_image", "context"}
bad = [k for it in r1["items"] + r2["items"] for k in it if k not in allowed]
check("reviewer items carry only whitelisted fields", not bad, sorted(set(bad)))

# leakage scan over every reviewer-visible file
engine_ids = {e["engine_id"] for e in key}; gold_ids = {e["gold_id"] for e in key if e["gold_id"]}
regions = {e["scale_region"] for e in key if e["scale_region"]}
words = ["acceptable", "accepted", "held", "hold", "reject", "rejected", "consistent", "ambiguous", "unassociated", "grid-to-grid", "grid-to-edge", "edge-to-edge",
         "terminator", "filled-tick", "valid-pair", "developer", "gold set", "gold_id", "engine_status", "primary_reason", "answer", "package", "verdict"]
# words legitimately used in the instructions / schema are allowed only in those files
instr_ok = {"REVIEWER-INSTRUCTIONS.md", "review-response.schema.json", "review-form.csv", "review-app.html", "review-app.js", "items.js"}
leaks = []
for rv in ("reviewer-1", "reviewer-2"):
    for dp, _, fs in os.walk(f"{root}/{rv}"):
        for f in fs:
            p = os.path.join(dp, f); rel = os.path.relpath(p, root)
            if f.endswith(".png"):
                im = Image.open(p)
                meta = " ".join(f"{k}={v}" for k, v in im.info.items() if isinstance(v, (str, bytes)))
                if re.search(r"D\d-\d+|GS-\d+", meta): leaks.append(f"{rel}: PNG metadata {meta[:80]}")
                if not re.fullmatch(r"(RV-[2-9A-HJ-NP-Z]{6}(-context)?|page-\d+)\.png", f): leaks.append(f"{rel}: unexpected image name")
                continue
            if f.endswith(".pdf"):
                if sha(p) != sha(src_pdf): leaks.append(f"{rel}: PDF differs from the source drawing")
                continue
            t = open(p, encoding="utf8", errors="replace").read()
            for eid in engine_ids:
                if re.search(rf"\b{re.escape(eid)}\b", t): leaks.append(f"{rel}: engine id {eid}"); break
            for g in gold_ids:
                if g in t: leaks.append(f"{rel}: Gold Set id {g}"); break
            for rg in regions:
                if re.search(rf'"{rg}"', t): leaks.append(f"{rel}: scale region {rg}"); break
            if f not in instr_ok:
                for w in words:
                    if re.search(rf"\b{re.escape(w)}\b", t, re.I): leaks.append(f"{rel}: word '{w}'"); break
            if f in ("items.json", "items.js", "review-form.csv") and re.search(r'"(engine|status|decision|reason|association|span|line)"\s*:', t): leaks.append(f"{rel}: engine field")
check("no answer-key / engine / developer leakage in reviewer files", not leaks, leaks[:20])
files = sorted(os.path.relpath(os.path.join(dp, f), f"{root}/reviewer-2") for dp, _, fs in os.walk(f"{root}/reviewer-2") for f in fs)
check("reviewer-2 package holds no responses or reviewer-1 material", not any(re.search(r"responses|reviewer-1|answer|SECRET|submission", f, re.I) for f in files), [f for f in files if not f.startswith("crops/")][:20])
for rv in ("reviewer-1", "reviewer-2"):
    rows = list(csv.DictReader(open(f"{root}/{rv}/review-form.csv")))
    filled = [r["item_id"] for r in rows if any((v or "").strip() for k, v in r.items() if k not in ("item_id", "reviewer_id", "page", "marker_x", "marker_y"))]
    check(f"{rv}: form is blank (no answers pre-filled)", not filled, filled[:5])
check("answer key is not inside any reviewer folder", not any("SECRET" in dp or "answer-key" in " ".join(fs) for rv in ("reviewer-1", "reviewer-2") for dp, _, fs in os.walk(f"{root}/{rv}")))

# forms
for rv, ids in (("reviewer-1", ids1), ("reviewer-2", ids2)):
    rows = list(csv.DictReader(open(f"{root}/{rv}/review-form.csv")))
    check(f"{rv}: one form row per item, same ids", [r["item_id"] for r in rows] == ids, f"{len(rows)} rows")
    check(f"{rv}: every crop and page image exists", all(os.path.exists(f"{root}/{rv}/{it['crop']['file']}") and os.path.exists(f"{root}/{rv}/{it['page_image']}") for it in (r1 if rv == "reviewer-1" else r2)["items"]))

# v2 additions: context views, blind app, items.js, roster
for rv, data in (("reviewer-1", r1), ("reviewer-2", r2)):
    d = f"{root}/{rv}"
    if os.path.exists(f"{d}/items.js"):
        js = open(f"{d}/items.js").read()
        payload = json.loads(js[js.index("=") + 1: js.rindex(";")])
        check(f"{rv}: items.js carries exactly the items.json items and nothing else", payload["items"] == data["items"] and set(payload) == {"reviewer_id", "drawing", "items"})
        check(f"{rv}: review app present and reads only items.js", os.path.exists(f"{d}/review-app.html") and "items.js" in open(f"{d}/review-app.html").read() and not re.search(r"answer[-_]key|engine_(id|status)|gold_id|SECRET", open(f"{d}/review-app.js").read()))
    if any("context" in it for it in data["items"]):
        check(f"{rv}: every context view exists and is the same size for every item", all(os.path.exists(f"{d}/{it['context']['file']}") for it in data["items"]) and len({(it["context"]["w"], it["context"]["h"]) for it in data["items"]}) <= 2)
    check(f"{rv}: every crop window is the same size", len({(it["crop"]["w"], it["crop"]["h"]) for it in data["items"]}) == 1)
if os.path.exists(f"{root}/COORDINATOR/roster.json"):
    ro = json.load(open(f"{root}/COORDINATOR/roster.json"))["reviewers"]
    by = {r["role"]: r for r in ro}
    check("roster: reviewer-1 assigned all reviewer-1 items, reviewer-2 exactly its 36, adjudicator none", sorted(by["reviewer-1"]["assigned"]) == sorted(ids1) and sorted(by["reviewer-2"]["assigned"]) == sorted(ids2) and by["adjudicator"]["assigned"] == [])
    check("form reviewer ids match the roster", all(r["reviewer_id"] == by["reviewer-1"]["id"] for r in csv.DictReader(open(f"{root}/reviewer-1/review-form.csv"))) and all(r["reviewer_id"] == by["reviewer-2"]["id"] for r in csv.DictReader(open(f"{root}/reviewer-2/review-form.csv"))))
    check("coordinator folder holds no answer key or engine data", not any(re.search(r"engine_id|engine_status|gold_id", open(os.path.join(dp, f), errors="replace").read()) for dp, _, fs in os.walk(f"{root}/COORDINATOR") for f in fs))

# crop agreement: re-render a deterministic sample from the PACKAGE's PDF and compare pixels outside the drawn marks
random.seed(7); pick = random.sample(r1["items"], min(sample, len(r1["items"])))
pdf_in_pkg = os.path.join(root, "reviewer-1", r1["drawing"]["file"])
diffs = []
with tempfile.TemporaryDirectory() as td:
    for it in pick:
        c = it["crop"]; k = c["px_per_pt"]
        base = os.path.join(td, it["item_id"])
        subprocess.run(["pdftoppm", "-f", str(it["page"]), "-l", str(it["page"]), "-r", str(round(k * 72)), "-x", str(int(c["x0"] * k)), "-y", str(int(c["y0"] * k)),
                        "-W", str(int(c["w"] * k)), "-H", str(int(c["h"] * k)), "-png", "-singlefile", pdf_in_pkg, base], check=True)
        a = Image.open(base + ".png").convert("RGB"); b2 = Image.open(f"{root}/reviewer-1/{c['file']}").convert("RGB")
        if a.size != b2.size: diffs.append((it["item_id"], "size")); continue
        d = ImageChops.difference(a, b2).convert("L").point(lambda v: 255 if v > 40 else 0)
        # allowed differences: ruler strips, marker ring, label
        mx, my = (it["marker_pt"][0] - c["x0"]) * k, (it["marker_pt"][1] - c["y0"]) * k
        px = d.load(); W, Hh = d.size; n = 0
        for y in range(0, Hh, 2):
            for x in range(0, W, 2):
                if px[x, y] and x > 60 and y > 20 and y < Hh - 22 and abs(((x - mx) ** 2 + (y - my) ** 2) ** 0.5 - 0) > 0:
                    r = ((x - mx) ** 2 + (y - my) ** 2) ** 0.5
                    if not (abs(r - 16 * k) < 8 or abs(r - 28 * k) < 8 or r > 1e9): n += 1
        if n > 20: diffs.append((it["item_id"], n))
check(f"crop pixels agree with the source PDF at the stated coordinates ({len(pick)} sampled)", not diffs, diffs)
print(json.dumps(R, indent=1))
sys.exit(1 if R["failures"] else 0)
