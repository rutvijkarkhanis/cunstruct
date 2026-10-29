"""Regression tests for sheets that carry a floor plan and its door/window
schedule together, run through the real pipeline (instance_counter.analyse:
schedule_core, then instance_core). SYNTHETIC layouts and values only: they
reproduce failure patterns seen on real development drawings without copying
any of their content, and prove the rules, not accuracy.
Run: python3 -m unittest discover -s scripts/drawing-ocr"""
import json
import unittest

from instance_core import level_of, view_role
from instance_counter import analyse

H = 5.0
NOTE = "ALL DIMENSIONS ARE IN MILLIMETERS UNLESS OTHERWISE NOTED"


def w(t, x, y):
    return dict(t=t, x0=x, y0=y, x1=x + 0.6 * H * len(t), y1=y + H, vertical=False)


def line(text, x, y):
    """Words of one line, single-spaced."""
    out, cx = [], x
    for part in text.split():
        out.append(w(part, cx, y))
        cx = out[-1]["x1"] + 0.5 * H
    return out


def schedule(rows, x=700, y=60, header=("S.No", "Type", "Size", "Remark"), cols=(0, 40, 90, 200)):
    """A columnar door/window schedule: a header row and one line per row."""
    words = [w(h_, x + c, y) for h_, c in zip(header, cols)]
    for i, row in enumerate(rows):
        for cell, c in zip(row, cols):
            if cell:
                words += line(cell, x + c, y + 12 * (i + 1))
    return words


def plan(title_text, tags, x0=0, y0=0):
    """A plan view: tags inside it and its title beneath."""
    return [w(t, x0 + tx, y0 + ty) for t, tx, ty in tags] + line(title_text, x0 + 20, y0 + 260)


def sheet(n, *parts, note=True):
    words = [x for p in parts for x in p] + (line(NOTE, 700, 560) if note else [])
    return dict(page=n, words=words, hsegs=[], vsegs=[], size=dict(width=1000, height=700), source="synthetic")


def by_key(items):
    return {i["key"]: i for i in items}


STD = [("1", "D1", "850 X 2050", "Flush door"), ("2", "W1", "1100 X 1300", "Window"), ("3", "V1", "450 X 650", "Ventilator")]


class SameSheet(unittest.TestCase):
    def test_schedule_and_plan_on_one_sheet_give_sizes_and_plan_counts(self):
        p = sheet(1, schedule(STD), plan("GROUND FLOOR PLAN", [("D1", 40, 40), ("D1", 140, 90), ("W1", 200, 40)]))
        sched, counts, _, _ = analyse([p])
        s, c = by_key(sched), by_key(counts)
        self.assertEqual((s["SCHED:D1"]["status"], s["SCHED:D1"]["quantity"], s["SCHED:D1"]["dimension"]), ("MEASURED", 1.7425, "850 x 2050 mm"))
        self.assertEqual(s["SCHED:D1"]["calculation_data"]["formula"], "LENGTH_TIMES_WIDTH")
        # the schedule rows (one D1, one W1 each) are not counted; the plan's tags are
        self.assertEqual((c["D1"]["status"], c["D1"]["quantity"]), ("MEASURED", 2))
        self.assertEqual((c["W1"]["status"], c["W1"]["quantity"]), ("MEASURED", 1))

    def test_serial_numbers_are_never_quantities(self):
        p = sheet(1, schedule(STD), plan("GROUND FLOOR PLAN", [("D1", 40, 40)]))
        sched, _, _, _ = analyse([p])
        self.assertFalse([i for i in sched if "S.No" in i["key"] or (i["status"] == "MEASURED" and i["unit"] == "nr")])

    def test_size_is_not_given_a_unit_the_drawing_does_not_state(self):
        p = sheet(1, schedule(STD), plan("GROUND FLOOR PLAN", [("D1", 40, 40)]), note=False)
        d1 = by_key(analyse([p])[0])["SCHED:D1"]
        self.assertEqual((d1["status"], d1["quantity"]), ("PENDING", None))
        self.assertIn("not assumed", d1["notes"])

    def test_evidence_keeps_row_size_cell_and_unit_note(self):
        p = sheet(1, schedule(STD), plan("GROUND FLOOR PLAN", [("D1", 40, 40)]))
        ev = by_key(analyse([p])[0])["SCHED:D1"]["source"]["evidence"]
        self.assertEqual([e["label"] for e in ev], ["schedule row D1", "size 850 x 2050", "sheet note: dimensions in millimetres"])
        self.assertTrue(all(len(e["bbox"]) == 4 and e["page"] == 1 for e in ev))


class ScheduleRowsAreNotInstances(unittest.TestCase):
    def test_a_schedule_row_outside_any_recognised_schedule_is_not_counted_and_is_reported(self):
        # a stray row: row number, mark, size (the schedule header itself was not recognisable)
        stray = line("7 D1 1111 X 2222 2222", 700, 400)
        p = sheet(1, plan("GROUND FLOOR PLAN", [("D1", 40, 40)]), stray)
        c = by_key(analyse([p])[1])["D1"]
        self.assertEqual((c["status"], c["quantity"]), ("MEASURED", 1))
        self.assertIn("reading like schedule rows", c["notes"])


