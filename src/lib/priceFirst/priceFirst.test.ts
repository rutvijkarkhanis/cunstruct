// Price first (B4, preview lane). BOQ lines below are SYNTHETIC; rates come
// from the real DSR 2023 seed the app ships with, so the matcher and its
// safeguards are exercised as in the product.
import { beforeAll, describe, expect, it } from "vitest";
import { seedCatalogue } from "@/lib/dsr/seedFixture";
import type { DsrIndex } from "@/lib/dsr/match";
import {
  NO_MATCH_LABEL, PROVISIONAL_LABEL, buildPricingIndex, priceFirst, pricingCoverage,
  type NoMatchLine, type PriceFirstLine,
} from "./index";

const WALL = "Brick work with common burnt clay F.P.S. bricks of class designation 7.5 in superstructure above plinth level up to floor V level in all shapes and sizes in cement mortar 1:6 (1 cement : 6 coarse sand)";
const rateOf = (code: string) => seedCatalogue().find((i) => i.source === "DSR" && i.rate_year === "2023" && i.code === code)!.rate as number;
const line = (id: string, description: string, unit: string, qty: number | null, extra: Partial<PriceFirstLine> = {}): PriceFirstLine =>
  ({ id, description, unit, qty, quantity_status: "MEASURED", ...extra });

let ix: DsrIndex;
beforeAll(() => { ix = buildPricingIndex(seedCatalogue()); });
const one = (l: PriceFirstLine) => priceFirst([l], ix)[0];

describe("priceFirst: every line gets a provisional DSR rate or an explicit no-match", () => {
  it("prices a line by the matcher's reliable match, provisional, with no cost index", () => {
    const r = one(line("W", WALL, "cum", 10));
    expect(r).toMatchObject({
      kind: "provisional_dsr", code: "6.4.2", rate: rateOf("6.4.2"), unit: "cum", basis: "matcher_reliable",
      costIndex: null, label: PROVISIONAL_LABEL, quantityState: "established",
    });
    expect(r.amount).toBe(Math.round(10 * rateOf("6.4.2")));
  });

  it("prices a line by the code it states when the matcher calls that code reliable", () => {
    expect(one(line("P", "Plaster to walls", "sqm", 100, { dsr_code: "13.4.1" }))).toMatchObject({
      kind: "provisional_dsr", code: "13.4.1", rate: rateOf("13.4.1"), basis: "stated_code",
    });
  });

  it("never substitutes another item for a stated code that is not in the schedule", () => {
    const r = one(line("X", WALL, "cum", 10, { dsr_code: "99.99.99" }));
    expect(r).toMatchObject({ kind: "no_match", label: NO_MATCH_LABEL, amount: null });
    expect((r as NoMatchLine).reason).toMatch(/99\.99\.99 is not an item in DSR 2023; no other item is substituted/);
  });

  it("never prices across units: no conversion is assumed", () => {
    const r = one(line("U", "Plaster to walls", "cum", 3, { dsr_code: "13.4.1" }));
    expect(r.kind).toBe("no_match");
    expect(r.amount).toBeNull();
  });

  it("a possible or none verdict never produces a rate, but lists the candidates for review", () => {
    const possible = one(line("Q", "Brick work with common burnt clay F.P.S. bricks in superstructure in cement mortar 1:6", "cum", 5));
    expect(possible).toMatchObject({ kind: "no_match", label: NO_MATCH_LABEL });
    expect((possible as NoMatchLine).candidates[0]).toBe("6.4.2");
    expect(one(line("N", "Plastering", "sqm", 5))).toMatchObject({ kind: "no_match", amount: null });
  });

  it.each([
    ["arch item 6.9 for plain superstructure brickwork", "Brick work with common burnt clay bricks in superstructure", "cum", "6.9"],
    ["disconnecting item 14.79 for an overhead tank", "Overhead Water Tank", "nos", "14.79"],
    ["roller accessory 9.152 for a uPVC door", "UPVC door", "nos", "9.152"],
    ["up-to-plinth item 5.22.6 for TMT bars with no stage", "Steel reinforcement TMT bars Fe 500D", "kg", "5.22.6"],
    ["integral-method item 22.7.1 for terrace waterproofing", "Waterproofing treatment to terrace", "sqm", "22.7.1"],
  ])("known false match stays unpriced: %s", (_label, description, unit, wrongCode) => {
    const r = one(line("F", description, unit, 10));
    expect(r.kind).toBe("no_match");
    expect(r.amount).toBeNull();
    // Still listed for a person to review, never adopted.
    expect((r as NoMatchLine).candidates).toContain(wrongCode);
  });

  it("a pending quantity gets its rate but no amount; a confirmed zero is a real ₹0", () => {
    const pending = one(line("P1", WALL, "cum", 12, { quantity_status: "PENDING" }));
    expect(pending).toMatchObject({ kind: "provisional_dsr", code: "6.4.2", quantityState: "pending", amount: null });
    const bareZero = one(line("P2", WALL, "cum", 0, { quantity_status: null }));
    expect(bareZero).toMatchObject({ kind: "provisional_dsr", quantityState: "pending", amount: null });
    const zero = one(line("Z", WALL, "cum", 0));
    expect(zero).toMatchObject({ kind: "provisional_dsr", quantityState: "confirmed_zero", amount: 0 });
  });

  it("returns exactly one result per line, in order, from a catalogue or a prebuilt index", () => {
    const lines = [line("a", WALL, "cum", 1), line("b", "Plastering", "sqm", 1), line("c", "Plaster to walls", "sqm", 2, { dsr_code: "13.4.1" })];
    const fromIndex = priceFirst(lines, ix);
    const fromCatalogue = priceFirst(lines, seedCatalogue());
    expect(fromIndex.map((r) => r.lineId)).toEqual(["a", "b", "c"]);
    expect(fromCatalogue).toEqual(fromIndex);
    for (const r of fromIndex) expect(["provisional_dsr", "no_match"]).toContain(r.kind);
  });
});

describe("pricingCoverage: what the ₹ figures leave out", () => {
  it("counts priced and no-match lines and states the exclusions", () => {
    const results = priceFirst([
      line("a", WALL, "cum", 10),
      line("b", WALL, "cum", 4, { quantity_status: "PENDING" }),
      line("c", "Overhead Water Tank", "nos", 1),
      line("d", "Plastering", "sqm", 20),
      line("e", "Plaster to walls", "sqm", 100, { dsr_code: "13.4.1" }),
    ], ix);
    const c = pricingCoverage(results);
    expect(c).toMatchObject({ lines: 5, priced: 3, noMatch: 2, pricedWithoutAmount: 1, excludedFromRupees: 3 });
    expect(c.pricedAmount).toBe(Math.round(10 * rateOf("6.4.2")) + Math.round(100 * rateOf("13.4.1")));
    expect(c.note).toBe("₹ figures exclude 3 lines: 2 with no DSR match, 1 with no established quantity.");
  });

  it("says so when nothing is left out", () => {
    expect(pricingCoverage(priceFirst([line("a", WALL, "cum", 1)], ix)).note).toBe("₹ figures include every line.");
    expect(pricingCoverage([]).note).toBe("₹ figures include every line.");
  });
});
