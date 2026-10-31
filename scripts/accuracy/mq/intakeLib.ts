// PDF intake diagnostic (read-only). Reports structure only; it does NOT show that hidden layers,
// CAD metadata or transforms are handled correctly by the engine — only that they are present.
import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { classifyDocument, classifyPage, type DocClass, type PageClass } from "@/lib/measurement-quality/intakeClassify";

const { OPS } = pdfjs;
type M = [number, number, number, number, number, number];
const mul = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const isM = (x: unknown): x is M => Array.isArray(x) && x.length === 6 && x.every((v) => typeof v === "number");

export interface PageIntake {
  page: number;
  size_pt: [number, number];
  rotation: number;
  text_runs: number;
  text_chars: number;
  numeric_texts: number;
  vector_paths: number;
  vector_segments: number;
  images: { px: [number, number]; shown_pt: [number, number]; dpi: number; page_cover: number }[];
  transforms: number;
  max_save_depth: number;
  rotated_or_skewed_ctm: number;
  form_xobjects: number;
  marked_content_oc: number;
  scale_notes: string[];
  class: PageClass;
}
export interface DocIntake {
  file: string;
  sha256: string;
  pages: number;
  producer: string | null;
  creator: string | null;
  pdf_version: string | null;
  optional_content_groups: number;
  page_reports: PageIntake[];
  class: DocClass;
  suitable_for_vector_measurement_validation: boolean;
  reasons: string[];
  caveats: string[];
}

export async function intakePdf(path: string, sha: string, opts: { outOfDomain?: boolean; maxPages?: number } = {}): Promise<DocIntake> {
  const data = new Uint8Array(readFileSync(path));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  const meta = await doc.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as Record<string, unknown>;
  let ocg = 0;
  try { const cfg = await doc.getOptionalContentConfig(); ocg = [...(cfg as unknown as Iterable<unknown>)].length; } catch { ocg = 0; }
  const pages: PageIntake[] = [];
  const last = Math.min(doc.numPages, opts.maxPages ?? doc.numPages);
  for (let n = 1; n <= last; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const area = vp.width * vp.height;
    const text = await page.getTextContent();
    const items = text.items.filter((i): i is typeof i & { str: string } => "str" in i && i.str.trim().length > 0);
    const ops = await page.getOperatorList();
    let ctm: M = [1, 0, 0, 1, 0, 0];
    const stack: M[] = [];
    const r: Omit<PageIntake, "class" | "scale_notes"> = {
      page: n, size_pt: [Math.round(vp.width), Math.round(vp.height)], rotation: page.rotate, text_runs: items.length,
      text_chars: items.reduce((s, i) => s + i.str.length, 0), numeric_texts: items.filter((i) => /^\s*\d{2,6}\s*$/.test(i.str)).length,
      vector_paths: 0, vector_segments: 0, images: [], transforms: 0, max_save_depth: 0, rotated_or_skewed_ctm: 0, form_xobjects: 0, marked_content_oc: 0,
    };
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], args = ops.argsArray[i] as unknown[];
      if (fn === OPS.save) { stack.push(ctm); r.max_save_depth = Math.max(r.max_save_depth, stack.length); }
      else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
      else if (fn === OPS.transform && isM(args)) {
        ctm = mul(ctm, args); r.transforms++;
        if (Math.abs(ctm[1]) > 1e-6 || Math.abs(ctm[2]) > 1e-6) r.rotated_or_skewed_ctm++;
      } else if (fn === OPS.paintFormXObjectBegin) { r.form_xobjects++; stack.push(ctm); if (isM(args?.[0])) ctm = mul(ctm, args[0] as M); }
      else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
      else if (fn === OPS.constructPath) {
        r.vector_paths++;
        const sub = args?.[0];
        r.vector_segments += Array.isArray(sub) ? sub.filter((o) => o === OPS.lineTo || o === OPS.curveTo || o === OPS.curveTo2 || o === OPS.curveTo3 || o === OPS.rectangle).length : 1;
      } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
        const a0 = args?.[0] as { width?: number; height?: number } | string | undefined;
        const w = typeof args?.[1] === "number" ? (args[1] as number) : typeof a0 === "object" && a0 ? a0.width ?? 0 : 0;
        const h = typeof args?.[2] === "number" ? (args[2] as number) : typeof a0 === "object" && a0 ? a0.height ?? 0 : 0;
        const sw = Math.hypot(ctm[0], ctm[1]), sh = Math.hypot(ctm[2], ctm[3]);
        r.images.push({ px: [w, h], shown_pt: [Math.round(sw), Math.round(sh)], dpi: sw > 0 && w > 0 ? Math.round((w / sw) * 72) : 0, page_cover: Math.min(1, (sw * sh) / area) });
      } else if (fn === OPS.beginMarkedContentProps && args?.[0] === "OC") r.marked_content_oc++;
    }
    const notes = [...new Set(items.map((i) => i.str).filter((s) => /\b1\s*:\s*\d{1,4}\b/.test(s) && /scale|1\s*:\s*(5|10|20|25|50|75|100|125|150|200|250|500|1000)\b/i.test(s)).map((s) => s.trim()))].slice(0, 12);
    pages.push({ ...r, scale_notes: notes, class: classifyPage(r) });
    page.cleanup();
  }
  await doc.destroy();
  const dc = classifyDocument(pages.map((p) => p.class), Boolean(opts.outOfDomain));
  const caveats = ["Detection of transforms, optional content (OCG) or CAD metadata does not mean the engine handles them correctly."];
  if (ocg || pages.some((p) => p.marked_content_oc)) caveats.push(`Optional content present (${ocg} groups): visibility per intent must be checked; the text API carries no OCG id.`);
  if (pages.some((p) => p.rotated_or_skewed_ctm)) caveats.push("Rotated or skewed transforms present: geometry and text must be checked to agree in page space.");
  if (pages.some((p) => p.rotation)) caveats.push("Page rotation present.");
  if (pages.some((p) => new Set(p.scale_notes.map((s) => /1\s*:\s*(\d+)/.exec(s)?.[1])).size > 1)) caveats.push("More than one scale note on a sheet: per-viewport scale variation likely.");
  const suitable = dc.class === "native-vector" && pages.some((p) => p.numeric_texts >= 20);
  return {
    file: path.split("/").pop()!, sha256: sha, pages: doc.numPages, producer: (info.Producer as string) ?? null, creator: (info.Creator as string) ?? null,
    pdf_version: (info.PDFFormatVersion as string) ?? null, optional_content_groups: ocg, page_reports: pages, class: dc.class,
    suitable_for_vector_measurement_validation: suitable,
    reasons: [...dc.reasons, suitable ? "native vector with numeric text on at least one page (>= 20 short numeric runs)" : "not suitable: needs native-vector pages carrying numeric dimension text"],
    caveats,
  };
}
