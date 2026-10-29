"""Regression tests for instance_core.py on synthetic pages (no files, no OCR).
These are made-up layouts: they test the counting rules, not accuracy on
real drawings. Run: python3 -m unittest discover -s scripts/drawing-ocr"""
import json
import random
import unittest
from pathlib import Path

from instance_core import count_document, view_role, level_of

H = 5.0


def w(t, x, y):
    return dict(t=t, x0=x, y0=y, x1=x + 0.6 * H * len(t), y1=y + H, vertical=False)


def title(text, x, y):
    """A view title: its words on one line, single-spaced."""
    out, cx = [], x
    for part in text.split():
        out.append(w(part, cx, y))
        cx = out[-1]["x1"] + 0.5 * H
    return out


def page(n, words, symbols=(), size=None):
    return dict(page=n, words=list(words), hsegs=[], vsegs=[], size=size or dict(width=1000, height=700), source="test", symbols=list(symbols))


def view(text, tags, x0=0, y0=0):
    """A view 300 wide: tags inside it, its title beneath."""
    return [w(t, x0 + tx, y0 + ty) for t, tx, ty in tags] + title(text, x0 + 20, y0 + 260)


def sched(*marks, qty=None):
    return {m: dict(page=9, bbox=[0, 10 * i, 10, 10 * i + 5], qty=(qty or {}).get(m), kind="graphical") for i, m in enumerate(marks)}


def run(pages, marks=None):
    return count_document(pages, marks or {}, [])


def counts(items):
    return {f"COUNT:{i['key']}": (i["status"], i["quantity"]) for i in items if i["item"].endswith(" — count")}


class Titles(unittest.TestCase):
    def test_view_roles_and_levels(self):
        self.assertEqual(view_role("GROUND FLOOR PLAN"), ("plan", "floor"))
        self.assertEqual(view_role("FURNITURE LAYOUT PLAN"), ("plan", "secondary"))
        self.assertEqual(view_role("REFLECTED CEILING PLAN"), ("plan", "secondary"))
        self.assertEqual(view_role("NORTH ELEVATION"), ("elevation", None))
        self.assertEqual(view_role("SECTION A-A"), ("section", None))
        self.assertIsNone(view_role("ALL DIMENSIONS IN MM UNLESS OTHERWISE NOTED ON THE PLAN DRAWINGS"))
        self.assertEqual(level_of("GROUND FLOOR PLAN"), ("L0", 1))
        self.assertEqual(level_of("FIRST FLOOR PLAN"), ("L1", 1))
        self.assertEqual(level_of("LEVEL 3 PLAN"), ("L3", 1))
        self.assertEqual(level_of("TYPICAL FLOOR PLAN (FLOORS 2-5)"), ("TYPICAL 2-5", 4))
        self.assertEqual(level_of("TYPICAL FLOOR PLAN x3"), ("TYPICAL", 3))
        self.assertEqual(level_of("TYPICAL FLOOR PLAN"), ("TYPICAL", None))


