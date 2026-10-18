// Matching is tested against the real DSR 2023 civil schedule shipped in the
// seed migration (2,758 items) — not a hand-made catalogue.
import { describe, it, expect } from "vitest";
import { seedCatalogue } from "./seedFixture";
import { buildDsrIndex, matchLine } from "./match";
import { canonicalUnit, compareUnit, embeddedSubItems, matchableDescription, measurementNotes, exclusionClauses, specConflicts, specFeatures } from "./catalogue";

const all = seedCatalogue();
const ix = buildDsrIndex(all, "DSR", "2023");
const codes = (r: ReturnType<typeof matchLine>) => r.candidates.map((c) => c.item.code);

describe("the fixture is the real schedule", () => {
  it("parses every seeded item", () => {
    expect(all).toHaveLength(2758);
    expect(ix.items).toHaveLength(2758);
    expect(all.find((i) => i.code === "5.1.3")).toMatchObject({ unit: "cum", rate: 8583.4, subhead: "RCC" });
  });
});

describe("a code stated on the line", () => {
  it("exact: in the schedule, unit and specification agree → reliable", () => {
    const r = matchLine({ description: "RCC 1:2:4 in footings", unit: "cum", dsr_code: "5.1.3" }, ix);
    expect(r).toMatchObject({ verdict: "reliable", basis: "code", schedule: "DSR 2023" });
    expect(codes(r)).toEqual(["5.1.3"]);
  });
  it("wrong unit: same code, line in sqm → possible, with the conflict stated", () => {
    const r = matchLine({ description: "RCC 1:2:4 in footings", unit: "sqm", dsr_code: "5.1.3" }, ix);
    expect(r.verdict).toBe("possible");
    expect(r.reasons.join(" ")).toContain("Unit conflict: the line is in sqm, the schedule item in cum");
  });
  it("specification mismatch: the line's mix differs from the coded item → possible", () => {
    const r = matchLine({ description: "RCC 1:1.5:3 in slabs", unit: "cum", dsr_code: "5.1.3" }, ix);
    expect(r.verdict).toBe("possible");
    expect(r.candidates[0].specConflicts).toEqual([{ feature: "mix ratio", line: "1:1.5:3", schedule: "1:2:4" }]);
  });
  it("a code that is not in the selected schedule is reported, then the description is matched", () => {
    const r = matchLine({ description: "RCC 1:2:4 in footings", unit: "cum", dsr_code: "99.9" }, ix);
    expect(r.reasons[0]).toBe("The line's code 99.9 is not an item in DSR 2023.");
    expect(r.verdict).not.toBe("reliable");
    expect(codes(r)).toContain("5.1.3");
  });
});

