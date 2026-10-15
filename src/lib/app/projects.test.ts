import { describe, it, expect } from "vitest";
import { projectMatches, projectStatusLabel, type AppProjectRow } from "./projects";

const p: AppProjectRow = { id: "1", name: "Tower A", client_name: "Acme", location: "Pune", project_type: "Office", status: "pending_review", created_at: "" };

describe("projectMatches", () => {
  it("matches name, client, location and type case-insensitively", () => {
    for (const q of ["tower", "ACME", "pun", "office", "  "]) expect(projectMatches(p, q)).toBe(true);
    expect(projectMatches(p, "nashik")).toBe(false);
  });
});
describe("projectStatusLabel", () => {
  it("humanises known and unknown statuses", () => {
    expect(projectStatusLabel("pending_review")).toBe("Pending review");
    expect(projectStatusLabel("on_hold")).toBe("On hold");
  });
});
