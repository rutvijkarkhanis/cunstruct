import { describe, it, expect } from "vitest";
import { DISCIPLINES, disciplineByKey } from "./disciplines";

describe("disciplines", () => {
  it("registers civil + the four MEP disciplines", () => {
    expect(DISCIPLINES.map((d) => d.key)).toEqual(["civil", "plumbing", "electrical", "hvac", "fire"]);
    expect(disciplineByKey("electrical").name).toBe("Electrical Works");
    expect(disciplineByKey("nope").key).toBe("civil");   // fallback to civil for an unknown key
  });
});
