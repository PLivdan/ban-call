/* Layout options for Ban Call, drawn from the real model on one fixed lobby. Not linked from the site. */
(async function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const src = await fetch("index.html").then(r => r.text());
  $("base").textContent = (/<style>([\s\S]*?)<\/style>/.exec(src) || [, ""])[1];
  const [META, W, PORT] = await Promise.all([fetch("model/meta.json").then(r => r.json()), fetch("model/weights.bin").then(r => r.arrayBuffer()), fetch("model/portraits.json").then(r => r.json())]);
  try { await Promise.race([document.fonts.load('12px "Archivo Narrow"'), new Promise(r => setTimeout(r, 1500))]); } catch (e) {}
  const E = new BanEngine(META, W), N = META.heroes, H = N.length, IX = Object.fromEntries(N.map((n, i) => [n, i]));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pp = (x, d = 2) => (x >= 0 ? "+" : "−") + Math.abs(100 * x).toFixed(d), pct = x => (100 * x).toFixed(0) + "%";
  const img = h => `img/heroes/${PORT[N[h]]}.webp`;
  const ctx = document.createElement("canvas").getContext("2d");
  const tw = (s, px) => { ctx.font = `${px}px "Archivo Narrow", "Arial Narrow", Arial, sans-serif`; return ctx.measureText(String(s)).width; };
  const labW = (a, px) => Math.ceil(Math.max(0, ...a.map(s => tw(s, px)))) + 4;
  const niceStep = span => { const raw = span / 5, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; };

  const rev = [IX["Deadpool (Vanguard)"], IX["Emma Frost"]];
  const R = E.values({ firstUs: true, bans: [], rev, m: 9, r0: 4550, cnt: 1 });
  const top = Array.from(R.V.keys()).filter(h => !isNaN(R.V[h])).sort((a, b) => R.V[b] - R.V[a]);
  const T8 = top.slice(0, 8), T12 = top.slice(0, 12), h0 = top[0];
  const them = Array.from(R.Pt.keys()).sort((a, b) => R.Pt[b] - R.Pt[a]).slice(0, 10);
  const us = Array.from(R.Pu.keys()).filter(h => !rev.includes(h)).sort((a, b) => R.Pu[b] - R.Pu[a]).slice(0, 10);
  const opt = (tag, note, body) => `<div class="opt"><div class="tag">${tag}</div><p class="note">${note}</p><div class="ex">${body}</div></div>`;

  // ---- charts
  function valueChart(rows) {                          // the current Figure 1
    const L = labW(rows.map(h => N[h]), 11.5) + 8, Rr = Math.ceil(tw("+0.00", 11)) + 12, Wd = Math.max(600, L + Rr + 380), rowH = 18, top_ = 16, hgt = top_ + rows.length * rowH + 22;
    let lo = Math.min(0, ...rows.map(h => R.V[h] - 2 * R.se[h])), hi = Math.max(0, ...rows.map(h => R.V[h] + 2 * R.se[h])); const pad = (hi - lo) * .04; lo -= pad; hi += pad;
    const X = v => L + (v - lo) / (hi - lo) * (Wd - L - Rr), step = niceStep(hi - lo); let g = "";
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-12; t += step) g += `<line class="grid" x1="${X(t)}" x2="${X(t)}" y1="${top_ - 4}" y2="${hgt - 20}"/><text x="${X(t)}" y="${hgt - 6}" font-size="10" text-anchor="middle" class="faint">${pp(t, 1)}</text>`;
    return `<svg viewBox="0 0 ${Wd} ${hgt}" width="${Wd}">${g}<line class="axis" x1="${X(0)}" x2="${X(0)}" y1="${top_ - 4}" y2="${hgt - 20}"/>` + rows.map((h, k) => {
      const y = top_ + k * rowH, x0 = X(Math.min(0, R.V[h])), x1 = X(Math.max(0, R.V[h]));
      return `<text x="${L - 6}" y="${y + 12}" font-size="11.5" text-anchor="end">${esc(N[h])}</text><rect x="${x0}" y="${y + 4}" width="${Math.max(1, x1 - x0)}" height="10" class="${R.V[h] >= 0 ? "us" : "them"}" opacity="${k < 2 ? 1 : .55}"/>
        <line class="whisk" x1="${X(R.V[h] - 1.96 * R.se[h])}" x2="${X(R.V[h] + 1.96 * R.se[h])}" y1="${y + 9}" y2="${y + 9}"/><text x="${Wd - Rr + 6}" y="${y + 12}" font-size="11">${pp(R.V[h])}</text>`;
    }).join("") + "</svg>";
  }
  function probChart(rows, P, cls) {
    const L = labW(rows.map(h => N[h]), 11) + 7, Rr = 32, Wd = Math.max(290, L + Rr + 150), rowH = 16, hgt = rows.length * rowH + 4, mx = Math.max(...rows.map(h => P[h]));
    return `<svg viewBox="0 0 ${Wd} ${hgt}" width="${Wd}">` + rows.map((h, k) => { const y = k * rowH, w = P[h] / mx * (Wd - L - Rr);
      return `<text x="${L - 5}" y="${y + 12}" font-size="11" text-anchor="end">${esc(N[h])}</text><rect x="${L}" y="${y + 3}" width="${w}" height="10" class="${cls}"/><text x="${L + w + 4}" y="${y + 12}" font-size="10.5" class="faint">${pct(P[h])}</text>`; }).join("") + "</svg>";
  }

  // ---- 1. the ban ranking
  const tableA = `<table><tr><th>#</th><th></th><th>Ban</th><th class="r">Value</th><th class="r">They open</th><th class="r">You open</th><th class="r">Cost to lose</th><th class="r">Banned later</th></tr>` +
    T8.map((h, k) => `<tr><td class="num">${k + 1}</td><td><img class="mini" src="${img(h)}" alt=""></td><td>${esc(N[h])}</td><td class="r">${pp(R.V[h])}</td><td class="r">${pct(R.Pt[h])}</td><td class="r">${pct(R.Pu[h])}</td><td class="r">${(100 * R.R[h]).toFixed(1)}</td><td class="r">${pct(R.PL[h])}</td></tr>`).join("") + "</table>";
  const lo = Math.min(0, ...T12.map(h => R.V[h] - 1.96 * R.se[h])), hi = Math.max(...T12.map(h => R.V[h] + 1.96 * R.se[h])), CW = 170, cx = v => 4 + (v - lo) / (hi - lo) * (CW - 8);
  const inl = h => `<svg width="${CW}" height="14" viewBox="0 0 ${CW} 14" style="display:inline-block;vertical-align:middle"><line class="grid" x1="${cx(0)}" x2="${cx(0)}" y1="0" y2="14"/>
      <line class="whisk" x1="${cx(R.V[h] - 1.96 * R.se[h])}" x2="${cx(R.V[h] + 1.96 * R.se[h])}" y1="7" y2="7"/><circle cx="${cx(R.V[h])}" cy="7" r="3.5" class="${R.V[h] >= 0 ? "us" : "them"}"/></svg>`;
  const tableB = `<table><tr><th>#</th><th></th><th>Ban</th><th class="r">Value</th><th>95% interval (axis 0 to ${pp(hi, 1)})</th><th class="r">They open</th><th class="r">You open</th><th class="r">Cost to lose</th><th class="r">Banned later</th></tr>` +
    T12.map((h, k) => `<tr><td class="num">${k + 1}</td><td><img class="mini" src="${img(h)}" alt=""></td><td>${esc(N[h])}</td><td class="r">${pp(R.V[h])}</td><td>${inl(h)}</td><td class="r">${pct(R.Pt[h])}</td><td class="r">${pct(R.Pu[h])}</td><td class="r">${(100 * R.R[h]).toFixed(1)}</td><td class="r">${pct(R.PL[h])}</td></tr>`).join("") + "</table>";
  const why = h => `They open it ${pct(R.Pt[h])} of the time and lose ${(100 * R.R[h]).toFixed(1)} points without it. You open it ${pct(R.Pu[h])}. Banned later anyway ${pct(R.PL[h])}.`;
  const cards = `<div style="display:flex;gap:8px;flex-wrap:wrap">` + top.slice(0, 3).map((h, k) => `<div class="card"><div class="small">${k + 1}</div><img src="${img(h)}" alt=""><div><b>${esc(N[h])}</b></div>
      <div class="v">${pp(R.V[h])}</div><div class="why">± ${(196 * R.se[h]).toFixed(2)} points<br>${why(h)}</div></div>`).join("") + `</div>
    <p class="small" style="margin-top:6px">Next: ${top.slice(3, 10).map(h => `${esc(N[h])} ${pp(R.V[h])}`).join(", ")}</p>`;
  let html = `<h2>1. The ban ranking (Figure 1 and the table under it)</h2>`;
  html += opt("A. Current: chart, then table", "A bar chart with whiskers, then a table with the terms behind each value.",
    `<div>${valueChart(T12)}</div><div>${tableA}</div>`);
  html += opt("B. One table with the interval drawn in each row", "The chart and table merge. Each row carries its own dot and 95% interval on a shared axis, so ties are visible next to the numbers.",
    `<div>${tableB}</div>`);
  html += opt("C. Top three as cards, the rest in a line", "Portrait cards for the top three, each with a one-sentence reason in numbers. The full table can sit below or fold away.",
    `<div>${cards}</div>`);

  // ---- 2. who plays what
  const butterfly = (() => {
    const hs = Array.from(new Set(them.concat(us))).sort((a, b) => Math.max(R.Pt[b], R.Pu[b]) - Math.max(R.Pt[a], R.Pu[a])).slice(0, 14);
    const Lw = labW(hs.map(h => N[h]), 11) + 10, half = 150, pad = 30, Wd = 2 * (half + pad) + Lw, rowH = 16, top_ = 18, hgt = top_ + hs.length * rowH + 4, mx = Math.max(...hs.map(h => Math.max(R.Pt[h], R.Pu[h])));
    const c0 = pad + half, c1 = c0 + Lw;
    return `<svg viewBox="0 0 ${Wd} ${hgt}" width="${Wd}"><text x="${c0}" y="11" font-size="11.5" font-weight="600" text-anchor="end" class="them">Other team</text><text x="${c1}" y="11" font-size="11.5" font-weight="600" class="us">Your team</text>` +
      hs.map((h, k) => { const y = top_ + k * rowH, a = R.Pt[h] / mx * half, b = rev.includes(h) ? 0 : R.Pu[h] / mx * half;
        return `<rect x="${c0 - a}" y="${y + 3}" width="${a}" height="10" class="them"/><text x="${c0 - a - 4}" y="${y + 12}" font-size="10.5" text-anchor="end" class="faint">${pct(R.Pt[h])}</text>
          <text x="${(c0 + c1) / 2}" y="${y + 12}" font-size="11" text-anchor="middle">${esc(N[h])}</text>
          ${rev.includes(h) ? `<text x="${c1 + 2}" y="${y + 12}" font-size="10.5" class="faint">shown</text>` : `<rect x="${c1}" y="${y + 3}" width="${b}" height="10" class="us"/><text x="${c1 + b + 4}" y="${y + 12}" font-size="10.5" class="faint">${pct(R.Pu[h])}</text>`}`; }).join("") + "</svg>";
  })();
  const strip = (hs, P, cls) => `<div class="strip">${hs.map(h => `<div class="t"><img src="${img(h)}" alt=""><span class="p ${cls}">${pct(P[h])}</span><br>${esc(N[h])}</div>`).join("")}</div>`;
  html += `<h2>2. Who is likely to play what (Figures 2 and 3)</h2>`;
  html += opt("A. Current: two bar charts", "One chart per team, each sorted on its own.",
    `<div><h3>Other team</h3>${probChart(them, R.Pt, "them")}</div><div><h3>Your team</h3>${probChart(us, R.Pu, "us")}</div>`);
  html += opt("B. One back-to-back chart", "A shared hero list down the middle, the other team to the left and yours to the right. It shows where both teams want the same hero, which is where a ban cuts both ways.",
    `<div>${butterfly}</div>`);
  html += opt("C. Portrait strips", "The ten likeliest heroes per team as portraits with their chance above the name. Quicker to scan mid-lobby, less precise.",
    `<div><h3 class="sideR">Other team</h3>${strip(them, R.Pt, "sideR")}<h3 class="sideB">Your team</h3>${strip(us, R.Pu, "sideB")}</div>`);

  // ---- 3. where the value comes from
  const L1 = 1 - R.PL[h0], deny = L1 * R.Pt[h0] * R.R[h0], self = -L1 * R.Pu[h0] * R.Rus[h0];
  const eqA = `<table class="eq"><tr><td>They open ${esc(N[h0])}</td><td class="r">${pct(R.Pt[h0])}</td><td class="op">×</td><td>cost to them</td><td class="r">${(100 * R.R[h0]).toFixed(2)}</td><td class="op">=</td><td class="r">${pp(R.Pt[h0] * R.R[h0])}</td></tr>
    <tr><td>You open ${esc(N[h0])}</td><td class="r">${pct(R.Pu[h0])}</td><td class="op">×</td><td>cost to you</td><td class="r">${(100 * R.Rus[h0]).toFixed(2)}</td><td class="op">=</td><td class="r">${pp(-R.Pu[h0] * R.Rus[h0])}</td></tr>
    <tr><td>Not banned later anyway</td><td class="r">${pct(L1)}</td><td class="op">×</td><td>difference</td><td></td><td class="op">=</td><td class="r">${pp(R.first[h0])}</td></tr>
    <tr><td>Their reply</td><td></td><td></td><td></td><td></td><td class="op">+</td><td class="r">${pp(R.reply[h0])}</td></tr>
    <tr><td><b>Value</b></td><td></td><td></td><td></td><td></td><td class="op">=</td><td class="r"><b>${pp(R.V[h0])}</b></td></tr></table>`;
  const waterfall = (() => {
    const steps = [["Denies them", deny], ["Costs you", self], ["Their reply", R.reply[h0]], ["Value", R.V[h0], 1]];
    let run = 0; const pts = steps.map(([n, v, tot]) => { const a = tot ? 0 : run, b = tot ? v : run + v; if (!tot) run += v; return { n, v, a, b, tot }; });
    const lo = Math.min(0, ...pts.flatMap(p => [p.a, p.b])), hi = Math.max(...pts.flatMap(p => [p.a, p.b])), Lw = labW(pts.map(p => p.n), 11.5) + 10, Wd = Lw + 330, rowH = 24, hgt = pts.length * rowH + 22, X = v => Lw + (v - lo) / (hi - lo) * 260;
    return `<svg viewBox="0 0 ${Wd} ${hgt}" width="${Wd}"><line class="axis" x1="${X(0)}" x2="${X(0)}" y1="0" y2="${hgt - 20}"/>` + pts.map((p, k) => { const y = k * rowH, x0 = X(Math.min(p.a, p.b)), w = Math.abs(X(p.b) - X(p.a));
      return `<text x="${Lw - 6}" y="${y + 16}" font-size="11.5" text-anchor="end"${p.tot ? ' font-weight="600"' : ""}>${p.n}</text><rect x="${x0}" y="${y + 6}" width="${Math.max(1, w)}" height="13" class="${p.tot ? "us" : p.v >= 0 ? "us" : "them"}" opacity="${p.tot ? 1 : .6}"/>
        <text x="${Math.max(X(p.a), X(p.b)) + 5}" y="${y + 16}" font-size="11">${pp(p.v)}</text>${k < pts.length - 1 ? `<line class="grid" x1="${X(p.b)}" x2="${X(p.b)}" y1="${y + 19}" y2="${y + rowH + 6}"/>` : ""}`; }).join("") +
      `<text x="${X(0)}" y="${hgt - 6}" font-size="10" text-anchor="middle" class="faint">0</text></svg>`;
  })();
  const stacked = (() => {
    const rows = T8.map(h => { const l = 1 - R.PL[h]; return { h, d: l * R.Pt[h] * R.R[h], s: -l * R.Pu[h] * R.Rus[h], r: R.reply[h] }; });
    const lo = Math.min(0, ...rows.map(r => Math.min(r.s, 0) + Math.min(r.r, 0) + Math.min(r.d, 0))), hi = Math.max(...rows.map(r => Math.max(r.d, 0) + Math.max(r.r, 0) + Math.max(r.s, 0)));
    const Lw = labW(rows.map(r => N[r.h]), 11.5) + 10, Wd = Lw + 360, rowH = 19, hgt = rows.length * rowH + 40, X = v => Lw + (v - lo) / (hi - lo) * 300;
    const seg = (a, v, cls, op) => `<rect x="${X(Math.min(a, a + v))}" y="0" width="${Math.abs(X(a + v) - X(a))}" height="11" class="${cls}" opacity="${op}"/>`;
    let g = rows.map((r, k) => { let p = 0, n = 0; const parts = [];
      for (const [v, cls, op] of [[r.d, "us", 1], [r.r, "us", .45], [r.s, "them", .75]]) { if (v >= 0) { parts.push(seg(p, v, cls, op)); p += v; } else { parts.push(seg(n, v, cls, op)); n += v; } }
      return `<g transform="translate(0 ${k * rowH + 4})"><text x="${Lw - 6}" y="10" font-size="11.5" text-anchor="end">${esc(N[r.h])}</text>${parts.join("")}<text x="${X(p) + 4}" y="10" font-size="10.5" class="faint">${pp(R.V[r.h])}</text></g>`; }).join("");
    const ly = rows.length * rowH + 22;
    g += `<line class="axis" x1="${X(0)}" x2="${X(0)}" y1="0" y2="${rows.length * rowH + 4}"/>
      <rect x="${Lw}" y="${ly - 9}" width="10" height="10" class="us"/><text x="${Lw + 14}" y="${ly}" font-size="11">denies them</text>
      <rect x="${Lw + 90}" y="${ly - 9}" width="10" height="10" class="us" opacity=".45"/><text x="${Lw + 104}" y="${ly}" font-size="11">their reply</text>
      <rect x="${Lw + 176}" y="${ly - 9}" width="10" height="10" class="them" opacity=".75"/><text x="${Lw + 190}" y="${ly}" font-size="11">costs you</text>`;
    return `<svg viewBox="0 0 ${Wd} ${hgt}" width="${Wd}">${g}</svg>`;
  })();
  html += `<h2>3. Where a ban's value comes from</h2>`;
  html += opt(`A. Current: the arithmetic for the top ban`, "The multiplication written out as a small table.", `<div>${eqA}</div>`);
  html += opt(`B. Waterfall for the top ban`, "The same numbers as steps: what the ban takes from them, what it takes from you, their reply, and the total.", `<div>${waterfall}</div>`);
  html += opt(`C. Split bars for the top eight bans`, "Every candidate's value split into its parts, so you can see which bans win by denying them and which by protecting you. Replaces the one-ban arithmetic.", `<div>${stacked}</div>`);
  $("out").className = ""; $("out").innerHTML = html;
})();