class Counting(unittest.TestCase):
    def test_tags_on_one_floor_plan_are_counted_with_evidence_and_observations(self):
        items, obs, _ = run([page(1, view("FLOOR PLAN", [("D1", 40, 40), ("D1", 140, 90), ("W1", 200, 40)]))], sched("D1", "W1"))
        self.assertEqual(counts(items), {"COUNT:D1": ("MEASURED", 2), "COUNT:W1": ("MEASURED", 1)})
        d1 = next(i for i in items if i["key"] == "D1")
        self.assertEqual((d1["unit"], len(d1["source"]["evidence"]), d1["source"]["page"]), ("nr", 2, 1))
        self.assertEqual(sorted((o["observation_type"], o["mark"]) for o in obs),
                         [("opening", "D1"), ("opening", "D1"), ("opening", "W1"), ("schedule_entry", "D1"), ("schedule_entry", "W1")])

    def test_duplicate_detection_of_one_tag_is_one_instance(self):
        # the same tag read twice at (almost) the same place
        items, obs, rep = run([page(1, view("FLOOR PLAN", [("D1", 40, 40), ("D1", 41, 40.5), ("D1", 140, 90)]))])
        self.assertEqual(counts(items)["COUNT:D1"], ("MEASURED", 2))
        self.assertEqual(rep["marks"]["D1"]["merged_duplicates"], 1)

    def test_repeated_floors_are_counted_per_level(self):
        p1 = page(1, view("GROUND FLOOR PLAN", [("W1", 40, 40), ("W1", 90, 40)]))
        p2 = page(2, view("FIRST FLOOR PLAN", [("W1", 40, 40)]))
        self.assertEqual(counts(run([p1, p2])[0])["COUNT:W1"], ("MEASURED", 3))

    def test_typical_plan_counts_once_per_stated_floor(self):
        p1 = page(1, view("TYPICAL FLOOR PLAN (FLOORS 2-5)", [("W1", 40, 40), ("W1", 90, 40)]))
        items = run([p1])[0]
        w1 = next(i for i in items if i["key"] == "W1")
        self.assertEqual((w1["status"], w1["quantity"]), ("MEASURED", 8))
        self.assertEqual(w1["calculation_data"]["formula"], "COUNT_TIMES_MULTIPLIER")
        self.assertEqual([x["value"] for x in w1["calculation_data"]["inputs"]], [2, 4])

    def test_typical_plan_without_a_floor_count_stays_pending(self):
        items = run([page(1, view("TYPICAL FLOOR PLAN", [("W1", 40, 40)]))])[0]
        w1 = next(i for i in items if i["key"] == "W1")
        self.assertEqual((w1["status"], w1["quantity"]), ("PENDING", None))
        self.assertIn("does not state how many floors", w1["notes"])

    def test_cross_view_duplicates_are_corroboration_not_extra_instances(self):
        words = view("FLOOR PLAN", [("D1", 40, 40)]) + view("FURNITURE PLAN", [("D1", 40, 40)], x0=330) + \
                view("SOUTH ELEVATION", [("D1", 40, 40)], x0=660)
        items, obs, rep = run([page(1, words)])
        self.assertEqual(counts(items)["COUNT:D1"], ("MEASURED", 1))
        self.assertEqual(rep["marks"]["D1"]["corroborating"], 2)
        self.assertEqual(sum(o["observation_type"] == "opening" for o in obs), 1)

    def test_the_same_level_on_two_sheets_counts_once_when_they_agree(self):
        p1 = page(1, view("GROUND FLOOR PLAN", [("D1", 40, 40), ("D1", 90, 40)]))
        p2 = page(2, view("GROUND FLOOR PLAN", [("D1", 40, 40), ("D1", 90, 40)]))
        self.assertEqual(counts(run([p1, p2])[0])["COUNT:D1"], ("MEASURED", 2))

    def test_two_plans_of_one_level_that_disagree_are_a_conflict(self):
        p1 = page(1, view("GROUND FLOOR PLAN", [("D1", 40, 40), ("D1", 90, 40)]))
        p2 = page(2, view("GROUND FLOOR PLAN", [("D1", 40, 40)]))
        d1 = next(i for i in run([p1, p2])[0] if i["key"] == "D1")
        self.assertEqual((d1["status"], d1["quantity"]), ("PENDING", None))
        self.assertIn("plan views disagree", d1["notes"])
        self.assertEqual(sorted(c["value"] for c in d1["candidates"]), [1, 2])

    def test_a_tag_in_the_view_above_its_title_belongs_to_that_view(self):
        # two rows of views: the D1 at y=410 sits above the FIRST FLOOR title
        words = view("GROUND FLOOR PLAN", [("D1", 40, 40)]) + title("FIRST FLOOR PLAN", 20, 560) + [w("D1", 40, 410)]
        self.assertEqual(counts(run([page(1, words)])[0])["COUNT:D1"], ("MEASURED", 2))
        _, obs, _ = run([page(1, words)])
        self.assertEqual(sorted(o["location_text"] for o in obs), ["FIRST FLOOR PLAN (page 1)", "GROUND FLOOR PLAN (page 1)"])

    def test_a_tag_between_two_views_is_ambiguous_and_bounds_the_count(self):
        # one D1 clearly on the ground plan; one on the boundary between it and the view beside it
        words = view("GROUND FLOOR PLAN", [("D1", 40, 40)]) + view("FIRST FLOOR PLAN", [], x0=330)
        mid = ((words[-3]["x0"] + words[-1]["x1"]) / 2 + (words[1]["x0"] + words[3]["x1"]) / 2) / 2
        words.append(w("D1", mid - 3, 100))
        d1 = next(i for i in run([page(1, words)])[0] if i["key"] == "D1")
        self.assertEqual(d1["status"], "PENDING")
        self.assertEqual(sorted(c["value"] for c in d1["candidates"]), [1, 2])
        self.assertIn("view unknown", d1["notes"])

    def test_tags_on_a_page_with_no_view_title_are_not_guessed(self):
        d1 = next(i for i in run([page(1, [w("D1", 40, 40)])])[0] if i["key"] == "D1")
        self.assertEqual((d1["status"], d1["quantity"]), ("PENDING", None))

    def test_overlapping_tags_of_different_marks_are_ambiguous(self):
        items = run([page(1, view("FLOOR PLAN", [("D1", 40, 40), ("D2", 44, 41), ("D2", 140, 90)]))])[0]
        c = counts(items)
        self.assertEqual(c["COUNT:D1"], ("PENDING", None))
        self.assertEqual(c["COUNT:D2"], ("PENDING", None))

    def test_a_detail_reference_is_not_an_instance(self):
        words = view("FLOOR PLAN", [("D1", 40, 40)]) + [w("D1/A501", 140, 90), w("D1", 200, 120), w("/", 207, 120), w("A502", 210, 120)]
        items, _, rep = run([page(1, words)])
        self.assertEqual(counts(items)["COUNT:D1"], ("MEASURED", 1))
        self.assertEqual(rep["marks"]["D1"]["detail_refs"], 2)

    def test_stated_multiplicity_and_typ_without_a_number(self):
        items = run([page(1, view("FLOOR PLAN", [("W2", 40, 40), ("x3", 52, 40), ("W3", 140, 90), ("TYP.", 152, 90)]))])[0]
        c = counts(items)
        self.assertEqual(c["COUNT:W2"], ("MEASURED", 3))
        self.assertEqual(c["COUNT:W3"], ("PENDING", None))

    def test_tags_inside_a_schedule_are_not_instances(self):
        marks = {"D1": dict(page=1, bbox=[600, 600, 612, 605], qty=None, kind="graphical")}
        words = view("FLOOR PLAN", [("D1", 40, 40)]) + [w("D1", 600, 600)]
        self.assertEqual(counts(run([page(1, words)], marks)[0])["COUNT:D1"], ("MEASURED", 1))


