/* The Cell Therapy Trial Map — dashboard
   Reads data/trials.csv (one row per trial, written by cart_trials_world_v2.R) and
   data/world.csv (Equal Earth country outlines), counts running trials the same way
   as the R script, and draws every tab with d3. */
(() => {
  "use strict";
  const CFG = window.CT_CONFIG || {};
  const FIRST = 2008;
  const TABS = ["overview", "map", "trends", "invivo", "trials", "method"];
  const fmt = d3.format(",");
  const pct = d3.format(".0%");
  const signed = (v) => (v > 0 ? "+" : v < 0 ? "−" : "±") + fmt(Math.abs(v));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const narrow = () => window.innerWidth <= 760;
  const REGIONS = [["China", "china"], ["USA", "usa"], ["Europe", "europe"], ["Rest of world", "rest_of_world"]];
  const COL = {
    China: "var(--china)", USA: "var(--usa)", Europe: "var(--europe)", "Rest of world": "var(--row)",
    "In vivo": "var(--invivo)", all: "var(--all)",
    Cancer: "var(--cancer)", "Autoimmune & immune-mediated": "var(--autoimmune)", Other: "var(--other)",
    "CAR-T": "var(--cart)", "TCR-T": "var(--tcrt)",
  };
  const LAYERS = { all: "Running trials per country", iv: "Running in vivo trials per country", auto: "Running autoimmune trials per country" };

  function el(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (k === "class") e.className = v;
      else if (k === "style") e.style.cssText = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    e.append(...kids.filter((x) => x != null && x !== false));
    return e;
  }
  const cssVar = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();

  /* ---------- state ---------- */
  const S = { tab: null, year: null, layer: "all", country: null, playing: false,
              q: "", fyear: "", approach: "", indication: "", fcountry: "", sort: { key: "start", dir: -1 } };
  let D = null;
  const rendered = new Set();

  /* ---------- counting (same rules as the R script) ---------- */
  function compute(trials, world) {
    const region = new Map(world.map((c) => [c.country, c.region]));
    const geo = new Map(world.map((c) => [c.country, c]));
    const T = trials.map((r) => {
      const countryList = r.countries ? r.countries.split("; ") : [];
      return { ...r, from: +r.start_year, to: +r.end_year, countryList,
               regions: new Set(countryList.map((c) => region.get(c))),
               iv: r.approach === "In vivo", auto: r.indication === "Autoimmune & immune-mediated" };
    });
    const last = d3.max(T, (t) => t.to);
    const years = d3.range(FIRST, last + 1);
    const yi = (y) => y - FIRST;
    const byYear = years.map((year) => {
      const run = T.filter((t) => t.from <= year && t.to >= year);
      const n = (f) => run.filter(f).length;
      return {
        year, world: run.length,
        china: n((t) => t.regions.has("China")), usa: n((t) => t.regions.has("USA")),
        europe: n((t) => t.regions.has("Europe")), rest_of_world: n((t) => t.regions.has("Rest of world")),
        in_vivo: n((t) => t.iv), autoimmune: n((t) => t.auto), cancer: n((t) => t.indication === "Cancer"),
        other: n((t) => t.indication === "Other"), cart: n((t) => t.modality === "CAR-T"), tcrt: n((t) => t.modality === "TCR-T"),
        countries: new Set(run.flatMap((t) => t.countryList)).size,
      };
    });
    const starts = years.map((year) => {
      const s = T.filter((t) => t.from === year);
      return { year, all: s.length, in_vivo: s.filter((t) => t.iv).length };
    });
    // per-country series, one value per year and layer
    const series = new Map();
    for (const t of T) {
      for (const c of new Set(t.countryList)) {
        if (!series.has(c)) series.set(c, { country: c, region: region.get(c) || "Rest of world", all: new Array(years.length).fill(0), iv: new Array(years.length).fill(0), auto: new Array(years.length).fill(0), ever: 0 });
        const s = series.get(c);
        s.ever++;
        for (let y = Math.max(FIRST, t.from); y <= Math.min(last, t.to); y++) {
          s.all[yi(y)]++;
          if (t.iv) s.iv[yi(y)]++;
          if (t.auto) s.auto[yi(y)]++;
        }
      }
    }
    const maxOf = (k) => d3.max([...series.values()], (s) => d3.max(s[k])) || 1;
    const now = byYear[byYear.length - 1], before = byYear[byYear.length - 2];
    const chinaLeads = now.china > now.usa;
    const leads = (y) => (chinaLeads ? y.china > y.usa : y.usa > y.china);
    let i = byYear.length - 1;
    while (i > 0 && leads(byYear[i - 1])) i--;
    const dataDate = T.filter((t) => t.end_rule === "ongoing: until today").map((t) => t.end).sort().pop();
    const countries = [...series.values()].sort((a, b) => b.ever - a.ever || a.country.localeCompare(b.country));
    return { T, world, geo, years, yi, last, byYear, starts, series, countries, now, before,
             max: { all: maxOf("all"), iv: maxOf("iv"), auto: maxOf("auto") },
             leader: chinaLeads ? "China" : "the USA", runnerUp: chinaLeads ? "the USA" : "China", leaderSince: byYear[i].year, dataDate };
  }
  const running = (y) => D.T.filter((t) => t.from <= y && t.to >= y);
  const yearRow = (y) => D.byYear[D.yi(y)];
  const recordUrl = (t) => {
    const id = t.id.split(" = ")[0];
    return t.registry === "ClinicalTrials.gov" ? `https://clinicaltrials.gov/study/${encodeURIComponent(id)}` : `https://trialsearch.who.int/Trial2.aspx?TrialID=${encodeURIComponent(id)}`;
  };

  /* ---------- CSV downloads ---------- */
  const CSV = {};
  function downloadCsv(name, columns, rows) {
    const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const text = [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = el("a", { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-csv]");
    if (b && CSV[b.dataset.csv]) CSV[b.dataset.csv]();
  });

  /* ---------- tooltip ---------- */
  const tipEl = $("#tip");
  function showTip(e, head, rows) {
    tipEl.replaceChildren(el("div", { class: "tip-head", text: head }), ...rows.map(([color, name, value]) => {
      const r = el("div", { class: "tip-row" });
      if (color) r.append(el("i", { class: "sw", style: `background:${color}` }));
      r.append(el("span", { text: name }), el("span", { class: "v", text: value }));
      return r;
    }));
    tipEl.style.display = "block";
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = e.clientX + 16, y = e.clientY + 14;
    if (x + w > window.innerWidth - 8) x = e.clientX - 16 - w;
    if (y + h > window.innerHeight - 8) y = e.clientY - 14 - h;
    tipEl.style.left = Math.max(8, x) + "px"; tipEl.style.top = Math.max(8, y) + "px";
  }
  const hideTip = () => { tipEl.style.display = "none"; };

  /* ---------- chart helpers ---------- */
  function measure(svg, cls, text) {
    const t = svg.append("text").attr("class", cls).text(text);
    const w = t.node().getComputedTextLength(); t.remove(); return w;
  }
  function yearTicks(years, width, minGap = 44) {
    const step = Math.max(1, Math.ceil((years.length * minGap) / Math.max(1, width)));
    return years.filter((y, i) => (years.length - 1 - i) % step === 0);
  }

  // Line chart: opts.series = [{name, color, values:[{x,y}], dashed}], one shared x (years)
  function lineChart(box, opts) {
    const W = Math.max(260, box.clientWidth || 600);
    const H = opts.height || Math.round(Math.min(340, Math.max(220, W * 0.46)));
    box.replaceChildren();
    const svg = d3.select(box).append("svg").attr("width", W).attr("height", H).attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", opts.label || "");
    const yfmt = opts.yfmt || fmt;
    const all = opts.series.flatMap((s) => s.values.map((v) => v.y));
    const yS = d3.scaleLinear([0, (opts.yMax || d3.max(all) || 1) * 1.06], [H - 24, 10]).nice();
    const ticks = yS.ticks(5);
    const left = d3.max(ticks, (t) => measure(svg.append("g").attr("class", "axis"), "", yfmt(t))) + 12;
    const ends = opts.series.map((s) => { const v = s.values[s.values.length - 1]; return { s, v: v.y, text: `${s.name} ${yfmt(v.y)}` }; });
    // on narrow charts the end labels move to a legend under the chart
    const compact = opts.endLabels !== false && W < 520;
    if (compact) opts = { ...opts, endLabels: false };
    const right = opts.endLabels === false ? 14 : d3.max(ends, (e) => measure(svg, "end-label", e.text)) + 26;
    if (compact) {
      box.append(el("div", { class: "legend", style: "margin-top:8px" }, ...ends.map((e) =>
        el("span", {}, el("i", { class: "sw-line" + (e.s.dashed ? " sw-dash" : ""), style: `border-color:${e.s.color}` }), e.text))));
    }
    svg.selectAll("g.axis").remove();
    const xs = opts.series[0].values.map((v) => v.x);
    const x0 = d3.min(opts.series, (s) => s.values[0].x), x1 = d3.max(opts.series, (s) => s.values[s.values.length - 1].x);
    const xS = d3.scaleLinear([x0, x1], [left, W - right]);
    const g = svg.append("g").attr("class", "axis");
    for (const t of ticks) {
      g.append("line").attr("class", t === 0 ? "baseline" : "gridline").attr("x1", left).attr("x2", W - right).attr("y1", yS(t)).attr("y2", yS(t));
      g.append("text").attr("x", left - 8).attr("y", yS(t)).attr("dy", "0.32em").attr("text-anchor", "end").text(yfmt(t));
    }
    const allYears = d3.range(x0, x1 + 1);
    for (const y of yearTicks(allYears, W - left - right)) g.append("text").attr("x", xS(y)).attr("y", H - 4).attr("text-anchor", "middle").text(y);
    for (const a of opts.annotations || []) {
      svg.append("line").attr("class", "annot-line").attr("x1", xS(a.x)).attr("x2", xS(a.x)).attr("y1", 14).attr("y2", H - 24);
      svg.append("text").attr("class", "annot").attr("x", xS(a.x) + 5).attr("y", 20).text(a.label);
    }
    if (opts.rule != null) svg.append("line").attr("class", "annot-line").attr("x1", xS(opts.rule)).attr("x2", xS(opts.rule)).attr("y1", 10).attr("y2", H - 24);
    for (const s of opts.series) {
      svg.append("path").attr("class", "series" + (s.dashed ? " dashed" : "")).style("stroke", s.color)
        .attr("d", d3.line().x((d) => xS(d.x)).y((d) => yS(d.y))(s.values));
      if (s.area) svg.insert("path", ".series").style("fill", s.color).style("fill-opacity", 0.12)
        .attr("d", d3.area().x((d) => xS(d.x)).y0(yS(0)).y1((d) => yS(d.y))(s.values));
    }
    if (opts.endLabels !== false) {
      const placed = ends.map((e) => ({ ...e, ly: yS(e.v) })).sort((a, b) => a.ly - b.ly);
      for (let i = 1; i < placed.length; i++) placed[i].ly = Math.max(placed[i].ly, placed[i - 1].ly + 15);
      const over = placed.length ? placed[placed.length - 1].ly - (H - 26) : 0;
      if (over > 0) placed.forEach((p) => { p.ly -= over; });
      for (let i = placed.length - 2; i >= 0; i--) placed[i].ly = Math.min(placed[i].ly, placed[i + 1].ly - 15);
      for (const p of placed) {
        const xe = W - right + 7;
        svg.append("line").attr("x1", xe).attr("x2", xe + 11).attr("y1", p.ly).attr("y2", p.ly).style("stroke", p.s.color).attr("stroke-width", 2.2).attr("stroke-dasharray", p.s.dashed ? "3 2" : null);
        svg.append("text").attr("class", "end-label").attr("x", xe + 15).attr("y", p.ly).attr("dy", "0.32em").text(p.text);
      }
    }
    const hover = svg.append("g").style("pointer-events", "none").style("display", "none");
    const nearest = (e) => Math.max(x0, Math.min(x1, Math.round(xS.invert(d3.pointer(e, svg.node())[0]))));
    svg.append("rect").attr("x", left).attr("y", 0).attr("width", Math.max(0, W - left - right)).attr("height", H - 24).attr("fill", "transparent")
      .style("cursor", opts.onClick ? "pointer" : "crosshair")
      .on("pointermove", (e) => {
        const x = nearest(e);
        hover.style("display", null).selectAll("*").remove();
        hover.append("line").attr("class", "hover-rule").attr("x1", xS(x)).attr("x2", xS(x)).attr("y1", 10).attr("y2", H - 24);
        const rows = [];
        for (const s of opts.series) {
          const v = s.values.find((d) => d.x === x); if (!v) continue;
          hover.append("circle").attr("cx", xS(x)).attr("cy", yS(v.y)).attr("r", 4).style("fill", s.color).style("stroke", "var(--panel)").attr("stroke-width", 1.5);
          rows.push([s.color, s.name, yfmt(v.y)]);
        }
        showTip(e, opts.tipHead ? opts.tipHead(x) : String(x), (opts.tipExtra ? opts.tipExtra(x) : []).concat(rows));
      })
      .on("pointerleave", () => { hover.style("display", "none"); hideTip(); })
      .on("click", (e) => { if (opts.onClick) { hideTip(); opts.onClick(nearest(e)); } });
    return xs;
  }

  // Vertical bars: opts.data = [{x, value, inner}] (inner drawn over value, e.g. in vivo)
  function barChart(box, opts) {
    const W = Math.max(260, box.clientWidth || 600);
    const H = opts.height || Math.round(Math.min(300, Math.max(210, W * 0.42)));
    box.replaceChildren();
    const svg = d3.select(box).append("svg").attr("width", W).attr("height", H).attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", opts.label || "");
    const yS = d3.scaleLinear([0, (d3.max(opts.data, (d) => d.value) || 1) * 1.08], [H - 24, 10]).nice();
    const ticks = yS.ticks(4);
    const left = d3.max(ticks, (t) => measure(svg, "", fmt(t))) + 14;
    const xS = d3.scaleBand(opts.data.map((d) => d.x), [left, W - 8]).padding(0.22);
    const g = svg.append("g").attr("class", "axis");
    for (const t of ticks) {
      g.append("line").attr("class", t === 0 ? "baseline" : "gridline").attr("x1", left).attr("x2", W - 8).attr("y1", yS(t)).attr("y2", yS(t));
      g.append("text").attr("x", left - 8).attr("y", yS(t)).attr("dy", "0.32em").attr("text-anchor", "end").text(fmt(t));
    }
    for (const y of yearTicks(opts.data.map((d) => d.x), W - left)) g.append("text").attr("x", xS(y) + xS.bandwidth() / 2).attr("y", H - 4).attr("text-anchor", "middle").text(y);
    const bw = Math.min(28, xS.bandwidth());
    for (const d of opts.data) {
      const x = xS(d.x) + (xS.bandwidth() - bw) / 2;
      const partial = opts.partial === d.x;
      svg.append("rect").attr("x", x).attr("y", yS(d.value)).attr("width", bw).attr("height", yS(0) - yS(d.value)).attr("rx", 2)
        .style("fill", opts.color || "var(--all)").style("fill-opacity", partial ? 0.45 : 0.85);
      if (d.inner) svg.append("rect").attr("x", x).attr("y", yS(d.inner)).attr("width", bw).attr("height", yS(0) - yS(d.inner)).attr("rx", 2).style("fill", "var(--invivo)").style("fill-opacity", partial ? 0.55 : 1);
      if (d.line != null) svg.append("line").attr("x1", x - 3).attr("x2", x + bw + 3).attr("y1", yS(d.line)).attr("y2", yS(d.line)).style("stroke", "var(--text)").attr("stroke-width", 2.5);
      svg.append("rect").attr("x", xS(d.x)).attr("y", 0).attr("width", xS.bandwidth()).attr("height", H - 24).attr("fill", "transparent")
        .on("pointermove", (e) => showTip(e, String(d.x) + (partial ? " (so far)" : ""), opts.tipRows(d)))
        .on("pointerleave", hideTip);
    }
    if (opts.partial != null && xS(opts.partial) != null && xS.bandwidth() >= 40) svg.append("text").attr("class", "annot").attr("x", xS(opts.partial) + xS.bandwidth() / 2).attr("y", yS(opts.data.find((d) => d.x === opts.partial).value) - 6).attr("text-anchor", "middle").text("so far");
  }

  // Draw a chart, then let it grow to fill its card when the card beside it is taller
  function fillCard(box, draw) {
    draw(undefined);
    const card = box.closest(".card"), svg = box.querySelector("svg");
    if (!card || !svg || narrow()) return;
    const cs = getComputedStyle(card);
    const inner = card.getBoundingClientRect().bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth);
    const extra = Math.floor(inner - card.lastElementChild.getBoundingClientRect().bottom);
    if (extra > 20) draw(Math.min(+svg.getAttribute("height") + extra, 440));
  }

  function hbars(box, rows, opts = {}) {
    const max = opts.max || d3.max(rows, (r) => r.value) || 1;
    box.replaceChildren(...rows.map((r) => {
      if (r.group) return el("div", { class: "bar-group-title", text: r.group });
      const track = el("span", { class: "hbar-track" }, el("span", { class: "hbar-fill" + (r.ivOnly ? " iv" : ""), style: `width:${(r.value / max) * 100}%` }));
      if (r.iv) track.append(el("span", { class: "hbar-fill iv", style: `width:${(r.iv / max) * 100}%` }));
      const name = el("span", { class: "hbar-name", text: r.label, title: r.label });
      const row = el(r.onClick ? "button" : "div", { class: "hbar" + (r.onClick ? "" : " static"), type: r.onClick ? "button" : null }, name, track, el("span", { class: "hbar-val", text: fmt(r.value) }));
      if (r.onClick) row.addEventListener("click", r.onClick);
      return row;
    }));
  }

  function sparkline(box, values, color) {
    const W = Math.max(80, box.clientWidth || 160), H = 30;
    box.replaceChildren();
    const x = d3.scaleLinear([0, values.length - 1], [1, W - 3]);
    const y = d3.scaleLinear([0, d3.max(values) || 1], [H - 2, 3]);
    const svg = d3.select(box).append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "none").attr("aria-hidden", "true");
    svg.append("path").attr("d", d3.area().x((d, i) => x(i)).y0(H).y1((d) => y(d))(values)).style("fill", color).style("fill-opacity", 0.14);
    svg.append("path").attr("d", d3.line().x((d, i) => x(i)).y((d) => y(d))(values)).style("fill", "none").style("stroke", color).attr("stroke-width", 1.6);
    svg.append("circle").attr("cx", x(values.length - 1)).attr("cy", y(values[values.length - 1])).attr("r", 2.6).style("fill", color);
  }

  // colour ramp for counts (log scale), read from the theme
  function ramp(max) {
    const lo = cssVar("--ramp-lo"), hi = cssVar("--ramp-hi"), top = cssVar("--ramp-top"), land = cssVar("--land");
    const t = (v) => Math.log1p(v) / Math.log1p(max);
    const interp = (u) => (u < 0.75 ? d3.interpolateRgb(lo, hi)(u / 0.75) : d3.interpolateRgb(hi, top)((u - 0.75) / 0.25));
    const f = (v) => (v > 0 ? interp(t(v)) : land);
    f.interp = interp; f.t = t;
    return f;
  }

  /* ---------- OVERVIEW ---------- */
  function renderOverview() {
    const n = D.now, b = D.before, y = n.year;
    $("#ov-lede").replaceChildren(
      "In ", el("b", { text: y }), ", ", el("b", { text: fmt(n.world) }), " CAR-T and TCR-T trials are running, with sites in ",
      el("b", { text: n.countries }), " countries. Since ", el("b", { text: D.leaderSince }), ", ", el("b", { text: D.leader }),
      " has had more running trials than ", el("b", { text: D.runnerUp }), " every year. In vivo trials, where the engineered cells are made inside the patient's body, number ",
      el("b", { text: fmt(n.in_vivo) }), ", against ", el("b", { text: fmt(b.in_vivo) }), " a year earlier.");
    const cards = [
      ["Worldwide", "world", "var(--all)", "#trends"], ["China", "china", COL.China, "#map=China"], ["USA", "usa", COL.USA, "#map=United States of America"],
      ["Europe", "europe", COL.Europe, "#sec-race"], ["Rest of world", "rest_of_world", COL["Rest of world"], "#map"], ["In vivo", "in_vivo", COL["In vivo"], "#invivo"],
    ];
    $("#kpis").replaceChildren(...cards.map(([label, key, color, href]) => {
      const spark = el("div", { class: "kpi-spark" });
      const card = el("a", { class: "kpi", href, style: `--k:${color}` },
        el("span", { class: "kpi-label" }, el("i", { class: "dot", style: `background:${color}` }), label),
        el("span", { class: "kpi-value", text: fmt(n[key]) }),
        el("span", { class: "kpi-sub", text: `${signed(n[key] - b[key])} vs ${b.year} · running in ${y}` }), spark);
      requestAnimationFrame(() => sparkline(spark, D.byYear.map((r) => r[key]), color));
      return card;
    }));
    // top countries
    const top = D.countries.map((s) => ({ s, v: s.all[D.yi(y)] })).filter((r) => r.v > 0).sort((a, c) => c.v - a.v).slice(0, 15);
    hbars($("#top-countries"), top.map(({ s, v }) => ({ label: s.country, value: v, iv: s.iv[D.yi(y)], onClick: () => goMap(s.country) })));
    CSV["top-countries"] = () => downloadCsv(`top-countries-${y}.csv`, ["country", "region", "running_trials", "in_vivo"],
      D.countries.map((s) => ({ country: s.country, region: s.region, running_trials: s.all[D.yi(y)], in_vivo: s.iv[D.yi(y)] })).filter((r) => r.running_trials > 0).sort((a, c) => c.running_trials - a.running_trials));
    // starts
    fillCard($("#starts-chart"), (height) => barChart($("#starts-chart"), { label: "New trials by start year", height, data: D.starts.map((s) => ({ x: s.year, value: s.all, inner: s.in_vivo })), partial: D.last,
      tipRows: (d) => [["var(--all)", "New trials", fmt(d.value)], ["var(--invivo)", "Of which in vivo", fmt(d.inner)]] }));
    CSV.starts = () => downloadCsv("new-trials-by-start-year.csv", ["year", "new_trials", "in_vivo"], D.starts.map((s) => ({ year: s.year, new_trials: s.all, in_vivo: s.in_vivo })));
    // regions
    regionsChart($("#regions-chart"));
    CSV.regions = () => downloadCsv("running-trials-by-region.csv", ["year", "world", "china", "usa", "europe", "rest_of_world", "in_vivo"], D.byYear);
  }
  function regionsChart(box, rule) {
    const series = REGIONS.map(([name, key]) => ({ name, color: COL[name], values: D.byYear.map((r) => ({ x: r.year, y: r[key] })) }));
    const first = D.byYear.findIndex((r) => r.in_vivo > 0);
    if (first >= 0) series.push({ name: "In vivo (world)", color: COL["In vivo"], dashed: true, values: D.byYear.slice(Math.max(0, first - 1)).map((r) => ({ x: r.year, y: r.in_vivo })) });
    lineChart(box, { label: "Running trials by region", series, rule,
      tipExtra: (x) => [[null, "Worldwide", fmt(yearRow(x).world)]],
      annotations: [{ x: D.leaderSince, label: `${D.leader} ahead from ${D.leaderSince}` }],
      onClick: (x) => { S.year = x; goMap(null); } });
  }

  /* ---------- MAP ---------- */
  let zoom = null, mapReady = false, colorOf = null;
  function buildMap() {
    const land = d3.select("#map-land"), dots = d3.select("#map-dots");
    land.selectAll("path").data(D.world.filter((c) => c.path), (c) => c.country).join("path")
      .attr("class", (c) => "country" + (D.series.has(c.country) ? " has-data" : "")).attr("d", (c) => c.path);
    const small = D.world.filter((c) => !c.path && c.x !== "" && D.series.has(c.country));
    dots.selectAll("circle").data(small, (c) => c.country).join("circle").attr("class", "small-dot").attr("cx", (c) => +c.x).attr("cy", (c) => +c.y).attr("r", 2.6);
    const svg = d3.select("#map-svg");
    zoom = d3.zoom().scaleExtent([1, 12]).translateExtent([[-600, -500], [1600, 939]])
      .on("zoom", (e) => {
        if (!e.sourceEvent || e.sourceEvent.type === "wheel") hideTip();
        d3.select("#map-zoom").attr("transform", e.transform);
        dots.selectAll("circle").attr("r", 2.6 / Math.sqrt(e.transform.k));
      });
    svg.call(zoom).on("dblclick.zoom", null);
    const pick = (e) => { const d = d3.select(e.target).datum(); return d && D.series.has(d.country) ? d : null; };
    svg.on("pointermove", (e) => {
      const d = pick(e);
      land.selectAll("path").classed("is-hover", (c) => d && c.country === d.country);
      if (!d || e.pointerType === "touch") { hideTip(); return; }
      const s = D.series.get(d.country), i = D.yi(mapYear());
      showTip(e, `${d.country} · ${mapYear()}`, [["var(--all)", "Running trials", fmt(s.all[i])], ["var(--invivo)", "In vivo", fmt(s.iv[i])], ["var(--autoimmune)", "Autoimmune", fmt(s.auto[i])]]);
    }).on("pointerleave", () => { hideTip(); land.selectAll("path").classed("is-hover", false); })
      .on("click", (e) => { const d = pick(e); if (d) selectCountry(d.country, true); });
    $("#zoom-in").addEventListener("click", () => svg.transition().duration(300).call(zoom.scaleBy, 1.6));
    $("#zoom-out").addEventListener("click", () => svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.6));
    $("#zoom-reset").addEventListener("click", () => goHome(true));
    $$("#map-layer button").forEach((b) => b.addEventListener("click", () => { S.layer = b.dataset.layer; updateMap(); if (S.country) renderPanel(); }));
    const range = $("#map-range");
    range.min = D.years[0]; range.max = D.last;
    $("#year-min").textContent = D.years[0]; $("#year-max").textContent = D.last;
    range.addEventListener("input", () => { stopPlay(); S.year = +range.value; updateMap(); if (S.country) renderPanel(); });
    $("#map-playbtn").addEventListener("click", togglePlay);
    $("#pn-close").addEventListener("click", () => closePanel(true));
    setupSearch();
    mapReady = true;
    goHome(false);
  }
  const mapYear = () => (D.years.includes(S.year) ? S.year : D.last);
  function updateMap() {
    const y = mapYear(), i = D.yi(y), layer = S.layer;
    colorOf = ramp(D.max[layer]);
    d3.select("#map-land").selectAll("path").style("fill", (c) => { const s = D.series.get(c.country); return colorOf(s ? s[layer][i] : 0); })
      .classed("is-picked", (c) => c.country === S.country);
    d3.select("#map-dots").selectAll("circle").style("fill", (c) => { const s = D.series.get(c.country); return colorOf(s ? s[layer][i] : 0); })
      .classed("is-picked", (c) => c.country === S.country);
    $("#map-year").textContent = y;
    const row = yearRow(y);
    const total = layer === "all" ? row.world : layer === "iv" ? row.in_vivo : row.autoimmune;
    const nC = [...D.series.values()].filter((s) => s[layer][i] > 0).length;
    $("#map-stat").textContent = `${fmt(total)} trials · ${nC} countries`;
    $("#map-range").value = y;
    $$("#map-layer button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.layer === layer)));
    // legend
    $("#ramp-label").textContent = LAYERS[layer];
    const max = D.max[layer];
    const stops = d3.range(0, 1.0001, 0.1).map((u) => `${colorOf.interp(u)} ${u * 100}%`).join(", ");
    $("#ramp-bar").style.background = `linear-gradient(90deg, ${stops})`;
    const ticks = [1, 3, 10, 30, 100, 300, 1000].filter((v) => v < max * 0.8).concat([max]);
    $("#ramp-ticks").replaceChildren(...ticks.map((v) => el("span", { text: fmt(v), style: `position:absolute;left:${colorOf.t(v) * 100}%;transform:translateX(-${colorOf.t(v) * 100}%)` })));
    $("#ramp-ticks").style.position = "relative"; $("#ramp-ticks").style.height = "14px";
  }
  // The part of the map not covered by the title card, play bar or country panel (screen pixels)
  function freeArea() {
    const svg = $("#map-svg"), r = svg.getBoundingClientRect(), panel = $("#panel");
    const open = panel.classList.contains("open");
    const playTop = $(".map-play").getBoundingClientRect().top - 8;
    const a = { svg, left: r.left, right: r.right, top: r.top, bottom: playTop };
    if (narrow()) {
      a.top = $(".map-title").getBoundingClientRect().bottom + 8;
      if (open) a.bottom = r.bottom - 10 - panel.offsetHeight - 8;
    } else if (open) a.right = r.right - 16 - panel.offsetWidth - 8;
    return a;
  }
  // Zoom transform that fits a box (map units) into the free area
  function fitTransform(x0, y0, x1, y1, kMax, pad) {
    const a = freeArea(), ctm = a.svg.getScreenCTM();
    if (!ctm || a.bottom - a.top < 40) return d3.zoomIdentity;
    const inv = ctm.inverse(), pt = a.svg.createSVGPoint();
    pt.x = a.left; pt.y = a.top; const p0 = pt.matrixTransform(inv);
    pt.x = a.right; pt.y = a.bottom; const p1 = pt.matrixTransform(inv);
    const k = Math.max(1, Math.min(kMax, pad * Math.min((p1.x - p0.x) / Math.max(1, x1 - x0), (p1.y - p0.y) / Math.max(1, y1 - y0))));
    return d3.zoomIdentity.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2).scale(k).translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
  }
  const homeTransform = () => (narrow() ? fitTransform(110, 30, 960, 400, 3, 1) : fitTransform(0, 0, 1000, 439, 1.4, 1));
  function goHome(animate) {
    const svg = d3.select("#map-svg");
    (animate && !reduced() ? svg.transition().duration(400) : svg).call(zoom.transform, homeTransform());
  }
  const countryNode = (name) => d3.select("#map-land").selectAll("path").filter((c) => c.country === name).node()
    || d3.select("#map-dots").selectAll("circle").filter((c) => c.country === name).node();
  function hiddenByPanel(name) {
    const n = countryNode(name); if (!n) return false;
    const r = n.getBoundingClientRect(), a = freeArea();
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    return cx > a.right || cx < a.left || cy > a.bottom || cy < a.top;
  }
  function zoomToCountry(name) {
    const node = d3.select("#map-land").selectAll("path").filter((c) => c.country === name).node();
    let t;
    if (node) {
      const b = node.getBBox();
      t = fitTransform(b.x, b.y, b.x + b.width, b.y + b.height, 5, 0.6);
    } else {
      const g = D.geo.get(name); if (!g || g.x === "") return;
      t = fitTransform(+g.x - 12, +g.y - 8, +g.x + 12, +g.y + 8, 6, 0.6);
    }
    d3.select("#map-svg").transition().duration(reduced() ? 0 : 650).call(zoom.transform, t);
  }
  function selectCountry(name, fromClick) {
    if (!D.series.has(name)) return;
    S.country = name;
    hideTip();
    $("#map-hint").classList.add("gone");
    updateMap(); renderPanel();
    const p = $("#panel"); p.classList.add("open"); p.setAttribute("aria-hidden", "false");
    $("#tab-map").classList.add("panel-open");
    if (!fromClick || narrow() || hiddenByPanel(name)) zoomToCountry(name);
    setHash(`map=${encodeURIComponent(name)}`);
  }
  function closePanel(updateHash) {
    S.country = null;
    const p = $("#panel"); p.classList.remove("open"); p.setAttribute("aria-hidden", "true");
    $("#tab-map").classList.remove("panel-open");
    if (mapReady) updateMap();
    if (updateHash) setHash("map");
  }
  function renderPanel() {
    const name = S.country, s = D.series.get(name), y = mapYear(), i = D.yi(y);
    $("#pn-region").textContent = s.region;
    $("#pn-name").textContent = name;
    const ranked = [...D.series.values()].map((x) => x.all[i]).filter((v) => v > 0).sort((a, b) => b - a);
    const rank = s.all[i] > 0 ? ranked.indexOf(s.all[i]) + 1 : null;
    const here = running(y).filter((t) => t.countryList.includes(name));
    const count = (f) => d3.rollups(here, (v) => v.length, f).sort((a, b) => b[1] - a[1]);
    const chart = el("div", { class: "chart", style: "min-height:180px" });
    const sponsors = count((t) => t.sponsor || "Not given").slice(0, 5);
    const list = here.slice().sort((a, b) => String(b.start).localeCompare(String(a.start)));
    const body = $("#pn-body");
    body.replaceChildren(
      el("div", {}, el("div", { class: "panel-big" }, fmt(s.all[i]), " ", el("small", { text: `trials running in ${y}` })),
        el("div", { class: "map-stat", text: (rank ? `#${rank} of ${ranked.length} countries · ` : "") + `${fmt(s.iv[i])} in vivo · ${fmt(s.auto[i])} autoimmune · ${fmt(s.ever)} in the data since 2008` })),
      el("div", {}, el("h3", { text: "Running trials per year" }), chart,
        el("div", { class: "legend" }, el("span", {}, el("i", { class: "sw-line", style: "border-color:var(--all)" }), "All"), el("span", {}, el("i", { class: "sw-line sw-dash", style: "border-color:var(--invivo)" }), "In vivo"))),
      here.length ? el("div", { style: "display:grid;gap:8px" }, el("h3", { text: `In ${y}` }),
        el("div", { class: "chips" }, ...count((t) => t.indication).map(([k, v]) => el("span", { class: "chip" }, `${k} `, el("b", { text: v }))),
          ...count((t) => t.modality).map(([k, v]) => el("span", { class: "chip" }, `${k} `, el("b", { text: v }))),
          ...count((t) => t.approach).map(([k, v]) => el("span", { class: "chip" }, `${k} `, el("b", { text: v })))),
        el("div", { class: "card-note", text: "Most trials: " + sponsors.map(([k, v]) => `${k} (${v})`).join(" · ") })) : null,
      el("div", { class: "panel-actions" },
        el("button", { class: "icon-btn", type: "button", onclick: () => downloadCsv(`${name.replace(/[^A-Za-z0-9]+/g, "-")}-trials.csv`, ["id", "registry", "title", "status", "start", "end", "end_rule", "phase", "sponsor", "modality", "approach", "indication", "countries"], D.T.filter((t) => t.countryList.includes(name))) }, "↓ CSV of all its trials"),
        el("a", { class: "icon-btn", href: "#trials", onclick: () => { S.fcountry = name; S.fyear = String(y); } }, "Open in trial list")),
      el("div", {}, el("h3", { text: `Trials running in ${y}`, style: "margin-bottom:6px" }),
        el("ul", { class: "trial-list" }, ...list.slice(0, 40).map((t) => el("li", {},
          el("a", { href: recordUrl(t), target: "_blank", rel: "noopener noreferrer", text: t.title }),
          el("div", { class: "meta", text: `${t.id.split(" = ")[0]} · ${t.start} · ${t.approach} · ${t.indication}` })))),
        list.length > 40 ? el("p", { class: "card-note", text: `…and ${list.length - 40} more in the trial list.` }) : null));
    requestAnimationFrame(() => {
      const first = s.iv.findIndex((v) => v > 0);
      const series = [{ name: "All", color: "var(--all)", area: true, values: D.years.map((yy, k) => ({ x: yy, y: s.all[k] })) }];
      if (first >= 0) series.push({ name: "In vivo", color: "var(--invivo)", dashed: true, values: D.years.slice(Math.max(0, first - 1)).map((yy) => ({ x: yy, y: s.iv[D.yi(yy)] })) });
      lineChart(chart, { label: `Running trials per year in ${name}`, series, height: 180, endLabels: false, rule: y, onClick: (x) => { S.year = x; updateMap(); renderPanel(); } });
    });
  }
  function setupSearch() {
    const input = $("#map-q"), list = $("#map-suggest");
    let active = -1, items = [];
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      items = q ? D.countries.filter((s) => s.country.toLowerCase().includes(q)).slice(0, 8) : [];
      list.hidden = !items.length; active = Math.min(active, items.length - 1);
      list.replaceChildren(...items.map((s, k) => el("li", {}, el("button", { type: "button", class: k === active ? "active" : "", onclick: () => go(s.country) },
        el("span", { text: s.country }), el("span", { class: "n", text: `${fmt(s.all[D.yi(mapYear())])} now` })))));
    };
    const go = (name) => { input.value = ""; list.hidden = true; input.blur(); selectCountry(name, false); };
    input.addEventListener("input", () => { active = -1; draw(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { active = Math.min(items.length - 1, active + 1); draw(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
      else if (e.key === "Enter" && items.length) { go(items[Math.max(0, active)].country); }
      else if (e.key === "Escape") { input.value = ""; draw(); }
    });
    input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 200));
  }
  let timer = null;
  function togglePlay() {
    if (timer) { stopPlay(); return; }
    if (mapYear() >= D.last) S.year = D.years[0];
    S.playing = true; $("#map-playbtn").setAttribute("aria-pressed", "true"); $("#play-ic").textContent = "❚❚"; $("#play-lab").textContent = "Pause";
    updateMap(); if (S.country) renderPanel();
    timer = setInterval(() => {
      const y = mapYear();
      if (y >= D.last) { stopPlay(); return; }
      S.year = y + 1; updateMap(); if (S.country) renderPanel();
      if (S.year >= D.last) stopPlay();
    }, 850);
  }
  function stopPlay() {
    if (timer) clearInterval(timer);
    timer = null; S.playing = false;
    $("#map-playbtn").setAttribute("aria-pressed", "false"); $("#play-ic").textContent = "▶"; $("#play-lab").textContent = "Play";
  }
  function goMap(country) {
    location.hash = country ? `map=${encodeURIComponent(country)}` : "map";
  }

  /* ---------- TRENDS ---------- */
  function renderTrends() {
    const y = D.last, r20 = yearRow(2020), now = D.now;
    const shareTxt = (a, b) => (b && a / b < 0.01 ? "under 1%" : pct(b ? a / b : 0));
    $("#tr-lede").replaceChildren(
      "Running trials in autoimmune and immune-mediated diseases went from ", el("b", { text: fmt(r20.autoimmune) }), ` in 2020 (${shareTxt(r20.autoimmune, r20.world)} of all) to `,
      el("b", { text: fmt(now.autoimmune) }), ` in ${y} (${shareTxt(now.autoimmune, now.world)}). TCR-T trials make up `, el("b", { text: pct(now.tcrt / now.world) }),
      " of the total. China has sites in ", el("b", { text: pct(now.china / now.world) }), " of running trials and the USA in ", el("b", { text: pct(now.usa / now.world) }), ".");
    const ys = (k) => D.byYear.map((r) => ({ x: r.year, y: r[k] }));
    lineChart($("#ind-chart"), { label: "Running trials by indication", series: [
      { name: "Cancer", color: COL.Cancer, values: ys("cancer") },
      { name: "Autoimmune", color: COL["Autoimmune & immune-mediated"], values: ys("autoimmune") },
      { name: "Other", color: COL.Other, values: ys("other") }] });
    CSV.indication = () => downloadCsv("running-trials-by-indication.csv", ["year", "cancer", "autoimmune", "other"], D.byYear);
    lineChart($("#cell-chart"), { label: "CAR-T and TCR-T trials", series: [
      { name: "CAR-T", color: COL["CAR-T"], values: ys("cart") },
      { name: "TCR-T", color: COL["TCR-T"], values: ys("tcrt") }] });
    CSV.cells = () => downloadCsv("running-trials-car-t-tcr-t.csv", ["year", "cart", "tcrt"], D.byYear);
    const share = (k) => D.byYear.map((r) => ({ x: r.year, y: r.world ? r[k] / r.world : 0 }));
    lineChart($("#share-chart"), { label: "Share of running trials in China and the USA", yfmt: pct, yMax: 1, height: 280,
      series: [{ name: "China", color: COL.China, values: share("china") }, { name: "USA", color: COL.USA, values: share("usa") },
               { name: "Europe", color: COL.Europe, values: share("europe") }],
      annotations: [{ x: D.leaderSince, label: `${D.leader} ahead from ${D.leaderSince}` }],
      tipExtra: (x) => [[null, "Running worldwide", fmt(yearRow(x).world)]] });
    CSV.share = () => downloadCsv("share-china-usa-europe.csv", ["year", "world", "china_share", "usa_share", "europe_share"],
      D.byYear.map((r) => ({ year: r.year, world: r.world, china_share: (r.china / r.world).toFixed(3), usa_share: (r.usa / r.world).toFixed(3), europe_share: (r.europe / r.world).toFixed(3) })));
    heatmap($("#heat"));
  }
  const SHORT = { "United States of America": "USA", "United Kingdom": "UK" };
  function heatmap(box) {
    const i = D.yi(D.last);
    const rows = [...D.series.values()].filter((s) => s.all[i] > 0).sort((a, b) => b.all[i] - a.all[i]).slice(0, 20);
    box.replaceChildren();
    const W0 = Math.max(300, box.clientWidth || 700);
    const small = W0 < 600;
    const years = small ? D.years.filter((y) => y > D.last - 12) : D.years;   // phones: last 12 years
    const name = (c) => (small && SHORT[c]) || c;
    const svg0 = d3.select(box).append("svg");
    const labW = d3.max(rows, (r) => measure(svg0, "heat-label", name(r.country))) + 12;
    svg0.remove();
    const cw = Math.max(18, (W0 - labW - 8) / years.length), ch = 20;
    const W = labW + cw * years.length + 8, H = rows.length * ch + 26;
    const color = ramp(D.max.all);
    const svg = d3.select(box).append("svg").attr("width", W).attr("height", H).attr("role", "img").attr("aria-label", "Running trials per country and year");
    rows.forEach((r, ri) => {
      svg.append("text").attr("class", "heat-label").attr("x", labW - 8).attr("y", ri * ch + ch / 2).attr("dy", "0.32em").attr("text-anchor", "end").text(name(r.country))
        .style("cursor", "pointer").on("click", () => goMap(r.country));
      years.forEach((y, col) => {
        const k = D.yi(y);
        svg.append("rect").attr("class", "heat-cell").attr("x", labW + col * cw).attr("y", ri * ch).attr("width", cw).attr("height", ch).attr("rx", 2)
          .style("fill", r.all[k] ? color(r.all[k]) : "var(--bg-raised)").style("cursor", "pointer")
          .on("pointermove", (e) => showTip(e, `${r.country} · ${y}`, [["var(--all)", "Running trials", fmt(r.all[k])], ["var(--invivo)", "In vivo", fmt(r.iv[k])]]))
          .on("pointerleave", hideTip)
          .on("click", () => { S.year = y; goMap(r.country); });
      });
    });
    const g = svg.append("g").attr("class", "axis");
    for (const y of yearTicks(years, cw * years.length, 40)) g.append("text").attr("x", labW + years.indexOf(y) * cw + cw / 2).attr("y", H - 6).attr("text-anchor", "middle").text(y);
    // the CSV always holds every year
    CSV.heat = () => downloadCsv("running-trials-country-by-year.csv", ["country", ...D.years.map(String)],
      rows.map((r) => Object.fromEntries([["country", r.country], ...D.years.map((y, k) => [String(y), r.all[k]])])));
  }

  /* ---------- IN VIVO ---------- */
  function renderInvivo() {
    const y = D.last, i = D.yi(y);
    const iv = D.T.filter((t) => t.iv);
    const runIv = running(y).filter((t) => t.iv);
    const startedNow = iv.filter((t) => t.from === y).length;
    const ivCountries = new Set(runIv.flatMap((t) => t.countryList)).size;
    const chinaShare = runIv.filter((t) => t.countryList.includes("China")).length;
    $("#iv-lede").replaceChildren(`In ${y}, `, el("b", { text: fmt(runIv.length) }), " in vivo trials are running, ", el("b", { text: fmt(chinaShare) }), " of them with a site in China.");
    const cards = [
      ["Running", fmt(runIv.length), `${signed(runIv.length - D.before.in_vivo)} vs ${y - 1}`, "var(--invivo)"],
      [`Started in ${y}`, fmt(startedNow), `${fmt(iv.filter((t) => t.from === y - 1).length)} started in ${y - 1}`, "var(--invivo)"],
      ["Countries", fmt(ivCountries), "with a running in vivo trial", "var(--invivo)"],
      ["Autoimmune", fmt(runIv.filter((t) => t.auto).length), `of ${fmt(runIv.length)} running in vivo trials`, "var(--autoimmune)"],
    ];
    $("#iv-kpis").replaceChildren(...cards.map(([label, value, sub, color]) => el("div", { class: "kpi", style: `--k:${color}` },
      el("span", { class: "kpi-label" }, el("i", { class: "dot", style: `background:${color}` }), label), el("span", { class: "kpi-value", text: value }), el("span", { class: "kpi-sub", text: sub }))));
    const firstYear = d3.min(iv, (t) => t.from) || y;
    const yrs = D.years.filter((yy) => yy >= Math.max(FIRST, firstYear - 1));
    CSV["iv-years"] = () => downloadCsv("in-vivo-trials-by-year.csv", ["year", "running", "started"], yrs.map((yy) => ({ year: yy, running: yearRow(yy).in_vivo, started: iv.filter((t) => t.from === yy).length })));
    const groups = [["Where", ["China", "USA", "Europe", "Rest of world"], (t, l) => t.regions.has(l)],
                    ["Indication", ["Cancer", "Autoimmune & immune-mediated", "Other"], (t, l) => t.indication === l],
                    ["Cell type", ["CAR-T", "TCR-T"], (t, l) => t.modality === l]];
    const rows = [];
    for (const [g, labels, f] of groups) {
      rows.push({ group: g });
      for (const l of labels) { const v = runIv.filter((t) => f(t, l)).length; if (v || g !== "Cell type") rows.push({ label: l, value: v, ivOnly: true }); }
    }
    hbars($("#iv-bars"), rows, { max: runIv.length || 1 });
    fillCard($("#iv-chart"), (height) => barChart($("#iv-chart"), { label: "In vivo trials each year", color: "var(--invivo)", partial: y, height,
      data: yrs.map((yy) => ({ x: yy, value: yearRow(yy).in_vivo, line: iv.filter((t) => t.from === yy).length })),
      tipRows: (d) => [["var(--invivo)", "Running", fmt(d.value)], [null, "Started that year", fmt(d.line)]] }));
    const list = iv.slice().sort((a, b) => String(b.start).localeCompare(String(a.start)));
    $("#iv-count").textContent = fmt(list.length);
    const tb = $("#iv-table tbody");
    tb.replaceChildren(...list.map((t) => el("tr", {},
      el("td", {}, el("a", { href: recordUrl(t), target: "_blank", rel: "noopener noreferrer", text: t.id })),
      el("td", { text: t.title }), el("td", { text: t.countries }), el("td", { text: t.start }), el("td", { text: t.status }),
      el("td", { text: t.indication }), el("td", { text: t.modality }), el("td", { text: t.sponsor }))));
    CSV["iv-trials"] = () => downloadCsv("in-vivo-trials.csv", ["id", "registry", "title", "status", "start", "end", "phase", "sponsor", "modality", "indication", "countries"], list);
  }

  /* ---------- TRIALS ---------- */
  const COLS = ["id", "title", "countries", "start", "end", "status", "phase", "approach", "indication", "sponsor", "registry", "end_rule"];
  function setupTrials() {
    const fy = $("#f-year");
    fy.replaceChildren(el("option", { value: "", text: "All years" }), ...D.years.slice().reverse().map((y) => el("option", { value: String(y), text: `Running in ${y}` })));
    $("#f-country").append(...D.countries.map((s) => el("option", { value: s.country, text: s.country })));
    let qt;
    $("#q").addEventListener("input", (e) => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value.trim(); S.showAll = false; renderTrials(); }, 200); });
    fy.addEventListener("change", (e) => { S.fyear = e.target.value; S.showAll = false; renderTrials(); });
    $("#f-approach").addEventListener("change", (e) => { S.approach = e.target.value; S.showAll = false; renderTrials(); });
    $("#f-indication").addEventListener("change", (e) => { S.indication = e.target.value; S.showAll = false; renderTrials(); });
    $("#f-country").addEventListener("change", (e) => { S.fcountry = e.target.value; S.showAll = false; renderTrials(); });
    $$("#ttable .sort").forEach((b) => b.addEventListener("click", () => {
      const key = b.dataset.key;
      S.sort = { key, dir: S.sort.key === key ? -S.sort.dir : (key === "start" || key === "end" ? -1 : 1) };
      $$("#ttable th").forEach((th) => th.setAttribute("aria-sort", th.querySelector(".sort").dataset.key === key ? (S.sort.dir > 0 ? "ascending" : "descending") : "none"));
      renderTrials();
    }));
  }
  function trialRows() {
    const q = S.q.toLowerCase(), y = S.fyear ? +S.fyear : null;
    const rows = D.T.filter((t) => (!y || (t.from <= y && t.to >= y))
      && (!S.fcountry || t.countryList.includes(S.fcountry))
      && (!S.approach || t.approach === S.approach)
      && (!S.indication || t.indication === S.indication)
      && (!q || [t.id, t.title, t.sponsor, t.conditions, t.countries, t.registry].join(" ").toLowerCase().includes(q)));
    const { key, dir } = S.sort;
    return rows.sort((a, b) => dir * String(a[key] ?? "").localeCompare(String(b[key] ?? "")));
  }
  function renderTrials() {
    $("#f-year").value = S.fyear; $("#f-country").value = S.fcountry; $("#f-approach").value = S.approach; $("#f-indication").value = S.indication;
    const rows = trialRows(), frag = document.createDocumentFragment();
    $("#tcount").textContent = fmt(rows.length);
    const LIMIT = 300, shown = S.showAll ? rows : rows.slice(0, LIMIT);
    let more = $("#tmore");
    if (!more) {
      more = el("button", { id: "tmore", class: "icon-btn", type: "button", style: "justify-self:start", onclick: () => { S.showAll = true; renderTrials(); } });
      $("#ttable").closest(".scroll").after(more);
    }
    more.hidden = shown.length === rows.length;
    more.textContent = `Show all ${fmt(rows.length)} trials`;
    for (const t of shown) {
      const tr = el("tr");
      for (const c of COLS) tr.append(c === "id" ? el("td", {}, el("a", { href: recordUrl(t), target: "_blank", rel: "noopener noreferrer", text: t.id })) : el("td", { text: t[c] ?? "" }));
      frag.append(tr);
    }
    $("#ttable tbody").replaceChildren(frag);
    CSV.trials = () => downloadCsv("cell-therapy-trials-filtered.csv", ["id", "registry", "title", "status", "start", "end", "end_rule", "phase", "sponsor", "conditions", "modality", "approach", "indication", "countries"], rows);
  }

  /* ---------- tabs and links ---------- */
  function setHash(h) { history.replaceState(null, "", "#" + h); }
  function showTab(tab) {
    if (S.tab !== tab) {
      S.tab = tab;
      $$(".tab").forEach((s) => { s.hidden = s.dataset.tab !== tab; });
      $$(".tab-link").forEach((a) => { if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
      const cur = $(`.tab-link[data-tab="${tab}"]`), bar = $(".tabs");
      if (cur && bar && bar.scrollWidth > bar.clientWidth) bar.scrollTo({ left: cur.offsetLeft - (bar.clientWidth - cur.offsetWidth) / 2, behavior: "auto" });
      $("#footer").hidden = tab === "map";
      document.title = tab === "overview" ? "The Cell Therapy Trial Map" : `${$(`.tab-link[data-tab="${tab}"]`).textContent} · The Cell Therapy Trial Map`;
      if (tab !== "map") stopPlay();
      hideTip();
    }
    if (!D) return;
    if (!rendered.has(tab)) { renderTab(tab); rendered.add(tab); }
    else if (tab === "trials") renderTrials();
    else if (tab === "map") updateMap();
  }
  function renderTab(tab) {
    if (tab === "overview") renderOverview();
    else if (tab === "map") { if (!mapReady) buildMap(); updateMap(); }
    else if (tab === "trends") renderTrends();
    else if (tab === "invivo") renderInvivo();
    else if (tab === "trials") renderTrials();
  }
  function route() {
    const raw = decodeURIComponent(location.hash.slice(1));
    let [tab, arg] = raw.split("=");
    if (tab && tab.startsWith("sec-")) {
      const target = document.getElementById(tab);
      const owner = target && target.closest(".tab");
      if (owner) { showTab(owner.dataset.tab); requestAnimationFrame(() => target.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" })); return; }
    }
    if (!TABS.includes(tab)) tab = "overview";
    showTab(tab);
    if (tab === "map" && D) {
      if (arg && D.series.has(arg)) selectCountry(arg, false);
      else if (!arg && S.country) closePanel(false);
    }
    if (tab !== "map") window.scrollTo({ top: 0, behavior: "auto" });
  }
  window.addEventListener("hashchange", route);

  /* ---------- theme ---------- */
  function syncThemeLabel() { $("#theme-lab").textContent = document.body.classList.contains("light") ? "Dark" : "Light"; }
  $("#theme").addEventListener("click", () => {
    document.body.classList.toggle("light");
    try { localStorage.setItem("ctm-theme", document.body.classList.contains("light") ? "light" : "dark"); } catch (e) { /* storage blocked */ }
    syncThemeLabel();
    if (D) { rendered.clear(); renderTab(S.tab); rendered.add(S.tab); if (S.tab === "map" && S.country) renderPanel(); }
  });
  syncThemeLabel();

  /* ---------- resize ---------- */
  let rt, lastW = window.innerWidth;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if (!D || Math.abs(window.innerWidth - lastW) < 8) return;
      lastW = window.innerWidth;
      rendered.clear(); renderTab(S.tab); rendered.add(S.tab);
      if (S.tab === "map") { if (S.country) { renderPanel(); zoomToCountry(S.country); } else goHome(false); }
    }, 180);
  });

  /* ---------- start ---------- */
  if (CFG.newsletterUrl) {
    $("#subscribe").href = CFG.newsletterUrl; $("#subscribe").hidden = false;
    const fs = $("#footer-sub"); fs.hidden = false; fs.querySelector("a").href = CFG.newsletterUrl;
  }
  route();
  Promise.all([d3.csv("data/trials.csv"), d3.csv("data/world.csv")]).then(([trials, world]) => {
    D = compute(trials, world);
    const dd = D.dataDate ? d3.utcFormat("%-d %b %Y")(new Date(D.dataDate)) : "—";
    $$(".data-date").forEach((e) => { e.textContent = dd; });
    $$(".latest-year").forEach((e) => { e.textContent = D.last; });
    setupTrials();
    rendered.clear();
    route();
  }).catch((err) => {
    $("#ov-lede").textContent = "The trial data could not be loaded. Please reload the page.";
    console.error(err);
  });
})();