describe("matching by description", () => {
  it("near match: different wording, one clear item, unit agrees → reliable", () => {
    const r = matchLine({ description: "Earth work in excavation in foundation trenches, all kinds of soil", unit: "cum" }, ix);
    expect(r).toMatchObject({ verdict: "reliable", basis: "description", ambiguous: false });
    expect(codes(r)[0]).toBe("2.8.1");
  });
  it("the unit decides between otherwise equal items (anti-termite: sqm vs per-metre items)", () => {
    const r = matchLine({ description: "Anti-termite treatment of soil under existing floors", unit: "sqm" }, ix);
    expect(r.verdict).toBe("reliable");
    expect(r.candidates[0].item).toMatchObject({ code: "2.35.3.1", unit: "sqm" });
  });
  it("a line that does not say which variant of a family it is, is not reliable (bare “Anti-termite treatment”)", () => {
    // DSR 2023's only sqm anti-termite item is POST-constructional treatment
    // of soil under EXISTING floors — the bare line does not say that.
    // (Before: reliable 2.35.3.1.)
    const r = matchLine({ description: "Anti-termite treatment", unit: "sqm" }, ix);
    expect(r.verdict).toBe("possible");
    expect(r.candidates[0].item).toMatchObject({ code: "2.35.3.1", unit: "sqm" });
    expect(r.reasons.join(" ")).toContain("Item 2.35.3.1 is one variant of a family of schedule items (“Treatment of soil under existing floors");
    expect(r.reasons.join(" ")).toContain("the line does not say which variant");
  });
  it("wrong unit: no item measured the way the line is → possible, never reliable", () => {
    const r = matchLine({ description: "Anti-termite treatment", unit: "each" }, ix);
    expect(r.verdict).toBe("possible");
    expect(r.reasons.some((x) => x.startsWith("Unit conflict"))).toBe(true);
  });
  it("a convertible unit (cft vs cum) is reported, not assumed equal", () => {
    const r = matchLine({ description: "Earth work in excavation in foundation trenches, all kinds of soil", unit: "cft" }, ix);
    expect(r.verdict).toBe("possible");
    expect(r.reasons.join(" ")).toContain("A stated conversion is needed — none is assumed.");
  });
  it("specification mismatch: 12 mm plaster against the schedule's 15 mm items", () => {
    const r = matchLine({ description: "12 mm cement plaster 1:6 on rough side of brick wall", unit: "sqm" }, ix);
    expect(r.verdict).toBe("possible");
    expect(r.candidates[0].specConflicts).toEqual([{ feature: "thickness", line: "12 mm", schedule: "15 mm" }]);
  });
  it("ambiguous: several items fit equally — listed, not chosen", () => {
    const r = matchLine({ description: "Centering and shuttering for columns", unit: "sqm" }, ix);
    expect(r).toMatchObject({ verdict: "possible", ambiguous: true });
    expect(codes(r)).toContain("4.3.3");
    expect(r.reasons.join(" ")).toContain("Several items fit about equally well");
  });
  it("tags and sizes the schedule never uses do not hide the item (door D1 900x2100)", () => {
    const r = matchLine({ description: "Door D1 900x2100 flush door", unit: "each" }, ix);
    expect(r.verdict).toBe("possible");
    expect(r.candidates[0].item.code).toMatch(/^9\.20\./);
    expect(r.candidates[0].unit).toBe("mismatch"); // flush door shutters are measured in sqm
  });
  it("absent coverage: work the schedule does not describe → none", () => {
    const r = matchLine({ description: "Solar panel installation", unit: "each" }, ix);
    expect(r.verdict).toBe("none");
    expect(r.reasons[0]).toContain('does not mention "solar"');
    expect(matchLine({ description: "", unit: "sqm" }, ix).verdict).toBe("none");
  });
  it("thin lines from a real project BOQ do not land on hardware or unrelated items (found on production data)", () => {
    // Before: "Window type 1" → a casement window FASTENER (possible), "External Door" → GFRG panels.
    for (const description of ["Window type 1", "External Door"]) {
      const r = matchLine({ description, unit: "nos" }, ix);
      expect(r.verdict).toBe("none");
      expect(r.reasons[0]).toMatch(/^The line does not describe the work enough to match/);
    }
  });
  it("work the schedule has no word for is said to be possibly outside it", () => {
    const r = matchLine({ description: "Fire Sprinkler Heads", unit: "nos" }, ix);
    expect(r.verdict).toBe("none");
    expect(r.reasons.find((x) => x.startsWith("DSR 2023 never uses:"))).toMatch(/never uses: .*\bsprinkler\b.* — this work may not be in this schedule\.$/);
  });
  it("only the selected schedule version is searched", () => {
    const other = buildDsrIndex(all, "DSR", "2021");
    expect(other.items).toHaveLength(0);
    expect(matchLine({ description: "Anti-termite treatment", unit: "sqm" }, other)).toMatchObject({ verdict: "none", schedule: "DSR 2021" });
    const mixed = buildDsrIndex([...all, { ...all[0], rate_year: "2021", code: "X.1" }], "DSR", "2023");
    expect(mixed.items.some((i) => i.code === "X.1")).toBe(false);
  });
  it("text spilled into an item from the PDF does not make it match everything", () => {
    const r = matchLine({ description: "RCC 1:1.5:3 in slabs", unit: "cum" }, ix);
    expect(codes(r)).not.toContain("26.96.2");
    expect(codes(r)[0]).toBe("5.1.2");
  });
});

