"""Regression tests for quantity_core.py on synthetic schedules (no files, no OCR).
They prove the calculation rules — correct numbers, and correct refusals —
not accuracy on real drawings. Run: python3 -m unittest discover -s scripts/drawing-ocr"""
import json
import random
import unittest
from decimal import Decimal
from pathlib import Path

from quantity_core import (QuantityError, apply_multiplier, convert, dec, floor_finish_takeoff, measure, net_of_deductions,
                           openings_takeoff, output_value, rect_area, skirting_takeoff, sum_measures, to_analysis_item, unit_of)
from schedule_core import read_document

H = 5.0


def table(header, rows, kinds=None, units=None, page=1, checks=(), total=None):
    """A columnar schedule as schedule_core reports it (obs['tables'][i])."""
    from schedule_core import header_kind
    hk = [header_kind(h) for h in header]
    row_cells = []
    for r, cells in enumerate(rows):
        row_cells.append(dict(total=False, cells={i: dict(text=v, bbox=[10 + 40 * i, 20 + 10 * r, 40 + 40 * i, 25 + 10 * r])
                                                 for i, v in enumerate(cells) if v != ""}))
    if total is not None:
        row_cells.append(dict(total=True, cells={1: dict(text="TOTAL", bbox=[50, 0, 80, 5]), 2: dict(text=total, bbox=[90, 0, 100, 5])}))
    return dict(page=page, kind="columnar", header=header, kinds=kinds or [k for k, _ in hk], units=units or [u for _, u in hk],
                bbox=[0, 0, 500, 300], rows=len(row_cells), total_checks=list(checks), row_cells=row_cells)


FINISH = ["CODE", "SPACE", "SFT", "FLOOR", "FINISH"]


def records(*tables):
    return {r["key"]: r for r in floor_finish_takeoff(list(tables))[0]}


class Units(unittest.TestCase):
    def test_exact_conversions_and_spellings(self):
        self.assertEqual(convert("1", "sqft", "sqm"), Decimal("0.09290304"))
        self.assertEqual(convert("3048", "mm", "ft"), Decimal("10"))
        self.assertEqual(convert("1", "in", "mm"), Decimal("25.4"))
        self.assertEqual((unit_of("SFT"), unit_of("m2"), unit_of("Nr"), unit_of("furlong")), ("sqft", "sqm", "nos", None))

    def test_incompatible_dimensions_never_mix(self):
        with self.assertRaises(QuantityError):
            convert(1, "m", "sqm")
        with self.assertRaises(QuantityError):
            sum_measures([measure("a", 1, "m"), measure("b", 1, "sqm")], "sqm")

    def test_numbers_are_exact_and_malformed_ones_refused(self):
        self.assertEqual(dec("1,234.50"), Decimal("1234.50"))
        self.assertEqual(dec(0.1) + dec(0.2), Decimal("0.3"))  # floats read through their repr, never binary noise
        for bad in ("abc", "", None, float("nan"), float("inf"), True):
            with self.assertRaises(QuantityError):
                dec(bad)


class Formulas(unittest.TestCase):
    def test_rectangle_area_in_any_supported_units(self):
        a, why = rect_area(measure("length", 4000, "mm"), measure("width", 4600, "mm"))
        self.assertEqual((a, why), (Decimal("18.4"), None))
        a, _ = rect_area(measure("length", 10, "ft"), measure("width", 12, "ft"), "sqft")
        self.assertEqual(a, Decimal("120"))

    def test_zero_negative_and_wrong_dimension_lengths_are_refused(self):
        for l, w in ((0, 4600), (-4000, 4600)):
            a, why = rect_area(measure("length", l, "mm"), measure("width", w, "mm"))
            self.assertIsNone(a)
            self.assertIn("must be positive", why)
        a, why = rect_area(measure("length", 4, "m"), measure("width", 2, "sqm"))
        self.assertIsNone(a)
        self.assertIn("not a length", why)

    def test_output_rounding_happens_only_at_the_boundary(self):
        self.assertEqual(output_value(Decimal("18.4000")), (18.4, False))
        self.assertEqual(output_value(Decimal("1.234565")), (1.2346, True))
        self.assertEqual(output_value(convert(Decimal("100"), "sqft", "sqm")), (9.2903, True))


