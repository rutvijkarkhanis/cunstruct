import { describe, it, expect, vi, afterEach } from "vitest";
import {
  computeCommercials, amountInWords, buildBoqCsv, buildProjectQuoteHtml, buildDsrQuoteHtml, openQuoteWindow, QUOTE_WINDOW_LOADING_TEXT,
  type ProjectQuoteBoq, type DsrQuotePayload, type QuoteSubHead, type QuoteItem, type CsvRow,
} from "./boqDsrDocument";

describe("computeCommercials (CPWD abstract)", () => {
  it("applies cost index, contingency, overhead, cess, then GST in order", () => {
    const c = computeCommercials(100000, {
      costIndexPct: 10, contingencyPct: 3, overheadPct: 15, cessPct: 1, gstPct: 18,
    });
    expect(c.costIndexAmt).toBe(10000);       // 10% of 100000
    expect(c.worksAdjusted).toBe(110000);
    expect(c.contingencyAmt).toBe(3300);      // 3% of 110000
    expect(c.overheadAmt).toBe(16500);        // 15% of 110000
    expect(c.subTotal).toBe(129800);          // 110000 + 3300 + 16500
    expect(c.cessAmt).toBe(1298);             // 1% of 129800
    expect(c.gstAmt).toBe(23598);             // round(18% of 131098) = round(23597.64)
    expect(c.grandTotal).toBe(154696);
  });

  // The bug the rounding strategy fixes: the parts the reader sees must sum EXACTLY
  // to the total the reader sees. Every amount is a whole rupee and the grand total
  // equals the sum of the rounded stages — no sum-of-rounded-parts ≠ rounded-sum drift.
  it("every amount is a whole rupee and the stages sum exactly to the grand total", () => {
    // 41785.4 is deliberately fractional so full-precision math would drift by ₹1.
    const c = computeCommercials(41785.4, {
      costIndexPct: 0, contingencyPct: 3, overheadPct: 15, cessPct: 1, gstPct: 18,
    });
    for (const v of [c.works, c.costIndexAmt, c.contingencyAmt, c.overheadAmt, c.cessAmt, c.gstAmt, c.grandTotal]) {
      expect(Number.isInteger(v)).toBe(true);
    }
    const sumOfStages =
      c.works + c.costIndexAmt + c.contingencyAmt + c.overheadAmt + c.cessAmt + c.gstAmt;
    expect(sumOfStages).toBe(c.grandTotal);          // what you see adds up
    expect(c.subTotal).toBe(c.worksAdjusted + c.contingencyAmt + c.overheadAmt);
  });

  it("with all extras zero, reduces to works value (rounded)", () => {
    const c = computeCommercials(50000, { costIndexPct: 0, contingencyPct: 0, overheadPct: 0, cessPct: 0, gstPct: 0 });
    expect(c.grandTotal).toBe(50000);
  });
});