class RealDrawingConventions(unittest.TestCase):
    """Rules found on the private development drawings, reproduced on made-up layouts."""

    def test_a_tag_inside_a_phrase_is_a_view_name_or_note_not_an_opening(self):
        words = view("FLOOR PLAN", [("W2", 40, 40)]) + title("W2 - WALL FRAMING", 40, 120) + title("SEE W2 DETAIL", 40, 160)
        items, _, rep = run([page(1, words)])
        self.assertEqual(counts(items)["COUNT:W2"], ("MEASURED", 1))

    def test_a_level_name_is_a_plan_title_only_with_a_scale_beneath_it(self):
        plan = [w("D1", 40, 40)] + title("Ground Floor", 20, 260) + title("1 : 50", 20, 268)
        self.assertEqual(counts(run([page(1, plan)])[0])["COUNT:D1"], ("MEASURED", 1))
        marker = [w("D1", 40, 40)] + title("Ground Floor", 20, 260) + title("528", 40, 268)  # a level marker: name and height
        self.assertEqual(counts(run([page(1, marker)])[0])["COUNT:D1"], ("PENDING", None))

    def test_schedule_column_headers_are_not_view_titles(self):
        marks = {"W1": dict(page=1, bbox=[600, 600, 606, 605], qty=None, kind="graphical")}
        words = [w("W1", 620, 520)] + title("PLAN VIEW", 600, 560)
        items, _, rep = count_document([page(1, words)], marks, [(1, [590, 550, 700, 620])])
        self.assertEqual(counts(items)["COUNT:W1"], ("PENDING", None))  # its only "title" was the schedule's column header
        self.assertEqual(rep["titles"], [])
        self.assertIsNone(view_role("SEE W2 DETAIL"))
        # a header row just above the schedule's first row rule is still the schedule's
        items, _, rep = count_document([page(1, words)], marks, [(1, [590, 575, 700, 620])])
        self.assertEqual(rep["titles"], [])

    def test_plan_callouts_corroborate_and_are_not_counted(self):
        words = view("FLOOR PLAN", [("D1", 40, 40)]) + view("Plan - Callout 1", [("D1", 40, 40)], x0=330)
        items, _, rep = run([page(1, words)])
        self.assertEqual(counts(items)["COUNT:D1"], ("MEASURED", 1))
        self.assertEqual(rep["marks"]["D1"]["corroborating"], 1)