class Deductions(unittest.TestCase):
    gross = dict(value=Decimal("40"), unit="sqm", status="calculated")

    def test_net_of_resolved_openings(self):
        r = net_of_deductions(self.gross, [dict(opening_id="D1#1", value=Decimal("1.89"), unit="sqm"),
                                           dict(opening_id="W1#1", value=Decimal("1.2"), unit="sqm")])
        self.assertEqual((r["status"], r["quantity"]), ("calculated", Decimal("36.91")))

    def test_the_same_opening_is_deducted_once(self):
        d = dict(opening_id="D1#1", value=Decimal("1.89"), unit="sqm")
        r = net_of_deductions(self.gross, [d, dict(d)])
        self.assertEqual((r["status"], r["quantity"], r["skipped"][0]["reason"]), ("calculated", Decimal("38.11"), "already deducted"))

    def test_the_same_opening_with_two_sizes_is_a_conflict(self):
        r = net_of_deductions(self.gross, [dict(opening_id="D1#1", value=Decimal("1.89"), unit="sqm"),
                                           dict(opening_id="D1#1", value=Decimal("2.1"), unit="sqm")])
        self.assertEqual((r["status"], r["quantity"]), ("conflicting", None))

    def test_an_unresolved_opening_count_leaves_the_net_quantity_unresolved(self):
        # e.g. a door count still PENDING upstream must not become a confirmed deduction
        r = net_of_deductions(self.gross, [dict(opening_id="D1", value=None, unit="sqm", status="pending_review",
                                                reason="door count pending: plan views disagree")])
        self.assertEqual((r["status"], r["quantity"]), ("pending_review", None))
        self.assertIn("plan views disagree", r["reasons"][0])

    def test_deductions_larger_than_the_gross_or_in_the_wrong_unit_are_refused(self):
        self.assertEqual(net_of_deductions(self.gross, [dict(opening_id="X", value=Decimal("41"), unit="sqm")])["status"], "conflicting")
        self.assertEqual(net_of_deductions(self.gross, [dict(opening_id="X", value=Decimal("1"), unit="m")])["status"], "insufficient")
        self.assertEqual(net_of_deductions(dict(value=None, unit="sqm", status="insufficient"), [])["status"], "insufficient")


class Multipliers(unittest.TestCase):
    def test_repeated_floors_multiply_only_with_a_supported_count(self):
        self.assertEqual(apply_multiplier(Decimal("12.5"), dict(value=4, status="calculated"))["quantity"], Decimal("50.0"))
        self.assertEqual(apply_multiplier(Decimal("12.5"), dict(value=None, status="insufficient", reason="typical plan states no floors")),
                         dict(status="insufficient", quantity=None, reasons=["typical plan states no floors"]))
        self.assertEqual(apply_multiplier(Decimal("12.5"), dict(value="2.5", status="calculated"))["status"], "insufficient")
        self.assertEqual(apply_multiplier(Decimal("12.5"), None)["quantity"], Decimal("12.5"))


