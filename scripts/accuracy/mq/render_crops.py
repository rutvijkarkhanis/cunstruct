"""Render review crops with poppler (independent of pdf.js) for the measurement-quality tools.
Usage: python3 -I render_crops.py <jobs.json>
jobs.json: {"pdf": path, "dpi": 200, "jobs": [{"out": png, "page": n, "x0": pt, "y0": pt, "w": pt, "h": pt,
            "marker": [x, y] | null, "label": str, "ruler": bool, "overlays": [{"kind": "line"|"ring"|"box"|"poly", ...}]}]}
Overlays are drawn only when given (the blinded reviewer crops get a neutral marker and a ruler only)."""
import json, subprocess, sys, os
from PIL import Image, ImageDraw

def render(pdf, j, dpi):
    k = dpi / 72
    base = j["out"][:-4]
    subprocess.run(["pdftoppm", "-f", str(j["page"]), "-l", str(j["page"]), "-r", str(dpi), "-x", str(int(j["x0"] * k)), "-y", str(int(j["y0"] * k)),
                    "-W", str(int(j["w"] * k)), "-H", str(int(j["h"] * k)), "-png", "-singlefile", pdf, base], check=True)
    im = Image.open(j["out"]).convert("RGB"); d = ImageDraw.Draw(im)
    P = lambda x, y: ((x - j["x0"]) * k, (y - j["y0"]) * k)
    if j.get("ruler"):
        step, minor = j.get("ruler_step", 50), j.get("ruler_minor", 0)
        if minor:
            for v in range(int(j["x0"] // minor + 1) * minor, int(j["x0"] + j["w"]), minor):
                x, _ = P(v, j["y0"]); d.line([(x, 0), (x, 5)], fill=(90, 90, 90), width=1)
            for v in range(int(j["y0"] // minor + 1) * minor, int(j["y0"] + j["h"]), minor):
                _, y = P(j["x0"], v); d.line([(0, y), (5, y)], fill=(90, 90, 90), width=1)
        for v in range(int(j["x0"] // step + 1) * step, int(j["x0"] + j["w"]), step):
            x, _ = P(v, j["y0"]); d.line([(x, 0), (x, 12)], fill=(0, 0, 0), width=1); d.text((x + 2, 1), str(v), fill=(0, 0, 0))
        for v in range(int(j["y0"] // step + 1) * step, int(j["y0"] + j["h"]), step):
            _, y = P(j["x0"], v); d.line([(0, y), (12, y)], fill=(0, 0, 0), width=1); d.text((14, y - 5), str(v), fill=(0, 0, 0))
    if j.get("marker"):
        cx, cy = P(*j["marker"]); r = j.get("marker_radius_pt", 16) * k
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(200, 0, 200), width=j.get("marker_width", 3))
    if j.get("label"):
        d.rectangle([0, im.height - 18, 8 * len(j["label"]) + 8, im.height], fill=(255, 255, 255)); d.text((4, im.height - 15), j["label"], fill=(200, 0, 200))
    im.save(j["out"], optimize=True)

if __name__ == "__main__":
    spec = json.load(open(sys.argv[1]))
    for j in spec["jobs"]:
        os.makedirs(os.path.dirname(j["out"]), exist_ok=True)
        render(spec["pdf"], j, spec.get("dpi", 200))
    print(f"rendered {len(spec['jobs'])}")
