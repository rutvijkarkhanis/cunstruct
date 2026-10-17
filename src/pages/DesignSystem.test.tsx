import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";

const auth = { loading: false, rolesReady: true, isStaff: false };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth }));

import DesignSystem from "./DesignSystem";

function renderPage() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={["/design-system"]}>
        <DesignSystem />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

describe("/design-system access gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    Object.assign(auth, { loading: false, rolesReady: true, isStaff: false });
  });

  it("renders in development, with both themes and every state", () => {
    vi.stubEnv("DEV", true);
    renderPage();
    expect(screen.getByRole("heading", { name: "Cunstruct design system" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "light theme" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "dark theme" })).toBeInTheDocument();
    // Each state badge appears in each theme's state list and sample grid.
    expect(screen.getAllByText("Needs review").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole("heading", { name: /0 failing/ })).toBeInTheDocument();
  });

  it("keeps its own controls at the 24px target and lets state meanings wrap on narrow screens", () => {
    // Browser check found the <summary> at 16px tall and, at 390px, the
    // meaning column squeezed to ~14px (flex-basis 0) with text overflowing.
    vi.stubEnv("DEV", true);
    const { container } = renderPage();
    const summaries = container.querySelectorAll("summary");
    expect(summaries.length).toBe(2);
    summaries.forEach((s) => expect(s).toHaveClass("ds-target"));
    const meanings = screen.getAllByTestId("state-meaning");
    expect(meanings.length).toBeGreaterThan(0);
    meanings.forEach((m) => expect(m).toHaveClass("basis-48"));
  });

  it("makes each sideways-scrolling table a named keyboard stop with the design-system focus ring", () => {
    // Browser check: Chrome made these scroll boxes focusable on its own, with
    // its default ring instead of ours.
    vi.stubEnv("DEV", true);
    renderPage();
    const regions = ["BOQ grid sample", "Money format examples", "Contrast check results"]
      .flatMap((name) => screen.getAllByRole("region", { name }));
    expect(regions.length).toBeGreaterThanOrEqual(3);
    regions.forEach((r) => {
      expect(r).toHaveAttribute("tabindex", "0");
      expect(r).toHaveClass("ds-focus");
    });
  });

  it("shows the ordinary 404 to non-staff in a production build", () => {
    vi.stubEnv("DEV", false);
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderPage();
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.queryByText("Cunstruct design system")).toBeNull();
  });

  it("does not decide while roles are still loading", () => {
    vi.stubEnv("DEV", false);
    Object.assign(auth, { rolesReady: false });
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("404")).toBeNull();
  });

  it("renders for staff in a production build", () => {
    vi.stubEnv("DEV", false);
    Object.assign(auth, { isStaff: true });
    renderPage();
    expect(screen.getByRole("heading", { name: "Cunstruct design system" })).toBeInTheDocument();
  });
});
