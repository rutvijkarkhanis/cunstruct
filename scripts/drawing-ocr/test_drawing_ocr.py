"""Unit tests for the extractor's pure parsing rules (no OCR, no files).
Run: python3 -m unittest discover -s scripts/drawing-ocr"""
import unittest
from drawing_ocr import tag_of, split_letter_tag, header_columns, parse_count, parse_total_row, agreed_area, canonical


class Tags(unittest.TestCase):
    def test_tags_and_ocr_digit_confusions(self):
        self.assertEqual(tag_of("D1"), ("D", "1"))
        self.assertEqual(tag_of("DU—3"), ("DU", "3"))
        self.assertEqual(tag_of("RAG—1/3"), ("RAG", "1/3"))
        self.assertEqual(tag_of("WO"), None)          # letters only: not a tag on its own
        self.assertIsNone(tag_of("NO"))
        self.assertEqual(tag_of("D-1O"), ("D", "10"))
        self.assertIsNone(tag_of("Double"))

    def test_letter_read_as_digit_only_with_the_tables_own_prefix(self):
        self.assertEqual(split_letter_tag("WS", {"W"}), ("W", "5"))
        self.assertIsNone(split_letter_tag("WS", {"D"}))


class Counts(unittest.TestCase):
    def test_header(self):
        self.assertEqual(header_columns("TAG Wx H (mm) QTY DESCRIPTION"), ["TAG", "QTY", "DESCRIPTION"])
        self.assertIsNone(header_columns("DOOR SCHEDULE"))

    def test_qty_before_description(self):
        self.assertEqual(parse_count(" 1200 x 2400 1 Double leaf, solid timber", False), 1)
        self.assertEqual(parse_count(" 1800 x 1500 900 8 Alu. thermal—break, sliding", False), 8)

    def test_qty_after_description(self):
        self.assertEqual(parse_count(" Square ceiling diffuser 600x600, 4—way, NC <= #250 9", True), 9)
        self.assertEqual(parse_count(" Return grille 600x150, linear - 1 _", True), 1)
        self.assertIsNone(parse_count(" Return grille 600x150, linear", True))  # no count printed

    def test_total_row_on_one_line_with_label_repair_and_sum_check(self):
        t = parse_total_row("TOTAL T10 / 112 / 116 (kg) 2,267 / 4,120 / 2,575 SUM kg 8,962")
        self.assertEqual(t["labels"], ["T10", "T12", "T16"])
        self.assertEqual(t["values"], [2267.0, 4120.0, 2575.0])
        self.assertEqual((t["total"], t["unit"], t["consistent"]), (8962.0, "kg", True))
        self.assertFalse(parse_total_row("TOTAL A1 / A2 1 / 2 SUM 9")["consistent"])


class Areas(unittest.TestCase):
    def test_area_only_when_printed_area_and_dims_agree(self):
        self.assertEqual(agreed_area({"18.40", "58.13"}, {(4000, 4600)}), (18.40, (4000, 4600)))
        self.assertEqual(agreed_area({"58.13"}, {(8200, 4650)}), None)   # misread area stays unresolved
        self.assertEqual(agreed_area(set(), {(4000, 4600)}), None)        # dims alone are not an area

    def test_names_map_to_a_printed_schedule_name_only_when_close(self):
        self.assertEqual(canonical("GUEST BEDR00M", ["GUEST BEDROOM", "GUEST WC"]), "GUEST BEDROOM")
        self.assertEqual(canonical("PATIO", ["GUEST BEDROOM"]), "PATIO")


if __name__ == "__main__":
    unittest.main()
