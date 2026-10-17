import { describe, it, expect } from "vitest";
import { saveErrorMessage } from "./saveError";

describe("saveErrorMessage", () => {
  it("explains network failures instead of showing the raw TypeError", () => {
    expect(saveErrorMessage({ message: "TypeError: Failed to fetch" })).toBe("the connection to the server failed. Check your connection and try again.");
    expect(saveErrorMessage(new TypeError("NetworkError when attempting to fetch resource."))).toMatch(/connection to the server failed/);
  });
  it("explains permission failures", () => {
    expect(saveErrorMessage({ message: "new row violates row-level security policy", code: "42501" })).toMatch(/don't have permission/);
  });
  it("keeps other server messages and never returns blank", () => {
    expect(saveErrorMessage({ message: "duplicate key value" })).toBe("duplicate key value");
    expect(saveErrorMessage(null)).toBe("something went wrong. Try again.");
  });
});