describe("catalogue helpers", () => {
  it("units: aliases only, conversions never assumed, pair kept apart from each", () => {
    expect(canonicalUnit("Nos")).toEqual({ unit: "each", dimension: "COUNT" });
    expect(canonicalUnit("pair")).toEqual({ unit: "pair", dimension: "COUNT" });
    expect(compareUnit("m2", "sqm")).toBe("match");
    expect(compareUnit("sqft", "sqm")).toBe("convertible");
    expect(compareUnit("kg", "cum")).toBe("mismatch");
    expect(compareUnit(null, "cum")).toBe("unknown");
  });
  it("specification conflicts need both sides to state the feature", () => {
    expect(specConflicts(specFeatures("RCC M20"), specFeatures("1:1.5:3"))).toEqual([]);
    expect(specConflicts(specFeatures("RCC M20"), specFeatures("M25 grade"))).toEqual([{ feature: "concrete grade", line: "M20", schedule: "M25" }]);
  });
  it("reads exclusions and measurement wording from the schedule's own text", () => {
    const rcc = all.find((i) => i.code === "5.1.3")!;
    expect(exclusionClauses(rcc.description)[0]).toMatch(/^centering, shuttering, finishing and reinforcement/);
    const withNote = all.find((i) => measurementNotes(i.description).length > 0)!;
    expect(withNote).toBeTruthy();
    for (const n of measurementNotes(withNote.description)) expect(withNote.description).toContain(n);
  });
  it("cuts the seed's PDF spill-over (capitalised next heading) for matching only", () => {
    expect(matchableDescription("20 mm cement plaster of mix : — 1:6 (1 cement: 6 coarse sand) CEMENT PLASTER WITH A FLOATING COAT OF NEAT CEMENT"))
      .toBe("20 mm cement plaster of mix : — 1:6 (1 cement: 6 coarse sand)");
    expect(matchableDescription("Providing ISI marked flush door")).toBe("Providing ISI marked flush door");
  });
});