class ScheduleAssociation(unittest.TestCase):
    def test_room_codes_from_an_area_schedule_are_not_opening_types(self):
        marks = {"R1": dict(page=9, bbox=[0, 0, 5, 5], qty=None, kind="columnar"), "D1": dict(page=9, bbox=[0, 10, 5, 15], qty=None, kind="columnar")}
        items = run([page(1, view("FLOOR PLAN", [("D1", 40, 40), ("R1", 90, 40)]))], marks)[0]
        self.assertEqual(sorted(counts(items)), ["COUNT:D1"])

    def test_schedule_entry_never_found_on_a_plan_is_flagged(self):
        items = run([page(1, view("FLOOR PLAN", [("D1", 40, 40)]))], sched("D1", "D2"))[0]
        d2 = next(i for i in items if i["key"] == "D2")
        self.assertEqual((d2["status"], d2["quantity"]), ("PENDING", None))
        self.assertIn("in the schedule but no tag", d2["notes"])

    def test_plan_tag_with_no_schedule_row_is_counted_and_says_so(self):
        d3 = next(i for i in run([page(1, view("FLOOR PLAN", [("D3", 40, 40)]))], sched("D1"))[0] if i["key"] == "D3")
        self.assertEqual((d3["status"], d3["quantity"]), ("MEASURED", 1))
        self.assertIn("No schedule row", d3["notes"])

    def test_schedule_qty_that_agrees_or_disagrees(self):
        p = [page(1, view("FLOOR PLAN", [("D1", 40, 40), ("D1", 90, 40), ("D2", 140, 90)]))]
        items = run(p, sched("D1", "D2", qty={"D1": 2, "D2": 3}))[0]
        c = counts(items)
        self.assertEqual(c["COUNT:D1"], ("MEASURED", 2))
        d2 = next(i for i in items if i["key"] == "D2")
        self.assertEqual((d2["status"], sorted(x["value"] for x in d2["candidates"])), ("PENDING", [1, 3]))


class Symbols(unittest.TestCase):
    def test_a_symbol_next_to_a_tag_is_its_evidence_and_an_untagged_symbol_is_flagged(self):
        syms = [dict(kind="door", bbox=[30, 50, 60, 80]), dict(kind="door", bbox=[230, 180, 260, 210])]
        items, obs, _ = run([page(1, view("FLOOR PLAN", [("D1", 40, 40)]), symbols=syms)])
        d1 = next(i for i in items if i["key"] == "D1")
        self.assertEqual((d1["status"], d1["quantity"], len(d1["source"]["evidence"])), ("MEASURED", 1, 2))
        flags = [i for i in items if i["key"].startswith("FLAG:untagged")]
        self.assertEqual((len(flags), flags[0]["status"], flags[0]["quantity"]), (1, "PENDING", None))

    def test_a_symbol_equally_near_two_marks_is_not_assigned(self):
        syms = [dict(kind="door", bbox=[67, 40, 77, 50])]  # 11 from each tag
        items = run([page(1, view("FLOOR PLAN", [("D1", 50, 40), ("D2", 88, 40)]), symbols=syms)])[0]
        self.assertEqual(len([i for i in items if i["key"].startswith("FLAG:symbol_ambiguous")]), 1)


FIXTURE = Path(__file__).resolve().parents[2] / "src/lib/review/__fixtures__/instanceCounterSynthetic.json"


def synthetic_fixture():
    """The made-up document behind the TypeScript contract test
    (src/lib/review/instanceCounterContract.test.ts)."""
    ground = view("GROUND FLOOR PLAN", [("D1", 40, 40), ("D1", 140, 90), ("W1", 200, 40)]) + view("NORTH ELEVATION", [("W1", 40, 40)], x0=330)
    first = view("FIRST FLOOR PLAN", [("W1", 40, 40)])
    pages = [page(1, ground, symbols=[dict(kind="door", bbox=[230, 180, 260, 210])]), page(2, first)]
    items, observations, _ = run(pages, sched("D1", "W1", "W2"))
    return dict(analysis=dict(schema_version="cunstruct.analysis.v1", items=items),
                observations=dict(schema_version="cunstruct.observation.v1", observations=observations))


class ContractFixture(unittest.TestCase):
    def test_the_committed_typescript_fixture_matches_the_counter(self):
        # regenerate with: python3 -c "import test_instance_core as t, json; print(json.dumps(t.synthetic_fixture(), indent=1, sort_keys=True))"
        self.assertEqual(json.loads(FIXTURE.read_text()), json.loads(json.dumps(synthetic_fixture())))


class Determinism(unittest.TestCase):
    def test_word_and_page_order_do_not_change_the_output(self):
        pages = [page(1, view("GROUND FLOOR PLAN", [("D1", 40, 40), ("W1", 90, 40), ("D1", 41, 40.5)]) + view("NORTH ELEVATION", [("W1", 40, 40)], x0=330)),
                 page(2, view("FIRST FLOOR PLAN", [("D2", 40, 40), ("W1", 140, 90)]), symbols=[dict(kind="door", bbox=[230, 180, 260, 210])])]
        marks = sched("D1", "D2", "W1", "W9")
        first = json.dumps(run(pages, marks), sort_keys=True, default=str)
        rnd = random.Random(7)
        for _ in range(5):
            shuffled = [dict(p, words=rnd.sample(p["words"], len(p["words"]))) for p in rnd.sample(pages, len(pages))]
            self.assertEqual(json.dumps(run(shuffled, marks), sort_keys=True, default=str), first)


if __name__ == "__main__":
    unittest.main()
