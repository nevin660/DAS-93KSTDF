/* Builds the display payload from parsed STDF data and renders the MVA-style UI. */
(function (global) {
  "use strict";

  function sig(x, n) {
    n = n || 6;
    if (x == null || !isFinite(x)) return null;
    const v = Number(x.toPrecision(n));
    return v;
  }
  function tsfmt(e) {
    if (e == null) return "";
    try { return new Date(e * 1000).toLocaleString("sv"); } catch (_) { return ""; }
  }
  function durfmt(sec) {
    if (sec == null || !isFinite(sec) || sec < 0) return "";
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + " h " : "") + (h || m ? m + " min " : "") + s + " s";
  }
  function statOf(arr, lo, hi) {
    const s = { n: arr.length };
    if (!arr.length) return s;
    let sum = 0; for (const v of arr) sum += v;
    const mean = sum / arr.length;
    let sd = 0;
    if (arr.length > 1) { let q = 0; for (const v of arr) q += (v - mean) * (v - mean); sd = Math.sqrt(q / (arr.length - 1)); }
    const sorted = [...arr].sort((a, b) => a - b);
    s.mean = mean; s.std = sd; s.min = sorted[0]; s.max = sorted[sorted.length - 1];
    s.med = sorted[Math.floor(arr.length / 2)];
    let cpk = null, cp = null;
    const degen = (lo != null && hi != null && hi === lo);
    if (!degen && sd > 0 && lo != null && hi != null) { cp = (hi - lo) / (6 * sd); cpk = Math.min(hi - mean, mean - lo) / (3 * sd); }
    else if (!degen && sd > 0 && hi != null) cpk = (hi - mean) / (3 * sd);
    else if (!degen && sd > 0 && lo != null) cpk = (mean - lo) / (3 * sd);
    let fail = 0;
    for (const v of arr) { if ((lo != null && v < lo) || (hi != null && v > hi)) fail++; else if (degen && v !== lo) fail++; }
    s.cpk = cpk; s.cp = cp; s.fail = fail;
    return s;
  }

  function buildPayload(D) {
    const { mir, wir, wrr, sdr, mrr, vur, atr, test_info, parts, tsr } = D;
    // enrich names from TSR
    const tn = {};
    for (const t of tsr) if (t.name && tn[t.num] == null) tn[t.num] = t.name;
    for (const [num, ti] of test_info) if (!ti.name && tn[num]) ti.name = tn[num];

    const n_parts = parts.length;
    let n_pass = 0; for (const p of parts) if (p.passed) n_pass++;
    const yld = n_parts ? n_pass / n_parts * 100 : 0;
    const wid = wir.WAFER_ID || "";

    const duts = parts.map((p, i) => ({
      i: i + 1, pid: p.part_id, site: p.site, x: p.x, y: p.y,
      hb: p.hbin, sb: p.sbin, pf: p.passed ? 1 : 0, tt: p.test_time_ms
    }));

    const nums = [...test_info.keys()].sort((a, b) => a - b);
    const tests = nums.map(num => {
      const ti = test_info.get(num);
      const vals = parts.map(p => (num in p.tests ? p.tests[num] : null));
      const arr = vals.filter(v => v != null && isFinite(v));
      const st = statOf(arr, ti.lo, ti.hi);
      const stat = { n: st.n };
      if (st.n) {
        stat.mean = sig(st.mean, 7); stat.std = sig(st.std, 7);
        stat.min = sig(st.min, 7); stat.max = sig(st.max, 7); stat.med = sig(st.med, 7);
        stat.cpk = st.cpk == null ? null : sig(st.cpk, 4);
        stat.cp = st.cp == null ? null : sig(st.cp, 4);
        stat.fail = st.fail;
      }
      return { n: num, name: ti.name || "", unit: ti.units || "",
        lo: sig(ti.lo), hi: sig(ti.hi), stat,
        vals: vals.map(v => sig(v, 7)) };
    });

    const binArr = (map) => {
      const cnt = new Map();
      const idx = map === "hb" ? "hb" : "sb";
      for (const d of duts) cnt.set(d[idx], (cnt.get(d[idx]) || 0) + 1);
      const src = map === "hb" ? D.hbins : D.sbins;
      const out = [];
      for (const num of [...cnt.keys()].sort((a, b) => (a == null) - (b == null) || a - b)) {
        const info = src.get(num) || {};
        out.push({ num, name: info.name || "", pf: info.pf || "", cnt: cnt.get(num) });
      }
      return out;
    };

    const info = [
      ["File", D.file_name],
      ["File Size", (D.file_size / 1024 / 1024).toFixed(1) + " MB"],
      ["STDF Version", "V4" + (vur.length ? " / " + vur.join(", ") : "")],
      ["Lot ID", mir.LOT_ID || "(empty)"],
      ["Sublot ID", mir.SBLOT_ID],
      ["Wafer ID", wid],
      ["Part Type", mir.PART_TYP],
      ["Tester Type", mir.TSTR_TYP],
      ["Tester Node", mir.NODE_NAM],
      ["Tester Serial", mir.SERL_NUM],
      ["Handler/Prober", sdr.HAND_TYP],
      ["Probe Card", sdr.CARD_TYP || sdr.CARD_ID],
      ["Site Count", (sdr.SITE_NUM || []).length],
      ["Job (Program)", mir.JOB_NAM],
      ["Exec Version", mir.EXEC_VER],
      ["Start Time", tsfmt(mir.START_T)],
      ["Finish Time", tsfmt(mrr.FINISH_T || wrr.FINISH_T)],
      ["Test Duration", durfmt(((mrr.FINISH_T || wrr.FINISH_T) || 0) - (mir.START_T || 0))],
    ];
    const sites = [...new Set(parts.map(p => p.site))].sort((a, b) => a - b);
    return { info, wafer: wid, n_parts, n_pass, yield: +yld.toFixed(2),
      sites, duts, tests, hbins: binArr("hb"), sbins: binArr("sb") };
  }

  // ===================== UI (DATA-driven) =====================
  let DATA = null, SEL = new Set(), curTest = null, cur = "overview";
  let corrMode = "matrix", corrN = 20, corrX = null, corrY = null;
  const TABS = [["overview", "Overview"], ["stats", "Test Statistics"], ["hist", "Histogram"],
    ["trend", "Trend"], ["wafer", "Wafer Map"], ["corr", "Correlation"],
    ["box", "Box Plot"], ["pareto", "Failure Pareto"], ["dut", "DUT Data"]];

  // ---- analysis math ----
  function pairXY(tx, ty, mask) {
    const xs = [], ys = [];
    const a = tx.vals, b = ty.vals;
    for (let i = 0; i < a.length; i++)
      if (mask[i] && a[i] != null && b[i] != null && isFinite(a[i]) && isFinite(b[i])) { xs.push(a[i]); ys.push(b[i]); }
    return { xs, ys };
  }
  function pearson(xs, ys) {
    const n = xs.length; if (n < 2) return null;
    let sx = 0, sy = 0; for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
    const mx = sx / n, my = sy / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    if (sxx === 0 || syy === 0) return null;
    return sxy / Math.sqrt(sxx * syy);
  }
  function linfit(xs, ys) {
    const n = xs.length; if (n < 2) return null;
    let sx = 0, sy = 0; for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
    const mx = sx / n, my = sy / n;
    let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) * (xs[i] - mx); }
    if (sxx === 0) return null;
    const slope = sxy / sxx; return { slope, intercept: my - slope * mx };
  }
  // candidate tests for correlation matrix: marginal params first (lowest Cpk), need limits + spread
  function corrCandidates(n) {
    const c = DATA.tests.filter(t => t.lo != null && t.hi != null && t.stat && t.stat.std > 0);
    c.sort((a, b) => {
      const ca = a.stat.cpk == null ? 1e9 : a.stat.cpk, cb = b.stat.cpk == null ? 1e9 : b.stat.cpk;
      return ca - cb;
    });
    return c.slice(0, n);
  }

  function dutMask() { return DATA.duts.map(d => SEL.has(d.site)); }
  function statFor(test, mask) {
    const v = [], n = test.vals;
    for (let i = 0; i < n.length; i++) if (mask[i] && n[i] != null && isFinite(n[i])) v.push(n[i]);
    return statOf(v, test.lo, test.hi).n ? Object.assign(statOf(v, test.lo, test.hi), { vals: v }) : { n: 0 };
  }
  function fmt(x) { return x == null ? "" : (typeof x === "number" ? +x.toPrecision(6) : x); }
  function cpkClass(c) { return c == null ? "" : (c < 1 ? "cpk-bad" : (c < 1.33 ? "cpk-warn" : "cpk-ok")); }

  // DAS-style left sidebar menu tree (groups + leaves)
  const MENU = [
    { key: "overview", label: "数据概览", icon: "📈" },
    { group: "工程数据", icon: "🗂", items: [
      { key: "stats", label: "测试统计" }, { key: "hist", label: "直方图" },
      { key: "trend", label: "趋势图" }, { key: "box", label: "箱线图" },
      { key: "corr", label: "相关性分析" } ] },
    { group: "晶圆 / 失效", icon: "🗂", items: [
      { key: "wafer", label: "晶圆图" }, { key: "pareto", label: "失效 Pareto" } ] },
    { key: "dut", label: "完整数据", icon: "📋" },
  ];
  const CRUMB = {}; // key -> "group / label"
  function buildTabs() {
    const s = document.getElementById("sidebar"); let h = "";
    MENU.forEach(m => {
      if (m.items) {
        h += `<div class="menu-group"><div class="menu-gtitle"><span class=menu-ic>${m.icon}</span>${m.group}</div>`;
        m.items.forEach(it => { CRUMB[it.key] = m.group + " / " + it.label;
          h += `<div class="menu-leaf" data-k="${it.key}">${it.label}</div>`; });
        h += `</div>`;
      } else {
        CRUMB[m.key] = m.label;
        h += `<div class="menu-leaf top" data-k="${m.key}"><span class=menu-ic>${m.icon}</span>${m.label}</div>`;
      }
    });
    s.innerHTML = h;
    s.querySelectorAll(".menu-leaf").forEach(el => el.onclick = () => showTab(el.getAttribute("data-k")));
  }
  function showTab(k) {
    cur = k;
    TABS.forEach(([kk]) => document.getElementById("p_" + kk).classList.add("hidden"));
    document.querySelectorAll("#sidebar .menu-leaf").forEach(el => el.classList.toggle("on", el.getAttribute("data-k") === k));
    const cr = document.getElementById("crumb");
    if (cr) cr.innerHTML = "数据中心 / " + (CRUMB[k] || k).split(" / ")
      .map((p, i, a) => i === a.length - 1 ? "<b>" + p + "</b>" : p).join(" / ");
    document.getElementById("p_" + k).classList.remove("hidden");
    document.getElementById("testsel").style.display = (k === "hist" || k === "trend" || k === "box") ? "" : "none";
    document.getElementById("wmsel").style.display = (k === "wafer") ? "" : "none";
    if (k === "stats") renderStats();
    if (k === "hist") renderHist();
    if (k === "trend") renderTrend();
    if (k === "wafer") renderWafer();
    if (k === "corr") renderCorr();
    if (k === "box") renderBox();
    if (k === "pareto") renderPareto();
    if (k === "dut") renderDut();
    if (k === "overview") renderOverview();
  }
  function buildSites() {
    const s = document.getElementById("sites"); s.innerHTML = "";
    DATA.sites.forEach(si => {
      const lab = document.createElement("label");
      lab.innerHTML = `<input type=checkbox checked value="${si}"> ${si}`;
      lab.querySelector("input").onchange = e => { if (e.target.checked) SEL.add(si); else SEL.delete(si); refresh(); };
      s.appendChild(lab);
    });
  }
  function refresh() {
    if (cur === "stats") renderStats(); if (cur === "hist") renderHist();
    if (cur === "trend") renderTrend(); if (cur === "wafer") renderWafer();
    if (cur === "corr") renderCorr(); if (cur === "box") renderBox();
    if (cur === "pareto") renderPareto();
    if (cur === "dut") renderDut(); if (cur === "overview") renderOverview();
  }
  function renderOverview() {
    const mask = dutMask(); let np = 0, pass = 0, ttSum = 0, ttN = 0;
    DATA.duts.forEach((d, i) => { if (mask[i]) { np++; if (d.pf) pass++;
      if (d.tt != null && isFinite(d.tt)) { ttSum += d.tt; ttN++; } } });
    const avgTt = ttN ? ttSum / ttN : null;   // ms
    const cards = `<div class=statcards>
      <div class=card><b>${np}</b><br><span>DUTs (filtered)</span></div>
      <div class=card><b>${pass}</b><br><span>Pass</span></div>
      <div class=card><b>${np - pass}</b><br><span>Fail</span></div>
      <div class=card><b>${np ? (pass / np * 100).toFixed(2) : 0}%</b><br><span>Yield</span></div>
      <div class=card><b>${DATA.tests.length}</b><br><span>Tests</span></div>
      <div class=card><b>${avgTt == null ? "—" : (avgTt / 1000).toFixed(2) + "s"}</b><br><span>Avg Test Time/die</span></div></div>`;
    const info = '<table class="kv">' + DATA.info.map(r => `<tr><td>${r[0]}</td><td>${r[1] == null || r[1] === "" ? "—" : r[1]}</td></tr>`).join("") + "</table>";
    const hb = '<h3>Hardware Bin</h3><table style="width:auto;min-width:420px"><tr><th class=l>Bin</th><th class=l>Name</th><th>P/F</th><th>Count</th><th>%</th></tr>' +
      DATA.hbins.map(b => `<tr class="${b.pf === "F" ? "cpk-bad" : (b.pf === "P" ? "cpk-ok" : "")}"><td>${b.num}</td><td class=l>${b.name}</td><td>${b.pf}</td><td>${b.cnt}</td><td>${(b.cnt / DATA.n_parts * 100).toFixed(2)}</td></tr>`).join("") + "</table>";
    document.getElementById("p_overview").innerHTML = cards +
      '<div style="display:flex;gap:30px;flex-wrap:wrap"><div>' + info + "</div><div>" + hb + "</div></div>";
  }
  let sortCol = "n", sortAsc = true;
  function renderStats() {
    const mask = dutMask();
    const rows = DATA.tests.map(t => ({ t, s: statFor(t, mask) }));
    const cols = [["n", "Test#", 0], ["name", "Test Name", 1], ["unit", "Unit", 1],
      ["lo", "LSL", 0], ["hi", "USL", 0], ["sn", "Samples", 0], ["fail", "Fail", 0],
      ["cpk", "Cpk", 0], ["cp", "Cp", 0], ["mean", "Mean", 0], ["med", "Median", 0],
      ["std", "StdDev", 0], ["min", "Min", 0], ["max", "Max", 0]];
    const getv = (r, c) => ({ n: r.t.n, name: r.t.name, unit: r.t.unit, lo: r.t.lo, hi: r.t.hi,
      sn: r.s.n, fail: r.s.fail, cpk: r.s.cpk, cp: r.s.cp, mean: r.s.mean, med: r.s.med, std: r.s.std, min: r.s.min, max: r.s.max }[c]);
    rows.sort((a, b) => {
      let va = getv(a, sortCol), vb = getv(b, sortCol);
      if (va == null) va = -Infinity; if (vb == null) vb = -Infinity;
      if (typeof va === "string") return sortAsc ? ("" + va).localeCompare(vb) : ("" + vb).localeCompare(va);
      return sortAsc ? va - vb : vb - va;
    });
    let h = `<div class=subbar><label>搜索测试:</label><input id=statsq placeholder="测试号或名称…" style="width:260px;padding:3px 6px">
      <span class=note id=statscnt></span></div>`;
    h += "<div class=tablewrap><table><thead><tr>" + cols.map(c => `<th class="${c[2] ? "l" : ""}" onclick="STDFUI.sortBy('${c[0]}')">${c[1]}${sortCol === c[0] ? (sortAsc ? " ▲" : " ▼") : ""}</th>`).join("") + "</tr></thead><tbody>";
    for (const r of rows) {
      h += `<tr data-s="${("" + r.t.n + " " + r.t.name).toLowerCase().replace(/"/g, "")}" onclick="STDFUI.pickTest(${r.t.n})" style="cursor:pointer">` +
        `<td>${r.t.n}</td><td class=l>${r.t.name}</td><td class=l>${r.t.unit || ""}</td>` +
        `<td>${fmt(r.t.lo)}</td><td>${fmt(r.t.hi)}</td><td>${r.s.n}</td>` +
        `<td class="${r.s.fail > 0 ? "cpk-warn" : ""}">${r.s.fail == null ? "" : r.s.fail}</td>` +
        `<td class="${cpkClass(r.s.cpk)}">${r.s.cpk == null ? "" : r.s.cpk.toFixed(3)}</td>` +
        `<td>${r.s.cp == null ? "" : r.s.cp.toFixed(3)}</td>` +
        `<td>${fmt(r.s.mean)}</td><td>${fmt(r.s.med)}</td><td>${fmt(r.s.std)}</td>` +
        `<td>${fmt(r.s.min)}</td><td>${fmt(r.s.max)}</td></tr>`;
    }
    h += "</tbody></table></div><div class=note>点击列头排序，点击行 → 在 Histogram / Trend 中查看该测试项。</div>";
    document.getElementById("p_stats").innerHTML = h;
    const q = document.getElementById("statsq");
    const cnt = document.getElementById("statscnt");
    const trs = document.querySelectorAll("#p_stats tbody tr");
    const applyFilter = () => {
      const v = q.value.trim().toLowerCase(); let shown = 0;
      trs.forEach(tr => { const ok = !v || tr.getAttribute("data-s").includes(v); tr.style.display = ok ? "" : "none"; if (ok) shown++; });
      cnt.textContent = `${shown} / ${trs.length} 项`;
    };
    q.value = statsQuery; q.oninput = () => { statsQuery = q.value; applyFilter(); };
    applyFilter();
  }
  let statsQuery = "";
  function sortBy(c) { if (sortCol === c) sortAsc = !sortAsc; else { sortCol = c; sortAsc = true; } renderStats(); }
  function pickTest(n) { curTest = n; document.getElementById("testdd").value = n; showTab("hist"); }
  function getTest(n) { return DATA.tests.find(t => t.n === n); }
  function vline(x, c) { return { type: "line", x0: x, x1: x, yref: "paper", y0: 0, y1: 1, line: { color: c, width: 2, dash: "dash" } }; }
  function renderHist() {
    const t = getTest(curTest); if (!t) return; const s = statFor(t, dutMask());
    const nb = 50;
    const tr = [{ x: s.vals, type: "histogram", nbinsx: nb, marker: { color: "#73d13d" }, name: "Count" }];
    // normal-distribution overlay (fitted to mean/sigma)
    if (s.n > 1 && s.std > 0) {
      const dmin = s.min, dmax = s.max, binW = (dmax - dmin) / nb || 1;
      const x0 = Math.min(dmin, t.lo == null ? dmin : t.lo);
      const x1 = Math.max(dmax, t.hi == null ? dmax : t.hi);
      const nx = [], ny = [];
      for (let i = 0; i <= 100; i++) {
        const x = x0 + (x1 - x0) * i / 100;
        const pdf = Math.exp(-((x - s.mean) ** 2) / (2 * s.std * s.std)) / (s.std * Math.sqrt(2 * Math.PI));
        nx.push(x); ny.push(pdf * s.n * binW);
      }
      tr.push({ x: nx, y: ny, type: "scatter", mode: "lines", name: "Normal fit",
        line: { color: "#e8a33d", width: 2 } });
    }
    const shapes = [];
    if (t.lo != null) shapes.push(vline(t.lo, "#c0392b"));
    if (t.hi != null) shapes.push(vline(t.hi, "#c0392b"));
    if (s.mean != null) shapes.push(vline(s.mean, "#2e9e4f"));
    const title = `${t.n}  ${t.name}  [${t.unit || ""}]  |  N=${s.n}  Mean=${fmt(s.mean)}  σ=${fmt(s.std)}  Cpk=${s.cpk == null ? "-" : s.cpk.toFixed(3)}  Fail=${s.fail}`;
    Plotly.newPlot("chart_hist", tr, { title: { text: title, font: { size: 13 } }, shapes,
      bargap: 0.02, xaxis: { title: t.unit || "value" }, yaxis: { title: "Count" }, margin: { t: 40 } }, { responsive: true });
  }
  function renderTrend() {
    const t = getTest(curTest); if (!t) return; const mask = dutMask();
    const xi = [], yi = [], col = [], txt = [];
    DATA.duts.forEach((d, i) => {
      if (mask[i] && t.vals[i] != null) {
        xi.push(d.i); yi.push(t.vals[i]); col.push(d.pf ? "#2e9e4f" : "#c0392b");
        txt.push(`DUT ${d.i} site${d.site} (${d.x},${d.y}) ${d.pf ? "PASS" : "FAIL"}`);
      }
    });
    const shapes = [];
    if (t.lo != null) shapes.push({ type: "line", xref: "paper", x0: 0, x1: 1, y0: t.lo, y1: t.lo, line: { color: "#c0392b", dash: "dash" } });
    if (t.hi != null) shapes.push({ type: "line", xref: "paper", x0: 0, x1: 1, y0: t.hi, y1: t.hi, line: { color: "#c0392b", dash: "dash" } });
    Plotly.newPlot("chart_trend", [{ x: xi, y: yi, mode: "markers", type: "scattergl", marker: { color: col, size: 4 }, text: txt, hoverinfo: "text+y" }],
      { title: { text: `${t.n}  ${t.name}  [${t.unit || ""}]`, font: { size: 13 } }, shapes,
        xaxis: { title: "DUT Index" }, yaxis: { title: t.unit || "value" }, margin: { t: 40 } }, { responsive: true });
  }
  function buildWmdd() {
    const dd = document.getElementById("wmdd");
    dd.innerHTML = '<option value="__pf">Pass / Fail</option><option value="__hb">Hardware Bin</option>' +
      DATA.tests.map(t => `<option value="${t.n}">${t.n} ${t.name}</option>`).join("");
    dd.onchange = renderWafer;
  }
  function renderWafer() {
    const mode = document.getElementById("wmdd").value, mask = dutMask();
    const xs = [], ys = [];
    DATA.duts.forEach((d, i) => { if (mask[i] && d.x != null && d.y != null) { xs.push(d.x); ys.push(d.y); } });
    if (!xs.length) { document.getElementById("chart_wafer").innerHTML = "No XY coords"; return; }
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const W = x1 - x0 + 1, H = y1 - y0 + 1;
    const z = Array.from({ length: H }, () => Array(W).fill(null));
    const text = Array.from({ length: H }, () => Array(W).fill(""));
    let t = null; if (mode !== "__pf" && mode !== "__hb") t = getTest(+mode);
    DATA.duts.forEach((d, i) => {
      if (!mask[i] || d.x == null || d.y == null) return;
      const gx = d.x - x0, gy = d.y - y0; let val;
      if (mode === "__pf") val = d.pf ? 1 : 0;
      else if (mode === "__hb") val = d.hb;
      else val = t ? t.vals[i] : null;
      z[gy][gx] = val;
      text[gy][gx] = `(${d.x},${d.y}) site${d.site} HB${d.hb} ${d.pf ? "PASS" : "FAIL"}` + (t ? `<br>${fmt(val)}` : "");
    });
    let colorscale, zmin, zmax, showscale = true, title;
    if (mode === "__pf") { colorscale = [[0, "#c0392b"], [1, "#2e9e4f"]]; zmin = 0; zmax = 1; showscale = false; title = "Wafer Map — Pass/Fail  " + DATA.wafer; }
    else if (mode === "__hb") { colorscale = "Portland"; title = "Wafer Map — Hardware Bin  " + DATA.wafer; }
    else { colorscale = "Viridis"; title = `Wafer Map — ${t.n} ${t.name} [${t.unit || ""}]`; }
    Plotly.newPlot("chart_wafer", [{ z, text, type: "heatmap", colorscale, zmin, zmax, showscale, hoverinfo: "text", xgap: 1, ygap: 1, x0, y0 }],
      { title: { text: title, font: { size: 13 } }, yaxis: { autorange: "reversed", scaleanchor: "x", title: "Y" }, xaxis: { title: "X" }, margin: { t: 40 } }, { responsive: true });
  }
  // ---------- 完整数据 (virtualized wide grid: all DUTs × all tests) ----------
  let dutPF = "all", dutColQ = "", dutRowQ = "", dutHL = true;
  let gridRows = [], gridTests = [], gridTick = false;
  const ROWH = 26;
  const META = [
    { h: "#", w: 48, stk: 0, get: r => r.d.i },
    { h: "PartID", w: 66, stk: 48, get: r => r.d.pid },
    { h: "Site", w: 44, get: r => r.d.site },
    { h: "X", w: 42, get: r => r.d.x },
    { h: "Y", w: 42, get: r => r.d.y },
    { h: "HBin", w: 50, get: r => r.d.hb },
    { h: "SBin", w: 56, get: r => r.d.sb },
    { h: "Time", w: 56, get: r => r.d.tt == null ? "" : r.d.tt },
    { h: "Flag", w: 52, get: r => r.d.pf ? "PASS" : "FAIL", cls: r => r.d.pf ? "pf0" : "pf1" },
  ];
  function renderDut() {
    const cont = document.getElementById("p_dut");
    cont.innerHTML = `<div class=subbar>
      <label>结果:</label><select id=dpf><option value=all>全部</option><option value=pass>仅 Pass</option><option value=fail>仅 Fail</option></select>
      <label>测试列筛选:</label><input id=dcol placeholder="测试号 / 名称…" style="width:190px">
      <label>行搜索:</label><input id=drow placeholder="PartID / 坐标…" style="width:150px">
      <span class=note id=dcount></span>
      <label style="margin-left:auto;font-weight:400"><input type=checkbox id=dhl checked> 超限单元格红色高亮</label>
      </div>
      <div class="grid-scroll" id=gridscroll><table class="grid"><thead id=gridhead></thead><tbody id=gridbody></tbody></table></div>`;
    const dpf = document.getElementById("dpf"), dcol = document.getElementById("dcol"),
      drow = document.getElementById("drow"), dhl = document.getElementById("dhl");
    dpf.value = dutPF; dcol.value = dutColQ; drow.value = dutRowQ; dhl.checked = dutHL;
    dpf.onchange = () => { dutPF = dpf.value; gridRefresh(); };
    dcol.oninput = () => { dutColQ = dcol.value; gridRefresh(); };
    drow.oninput = () => { dutRowQ = drow.value; gridRefresh(); };
    dhl.onchange = () => { dutHL = dhl.checked; gridBody(); };
    document.getElementById("gridscroll").onscroll = () => {
      if (gridTick) return; gridTick = true;
      requestAnimationFrame(() => { gridTick = false; gridBody(); });
    };
    gridRefresh();
  }
  function gridRefresh() {
    const mask = dutMask(), rq = dutRowQ.trim().toLowerCase();
    gridRows = [];
    DATA.duts.forEach((d, i) => {
      if (!mask[i]) return;
      if (dutPF === "pass" && !d.pf) return;
      if (dutPF === "fail" && d.pf) return;
      if (rq && !((d.pid + " " + d.x + " " + d.y).toLowerCase().includes(rq))) return;
      gridRows.push({ d, i });
    });
    const cq = dutColQ.trim().toLowerCase();
    gridTests = cq ? DATA.tests.filter(t => ("" + t.n + " " + t.name).toLowerCase().includes(cq)) : DATA.tests;
    const cnt = document.getElementById("dcount");
    if (cnt) cnt.textContent = `${gridRows.length} 行 × ${gridTests.length} 测试项`;
    gridHead();
    const sc = document.getElementById("gridscroll"); if (sc) sc.scrollTop = 0;
    gridBody();
  }
  function gridHead() {
    let h = "<tr>";
    META.forEach(m => {
      const s = m.stk != null;
      h += `<th class="l${s ? " stk" : ""}" style="width:${m.w}px;${s ? `left:${m.stk}px;` : ""}">${m.h}</th>`;
    });
    gridTests.forEach(t => {
      const tip = ("" + t.n + " " + t.name).replace(/"/g, "") + `  [${t.lo == null ? "" : t.lo}, ${t.hi == null ? "" : t.hi}] ${t.unit || ""}`;
      h += `<th title="${tip}" style="width:74px">${t.n}</th>`;
    });
    document.getElementById("gridhead").innerHTML = h + "</tr>";
  }
  function gridBody() {
    const sc = document.getElementById("gridscroll"); if (!sc) return;
    const total = gridRows.length, ncols = META.length + gridTests.length;
    const vis = Math.ceil((sc.clientHeight || 500) / ROWH) + 8;
    let start = Math.floor(sc.scrollTop / ROWH) - 4; if (start < 0) start = 0;
    const end = Math.min(total, start + vis);
    let h = "";
    if (start > 0) h += `<tr><td colspan=${ncols} style="height:${start * ROWH}px;padding:0;border:none"></td></tr>`;
    for (let k = start; k < end; k++) {
      const r = gridRows[k]; h += "<tr>";
      META.forEach(m => {
        const s = m.stk != null, cls = (m.cls ? m.cls(r) : "");
        h += `<td class="l${s ? " stk" : ""} ${cls}" style="${s ? `left:${m.stk}px;` : ""}">${m.get(r)}</td>`;
      });
      gridTests.forEach(t => {
        const v = t.vals[r.i];
        let cls = "";
        if (dutHL && v != null && ((t.lo != null && v < t.lo) || (t.hi != null && v > t.hi))) cls = "cpk-bad";
        h += `<td class="${cls}">${v == null ? "" : v}</td>`;
      });
      h += "</tr>";
    }
    if (end < total) h += `<tr><td colspan=${ncols} style="height:${(total - end) * ROWH}px;padding:0;border:none"></td></tr>`;
    document.getElementById("gridbody").innerHTML = h;
  }
  // ---------- Correlation ----------
  function renderCorr() {
    const mask = dutMask();
    const cont = document.getElementById("p_corr");
    let ctrl = `<div class=subbar><span class=seg>
      <button id=cm_matrix class="${corrMode === "matrix" ? "on" : ""}">相关矩阵 Matrix</button>
      <button id=cm_scatter class="${corrMode === "scatter" ? "on" : ""}">散点 X-Y</button></span>`;
    if (corrMode === "matrix") {
      ctrl += `<label>Top N (低Cpk优先):</label><select id=corrn>${[10, 15, 20, 30, 40].map(v => `<option ${v === corrN ? "selected" : ""}>${v}</option>`).join("")}</select>
        <span class=note>颜色 = Pearson r（红正 / 蓝负）；点格子 → 看该对散点</span>`;
    } else {
      const opts = DATA.tests.map(t => `<option value="${t.n}">${t.n} ${t.name}</option>`).join("");
      if (corrX == null) { const cc = corrCandidates(corrN); corrX = (cc[0] || DATA.tests[0]).n; corrY = (cc[1] || cc[0] || DATA.tests[0]).n; }
      ctrl += `<label>X:</label><select id=corrx>${opts}</select><label>Y:</label><select id=corry>${opts}</select>`;
    }
    ctrl += `</div><div id="chart_corr" style="height:68vh"></div>`;
    cont.innerHTML = ctrl;
    document.getElementById("cm_matrix").onclick = () => { corrMode = "matrix"; renderCorr(); };
    document.getElementById("cm_scatter").onclick = () => { corrMode = "scatter"; renderCorr(); };
    if (corrMode === "matrix") {
      document.getElementById("corrn").onchange = e => { corrN = +e.target.value; renderCorr(); };
      drawCorrMatrix(mask);
    } else {
      const sx = document.getElementById("corrx"), sy = document.getElementById("corry");
      sx.value = corrX; sy.value = corrY;
      sx.onchange = () => { corrX = +sx.value; drawCorrScatter(mask); };
      sy.onchange = () => { corrY = +sy.value; drawCorrScatter(mask); };
      drawCorrScatter(mask);
    }
  }
  function drawCorrMatrix(mask) {
    const cand = corrCandidates(corrN);
    const labels = cand.map(t => "" + t.n);
    const z = [], text = [];
    for (let i = 0; i < cand.length; i++) {
      const row = [], trow = [];
      for (let j = 0; j < cand.length; j++) {
        let r;
        if (j === i) r = 1;
        else { const { xs, ys } = pairXY(cand[i], cand[j], mask); const rr = pearson(xs, ys); r = rr == null ? null : +rr.toFixed(3); }
        row.push(r);
        trow.push(`${cand[i].n} × ${cand[j].n}<br>${cand[i].name}<br>${cand[j].name}<br>r = ${r == null ? "NA" : r}`);
      }
      z.push(row); text.push(trow);
    }
    const CSCALE = [[0, "#2166ac"], [0.5, "#f7f7f7"], [1, "#b2182b"]]; // blue(-1) → white(0) → red(+1)
    Plotly.newPlot("chart_corr", [{ z, x: labels, y: labels, text, hoverinfo: "text", type: "heatmap",
      colorscale: CSCALE, zmin: -1, zmax: 1, zmid: 0, xgap: 1, ygap: 1, colorbar: { title: "r" } }],
      { title: { text: `相关矩阵 Pearson r — Top ${corrN} 低Cpk参数项（红正/蓝负，点格子看散点）`, font: { size: 13 } },
        xaxis: { type: "category", tickangle: -45, automargin: true },
        yaxis: { type: "category", autorange: "reversed", automargin: true }, margin: { t: 50 } },
      { responsive: true }).then(gd => {
        gd.on("plotly_click", ev => { const p = ev.points[0]; corrX = +p.x; corrY = +p.y; corrMode = "scatter"; renderCorr(); });
      });
  }
  function drawCorrScatter(mask) {
    const tx = getTest(corrX), ty = getTest(corrY); if (!tx || !ty) return;
    const xs = [], ys = [], col = [], txt = [], a = tx.vals, b = ty.vals;
    DATA.duts.forEach((d, i) => { if (mask[i] && a[i] != null && b[i] != null) { xs.push(a[i]); ys.push(b[i]); col.push(d.pf ? "#2e9e4f" : "#c0392b"); txt.push(`DUT ${d.i} site${d.site}`); } });
    const r = pearson(xs, ys), fit = linfit(xs, ys);
    const traces = [{ x: xs, y: ys, mode: "markers", type: "scattergl", marker: { color: col, size: 4 }, text: txt, hoverinfo: "text", name: "DUT" }];
    if (fit && xs.length) { const xmin = Math.min(...xs), xmax = Math.max(...xs);
      traces.push({ x: [xmin, xmax], y: [fit.intercept + fit.slope * xmin, fit.intercept + fit.slope * xmax], mode: "lines", line: { color: "#237804", width: 2, dash: "dash" }, name: "linear fit" }); }
    const r2 = r == null ? null : r * r;
    Plotly.newPlot("chart_corr", traces,
      { title: { text: `${tx.n} ${tx.name}  vs  ${ty.n} ${ty.name}<br>r = ${r == null ? "NA" : r.toFixed(4)}   R² = ${r2 == null ? "NA" : r2.toFixed(4)}   N = ${xs.length}`, font: { size: 12 } },
        xaxis: { title: `${tx.n} [${tx.unit || ""}]` }, yaxis: { title: `${ty.n} [${ty.unit || ""}]` }, margin: { t: 70 } }, { responsive: true });
  }

  // ---------- Box plot by Site ----------
  function renderBox() {
    const t = getTest(curTest); if (!t) return; const mask = dutMask();
    const traces = [];
    DATA.sites.forEach(si => {
      if (!SEL.has(si)) return;
      const v = []; DATA.duts.forEach((d, i) => { if (d.site === si && t.vals[i] != null) v.push(t.vals[i]); });
      if (v.length) traces.push({ y: v, name: "Site " + si, type: "box", boxpoints: "outliers", marker: { size: 3 } });
    });
    const all = []; DATA.duts.forEach((d, i) => { if (mask[i] && t.vals[i] != null) all.push(t.vals[i]); });
    if (all.length) traces.push({ y: all, name: "All", type: "box", boxpoints: "outliers", marker: { size: 3, color: "#777" } });
    const shapes = [];
    if (t.lo != null) shapes.push({ type: "line", xref: "paper", x0: 0, x1: 1, y0: t.lo, y1: t.lo, line: { color: "#c0392b", dash: "dash" } });
    if (t.hi != null) shapes.push({ type: "line", xref: "paper", x0: 0, x1: 1, y0: t.hi, y1: t.hi, line: { color: "#c0392b", dash: "dash" } });
    Plotly.newPlot("chart_box", traces, { title: { text: `${t.n} ${t.name} [${t.unit || ""}] — 按 Site 分布对比 (箱线图)`, font: { size: 13 } }, shapes, yaxis: { title: t.unit || "value" }, margin: { t: 40 } }, { responsive: true });
  }

  // ---------- Failure Pareto ----------
  function renderPareto() {
    const mask = dutMask();
    const sbCnt = new Map();
    DATA.duts.forEach((d, i) => { if (mask[i] && !d.pf) sbCnt.set(d.sb, (sbCnt.get(d.sb) || 0) + 1); });
    const sbName = {}; DATA.sbins.forEach(b => sbName[b.num] = b.name);
    const sbArr = [...sbCnt.entries()].map(([num, c]) => ({ num, c, name: sbName[num] || "" })).sort((a, b) => b.c - a.c);
    const tf = DATA.tests.map(t => { const s = statFor(t, mask); return { n: t.n, name: t.name, fail: s.fail || 0 }; })
      .filter(x => x.fail > 0).sort((a, b) => b.fail - a.fail).slice(0, 20);
    const cont = document.getElementById("p_pareto");
    cont.innerHTML = '<div id="chart_pareto1" style="height:36vh"></div><div id="chart_pareto2" style="height:42vh;margin-top:8px"></div>';
    paretoBar("chart_pareto1", sbArr.map(b => `${b.num} ${b.name}`), sbArr.map(b => b.c), "失效 Soft Bin Pareto（按不良 die 数）");
    paretoBar("chart_pareto2", tf.map(t => `${t.n} ${t.name}`), tf.map(t => t.fail), "测试项超限数 Pareto (Top 20)");
  }
  function paretoBar(id, labels, counts, title) {
    if (!labels.length) { document.getElementById(id).innerHTML = `<div class=note style="padding:20px">${title}：无数据</div>`; return; }
    const total = counts.reduce((a, b) => a + b, 0) || 1; let cum = 0;
    const cumPct = counts.map(c => { cum += c; return +(cum / total * 100).toFixed(1); });
    Plotly.newPlot(id, [
      { x: labels, y: counts, type: "bar", marker: { color: "#c0392b" }, name: "Count" },
      { x: labels, y: cumPct, type: "scatter", mode: "lines+markers", yaxis: "y2", line: { color: "#237804" }, name: "Cumulative %" }
    ], { title: { text: title, font: { size: 13 } }, margin: { t: 40, b: 150 },
      xaxis: { tickangle: -40, automargin: true }, yaxis: { title: "Count" },
      yaxis2: { title: "Cum %", overlaying: "y", side: "right", range: [0, 105] }, legend: { orientation: "h" } }, { responsive: true });
  }

  // CSV export
  function dl(name, txt) { const b = new Blob([txt], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name; a.click(); }
  function csvCell(v) { if (v == null) return ""; v = "" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function expStats() {
    const mask = dutMask();
    const rows = [["Test Number", "Test Name", "Unit", "LSL", "USL", "Samples", "Fail", "Cpk", "Cp", "Mean", "Median", "StdDev", "Min", "Max"]];
    DATA.tests.forEach(t => { const s = statFor(t, mask); rows.push([t.n, t.name, t.unit, t.lo, t.hi, s.n, s.fail, s.cpk, s.cp, s.mean, s.med, s.std, s.min, s.max]); });
    dl("STDF_test_statistics.csv", rows.map(r => r.map(csvCell).join(",")).join("\n"));
  }
  function expWide() {
    const mask = dutMask();
    const head = ["DUT", "PartID", "Site", "X", "Y", "HardBin", "SoftBin", "TestTime(ms)", "Flag"].concat(DATA.tests.map(t => t.n + " " + t.name));
    const rows = [head];
    DATA.duts.forEach((d, i) => { if (!mask[i]) return; const r = [d.i, d.pid, d.site, d.x, d.y, d.hb, d.sb, d.tt, d.pf ? "PASS" : "FAIL"]; DATA.tests.forEach(t => r.push(t.vals[i])); rows.push(r); });
    dl("STDF_dut_wide.csv", rows.map(r => r.map(csvCell).join(",")).join("\n"));
  }
  function expLong() {
    const mask = dutMask();
    const rows = [["DUT", "PartID", "Site", "X", "Y", "TestNumber", "TestName", "Unit", "Value", "LSL", "USL", "InLimit"]];
    DATA.duts.forEach((d, i) => { if (!mask[i]) return;
      DATA.tests.forEach(t => { const v = t.vals[i]; if (v == null) return;
        const inlim = ((t.lo == null || v >= t.lo) && (t.hi == null || v <= t.hi)) ? 1 : 0;
        rows.push([d.i, d.pid, d.site, d.x, d.y, t.n, t.name, t.unit, v, t.lo, t.hi, inlim]); }); });
    dl("STDF_long.csv", rows.map(r => r.map(csvCell).join(",")).join("\n"));
  }
  function buildTestDD() {
    const dd = document.getElementById("testdd");
    dd.innerHTML = DATA.tests.map(t => `<option value="${t.n}">${t.n}  ${t.name}</option>`).join("");
    dd.value = curTest;
    dd.onchange = () => { curTest = +dd.value; if (cur === "hist") renderHist(); if (cur === "trend") renderTrend(); if (cur === "box") renderBox(); };
  }

  function initApp(payload) {
    DATA = payload;
    SEL = new Set(DATA.sites);
    curTest = (DATA.tests.find(t => t.lo != null && t.hi != null && t.stat && t.stat.std > 0) || DATA.tests[0] || { n: null }).n;
    const getI = (k) => { const r = DATA.info.find(x => x[0] === k); return r ? r[1] : ""; };
    document.getElementById("hmeta").textContent =
      `${getI("Wafer ID")}  |  ${getI("Tester Type")}  |  ${DATA.n_parts} DUTs  |  ${DATA.tests.length} tests`;
    document.getElementById("hyld").textContent = "Yield " + DATA.yield + "%";
    buildTabs(); buildSites(); buildTestDD(); buildWmdd();
    renderOverview(); showTab("overview");
  }

  global.STDFUI = { buildPayload, initApp, sortBy, pickTest, expStats, expWide, expLong, showTab };
})(window);
