// Blind dimension review app (offline). Reads ONLY window.REVIEW_ITEMS (items.js): item ids, crop
// windows and the neutral text marker. It holds no engine output. Answers stay in this browser
// (localStorage) until exported as JSON or CSV in the cunstruct.review-response.v1 shape.
(() => {
  "use strict";
  const P = window.REVIEW_ITEMS, NS = "http://www.w3.org/2000/svg", $ = (id) => document.getElementById(id);
  const KEY = `cunstruct-review:${P.drawing.sha256}:${P.reviewer_id}`;
  const END_TYPES = ["", "grid", "wall-face", "column-face", "opening-edge", "slab-or-floor-edge", "stair", "other-drawn-edge", "other", "cannot-tell"];
  for (const id of ["end1_type", "end2_type"]) $(id).innerHTML = END_TYPES.map((t) => `<option value="${t}">${t || "(end type)"}</option>`).join("");
  let store = {};
  try { store = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { store = {}; }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { $("status").textContent = "Browser storage unavailable: export often."; } };
  $("who").textContent = `Reviewer ${P.reviewer_id} · ${P.drawing.file}`;
  const items = P.items;
  let cur = 0, placing = null, vb = { x: 0, y: 0, w: 100, h: 100 };
  const svg = $("view");
  const el = (t, a, p = svg) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); p.appendChild(n); return n; };
  const r1 = (v) => Math.round(v * 10) / 10;

  const REQUIRED = ["is_dimension", "evidence_sufficient", "ambiguous", "confidence"];
  const status = (a) => (!a ? "" : REQUIRED.every((k) => a[k]) ? "ok" : "part");
  function list() {
    $("list").innerHTML = items.map((it, i) => { const s = status(store[it.item_id]); return `<li data-i="${i}" class="${i === cur ? "sel" : ""}"><span>${it.item_id}</span><span class="${s}">${s === "ok" ? "✓" : s === "part" ? "…" : ""}</span></li>`; }).join("");
    const done = items.filter((it) => status(store[it.item_id]) === "ok").length;
    $("progress").textContent = `${done} / ${items.length} complete`;
  }
  $("list").onclick = (e) => { const li = e.target.closest("li"); if (li) go(Number(li.dataset.i)); };

  function draw() {
    const it = items[cur], a = store[it.item_id] || {};
    svg.innerHTML = "";
    const c = it.context, k = it.crop;
    if (c) el("image", { href: c.file, x: c.x0, y: c.y0, width: c.w, height: c.h, preserveAspectRatio: "none" });
    el("image", { href: k.file, x: k.x0, y: k.y0, width: k.w, height: k.h, preserveAspectRatio: "none" });
    el("rect", { x: k.x0, y: k.y0, width: k.w, height: k.h, fill: "none", stroke: "#999", "stroke-width": vb.w / 800, "stroke-dasharray": `${vb.w / 150} ${vb.w / 150}` });
    const s = vb.w / svg.clientWidth;
    const pt = (p, color, lbl) => { el("line", { x1: p[0] - 9 * s, y1: p[1], x2: p[0] + 9 * s, y2: p[1], stroke: color, "stroke-width": 2 * s }); el("line", { x1: p[0], y1: p[1] - 9 * s, x2: p[0], y2: p[1] + 9 * s, stroke: color, "stroke-width": 2 * s }); const t = el("text", { x: p[0] + 6 * s, y: p[1] - 6 * s, fill: color, "font-size": 12 * s }); t.textContent = lbl; };
    if (a.la && a.lb) el("line", { x1: a.la[0], y1: a.la[1], x2: a.lb[0], y2: a.lb[1], stroke: "var(--lin)", "stroke-width": 1.5 * s, "stroke-dasharray": `${4 * s} ${3 * s}` });
    if (a.la) pt(a.la, "#00a050", "A"); if (a.lb) pt(a.lb, "#00a050", "B");
    if (a.end1) pt(a.end1, "#0050ff", "1"); if (a.end2) pt(a.end2, "#0050ff", "2");
  }
  const setVB = () => { svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`); draw(); };
  const fitBox = (x0, y0, w, h) => { const r = svg.clientWidth / Math.max(1, svg.clientHeight); if (w / h > r) { const nh = w / r; y0 -= (nh - h) / 2; h = nh; } else { const nw = h * r; x0 -= (nw - w) / 2; w = nw; } vb = { x: x0, y: y0, w, h }; setVB(); };
  const fitItem = () => { const k = items[cur].crop; fitBox(k.x0, k.y0, k.w, k.h); };
  $("fit").onclick = fitItem;
  $("wide").onclick = () => { const c = items[cur].context || items[cur].crop; fitBox(c.x0, c.y0, c.w, c.h); };
  const zoom = (f, cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2) => { vb = { x: cx - (cx - vb.x) * f, y: cy - (cy - vb.y) * f, w: vb.w * f, h: vb.h * f }; setVB(); };
  $("zin").onclick = () => zoom(0.7); $("zout").onclick = () => zoom(1 / 0.7);
  const toPt = (e) => { const r = svg.getBoundingClientRect(); return [vb.x + ((e.clientX - r.left) / r.width) * vb.w, vb.y + ((e.clientY - r.top) / r.height) * vb.h]; };
  svg.addEventListener("wheel", (e) => { e.preventDefault(); const [x, y] = toPt(e); zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, x, y); }, { passive: false });
  svg.addEventListener("mousemove", (e) => { const [x, y] = toPt(e); $("coordhint").textContent = `x ${r1(x)}  y ${r1(y)} pt`; });
  let drag = null, moved = false;
  svg.addEventListener("mousedown", (e) => { drag = { x: e.clientX, y: e.clientY, vb: { ...vb } }; moved = false; });
  window.addEventListener("mousemove", (e) => { if (!drag) return; if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) moved = true; if (!moved) return; const s = vb.w / svg.clientWidth; vb = { ...drag.vb, x: drag.vb.x - (e.clientX - drag.x) * s, y: drag.vb.y - (e.clientY - drag.y) * s }; setVB(); });
  window.addEventListener("mouseup", (e) => {
    if (drag && !moved && placing && e.target.closest && e.target.closest("#view")) {
      const a = (store[items[cur].item_id] ||= {});
      a[placing] = toPt(e).map(r1); persist(); showCoords(); draw();
      placing = null; svg.classList.remove("placing"); document.querySelectorAll("[data-place]").forEach((b) => b.classList.remove("on"));
    }
    drag = null;
  });
  document.querySelectorAll("[data-place]").forEach((b) => (b.onclick = () => { placing = b.dataset.place; svg.classList.add("placing"); document.querySelectorAll("[data-place]").forEach((x) => x.classList.toggle("on", x === b)); }));
  const fmt = (p) => (p ? `(${p[0]}, ${p[1]})` : "—");
  const showCoords = () => { const a = store[items[cur].item_id] || {}; $("coords").innerHTML = `End 1 ${fmt(a.end1)} · End 2 ${fmt(a.end2)}<br>Line A ${fmt(a.la)} · Line B ${fmt(a.lb)}`; };
  $("clearpts").onclick = () => { const a = store[items[cur].item_id]; if (a) { delete a.end1; delete a.end2; delete a.la; delete a.lb; persist(); } showCoords(); draw(); };

  const radios = ["is_dimension", "ambiguous", "evidence_sufficient", "confidence"], fields = ["printed_value", "unit", "end1_type", "end2_type", "element_end1", "element_end2", "ambiguity_note", "explanation"];
  function loadForm() {
    const it = items[cur], a = store[it.item_id] || {};
    $("itemhead").textContent = `${it.item_id} · page ${it.page} · ring at (${it.marker_pt[0]}, ${it.marker_pt[1]}) pt`;
    for (const r of radios) document.querySelectorAll(`input[name=${r}]`).forEach((x) => (x.checked = a[r] === x.value));
    for (const f of fields) $(f).value = a[f] ?? "";
    showCoords(); $("status").textContent = "";
  }
  function readForm() {
    const a = (store[items[cur].item_id] ||= {});
    for (const r of radios) a[r] = document.querySelector(`input[name=${r}]:checked`)?.value ?? "";
    for (const f of fields) a[f] = $(f).value;
    a.reviewed_at = new Date().toISOString();
    persist();
    return a;
  }
  function check(a) {
    const e = REQUIRED.filter((k) => !a[k]).map((k) => `${k} is required`);
    if (a.is_dimension === "yes" && a.evidence_sufficient === "yes" && a.ambiguous === "no") {
      if (a.printed_value === "") e.push("printed value is required for a determinable dimension");
      if (!a.end1 || !a.end2) e.push("place End 1 and End 2");
      if (!a.end1_type || !a.end2_type) e.push("give both end types");
    }
    if (a.ambiguous === "yes" && !a.ambiguity_note) e.push("say why it is ambiguous");
    return e;
  }
  $("save").onclick = () => { const a = readForm(), e = check(a); list(); if (e.length) { $("status").innerHTML = `<span class="err">${e.join("; ")}</span>`; return; } go(cur + 1); };
  for (const f of fields) $(f).addEventListener("change", readForm);
  for (const r of radios) document.querySelectorAll(`input[name=${r}]`).forEach((x) => x.addEventListener("change", () => { readForm(); list(); }));

  function go(i) { if (i < 0 || i >= items.length) return; cur = i; list(); loadForm(); fitItem(); }
  $("prev").onclick = () => go(cur - 1); $("next").onclick = () => go(cur + 1);

  // export in the response schema
  const num = (v) => (v === "" || v == null ? null : Number(v));
  const toResponse = (it) => {
    const a = store[it.item_id];
    if (status(a) !== "ok") return null; // only complete answers are exported; partial ones stay in the browser
    const both = a.end1_type && a.end2_type;
    return {
      schema: "cunstruct.review-response.v1", item_id: it.item_id, reviewer_id: P.reviewer_id, reviewed_at: a.reviewed_at || new Date().toISOString(),
      is_dimension: a.is_dimension, printed_value: num(a.printed_value), unit: a.unit || null,
      line: a.la && a.lb ? { a: a.la, b: a.lb } : null, endpoints: a.end1 && a.end2 ? [a.end1, a.end2] : null,
      measured_element: both ? { end1: a.element_end1 || "", end2: a.element_end2 || "", end1_type: a.end1_type, end2_type: a.end2_type } : null,
      evidence_sufficient: a.evidence_sufficient, ambiguous: a.ambiguous, ambiguity_note: a.ambiguity_note || "", confidence: a.confidence, explanation: a.explanation || "",
    };
  };
  const download = (name, text, type) => { const x = document.createElement("a"); x.href = URL.createObjectURL(new Blob([text], { type })); x.download = name; x.click(); setTimeout(() => URL.revokeObjectURL(x.href), 1000); };
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "");
  const incompleteNote = () => { const n = items.filter((it) => status(store[it.item_id]) === "part").length; $("status").textContent = n ? `${n} incomplete answer(s) were not exported — finish them first.` : "Exported."; };
  $("xjson").onclick = () => { incompleteNote(); download(`review-${P.reviewer_id}-${stamp()}.json`, JSON.stringify({ schema: "cunstruct.review-responses.v1", reviewer_id: P.reviewer_id, drawing: P.drawing, responses: items.map(toResponse).filter(Boolean) }, null, 1), "application/json"); };
  $("xcsv").onclick = () => {
    const cols = ["item_id", "reviewer_id", "reviewed_at", "page", "marker_x", "marker_y", "is_dimension", "printed_value", "unit", "line_a_x", "line_a_y", "line_b_x", "line_b_y", "end1_x", "end1_y", "end2_x", "end2_y", "element_kind", "end1_type", "element_end1", "end2_type", "element_end2", "evidence_sufficient", "ambiguous", "ambiguity_note", "confidence", "explanation"];
    const cell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    incompleteNote();
    const rows = items.map((it) => { const a = status(store[it.item_id]) === "ok" ? store[it.item_id] : {}; const v = { item_id: it.item_id, reviewer_id: P.reviewer_id, reviewed_at: a.reviewed_at, page: it.page, marker_x: it.marker_pt[0], marker_y: it.marker_pt[1], ...a,
      line_a_x: a.la?.[0], line_a_y: a.la?.[1], line_b_x: a.lb?.[0], line_b_y: a.lb?.[1], end1_x: a.end1?.[0], end1_y: a.end1?.[1], end2_x: a.end2?.[0], end2_y: a.end2?.[1] };
      return cols.map((c) => cell(v[c])).join(","); });
    download(`review-${P.reviewer_id}-${stamp()}.csv`, [cols.join(","), ...rows].join("\n") + "\n", "text/csv");
  };
  $("ximport").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j.reviewer_id !== P.reviewer_id) throw new Error(`file is for reviewer ${j.reviewer_id}`);
      for (const r of j.responses) store[r.item_id] = { is_dimension: r.is_dimension, printed_value: r.printed_value ?? "", unit: r.unit ?? "", la: r.line?.a, lb: r.line?.b, end1: r.endpoints?.[0], end2: r.endpoints?.[1],
        end1_type: r.measured_element?.end1_type ?? "", end2_type: r.measured_element?.end2_type ?? "", element_end1: r.measured_element?.end1 ?? "", element_end2: r.measured_element?.end2 ?? "",
        evidence_sufficient: r.evidence_sufficient, ambiguous: r.ambiguous, ambiguity_note: r.ambiguity_note, confidence: r.confidence, explanation: r.explanation, reviewed_at: r.reviewed_at };
      persist(); go(cur); $("status").textContent = `imported ${j.responses.length}`;
    } catch (err) { $("status").innerHTML = `<span class="err">import failed: ${err.message}</span>`; }
  };
  window.addEventListener("keydown", (e) => { if (e.target.matches("input,textarea,select")) return; if (e.key === "ArrowRight") go(cur + 1); if (e.key === "ArrowLeft") go(cur - 1); });
  window.addEventListener("resize", setVB);
  const first = items.findIndex((it) => status(store[it.item_id]) !== "ok");
  go(first < 0 ? 0 : first);
  window.__review = { items, store: () => store, go };
})();