class FloorFinish(unittest.TestCase):
    def test_finish_total_is_the_sum_of_its_rooms(self):
        r = records(table(FINISH, [["R1", "Room A", "120", "FL-1", "Oak"], ["R2", "Room B", "80", "FL-1", "Oak"], ["R3", "Room C", "45", "FL-2", "Tile"]]))
        f1 = r["FLOOR:FL-1"]
        self.assertEqual((f1["status"], f1["quantity"], f1["unit"], f1["formula"]), ("calculated", Decimal("200"), "sqft", "SUM_OF_SEGMENTS"))
        self.assertEqual(f1["boq_item"], "Flooring FL-1 — Oak")
        self.assertEqual(f1["included"], ["R1 — Room A", "R2 — Room B"])
        self.assertEqual([m["kind"] for m in f1["inputs"]], ["observed", "observed"])
        self.assertEqual((r["FLOOR:FL-2"]["quantity"], r["FLOOR:FL-2"]["formula"]), (Decimal("45"), "UNIT_CONVERSION"))

    def test_a_missing_area_makes_the_total_insufficient_never_zero(self):
        r = records(table(FINISH, [["R1", "Room A", "120", "FL-1", ""], ["R2", "Room B", "", "FL-1", ""]]))
        f = r["FLOOR:FL-1"]
        self.assertEqual((f["status"], f["quantity"]), ("insufficient", None))
        self.assertIn("R2 — Room B: nothing printed in column SFT", f["reasons"])
        self.assertEqual(f["unit"], "sqft")  # an unresolved line keeps its schedule's unit

    def test_an_area_column_with_no_unit_is_not_assumed(self):
        f = records(table(["CODE", "SPACE", "AREA", "FLOOR"], [["R1", "Room A", "12", "FL-1"]]))["FLOOR:FL-1"]
        self.assertEqual(f["status"], "insufficient")
        self.assertIn("states no unit", f["reasons"][0])

    def test_zero_or_malformed_printed_areas_are_refused(self):
        r = records(table(FINISH, [["R1", "Room A", "0", "FL-1", ""], ["R2", "Room B", "12a", "FL-2", ""]]))
        self.assertEqual((r["FLOOR:FL-1"]["status"], r["FLOOR:FL-2"]["status"]), ("insufficient", "insufficient"))

    def test_printed_area_and_printed_size_must_agree(self):
        head = ["CODE", "SPACE", "AREA (SQM)", "SIZE (MM)", "FLOOR"]
        agree = records(table(head, [["R1", "Room A", "18.40", "4000 x 4600", "FL-1"]]))["FLOOR:FL-1"]
        self.assertEqual((agree["status"], agree["quantity"]), ("calculated", Decimal("18.40")))
        clash = records(table(head, [["R1", "Room A", "19.40", "4000 x 4600", "FL-1"]]))["FLOOR:FL-1"]
        self.assertEqual((clash["status"], clash["quantity"]), ("conflicting", None))
        self.assertIn("printed size 4000 x 4600 gives 18.4", clash["reasons"][0])

    def test_area_from_a_printed_size_when_no_area_is_printed_is_marked_derived(self):
        f = records(table(["CODE", "SPACE", "SIZE (MM)", "FLOOR"], [["R1", "Room A", "4000 x 4600", "FL-1"], ["R2", "Room B", "3000 x 3000", "FL-1"]]))["FLOOR:FL-1"]
        self.assertEqual((f["status"], f["quantity"], f["unit"]), ("calculated", Decimal("27.4"), "sqm"))
        self.assertEqual([m["kind"] for m in f["inputs"]], ["derived", "derived"])
        nounit = records(table(["CODE", "SPACE", "SIZE", "FLOOR"], [["R1", "Room A", "4000 x 4600", "FL-1"]]))["FLOOR:FL-1"]
        self.assertEqual(nounit["status"], "insufficient")

    def test_a_room_with_two_finishes_is_ambiguous_for_both(self):
        r = records(table(FINISH, [["R1", "Room A", "120", "FL-1 / FL-2", ""], ["R2", "Room B", "80", "FL-1", ""]]))
        self.assertEqual((r["FLOOR:FL-1"]["status"], r["FLOOR:FL-2"]["status"]), ("ambiguous", "ambiguous"))

    def test_rooms_with_no_finish_are_reported_not_dropped(self):
        r = records(table(FINISH, [["R1", "Room A", "120", "FL-1", ""], ["R2", "Room B", "80", "", ""]]))
        self.assertEqual(r["FLOOR:FL-1"]["quantity"], Decimal("120"))
        none = r["FLOOR:(no finish)"]
        self.assertEqual((none["status"], none["excluded"][0]["room"]), ("insufficient", "R2 — Room B"))

    def test_a_room_scheduled_twice_counts_once_or_conflicts(self):
        same = records(table(FINISH, [["R1", "Room A", "120", "FL-1", ""]]), table(FINISH, [["R1", "Room A", "120", "FL-1", ""]], page=2))
        self.assertEqual(same["FLOOR:FL-1"]["quantity"], Decimal("120"))
        diff = records(table(FINISH, [["R1", "Room A", "120", "FL-1", ""]]), table(FINISH, [["R1", "Room A", "125", "FL-1", ""]], page=2))
        self.assertEqual((diff["FLOOR:FL-1"]["status"], diff["FLOOR:FL-1"]["quantity"]), ("conflicting", None))

    def test_a_schedule_whose_total_disagrees_holds_its_totals_with_the_sum_as_a_candidate(self):
        check = dict(column="SFT", printed=1000.0, row_sum=1002.0, rows=2, blank_as_zero=0)
        f = records(table(FINISH, [["R1", "Room A", "600", "FL-1", ""], ["R2", "Room B", "402", "FL-1", ""]], checks=[check], total="1000"))["FLOOR:FL-1"]
        self.assertEqual((f["status"], f["quantity"]), ("pending_review", None))
        self.assertEqual([(c["value"], c["basis"]) for c in f["candidates"]], [(Decimal("1002"), "sum of the printed room areas")])
        self.assertEqual(len(f["reasons"]), 1)

    def test_mixed_units_are_converted_exactly_to_sqm(self):
        f = records(table(FINISH, [["R1", "Room A", "100", "FL-1", ""]]),
                    table(["CODE", "SPACE", "AREA (SQM)", "FLOOR"], [["R2", "Room B", "10", "FL-1"]], page=2))["FLOOR:FL-1"]
        self.assertEqual((f["unit"], f["quantity"]), ("sqm", Decimal("19.290304")))

    def test_skirting_without_perimeters_is_insufficient(self):
        t = table(FINISH + ["SKIRTING"], [["R1", "Room A", "120", "FL-1", "", "Oak 3in"], ["R2", "Room B", "80", "FL-1", "", "Oak 3in"]])
        sk = skirting_takeoff([t])
        self.assertEqual([(s["key"], s["status"], s["quantity"]) for s in sk], [("SKIRT:Oak 3in", "insufficient", None)])

    def test_deterministic_across_runs_and_row_order(self):
        rows = [["R1", "Room A", "120", "FL-1", ""], ["R2", "Room B", "80", "FL-2", ""], ["R3", "Room C", "15.5", "FL-1", ""]]
        first = json.dumps([to_analysis_item(r) for r in floor_finish_takeoff([table(FINISH, rows)])[0]], sort_keys=True)
        rnd = random.Random(3)
        for _ in range(5):
            shuffled = floor_finish_takeoff([table(FINISH, rnd.sample(rows, len(rows)))])[0]
            got = {i["key"]: i["quantity"] for i in (to_analysis_item(r) for r in shuffled)}
            self.assertEqual(got, {i["key"]: i["quantity"] for i in json.loads(first)})
        self.assertEqual(json.dumps([to_analysis_item(r) for r in floor_finish_takeoff([table(FINISH, rows)])[0]], sort_keys=True), first)


