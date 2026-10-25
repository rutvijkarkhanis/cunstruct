import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rename = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/app/draftProject", () => ({ renameProject: rename.fn }));

import ProjectNameEditor from "./ProjectNameEditor";

const renderEditor = () => render(<QueryClientProvider client={new QueryClient()}><ProjectNameEditor projectId="p1" name="GF Plan (draft)" /></QueryClientProvider>);

beforeEach(() => { rename.fn.mockReset(); });

describe("renaming a project later", () => {
  it("saves the new name and shows the project heading again", async () => {
    rename.fn.mockResolvedValue(undefined);
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), { target: { value: "Tower B" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(rename.fn).toHaveBeenCalledWith("p1", "Tower B");
  });

  it("a refused rename keeps the form open and says why", async () => {
    rename.fn.mockRejectedValue(new Error("This project could not be renamed. You may not have permission to change it."));
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), { target: { value: "Tower B" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be renamed");
    expect(screen.getByRole("textbox", { name: "Project name" })).toHaveValue("Tower B");
  });
});
