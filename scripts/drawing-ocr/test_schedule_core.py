"""Regression tests for schedule_core.py on synthetic pages (no files, no OCR).
Each class reproduces a failure seen on real development drawings; the
drawings themselves stay private, so the geometry here is made up.
Run: python3 -m unittest discover -s scripts/drawing-ocr"""
import unittest

import numpy as np

from schedule_core import read_document, header_kind, row_rules
from schedule_sources import _segments, rotated

H = 5.0  # text height


def w(t, x, y, vertical=False):
    if vertical:
        return dict(t=t, x0=x, y0=y, x1=x + H, y1=y + 0.6 * H * len(t), vertical=True)
    return dict(t=t, x0=x, y0=y, x1=x + 0.6 * H * len(t), y1=y + H, vertical=False)


def door_schedule(rows, x0=100, x1=500, top=100, pitch=60, title="DOOR SCHEDULE", extra_words=(), extra_h=(), rules=True):
    """A graphical schedule: tags at x0+10, one ruled row per tag, sizes as
    (horizontal width words, vertical height words)."""
    words = [w(title, x0, top - 20)]
    hs = [(top, x0, x1)] if rules else [(top, x0, x1)]
    for i, (tag, widths, heights) in enumerate(rows):
        y = top + i * pitch
        words.append(w(tag, x0 + 10, y + 5))
        words.append(w("CASEMENT", x0 + 40, y + 5))
        for k, v in enumerate(widths):
            words.append(w(str(v), x0 + 150 + 40 * k, y + 40))
        for k, v in enumerate(heights):
            words.append(w(str(v), x0 + 300 + 20 * k, y + 15, vertical=True))
        if rules or i == len(rows) - 1:
            hs.append((y + pitch, x0, x1))
    bottom = top + len(rows) * pitch
    vs = [(x0, top, bottom), (x0 + 35, top, bottom), (x1, top, bottom)]
    return dict(page=1, words=words + list(extra_words), hsegs=hs + list(extra_h), vsegs=vs, size=dict(width=800, height=600), source="test")


def by_key(items):
    return {i["key"]: i for i in items}