class AnalysisItems(unittest.TestCase):
    def test_calculated_is_measured_with_recomputable_calculation_data(self):
        f = records(table(FINISH, [["R1", "Room A", "120", "FL-1", "Oak"], ["R2", "Room B", "80.5", "FL-1", "Oak"]]))["FLOOR:FL-1"]
        it = to_analysis_item(f)
        self.assertEqual((it["status"], it["quantity"], it["unit"]), ("MEASURED", 200.5, "sqft"))
        self.assertEqual(it["calculation_data"], dict(formula="SUM_OF_SEGMENTS", inputs=[dict(name="R1 — Room A area", value=120.0, unit="sqft"),
                                                                                     dict(name="R2 — Room B area", value=80.5, unit="sqft")]))
        self.assertEqual(len(it["source"]["evidence"]), 2)
        self.assertIn("[quantity-core 0.1]", it["calculation"])

    def test_unresolved_is_pending_with_reasons_and_no_calculation_data(self):
        f = records(table(FINISH, [["R1", "Room A", "120", "FL-1", ""], ["R2", "Room B", "", "FL-1", ""]]))["FLOOR:FL-1"]
        it = to_analysis_item(f)
        self.assertEqual((it["status"], it["quantity"]), ("PENDING", None))
        self.assertNotIn("calculation_data", it)
        self.assertTrue(it["notes"].startswith("Insufficient: "))


