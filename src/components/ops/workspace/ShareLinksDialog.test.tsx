// ShareLinksDialog — the staff-only create/revoke UI. Exercises the expiry
// control added here: no-expiry stays the default, an explicit date is
// passed through to createLink as an end-of-day ISO timestamp, a past date
// is rejected before any create call, and an existing link's configured
// expiry is shown in the list.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import ShareLinksDialog from "./ShareLinksDialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const createLink = vi.fn(async () => "raw-token-abc");
const revokeLink = vi.fn(async () => true);
let links: unknown[] = [];

vi.mock("@/hooks/useShareLinks", () => ({
  useShareLinks: () => ({ links, createLink, revokeLink }),
}));

function renderDialog() {
  return render(<ShareLinksDialog projectId="proj-1" open={true} onOpenChange={() => {}} />);
}

describe("ShareLinksDialog — creating a link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    links = [];
  });

  it("defaults to no expiry — createLink receives expiresAt: null when the date field is left blank", async () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText(/client review/i), { target: { value: "Reviewer link" } });
    fireEvent.click(screen.getByRole("button", { name: /create link/i }));
    await waitFor(() => expect(createLink).toHaveBeenCalled());
    expect(createLink).toHaveBeenCalledWith(expect.objectContaining({ name: "Reviewer link", expiresAt: null }));
  });

  it("passes a chosen expiry date through as an end-of-day ISO timestamp", async () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText(/client review/i), { target: { value: "Dated link" } });
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    const future = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
    fireEvent.change(dateInput, { target: { value: future } });
    fireEvent.click(screen.getByRole("button", { name: /create link/i }));
    await waitFor(() => expect(createLink).toHaveBeenCalled());
    const call = createLink.mock.calls[0][0] as { expiresAt: string | null };
    expect(call.expiresAt).not.toBeNull();
    expect(new Date(call.expiresAt!).toISOString().slice(0, 10)).toBe(future);
    // End of day, not midnight — a link "expiring today" stays usable
    // through the rest of today.
    expect(new Date(call.expiresAt!).getHours()).toBeGreaterThanOrEqual(23 - 1); // allow for TZ rounding in CI
  });

  it("rejects a past expiry date — never calls createLink", async () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText(/client review/i), { target: { value: "Backdated link" } });
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2020-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /create link/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/past/i)));
    expect(createLink).not.toHaveBeenCalled();
  });

  it("requires a name before calling createLink", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /create link/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(createLink).not.toHaveBeenCalled();
  });

  it("passes showPricing through unchanged by the expiry addition", async () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText(/client review/i), { target: { value: "No-pricing link" } });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: /create link/i }));
    await waitFor(() => expect(createLink).toHaveBeenCalled());
    expect(createLink).toHaveBeenCalledWith(expect.objectContaining({ showPricing: false }));
  });

  it("shows the raw token exactly once after a successful create", async () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText(/client review/i), { target: { value: "Reviewer link" } });
    fireEvent.click(screen.getByRole("button", { name: /create link/i }));
    expect(await screen.findByDisplayValue(/\/share\/raw-token-abc$/)).toBeInTheDocument();
  });
});

describe("ShareLinksDialog — existing links list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'No expiry' for a link with no expires_at", () => {
    links = [{ id: "l1", name: "Indefinite link", show_pricing: true, created_at: "2026-01-01T00:00:00Z", expires_at: null, revoked_at: null, last_accessed_at: null }];
    renderDialog();
    expect(screen.getByText(/pricing visible · no expiry/i)).toBeInTheDocument();
  });

  it("shows the configured expiry date for an active, not-yet-expired link", () => {
    const future = new Date(Date.now() + 30 * 86400_000).toISOString();
    links = [{ id: "l1", name: "Dated link", show_pricing: true, created_at: "2026-01-01T00:00:00Z", expires_at: future, revoked_at: null, last_accessed_at: null }];
    renderDialog();
    expect(screen.getByText(/pricing visible · expires/i)).toBeInTheDocument();
  });

  it("shows 'Expired' (not the active expiry line) once the date has passed", () => {
    const past = "2020-01-01T00:00:00Z";
    links = [{ id: "l1", name: "Old link", show_pricing: true, created_at: "2019-01-01T00:00:00Z", expires_at: past, revoked_at: null, last_accessed_at: null }];
    renderDialog();
    expect(screen.getByText(/^expired/i)).toBeInTheDocument();
  });

  it("revoking still works unaffected by the expiry addition", async () => {
    links = [{ id: "l1", name: "Active link", show_pricing: true, created_at: "2026-01-01T00:00:00Z", expires_at: null, revoked_at: null, last_accessed_at: null }];
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /revoke/i }));
    await waitFor(() => expect(revokeLink).toHaveBeenCalledWith("l1"));
  });
});
