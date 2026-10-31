# Builds ctm-transforms.pdf (used by pdfGeometry.test.ts): known-geometry PDF
# exercising cm, nested q/Q with rotation, a Form XObject with /Matrix, an
# annotation appearance stream, an offset CropBox and a /Rotate 90 page.
# Run: python3 build-ctm-transforms-pdf.py ctm-transforms.pdf
# Ground truth (raw PDF user space, after full CTM), hand-derived:
#   L1: q 0.5 0 0 0.5 100 100 cm; 0 0 m 400 0 l  -> (100,100)-(300,100)
#   T1: same cm, text "AA" at Td 0 0             -> origin (100,100)
#   L2: q 1 0 0 1 20 0 cm q 0 1 -1 0 300 200 cm; 0 0 m 100 0 l -> (320,200)-(320,300)
#   L3: q 1 0 0 1 100 250 cm /Fm Do (Matrix 2 0 0 2 0 0; 0 0 m 50 0 l) -> (100,250)-(200,250)
#   L5: annotation /Rect [400 100 500 150], AP BBox [0 0 50 25]; 0 10 m 50 10 l -> (400,120)-(500,120)
#   L4: no transform; 400 300 m 500 300 l        -> (400,300)-(500,300)  (control)
import sys
content = b"""q 0.5 0 0 0.5 100 100 cm 8 w 0 0 m 400 0 l S
BT /F1 20 Tf 0 0 Td (AA) Tj ET Q
q 1 0 0 1 20 0 cm q 0 1 -1 0 300 200 cm 4 w 0 0 m 100 0 l S Q Q
q 1 0 0 1 100 250 cm /Fm Do Q
4 w 400 300 m 500 300 l S
"""
form = b"2 w 0 0 m 50 0 l S"
annot = b"2 w 0 10 m 50 10 l S"
def page(rot): return (b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /CropBox [50 50 550 350] /Rotate %d "
  b"/Resources << /Font << /F1 5 0 R >> /XObject << /Fm 6 0 R >> >> /Contents 4 0 R /Annots [8 0 R] >>" % rot)
objs = [
 b"<< /Type /Catalog /Pages 2 0 R >>",
 b"<< /Type /Pages /Kids [3 0 R 7 0 R] /Count 2 >>",
 page(0),
 b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
 b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
 b"<< /Type /XObject /Subtype /Form /BBox [-10 -10 60 10] /Matrix [2 0 0 2 0 0] /Length %d >>\nstream\n" % len(form) + form + b"\nendstream",
 page(90),
 b"<< /Type /Annot /Subtype /Square /F 4 /Rect [400 100 500 150] /AP << /N 9 0 R >> >>",
 b"<< /Type /XObject /Subtype /Form /BBox [0 0 50 25] /Length %d >>\nstream\n" % len(annot) + annot + b"\nendstream",
]
out = bytearray(b"%PDF-1.4\n"); offs = []
for i, o in enumerate(objs, 1):
    offs.append(len(out)); out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
x = len(out)
out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs)+1) + b"".join(b"%010d 00000 n \n" % o for o in offs)
out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs)+1, x)
open(sys.argv[1], "wb").write(out)