class ThroughTheScheduleReader(unittest.TestCase):
    def test_a_finish_schedule_read_from_words_reaches_a_quantity(self):
        def w(t, x, y):
            return dict(t=t, x0=x, y0=y, x1=x + 0.6 * H * len(t), y1=y + H, vertical=False)
        words = [w("CODE", 50, 100), w("SPACE", 110, 100), w("SFT", 200, 100), w("FLOOR", 260, 100), w("FINISH", 330, 100),
                 w("R1", 50, 112), w("Hall", 110, 112), w("150", 200, 112), w("FL-1", 260, 112), w("Oak", 330, 112),
                 w("R2", 50, 124), w("Store", 110, 124), w("30", 200, 124), w("FL-1", 260, 124), w("Oak", 330, 124)]
        _, obs = read_document([dict(page=1, words=words, hsegs=[], vsegs=[], size=None, source="test")])
        f = records(*obs["tables"])["FLOOR:FL-1"]
        self.assertEqual((f["status"], f["quantity"], f["unit"]), ("calculated", Decimal("180"), "sqft"))


def size_item(mark, w_mm=None, h_mm=None, name="CASEMENT", candidates=None, unscheduled=False):
    """A schedule reader door/window item (SCHED:<mark>), as schedule_core emits it."""
    ev = [dict(page=9, bbox=[10, 10, 90, 40], label=f"schedule row {mark}", claim="quantity")]
    it = dict(key=f"SCHED:{mark}", item=f"Window {mark} opening area", quantity=None, unit="m2", status="PENDING", specification=f"{name.title()} ({mark})",
              source=dict(page=9, evidence=ev))
    if w_mm is not None:
        it.update(quantity=w_mm * h_mm / 1e6, status="MEASURED", dimension=f"{w_mm} x {h_mm} mm",
                  calculation_data=dict(formula="LENGTH_TIMES_WIDTH", inputs=[dict(name="width", value=w_mm / 1000, unit="m"), dict(name="height", value=h_mm / 1000, unit="m")]))
    elif candidates:
        it.update(candidates=[dict(value=v, unit="m2", basis=b) for v, b in candidates], notes="Not one size: 2 widths printed.")
    elif unscheduled:
        it.update(notes=f"{mark} appears on the drawing but has no row in any schedule found.")
    else:
        it.update(notes="No size printed in this schedule row.")
    return it


def count_item(mark, n=None, floor=None, candidates=None, notes=None, unit="nr"):
    """A counter's count item, shaped like #232's (one per mark) or #231's (one per mark per floor)."""
    it = dict(key=mark, item=f"Door {mark} — count", quantity=n, unit=unit, status="MEASURED" if n is not None else "PENDING",
              source=dict(page=1, evidence=[dict(page=1, bbox=[100, 100, 106, 105], label=f"{mark} tag", claim="location")]))
    if floor:
        it["location"] = floor
    if candidates:
        it["candidates"] = [dict(value=v, unit="nos", basis=b) for v, b in candidates]
    if notes:
        it["notes"] = notes
    return it


def openings(sizes, counts):
    return {r["key"]: r for r in openings_takeoff(sizes, counts)}