describe("buildBoqCsv", () => {
  const meta = { boqName: "Test", project: "P1", generatedOn: "1 Jan 2026" };

  it("emits a header and a live Excel amount formula per priced row", () => {
    const csv = buildBoqCsv([
      { subhead: "4.00 RCC", itemNo: "4.01", code: "5.3", spec: "RCC M-20, cement, sand, aggregate", unit: "cum", qty: 13.4, rate: 11505 },
    ], meta);
    const lines = csv.split("\r\n");
    expect(lines[3]).toContain("Your rate");
    // first data row is spreadsheet line 5 → Amount = Qty(F) × Your rate(H)
    expect(lines[4]).toContain("=F5*H5");
    // a spec with commas is quoted
    expect(lines[4]).toContain('"RCC M-20, cement, sand, aggregate"');
  });

  it("leaves amount blank for Non-Schedule (unpriced) items", () => {
    const csv = buildBoqCsv([
      { subhead: "Electrical", itemNo: "1.01", code: null, spec: "Wiring points", unit: "point", qty: 30, rate: null },
    ], meta);
    const cols = csv.split("\r\n")[4].split(",");
    expect(cols[8]).toBe("");   // Amount column (9th) empty — no formula
  });

  // ── Scope H — drawing-source traceability in the CSV/Excel export ──────────

  it("Scope H: appends Source Document / Source Page AFTER the existing 9 columns, formula untouched", () => {
    // spec deliberately comma-free here so a plain split(",") on the data row lines
    // up with real column indices (the header is checked with toContain).
    const csv = buildBoqCsv([
      { subhead: "4.00 RCC", itemNo: "4.01", code: "5.3", spec: "RCC M20 concrete", unit: "cum", qty: 13.4, rate: 11505, sourceDocument: "Floor 1 Plan", sourcePage: "3" },
    ], meta);
    const lines = csv.split("\r\n");
    expect(lines[3]).toContain("Source Document");
    expect(lines[3]).toContain("Source Page");
    const cols = lines[4].split(",");
    expect(cols[9]).toBe("Floor 1 Plan");
    expect(cols[10]).toBe("3");
    // the Amount formula (column I) is byte-identical to before Scope H — the new
    // columns are strictly additive, never shifting F/H
    expect(lines[4]).toContain("=F5*H5");
  });

  it("Scope H: a source_document_id that could not be resolved to a name never shows a bare page number", () => {
    const csv = buildBoqCsv([
      { subhead: "4.00 RCC", itemNo: "4.01", code: null, spec: "Item", unit: "cum", qty: 1, rate: 100, sourceDocument: "Source document unavailable", sourcePage: null },
    ], meta);
    const cols = csv.split("\r\n")[4].split(",");
    expect(cols[9]).toBe("Source document unavailable");
    expect(cols[10]).toBe("");
  });

  it("Scope H: no-provenance baseline — both new columns are blank, never fabricated, when no source is known", () => {
    const csv = buildBoqCsv([
      { subhead: "4.00 RCC", itemNo: "4.01", code: null, spec: "Item", unit: "cum", qty: 1, rate: 100 },
    ], meta);
    const cols = csv.split("\r\n")[4].split(",");
    expect(cols[9]).toBe("");
    expect(cols[10]).toBe("");
  });

  it("Scope H: a long source document name with commas/dashes is quoted per the existing CSV escaping convention", () => {
    const longName = "Floor 1, Block A — Structural Drawing (Revision Set, Final).pdf";
    const csv = buildBoqCsv([
      { subhead: "4.00 RCC", itemNo: "4.01", code: null, spec: "Item", unit: "cum", qty: 1, rate: 100, sourceDocument: longName, sourcePage: "12" },
    ], meta);
    expect(csv).toContain(`"${longName}"`);
  });

  it("Scope H: does not mutate its input rows", () => {
    const rows: CsvRow[] = [
      { subhead: "4.00 RCC", itemNo: "4.01", code: "5.3", spec: "RCC M-20", unit: "cum", qty: 13.4, rate: 11505, sourceDocument: "Floor 1 Plan", sourcePage: "3" },
    ];
    const before = JSON.parse(JSON.stringify(rows));
    buildBoqCsv(rows, meta);
    expect(rows).toEqual(before);
  });
});

