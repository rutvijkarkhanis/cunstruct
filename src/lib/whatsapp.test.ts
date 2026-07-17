import { describe, it, expect } from "vitest";
import { normalizeWhatsAppPhone, buildWhatsAppUrl, buildBriefingMessage } from "./whatsapp";

describe("normalizeWhatsAppPhone", () => {
  it("prepends 91 to a bare 10-digit Indian mobile", () => {
    expect(normalizeWhatsAppPhone("9876543210")).toBe("919876543210");
  });
  it("strips separators and keeps an existing country code", () => {
    expect(normalizeWhatsAppPhone("+91 98765 43210")).toBe("919876543210");
    expect(normalizeWhatsAppPhone("91-9876543210")).toBe("919876543210");
  });
  it("handles a leading 0", () => {
    expect(normalizeWhatsAppPhone("09876543210")).toBe("919876543210");
  });
  it("returns null for empty/invalid input", () => {
    expect(normalizeWhatsAppPhone("")).toBeNull();
    expect(normalizeWhatsAppPhone(null)).toBeNull();
    expect(normalizeWhatsAppPhone("abc")).toBeNull();
  });
});

describe("buildWhatsAppUrl", () => {
  it("builds a wa.me link with the message url-encoded", () => {
    const url = buildWhatsAppUrl("9876543210", "Hi there!\nLine 2");
    expect(url).toBe("https://wa.me/919876543210?text=Hi%20there!%0ALine%202");
  });
  it("returns null when there is no valid phone", () => {
    expect(buildWhatsAppUrl(null, "hello")).toBeNull();
  });
});

describe("buildBriefingMessage", () => {
  const items = [
    { product_name: "Cement (PPC)", qty_estimated: 44, unit: "bag", budget_estimated: 17600, order_by_date: "2026-07-20" },
    { product_name: "Plastering Sand", qty_estimated: 275, unit: "cft", budget_estimated: 15620, order_by_date: "2026-07-22" },
  ];

  it("greets by name, lists items with per-item price, and totals", () => {
    const msg = buildBriefingMessage(items, { projectName: "Sector 57 Villa", customerName: "Rahul", stageName: "Plastering", progressPct: 40 });
    expect(msg).toContain("Hi Rahul");
    expect(msg).toContain("Sector 57 Villa");
    expect(msg).toContain("*Plastering*");
    expect(msg).toContain("1. Cement (PPC) — 44 bag");
    expect(msg).toContain("2. Plastering Sand — 275 cft");
    expect(msg).toContain("Estimated total: ₹33,220");
    expect(msg).toContain("order"); // order-by nudge present
    expect(msg).toContain("Team Cunstruct");
  });

  it("falls back to a generic greeting without a customer name", () => {
    const msg = buildBriefingMessage(items, { projectName: "Site A" });
    expect(msg.startsWith("Hi 👋")).toBe(true);
  });

  it("omits the total when no item has a budget", () => {
    const msg = buildBriefingMessage(
      [{ product_name: "Sand", qty_estimated: 10, unit: "cft" }],
      { projectName: "Site A" }
    );
    expect(msg).not.toContain("Estimated total");
  });

  it("returns a check-in message when there are no items", () => {
    const msg = buildBriefingMessage([], { projectName: "Site A", customerName: "Rahul", stageName: "Foundation", progressPct: 20 });
    expect(msg).toContain("check-in");
    expect(msg).toContain("Foundation");
  });
});