class Openings(unittest.TestCase):
    def test_resolved_size_and_count_give_a_joinery_line_and_an_opening_area(self):
        r = openings([size_item("W1", 900, 1200)], [count_item("W1", 3)])
        j, a = r["W1"], r["AREA:W1"]
        self.assertEqual((j["status"], j["quantity"], j["unit"]), ("calculated", Decimal(3), "nos"))
        self.assertEqual(j["boq_item"], "Window W1 — Casement, 900 x 1200 mm")
        self.assertEqual((a["status"], a["quantity"], a["unit"], a["formula"]), ("calculated", Decimal("3.24"), "sqm", "QUANTITY_PER_UNIT_TIMES_UNIT_COUNT"))
        it = to_analysis_item(a)
        self.assertEqual(it["calculation_data"]["inputs"], [dict(name="W1 area of one opening (900 x 1200 mm)", value=1.08, unit="sqm"),
                                                            dict(name="W1 count", value=3.0, unit="count")])
        self.assertNotIn("calculation_data", to_analysis_item(j))  # the count is the counter's result, not recomputed here

    def test_counts_per_floor_add_up_only_when_all_are_resolved(self):
        r = openings([size_item("D1", 900, 2100)], [count_item("D1", 2, "Ground"), count_item("D1", 1, "First")])
        self.assertEqual(r["D1"]["quantity"], Decimal(3))
        r = openings([size_item("D1", 900, 2100)], [count_item("D1", 2, "Ground"), count_item("D1", None, "First", notes="Unresolved: plan views disagree")])
        self.assertEqual((r["D1"]["status"], r["AREA:D1"]["status"]), ("pending_review", "pending_review"))
        self.assertIn("plan views disagree", r["AREA:D1"]["reasons"][0])

    def test_the_same_opening_is_never_counted_twice(self):
        r = openings([size_item("D1", 900, 2100)], [count_item("D1", 2, "Ground"), count_item("D1", 2, "Ground")])
        self.assertEqual((r["D1"]["status"], r["D1"]["quantity"], r["AREA:D1"]["quantity"]), ("conflicting", None, None))

    def test_an_unresolved_count_never_becomes_a_confirmed_area(self):
        r = openings([size_item("W1", 900, 1200)], [count_item("W1", None, candidates=[(1, "resolved tags only"), (2, "including the uncertain tag")])])
        a = r["AREA:W1"]
        self.assertEqual((a["status"], a["quantity"]), ("pending_review", None))
        self.assertEqual([c["value"] for c in a["candidates"]], [Decimal("1.08"), Decimal("2.16")])
        self.assertEqual([c["value"] for c in r["W1"]["candidates"]], [1, 2])

    def test_a_count_check_that_disagrees_is_a_conflict(self):
        check = dict(key="CHECK:count:D1", item="Count check — Door D1: drawings 2, schedule 3", quantity=None, unit="nos", status="PENDING",
                     candidates=[dict(value=2, unit="nos", basis="plan"), dict(value=3, unit="nos", basis="schedule")], notes="Neither value is chosen.")
        r = openings([size_item("D1", 900, 2100)], [count_item("D1", 2), check])
        self.assertEqual((r["D1"]["status"], r["AREA:D1"]["status"]), ("conflicting", "conflicting"))
        self.assertEqual([c["value"] for c in r["AREA:D1"]["candidates"]], [Decimal("3.78"), Decimal("5.67")])

    def test_two_printed_sizes_hold_the_area_and_qualify_the_joinery_line(self):
        r = openings([size_item("D2", candidates=[(1.596, "width 760 x height 2100"), (1.911, "width 910 x height 2100")])], [count_item("D2", 2)])
        j, a = r["D2"], r["AREA:D2"]
        self.assertEqual((j["status"], j["quantity"], [c["value"] for c in j["candidates"]]), ("pending_review", None, [Decimal(2)]))
        self.assertEqual((a["status"], [c["value"] for c in a["candidates"]]), ("conflicting", [Decimal("3.192"), Decimal("3.822")]))

    def test_a_counted_mark_with_no_schedule_row_has_no_area(self):
        r = openings([size_item("W6", unscheduled=True)], [count_item("W6", 1)])
        self.assertEqual((r["W6"]["status"], r["AREA:W6"]["status"], r["AREA:W6"]["quantity"]), ("pending_review", "insufficient", None))
        self.assertIn("no row in any schedule", r["AREA:W6"]["reasons"][0])
        r = openings([], [count_item("W7", 1)])
        self.assertEqual(r["AREA:W7"]["status"], "insufficient")

    def test_a_scheduled_mark_with_no_count_is_insufficient_never_zero(self):
        r = openings([size_item("W2", 600, 900)], [])
        self.assertEqual((r["W2"]["status"], r["W2"]["quantity"], r["AREA:W2"]["quantity"]), ("insufficient", None, None))

    def test_items_that_are_not_counts_are_ignored_as_counts(self):
        r = openings([size_item("W1", 900, 1200)], [count_item("W1", 3), dict(count_item("W1", 9, "Ground"), unit="sqm")])
        self.assertEqual(r["W1"]["quantity"], Decimal(3))

    def test_deterministic_whatever_the_input_order(self):
        sizes = [size_item("W1", 900, 1200), size_item("D1", 900, 2100), size_item("W2", 600, 900)]
        counts = [count_item("W1", 3), count_item("D1", 2, "Ground"), count_item("D1", 1, "First")]
        first = json.dumps([to_analysis_item(r) for r in openings_takeoff(sizes, counts)], sort_keys=True)
        rnd = random.Random(5)
        for _ in range(5):
            got = json.dumps([to_analysis_item(r) for r in openings_takeoff(rnd.sample(sizes, 3), rnd.sample(counts, 3))], sort_keys=True)
            self.assertEqual(got, first)


