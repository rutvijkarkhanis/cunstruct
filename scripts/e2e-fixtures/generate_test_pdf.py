#!/usr/bin/env python3
"""Generate a minimal, deterministic, valid multi-page PDF test fixture for
Playwright e2e tests (M8). Hand-built PDF 1.4 bytes, no external library —
this script's only job is correct byte-offset bookkeeping for the xref
table. Page size is fixed at 612x792pt (US Letter) so e2e specs can predict
exact on-screen positions from known PDF-point bboxes without depending on
any particular pdf.js scale factor (see e2e/support/pdfGeometry.ts).

Each page carries simple, visually distinct filled rectangles + plain text
(base-14 Helvetica, no font embedding needed) so a human reviewing a
screenshot can see real, page-specific content — not a blank page.
"""
import sys

PAGE_W, PAGE_H = 612, 792


def content_stream(label: str, rects: list[tuple[float, float, float, float, float, float, float]]) -> bytes:
    """rects: list of (x, y, w, h, r, g, b) in PDF space (origin bottom-left)."""
    ops = [f"BT /F1 24 Tf 40 {PAGE_H - 60} Td ({label}) Tj ET"]
    for (x, y, w, h, r, g, b) in rects:
        ops.append(f"{r:.3f} {g:.3f} {b:.3f} rg {x:.2f} {y:.2f} {w:.2f} {h:.2f} re f")
    return "\n".join(ops).encode("latin-1")


def build_pdf(pages: list[tuple[str, list]]) -> bytes:
    objs: list[bytes] = [b""]  # 1-indexed; objs[0] unused

    def add(obj_bytes: bytes) -> int:
        objs.append(obj_bytes)
        return len(objs) - 1

    # Reserve object numbers up front so cross-references can be written
    # before the objects that use them are built.
    n_catalog = 1
    n_pages = 2
    n_font = 3
    first_page_obj = 4
    # Each page takes 2 objects (page dict + content stream).
    page_obj_nums = []
    content_obj_nums = []
    next_num = first_page_obj
    for _ in pages:
        page_obj_nums.append(next_num)
        content_obj_nums.append(next_num + 1)
        next_num += 2

    kids = " ".join(f"{n} 0 R" for n in page_obj_nums)

    objs_by_num: dict[int, bytes] = {}
    objs_by_num[n_catalog] = f"<< /Type /Catalog /Pages {n_pages} 0 R >>".encode()
    objs_by_num[n_pages] = f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>".encode()
    objs_by_num[n_font] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"

    for i, (label, rects) in enumerate(pages):
        page_num = page_obj_nums[i]
        content_num = content_obj_nums[i]
        stream = content_stream(label, rects)
        objs_by_num[page_num] = (
            f"<< /Type /Page /Parent {n_pages} 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] "
            f"/Resources << /Font << /F1 {n_font} 0 R >> >> /Contents {content_num} 0 R >>"
        ).encode()
        objs_by_num[content_num] = (
            f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream"
        )

    max_num = next_num - 1
    out = bytearray()
    out += b"%PDF-1.4\n"
    offsets: dict[int, int] = {}
    for num in range(1, max_num + 1):
        offsets[num] = len(out)
        out += f"{num} 0 obj\n".encode()
        out += objs_by_num[num]
        out += b"\nendobj\n"

    xref_offset = len(out)
    out += f"xref\n0 {max_num + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for num in range(1, max_num + 1):
        out += f"{offsets[num]:010d} 00000 n \n".encode()
    out += b"trailer\n"
    out += f"<< /Size {max_num + 1} /Root {n_catalog} 0 R >>\n".encode()
    out += b"startxref\n"
    out += f"{xref_offset}\n".encode()
    out += b"%%EOF"
    return bytes(out)


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "test-drawing.pdf"
    variant = sys.argv[2] if len(sys.argv) > 2 else "a"
    # Page 1: a "door" rectangle at PDF-space [250,442,360,512] (bottom-left
    # origin) == top-left-origin bbox [250,280,360,350] used by evidence
    # bboxes in fixtures (y_top_left = PAGE_H - y_pdf_top). Kept deliberately
    # simple: one labelled rectangle per page, at a DIFFERENT, known spot.
    # Variant "b" is document B for cross-document isolation tests: its
    # page 1 is visibly different from document A's page 1 (different
    # label/rect), so a human reviewing a screenshot can tell the two
    # documents apart even though both use the same page NUMBER (1).
    if variant == "b":
        pages = [
            ("DOC B - PAGE 1 - COLUMN C1", [(350, 150, 90, 120, 0.2, 0.7, 0.3)]),
            ("DOC B - PAGE 2 - EMPTY", []),
        ]
    else:
        pages = [
            ("PAGE 1 - DOOR D1", [(250, 442, 110, 70, 0.85, 0.3, 0.2)]),
            ("PAGE 2 - WINDOW W1", [(80, 500, 140, 90, 0.2, 0.4, 0.85)]),
            ("PAGE 3 - EMPTY", []),
        ]
    data = build_pdf(pages)
    with open(out_path, "wb") as f:
        f.write(data)
    print(f"wrote {len(data)} bytes to {out_path}")


if __name__ == "__main__":
    main()
