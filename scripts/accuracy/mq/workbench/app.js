// Measurement evidence workbench (offline). Reads window.WB_DATA (data.js); draws only geometry that
// the engine output, the reference or the source drawing actually contain. Reviewer annotations are
// kept in localStorage and exported separately; they never modify engine data.
(() => {
  "use strict";
  const D = window.WB_DATA;
  const NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const fmt = (p) => (p ? `(${p[0].toFixed(1)}, ${p[1].toFixed(1)})` : "—");

  const all = D.pages.flatMap((p) => p.dims.map((d) => ({ ...d, view: d.reference ? d.reference.view : `page ${d.page} (view not named)` })));
  const pageOf = new Map(D.pages.map((p) => [p.page, p]));
  const regionOf = (d) => d.scaleCheck?.region ?? null;
  const stageOf = (d) => (d.failure ? d.failure.stage : "accepted");
  $("dataset").textContent = `${D.dataset.id} (${D.dataset.role}) · ${D.dataset.drawing} · engine ${D.engine.candidate_fingerprint.slice(0, 12)}… · reference: ${D.reference.type}`;

  // ── annotations (separate store) ─────────────────────────────────────────
  const AKEY = `cunstruct-wb-annotations-v1:${D.dataset.sha256}:${D.engine.candidate_fingerprint}`;
  let ann = {};
  try { ann = JSON.parse(localStorage.getItem(AKEY) || "{}"); } catch { ann = {}; }
  const saveStore = () => { try { localStorage.setItem(AKEY, JSON.stringify(ann)); } catch { /* storage unavailable: export to keep work */ } };
  try { $("a-reviewer").value = localStorage.getItem("cunstruct-wb-reviewer") || ""; } catch { /* ignore */ }

  // ── filters ──────────────────────────────────────────────────────────────
  const opts = (sel, values, label = (v) => v) => { $(sel).innerHTML = `<option value="">all</option>` + values.map((v) => `<option value="${esc(v)}">${esc(label(v))}</option>`).join(""); };
  const uniq = (f) => [...new Set(all.map(f))].filter((v) => v !== null && v !== undefined).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  opts("f-page", uniq((d) => d.page));
  opts("f-view", uniq((d) => d.view));
  opts("f-status", ["acceptable", "hold", "reject"]);
  opts("f-stage", ["accepted", "line", "endpoints", "association", "scale", "cross-check", "unit", "unknown"]);
  opts("f-reason", uniq((d) => d.failure?.primary), (v) => `${v} — ${D.failureCategories[v] ?? ""}`);
  opts("f-measures", [...uniq((d) => d.association?.measures ?? "none")]);
  opts("f-orient", uniq((d) => d.orientation));
  opts("f-region", uniq((d) => (regionOf(d) ? `p${d.page}:${regionOf(d)}` : "none")));
  let shown = [], cur = 0;
  function applyFilters() {
    const q = $("search").value.trim().toLowerCase();
    const v = (id) => $(id).value;
    shown = all.filter((d) =>
      (!q || d.id.toLowerCase().includes(q) || String(d.value).includes(q) || (d.reference && (d.reference.gold_id.toLowerCase().includes(q) || String(d.reference.source_id).toLowerCase().includes(q)))) &&
      (!v("f-page") || String(d.page) === v("f-page")) && (!v("f-view") || d.view === v("f-view")) &&
      (!v("f-status") || d.decisions.overall === v("f-status")) && (!v("f-stage") || stageOf(d) === v("f-stage")) &&
      (!v("f-reason") || d.failure?.primary === v("f-reason")) && (!v("f-measures") || (d.association?.measures ?? "none") === v("f-measures")) &&
      (!v("f-orient") || d.orientation === v("f-orient")) && (!v("f-region") || (regionOf(d) ? `p${d.page}:${regionOf(d)}` : "none") === v("f-region")) &&
      (!$("f-gold").checked || d.reference) && (!$("f-unann").checked || !ann[d.id]));
    $("count").textContent = `${shown.length} of ${all.length} measurements`;
    $("list").innerHTML = shown.map((d, i) => `<li data-i="${i}"><span>${esc(d.id)}</span><span class="v">${esc(d.text)}${d.reference ? ` <span class="muted">${esc(d.reference.gold_id)}</span>` : ""}${ann[d.id] ? ` <span class="ann">✎ ${esc(ann[d.id].verdict)}</span>` : ""}</span><span class="chip ${d.decisions.overall}">${d.decisions.overall}</span></li>`).join("");
    const keep = shown.findIndex((d) => d.id === selected?.id);
    select(keep >= 0 ? keep : 0, keep < 0);
  }
  for (const id of ["f-page", "f-view", "f-status", "f-stage", "f-reason", "f-measures", "f-orient", "f-region", "f-gold", "f-unann"]) $(id).addEventListener("change", applyFilters);
  $("search").addEventListener("input", applyFilters);
  $("list").addEventListener("click", (e) => { const li = e.target.closest("li"); if (li) select(Number(li.dataset.i), true); });

  // ── layers ───────────────────────────────────────────────────────────────
  const LAYERS = [
    ["text", "Text", "--e-text", true], ["line", "Dim. line", "--e-line", true], ["ends", "Endpoints", "--e-end", true],
    ["marks", "Terminators", "--e-mark", true], ["elem", "Element", "--e-elem", true], ["alt", "Alternatives", "--e-alt", true],
    ["axis", "Lines on end axes", "--e-axis", false], ["tags", "Grid tags", "--e-tag", true], ["region", "Scale region", "--e-line", true],
    ["others", "Other dims", "--muted", false], ["ref", "REFERENCE", "--ref-fill", true], ["mine", "My correction", "--reviewer", true],
  ];
  const on = {};
  $("layers").innerHTML = LAYERS.map(([k, label, color, def]) => { on[k] = def; return `<label><input type="checkbox" data-layer="${k}" ${def ? "checked" : ""}><span class="sw" style="background:var(${color});${k === "ref" ? "outline:1px dashed #111" : ""}"></span>${label}</label>`; }).join("");
  $("layers").addEventListener("change", (e) => { const k = e.target.dataset.layer; if (k) { on[k] = e.target.checked; draw(); } });

  // ── viewer ───────────────────────────────────────────────────────────────
  const svg = $("view");
  let vb = { x: 0, y: 0, w: 100, h: 100 }, pageNo = null, selected = null, picking = null;
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const pxPerPt = () => svg.clientWidth / vb.w;
  const el = (tag, attrs, parent) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); parent.appendChild(n); return n; };
  const setVB = () => { svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`); $("zoom").textContent = `${(pxPerPt() * 72).toFixed(0)} dpi on screen`; tilesLayer(); draw(); };
  let base, tileG, over;
  function loadPage(n) {
    if (pageNo === n) return;
    pageNo = n;
    const P = pageOf.get(n);
    svg.innerHTML = "";
    base = el("image", { href: `pages/page-${n}.png`, x: 0, y: 0, width: P.size[0], height: P.size[1], preserveAspectRatio: "none" }, svg);
    tileG = el("g", {}, svg);
    over = el("g", {}, svg);
    tileCache.clear();
  }
  const tileCache = new Map();
  function tilesLayer() {
    if (!tileG || !pageNo) return;
    const t = D.tiles[pageNo];
    if (!t || pxPerPt() < 1.2) { tileG.style.display = "none"; return; }
    tileG.style.display = "";
    const c0 = Math.max(0, Math.floor(vb.x / t.pt)), c1 = Math.min(t.cols - 1, Math.floor((vb.x + vb.w) / t.pt));
    const r0 = Math.max(0, Math.floor(vb.y / t.pt)), r1 = Math.min(t.rows - 1, Math.floor((vb.y + vb.h) / t.pt));
    const P = pageOf.get(pageNo);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const k = `${r}-${c}`;
      if (tileCache.has(k)) continue;
      const w = Math.min(t.pt, P.size[0] - c * t.pt), h = Math.min(t.pt, P.size[1] - r * t.pt);
      tileCache.set(k, el("image", { href: `tiles/p${pageNo}-${r}-${c}.png`, x: c * t.pt, y: r * t.pt, width: w, height: h, preserveAspectRatio: "none" }, tileG));
    }
  }

  function draw() {
    if (!over || !selected) return;
    over.innerHTML = "";
    const d = selected, s = 1 / pxPerPt(); // 1 screen px in pt
    const L = (a, b, color, w, dash, parent = over, title) => { const n = el("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: color, "stroke-width": w * s, ...(dash ? { "stroke-dasharray": dash.map((x) => x * s).join(" ") } : {}) }, parent); if (title) el("title", {}, n).textContent = title; return n; };
    const C = (p, r, attrs, title) => { const n = el("circle", { cx: p[0], cy: p[1], r: r * s, ...attrs }, over); if (title) el("title", {}, n).textContent = title; return n; };
    const T = (p, text, color, size = 12, anchor = "start") => { const n = el("text", { x: p[0] + 6 * s, y: p[1] - 6 * s, fill: color, "font-size": size * s, "text-anchor": anchor, "paint-order": "stroke", stroke: "#fff", "stroke-width": 3 * s }, over); n.textContent = text; return n; };
    const poly = (pts, color, w, fill = "none", dash) => el("polygon", { points: pts.map((p) => p.join(",")).join(" "), stroke: color, "stroke-width": w * s, fill, ...(dash ? { "stroke-dasharray": dash.map((x) => x * s).join(" ") } : {}) }, over);
    const shape = (g, color, w, dash) => (g.type === "polygon" || g.type === "rectangle" ? poly(g.points, color, w, "none", dash) : el("polyline", { points: g.points.map((p) => p.join(",")).join(" "), stroke: color, "stroke-width": w * s, fill: "none", ...(dash ? { "stroke-dasharray": dash.map((x) => x * s).join(" ") } : {}) }, over));
    const P = pageOf.get(d.page);

    if (on.region) {
      for (const rg of P.regions) {
        const mine = rg.id === regionOf(d);
        if (!mine && !on.others) continue;
        const [x0, y0, x1, y1] = rg.extent, m = rg.margin;
        el("rect", { x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: "none", stroke: css("--e-line"), "stroke-width": (mine ? 2 : 1) * s, opacity: mine ? 0.8 : 0.3 }, over);
        el("rect", { x: x0 - m, y: y0 - m, width: x1 - x0 + 2 * m, height: y1 - y0 + 2 * m, fill: "none", stroke: css("--e-line"), "stroke-width": 1 * s, "stroke-dasharray": `${6 * s} ${4 * s}`, opacity: mine ? 0.6 : 0.2 }, over);
        T([x0 - m, y0 - m], `${rg.id}: ${rg.valuePerPoint.toFixed(3)} /pt (1:${rg.ratioIfMm} if mm), ${rg.support} dims`, css("--e-line"), 11);
      }
    }
    if (on.others) for (const o of P.dims) if (o.id !== d.id) C(o.textAnchor, 3, { fill: o.decisions.overall === "acceptable" ? css("--ok") : o.decisions.overall === "hold" ? css("--hold") : css("--reject"), opacity: 0.6 }, `${o.id} ${o.text} ${o.decisions.overall}`);
    if (on.tags) for (const t of P.tags) { C(t.at, 9, { fill: "none", stroke: css("--e-tag"), "stroke-width": 1.5 * s }, `tag ${t.text} (engine: not a dimension)`); }
    if (on.alt) for (const q of d.source.parallel) L(q.a, q.b, css("--e-alt"), 2, [4, 3], over, `source line #${q.shape} parallel to the dimension near its text (raw drawing)`);
    if (on.axis) for (const q of d.source.atEnds) L(q.a, q.b, css("--e-axis"), 1.5, [2, 2], over, `source line #${q.shape} on end ${q.end + 1}'s axis (raw drawing)`);
    if (on.elem && d.association?.ends) d.association.ends.forEach((e, k) => {
      const end = d.span ? (k === 0 ? d.span.start : d.span.end) : null;
      if (e.kind === "edge" && e.geometry) { shape(e.geometry, css("--e-elem"), 3); }
      if (end) T(end, e.kind === "grid" ? `grid ${e.labels.join("/")}` : e.kind === "edge" ? `edge (${e.via})` : e.kind, css("--e-elem"), 12);
    });
    if (on.line && d.line) L(d.line.a, d.line.b, css("--e-line"), 2.5, null, over, `engine line (${d.decisions.line})`);
    if (on.marks) for (const m of d.marks) {
      for (const g of m.shapes) shape(g, css("--e-mark"), m.chosen ? 2 : 1, m.chosen ? null : [3, 2]);
      C(m.at, m.chosen ? 5 : 4, { fill: m.chosen ? css("--e-mark") : "none", stroke: css("--e-mark"), "stroke-width": 1.5 * s }, `${m.kind}${m.chosen ? " (chosen)" : " (candidate)"}: ${m.evidence}`);
      if (on.alt || m.chosen) T(m.at, m.kind, css("--e-mark"), 10);
    }
    if (on.ends && d.span) for (const p of [d.span.start, d.span.end]) C(p, 8, { fill: css("--e-end"), stroke: "#fff", "stroke-width": 1.5 * s }, `engine endpoint ${fmt(p)}`);
    if (on.text) {
      const h = d.textHeight, v = d.orientation === "vertical", [w, ht] = v ? [1.6 * h, 4 * h] : [4 * h, 1.6 * h];
      el("rect", { x: d.textAnchor[0] - (v ? 1.2 * h : w / 2), y: d.textAnchor[1] - (v ? ht / 2 : 1.2 * h), width: w, height: ht, fill: "none", stroke: css("--e-text"), "stroke-width": 2 * s }, over);
    }
    if (on.ref && d.reference) {
      const r = d.reference, Y = css("--ref-fill"), K = css("--ref");
      if (r.endpoints_pt) {
        L(r.endpoints_pt[0], r.endpoints_pt[1], K, 4, null);
        L(r.endpoints_pt[0], r.endpoints_pt[1], Y, 2, [6, 4]);
        for (const p of r.endpoints_pt) { const q = 5 * s; poly([[p[0], p[1] - q], [p[0] + q, p[1]], [p[0], p[1] + q], [p[0] - q, p[1]]], K, 1.5, Y); }
      }
      const c = r.text_center_pt, q = 6 * s;
      L([c[0] - q, c[1] - q], [c[0] + q, c[1] + q], K, 2, null); L([c[0] - q, c[1] + q], [c[0] + q, c[1] - q], K, 2, null);
      T([c[0], c[1] + 26 * s], `REF ${r.gold_id}: ${r.associated_element}`, K, 11);
    }
    if (on.mine) {
      const a = ann[d.id]?.corrected_endpoints ?? (picking?.length ? picking : null);
      if (a) for (const p of a) { const q = 8 * s; L([p[0] - q, p[1]], [p[0] + q, p[1]], css("--reviewer"), 2, null); L([p[0], p[1] - q], [p[0], p[1] + q], css("--reviewer"), 2, null); }
      if (a && a.length === 2) L(a[0], a[1], css("--reviewer"), 1, [1, 3]);
    }
  }

  function fitTo(box, pad = 1.3) {
    const r = svg.clientWidth / Math.max(1, svg.clientHeight);
    let [x0, y0, x1, y1] = box, w = (x1 - x0) * pad, h = (y1 - y0) * pad;
    if (w / h > r) h = w / r; else w = h * r;
    vb = { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h };
    setVB();
  }
  function fitMeasurement() {
    const d = selected; if (!d) return;
    const pts = [d.textAnchor, ...(d.line ? [d.line.a, d.line.b] : []), ...(d.span ? [d.span.start, d.span.end] : []), ...(d.reference?.endpoints_pt ?? [])];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), m = Math.max(40, 6 * d.textHeight);
    fitTo([Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) + m, Math.max(...ys) + m], 1.1);
  }
  $("fit").onclick = fitMeasurement;
  $("fitpage").onclick = () => { const P = pageOf.get(pageNo); fitTo([0, 0, P.size[0], P.size[1]], 1.02); };
  const zoomAt = (k, cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2) => { vb = { x: cx - (cx - vb.x) * k, y: cy - (cy - vb.y) * k, w: vb.w * k, h: vb.h * k }; setVB(); };
  $("zin").onclick = () => zoomAt(0.7); $("zout").onclick = () => zoomAt(1 / 0.7);
  const toPt = (e) => { const r = svg.getBoundingClientRect(); return [vb.x + ((e.clientX - r.left) / r.width) * vb.w, vb.y + ((e.clientY - r.top) / r.height) * vb.h]; };
  svg.addEventListener("wheel", (e) => { e.preventDefault(); const [x, y] = toPt(e); zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, x, y); }, { passive: false });
  let drag = null;
  svg.addEventListener("mousedown", (e) => { if (picking) return; drag = { x: e.clientX, y: e.clientY, vb: { ...vb } }; svg.style.cursor = "grabbing"; });
  window.addEventListener("mousemove", (e) => { if (!drag) return; const k = vb.w / svg.clientWidth; vb = { ...drag.vb, x: drag.vb.x - (e.clientX - drag.x) * k, y: drag.vb.y - (e.clientY - drag.y) * k }; setVB(); });
  window.addEventListener("mouseup", () => { drag = null; svg.style.cursor = ""; });
  svg.addEventListener("click", (e) => {
    if (!picking) return;
    picking.push(toPt(e).map((v) => Math.round(v * 10) / 10));
    if (picking.length === 2) { pendingEnds = picking; picking = null; svg.classList.remove("picking"); $("pickhint").hidden = true; showEnds(); }
    draw();
  });
  window.addEventListener("resize", () => setVB());

  // ── selection and info ───────────────────────────────────────────────────
  let pendingEnds = null;
  const showEnds = () => { const e = pendingEnds ?? ann[selected?.id]?.corrected_endpoints; $("a-ends").textContent = e ? `${fmt(e[0])} – ${fmt(e[1])}` : "none"; };
  function select(i, fit) {
    cur = Math.max(0, Math.min(shown.length - 1, i));
    selected = shown[cur] ?? null;
    document.querySelectorAll("#list li").forEach((li) => li.classList.toggle("sel", Number(li.dataset.i) === cur));
    document.querySelector("#list li.sel")?.scrollIntoView({ block: "nearest" });
    if (!selected) { $("info").innerHTML = "<p class=muted>No measurement matches the filters.</p>"; return; }
    loadPage(selected.page);
    info(selected);
    loadAnnotation(selected);
    if (fit) fitMeasurement(); else setVB();
  }
  const decClass = (v) => (/^(found|valid-pair|associated|consistent|acceptable|parsed|detected|page-note|printed)$/.test(v) ? "dec-ok" : /^(hold|ambiguous|one-sided|chosen-by-endpoints|unavailable|unresolved)$/.test(v) ? "dec-mid" : "dec-bad");
  function info(d) {
    const rows = (pairs) => `<table>${pairs.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join("")}</table>`;
    const dec = d.decisions;
    const ends = d.association?.ends?.map((e, k) => `<div>end ${k + 1}: <b>${esc(e.kind)}</b> ${e.kind === "grid" ? esc(e.labels.join("/")) : e.kind === "edge" ? `via ${esc(e.via)}, shape #${e.shape}` : ""} — <span class="muted">${esc(e.evidence ?? e.reason)}</span>${e.candidates ? `<div class="muted small">alternatives: ${esc(e.candidates.join("; "))}</div>` : ""}</div>`).join("") ?? "not attempted";
    const marks = d.marks.length ? d.marks.map((m) => `<div>${m.chosen ? "●" : "○"} ${esc(m.side)} <b>${esc(m.kind)}</b> at ${fmt(m.at)} <span class="muted small">${esc(m.evidence)}</span></div>`).join("") : "none recorded";
    const sc = d.scaleCheck;
    const r = d.reference;
    $("info").innerHTML = `
      <h2>${esc(d.id)} · “${esc(d.text)}” <span class="chip ${dec.overall}">${dec.overall}</span></h2>
      <div class="muted">page ${d.page} · ${esc(d.view)} · ${esc(d.orientation)} · ${esc(d.role)}${d.chain ? ` ${esc(d.chain)}` : ""}</div>
      <h3>Why</h3>
      ${dec.overall === "acceptable" ? "<div class=dec-ok>Every gate passed: line, endpoint pair, association, scale; no conflicts.</div>" : d.reasons.map((x) => `<div class="dec-bad">• ${esc(x)}</div>`).join("")}
      ${d.failure ? `<div>primary: <b>${esc(d.failure.primary)}</b> (${esc(d.failure.stage)})${d.failure.secondary.length ? `; secondary: ${esc(d.failure.secondary.join(", "))}` : ""}; sole blocker: ${d.failure.soleBlocker === null ? "unknown (later stages not attempted)" : d.failure.soleBlocker}</div>` : ""}
      <h3>Stage decisions</h3>
      ${rows(Object.entries(dec).map(([k, v]) => [k, `<span class="${decClass(v)}">${esc(v)}</span>`]))}
      <h3>Evidence</h3>
      ${rows([
        ["printed / parsed", `${esc(d.text)} → ${d.value} ${esc(d.unit ?? "(no unit)")} <span class="muted">(${esc(d.unitBasis)})</span>`],
        ["text anchor", `${fmt(d.textAnchor)}, height ${d.textHeight.toFixed(2)}`],
        ["line", d.line ? `${fmt(d.line.a)} → ${fmt(d.line.b)}${d.line.joinedAcrossText ? " (joined across text)" : ""}` : "none"],
        ["endpoints", d.span ? `${fmt(d.span.start)} → ${fmt(d.span.end)}, ${d.span.length.toFixed(2)} pt` : "none"],
        ["endpoint decision", d.endpoints ? `${esc(d.endpoints.decision)} — <span class="muted">${esc(d.endpoints.reason)}</span>` : "not attempted"],
        ["terminators", marks],
        ["association", d.association ? `<b>${esc(d.association.decision)}</b> ${esc(d.association.measures ?? "")} — <span class="muted">${esc(d.association.reason)}</span>${ends}` : "not attempted"],
        ["scale", sc ? `region ${esc(sc.region)}: ${sc.valuePerPoint.toFixed(3)} /pt from ${sc.basedOn} others; measured ${sc.measured} vs printed ${d.value} (Δ ${sc.deviation}, tolerance ±${sc.tolerance})` : "no check"],
        ["cross-view", d.crossView ? `grids ${esc(d.crossView.grids)}: ${d.crossView.values.join(" / ")} in ${esc(d.crossView.ids.join(", "))}${d.crossView.conflict ? ' <b class="dec-bad">CONFLICT</b>' : ""}` : "—"],
        ["chain total", d.covers ? `${d.covers.sum} over ${esc(d.covers.ids.join(", "))}: ${d.covers.agrees ? "agrees" : '<b class="dec-bad">disagrees</b>'}` : "—"],
        ["possible repeat of", esc(d.possibleRepeatOf ?? "—")],
      ])}
      ${r ? `<div class="refbox"><b>REFERENCE ${esc(r.gold_id)}</b> (${esc(r.source_id)}) — ${esc(r.verification)}
        ${rows([["value", `${r.value} ${esc(r.unit)}`], ["endpoints", r.endpoints_pt ? `${fmt(r.endpoints_pt[0])} → ${fmt(r.endpoints_pt[1])}` : "none"], ["element", esc(r.associated_element)], ["basis", esc(r.association_basis ?? "")], ["status", esc(r.status)], ["view / scale", `${esc(r.view)} · ${esc(r.view_scale)}`],
          ...(r.amendments.length ? [["amended", r.amendments.map((a) => `${esc(a.field)}: “${esc(a.from)}” → “${esc(a.to)}” (${esc(a.date)})`).join("<br>")]] : []),
          ...(d.ledger ? [["ledger", Object.entries(d.ledger.outcomes).map(([k, v]) => `${k}: ${esc(v)}`).join(" · ")]] : [])])}</div>` : `<div class="muted small" style="margin-top:6px">Not in the Gold Set: no reference to compare.</div>`}`;
  }

  // ── annotations ──────────────────────────────────────────────────────────
  const radio = (name, v) => { document.querySelectorAll(`input[name=${name}]`).forEach((x) => (x.checked = x.value === v)); };
  const radioVal = (name) => document.querySelector(`input[name=${name}]:checked`)?.value ?? "";
  function loadAnnotation(d) {
    const a = ann[d.id];
    radio("verdict", a?.verdict); radio("confidence", a?.confidence);
    $("a-value").value = a?.corrected_value ?? ""; $("a-element").value = a?.corrected_element ?? ""; $("a-notes").value = a?.notes ?? "";
    pendingEnds = null; showEnds();
    $("a-saved").textContent = a ? `saved ${a.annotated_at.slice(0, 16).replace("T", " ")} by ${a.reviewer}` : "";
    $("a-count").textContent = `${Object.keys(ann).length} annotation(s) in this browser`;
  }
  $("annot").addEventListener("submit", (e) => {
    e.preventDefault();
    const d = selected; if (!d) return;
    const reviewer = $("a-reviewer").value.trim(), verdict = radioVal("verdict"), confidence = radioVal("confidence");
    if (!reviewer || !verdict || !confidence) { $("a-saved").textContent = "Reviewer, verdict and confidence are required."; return; }
    try { localStorage.setItem("cunstruct-wb-reviewer", reviewer); } catch { /* ignore */ }
    ann[d.id] = {
      schema: "cunstruct.workbench-annotation.v1", engine_id: d.id, gold_id: d.reference?.gold_id ?? null, page: d.page, printed_text: d.text,
      engine_status_seen: d.decisions.overall, dataset_sha256: D.dataset.sha256, engine_fingerprint: D.engine.candidate_fingerprint,
      reviewer, verdict, confidence, notes: $("a-notes").value, corrected_value: $("a-value").value === "" ? null : Number($("a-value").value),
      corrected_element: $("a-element").value || null, corrected_endpoints: pendingEnds ?? ann[d.id]?.corrected_endpoints ?? null,
      blind: false, annotated_at: new Date().toISOString(),
    };
    saveStore(); loadAnnotation(d); applyFilters();
  });
  $("a-delete").onclick = () => { if (selected && ann[selected.id]) { delete ann[selected.id]; saveStore(); loadAnnotation(selected); applyFilters(); } };
  $("a-pick").onclick = () => { picking = []; svg.classList.add("picking"); $("pickhint").hidden = false; };
  $("a-clear-ends").onclick = () => { pendingEnds = null; if (selected && ann[selected.id]) { ann[selected.id].corrected_endpoints = null; saveStore(); } showEnds(); draw(); };
  const download = (name, text, type) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/:/g, "");
  $("x-json").onclick = () => download(`workbench-annotations-${D.dataset.id}-${stamp()}.json`, JSON.stringify({ schema: "cunstruct.workbench-annotations.v1", dataset: D.dataset, engine: D.engine, note: "Workbench annotations: made with engine evidence visible (not blind).", annotations: Object.values(ann) }, null, 1), "application/json");
  $("x-csv").onclick = () => {
    const cols = ["engine_id", "gold_id", "page", "printed_text", "engine_status_seen", "reviewer", "verdict", "confidence", "corrected_value", "corrected_element", "corrected_endpoints", "notes", "annotated_at", "engine_fingerprint", "dataset_sha256"];
    const cell = (v) => { const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    download(`workbench-annotations-${D.dataset.id}-${stamp()}.csv`, [cols.join(","), ...Object.values(ann).map((a) => cols.map((c) => cell(a[c])).join(","))].join("\n") + "\n", "text/csv");
  };
  $("x-import").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      let n = 0;
      for (const a of j.annotations ?? []) if (a.engine_id && a.dataset_sha256 === D.dataset.sha256) { ann[a.engine_id] = a; n++; }
      saveStore(); applyFilters(); $("a-saved").textContent = `imported ${n}`;
    } catch (err) { $("a-saved").textContent = `import failed: ${err.message}`; }
  };

  // ── keyboard ─────────────────────────────────────────────────────────────
  $("prev").onclick = () => select(cur - 1, true); $("next").onclick = () => select(cur + 1, true);
  window.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if (e.key === "j" || e.key === "ArrowDown") { select(cur + 1, true); e.preventDefault(); }
    if (e.key === "k" || e.key === "ArrowUp") { select(cur - 1, true); e.preventDefault(); }
    if (e.key === "f") fitMeasurement();
    if (e.key === "Escape" && picking) { picking = null; svg.classList.remove("picking"); $("pickhint").hidden = true; draw(); }
  });

  applyFilters();
  window.__wb = { all, shown: () => shown, selected: () => selected, annotations: () => ann, select, vb: () => vb, on };
})();