describe("buildDsrQuoteHtml — drawing-source traceability (Scope H)", () => {
  const mkLine = (over: Partial<QuoteItem>): QuoteItem => ({
    no: "1.01", code: null, spec: "Item", qty: 1, unit: "nos", rate: 100, amount: 100, ...over,
  });
  const mkSubhead = (lines: QuoteItem[]): QuoteSubHead => ({
    no: 1, name: "Works", subtotal: lines.reduce((s, l) => s + (l.amount ?? 0), 0), lines,
  });
  const payload = (subheads: QuoteSubHead[]): DsrQuotePayload => ({
    boqName: "Test BOQ", generatedOn: "1 Jan 2026", subheads,
    abstract: subheads.map((sh) => ({ no: sh.no, name: sh.name, amount: sh.subtotal })),
    commercials: computeCommercials(subheads.reduce((s, sh) => s + sh.subtotal, 0), {
      costIndexPct: 0, contingencyPct: 0, overheadPct: 0, cessPct: 0, gstPct: 18,
    }),
  });
  const render = (lines: QuoteItem[]) => buildDsrQuoteHtml(payload([mkSubhead(lines)]), { autoPrint: false });
  // The row for a given spec text, up to its closing </tr> — lets assertions check
  // what's actually attached to THAT line, not merely present anywhere in the page.
  const rowFor = (html: string, marker: string) => html.slice(html.indexOf(marker), html.indexOf("</tr>", html.indexOf(marker)));

  it("full provenance: shows the resolved document name and page together", () => {
    const html = render([mkLine({ sourceDocument: "Floor 1 Plan", sourcePage: "3" })]);
    expect(html).toContain("Floor 1 Plan");
    expect(html).toContain("p.3");
  });

  it("missing name: an unresolved source document never shows a bare page number", () => {
    const html = render([mkLine({ sourceDocument: "Source document unavailable", sourcePage: null })]);
    expect(html).toContain("Source document unavailable");
    expect(html).not.toContain("p.");
  });

  it("missing page: a resolved name with no page renders the name alone", () => {
    const html = render([mkLine({ sourceDocument: "Floor 2 Plan", sourcePage: null })]);
    const row = rowFor(html, "Floor 2 Plan");
    expect(row).toContain("Floor 2 Plan");
    expect(row).not.toContain("p.");
  });

  it("no-provenance baseline: a line with no sourceDocument renders no source annotation at all", () => {
    const html = render([mkLine({ sourceDocument: null, sourcePage: null })]);
    // the .srcref CSS rule is always present in <style>; what must never appear is
    // an actual <span class="srcref"> annotation on this line
    expect(html).not.toContain('<span class="srcref"');
  });

  it("never surfaces a revision label — the export carries no revision text anywhere", () => {
    const html = render([mkLine({ sourceDocument: "Floor 1 Plan", sourcePage: "3" })]);
    expect(html.toLowerCase()).not.toContain("revision");
    expect(html.toLowerCase()).not.toMatch(/\brev[. ]/);
  });

  it("multiple documents: each line shows only its own source, never another line's", () => {
    const html = render([
      mkLine({ no: "1.01", spec: "Item A", sourceDocument: "Floor 1 Plan", sourcePage: "2" }),
      mkLine({ no: "1.02", spec: "Item B", sourceDocument: "Floor 2 Plan", sourcePage: "5" }),
    ]);
    const rowA = rowFor(html, "Item A");
    const rowB = rowFor(html, "Item B");
    expect(rowA).toContain("Floor 1 Plan");
    expect(rowA).not.toContain("Floor 2 Plan");
    expect(rowB).toContain("Floor 2 Plan");
    expect(rowB).not.toContain("Floor 1 Plan");
  });

  it("special characters in a source document name are HTML-escaped, never injected raw", () => {
    const html = render([mkLine({ sourceDocument: `Plan <A & B> "v2"`, sourcePage: "1" })]);
    expect(html).not.toContain("<A & B>");
    expect(html).toContain("&lt;A &amp; B&gt;");
  });

  it("adding source fields is purely additive — the rate/amount cells render identically either way", () => {
    const withSource = render([mkLine({ rate: 250, amount: 250, sourceDocument: "Floor 1 Plan", sourcePage: "3" })]);
    const without = render([mkLine({ rate: 250, amount: 250 })]);
    const stripped = withSource.replace(/<span class="srcref">.*?<\/span>/, "");
    expect(stripped).toBe(without);
  });

  it("does not mutate its input payload", () => {
    const p = payload([mkSubhead([mkLine({ sourceDocument: "Floor 1 Plan", sourcePage: "3" })])]);
    const before = JSON.parse(JSON.stringify(p));
    buildDsrQuoteHtml(p, { autoPrint: false });
    expect(p).toEqual(before);
  });
});

