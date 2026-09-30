/* Ban Call lab: the ban phase drawn from the v8 model. One question per view, portraits as the labels, numbers on hover.
   Colours keep one meaning each: blue is good for you, red is bad for you, and three muted hues are the roles. */
(async function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pp = (x, d = 2) => (x >= 0 ? "+" : "−") + Math.abs(100 * x).toFixed(d);
  const pct = x => (100 * x).toFixed(0) + "%", pct1 = x => (100 * x).toFixed(1) + "%";
  const sum = a => a.reduce((x, y) => x + y, 0), mean = a => sum(a) / a.length;
  const FONT = '"Archivo Narrow", "Arial Narrow", Arial, sans-serif', c2 = document.createElement("canvas").getContext("2d");
  const tw = (s, px, w = 400) => { c2.font = `${w} ${px}px ${FONT}`; return c2.measureText(String(s)).width; };
  const SHORT = { "Deadpool (Vanguard)": "Deadpool V", "Deadpool (Duelist)": "Deadpool D", "Deadpool (Strategist)": "Deadpool S", "Gorr The God Butcher": "Gorr",
    "Jeff The Land Shark": "Jeff", "Mister Fantastic": "Mr. Fantastic", "Captain America": "Cap", "Invisible Woman": "Invisible W.", "Rocket Raccoon": "Rocket",
    "Elsa Bloodstone": "Elsa", "Doctor Strange": "Dr. Strange", "Devil Dinosaur": "Devil Dino" };
  const RC = ["var(--r0)", "var(--r1)", "var(--r2)"], RN = ["vanguard", "duelist", "strategist"], RNC = ["Vanguard", "Duelist", "Strategist"];
  try { await Promise.race([document.fonts.load('12px "Archivo Narrow"'), new Promise(r => setTimeout(r, 1500))]); } catch (e) {}
  // ---- load (the page's engines and model files)
  const LAY = await fetch("../model8/value_v8.json", { cache: "no-cache" }).then(r => r.json()), VQ = `?v=${LAY.run}`;
  const [BAN, SUBS, META, W7, PORT] = await Promise.all(["../model8/ban_v8.json" + VQ, "../model8/substitutes_v8.json" + VQ, "../model/meta.json"].map(u => fetch(u).then(r => r.json()))
    .concat([fetch("../model/weights.bin").then(r => r.arrayBuffer()), fetch("../model/portraits.json").then(r => r.json())]));
  const E = new Engine8(LAY, BAN), E7 = new BanEngine(META, W7, { NS: 64, NOWN: META.engine ? META.engine.nown : 32 });
  $("status").textContent = "Loading the value networks…";
  const [OPT, AUX] = await Promise.all([fetch(`../model8/${LAY.files.opt.path}${VQ}`).then(r => r.arrayBuffer()), fetch(`../model8/${LAY.files.aux.path}${VQ}`).then(r => r.arrayBuffer())]);
  E.addBuffer("opt", OPT); E.addBuffer("aux", AUX); $("status").textContent = "";
  const H = E.H, NAMES = LAY.heroes, ROLES = LAY.roles, ORDER = LAY.order, nm = h => SHORT[NAMES[h]] || NAMES[h], img = h => `../img/heroes/${PORT[NAMES[h]]}.webp`;
  const mapName = s => s.includes(" · ") ? s.replace(" · ", " (") + ")" : s, V7 = new Map(META.maps.map((m, i) => [m.name, i]));
  const MAPS = LAY.maps.map((m, i) => ({ i, name: mapName(m.label), v7: V7.get(m.label) })).filter(m => m.v7 !== undefined).sort((a, b) => a.name.localeCompare(b.name));
  const SUB = new Map(SUBS.table.map(r => [r.hero, r])), IDX = new Map(NAMES.map((n, i) => [n, i])), byLower = new Map(NAMES.map((n, i) => [n.toLowerCase(), i]));

  // ---- tooltip: any element with data-tip (HTML), placed beside the pointer and kept on screen
  const tip = document.createElement("div"); tip.className = "tip"; document.body.appendChild(tip);
  document.addEventListener("mousemove", ev => {
    const el = ev.target.closest ? ev.target.closest("[data-tip]") : null; if (!el) { tip.classList.remove("on"); return; }
    tip.innerHTML = el.getAttribute("data-tip"); const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = ev.clientX + 14, y = ev.clientY + 16; if (x + w > innerWidth - 8) x = ev.clientX - w - 14; if (y + h > innerHeight - 8) y = ev.clientY - h - 12;
    tip.style.left = x + "px"; tip.style.top = y + "px"; tip.classList.add("on");
  });
  const T_ = html => ` data-tip="${esc(html)}"`;
  const pic = (h, cx, cy, r, cls = "") => `<image href="${img(h)}" x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" clip-path="url(#cc)" preserveAspectRatio="xMidYMid slice"${cls ? ` class="${cls}"` : ""}/>`;
  function ticks(lo, hi, n = 4) { const raw = (hi - lo) / n || .001, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p, s = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; const o = []; for (let t = Math.ceil(lo / s) * s; t <= hi + 1e-12; t += s) o.push(+t.toFixed(10)); return o; }
  function spread(ys, gap, lo, hi) {                   // 1-D label placement: keep the order, push apart to at least `gap`, stay inside [lo, hi]
    const o = ys.slice(); for (let i = 1; i < o.length; i++) o[i] = Math.max(o[i], o[i - 1] + gap);
    if (o.length && o[o.length - 1] > hi) { o[o.length - 1] = hi; for (let i = o.length - 2; i >= 0; i--) o[i] = Math.min(o[i], o[i + 1] - gap); }
    for (let i = 0; i < o.length; i++) o[i] = Math.max(o[i], lo + i * gap); return o;
  }
  const band = (x0, y0a, y0b, x1, y1a, y1b) => { const xm = (x0 + x1) / 2; return `M${x0},${y0a}C${xm},${y0a} ${xm},${y1a} ${x1},${y1a}L${x1},${y1b}C${xm},${y1b} ${xm},${y0b} ${x0},${y0b}Z`; };

  // ---- lobby (the page's link format)
  const st = { tier: "Grandmaster 3", map: 11, first: true, team: [-1, -1, -1, -1, -1, -1], bans: [] };
  function readHash() {
    const q = new URLSearchParams(location.hash.slice(1)); if (!q.has("m")) return;
    if (META.tiers[q.get("t")]) st.tier = q.get("t"); const m = +q.get("m"); st.map = MAPS.some(x => x.i === m) ? m : st.map; st.first = q.get("f") !== "0";
    const tm = (q.get("u") || "").split(",").map(x => (x === "" || x === "-") ? -1 : +x); for (let i = 0; i < 6; i++) st.team[i] = tm[i] >= 0 && tm[i] < H ? tm[i] : -1;
    st.bans = (q.get("b") || "").split(",").filter(x => x !== "").map(Number).filter(h => h >= 0 && h < H).slice(0, 6);
  }
  const writeHash = () => { history.replaceState(null, "", "#" + new URLSearchParams({ t: st.tier, m: st.map, f: st.first ? 1 : 0, u: st.team.map(h => h < 0 ? "-" : h).join(","), b: st.bans.join(",") })); };
  $("tierSel").innerHTML = Object.keys(META.tiers).map(t => `<option>${esc(t)}</option>`).join("");
  $("mapSel").innerHTML = MAPS.map(m => `<option value="${m.i}">${esc(m.name)}</option>`).join("");
  $("youSel").innerHTML = `<option value="-1">(not shown)</option>` + NAMES.map((n, h) => ({ n, h })).sort((a, b) => a.n.localeCompare(b.n)).map(x => `<option value="${x.h}">${esc(x.n)}</option>`).join("");
  $("firstBtn").onclick = () => { st.first = true; draw(); }; $("secondBtn").onclick = () => { st.first = false; draw(); };
  $("undoBtn").onclick = () => { st.bans.pop(); draw(); };
  const themeNow = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  $("themeBtn").textContent = themeNow() === "dark" ? "Light" : "Dark";
  $("themeBtn").onclick = () => { document.documentElement.dataset.theme = themeNow() === "dark" ? "light" : "dark"; $("themeBtn").textContent = themeNow() === "dark" ? "Light" : "Dark"; };
  $("applyBtn").onclick = () => {
    st.tier = $("tierSel").value; st.map = +$("mapSel").value; st.team[0] = +$("youSel").value;
    const find = q => { q = q.trim().toLowerCase(); if (!q) return -1; if (byLower.has(q)) return byLower.get(q);
      const hit = NAMES.map((n, h) => h).filter(h => NAMES[h].toLowerCase().includes(q) || (SHORT[NAMES[h]] || "").toLowerCase().includes(q)); return hit.length ? hit[0] : -1; };
    st.bans = []; for (const p of $("bansIn").value.split(",")) { const h = find(p); if (h >= 0 && !st.bans.includes(h) && st.bans.length < 6) st.bans.push(h); }
    draw();
  };
  document.querySelectorAll(".presets button").forEach(b => b.onclick = () => { location.hash = b.dataset.h; });
  window.addEventListener("hashchange", () => { readHash(); draw(); });
  document.addEventListener("click", ev => { const el = ev.target.closest ? ev.target.closest("[data-ban]") : null; if (el && st.bans.length < 6) { st.bans.push(+el.dataset.ban); draw(); } });
  const ours = i => (ORDER[i] === 0) === st.first;
  const sub = t => `<span style="font-size:14px;font-weight:600;color:var(--faint)">${t}</span>`;

  // =============================================================================================== 1. the ban board
  // Every candidate as its portrait, placed by its value (a beeswarm, so none overlap): the gap between the best ban and the
  // rest is read at a glance. Rare bans (below the support floor) are greyed out. Click a portrait to ban it.
  function banBoard(R, LU) {
    const items = R.cands.map(h => ({ h, v: R.V[h] })).sort((a, b) => b.v - a.v).slice(0, 22), best = R.best;
    if (!items.some(i => i.h === best)) items.push({ h: best, v: R.V[best] });
    items.sort((a, b) => (b.h === best) - (a.h === best) || b.v - a.v);
    const W = 1000, PAD = 44, vs = items.map(i => i.v), vlo = Math.min(0, ...vs), vhi = Math.max(...vs), span = vhi - vlo || .001;
    const lo = vlo - span * .05, hi = vhi + span * .07, X = v => PAD + (v - lo) / (hi - lo) * (W - 2 * PAD);
    const placed = [];
    for (const it of items) {
      it.r = it.h === best ? 26 : 14; it.x = X(it.v); it.y = 0;
      for (let k = 0; k < 400; k++) { const dy = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2; if (!placed.some(p => Math.hypot(p.x - it.x, p.y - dy) < p.r + it.r + 2.5)) { it.y = dy; break; } }
      placed.push(it);
    }
    const ext = Math.max(...items.map(i => Math.abs(i.y) + i.r)) + 4, cy = ext + 34, base = cy + ext + 8, Hh = base + 40;
    const mv = h => R.Q.map(q => q[h] - R.base);
    let g = ticks(lo, hi, 5).map(t => `<line x1="${X(t)}" x2="${X(t)}" y1="18" y2="${base}" stroke="var(--hair)"/><text x="${X(t)}" y="${base + 16}" font-size="11" text-anchor="middle" class="faint">${pp(t, t && Math.abs(t) < .01 ? 2 : 1)}</text>`).join("");
    g += `<line x1="${X(0)}" x2="${X(0)}" y1="18" y2="${base}" stroke="var(--ink)" stroke-dasharray="2 3"/><text x="${X(0)}" y="${base + 30}" font-size="11" text-anchor="middle" class="faint">a typical ban</text>`;
    g += `<text x="${W - PAD}" y="${base + 30}" font-size="11" text-anchor="end" class="faint">win-chance points against a typical ban →</text>`;
    const b0 = items[0], m = mv(best);
    g += `<rect x="${X(Math.min(...m))}" y="${cy + b0.y - 3}" width="${Math.max(2, X(Math.max(...m)) - X(Math.min(...m)))}" height="6" fill="var(--blue)" opacity=".18"/>`;
    for (const it of items.slice().reverse()) {
      const h = it.h, rare = !R.supported.has(h), isB = h === best, x = it.x, y = cy + it.y, v = mv(h);
      const tipH = `<b>${esc(NAMES[h])}</b> ${pp(it.v)}<br><span class="d">the three networks: ${v.map(u => pp(u)).join(", ")}<br>typical teams ban it now: ${R.pe[h] < .001 ? "under 0.1%" : pct1(R.pe[h])}<br>they open it: ${pct(LU.pt[h])} · you: ${pct(LU.pu[h])}${rare ? "<br>too rare for the advice to pick" : ""}</span><br>click to ban`;
      g += `<g data-ban="${h}"${T_(tipH)}>${pic(h, x, y, it.r, rare ? "rare" : "")}<circle class="ring" cx="${x}" cy="${y}" r="${it.r}" fill="none" stroke="${isB ? "var(--blue)" : "var(--paper)"}" stroke-width="${isB ? 3 : 1.5}"/></g>`;
    }
    g += `<text x="${b0.x}" y="${cy + b0.y - b0.r - 9}" font-size="13" font-weight="600" text-anchor="middle" class="us">${esc(nm(best))}</text>`;
    return `<svg viewBox="0 0 ${W} ${Hh}" width="${W}">${g}</svg>`;
  }
  // =============================================================================================== 2. where their players go
  // A Sankey from the banned hero's mains to where they go, each flow in the colour of the role it ends in, so "pushed off
  // their role" is the amount of other colours.
  function subsFlow(h) {
    const r = SUB.get(NAMES[h]); if (!r || !r.top.length || r.same_role === null) return null;
    const role = ROLES[h], tops = r.top.slice(0, 6).map(([n, p]) => ({ h: IDX.get(n), p })), same = tops.filter(t => ROLES[t.h] === role), oth = tops.filter(t => ROLES[t.h] !== role);
    const remS = Math.max(0, r.same_role - sum(same.map(t => t.p))), remO = Math.max(0, 1 - r.same_role - sum(oth.map(t => t.p)));
    const nodes = same.sort((a, b) => b.p - a.p).concat(remS > .005 ? [{ other: `other ${RN[role]}s`, p: remS, role }] : [])
      .concat(oth.sort((a, b) => ROLES[a.h] - ROLES[b.h] || b.p - a.p)).concat(remO > .005 ? [{ other: "other roles", p: remO, role: -1 }] : []);
    const W = 560, Hh = 330, top = 16, gap = 7, avail = Hh - 2 * top - gap * (nodes.length - 1), x0 = 118, x1 = 330, nw = 12;
    let y = top, yl = top + gap * (nodes.length - 1) / 2, g = "";
    const ys = [];
    nodes.forEach(n => { const hgt = Math.max(1.5, n.p * avail); n.y0 = y; n.y1 = y + hgt; n.l0 = yl; n.l1 = yl + n.p * avail; y += hgt + gap; yl += n.p * avail; ys.push((n.y0 + n.y1) / 2); });
    const col = n => n.other ? (n.role >= 0 ? RC[n.role] : "var(--faint)") : RC[ROLES[n.h]];
    for (const n of nodes) {
      const lab = n.other ? n.other : NAMES[n.h];
      g += `<path d="${band(x0 + nw, n.l0, n.l1, x1, n.y0, n.y1)}" fill="${col(n)}" opacity="${n.other ? .35 : .55}"${T_(`${esc(NAMES[h])} mains → <b>${esc(lab)}</b> ${pct(n.p)}`)}/>`;
      g += `<rect x="${x1}" y="${n.y0}" width="${nw}" height="${n.y1 - n.y0}" fill="${col(n)}"/>`;
    }
    g += `<rect x="${x0}" y="${top + gap * (nodes.length - 1) / 2}" width="${nw}" height="${avail}" fill="${RC[role]}"/>`;
    const ly = spread(ys, 24, top + 10, Hh - top - 10);
    nodes.forEach((n, i) => { const yy = ly[i], x = x1 + nw + 8;
      if (Math.abs(yy - ys[i]) > 3) g += `<line x1="${x1 + nw + 1}" x2="${x - 2}" y1="${ys[i]}" y2="${yy}" stroke="var(--hair)"/>`;
      g += n.other ? `<text x="${x + 2}" y="${yy + 4}" font-size="12" class="faint">${esc(n.other)} <tspan font-weight="600">${pct(n.p)}</tspan></text>`
                   : pic(n.h, x + 10, yy, 10) + `<text x="${x + 26}" y="${yy + 4}" font-size="12.5">${esc(nm(n.h))} <tspan font-weight="600">${pct(n.p)}</tspan></text>`; });
    const cyl = top + gap * (nodes.length - 1) / 2 + avail / 2;
    g += pic(h, x0 - 40, cyl, 30) + `<text x="${x0 - 40}" y="${cyl + 48}" font-size="11.5" text-anchor="middle" class="faint">${Number(r.mains).toLocaleString("en-US")} mains</text>`;
    return { svg: `<svg viewBox="0 0 ${W} ${Hh}" width="${W}">${g}</svg>`, leave: 1 - r.same_role, role };
  }
  // =============================================================================================== 3. their next ban
  // One strip of their ban: each segment's width is its chance, its colour what it does to you (red hurts, blue helps).
  function forecastStrip(Tt, W = 1000) {
    const top = Tt.cands.slice().sort((a, b) => Tt.pe[b] - Tt.pe[a]), seg = []; let cum = 0;
    for (const h of top) { if (seg.length >= 11 || (cum > .8 && seg.length >= 6)) break; seg.push(h); cum += Tt.pe[h]; }
    const y0 = 8, sh = W < 800 ? 56 : 70, Hh = sh + 66, d = h => Tt.mu[h] - Tt.base, dmax = Math.max(.001, ...seg.map(h => Math.abs(d(h))));
    let x = 0, g = "";
    for (const h of seg) {
      const w = Tt.pe[h] * W, dv = d(h), op = (.14 + .78 * Math.min(1, Math.abs(dv) / dmax)).toFixed(2), r = Math.min(24, w / 2 - 4);
      g += `<g${T_(`<b>${esc(NAMES[h])}</b> ${pct(Tt.pe[h])} chance<br><span class="d">if they ban it, your win chance ${pp(dv)} against their typical ban</span>`)}>
        <rect x="${x + .5}" y="${y0}" width="${Math.max(0, w - 1)}" height="${sh}" fill="${dv < 0 ? "var(--red)" : "var(--blue)"}" fill-opacity="${op}"/>${r >= 10 ? pic(h, x + w / 2, y0 + sh / 2, r) : ""}</g>`;
      if (w >= (W < 800 ? 58 : 64)) g += `<text x="${x + 3}" y="${y0 + sh + 16}" font-size="12">${esc(nm(h))}</text><text x="${x + 3}" y="${y0 + sh + 31}" font-size="12" font-weight="600">${pct(Tt.pe[h])}</text>`;
      x += w;
    }
    g += `<rect x="${x + .5}" y="${y0}" width="${Math.max(0, W - x - 1)}" height="${sh}" fill="var(--panel)"${T_(`${top.length - seg.length} other heroes, ${pct(1 - cum)} together`)}/>`;
    if (W - x >= 64) g += `<text x="${x + 3}" y="${y0 + sh + 16}" font-size="12" class="faint">others</text><text x="${x + 3}" y="${y0 + sh + 31}" font-size="12" class="faint">${pct(1 - cum)}</text>`;
    const gx = W - 250, gy = Hh - 6;
    g += `<defs><linearGradient id="dv"><stop offset="0" stop-color="var(--red)"/><stop offset=".5" stop-color="var(--red)" stop-opacity=".1"/><stop offset=".5" stop-color="var(--blue)" stop-opacity=".1"/><stop offset="1" stop-color="var(--blue)"/></linearGradient></defs>`
      + `<rect x="${gx + 70}" y="${gy - 9}" width="110" height="9" fill="url(#dv)"/><text x="${gx + 64}" y="${gy}" font-size="11" text-anchor="end" class="faint">hurts you</text><text x="${gx + 186}" y="${gy}" font-size="11" class="faint">helps you</text>`;
    const worst = seg.filter(h => Tt.pe[h] >= .04).sort((a, b) => d(a) - d(b))[0];
    return { svg: `<svg viewBox="0 0 ${W} ${Hh}" width="${W}">${g}</svg>`, top: top[0], worst };
  }
  // =============================================================================================== 4. the ban phase, ban by ban
  // What each ban is worth to you, in points against a typical ban at that moment, on one axis: the bans so far (solid), your
  // remaining turns (outlined: what following the advice is worth there) and theirs (the range their likely bans could cost or
  // give you, their likeliest marked). The model already assumes you follow the advice, so a win-chance line would stay flat.
  function ledger(s) {
    const e = s.bans.length, slots = [];
    for (let k = 0; k < 6; k++) {
      const t = { m: s.m, r0: s.r0, firstUs: s.firstUs, you: s.you, mates: s.mates, bans: (k < e ? s.bans : slots.map(x => x.h)).slice(0, k) };
      if (k >= e && k > 0) t.bans = s.bans.concat(slots.slice(e, k).map(x => x.h));
      if (E.ours(s.firstUs, k)) { const R = E.ourTurn(t), h = k < e ? s.bans[k] : R.best; slots.push({ k, us: true, past: k < e, h, v: R.V[h], mv: R.Q.map(q => q[h] - R.base), best: R.best, bestV: R.V[R.best] }); }
      else { const T = E.theirTurn(t), top = T.cands.slice().sort((a, b) => T.pe[b] - T.pe[a]), h = k < e ? s.bans[k] : top[0], d = x => T.mu[x] - T.base;
             const al = top.slice(0, 6); slots.push({ k, us: false, past: k < e, h, v: d(h), p: T.pe[h], lo: Math.min(...al.map(d)), hi: Math.max(...al.map(d)), alts: al.slice(0, 4).map(x => ({ h: x, p: T.pe[x], d: d(x) })) }); }
    }
    const vals = slots.flatMap(x => x.us ? [x.v, ...(x.mv || [])] : x.past ? [x.v] : [x.lo, x.hi]).concat([0]), lo = Math.min(...vals), hi = Math.max(...vals), pad = Math.max(.0008, (hi - lo) * .12);
    const W = 1000, Hh = 290, L = 60, R = 20, T = 18, B = 100, cw = (W - L - R) / 6, X = k => L + cw * (k + .5), Y = v => T + (hi + pad - v) / (hi - lo + 2 * pad) * (Hh - T - B), bw = 46;
    let g = ticks(lo - pad, hi + pad, 4).map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--hair)"/><text x="${L - 8}" y="${Y(v) + 4}" font-size="11" text-anchor="end" class="faint">${pp(v, Math.abs(v) < .01 && v ? 2 : 1)}</text>`).join("");
    g += `<line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--ink)"/>`;
    if (e > 0 && e < 6) g += `<line x1="${L + cw * e}" x2="${L + cw * e}" y1="${T - 6}" y2="${Hh - B + 60}" stroke="var(--ink)" stroke-dasharray="2 3"/><text x="${L + cw * e + 5}" y="${T + 4}" font-size="11" class="faint">now</text>`;
    for (const x of slots) {
      const cx = X(x.k), col = x.v >= 0 ? "var(--blue)" : "var(--red)", y0 = Y(0), y1 = Y(x.v);
      if (x.past) g += `<rect x="${cx - bw / 2}" y="${Math.min(y0, y1)}" width="${bw}" height="${Math.max(1.5, Math.abs(y1 - y0))}" fill="${col}"${T_(x.us ? `your ban <b>${esc(NAMES[x.h])}</b>: ${pp(x.v)} against a typical ban${x.h !== x.best ? `<br><span class="d">the advice was ${esc(NAMES[x.best])} (${pp(x.bestV)})</span>` : "<br><span class=\"d\">the advised ban</span>"}` : `their ban <b>${esc(NAMES[x.h])}</b> (${pct(x.p)} likely): ${pp(x.v)} for you against their typical ban`)}/>`;
      else if (x.us) g += `<rect x="${cx - bw / 2}" y="${Math.min(y0, y1)}" width="${bw}" height="${Math.max(1.5, Math.abs(y1 - y0))}" fill="var(--blue)" fill-opacity=".12" stroke="var(--blue)" stroke-width="1.5" stroke-dasharray="4 3"${T_(`advised: <b>${esc(NAMES[x.h])}</b>, worth ${pp(x.v)} against a typical ban here<br><span class="d">the three networks: ${x.mv.map(u => pp(u)).join(", ")}</span>`)}/>`;
      else { g += `<g${T_(`their likely bans here: ${x.alts.map(a => `<b>${esc(nm(a.h))}</b> ${pct(a.p)} (${pp(a.d)})`).join(", ")}`)}><rect x="${cx - 7}" y="${Y(x.hi)}" width="14" height="${Math.max(2, Y(x.lo) - Y(x.hi))}" fill="var(--red)" opacity=".16"/>`
               + `<line x1="${cx - 12}" x2="${cx + 12}" y1="${Y(x.v)}" y2="${Y(x.v)}" stroke="${col}" stroke-width="2.5"/></g>`; }
      const lab = x.past || x.us ? pp(x.v) : "";
      if (lab) g += `<text x="${cx}" y="${x.v >= 0 ? y1 - 6 : y1 + 15}" font-size="12" font-weight="600" text-anchor="middle" style="fill:${x.past ? col : "var(--blue)"}">${lab}</text>`;
      const py = Hh - B + 44;
      g += `<rect x="${cx - 24}" y="${py - 32}" width="48" height="3" fill="${x.us ? "var(--blue)" : "var(--red)"}"/>`
        + `<g opacity="${x.past ? 1 : .55}"${T_(`${x.past ? (x.us ? "you banned" : "they banned") : x.us ? "advised" : "their likeliest"}: <b>${esc(NAMES[x.h])}</b>`)}>${pic(x.h, cx, py, 22)}</g>`
        + `<text x="${cx}" y="${py + 38}" font-size="11" text-anchor="middle" class="faint">${x.k + 1} ${x.us ? "you" : "them"}</text>`;
    }
    const left = slots.filter(x => !x.past && x.us).reduce((a, x) => a + x.v, 0);
    return { svg: `<svg viewBox="0 0 ${W} ${Hh}" width="${W}">${g}</svg>`, left };
  }
  // =============================================================================================== 5. two-ban turns
  // First ban (rows) and second ban (columns) as portraits; colour only, the best pair outlined with its value, the rest on hover.
  function pairGrid(P) {
    const rows = [], seen = new Set(); for (const p of P) if (!seen.has(p.a)) { seen.add(p.a); rows.push(p.a); }
    const val = new Map(P.map(p => [p.a + "," + p.b, p])), colBest = new Map(); for (const p of P) colBest.set(p.b, Math.max(colBest.get(p.b) ?? -9, p.V));
    const cols = Array.from(colBest.keys()).sort((a, b) => colBest.get(b) - colBest.get(a)).slice(0, 9), best = P[0], mx = Math.max(...P.map(p => Math.abs(p.V)));
    const cs = 50, L = 64, T = 64, W = L + cols.length * cs + 4, Hh = T + rows.length * cs + 4;
    let g = cols.map((h, j) => `<g${T_(`second ban: <b>${esc(NAMES[h])}</b>`)}>${pic(h, L + j * cs + cs / 2, 30, 18)}</g>`).join("") + rows.map((h, i) => `<g${T_(`first ban: <b>${esc(NAMES[h])}</b>`)}>${pic(h, 28, T + i * cs + cs / 2, 18)}</g>`).join("");
    g += `<text x="${L + 2}" y="${T - 6}" font-size="11" class="faint">then →</text><text x="10" y="${T - 6}" font-size="11" class="faint">first ↓</text>`;
    rows.forEach((a, i) => cols.forEach((b, j) => { const p = val.get(a + "," + b), x = L + j * cs, y = T + i * cs;
      if (!p) { g += `<rect x="${x + 2}" y="${y + 2}" width="${cs - 4}" height="${cs - 4}" fill="var(--panel)"/>`; return; }
      const op = (.1 + .82 * Math.min(1, Math.abs(p.V) / mx)).toFixed(2), isB = p === best;
      g += `<rect x="${x + 2}" y="${y + 2}" width="${cs - 4}" height="${cs - 4}" fill="${p.V >= 0 ? "var(--blue)" : "var(--red)"}" fill-opacity="${op}"${isB ? ' stroke="var(--ink)" stroke-width="2.5"' : ""}${T_(`<b>${esc(NAMES[a])}</b>, then <b>${esc(NAMES[b])}</b>: ${pp(p.V)}<br><span class="d">the three networks: ${p.mv.map(u => pp(u)).join(", ")}</span>`)}/>`;
      if (isB) g += `<text x="${x + cs / 2}" y="${y + cs / 2 + 5}" font-size="13" font-weight="700" text-anchor="middle" style="fill:var(--paper)" pointer-events="none">${pp(p.V)}</text>`; }));
    return `<svg viewBox="0 0 ${W} ${Hh}" width="${W}">${g}</svg>`;
  }
  // =============================================================================================== 6. where mains go, every hero
  // Three small Sankeys, one per role: each hero's mains (a row) flow to the role they pick when their main is banned. The share
  // in the panel's own colour stays in role. Hover a hero to follow its flows.
  function roleFlows() {
    const shares = r => { const role = ROLES[IDX.get(r.hero)], o = [0, 0, 0]; o[role] = r.same_role; const lst = [0, 0, 0];
      for (const [n, p] of r.top) { const q = ROLES[IDX.get(n)]; if (q !== role) lst[q] += p; }
      const others = [0, 1, 2].filter(q => q !== role), rest = Math.max(0, 1 - r.same_role - sum(others.map(q => lst[q]))), tot = sum(others.map(q => lst[q]));
      for (const q of others) o[q] = lst[q] + rest * (tot > 0 ? lst[q] / tot : .5); return o; };
    return [0, 1, 2].map(role => {
      const rows = SUBS.table.filter(r => r.same_role !== null && ROLES[IDX.get(r.hero)] === role).map(r => ({ r, h: IDX.get(r.hero), s: shares(r) })).sort((a, b) => b.r.same_role - a.r.same_role);
      const rh = 12, rg = 3, n = rows.length, Lw = Math.max(...rows.map(x => tw(NAMES[x.h], 11.5))) + 8, x0 = Lw + 4, nw = 5, x1 = x0 + 170, W = x1 + 100, top = 6, Hh = top + n * (rh + rg) + 10;
      const tot = [0, 1, 2].map(q => sum(rows.map(x => x.s[q]))), ng = 16, avail = n * rh, nodeY = []; let y = top + (n * (rh + rg) - rg - avail - 2 * ng) / 2;
      for (const q of [0, 1, 2]) { nodeY[q] = { y0: y, y1: y + tot[q] / n * avail }; y = nodeY[q].y1 + ng; }
      const fill = [0, 1, 2].map(q => nodeY[q].y0); let g = "";
      rows.forEach((x, i) => {
        const ry = top + i * (rh + rg); let yy = ry;
        for (const q of [0, 1, 2]) { const hL = x.s[q] * rh, hR = x.s[q] / n * avail; if (hL < .05) continue;
          g += `<path class="flow" data-hero="${x.h}" d="${band(x0 + nw, yy, yy + hL, x1, fill[q], fill[q] + hR)}" fill="${RC[q]}" opacity="${q === role ? .5 : .75}"/>`; yy += hL; fill[q] += hR; }
        g += `<g class="rowlab" data-hero="${x.h}"${T_(`<b>${esc(NAMES[x.h])}</b>: ${pct(x.r.same_role)} of ${Number(x.r.mains).toLocaleString("en-US")} mains stay ${RN[role]}<br><span class="d">first choices: ${x.r.top.slice(0, 4).map(([a, p]) => `${esc(SHORT[a] || a)} ${pct(p)}`).join(", ")}</span>`)}>
          <rect x="0" y="${ry - 1}" width="${x0 + nw}" height="${rh + 2}" fill="transparent"/><rect x="${x0}" y="${ry}" width="${nw}" height="${rh}" fill="${RC[role]}"/><text x="${x0 - 5}" y="${ry + rh - 2}" font-size="11.5" text-anchor="end">${esc(NAMES[x.h])}</text></g>`;
      });
      for (const q of [0, 1, 2]) { const ny = nodeY[q]; g += `<rect x="${x1}" y="${ny.y0}" width="${nw}" height="${Math.max(1, ny.y1 - ny.y0)}" fill="${RC[q]}"/><text x="${x1 + nw + 6}" y="${(ny.y0 + ny.y1) / 2 + 4}" font-size="12" font-weight="600" style="fill:${RC[q]}">${RNC[q]} ${pct(tot[q] / n)}</text>`; }
      const stay = mean(rows.map(x => x.r.same_role));
      return `<div><p class="head"><span class="n" style="color:${RC[role]}">${pct(stay)}</span> of ${RN[role]} mains stay ${RN[role]}</p><svg class="sk" viewBox="0 0 ${W} ${Hh}" width="${W}">${g}</svg></div>`;
    }).join("");
  }
  function wireSankeys() {
    document.querySelectorAll("svg.sk").forEach(sv => {
      sv.addEventListener("mouseover", ev => { const el = ev.target.closest("[data-hero]"); if (!el) return; const h = el.dataset.hero; sv.classList.add("hl"); sv.querySelectorAll("[data-hero]").forEach(x => x.classList.toggle("on", x.dataset.hero === h)); });
      sv.addEventListener("mouseleave", () => { sv.classList.remove("hl"); sv.querySelectorAll(".on").forEach(x => x.classList.remove("on")); });
    });
  }

  // ---- draw every view for the lobby
  function draw() {
    writeHash(); $("tierSel").value = st.tier; $("mapSel").value = String(st.map); $("youSel").value = String(st.team[0]);
    $("firstBtn").classList.toggle("on", st.first); $("secondBtn").classList.toggle("on", !st.first); $("bansIn").value = st.bans.map(h => NAMES[h]).join(", ");
    const s = { m: st.map, r0: META.tiers[st.tier], firstUs: st.first, bans: st.bans.slice(), you: st.team[0], mates: st.team.slice(1).filter(h => h >= 0) }, e = s.bans.length;
    const our = e < 6 && ours(e), two = our && e + 1 < 6 && ours(e + 1);
    const R = our ? E.ourTurn(s) : null, Tt = e < 6 && !our ? E.theirTurn(s) : null;
    const LU = E7.lineups(E7.ctx({ firstUs: st.first, bans: s.bans, rev: st.team.filter(h => h >= 0), m: MAPS.find(m => m.i === st.map).v7, r0: s.r0 }));
    $("lobbyLine").innerHTML = `${esc(st.tier)} · ${esc(MAPS.find(m => m.i === st.map).name)} · we ban ${st.first ? "first" : "second"}${s.you >= 0 ? ` · you show ${esc(NAMES[s.you])}` : ""}${s.mates.length ? ` · mates show ${s.mates.map(h => esc(NAMES[h])).join(", ")}` : ""}`
      + ` · ${e >= 6 ? "all six bans in" : `next: ban ${e + 1} (${our ? "you" : "them"})`} · <a href="../${location.hash}">open in Ban Call</a>`;
    const tl = e < 6 ? ledger(s) : null, wo = e < 6 ? mean(E.winNow(s)) : 0, wb = e < 6 ? (E.winNow(s, "behaviour") || [NaN])[0] : 0;
    const phase = () => `<section class="v"><h2><b>4</b>The ban phase, ban by ban</h2><p class="head">Win chance <span class="n u">${pct1(wo)}</span> if you follow the advice ${sub(`${pct1(wb)} if both teams ban as usual`)}</p>${tl.svg}</section>`;
    let html = "";
    if (R) {
      const runner = R.cands.filter(h => h !== R.best).sort((a, b) => R.V[b] - R.V[a])[0], k = R.Q.filter(q => q[R.best] > q[runner]).length;
      html += `<section class="v"><h2><b>1</b>Your ban</h2><p class="head">Ban <span class="u">${esc(NAMES[R.best])}</span> <span class="n u">${pp(R.V[R.best])}</span>
        ${sub(k === R.Q.length ? `clear of ${esc(nm(runner))} in all three networks` : `close call with ${esc(nm(runner))}`)}</p>${banBoard(R, LU)}</section>`;
      const SF = subsFlow(R.best);
      html += `<div class="row2"><section class="v"><h2><b>2</b>What your ban does to them</h2>${SF ? `<p class="head"><span class="n t">${pct(SF.leave)}</span> of ${esc(NAMES[R.best])} mains leave ${RN[SF.role]}</p>${SF.svg}` : `<p class="na">No substitution data for this hero.</p>`}</section>`;
      let reply = "";
      if (!two && e + 1 < 6) { const s2 = Object.assign({}, s, { bans: s.bans.concat([R.best]) }), T2 = E.theirTurn(s2), F2 = forecastStrip(T2, 560);
        reply = `<section class="v"><h2><b>3</b>Their reply</h2><p class="head">They likely answer with <span class="t">${esc(nm(F2.top))}</span> <span class="n t">${pct(T2.pe[F2.top])}</span></p>${F2.svg}</section>`; }
      html += two ? `<section class="v"><h2><b>5</b>Your two bans</h2><p class="head" id="pairHead">Scoring pairs…</p><div id="pairs"></div></section></div>${phase()}` : `${reply || "<div></div>"}</div>${phase()}`;
    } else if (Tt) {
      const FS = forecastStrip(Tt);
      html += `<section class="v"><h2><b>3</b>Their ban</h2><p class="head">Likeliest <span class="t">${esc(NAMES[FS.top])}</span> <span class="n t">${pct(Tt.pe[FS.top])}</span>
        ${FS.worst !== undefined ? sub(`the one to fear: ${esc(nm(FS.worst))} (${pct(Tt.pe[FS.worst])} chance, ${pp(Tt.mu[FS.worst] - Tt.base)} for you)`) : ""}</p>${FS.svg}</section>` + phase();
    } else html += `<section class="v"><h2><b>4</b>The ban phase</h2><p class="head">All six bans are in. Win chance <span class="n u">${pct1(mean(E.winNow(s)))}</span></p></section>`;
    html += `<section class="v"><h2><b>6</b>Where mains go when their hero is banned</h2><div class="row2" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:0 28px">${roleFlows()}</div>
      <p class="note">Each row is a hero; its mains flow to the role they pick when it is banned (the pick model, before teammates pick). The colour is the role they end up in. Hover a hero to follow it.</p></section>`;
    $("views").innerHTML = html; wireSankeys();
    if (two) setTimeout(() => { const P = E.pairs(s, R, 6, true), el = $("pairs"); if (!el || !P || !P.length) return; const b = P[0];
      $("pairHead").innerHTML = `<span class="u">${esc(nm(b.a))}</span>, then <span class="u">${esc(nm(b.b))}</span> <span class="n u">${pp(b.V)}</span>`; el.innerHTML = pairGrid(P);
      const h1 = document.querySelector("section.v .head"); if (h1) h1.innerHTML = `Ban <span class="u">${esc(NAMES[b.a])}</span>, then <span class="u">${esc(NAMES[b.b])}</span> <span class="n u">${pp(b.V)}</span> ${sub("two bans, scored as a pair")}`; }, 30);
  }
  readHash(); draw();
})();
