// BOQ table render tests: labelled columns, search/filter/sort, inline
// editing (Enter/blur save; Escape cancels and NEVER saves), user-facing
// labels, and source links.
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BoqTable, { type LineSource } from "./BoqTable";
import type { BoqTableLine } from "@/lib/app/boqTable";
import { DRAWING_REVIEW_SECTION } from "@/lib/applyFinding";

const L = (p: Partial<BoqTableLine>): BoqTableLine => ({
  id: "x", section: "Brickwork", dsr_code: "6.1", description: "Brick wall", unit: "cum", qty: 10,
  dsr_rate: 100, custom_rate: null, basis: null, quantity_status: null, measurement_method: null,
  included: true, sort: 0, source_document_id: null, source_page: null, ...p,
});
const LINES = [
  L({ id: "a", sort: 1, source_document_id: "d1", source_page: "3" }),
  L({ id: "b", sort: 2, section: "Plaster", description: "Cement plaster", dsr_code: "13.1", unit: "sqm", qty: 0, dsr_rate: 50 }),
  L({ id: "c", sort: 3, section: DRAWING_REVIEW_SECTION, description: "Door D1", dsr_code: null, unit: "nos", qty: 4, dsr_rate: null }),
];
const sourceOf = (l: BoqTableLine): LineSource | null =>
  l.source_document_id ? { name: "GF Plan", page: l.source_page ?? null, href: `../drawings?document=${l.source_document_id}&page=3` } : null;

function renderTable(onSave = vi.fn(async () => true), lines = LINES) {
  render(<MemoryRouter><BoqTable lines={lines} sourceOf={sourceOf} onSave={onSave} rateEditHref="/builder" /></MemoryRouter>);
  return onSave;
}
const bodyRows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);
const descriptions = () => bodyRows().map((r) => within(r).getAllByRole("cell")[2].textContent);

describe("BoqTable — structure and labels", () => {
  it("labels every column and offers rate editing only via the builder", () => {
    renderTable();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Section", "Code", "Description", "Quantity", "Unit", "Rate (₹)Edit in builder", "Amount (₹)", "Status", "Source"]);
    expect(screen.getByRole("link", { name: "Edit in builder" })).toHaveAttribute("href", "/builder");
    expect(screen.getByRole("region", { name: "BOQ lines" })).toHaveAttribute("tabindex", "0");
  });

  it("shows user-facing labels: Unassigned (never the internal section), Pending, and status", () => {
    renderTable();
    expect(screen.queryByText(/Drawing review/)).toBeNull();
    const [, b, c] = bodyRows();
    expect(within(c).getByText("Unassigned")).toBeInTheDocument();
    expect(within(c).getByText("No rate")).toBeInTheDocument();
    expect(within(b).getByRole("button", { name: /Edit Quantity for Cement plaster, currently Pending/ })).toBeInTheDocument();
    expect(within(b).getByText("Quantity pending")).toBeInTheDocument();
    expect(within(b).getAllByRole("cell")[6]).toHaveTextContent("—"); // no amount for a pending quantity
  });

  it("links a line to its source drawing and page", () => {
    renderTable();
    const link = screen.getByRole("link", { name: "Open source drawing GF Plan, page 3" });
    expect(link).toHaveAttribute("href", "/drawings?document=d1&page=3");
    expect(within(bodyRows()[1]).getByText("No source")).toBeInTheDocument();
  });
});

