// @vitest-environment node
import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { loadTextPages, runPipeline } from "./pipeline";

const CASES = (process.env.ACC_CASES ?? "").split(";").filter(Boolean).map((c) => c.split("="));
it("baseline", async () => {
  const report: Record<string, unknown> = {};
  for (const [id, path] of CASES) {
    const pages = await loadTextPages(path, id);
    const { inventory, recon, quantities } = runPipeline(pages);
    const kinds: Record<string, number> = {};
    for (const c of inventory.candidates) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
    report[id] = {
      pages: pages.length, textPages: pages.filter((p) => p.textLayer === "available").length, kinds,
      rooms: recon.rooms.length,
      roomStatus: recon.rooms.reduce((a: Record<string, number>, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {}),
      unmatchedDims: recon.unmatchedDimensions.length,
      quantities: quantities.reduce((a: Record<string, number>, q) => ((a[q.status] = (a[q.status] ?? 0) + 1), a), {}),
      pendingReasons: quantities.filter((q) => q.status === "pending").reduce((a: Record<string, number>, q) => { const k = (q.pendingReason ?? "").replace(/"[^"]*"/g, '"…"').slice(0, 70); a[k] = (a[k] ?? 0) + 1; return a; }, {}),
      samples: {
        length_annotation: inventory.candidates.filter((c) => c.kind === "length_annotation").slice(0, 12).map((c) => c.text),
        room_dimension: inventory.candidates.filter((c) => c.kind === "room_dimension").slice(0, 12).map((c) => c.text),
        ready: quantities.filter((q) => q.status === "ready").slice(0, 8).map((q) => `${q.description} = ${q.quantity} ${q.unit} (${q.provenance.dimension?.text})`),
      },
    };
  }
  writeFileSync(process.env.ACC_OUT!, JSON.stringify(report, null, 1));
}, 600000);

it("dump ready quantities", async () => {
  if (!process.env.ACC_DUMP) return;
  const [id, path] = process.env.ACC_DUMP.split("=");
  const pages = await loadTextPages(path, id);
  const { inventory, quantities } = runPipeline(pages);
  const titles = inventory.candidates.filter((c) => c.kind === "sheet_title").map((c) => ({ page: c.page, text: c.text }));
  writeFileSync(process.env.ACC_OUT!, JSON.stringify({ titles, quantities: quantities.map((q) => ({ page: q.provenance.page, floor: q.provenance.floor, label: q.provenance.label.text, labelBox: q.provenance.label.box, dim: q.provenance.dimension?.text ?? null, dimBox: q.provenance.dimension?.box ?? null, status: q.status, quantity: q.quantity, reason: q.pendingReason ?? q.provenance.reconciliation.reason })) }, null, 1));
}, 600000);