class GraphicalSchedule(unittest.TestCase):
    def test_one_width_and_one_height_is_measured_with_its_calculation(self):
        items, _ = read_document([door_schedule([("D1", [900], [2100]), ("D2", [800], [2100])])])
        d1 = by_key(items)["SCHED:D1"]
        self.assertEqual((d1["status"], d1["quantity"], d1["unit"], d1["dimension"]), ("MEASURED", 1.89, "m2", "900 x 2100 mm"))
        self.assertEqual(d1["calculation_data"]["formula"], "LENGTH_TIMES_WIDTH")
        self.assertEqual(d1["source"]["page"], 1)
        self.assertTrue(any(e["claim"] == "dimension" and e["label"] == "width 900" for e in d1["source"]["evidence"]))

    def test_leaf_and_frame_widths_conflict_is_held_with_candidates(self):
        items, _ = read_document([door_schedule([("D1", [700, 900], [2100]), ("D2", [800], [2100])])])
        d1 = by_key(items)["SCHED:D1"]
        self.assertEqual((d1["status"], d1["quantity"]), ("PENDING", None))
        self.assertEqual(sorted(c["value"] for c in d1["candidates"]), [1.47, 1.89])
        self.assertIn("2 widths printed (700, 900)", d1["notes"])

    def test_row_with_no_size_is_flagged_not_dropped(self):
        items, _ = read_document([door_schedule([("W1", [600], [1200]), ("W2", [], [])])])
        w2 = by_key(items)["SCHED:W2"]
        self.assertEqual(w2["status"], "PENDING")
        self.assertIn("No size printed", w2["notes"])

    def test_title_block_year_beside_the_schedule_is_not_a_width(self):
        # the title block sits right of the table's own rules; its year is on a row's baseline
        tb = [w("2019", 560, 145), w("PROJECT", 560, 100)]
        page = door_schedule([("D1", [900], [2100]), ("D2", [800], [2100])], extra_words=tb)
        page["vsegs"] += [(550, 50, 400), (750, 50, 400)]
        page["hsegs"] += [(50, 550, 750), (400, 550, 750)]
        d1 = by_key(read_document([page])[0])["SCHED:D1"]
        self.assertEqual((d1["status"], d1["quantity"]), ("MEASURED", 1.89))

    def test_dimension_lines_inside_a_row_are_not_row_rules(self):
        # a short dimension line mid-row, not starting at the left border
        dim = [(130, 250, 360), (135, 250, 380)]
        page = door_schedule([("D1", [900], [2100]), ("D2", [800], [2100])], extra_h=dim)
        items, obs = read_document([page])
        self.assertEqual(by_key(items)["SCHED:D1"]["quantity"], 1.89)
        self.assertEqual(obs["tables"][0]["rows"], 2)

    def test_segmented_row_rule_and_merged_first_column(self):
        # rule between rows drawn as touching pieces, starting at the column line
        # right of a merged first cell instead of at the left border
        page = door_schedule([("D1", [900], [2100]), ("D2", [800], [2100])], rules=False)
        page["hsegs"] += [(160, 135, 260), (160, 260, 380), (160, 380, 500)]
        x0, x1 = 100, 500
        self.assertEqual([round(y) for y in row_rules(page["hsegs"], x0, x1, [100, 135, 500], H)], [100, 160, 220])
        items, _ = read_document([page])
        self.assertEqual((by_key(items)["SCHED:D2"]["status"], by_key(items)["SCHED:D2"]["quantity"]), ("MEASURED", 1.68))

    def test_rows_without_drawn_rules_split_at_tag_spacing_and_say_so(self):
        page = door_schedule([("W1", [600], [1200]), ("W2", [700], [1500]), ("W3", [800], [900])], rules=False)
        items, obs = read_document([page])
        k = by_key(items)
        self.assertEqual([k[t]["quantity"] for t in ("SCHED:W1", "SCHED:W2", "SCHED:W3")], [0.72, 1.05, 0.72])
        self.assertIn("tag spacing", k["SCHED:W2"]["source"]["evidence"][0]["label"])

    def test_the_schedule_header_row_is_not_read_again_as_a_columnar_table(self):
        hdr = [w("NO.", 110, 85), w("NAME", 150, 85), w("PLAN VIEW", 250, 85), w("ELEVATION VIEW", 380, 85)]
        page = door_schedule([("D1", [900], [2100]), ("D2", [850], [2100])], extra_words=hdr)
        items, obs = read_document([page])
        self.assertEqual(sorted(i["key"] for i in items), ["SCHED:D1", "SCHED:D2"])
        self.assertEqual([t["kind"] for t in obs["tables"]], ["graphical"])

    def test_tags_on_an_untitled_elevation_are_not_a_schedule(self):
        page = door_schedule([("W1", [600], [1200]), ("W2", [700], [1500])], title="NORTH ELEVATION")
        items, obs = read_document([page])
        self.assertEqual((items, obs["tables"]), ([], []))

    def test_tag_on_the_drawing_with_no_schedule_row_is_reported(self):
        sched = door_schedule([("W1", [600], [1200]), ("W2", [700], [1500])])
        plan = dict(page=2, words=[w("W2", 300, 300), w("W3", 400, 300), w("W3", 420, 500)], hsegs=[], vsegs=[], size=None, source="test")
        items, obs = read_document([sched, plan])
        w3 = by_key(items)["SCHED:W3"]
        self.assertEqual((w3["status"], w3["quantity"]), ("PENDING", None))
        self.assertIn("no row in any schedule", w3["notes"])
        self.assertEqual(len(w3["source"]["evidence"]), 2)
        self.assertEqual(obs["unscheduled"], [dict(tag="W3", pages=[2])])

    def test_the_same_tag_with_two_values_becomes_one_pending_item(self):
        a = door_schedule([("D1", [900], [2100]), ("D2", [800], [2100])])
        b = dict(door_schedule([("D1", [1000], [2100]), ("D2", [800], [2100])]), page=2)
        k = by_key(read_document([a, b])[0])
        self.assertEqual((k["SCHED:D1"]["status"], sorted(c["value"] for c in k["SCHED:D1"]["candidates"])), ("PENDING", [1.89, 2.1]))
        self.assertEqual((k["SCHED:D2"]["status"], len(k["SCHED:D2"]["source"]["evidence"]) > 2), ("MEASURED", True))


def columnar(header, rows, x0=50, pitch=10, col=60):
    words = []
    for c, label in enumerate(header):
        words.append(w(label, x0 + c * col, 100))
    for r, cells in enumerate(rows):
        for c, v in enumerate(cells):
            if v != "":
                words.append(w(v, x0 + c * col, 100 + (r + 1) * pitch))
    return dict(page=1, words=words, hsegs=[], vsegs=[], size=None, source="test")