describe("buildProjectQuoteHtml (combined client quote)", () => {
  const mkBoq = (name: string, scope: string, works: number): ProjectQuoteBoq => ({
    name, scope,
    subheads: [{ no: 1, name: "Works", subtotal: works, lines: [
      { no: "1.01", code: null, spec: `${name} item`, qty: 1, unit: "nos", rate: works, amount: works },
    ] }],
    commercials: computeCommercials(works, { costIndexPct: 0, contingencyPct: 0, overheadPct: 0, cessPct: 0, gstPct: 18 }),
  });
  const boqs = [mkBoq("Floor 1", "Floor 1", 100000), mkBoq("Terrace", "Terrace", 50000)];
  const base = { projectName: "Sample Apartment", clientName: "A. Client", generatedOn: "1 Sep 2026" } as const;

  it("firm version shows the firm letterhead and not the client-addressed line", () => {
    const html = buildProjectQuoteHtml({ ...base, branding: "firm", firmName: "The Grid Architects", firmTagline: "architects" }, boqs, { autoPrint: false });
    expect(html).toContain("The Grid Architects");
    expect(html).not.toContain("Prepared for:");
  });

  it("client version shows the client name and drops all firm branding", () => {
    const html = buildProjectQuoteHtml({ ...base, branding: "client", firmName: "The Grid Architects" }, boqs, { autoPrint: false });
    expect(html).toContain("Prepared for:");
    expect(html).toContain("A. Client");
    expect(html).not.toContain("The Grid Architects");   // no firm logo on the final
    expect(html).not.toMatch(/cun<span>/);               // no Cunstruct brand
  });

  it("renders each BOQ as a section and sums per-BOQ totals into a project grand total", () => {
    const html = buildProjectQuoteHtml({ ...base, branding: "firm" }, boqs, { autoPrint: false });
    expect(html).toContain("1. Floor 1");
    expect(html).toContain("2. Terrace");
    expect(html).toContain("Project grand total");
    // 100000*1.18 + 50000*1.18 = 118000 + 59000 = 177000
    expect(html).toContain("₹1,77,000");
  });
});

describe("amountInWords (Indian numbering)", () => {
  it("renders lakhs and crores", () => {
    expect(amountInWords(0)).toBe("Zero");
    expect(amountInWords(500)).toBe("Five Hundred");
    expect(amountInWords(154678)).toBe("One Lakh Fifty Four Thousand Six Hundred Seventy Eight");
    expect(amountInWords(12345678)).toBe("One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight");
  });
});

describe("pending items keep their schedule code (accepted DSR-check work)", () => {
  const pending = [{ no: "P.01", spec: "Centering and shuttering — Columns", unit: "sqm", code: "5.9.6", note: "Quantity pending: not yet measured", basis: "Awaiting quantity" }];
  it("CSV: the code fills the Code column; Qty, rates and amount stay blank", () => {
    const row = buildBoqCsv([], { boqName: "B", generatedOn: "1 Jan 2026" }, pending).split("\r\n").find((r) => r.startsWith("Pending,"));
    expect(row).toBe('Pending,P.01,5.9.6,Centering and shuttering — Columns — Quantity pending: not yet measured,sqm,,,,,,,Awaiting quantity');
  });
  it("PDF: the code is shown on the pending row, which still reads 'pending'", () => {
    const html = buildDsrQuoteHtml({
      boqName: "B", generatedOn: "1 Jan 2026", subheads: [], abstract: [], pendingItems: pending,
      commercials: computeCommercials(0, { costIndexPct: 0, contingencyPct: 0, overheadPct: 0, cessPct: 0, gstPct: 18 }),
    }, { autoPrint: false });
    const row = html.slice(html.indexOf("P.01"), html.indexOf("</tr>", html.indexOf("P.01")));
    expect(row).toContain("<b>5.9.6</b> Centering and shuttering — Columns");
    expect(row).toContain(">pending<");
  });
});

