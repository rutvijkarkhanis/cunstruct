"""Unit tests for layout.py (synthetic masks and word boxes; no OCR).
Run: python3 -m unittest discover -s scripts/drawing-ocr"""
import unittest
import numpy as np
from layout import frame_free, group_lines, quality, list_blocks
from drawing_ocr import tables


def word(t, x, y, h=30, conf=90):
    return dict(t=t, x=x, y=y, w=len(t) * h // 2, h=h, conf=conf)


class FrameFree(unittest.TestCase):
    def test_a_table_drawn_against_the_frame_is_found_again(self):
        m = np.zeros((3000, 4000), bool)
        m[50, 50:3950] = m[2950, 50:3950] = True; m[50:2950, 50] = m[50:2950, 3950] = True   # sheet frame
        for y in range(2500, 2951, 90): m[y, 50:1100] = True                                  # schedule rows, joined to the frame
        for x in (50, 300, 700, 1100): m[2500:2951, x] = True
        self.assertEqual(tables(m, m.shape), [])                     # without: swallowed by the frame
        found = tables(frame_free(m), m.shape)
        self.assertEqual(len(found), 1)
        x0, y0, x1, y1 = found[0]
        self.assertTrue(x0 <= 300 and x1 >= 1100 and y0 <= 2500 and y1 >= 2860)


class Lines(unittest.TestCase):
    def test_words_on_one_baseline_form_one_line(self):
        ls = group_lines([word("MAIN", 100, 100), word("ENTRANCE", 190, 102), word("LOBBY", 330, 99), word("BANK", 100, 160)])
        self.assertEqual([l["text"] for l in ls], ["MAIN ENTRANCE LOBBY", "BANK"])


class Quality(unittest.TestCase):
    def test_small_or_low_confidence_text_is_not_readable(self):
        self.assertTrue(quality([word("STORE", 0, 0, h=30, conf=92)])["readable"])
        self.assertFalse(quality([word("st0re", 0, 0, h=11, conf=92)])["readable"])   # too small
        self.assertFalse(quality([word("sooxzio0", 0, 0, h=30, conf=35)])["readable"])  # garbled
        self.assertFalse(quality([word("|", 0, 0)])["readable"])                         # no text at all


class Lists(unittest.TestCase):
    LEGEND = ["STAIRCASE (AS PER DETAIL)", "LIFT AS PER DETAIL", "ELECTRICAL ROOM", "STORE", "BANK"]

    def lines(self, x=100, y=100, entries=LEGEND, step=60):
        ws = []
        for i, e in enumerate(entries):
            cx = x
            for t in e.split():
                ws.append(word(t, cx, y + i * step)); cx += len(t) * 15 + 20
        return group_lines(ws)

    def test_left_aligned_short_entries_are_a_list(self):
        b = list_blocks(self.lines())
        self.assertEqual(len(b), 1)
        self.assertEqual(b[0]["entries"], self.LEGEND)

    def test_sentences_and_too_few_entries_are_not(self):
        notes = ["ALL DIMENSIONS ARE IN MILLIMETRES UNLESS OTHERWISE SPECIFIED ON PLAN"] * 5
        self.assertEqual(list_blocks(self.lines(entries=notes)), [])
        self.assertEqual(list_blocks(self.lines(entries=self.LEGEND[:3])), [])

    def test_lines_inside_a_ruled_table_are_left_to_the_table_reader(self):
        self.assertEqual(list_blocks(self.lines(), exclude_boxes=[(50, 50, 2000, 1000)]), [])

    def test_misaligned_lines_do_not_join(self):
        ls = self.lines()
        ls[2]["x0"] += 300; ls[2]["x1"] += 300
        self.assertEqual(list_blocks(ls), [])


if __name__ == "__main__":
    unittest.main()