FIXTURE = Path(__file__).resolve().parents[2] / "src/lib/review/__fixtures__/quantityTakeoffSynthetic.json"
OPENINGS_FIXTURE = Path(__file__).resolve().parents[2] / "src/lib/review/__fixtures__/openingsTakeoffSynthetic.json"


def openings_fixture():
    """The made-up schedule and counts behind src/lib/review/openingsTakeoff.integration.test.ts."""
    sizes = [size_item("D1", 900, 2100, "FLUSH DOOR"), size_item("W1", 1200, 1500), size_item("W2", candidates=[(0.54, "width 600 x height 900"), (0.72, "width 800 x height 900")])]
    counts = [count_item("D1", 2, "Ground"), count_item("D1", 1, "First"), count_item("W1", None, candidates=[(4, "resolved tags only"), (5, "including the uncertain tag")]),
              count_item("W2", 2)]
    return dict(schema_version="cunstruct.analysis.v1", items=[to_analysis_item(r, "synthetic drawing") for r in openings_takeoff(sizes, counts)])


def synthetic_fixture():
    """The made-up schedule behind src/lib/review/quantityTakeoff.integration.test.ts."""
    t = table(FINISH + ["SKIRTING"], [["R1", "Room A", "120", "FL-1", "Oak strip", "Oak 3in"], ["R2", "Room B", "80.5", "FL-1", "Oak strip", "Oak 3in"],
                                      ["R3", "Room C", "45", "FL-2", "Porcelain tile", "Tile 4in"], ["R4", "Room D", "", "FL-3", "Stone", ""],
                                      ["R5", "Room E", "30", "FL-4 / FL-2", "", ""]])
    recs = floor_finish_takeoff([t])[0] + skirting_takeoff([t])
    return dict(schema_version="cunstruct.analysis.v1", items=[to_analysis_item(r, "synthetic schedule") for r in recs])


class ContractFixture(unittest.TestCase):
    def test_the_committed_openings_fixture_matches_the_engine(self):
        # regenerate with: python3 -c "import test_quantity_core as t, json; print(json.dumps(t.openings_fixture(), indent=1, sort_keys=True, ensure_ascii=False))"
        self.assertEqual(json.loads(OPENINGS_FIXTURE.read_text()), json.loads(json.dumps(openings_fixture())))

    def test_the_committed_typescript_fixture_matches_the_engine(self):
        # regenerate with: python3 -c "import test_quantity_core as t, json; print(json.dumps(t.synthetic_fixture(), indent=1, sort_keys=True, ensure_ascii=False))"
        self.assertEqual(json.loads(FIXTURE.read_text()), json.loads(json.dumps(synthetic_fixture())))


if __name__ == "__main__":
    unittest.main()