// Residential civil BOQ wording, probed against the real schedule. Each case
// below was a wrong or unexplained verdict before the fix it names.
describe("representative residential BOQ lines (regressions)", () => {
  const m = (description: string, unit: string) => matchLine({ description, unit }, ix);
  const text = (r: ReturnType<typeof matchLine>) => r.reasons.join(" ");

  it("an “Extra for …” item is never the work itself (AAC masonry was reliable on 6.5 “Extra for … above floor V”)", () => {
    const r = m("AAC block masonry 200 mm thick", "cum");
    expect(r.verdict).not.toBe("reliable");
    expect(codes(r)).not.toContain("6.5");
    // A line that IS an extra still reaches it.
    expect(codes(m("Extra for brick work in superstructure above floor V level", "cum"))).toContain("6.5");
  });

  it("text of a later item spilled into 9.147 (uPVC) no longer makes “Aluminium sliding windows” a reliable uPVC match", () => {
    const r = m("Aluminium sliding windows", "sqm");
    expect(r.verdict).not.toBe("reliable");
    expect(codes(r)[0]).not.toBe("9.147");
  });

  it("a row holding several sub-items under one code and rate is never reliable — by description or by code", () => {
    const byText = m("uPVC window", "sqm");
    expect(byText.candidates[0].item.code).toBe("9.147");
    expect(byText.verdict).toBe("possible");
    expect(text(byText)).toContain("9.147 holds several sub-items (9.147.A1, 9.147.A1.1) under one code and one rate");
    const byCode = matchLine({ description: "Steel reinforcement TMT bars above plinth", unit: "kg", dsr_code: "5.22A" }, ix);
    expect(byCode).toMatchObject({ verdict: "possible", basis: "code" });
    expect(text(byCode)).toContain("5.22A holds several sub-items (5.22A.1, 5.22A.2, 5.22A.3, 5.22A.4, …)");
  });

  it("the line must say which variant of a family it is (slab formwork landed on 5.9.16.2 “Edges of slabs”; enamel paint on G.S.-sheet 13.53.1)", () => {
    const slab = m("Centering and shuttering for slab", "sqm");
    expect(slab.verdict).toBe("possible");
    expect(text(slab)).toContain("one variant of a family of schedule items (“Edges of slabs and breaks in floors and walls”)");
    const enamel = m("Enamel paint on steel work", "sqm");
    expect(enamel.verdict).toBe("possible");
    expect(text(enamel)).toContain("the line does not say which variant");
    // Naming the variant (an element of a list, or a stated mix) is enough.
    expect(m("Formwork for beams", "sqm").candidates.map((c) => c.item.code)).toContain("5.9.5");
  });

  it("an item limited to work up to plinth level is reliable only when the line places the work there (TMT bars were reliable on 5.22.6 “… upto plinth level”)", () => {
    // Before: "Steel reinforcement TMT bars Fe 500D" was reliable on 5.22.6, which the
    // schedule limits to work up to plinth level (5.22A prices it above plinth level).
    const bars = m("Steel reinforcement TMT bars Fe 500D", "kg");
    expect(bars.verdict).toBe("possible");
    expect(bars.candidates[0].item.code).toBe("5.22.6"); // still listed first for review
    expect(text(bars)).toContain("Item 5.22.6 is for work up to plinth level; the line does not place the work there");
    // A line that says it is above plinth level is never put on the up-to-plinth item.
    const above = m("TMT bars Fe 500D above plinth level", "kg");
    expect(above.verdict).not.toBe("reliable");
    // Positive controls: the stage stated, in the schedule's words or as the element.
    for (const d of ["TMT bars Fe 500D upto plinth level", "Steel reinforcement TMT bars Fe 500D in foundation"]) {
      const r = m(d, "kg");
      expect(r.verdict, d).toBe("reliable");
      expect(r.candidates[0].item.code, d).toBe("5.22.6");
    }
    // "footings" places the work too; that line stays possible only under the
    // existing coverage rule ("footing" is not in the item's text), not the stage check.
    expect(text(m("Reinforcement TMT Fe 500D bars in footings", "kg"))).not.toContain("up to plinth level");
  });

  it("a waterproofing item of one method is reliable only when the line names the method (terrace waterproofing was reliable on 22.7.1 “integral cement based”)", () => {
    // Before: reliable 22.7.1 (₹1,684.60/sqm) only because the item says "terraces";
    // the schedule also prices roofs by cement slurry (22.6) and bitumen felt (22.8.1, 22.9, 22.11).
    const wp = m("Waterproofing treatment to terrace", "sqm");
    expect(wp.verdict).toBe("possible");
    expect(wp.candidates[0].item.code).toBe("22.7.1");
    expect(text(wp)).toContain("Item 22.7.1 is integral cement based waterproofing; the line does not say which method");
    // Positive control: the method named.
    const integral = m("Integral cement based waterproofing treatment to terrace", "sqm");
    expect(integral.verdict).toBe("reliable");
    expect(integral.candidates[0].item.code).toBe("22.7.1");
    // A line naming another method never lands reliably on the integral item.
    const felt = m("Waterproofing treatment with bitumen felt over terrace", "sqm");
    expect(felt.verdict === "reliable" && felt.candidates[0].item.code === "22.7.1").toBe(false);
  });

  it("an item for a specialised form the line does not state is never reliable (superstructure brickwork was reliable on 6.9 “plain arches”)", () => {
    // Before: reliable 6.9 "Brick work in plain arches in superstructure …" —
    // a wrong rate (₹15,077.95/cum vs ₹9,105–9,344 for 6.4.x) for plain walls.
    const r = m("Brick work with common burnt clay bricks in superstructure", "cum");
    expect(r.verdict).toBe("possible");
    expect(r.candidates[0].item.code).toBe("6.9");
    expect(text(r)).toContain("Item 6.9 is for work in arches; the line does not say so");
    // The same holds for the other arch items: gauged arches, arch tile-brick work.
    expect(m("Brick work in gauged superstructure with common burnt clay bricks in cement mortar 1:3", "cum").verdict).not.toBe("reliable");
    expect(m("Tile brick masonry with common burnt clay tile bricks in superstructure in cement mortar 1:4", "cum").verdict).not.toBe("reliable");
  });

  it("a line that does say arches still reaches the arch items", () => {
    const plain = m("Brick work in plain arches with common burnt clay F.P.S. bricks in superstructure", "cum");
    expect(plain).toMatchObject({ verdict: "reliable", ambiguous: false });
    expect(plain.candidates[0].item.code).toBe("6.9");
    expect(text(plain)).not.toContain("is for work in arches");
    // Plain vs gauged not stated → both listed, not chosen.
    const either = m("Brick work in arches", "cum");
    expect(either).toMatchObject({ verdict: "possible", ambiguous: true });
    expect(codes(either)).toEqual(["6.9", "6.10"]);
    // Domes and vaults are among the forms of RCC item 5.5; naming one is enough.
    expect(text(m("RCC in domes", "cum"))).not.toContain("is for work in arches");
  });

  it("an item for an action other than new work is never reliable for a line that does not name it (an overhead tank was reliable on 14.79 “Disconnecting damaged … tank”)", () => {
    const r = m("Overhead Water Tank", "nos");
    expect(r.verdict).not.toBe("reliable");
    expect(text(r)).toContain("Item 14.79 is for disconnecting; the line does not say so");
    // Saying the action keeps the item reachable.
    const said = m("Disconnecting damaged overhead PVC water storage tank", "each");
    expect(said.candidates[0].item.code).toBe("14.79");
    expect(text(said)).not.toContain("is for disconnecting");
  });

  it("an accessory item is never reliable for a line that names only the object it is for (a uPVC door was reliable on 9.152 “steel roller for uPVC sliding door”)", () => {
    const r = m("UPVC door", "nos");
    expect(r.verdict).not.toBe("reliable");
    expect(text(r)).toContain("Item 9.152 is for roller; the line does not say so");
    // A line for the accessory itself still matches it.
    const roller = m("Steel roller for uPVC sliding door", "each");
    expect(roller).toMatchObject({ verdict: "reliable", ambiguous: false });
    expect(roller.candidates[0].item.code).toBe("9.152");
  });

  it("ordinary items keep their reliable matches under the action and accessory checks", () => {
    // New-work items are unaffected (both carry no restriction).
    expect(m("Providing and fixing white vitreous china pedestal type water closet", "each").verdict).not.toBe("none");
    const sink = m("Providing and fixing kitchen sink with C.I. brackets", "each");
    expect(sink.candidates[0].item.code).toMatch(/^17\.9/);
    expect(text(sink)).not.toMatch(/is for (roller|disconnecting|dismantling)/);
  });

  it("ordinary superstructure brickwork ranks the superstructure items, not the arch item", () => {
    const r = m("Brick work with common burnt clay F.P.S. bricks in superstructure in cement mortar 1:6", "cum");
    expect(r.candidates[0].item.code).toBe("6.4.2");
    expect(codes(r)).not.toContain("6.9");
    // Not reliable: the line does not say which of the 1:6 items (plinth vs superstructure, etc.) — listed for review.
    expect(r.verdict).toBe("possible");
  });

  it("a reliable match never lacks the line's most distinctive term (6 mm plaster “to ceiling” was reliable on 13.16.1)", () => {
    const r = m("6 mm cement plaster 1:3 to ceiling", "sqm");
    expect(r.verdict).toBe("possible");
    expect(text(r)).toContain('including "ceiling", the line\'s most distinctive term');
    expect(text(r)).toContain('The item does not mention "ceiling"');
  });

  it("a reliable match covers the line: a missing object (soil vs masonry) keeps it possible", () => {
    const r = m("Anti-termite treatment of soil under existing floors", "metre");
    expect(r.verdict).toBe("possible");
    expect(r.candidates[0].missingTerms).toContain("soil");
  });

  it("spelling and plurals: “earthwork” is the schedule's “earth work”; “dado” meets “dados”", () => {
    const e = m("Earthwork in excavation for foundation in ordinary soil", "cum");
    expect(text(e)).not.toContain("never uses: earthwork");
    expect(codes(e)).toContain("2.8.1");
    const d = m("Ceramic glazed wall tiles dado", "sqm");
    expect(d).toMatchObject({ verdict: "reliable" });
    expect(d.candidates[0].item.code).toBe("8.31");
    expect(d.candidates[0].missingTerms).toEqual([]);
  });

  it("plain vs reinforced concrete is a specification conflict, stated", () => {
    const r = m("RCC in footings M20", "cum");
    expect(r.verdict).not.toBe("reliable");
    const plain = r.candidates.find((c) => c.item.code.startsWith("4.20."))!;
    expect(plain.specConflicts).toContainEqual({ feature: "concrete type", line: "reinforced concrete", schedule: "plain concrete" });
    // "PCC … in sunshade" no longer tops out on 26.60 "Water proofing treatment of RCC sunshade".
    expect(codes(m("Plain cement concrete 1:2:4 in sunshade", "cum"))[0]).toMatch(/^4\.1\./);
  });

  it("labels and single words are not enough to match", () => {
    expect(text(m("Window type 1", "nos"))).toMatch(/^The line does not describe the work enough to match: “window” alone/);
    expect(m("Plastering", "sqm").verdict).toBe("none");
  });

  it("explanations are consistent with the verdict across the probe set", () => {
    const probe: [string, string][] = [
      ["Earthwork in excavation for foundation in ordinary soil", "cum"], ["PCC 1:4:8 below footings", "cum"], ["RCC M25 in columns", "cum"],
      ["RCC 1:1.5:3 in slab", "cum"], ["Reinforcement steel TMT Fe500D bars", "kg"], ["Brick work in cement mortar 1:6 in superstructure", "cum"],
      ["Half brick masonry 1:4", "sqm"], ["12 mm cement plaster 1:6 on internal walls", "sqm"], ["15 mm cement plaster 1:4 on rough side of brick wall", "sqm"],
      ["Vitrified tile flooring 600x600 mm", "sqm"], ["Kota stone flooring 25 mm", "sqm"], ["Acrylic emulsion paint two coats on walls", "sqm"],
      ["Exterior paint on walls", "sqm"], ["Waterproofing treatment to terrace", "sqm"], ["Flush door shutter 35 mm thick", "sqm"],
      ["MS grill for windows", "kg"], ["Structural steel work in trusses", "kg"], ["Damp proof course 40 mm thick 1:2:4", "sqm"],
      ["Formwork for beams", "sqm"], ["Pointing on brick work 1:3", "sqm"], ["Wooden door frame of sal wood", "cum"],
    ];
    for (const [d, u] of probe) {
      const r = m(d, u);
      const best = r.candidates[0];
      if (r.verdict === "reliable") {
        expect(best.unit, d).toBe("match");
        expect(best.specConflicts, d).toEqual([]);
        expect(r.ambiguous, d).toBe(false);
        expect(text(r), d).not.toMatch(/most distinctive term|one variant of a family|holds several sub-items/);
      }
      if (r.ambiguous) {
        // Every item named as "about equally good" has no more conflicts than the best.
        const named = /Several items fit about equally well \(([^)]*)\)/.exec(text(r))![1].replace(/ and \d+ more$/, "").split(", ");
        expect(named, d).toEqual(r.candidates.map((c) => c.item.code));
        for (const c of r.candidates) expect(c.specConflicts.length, d).toBeLessThanOrEqual(best.specConflicts.length);
      }
    }
  });
});