class ColumnarSchedule(unittest.TestCase):
    def test_printed_total_that_disagrees_with_its_rows_is_flagged(self):
        page = columnar(["CODE", "SPACE", "SFT"], [["R1", "Room A", "600"], ["R2", "Room B", "402"], ["", "TOTAL", "1000"]])
        items, obs = read_document([page])
        k = by_key(items)
        self.assertEqual((k["SCHED:R1 — Room A:SFT"]["quantity"], k["SCHED:R1 — Room A:SFT"]["unit"]), (600.0, "sqft"))
        check = next(i for i in items if i["key"].startswith("CHECK:"))
        self.assertEqual((check["status"], [c["value"] for c in check["candidates"]]), ("PENDING", [1000.0, 1002.0]))
        self.assertEqual(obs["tables"][0]["total_checks"][0]["row_sum"], 1002.0)

    def test_printed_total_that_agrees_raises_nothing(self):
        page = columnar(["CODE", "SPACE", "SFT"], [["R1", "Room A", "600"], ["R2", "Room B", "400"], ["", "TOTAL", "1000"]])
        items, obs = read_document([page])
        self.assertFalse([i for i in items if i["key"].startswith("CHECK:")])
        self.assertEqual(obs["tables"][0]["total_checks"][0]["row_sum"], 1000.0)

    def test_decimal_totals_are_checked_to_their_printed_precision(self):
        page = columnar(["CODE", "ROOM", "AREA (SQM)"], [["B1", "Bed", "12.40"], ["B2", "Bath", "4.65"], ["", "TOTAL", "17.10"]])
        check = [i for i in read_document([page])[0] if i["key"].startswith("CHECK:")]
        self.assertEqual([c["value"] for c in check[0]["candidates"]], [17.1, 17.05])

    def test_rates_and_money_columns_are_never_quantities(self):
        page = columnar(["CODE", "SPACE", "SFT", "Rs/SFT", "AMOUNT"], [["R1", "Room A", "600", "150", "90,000"]])
        items, obs = read_document([page])
        self.assertEqual([i["key"] for i in items], ["SCHED:R1 — Room A:SFT"])
        self.assertEqual([e["column"] for e in obs["excluded_columns"]], ["Rs/SFT", "AMOUNT"])
        for label, kind in [("Rs/SFT P", "money"), ("RATE", "money"), ("VALUE Rs", "money"), ("PREMIUM Rs", "money"), ("SFT", "area"), ("QTY", "count")]:
            self.assertEqual(header_kind(label)[0], kind, label)

    def test_area_with_no_stated_unit_stays_pending(self):
        items, _ = read_document([columnar(["CODE", "ROOM", "AREA"], [["B1", "Bed", "12.4"], ["B2", "Bath", "4.6"]])])
        self.assertTrue(all(i["status"] == "PENDING" and "no unit" in i["notes"] for i in items))

    def test_count_matrix_blank_cells_count_as_none_only_when_the_total_agrees(self):
        page = columnar(["CODE", "SPACE", "DOWNLIGHT", "FAN"], [["R1", "Room A", "6", "2"], ["R2", "Room B", "4", ""], ["", "TOTAL", "10", "2"]])
        items, obs = read_document([page])
        self.assertEqual(sorted((i["key"], i["quantity"]) for i in items),
                         [("SCHED:R1 — Room A:DOWNLIGHT", 6), ("SCHED:R1 — Room A:FAN", 2), ("SCHED:R2 — Room B:DOWNLIGHT", 4)])
        fan = next(c for c in obs["tables"][0]["total_checks"] if c["column"] == "FAN")
        self.assertEqual((fan["row_sum"], fan["blank_as_zero"]), (2, 1))

    def test_unreadable_quantity_cell_is_flagged_not_dropped(self):
        items, _ = read_document([columnar(["TAG", "DESCRIPTION", "QTY"], [["F1", "Fan", "2"], ["F2", "Light", "?"]])])
        f2 = by_key(items)["SCHED:F2 — Light:QTY"]
        self.assertEqual((f2["status"], f2["quantity"]), ("PENDING", None))

    def test_a_row_whose_code_was_not_read_is_not_merged_into_the_row_above(self):
        # OCR lost the second row's code: its count must not be credited to row 1
        page = columnar(["CODE", "SPACE", "DOWNLIGHT"], [["R1", "Room A", "6"], ["", "", "4"], ["R2", "Room B", "2"]])
        k = by_key(read_document([page])[0])
        self.assertEqual(k["SCHED:R1 — Room A:DOWNLIGHT"]["quantity"], 6)
        orphan = next(i for i in k.values() if i["item"].startswith("Unidentified row 2"))
        self.assertEqual((orphan["status"], orphan["quantity"]), ("PENDING", None))

    def test_a_wrapped_name_continues_its_row(self):
        page = columnar(["CODE", "SPACE", "SFT"], [["R7", "Rear garden", "73"], ["", "store", ""], ["R8", "Shed", "12"]])
        k = by_key(read_document([page])[0])
        self.assertEqual(k["SCHED:R7 — Rear garden store:SFT"]["quantity"], 73.0)

    def test_legend_with_a_symbol_column_keeps_each_line_its_own_row(self):
        # the SYMBOL column holds graphics, so every row's first column is empty
        page = columnar(["SYMBOL", "DESCRIPTION", "QUANTITY"], [["", "RECESSED LIGHT", "7"], ["", "SPOTLIGHT", ""], ["", "DOUBLE SOCKET", "4"]])
        k = by_key(read_document([page])[0])
        self.assertEqual(k["SCHED:RECESSED LIGHT:QUANTITY"]["quantity"], 7)
        self.assertEqual(k["SCHED:SPOTLIGHT:QUANTITY"]["status"], "PENDING")
        self.assertEqual(k["SCHED:DOUBLE SOCKET:QUANTITY"]["quantity"], 4)

    def test_ruled_rows_keep_a_wrapped_description_with_its_offset_quantity(self):
        # each row is a ruled band; the description wraps onto two lines and the
        # quantity sits between them, on neither baseline
        words = [w("SYMBOL", 50, 100), w("DESCRIPTION", 110, 100), w("QUANTITY", 200, 100),
                 w("RECESSED", 110, 112), w("CEILING LIGHT", 110, 120), w("7", 200, 116),
                 w("SPOTLIGHT", 110, 132), w("4", 200, 132)]
        hs = [(108, 45, 260), (128, 45, 260), (140, 45, 260)]
        vs = [(45, 95, 140), (105, 95, 140), (195, 95, 140), (260, 95, 140)]
        k = by_key(read_document([dict(page=1, words=words, hsegs=hs, vsegs=vs, size=None, source="test")])[0])
        self.assertEqual(k["SCHED:RECESSED CEILING LIGHT:QUANTITY"]["quantity"], 7)
        self.assertEqual(k["SCHED:SPOTLIGHT:QUANTITY"]["quantity"], 4)

    def test_a_band_with_a_missing_row_rule_is_split_at_its_value_lines(self):
        words = [w("CODE", 50, 100), w("SPACE", 110, 100), w("SFT", 200, 100),
                 w("R1", 50, 112), w("Store", 110, 112), w("21", 200, 112),
                 w("R2", 50, 122), w("Hall", 110, 122), w("47", 200, 122)]
        hs = [(108, 45, 260), (130, 45, 260)]  # the rule between R1 and R2 is missing
        vs = [(45, 95, 130), (105, 95, 130), (195, 95, 130), (260, 95, 130)]
        k = by_key(read_document([dict(page=1, words=words, hsegs=hs, vsegs=vs, size=None, source="test")])[0])
        self.assertEqual((k["SCHED:R1 — Store:SFT"]["quantity"], k["SCHED:R2 — Hall:SFT"]["quantity"]), (21.0, 47.0))

    def test_sizes_in_mm_are_not_a_count_matrix(self):
        items, _ = read_document([columnar(["CODE", "NAME", "WIDTH MM", "LEAF"], [["D1", "Door", "950", "850"], ["D2", "Door", "750", "650"]])])
        self.assertEqual(items, [])

    def test_a_code_missing_from_a_columnar_schedule_is_flagged_without_an_opening_unit(self):
        sched = columnar(["CODE", "SPACE", "SFT"], [["R1", "Room A", "600"], ["R2", "Room B", "400"]])
        plan = dict(page=2, words=[w("R3", 300, 300)], hsegs=[], vsegs=[], size=None, source="test")
        r3 = by_key(read_document([sched, plan])[0])["SCHED:R3"]
        self.assertEqual((r3["item"], r3["status"], r3["unit"]), ("Schedule entry R3", "PENDING", None))

    def test_no_column_holding_tags_is_a_mark_column_not_a_count(self):
        items, _ = read_document([columnar(["NO.", "NAME", "QTY"], [["W1", "CASEMENT", "2"], ["W2", "FIXED", "1"]])])
        self.assertEqual(sorted((i["key"], i["quantity"]) for i in items), [("SCHED:W1 — CASEMENT:QTY", 2), ("SCHED:W2 — FIXED:QTY", 1)])


class RotatedText(unittest.TestCase):
    def test_a_rotated_three_digit_height_is_vertical_even_when_nearly_square(self):
        self.assertTrue(rotated("500", 10.0, 20.0, 14.0, 25.9))     # 4.0 wide, 5.9 tall
        self.assertFalse(rotated("850", 10.0, 20.0, 15.9, 24.0))    # 5.9 wide, 4.0 tall
        self.assertFalse(rotated("9", 0, 0, 3, 5))                    # one digit: undecidable


class RulingLines(unittest.TestCase):
    def test_a_rule_drawn_two_pixels_thick_is_one_segment(self):
        m = np.zeros((50, 200), bool)
        m[20:22, 10:190] = True
        self.assertEqual(_segments(m, 1.0), [(20.5, 10.0, 190.0)])


if __name__ == "__main__":
    unittest.main()