describe("BoqTable — search, filters, sort", () => {
  it("searches, filters by section and status, and clears", () => {
    renderTable();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search BOQ lines" }), { target: { value: "plaster" } });
    expect(descriptions()).toEqual(["Cement plaster"]);
    expect(screen.getByText("Showing 1 of 3 lines")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Section" }), { target: { value: "Unassigned" } });
    expect(descriptions()).toEqual(["Door D1"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Section" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "pending" } });
    expect(descriptions()).toEqual(["Cement plaster"]);
  });

  it("says when no line matches", () => {
    renderTable();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search BOQ lines" }), { target: { value: "zzz" } });
    expect(screen.getByText("No lines match these filters.")).toBeInTheDocument();
  });

  it("sorts by a column ascending, then descending, then back to BOQ order, with aria-sort", () => {
    renderTable();
    const header = () => screen.getByRole("columnheader", { name: /Description/ });
    fireEvent.click(within(header()).getByRole("button"));
    expect(header()).toHaveAttribute("aria-sort", "ascending");
    expect(descriptions()).toEqual(["Brick wall", "Cement plaster", "Door D1"]);
    fireEvent.click(within(header()).getByRole("button"));
    expect(header()).toHaveAttribute("aria-sort", "descending");
    expect(descriptions()).toEqual(["Door D1", "Cement plaster", "Brick wall"]);
    fireEvent.click(within(header()).getByRole("button"));
    expect(header()).not.toHaveAttribute("aria-sort");
  });
});

describe("BoqTable — inline editing", () => {
  const openQty = () => fireEvent.click(screen.getByRole("button", { name: /Edit Quantity for Brick wall/ }));
  const qtyInput = () => screen.getByRole("textbox", { name: "Quantity for Brick wall" });

  it("saves on Enter with the exact patch", async () => {
    const onSave = renderTable();
    openQty();
    fireEvent.change(qtyInput(), { target: { value: "12.5" } });
    await act(async () => { fireEvent.keyDown(qtyInput(), { key: "Enter" }); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), { qty: 12.5 });
    expect(screen.queryByRole("textbox", { name: "Quantity for Brick wall" })).toBeNull();
  });

  it("Escape cancels and never saves — not even on the blur that follows", async () => {
    const onSave = renderTable();
    openQty();
    const input = qtyInput();
    fireEvent.change(input, { target: { value: "99" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" });
      fireEvent.blur(input);
    });
    expect(onSave).not.toHaveBeenCalled();
    const cellButton = screen.getByRole("button", { name: /Edit Quantity for Brick wall, currently 10$/ });
    expect(cellButton).toHaveFocus();
  });

  it("saves on blur, and only once when Enter is followed by a blur", async () => {
    const onSave = renderTable();
    fireEvent.click(screen.getByRole("button", { name: /Edit Unit for Brick wall/ }));
    const input = screen.getByRole("textbox", { name: "Unit for Brick wall" });
    fireEvent.change(input, { target: { value: "m3" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.blur(input);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), { unit: "m3" });
  });

  it("rejects invalid input without saving", async () => {
    const onSave = renderTable();
    openQty();
    fireEvent.change(qtyInput(), { target: { value: "-3" } });
    await act(async () => { fireEvent.keyDown(qtyInput(), { key: "Enter" }); });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Quantity cannot be negative.");
    expect(qtyInput()).toHaveAttribute("aria-invalid", "true");
  });

  it("does not write when the value is unchanged", async () => {
    const onSave = renderTable();
    openQty();
    await act(async () => { fireEvent.keyDown(qtyInput(), { key: "Enter" }); });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps the editor open with an error when the save fails", async () => {
    const onSave = renderTable(vi.fn(async () => false));
    openQty();
    fireEvent.change(qtyInput(), { target: { value: "11" } });
    await act(async () => { fireEvent.keyDown(qtyInput(), { key: "Enter" }); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save");
    expect(qtyInput()).toHaveValue("11");
  });

  it("confirms a pending line through the shared quantity rule", async () => {
    const onSave = renderTable(undefined, [L({ id: "p", qty: 0, quantity_status: "PENDING", measurement_method: "COUNT" })]);
    fireEvent.click(screen.getByRole("button", { name: /Edit Quantity/ }));
    const input = screen.getByRole("textbox", { name: "Quantity for Brick wall" });
    fireEvent.change(input, { target: { value: "6" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(onSave).toHaveBeenCalledWith(expect.anything(), { qty: 6, basis: null, quantity_status: "COUNTED" });
  });
});
