import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

// SYNTHETIC: the lazy lab panel is a stand-in so the launcher's own behaviour is tested in isolation.
vi.mock("./MeasurementLabPanel", () => ({
  default: () => (
    <div data-testid="measurement-lab">
      <button type="button">lab button</button>
      <div data-lab-esc="clear"><button type="button">selected measurement</button></div>
    </div>
  ),
}));
const auth = vi.hoisted(() => ({ roles: ["admin"] as string[] }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth }));
import MeasurementLabLauncher from "./MeasurementLabLauncher";

// the workstation's own shortcuts listen on window (V verify, E edit, F flag, P pending, arrows)
const workstationKeys = vi.fn();
const onWindowKey = (e: KeyboardEvent) => workstationKeys(e.key);
beforeEach(() => { auth.roles = ["admin"]; workstationKeys.mockReset(); window.addEventListener("keydown", onWindowKey); });
afterEach(() => window.removeEventListener("keydown", onWindowKey));
const open = async () => { fireEvent.click(screen.getByRole("button", { name: /measurement lab/i })); await screen.findByTestId("measurement-lab"); };

describe("Measurement Lab launcher", () => {
  it("keys pressed in the open lab never reach the workstation's shortcuts", async () => {
    render(<MeasurementLabLauncher />);
    fireEvent.keyDown(document.body, { key: "p" });
    expect(workstationKeys).toHaveBeenCalledWith("p"); // baseline: the workstation hears keys while the lab is closed
    workstationKeys.mockReset();
    await open();
    for (const k of ["v", "e", "f", "p", "ArrowRight"]) fireEvent.keyDown(screen.getByRole("button", { name: "lab button" }), { key: k });
    expect(workstationKeys).not.toHaveBeenCalled();
  });
  it("Esc inside a selected measurement keeps the lab open (the lab clears the selection); elsewhere Esc closes it", async () => {
    render(<MeasurementLabLauncher />);
    await open();
    await act(async () => { fireEvent.keyDown(screen.getByRole("button", { name: "selected measurement" }), { key: "Escape" }); });
    expect(screen.queryByTestId("measurement-lab")).toBeTruthy();
    await act(async () => { fireEvent.keyDown(screen.getByRole("button", { name: "lab button" }), { key: "Escape" }); });
    expect(screen.queryByTestId("measurement-lab")).toBeNull();
    fireEvent.keyDown(document.body, { key: "v" });
    expect(workstationKeys).toHaveBeenCalledWith("v"); // containment ends when the lab closes
  });
  it("renders nothing for non-admins", () => {
    auth.roles = ["ops"];
    const { container } = render(<MeasurementLabLauncher />);
    expect(container.textContent).toBe("");
  });
});