class TagsBesideText(unittest.TestCase):
    def test_a_tag_beside_an_unidentified_fragment_is_held_never_dropped(self):
        p = sheet(1, schedule(STD), plan("GROUND FLOOR PLAN", [("D1", 40, 40), ("D1", 140, 90), ("QZ", 147, 90)]))
        c = by_key(analyse([p])[1])["D1"]
        self.assertEqual((c["status"], c["quantity"]), ("PENDING", None))
        self.assertEqual(sorted(x["value"] for x in c["candidates"]), [1, 2])
        self.assertIn("beside other text ('QZ')", c["notes"])

    def test_a_tag_that_is_part_of_a_title_is_excluded_and_reported(self):
        p = sheet(1, schedule(STD), plan("GROUND FLOOR PLAN", [("D1", 40, 40)]), line("SEE D1 DETAIL", 40, 150))
        c = by_key(analyse([p])[1])["D1"]
        self.assertEqual((c["status"], c["quantity"]), ("MEASURED", 1))
        self.assertIn("part of a title or note", c["notes"])


class MissingAndConflicting(unittest.TestCase):
    def test_a_scheduled_mark_with_no_size_is_held(self):
        rows = STD + [("4", "D2", "", "Flush door")]
        d2 = by_key(analyse([sheet(1, schedule(rows), plan("GROUND FLOOR PLAN", [("D2", 40, 40)]))])[0])["SCHED:D2"]
        self.assertEqual((d2["status"], d2["quantity"]), ("PENDING", None))
        self.assertIn("No size printed", d2["notes"])

    def test_a_mark_listed_twice_with_two_sizes_is_held_in_schedule_and_count(self):
        rows = STD + [("4", "D1", "700 X 2000", "Flush door")]
        sched, counts, _, _ = analyse([sheet(1, schedule(rows), plan("GROUND FLOOR PLAN", [("D1", 40, 40)]))])
        d1 = by_key(sched)["SCHED:D1"]
        self.assertEqual((d1["status"], sorted(c["value"] for c in d1["candidates"])), ("PENDING", [1.4, 1.7425]))
        self.assertEqual(by_key(counts)["D1"]["status"], "PENDING")

    def test_different_sizes_with_equal_area_are_still_a_conflict(self):
        a = sheet(1, schedule(STD), plan("GROUND FLOOR PLAN", [("W1", 40, 40)]))
        b = sheet(2, schedule([("1", "D1", "850 X 2050", ""), ("2", "W1", "1300 X 1100", "")]), plan("TYPE-B GROUND FLOOR PLAN", [("W1", 40, 40)]))
        w1 = by_key(analyse([a, b])[0])["SCHED:W1"]
        self.assertEqual(w1["status"], "PENDING")
        self.assertEqual(sorted(c["basis"] for c in w1["candidates"]), ["page 1, size 1100 x 1300 mm", "page 2, size 1300 x 1100 mm"])

    def test_one_mark_naming_different_openings_in_two_buildings_is_held_with_its_breakdown(self):
        a = sheet(1, schedule(STD), plan("GROUND FLOOR PLAN", [("D1", 40, 40), ("D1", 90, 40)]))
        b = sheet(2, schedule([("1", "D1", "950 X 2000", ""), ("2", "V1", "450 X 650", "")]), plan("TYPE-B GROUND FLOOR PLAN", [("D1", 40, 40)]))
        _, counts, _, report = analyse([a, b])
        d1 = by_key(counts)["D1"]
        self.assertEqual((d1["status"], d1["quantity"]), ("PENDING", None))
        self.assertIn("names different openings on different sheets", d1["notes"])
        self.assertEqual(sorted(sum(v["views"].values()) for v in report["marks"]["D1"]["levels"].values()), [1, 2])

    def test_a_mark_with_one_size_everywhere_is_counted_across_buildings(self):
        a = sheet(1, schedule(STD), plan("GROUND FLOOR PLAN", [("V1", 40, 40)]))
        b = sheet(2, schedule([("1", "D1", "950 X 2000", ""), ("2", "V1", "450 X 650", "")]), plan("TYPE-B GROUND FLOOR PLAN", [("V1", 40, 40), ("V1", 90, 40)]))
        v1 = by_key(analyse([a, b])[1])["V1"]
        self.assertEqual((v1["status"], v1["quantity"]), ("MEASURED", 3))


