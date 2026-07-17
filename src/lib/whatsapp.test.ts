import { describe, it, expect } from "vitest";
import { normalizeWhatsAppPhone, buildWhatsAppUrl } from "./whatsapp";

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
