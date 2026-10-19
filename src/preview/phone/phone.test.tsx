// B10 phone surfaces (preview lane, ILLUSTRATIVE FIXTURES): narrow-width
// frame, offline queue, share-link encoding, Hindi fallback, measurement entry.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PhonePreview } from "./PhonePreview";
import { t, isTranslated } from "./messages";
import { QUEUE_KEY, appendAction, loadQueue, saveQueue, type StorageLike } from "./offlineQueue";
import { buildShareLink } from "./shareLink";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

const throwingStorage: StorageLike = {
  getItem: () => { throw new Error("blocked"); },
  setItem: () => { throw new Error("blocked"); },
  removeItem: () => { throw new Error("blocked"); },
};

describe("phone frame", () => {
  it("renders inside a 360 px-wide frame", () => {
    render(<PhonePreview />);
    const frame = screen.getByTestId("phone-frame");
    expect(frame.className).toContain("max-w-[360px]");
    expect(frame.className).toContain("w-full");
  });
});

describe("owner sign-off card", () => {
  it("shows the ₹ range as low–high in en-IN compact form, the key risks and the pending-line note", () => {
    render(<PhonePreview />);
    expect(screen.getByTestId("signoff-range")).toHaveTextContent("₹38.2 L – ₹44.2 L");
    expect(screen.getByText(/Reinforcement quantity for columns is pending/)).toBeInTheDocument();
    expect(screen.getByText("1 line(s) with pending quantity excluded")).toBeInTheDocument();
  });

  it("return needs a reason; nothing is queued without one", () => {
    render(<PhonePreview />);
    fireEvent.click(screen.getByRole("button", { name: "Return" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a reason to return it.");
    expect(window.localStorage.getItem(QUEUE_KEY)).toBeNull();
    fireEvent.change(screen.getByLabelText("Reason for returning"), { target: { value: "Check plinth height" } });
    fireEvent.click(screen.getByRole("button", { name: "Return" }));
    const q = loadQueue(window.localStorage);
    expect(q).toEqual([expect.objectContaining({ kind: "signoff_return", payload: expect.objectContaining({ reason: "Check plinth height" }) })]);
  });
});

describe("offline queue", () => {
  it("approve queues to localStorage, shows pending sync, survives a remount, and can be discarded", () => {
    const { unmount } = render(<PhonePreview />);
    expect(screen.getByTestId("sync-state")).toHaveTextContent("No queued actions");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByTestId("sync-state")).toHaveTextContent("Pending sync — preview, nothing is sent");
    expect(screen.getByTestId("sync-state")).toHaveTextContent("1 action(s) queued on this device");
    expect(JSON.parse(window.localStorage.getItem(QUEUE_KEY)!)).toHaveLength(1);
    unmount();

    render(<PhonePreview />);
    expect(screen.getByTestId("sync-state")).toHaveTextContent("1 action(s) queued");
    fireEvent.click(screen.getByRole("button", { name: "Discard queued actions" }));
    expect(screen.getByTestId("sync-state")).toHaveTextContent("No queued actions");
    expect(window.localStorage.getItem(QUEUE_KEY)).toBeNull();
  });

  it("with storage that throws, the view still works and keeps the queue in memory", () => {
    render(<PhonePreview storage={throwingStorage} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByTestId("sync-state")).toHaveTextContent("1 action(s) queued");
    expect(screen.getByTestId("sync-state")).toHaveTextContent("Device storage unavailable");
  });

  it("loadQueue treats corrupt or blocked storage as empty; saveQueue reports failure", () => {
    expect(loadQueue(throwingStorage)).toEqual([]);
    expect(saveQueue(throwingStorage, appendAction([], "signoff_approve", {}))).toBe(false);
    window.localStorage.setItem(QUEUE_KEY, "{not json");
    expect(loadQueue(window.localStorage)).toEqual([]);
    expect(loadQueue(null)).toEqual([]);
  });

  it("never calls the network", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<PhonePreview />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Call-offs" }));
    for (const b of screen.getAllByRole("button", { name: "Queue call-off" })) fireEvent.click(b);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("call-offs", () => {
  it("lists weekly call-offs to the contractor's own dealer and the lines not procurable yet", () => {
    render(<PhonePreview />);
    fireEvent.click(screen.getByRole("button", { name: "Call-offs" }));
    expect(screen.getByText("CO-W2")).toBeInTheDocument();
    expect(screen.getAllByText("To: Contractor's own dealer (fixture)").length).toBe(5);
    expect(screen.getByText(/PL-02 · Reinforcement — columns — Quantity is pending/)).toBeInTheDocument();
    const first = screen.getAllByRole("button", { name: "Queue call-off" })[0];
    fireEvent.click(first);
    expect(first).toBeDisabled();
    expect(first).toHaveTextContent("Queued");
    expect(loadQueue(window.localStorage)[0]).toMatchObject({ kind: "calloff_queue", payload: { callOff: "CO-W2" } });
  });
});

describe("site measurement entry", () => {
  const enter = (label: string, value: string) => {
    const input = screen.getByRole("textbox", { name: label });
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Enter" });
  };

  it("keeps the total pending until every value is entered, then computes No × L × B × D", () => {
    render(<PhonePreview />);
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    expect(screen.getByTestId("measure-total")).toHaveTextContent("Pending — enter every value");
    enter("Row 1 No", "2");
    enter("Row 1 L (m)", "1.5");
    enter("Row 1 B (m)", "1.2");
    expect(screen.getByTestId("measure-total")).toHaveTextContent("Pending");
    enter("Row 1 D (m)", "0.1");
    expect(screen.getByTestId("measure-total")).toHaveTextContent("0.36 m³");
  });

  it("holds photos as in-memory object URLs only and queues just their count", () => {
    const create = vi.fn(() => "blob:preview-photo-1");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const { unmount } = render(<PhonePreview />);
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    const file = new File(["x"], "site.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Attach photo"), { target: { files: [file] } });
    expect(screen.getByRole("img", { name: "site.jpg" })).toHaveAttribute("src", "blob:preview-photo-1");
    fireEvent.click(screen.getByRole("button", { name: "Queue measurement" }));
    const stored = window.localStorage.getItem(QUEUE_KEY)!;
    expect(stored).not.toContain("blob:");
    expect(JSON.parse(stored)[0]).toMatchObject({ kind: "measurement_save", payload: { photos: 1, status: "pending", total: null } });
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:preview-photo-1");
  });
});

describe("WhatsApp share link", () => {
  it("encodes the text, normalises an Indian mobile and never opens anything by itself", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    expect(buildShareLink("Cement 2.6 t & sand ₹?", "98765 43210")).toEqual({
      ok: true,
      url: `https://wa.me/919876543210?text=${encodeURIComponent("Cement 2.6 t & sand ₹?")}`,
    });
    expect(buildShareLink("hello")).toEqual({ ok: true, url: "https://wa.me/?text=hello" });
    render(<PhonePreview />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    const url = screen.getByTestId("share-url").textContent!;
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1])).toBe("Call-off CO-W2: needed week 2. Preview only — please do not act on this message.");
    expect(screen.getByRole("link", { name: "Open in WhatsApp" })).toHaveAttribute("href", url);
    expect(open).not.toHaveBeenCalled();
  });

  it("refuses an empty message, a bad phone, and anything that looks like a token", () => {
    expect(buildShareLink("   ")).toEqual({ ok: false, error: "empty_message" });
    expect(buildShareLink("hi", "12")).toEqual({ ok: false, error: "bad_phone" });
    expect(buildShareLink("see https://x.example/?token=abc123")).toEqual({ ok: false, error: "looks_like_secret" });
    expect(buildShareLink("Bearer abcdefghijklmnop")).toEqual({ ok: false, error: "looks_like_secret" });
    render(<PhonePreview />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "api_key=XYZ" } });
    expect(screen.getByRole("alert")).toHaveTextContent("looks like it contains a token");
    expect(screen.queryByTestId("share-url")).toBeNull();
  });
});

describe("message catalogue — Hindi stub with English fallback", () => {
  it("t() returns Hindi where translated and English otherwise", () => {
    expect(t("hi", "approve")).toBe("स्वीकृत करें");
    expect(isTranslated("hi", "approve")).toBe(true);
    expect(t("hi", "signoffRange")).toBe("Estimated range");
    expect(isTranslated("hi", "signoffRange")).toBe(false);
    expect(t("hi", "pendingCount", { count: 3 })).toBe("3 action(s) queued on this device");
  });

  it("switching to हिं translates the stubbed strings and falls back to English for the rest", () => {
    render(<PhonePreview />);
    fireEvent.click(screen.getByRole("button", { name: "हिं" }));
    const frame = screen.getByTestId("phone-frame");
    expect(frame).toHaveAttribute("lang", "hi");
    expect(within(frame).getByRole("button", { name: "स्वीकृत करें" })).toBeInTheDocument();
    expect(within(frame).getByRole("button", { name: "वापस भेजें" })).toBeInTheDocument();
    expect(within(frame).getByText("Estimated range")).toBeInTheDocument(); // fallback
    expect(within(frame).getByTestId("signoff-range")).toHaveTextContent("₹38.2 L – ₹44.2 L"); // en-IN numbers
  });
});
