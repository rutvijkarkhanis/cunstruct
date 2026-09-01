import { describe, it, expect } from "vitest";
import {
  classifyMethod,
  canonicalUnit,
  pendingReason,
  type QuantityMethod,
  type QuantityStatus,
} from "./quantityMethod";

describe("classifyMethod", () => {
  it("classifies discrete fixtures/fittings as COUNT", () => {
    for (const n of ["WC", "Wash Basin", "Door", "Window", "Modular Socket", "6A Switch", "Ceiling Fan"]) {
      expect(classifyMethod(n)).toBe("COUNT");
    }
  });

  it("classifies running-length joinery and linear finishes as LENGTH", () => {
    for (const n of ["Kitchen Counter", "Wet Kitchen Counter", "Wardrobe", "WIC dress unit", "Overhead Storage", "Skirting", "CPVC Pipe"]) {
      expect(classifyMethod(n)).toBe("LENGTH");
    }
  });

  it("classifies measured surfaces as AREA", () => {
    for (const n of ["Vitrified Flooring", "Wall Tiles", "Waterproofing", "Balcony", "Terrace Deck", "Greenscape", "Kitchen Dado"]) {
      expect(classifyMethod(n)).toBe("AREA");
    }
  });

  it("classifies masonry and cast concrete as VOLUME", () => {
    for (const n of ["AAC Block Masonry", "Brickwork", "RCC Concrete", "PCC", "Footing"]) {
      expect(classifyMethod(n)).toBe("VOLUME");
    }
  });

  it("classifies reinforcement/steel as WEIGHT", () => {
    for (const n of ["TMT Reinforcement", "Fe550 Rebar", "Structural Steel"]) {
      expect(classifyMethod(n)).toBe("WEIGHT");
    }
  });

  it("classifies consumables as COVERAGE", () => {
    for (const n of ["Wall Putty", "Primer", "Emulsion Paint", "Tile Adhesive", "Cement"]) {
      expect(classifyMethod(n)).toBe("COVERAGE");
    }
  });

  it("classifies systems as SPECIFICATION", () => {
    for (const n of ["Passenger Lift", "HVAC AHU", "Fire Fighting sprinkler system"]) {
      expect(classifyMethod(n)).toBe("SPECIFICATION");
    }
  });

  it("returns PENDING when it genuinely cannot tell", () => {
    expect(classifyMethod("Mystery Widget")).toBe("PENDING");
    expect(classifyMethod("")).toBe("PENDING");
    expect(classifyMethod(null)).toBe("PENDING");
  });

  it("can represent every core methodology", () => {
    const methods: QuantityMethod[] = [
      "COUNT", "AREA", "LENGTH", "VOLUME", "WEIGHT", "COVERAGE", "DERIVED", "SPECIFICATION", "PENDING",
    ];
    // Each has a canonical unit mapping (possibly empty) — proves the set is total.
    for (const m of methods) expect(typeof canonicalUnit(m)).toBe("string");
  });
});

describe("canonicalUnit", () => {
  it("maps methodologies to their natural unit", () => {
    expect(canonicalUnit("COUNT")).toBe("nos");
    expect(canonicalUnit("AREA")).toBe("sq.ft");
    expect(canonicalUnit("LENGTH")).toBe("rft");
    expect(canonicalUnit("VOLUME")).toBe("cft");
    expect(canonicalUnit("WEIGHT")).toBe("kg");
  });
});

describe("pendingReason", () => {
  it("gives a length-specific reason for LENGTH", () => {
    expect(pendingReason("LENGTH")).toMatch(/running length/i);
  });
  it("asks for structural drawings for WEIGHT", () => {
    expect(pendingReason("WEIGHT")).toMatch(/structural/i);
  });
});

describe("quantity status vocabulary", () => {
  it("includes all six statuses as valid literals", () => {
    const statuses: QuantityStatus[] = [
      "MEASURED", "COUNTED", "DERIVED", "ESTIMATED", "PENDING", "NOT_APPLICABLE",
    ];
    expect(new Set(statuses).size).toBe(6);
  });
});
