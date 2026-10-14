"""Page layout for the drawing extractor: where the text structures are.

Pure functions over the ruling-line mask and OCR word boxes (300-dpi pixels):
  frame_free  - drop page-spanning rules (sheet frame, title-block dividers) so
                schedules drawn against the frame are still found as tables;
  group_lines - OCR words -> text lines with box, height and confidence;
  quality     - whether a region's text is large and clear enough to trust;
  list_blocks - unruled lists: left-aligned runs of short entries (legends,
                room-type lists) that no ruled-table reader would see.
Nothing here decides a quantity.
"""
import re
import statistics

import numpy as np

MIN_TEXT_PX = 16      # median word height at 300 dpi (~1.4 mm): below this OCR is unreliable
MIN_CONFIDENCE = 60   # mean Tesseract word confidence (0-100)


def _long_runs(m, L):
    c = np.concatenate([np.zeros((m.shape[0], 1), np.int32), np.cumsum(m, axis=1, dtype=np.int32)], axis=1)
    full = (c[:, L:] - c[:, :-L]) == L
    s = np.concatenate([np.zeros((m.shape[0], 1), np.int32), np.cumsum(full, axis=1, dtype=np.int32)], axis=1)
    idx = np.arange(m.shape[1])
    lo = np.clip(idx - L + 1, 0, full.shape[1]); hi = np.clip(idx + 1, 0, full.shape[1])
    return (s[:, hi] - s[:, lo]) > 0


def frame_free(mask, span=0.6):
    """The line mask without rules spanning >= `span` of the page width or
    height — the sheet frame and title-block dividers. A schedule whose
    outer rules join the frame becomes its own structure again."""
    h, w = mask.shape
    longs = _long_runs(mask, int(span * w)) | _long_runs(mask.T, int(span * h)).T
    return mask & ~longs


def group_lines(words, gap_factor=3.0):
    """Words ({t, x, y, w, h, conf?}) -> lines {text, x0, y0, x1, y1, h, conf, words},
    top to bottom. Same line: vertical centres within 0.6 of the word height and
    a horizontal gap under gap_factor x height."""
    rows = []  # pass 1: words sharing a baseline, whatever their order
    for w in sorted(words, key=lambda w: w["y"] + w["h"] / 2):
        cy = w["y"] + w["h"] / 2
        row = next((r for r in rows if abs(cy - r["cy"]) < 0.6 * max(w["h"], r["h"])), None)
        if row:
            row["words"].append(w); row["h"] = max(row["h"], w["h"])
        else:
            rows.append(dict(words=[w], cy=cy, h=w["h"]))
    lines = []  # pass 2: split each row left to right at wide gaps
    for r in rows:
        cur = None
        for w in sorted(r["words"], key=lambda w: w["x"]):
            if cur and w["x"] - cur["x1"] < gap_factor * max(w["h"], cur["h"]):
                cur["words"].append(w); cur["x1"] = max(cur["x1"], w["x"] + w["w"]); cur["h"] = max(cur["h"], w["h"])
            else:
                cur = dict(words=[w], x0=w["x"], x1=w["x"] + w["w"], h=w["h"]); lines.append(cur)
    out = []
    for ln in lines:
        ws = sorted(ln["words"], key=lambda w: w["x"])
        confs = [float(w["conf"]) for w in ws if float(w.get("conf", -1)) >= 0]
        out.append(dict(text=" ".join(w["t"] for w in ws), x0=ln["x0"], x1=ln["x1"],
                        y0=min(w["y"] for w in ws), y1=max(w["y"] + w["h"] for w in ws),
                        h=statistics.median(w["h"] for w in ws), conf=statistics.mean(confs) if confs else None, words=ws))
    return sorted(out, key=lambda l: (l["y0"], l["x0"]))


def quality(words):
    """{readable, median_height_px, mean_confidence} for a region's OCR words."""
    alnum = [w for w in words if re.search(r"[A-Za-z0-9]", w["t"])]
    if not alnum:
        return dict(readable=False, median_height_px=None, mean_confidence=None)
    h = statistics.median(w["h"] for w in alnum)
    confs = [float(w["conf"]) for w in alnum if float(w.get("conf", -1)) >= 0]
    c = statistics.mean(confs) if confs else 0.0
    return dict(readable=h >= MIN_TEXT_PX and c >= MIN_CONFIDENCE, median_height_px=h, mean_confidence=round(c, 1))


def _inside(line, box, pad=10):
    x0, y0, x1, y1 = box
    return line["x0"] >= x0 - pad and line["x1"] <= x1 + pad and line["y0"] >= y0 - pad and line["y1"] <= y1 + pad


def _is_entry(text, max_words):
    words = text.split()
    if not (1 <= len(words) <= max_words):
        return False
    letters = [c for c in text if c.isalpha()]
    return len(letters) >= 3 and sum(c.isupper() for c in letters) >= 0.7 * len(letters)


def list_blocks(lines, exclude_boxes=(), min_entries=4, max_words=7, align_px=30):
    """Unruled lists: >= min_entries consecutive short, mostly-uppercase lines
    whose left edges align (within align_px) and whose spacing is even
    (each gap <= 2.5 x the text height). Lines inside a ruled table are left
    to the table reader."""
    cands = [l for l in lines if _is_entry(l["text"], max_words) and not any(_inside(l, b) for b in exclude_boxes)]
    blocks, used = [], set()
    for i, first in enumerate(cands):
        if i in used:
            continue
        block = [first]
        for j in range(i + 1, len(cands)):
            if j in used:
                continue
            nxt, prev = cands[j], block[-1]
            if abs(nxt["x0"] - first["x0"]) <= align_px and 0 < nxt["y0"] - prev["y1"] <= 2.5 * max(prev["h"], nxt["h"]):
                block.append(nxt)
        if len(block) >= min_entries:
            used.update(cands.index(l) for l in block)
            blocks.append(dict(entries=[l["text"] for l in block], box=(min(l["x0"] for l in block), block[0]["y0"],
                                                                            max(l["x1"] for l in block), block[-1]["y1"]),
                               words=[w for l in block for w in l["words"]]))
    return blocks