// matchableDescription over the WHOLE seed: what is cut is spill-over, and
// nothing the item itself says is lost.
describe("seed spill-over clean-up, across all 2,758 items", () => {
  const cleaned = all.map((i) => ({ i, d: i.description ?? "", m: matchableDescription(i.description) }));
  const by = (code: string) => cleaned.find((c) => c.i.code === code)!.m;

  it("only ever cuts a tail: the matching text is a prefix of the stored description, never empty", () => {
    for (const { i, d, m } of cleaned) {
      expect(d.startsWith(m), i.code).toBe(true);
      expect(m.length, i.code).toBeGreaterThanOrEqual(Math.min(d.trim().length, 10));
    }
    // How many items are cut, so a change to the rules is noticed.
    expect(cleaned.filter(({ d, m }) => m.length < d.trim().length).length).toBe(100);
  });

  it("no item keeps a sub-head, an appendix, a trailing capitalised heading or a following item's text", () => {
    for (const { i, m } of cleaned) {
      expect(m, i.code).not.toMatch(/\bSUB HEAD\b|\bCOEFFICIENTS FOR\b/);
      // trailing heading: two or more capitalised words at the very end
      expect(m, i.code).not.toMatch(/(?:^|[\s.])(?:[A-Z][A-Z&/().,-]*\s+)+[A-Z]{4,}[A-Z&/().,-]*$/);
      // a following item's code introducing its text (a reference "over item 26.76.1" is fine)
      for (const x of m.matchAll(/\s\d{1,2}\.\d{1,3}(?:[A-Z]|\.[0-9A-Z]{1,3})(?:\.[0-9A-Z]{1,3})*(?:\s[A-Z])?\s+[A-Z]/g)) {
        expect(m.slice(0, x.index), i.code).toMatch(/\bitem(?:\s+no\.?)?\s*$/i);
      }
    }
    expect(Math.max(...cleaned.map((c) => c.m.length))).toBeLessThan(2500); // 26.96.2 held ~42 kB
  });

  it("examples: what is cut and what is kept", () => {
    expect(by("5.21")).toMatch(/excluding cost of hangers\.$/);                  // "STEEL REINFORCEMENT" was the next heading
    expect(by("13.18")).toBe("Neat cement punning.");                            // "ROUGH CAST PLASTER"
    expect(by("9.54.2")).toMatch(/— Hollock wood$/);                             // "BRIGHT FINISHED M.S. FITTINGS"
    expect(by("13.15")).toMatch(/2 stone dust\)\.$/);                            // "6 mm CEMENT PLASTER"
    expect(by("9.147")).toMatch(/for all wind speeds$/);                         // "9.147.A1 Two track … sliding window with Aluminium channel"
    expect(by("18.100.10")).toMatch(/50 mm nominal dia threaded$/);              // "18.100.A Providing and fixing …"
    // Kept: the item's own words.
    expect(by("18.1.1")).toMatch(/INTERNAL WORK - EXPOSED ON WALL — 1216 \(16 mm OD\) pipe$/);
    expect(new Set(["18.1.1", "18.1.2", "18.1.3", "18.1.4", "18.1.5", "18.1.6"].map(by)).size).toBe(6);
    expect(by("2.35.3.1")).toContain("POST-CONSTRUCTIONAL anti-termite treatment");
    expect(by("26.12")).toContain("MORTH SPECIFICATION for base/sub-base reinforcement");
    expect(by("26.76.2")).toMatch(/Add\/Deduct over item 26\.76\.1 for every additional lead of 5 km$/);
    expect(by("9.7.5.3")).toContain("Type II IS: 12823 marked");
  });

  it("rows that hold their own sub-items are identified, not cut into a guess", () => {
    const merged = all.filter((i) => embeddedSubItems(i.code, i.description).length > 0).map((i) => i.code);
    expect(merged).toHaveLength(34);
    expect(merged).toEqual(expect.arrayContaining(["5.22A", "5.22B", "9.147", "26.50.1"]));
    expect(embeddedSubItems("5.22B", all.find((i) => i.code === "5.22B")!.description)).toEqual(["5.22B.1"]);
    expect(ix.merged.get(all.find((i) => i.code === "26.50.1")!)).toEqual(["26.50.1 A", "26.50.1 B"]);
  });
});