class Titles(unittest.TestCase):
    def test_project_names_paths_and_structural_plans(self):
        self.assertIsNone(view_role("CONSTRUCTION OF SECTIONS FOR AN OFFICE AND WORKSHOPS"))
        self.assertIsNone(view_role("\\\\SERVER\\PROJECT\\SITE PLAN\\image.png"))
        self.assertEqual(view_role("DRAWING TITLE FIRST FLOOR SLAB & BEAM PLAN"), ("plan", "secondary"))
        self.assertEqual(view_role("GRADE BEAM PLAN"), ("plan", "secondary"))
        self.assertEqual(view_role("SECTION A-A"), ("section", None))

    def test_explicit_storey_ranges_and_building_qualifiers(self):
        self.assertEqual(level_of("FIRST TO THIRD FLOOR PLAN"), ("L1-L3", 3))
        self.assertEqual(level_of("TYPE-B GROUND FLOOR PLAN"), ("TYPE-B L0", 1))

    def test_a_range_plan_and_a_single_storey_plan_of_one_building_are_held(self):
        p1 = sheet(1, schedule(STD), plan("FIRST FLOOR PLAN", [("V1", 40, 40)]))
        p2 = sheet(2, schedule(STD), plan("FIRST TO THIRD FLOOR PLAN", [("V1", 40, 40)]))
        v1 = by_key(analyse([p1, p2])[1])["V1"]
        self.assertEqual(v1["status"], "PENDING")
        self.assertIn("cover the same storey", v1["notes"])

    def test_a_range_plan_alone_counts_once_per_stated_storey(self):
        v1 = by_key(analyse([sheet(1, schedule(STD), plan("FIRST TO THIRD FLOOR PLAN", [("V1", 40, 40), ("V1", 90, 40)]))])[1])["V1"]
        self.assertEqual((v1["status"], v1["quantity"], v1["calculation_data"]["formula"]), ("MEASURED", 6, "COUNT_TIMES_MULTIPLIER"))


class NonOpeningMarks(unittest.TestCase):
    def test_beam_and_slab_marks_are_not_doors_or_windows(self):
        p = sheet(1, schedule(STD), plan("GROUND FLOOR PLAN", [("D1", 40, 40), ("B2", 90, 40), ("S3", 140, 40)]))
        _, counts, _, _ = analyse([p])
        self.assertEqual(sorted(i["key"] for i in counts if i["item"].endswith(" — count")), ["D1", "V1", "W1"])


class Pattern1HeaderSynthetic(unittest.TestCase):
    """SYNTHETIC ONLY: marks listed under a DOOR header with separate WIDTH and
    HEIGHT columns. No real development drawing with this layout has been
    available, so this layout is not validated on real data."""

    def test_marks_under_a_door_header_with_width_and_height_columns(self):
        header = ("S.NO.", "DOOR", "WIDTH", "SILL", "LINTEL", "HEIGHT")
        cols = (0, 40, 90, 140, 190, 240)
        rows = [("1", "D1", "850", "----", "2050", "2050"), ("2", "D2", "700", "----", "2000", "2000")]
        p = sheet(1, schedule(rows, header=header, cols=cols), plan("GROUND FLOOR PLAN", [("D1", 40, 40)]))
        s = by_key(analyse([p])[0])
        self.assertEqual((s["SCHED:D1"]["status"], s["SCHED:D1"]["dimension"]), ("MEASURED", "850 x 2050 mm"))
        self.assertEqual((s["SCHED:D2"]["status"], s["SCHED:D2"]["dimension"]), ("MEASURED", "700 x 2000 mm"))


class QuantityHandOff(unittest.TestCase):
    """What the openings take-off (quantity_core.openings_takeoff, #234) reads:
    a resolved size as 'SCHED:<mark>' MEASURED with LENGTH_TIMES_WIDTH inputs
    in metres, and a count as an item keyed by the mark in a count unit."""

    def test_a_resolved_size_and_count_are_in_the_contract_shape_the_take_off_reads(self):
        sched, counts, _, _ = analyse([sheet(1, schedule(STD), plan("GROUND FLOOR PLAN", [("D1", 40, 40), ("D1", 140, 90)]))])
        d1s, d1c = by_key(sched)["SCHED:D1"], by_key(counts)["D1"]
        self.assertEqual(d1s["calculation_data"]["inputs"], [dict(name="width", value=0.85, unit="m"), dict(name="height", value=2.05, unit="m")])
        self.assertEqual((d1c["key"], d1c["unit"], d1c["status"], d1c["quantity"]), ("D1", "nr", "MEASURED", 2))

    def test_an_unresolved_count_carries_no_quantity_so_it_cannot_be_calculated(self):
        p = sheet(1, schedule(STD), plan("GROUND FLOOR PLAN", [("D1", 40, 40), ("D1", 140, 90), ("QZ", 147, 90)]))
        d1c = by_key(analyse([p])[1])["D1"]
        self.assertEqual((d1c["status"], d1c["quantity"]), ("PENDING", None))
        self.assertNotIn("calculation_data", d1c)

    def test_deterministic(self):
        p = sheet(1, schedule(STD), plan("GROUND FLOOR PLAN", [("D1", 40, 40), ("W1", 200, 40)]))
        self.assertEqual(json.dumps(analyse([p])[:2], sort_keys=True), json.dumps(analyse([p])[:2], sort_keys=True))


if __name__ == "__main__":
    unittest.main()