describe("combined project quote: pending rows keep their schedule code", () => {
  it("shows the code on a pending row, which still reads 'pending'", () => {
    const boq: ProjectQuoteBoq = {
      name: "B", subheads: [], pendingItems: [{ no: "P.01", spec: "Shuttering", unit: "sqm", code: "5.9.6", note: "Quantity pending: not yet measured" }],
      commercials: computeCommercials(0, { costIndexPct: 0, contingencyPct: 0, overheadPct: 0, cessPct: 0, gstPct: 18 }),
    };
    const html = buildProjectQuoteHtml({ projectName: "P", generatedOn: "1 Jan 2026", branding: "firm" }, [boq], { autoPrint: false });
    const row = html.slice(html.indexOf("P.01"), html.indexOf("</tr>", html.indexOf("P.01")));
    expect(row).toContain("<b>5.9.6</b> Shuttering");
    expect(row).toContain(">pending<");
  });
});

describe("abstract: a confirmed ₹0 sub-head is priced, not 'To be priced'", () => {
  const c0 = computeCommercials(0, { costIndexPct: 0, contingencyPct: 0, overheadPct: 0, cessPct: 0, gstPct: 18 });
  const abstractRow = (html: string, name: string) => {
    const i = html.indexOf(`<td>${name}</td>`);
    return html.slice(i, html.indexOf("</tr>", i));
  };
  it("every line has an amount of ₹0 (confirmed-zero quantities) → ₹0", () => {
    const html = buildDsrQuoteHtml({
      boqName: "B", generatedOn: "x", commercials: c0, abstract: [{ no: 1, name: "Skirting", amount: 0 }],
      subheads: [{ no: 1, name: "Skirting", subtotal: 0, lines: [{ no: "1.01", code: "6.4", spec: "s", qty: 0, unit: "m", rate: 50, amount: 0 }] }],
    }, { autoPrint: false });
    expect(abstractRow(html, "Skirting")).toContain("₹0");
    expect(abstractRow(html, "Skirting")).not.toContain("To be priced");
  });
  it("a line with no rate → 'To be priced'", () => {
    const html = buildDsrQuoteHtml({
      boqName: "B", generatedOn: "x", commercials: c0, abstract: [{ no: 1, name: "Tiles", amount: 0 }],
      subheads: [{ no: 1, name: "Tiles", subtotal: 0, lines: [{ no: "1.01", code: "11.1", spec: "s", qty: 4, unit: "sqm", rate: null, amount: null }] }],
    }, { autoPrint: false });
    expect(abstractRow(html, "Tiles")).toContain("To be priced");
  });
});

describe("openQuoteWindow — opened from the click, filled after the re-read", () => {
  afterEach(() => vi.restoreAllMocks());
  const fakeWindow = () => {
    const written: string[] = [];
    const doc = { open: vi.fn(), write: (h: string) => written.push(h), close: vi.fn() };
    return { w: { document: doc } as unknown as Window, written };
  };
  it("returns null when the pop-up is blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(openQuoteWindow()).toBeNull();
  });
  it("first says it is reading the latest BOQ, then shows the document", () => {
    const { w, written } = fakeWindow();
    vi.spyOn(window, "open").mockReturnValue(w);
    const qw = openQuoteWindow()!;
    expect(written[0]).toContain(QUOTE_WINDOW_LOADING_TEXT);
    qw.show({ boqName: "Fresh BOQ", generatedOn: "x", subheads: [], abstract: [], commercials: computeCommercials(0, { costIndexPct: 0, contingencyPct: 0, overheadPct: 0, cessPct: 0, gstPct: 18 }) }, { autoPrint: false });
    expect(written[1]).toContain("Fresh BOQ");
  });
  it("on failure replaces the loading text with the reason — no document", () => {
    const { w, written } = fakeWindow();
    vi.spyOn(window, "open").mockReturnValue(w);
    openQuoteWindow()!.fail("Could not re-read <lines>");
    expect(written[1]).toContain("Could not re-read &lt;lines&gt;");
    expect(written[1]).not.toContain(QUOTE_WINDOW_LOADING_TEXT);
  });
});
