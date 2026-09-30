/* Ban Call: the Methods figures. "Forward, then back" plays the ban phase of the lobby set on the page out as a tree and carries
   the scores back; "Inside one ending" shows what happens where a branch ends. app8.js computes the lobby's numbers with the
   model (figData) and hands them over: MethodFigs.init once, then MethodFigs.show(D) whenever the lobby changes. */
window.MethodFigs = { init: async function (o) {
  "use strict"; o = o || {};
  const $ = id => document.getElementById(id), root = document.documentElement, SVGNS = "http://www.w3.org/2000/svg";
  if (!$("t2") || !$("t3")) return;
  let D = null, N, img, nOurs, paths, VMAX;
  const pts = v => (v >= 0 ? "+" : "−") + Math.abs(100 * v).toFixed(2);
  const ICON = { play: `<svg viewBox="0 0 14 14"><path d="M2 1 L13 7 L2 13 Z"/></svg>`, pause: `<svg viewBox="0 0 14 14"><rect x="2" y="1" width="3.5" height="12"/><rect x="8.5" y="1" width="3.5" height="12"/></svg>` };

  // ---------------------------------------------------------------- shared
  const css = n => getComputedStyle(root).getPropertyValue(n).trim();
  const rgb = h => { h = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const mixA = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t)), css3 = a => `rgb(${a.join(",")})`;
  let P = {}, C = {};
  const pal = () => { ["paper", "ink", "faint", "hair", "panel", "blue", "red"].forEach(k => P[k] = css("--" + k)); ["paper", "ink", "blue", "red"].forEach(k => C[k] = rgb(P[k]));
    C.base = mixA(C.paper, C.ink, .30); C.dim = mixA(C.paper, C.ink, .08); };
  // value colours: a neutral grey at zero, full-strength blue (good for you) or red (bad) at the extremes
  const tint = (c, k) => mixA(C.paper, c, k);
  const valA = v => { const t = Math.max(-1, Math.min(1, v / VMAX)); return t >= 0 ? tint(C.blue, .22 + .78 * Math.pow(t, .6)) : tint(C.red, .22 + .78 * Math.pow(-t, .6)); };
  const valCol = v => css3(valA(v));
  const cl = x => Math.max(0, Math.min(1, x)), ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, seg = (t, a, b) => cl((t - a) / (b - a));
  const rng = s => () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const el = (tag, attrs, parent) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const text = (parent, x, y, s, attrs = {}) => { const { fill, ...rest } = attrs; const e = el("text", { x, y, "font-size": 12, ...rest }, parent); if (fill) e.style.fill = fill; e.textContent = s; return e; };
  const tile = (parent, h, x, y, s, stroke, sw = 1.5) => { const g = el("g", {}, parent); const im = el("image", { href: h >= 0 ? img(h) : "", x, y, width: s, height: s, preserveAspectRatio: "xMidYMid slice" }, g);
    const bx = el("rect", { x, y, width: s, height: s, fill: "none", stroke: stroke || "none", "stroke-width": sw }, g); return { g, im, bx }; };
  // a banned hero: the portrait greyed out with a slash from corner to corner, slash and frame in the colour of the team that banned
  // it and the same width, so the slash runs into the frame's corners
  const banTile = (parent, h, x, y, s, stroke, sw = 2) => { const t = tile(parent, h, x, y, s, stroke, sw); t.im.style.filter = "grayscale(1)";
    el("line", { x1: x, y1: y + s, x2: x + s, y2: y, stroke, "stroke-width": sw }, t.g); t.g.appendChild(t.bx); return t; };
  function player(pp, chEl, chapters, dur, render) {
    let t = 0, playing = false, last = 0;
    chEl.innerHTML = chapters.map((c, i) => `<button data-i="${i}"><span class="track"><span class="fill"></span></span><b>${c[1]}</b>${c[2]}</button>`).join("");
    const btns = [...chEl.querySelectorAll("button")], fills = btns.map(b => b.querySelector(".fill"));
    const draw = () => { render(Math.min(t, dur)); btns.forEach((b, i) => { const a = chapters[i][0], z = i + 1 < chapters.length ? chapters[i + 1][0] : dur;
      b.classList.toggle("on", t >= a && (t < z || i === btns.length - 1)); fills[i].style.width = `${100 * cl((t - a) / (z - a))}%`; }); };
    const frame = now => { if (!playing) return; t += Math.min(.05, (now - last) / 1000); last = now;
      if (t >= dur) { t = dur; playing = false; setIcon(); draw(); return; }                // the end: stay on the last frame
      draw(); requestAnimationFrame(frame); };
    const setIcon = () => { pp.innerHTML = playing ? ICON.pause : ICON.play; pp.setAttribute("aria-label", playing ? "Pause" : t >= dur ? "Play again" : "Play"); };
    const toggle = () => { playing = !playing; if (playing && t >= dur) t = 0; setIcon(); if (playing) { last = performance.now(); requestAnimationFrame(frame); } };
    btns.forEach(b => b.onclick = () => { t = chapters[+b.dataset.i][0]; if (!playing) toggle(); draw(); });
    pp.onclick = toggle; setIcon(); draw();
    return { start: () => { if (!playing) toggle(); }, seek: x => { if (playing) toggle(); t = Math.min(x, dur); setIcon(); draw(); }, redraw: () => { if (!playing) draw(); },
      get t() { return t; }, get dur() { return dur; }, get playing() { return playing; } };
  }

  // ================================================================ forward, then back
  function buildT2() {
    const Wd = 980, Hh = 450, top = 62, bot = 420, FLOW = 236;
    // the ban phase as it stands: bans already made (and their likeliest bans before your turn) are single bands; FB is the ban
    // you are about to make (every option there is ranked); later on, two options per ban, and your later bans keep the best one
    const us = D.us.map(Number), FB = D.FB, BR = [0, 1, 2, 3, 4, 5].map(e => e < FB ? 1 : e === FB ? 6 : 2);
    if (6 * Math.pow(2, 5 - FB) > 96) BR[5] = 1;
    const prune = e => e > FB && e < 6 && !!us[e] && BR[e] > 1;
    const PW = 66, x0 = 80 + FB * PW, X = FB ? [0, 1, 2, 3, 4, 5, 6].map(e => e <= FB ? 80 + e * PW : x0 + (e - FB) * (745 - x0) / (6 - FB)) : [80, 210, 335, 450, 555, 650, 745];
    const NL = 6 - FB, up = (n, k) => { while (n && k--) n = n.parent; return n || null; };
    const r = rng(5), nodes = [], edges = [];
    function grow(e, parent, meta, mass) {
      const n = { e, parent, meta, kids: [], mass }; nodes.push(n); if (e === 6) return n;
      const ps = [];
      for (let k = 0; k < BR[e]; k++) {
        if (e === FB) ps.push({ h: D.ours[k].h, v: D.ours[k].v, rep: D.ours[k].reply, p: 1 });
        else if (e === FB + 1 && !us[e] && meta.rep && meta.rep.length > k) { const rr = meta.rep[k]; ps.push({ h: rr[0], p: rr[1], sub: rr[2] }); }
        else if (e === FB + 2 && !us[e] && meta.sub && meta.sub.length >= 2) ps.push({ h: meta.sub[k][0], p: meta.sub[k][1] });
        else ps.push({ p: us[e] ? 1 : ([.62, .38][k] || 1) });
      }
      const s = ps.reduce((a, b) => a + b.p, 0);
      ps.forEach(m => { const c = grow(e + 1, n, m, mass * m.p / s); n.kids.push(c); const ed = { a: n, b: c }; c.inE = ed; edges.push(ed); });
      return n;
    }
    const R0 = grow(FB, null, {}, 1), LEAF = nodes.filter(n => n.e === 6), FBN = R0.kids;   // FBN: your first-ban options
    // layout: endings stacked with equal gaps, every band as tall as its share of games, each parent centred over its children
    const gap = (bot - top - FLOW) / (LEAF.length - 1); let y = top;
    LEAF.forEach(n => { n.h = FLOW * n.mass; n.top = y; y += n.h + gap; });
    const place = n => { if (n.e === 6) return; n.kids.forEach(place); n.h = n.kids.reduce((a, c) => a + c.h, 0);
      const lo = n.kids[0].top, hi = n.kids[n.kids.length - 1].top + n.kids[n.kids.length - 1].h; n.top = (lo + hi) / 2 - n.h / 2;
      let s = n.top; n.kids.forEach(c => { c.s0 = s; c.s1 = s + c.h; s += c.h; }); };
    place(R0);
    LEAF.forEach(n => { let a = n; while (a.e > FB + 1) a = a.parent; n.val = a.meta.v + (r() - .5) * VMAX * 1.8; n.group = a; });
    nodes.forEach(n => { let a = n; while (a.e > FB + 1) a = a.parent; n.group = n.e >= FB + 1 ? a : null; });
    const back = n => { if (n.e === 6) return n.val; const vs = n.kids.map(back);
      if (us[n.e] || n.kids.length === 1) { n.pick = vs.indexOf(Math.max(...vs)); n.val = Math.max(...vs); }
      else { const ps = n.kids.map(c => c.meta.p), s = ps.reduce((a, b) => a + b); n.val = vs.reduce((a, v, i) => a + v * ps[i] / s, 0); } return n.val; };
    FBN.forEach(c => { back(c); const sh = c.meta.v - c.val, add = n => { if (n.e === 6) n.val += sh; n.kids.forEach(add); }; add(c); back(c); }); back(R0);
    const onPlan = n => { for (let a = n; a.parent; a = a.parent) { const p = a.parent; if (prune(p.e) && p.kids[p.pick] !== a) return false; } return true; };
    // games: one to every ending first, so every band is explored, then more by the same rules
    const pr = rng(9), games = [], order = LEAF.map((_, i) => i).sort(() => pr() - .5);
    const walk = () => { let n = R0; while (n.e < 6) { let c; if (us[n.e]) c = n.kids[Math.floor(pr() * n.kids.length)];
      else { const ps = n.kids.map(x => x.meta.p), s = ps.reduce((a, b) => a + b); let u = pr() * s, j = 0; while (u > ps[j] && j < ps.length - 1) { u -= ps[j]; j++; } c = n.kids[j]; } n = c; } return n; };
    const routeTo = n => { const rt = []; for (let a = n; a.parent; a = a.parent) rt.unshift(edges.findIndex(ed => ed.b === a)); return rt; };
    const targets = order.map(i => LEAF[i]).concat(Array.from({ length: Math.round(40 * LEAF.length / 96) + 6 }, walk)), NG = targets.length, PD = 1.6, GEND = 5.0;
    targets.forEach((n, k) => { const route = routeTo(n), hs = []; let h = n.group.meta.h; route.forEach(ei => { if (edges[ei].b.meta.h !== undefined) h = edges[ei].b.meta.h; hs.push(h); });
      games.push({ s: .2 + (GEND - PD - .2) * Math.pow(k / (NG - 1), 1.2), route, leaf: n, h: n.group.meta.h, hs }); });
    edges.forEach(ed => ed.t0 = Infinity);
    games.forEach(gm => gm.route.forEach((ei, j) => { const a = gm.s + PD * j / NL, b = gm.s + PD * (j + 1) / NL; if (a < edges[ei].t0) { edges[ei].t0 = a; edges[ei].t1 = b; } }));
    LEAF.forEach(n => n.hit = Math.min(...games.filter(gm => gm.leaf === n).map(gm => gm.s + PD)));
    const BACK = [5.4, 8.6], RANK = 8.9, DUR = 11.8;
    // ---- build
    const box = $("t2"); box.innerHTML = ""; const S = el("svg", { viewBox: `0 0 ${Wd} ${Hh}`, role: "img", "aria-label": "A ban phase explored by simulated games, then scored back" }, box);
    const defs = el("defs", {}, S), gBands = el("g", { mask: "url(#t2mask)" }, S),
      gMask = el("mask", { id: "t2mask", maskUnits: "userSpaceOnUse", x: 0, y: 0, width: Wd, height: Hh, style: "mask-type:luminance", "color-interpolation": "sRGB" }, defs), gLeaf = el("g", {}, S), gTop = el("g", {}, S);
    const heads = [];
    for (let e = 0; e < 6; e++) { const x = (X[e] + X[e + 1]) / 2; heads.push({ t: text(S, x, 22, us[e] ? "Your ban" : "Their ban", { "text-anchor": "middle", fill: us[e] ? P.blue : P.red, "font-weight": 600 }),
      c: text(S, x, 40, us[e] ? "keeps the best" : "weighed by likelihood", { "text-anchor": "middle", fill: P.faint, "font-size": 11.5, opacity: 0 }) }); }
    const resHead = text(S, X[6] + 8, 22, "Result", { fill: P.faint, "font-weight": 600 });
    edges.forEach((ed, i) => { const a = ed.a, b = ed.b, xa = X[a.e], xb = X[b.e], xm = (xa + xb) / 2;
      const gr = el("linearGradient", { id: `gr${i}`, gradientUnits: "userSpaceOnUse", x1: xa, x2: xb, y1: 0, y2: 0 }, defs);
      ed.s0 = el("stop", { offset: 0 }, gr); ed.sm = el("stop", { offset: .5 }, gr); ed.s1 = el("stop", { offset: 1 }, gr);
      const cp = el("clipPath", { id: `cp${i}` }, defs); ed.cr = el("rect", { x: xa - 1, y: 0, height: Hh, width: 0 }, cp);
      // colour bands bleed a little past their edges so they overlap; the mask alone decides each band's exact edge and transparency
      ed.dA = `M${xa - .4},${b.s0} C${xm},${b.s0} ${xm},${b.top} ${xb + .8},${b.top} L${xb + .8},${b.top + b.h} C${xm},${b.top + b.h} ${xm},${b.s1} ${xa - .4},${b.s1} Z`;
      ed.path = el("path", { d: ed.dA,
        fill: `url(#gr${i})`, stroke: `url(#gr${i})`, "stroke-width": 1.2, "clip-path": `url(#cp${i})` }, gBands);
      ed.mid = el("path", { d: `M${xa},${(b.s0 + b.s1) / 2} C${xm},${(b.s0 + b.s1) / 2} ${xm},${b.top + b.h / 2} ${xb},${b.top + b.h / 2}`, fill: "none", stroke: "none" }, defs);
      ed.len = ed.mid.getTotalLength(); ed.sa = ed.sb = ed.sc = ""; ed.xm = xm; });
    const rootBar = el("rect", { x: X[FB] - 10, y: R0.top, width: 10, height: R0.h, fill: P.blue }, gLeaf); text(gLeaf, X[FB] - 5, R0.top - 10, "Now", { "text-anchor": "middle", fill: P.faint, "font-weight": 600 });
    // the bans before now: the heroes themselves, their likeliest marked as such
    D.fixed.slice(0, FB).forEach((f, e) => { const cx = (X[e] + X[e + 1]) / 2 - 5, cy = R0.top + R0.h / 2;
      banTile(gLeaf, f.h, cx - 17, cy - 17, 34, f.us ? P.blue : P.red, 2);
      text(gLeaf, cx, cy + 32, f.given ? (f.us ? "You" : "Them") : "Likely", { "text-anchor": "middle", fill: f.us ? P.blue : P.red, "font-size": 11 }); });
    LEAF.forEach(n => n.bar = el("rect", { x: X[6] + 4, y: n.top, height: Math.max(1, n.h), width: 0 }, gLeaf));
    // the mask is one outline traced around everything visible, so no two shapes ever meet along an edge; options you would not
    // take are cut off at the line as it passes (the line covers the cut)
    const SW = 70, uni = el("path", { d: "", fill: "#fff" }, gMask);
    const wg = el("linearGradient", { id: "wglow", x1: 0, x2: 1, y1: 0, y2: 0 }, defs);
    [[0, 0], [.55, .22], [.8, .35], [1, 0]].forEach(([o, a]) => el("stop", { offset: o, "stop-color": P.blue, "stop-opacity": a }, wg));
    const wave = el("g", { opacity: 0 }, S);
    el("rect", { x: -2, y: top - 8, width: 40, height: bot - top + 16, fill: "url(#wglow)" }, wave);
    el("line", { x1: 0, x2: 0, y1: top - 8, y2: bot + 28, stroke: P.blue, "stroke-width": 2.2 }, wave);
    el("path", { d: `M-4,${bot + 22} l-10,0 m4,-4 l-4,4 l4,4`, fill: "none", stroke: P.blue, "stroke-width": 1.6 }, wave);
    text(wave, 4, bot + 26, "Scores", { fill: P.blue, "font-weight": 600, "font-size": 11.5 });
    const dOf = ed => { const a = ed.a, b = ed.b, xa = X[a.e], xb = X[b.e], xm = (xa + xb) / 2;
      // a band's colour shape; it bleeds a little (stroke) so neighbours overlap, and the one outline in the mask sets the real edges
      return `M${xa},${b.s0} C${xm},${b.s0} ${xm},${ed.rt} ${xb},${ed.rt} L${xb},${ed.rb} C${xm},${ed.rb} ${xm},${b.s1} ${xa},${b.s1} Z`; };
    const cub = (p0, p1, p2, p3, u) => { const l = (a, b) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], a = l(p0, p1), b_ = l(p1, p2), c = l(p2, p3), d = l(a, b_), e = l(b_, c); return [a, d, l(d, e)]; };
    const uAt = (xa, xm, xb, x) => { let lo = 0, hi = 1; for (let it = 0; it < 24; it++) { const u = (lo + hi) / 2, v = 1 - u; if (xa * v * v * v + 3 * xm * v * u + xb * u * u * u < x) lo = u; else hi = u; } return (lo + hi) / 2; };
    const f2 = v => Math.round(v * 100) / 100, P2 = p => `${f2(p[0])},${f2(p[1])}`;
    const outline = wx => { const out = [], seen = ed => onPlan(ed.b) || wx > X[ed.a.e] + .01;
      const walk = ed => { const a = ed.a, b = ed.b, xa = X[a.e], xb = X[b.e], xm = (xa + xb) / 2;
        if (!onPlan(b) && wx < xb) { const u = uAt(xa, xm, xb, wx), T = cub([xa, b.s0], [xm, b.s0], [xm, ed.rt], [xb, ed.rt], u), B = cub([xa, b.s1], [xm, b.s1], [xm, ed.rb], [xb, ed.rb], u);
          out.push(`C${P2(T[0])} ${P2(T[1])} ${P2(T[2])}`, `L${P2(B[2])}`, `C${P2(B[1])} ${P2(B[0])} ${f2(xa)},${f2(b.s1)}`); return; }
        out.push(`C${f2(xm)},${f2(b.s0)} ${f2(xm)},${f2(ed.rt)} ${f2(xb)},${f2(ed.rt)}`);
        b.kids.forEach(c => { if (!seen(c.inE)) return; out.push(`L${f2(xb)},${f2(c.s0)}`); walk(c.inE); });
        out.push(`L${f2(xb)},${f2(ed.rb)}`, `C${f2(xm)},${f2(ed.rb)} ${f2(xm)},${f2(b.s1)} ${f2(xa)},${f2(b.s1)}`); };
      out.push(`M${X[FB]},${f2(R0.kids[0].s0)}`); R0.kids.forEach(c => { out.push(`L${X[FB]},${f2(c.s0)}`); walk(c.inE); }); return out.join(" ") + " Z"; };
    // back pass (wx): once the line passes one of your later bans, the band arriving there narrows onto the option kept.
    // rank (w): the kept options take over the games of the ones they beat and widen to carry the whole band; endings restack
    // with the same total space between them, and each parent stays centred over its children
    nodes.forEach(n => { n.h0 = n.h; });
    const geom = (wx, w) => {
      nodes.forEach(n => { if (!n.parent) { n.h = n.h0; n.Z = 0; return; } const a = n.parent, fk = prune(a.e) ? w : 0, kept = a.kids[a.pick] === n;
        const lose = fk ? a.kids.reduce((q, c, i) => i === a.pick ? q : q + c.h0, 0) : 0, f = !fk ? 1 : kept ? (n.h0 + fk * lose) / n.h0 : 1 - fk;
        n.Z = 1 - (1 - a.Z) * (fk && !kept ? 1 - fk : 1); n.h = a.h * f * n.h0 / a.h0; });
      const gw = LEAF.map((n, i) => i === LEAF.length - 1 ? 0 : (1 - n.Z) * (n.group !== LEAF[i + 1].group ? 5 : up(n, 3) !== up(LEAF[i + 1], 3) ? 2 : 1));
      const gs = (bot - top - FLOW) / gw.reduce((q, v) => q + v, 0); let y = top; LEAF.forEach((n, i) => { n.top = y; y += n.h + gw[i] * gs; });
      for (let e = 5; e >= 0; e--) nodes.forEach(n => { if (n.e !== e) return; const f = n.kids[0], l = n.kids[n.kids.length - 1];
        n.top = (f.top + l.top + l.h) / 2 - n.h / 2; let q = n.top; n.kids.forEach(c => { c.s0 = q; q += c.h; c.s1 = q; }); });
      edges.forEach(ed => { const b = ed.b, kc = prune(b.e) ? b.kids[b.pick] : null, k = kc ? ease(cl((X[b.e] - wx) / SW)) : 0;
        ed.rt = b.top + (k ? (kc.s0 - b.top) * k : 0); ed.rb = b.top + b.h + (k ? (kc.s1 - b.top - b.h) * k : 0); }); };
    // a point on an edge's centre line at x, for the pulses that ride the kept paths back
    const yOn = (ed, x) => { const xa = X[ed.a.e], xb = X[ed.b.e], xm = (xa + xb) / 2, y0 = (ed.b.s0 + ed.b.s1) / 2, y1 = (ed.rt + ed.rb) / 2;
      let lo = 0, hi = 1; for (let it = 0; it < 22; it++) { const u = (lo + hi) / 2, v = 1 - u, xx = xa * v * v * v + 3 * xm * v * v * u + 3 * xm * v * u * u + xb * u * u * u; if (xx < x) lo = u; else hi = u; }
      const u = (lo + hi) / 2, v = 1 - u; return y0 * (v * v * v + 3 * v * v * u) + y1 * (3 * v * u * u + u * u * u); };
    geom(-1e4, 1);                                                              // rows and the marked ending sit where the tree ends up
    const PLAN = LEAF.filter(onPlan).map(n => { const eds = []; for (let q = n; q.inE; q = q.parent) eds.unshift(q.inE); return eds; });
    const pulses = PLAN.map(() => el("rect", { width: 8, height: 8, fill: P.blue, stroke: P.paper, "stroke-width": 1.5, opacity: 0 }, S));
    const TK = 13, tokens = games.map(gm => { const t = tile(gTop, gm.h, 0, 0, TK, P.blue, 1.4); t.g.setAttribute("opacity", 0); t.us = true; return t; });
    const RG = FBN.map((c, k) => D.ours[k]), vlo = Math.min(0, ...RG.map(q => q.lo)), vhi = Math.max(...RG.map(q => q.hi));
    const RX = X[6] + 42, sc = 84 / (vhi - vlo || 1), X0 = RX + 36 - vlo * sc;
    let hk = null;
    const rows = FBN.map(c => { const ls = (function f(n) { return n.e === 6 ? [n] : n.kids.flatMap(f); })(c); return (ls[0].top + ls[ls.length - 1].top + ls[ls.length - 1].h) / 2; });
    const zero = el("g", { opacity: 0 }, S); el("line", { x1: X0, x2: X0, y1: rows[0] - 26, y2: rows[rows.length - 1] + 18, class: "rng0" }, zero);
    text(zero, X0, rows[0] - 32, "Typical ban", { "text-anchor": "middle", fill: P.faint, "font-size": 11 });
    const labs = FBN.map((c, k) => { const yc = rows[k], g = el("g", { opacity: 0, style: "cursor:default" }, S);
      const hit = el("rect", { x: RX - 4, y: yc - 17, width: Wd - RX, height: 34, fill: "transparent" }, g);
      const tl = tile(g, c.meta.h, RX, yc - 13, 26, P.hair, 1);
      const bar = el("rect", { x: X0, y: yc - 3, height: 6, rx: 3, width: 0, class: "rng us" }, g);
      const dot = el("circle", { cx: X0, cy: yc, r: 3.6, class: "us" }, g);
      const val = text(g, X0, yc + 4, "", { "font-size": 12.5 });
      g.addEventListener("mouseenter", () => { hk = k; api.redraw(); });
      return { g, tl, bar, dot, val, c, yc, q: RG[k] }; });
    // the ending the advice expects: the one opened up in the figure below
    const pickKid = (n, h) => n.kids.find(c => c.meta.h === h) || (prune(n.e) ? n.kids[n.pick] : n.kids[0]);
    let lt = R0; while (lt.e < 6) lt = pickKid(lt, D.path[lt.e] ? D.path[lt.e].h : -1);
    const link = el("g", { opacity: 0, style: "cursor:pointer" }, S);
    el("rect", { x: X[6] + 1, y: lt.top - 4, width: 32, height: Math.max(lt.h, 2) + 8, fill: "none", stroke: P.blue, "stroke-width": 2 }, link);
    link.addEventListener("click", () => { $("t3").scrollIntoView({ behavior: "smooth", block: "center" }); if (window.FIG) { FIG.t3.seek(0); FIG.t3.start(); } });
    const many = x => x >= 1e9 ? `about ${Math.round(x / 1e9)} billion` : x >= 1e6 ? `about ${Math.round(x / 1e6)} million` : Math.round(x).toLocaleString("en-US");
    $("t2n").textContent = `Drawn with ${BR[FB]} of the ${nOurs} bans you could make ${FB ? "at this turn" : "first"}${FB < 5 ? " and two options at each later ban" : ""}. The full tree has ${many(paths)} endings.`;
    // colour: blue through your bans, red through theirs; at each fork the colour is the blend of the stretches that meet there, so
    // one flows into the next. Once the scores come back, your stretches deepen with the branch's value and branches you would not
    // take fade to a pale tint of their own colour
    const past = (x, t, wx) => t < BACK[0] ? 0 : ease(cl((x - wx) / 40)), own = ed => us[ed.a.e] ? C.blue : C.red;
    const blueOf = v => tint(C.blue, .35 + .65 * cl(v / VMAX));
    const midF = ed => us[ed.a.e] ? tint(C.blue, .5) : tint(C.red, .72);
    const midB = ed => us[ed.a.e] ? blueOf(ed.b.val) : tint(C.red, .72);
    const midA = (ed, t, wx) => mixA(midF(ed), midB(ed), past(ed.xm, t, wx));
    function render(t) {
      const wx = X[FB] + (X[6] + 30 - X[FB]) * (1 - ease(seg(t, BACK[0], BACK[1]))); geom(wx, ease(seg(t, RANK, RANK + 1.2)));
      const od = outline(wx); if (od !== uni.dOld) { uni.setAttribute("d", od); uni.dOld = od; }
      edges.forEach(ed => {
        const drawn = ed.t0 === Infinity ? cl((t - GEND) / .3) : seg(t, ed.t0, ed.t1);
        ed.cr.setAttribute("width", (X[ed.b.e] - X[ed.a.e] + 2.2) * drawn);
        let AM = midA(ed, t, wx);
        const d_ = dOf(ed); if (d_ !== ed.d) { ed.path.setAttribute("d", d_); ed.d = d_; }
        ed.M = AM; ed.op = 1;
        // rank: groups other than the one shown fade toward the page
        if (t >= RANK) { const k = .5 * ease(seg(t, RANK, RANK + .6)), G = FBN[hk === null ? 0 : hk], best = ed.b.e <= FB || ed.b.group === G || ed.b === G; if (!best) ed.op = 1 - k; } });
      nodes.forEach(n => { const outs = n.kids.map(c => c.inE.M); let avg = outs.length ? [0, 1, 2].map(i => outs.reduce((q, a) => q + a[i], 0) / outs.length) : null;
        if (avg && prune(n.e)) avg = mixA(avg, n.kids[n.pick].inE.M, ease(cl((X[n.e] - wx) / SW)));
        n.C = !n.inE ? avg : !avg ? n.inE.M : mixA(n.inE.M, avg, .5); });
      edges.forEach(ed => { const f = c => css3(ed.op < 1 ? mixA(C.paper, c, ed.op) : c), a = f(ed.a.C), m = f(ed.M), b = f(ed.b.C);
        if (a !== ed.sa) { ed.s0.setAttribute("stop-color", a); ed.sa = a; } if (m !== ed.sc) { ed.sm.setAttribute("stop-color", m); ed.sc = m; } if (b !== ed.sb) { ed.s1.setAttribute("stop-color", b); ed.sb = b; } });
      games.forEach((gm, k) => { const u = (t - gm.s) / PD, tk = tokens[k].g; if (u <= 0 || u >= 1) { tk.setAttribute("opacity", 0); return; }
        const j = Math.min(NL - 1, Math.floor(u * NL)), ed = edges[gm.route[j]], q = ed.mid.getPointAtLength((u * NL - j) * ed.len);
        tk.setAttribute("transform", `translate(${q.x - TK / 2},${q.y - TK / 2})`); tk.setAttribute("opacity", cl(Math.min(u * 12, (1 - u) * 12)));
        const mine = !!us[ed.a.e]; if (tokens[k].us !== mine) { tokens[k].us = mine; tokens[k].bx.setAttribute("stroke", mine ? P.blue : P.red); } });
      LEAF.forEach(n => { const a = ease(seg(t, n.hit, n.hit + .3)); n.bar.setAttribute("width", 26 * a);
        n.bar.setAttribute("fill", css3(blueOf(n.val))); n.bar.setAttribute("y", n.top); n.bar.setAttribute("height", Math.max(n.Z > .98 ? 0 : 1, n.h)); n.bar.setAttribute("opacity", onPlan(n) ? 1 : 1 - ease(cl((X[6] + 17 - wx) / 20))); });
      const wOn = t > BACK[0] && t < BACK[1] + .25 ? Math.min(1, seg(t, BACK[0], BACK[0] + .25), 1 - seg(t, BACK[1], BACK[1] + .25)) : 0;
      wave.setAttribute("transform", `translate(${wx},0)`); wave.setAttribute("opacity", wOn);
      pulses.forEach((pu, k) => { if (!wOn) { pu.setAttribute("opacity", 0); return; } const x_ = Math.max(X[FB], Math.min(X[6], wx)), y = yOn(PLAN[k].find(ed => X[ed.b.e] >= x_) || PLAN[k][PLAN[k].length - 1], x_);
        pu.setAttribute("x", Math.max(X[FB], wx) - 4); pu.setAttribute("y", y - 4); pu.setAttribute("opacity", wOn); });
      heads.forEach((h, e) => { const inside = t > BACK[0] && t < BACK[1] && wx <= X[e + 1] + 2 && wx >= X[e] - 2; h.c.setAttribute("opacity", inside ? 1 : 0); });
      // rank: values against a typical ban (the dotted line), each with its range; the emphasised row is the best one, or the one hovered
      const zA = ease(seg(t, RANK, RANK + .4)); zero.setAttribute("opacity", zA); link.setAttribute("opacity", ease(seg(t, RANK + 1, RANK + 1.5)));
      link.style.pointerEvents = t >= RANK + 1 ? "auto" : "none";
      const E = hk === null ? 0 : hk;
      labs.forEach((l, k) => { const a = ease(seg(t, RANK + k * .08, RANK + .5 + k * .08)), v = l.c.meta.v, on = k === E; l.g.setAttribute("opacity", a * (on ? 1 : .8));
        l.g.style.pointerEvents = a > .5 ? "auto" : "none";
        const lo = X0 + l.q.lo * sc * a, hi = X0 + l.q.hi * sc * a;
        l.bar.setAttribute("x", lo); l.bar.setAttribute("width", Math.max(0, hi - lo)); l.dot.setAttribute("cx", X0 + v * sc * a); l.dot.setAttribute("opacity", a > .05 ? 1 : 0);
        l.tl.bx.setAttribute("stroke", on ? P.blue : P.hair); l.tl.bx.setAttribute("stroke-width", on ? 2.2 : 1);
        l.val.setAttribute("x", Math.max(hi, X0 + v * sc * a) + 7); l.val.textContent = a > 0 ? pts(v * a) : "";
        l.val.style.fill = on ? P.blue : P.faint; l.val.style.fontWeight = on ? 700 : 400; });
    }
    const api = player($("t2pp"), $("t2ch"), [[0, "Play forward", "Simulated games branch at every ban and are scored where they end."],
      [BACK[0], "Carry back", "At your bans the best option counts. At theirs, each option counts by how likely it is."],
      [RANK, "Rank", `Each ban you could make ${D.FB ? "now" : "first"} gets a value against a typical ban, with its range. Hover a row to see its branch.`]], DUR, render);
    return api;
  }

  // ================================================================ inside one ending
  function buildT3() {
    const Wd = 1000, Hh = 400, path = D.path, banned = new Set(path.map(p => p.h)), ROLE = D.roles, you = D.lobby.youH >= 0 ? D.lobby.youH : undefined;
    const CYC = 5.4, NDRAW = 9, T0 = 1.5, DUR = T0 + CYC * NDRAW, EN = D.ending;
    // one real draw from the simulator (the page asks its worker; MethodFigs.ending hands it over): until it is in, a note
    if (!EN || EN.failed || !EN.us || EN.us.length < 1) {
      $("t3").innerHTML = `<p class="small" style="padding:48px 0;text-align:center">${EN && EN.failed ? "The simulator could not be run in this browser." : "Drafting one ending with the simulator&hellip;"}</p>`;
      return { stub: true, start() {}, seek() {}, redraw() {}, get t() { return 0; }, get dur() { return 1; }, get playing() { return false; } };
    }
    // the draw's lineups: each seat's hero (what it shows, else the stand-in's main), the pick, and whether that hero is banned
    // (the player switched, as the pick model has players switch); lineups with a banned main first, so the figure shows one early.
    // Every seat shows the hero it plays from the start: two stand-ins can share a main and only one of them gets it, and players
    // sometimes pick another hero anyway. Only a banned main is shown first and then switched (the crossed tile).
    const pack = (x, youFirst) => { const o = [0, 1, 2, 3, 4, 5].sort((a, b) => (youFirst ? (a === 0 ? -1 : b === 0 ? 1 : 0) : 0) || ROLE[x.picks[a]] - ROLE[x.picks[b]]);
      const bn = x.banned || x.forced, seen = new Set(), sw = o.map(i => { const f = !!bn[i] && !seen.has(x.mains[i]); if (f) seen.add(x.mains[i]); return f; });   // a second player with the same banned main appears on their pick
      return { team: o.map((i, q) => sw[q] ? x.mains[i] : x.picks[i]), picks: o.map(i => x.picks[i]), forced: sw, banned: sw }; };
    const n = Math.min(NDRAW, EN.n, EN.us.length, EN.them.length), nb = x => (x.banned || x.forced).some(Boolean), firstForced = xs => xs.map((x, i) => i).sort((a, b) => nb(xs[b]) - nb(xs[a]) || a - b);
    const ou = firstForced(EN.us.slice(0, n)), ot = firstForced(EN.them.slice(0, n));
    const DR = []; for (let k = 0; k < NDRAW; k++) DR.push({ us: pack(EN.us[ou[k % n]], you !== undefined), them: pack(EN.them[ot[k % n]], false) });
    // the matchups' win chances, as the simulator scores them; the running average of the cells scored so far
    const RA = []; { let s = 0, c = 0; for (let k = 0; k < NDRAW; k++) { const cells = new Map(); for (let i = 0; i <= k; i++) for (let j = 0; j <= k; j++) if (i === k || j === k) {
      const v = EN.pairs[ou[i % n] * EN.n + ot[j % n]]; cells.set(i + "," + j, v); s += v; c++; } RA.push({ cells, avg: s / c }); } }
    const PX = 112, PY = 232, SX0 = 262, SX = k => SX0 + k * 60, SY = [132, 262], TS = 44, GX = 722, GY = 120, gcs = 18, NX = 938;
    const box = $("t3"); box.innerHTML = ""; const S = el("svg", { viewBox: `0 0 ${Wd} ${Hh}`, role: "img", "aria-label": "One ending: stand-in players, picks and scored matchups" }, box);
    const H = (x, y, s, a = "start") => text(S, x, y, s, { "font-weight": 700, "font-family": "Archivo, sans-serif", "text-anchor": a });
    H(12, 22, "Bans"); H(PX, 116, "Players at your rank", "middle"); H(SX0, 104, "Your team"); H(SX0, 234, "Their team"); H(GX, 94, "Matchups");
    const bans = path.map((p, k) => { const g = el("g", { opacity: 0 }, S); banTile(g, p.h, 62 + k * 50, 12, 34, p.us ? P.blue : P.red, 2);
      text(g, 62 + k * 50 + 17, 60, p.us ? "You" : "Them", { "text-anchor": "middle", fill: p.us ? P.blue : P.red, "font-size": 11 }); return g; });
    // the pool: small squares, the same shape as the seats
    const pr = rng(3), pool = []; for (let k = 0; k < 260; k++) { const a = pr() * 6.283, rr = Math.sqrt(pr()) * 66; pool.push(el("rect", { x: PX + rr * Math.cos(a) - 2.5, y: PY + rr * Math.sin(a) - 2.5, width: 5, height: 5, fill: css3(tint(k % 2 ? C.red : C.blue, .4)) }, S)); }
    if (o.pool) text(S, PX, PY + 90, `${Math.round(o.pool).toLocaleString("en-US")} players`, { "text-anchor": "middle", fill: P.faint });
    const SEL = []; { const r = rng(17); for (let k = 0; k < NDRAW; k++) { const s = new Set(); while (s.size < 11) s.add(Math.floor(r() * pool.length)); SEL.push([...s]); } }
    const slotOf = []; for (let tt = 0; tt < 2; tt++) for (let i = tt ? 0 : 1; i < 6; i++) slotOf.push([tt, i]);
    const seats = []; for (let tt = 0; tt < 2; tt++) for (let i = 0; i < 6; i++) { const x = SX(i), y = SY[tt], col = tt ? P.red : P.blue, g = el("g", {}, S);
      const outline = el("rect", { x, y, width: TS, height: TS, fill: "none", stroke: col, "stroke-width": 1.5, "stroke-dasharray": "4 3" }, g);
      const pick = el("image", { x, y, width: TS, height: TS, preserveAspectRatio: "xMidYMid slice", opacity: 0 }, g);
      const main = el("image", { x, y, width: TS, height: TS, preserveAspectRatio: "xMidYMid slice", opacity: 0 }, g);
      const frame = el("rect", { x, y, width: TS, height: TS, fill: "none", stroke: col, "stroke-width": 2, opacity: 0 }, g);
      const BX = x - 8, BY = y - 8, BS = 22;                                  // the banned main: a badge over the tile's corner
      const mainBox = el("rect", { x: BX, y: BY, width: BS, height: BS, fill: "none", stroke: col, "stroke-width": 2, opacity: 0 }, g);
      const cross = el("line", { x1: BX, y1: BY + BS, x2: BX + BS, y2: BY, stroke: col, "stroke-width": 2, opacity: 0 }, g);
      g.appendChild(main);
      g.appendChild(cross); g.appendChild(mainBox);
      seats.push({ tt, i, x, y, g, outline, pick, main, mainBox, cross, frame, hm: -1, hp: -1 }); }
    if (you !== undefined) text(S, SX(0) + TS / 2, SY[0] + TS + 16, "You", { "text-anchor": "middle", fill: P.blue, "font-weight": 600, "font-size": 11.5 });
    const kg = el("g", {}, S), kx = SX0, ky = SY[1] + TS + 24; el("rect", { x: kx, y: ky - 11, width: 14, height: 14, fill: css3(tint(C.red, .18)), stroke: P.red, "stroke-width": 2 }, kg);
    el("line", { x1: kx, y1: ky + 3, x2: kx + 14, y2: ky - 11, stroke: P.red, "stroke-width": 2 }, kg);
    text(kg, kx + 22, ky, "A player whose main is banned switches heroes. The small crossed tile is the banned main.", { fill: P.faint, "font-size": 11.5 });
    const fly = slotOf.map(([tt]) => el("rect", { width: 5, height: 5, fill: tt ? P.red : P.blue, opacity: 0 }, S));
    const cells = []; for (let i = 0; i < NDRAW; i++) for (let j = 0; j < NDRAW; j++) cells.push({ i, j, r: el("rect", { x: GX + j * gcs, y: GY + i * gcs, width: gcs - 2, height: gcs - 2, fill: P.panel }, S) });
    text(S, GX, GY - 8, "Their lineups", { fill: P.faint, "font-size": 11 });
    text(S, 0, 0, "Your lineups", { fill: P.faint, "font-size": 11, "text-anchor": "middle", transform: `translate(${GX - 7},${GY + NDRAW * gcs / 2}) rotate(-90)` });
    const num = text(S, NX, GY + 76, "", { "text-anchor": "middle", fill: P.blue, style: "font:800 32px Archivo,sans-serif" }), numc = text(S, NX, GY + 98, "Win chance", { "text-anchor": "middle", fill: P.faint, opacity: 0 }),
      numn = text(S, NX, GY + 114, "", { "text-anchor": "middle", fill: P.faint, "font-size": 11 });
    const depart = j => .35 + j * .07, arrive = j => depart(j) + .5, pickAt = (tt, i) => 1.6 + (tt * 6 + i) * .07;
    const setImg = (im, h, key) => { if (im.dataset.k !== String(key)) { im.dataset.k = key; im.setAttribute("href", h >= 0 ? img(h) : ""); } };
    function render(t) {
      bans.forEach((b, k) => { const a = ease(seg(t, .1 + k * .18, .5 + k * .18)); b.setAttribute("opacity", a); b.setAttribute("transform", `translate(0,${-8 * (1 - a)})`); });
      const u = t - T0, k = Math.max(0, Math.min(NDRAW - 1, Math.floor(u / CYC))), c = u < 0 ? -1 : u - k * CYC, dr = DR[k];
      const fade = u < 0 ? 1 : (k < NDRAW - 1 ? 1 - seg(c, CYC - .5, CYC) : 1);
      // pool: this draw's players light up in their team's colour, leave, and return when the draw clears
      const sel = u < 0 ? [] : SEL[k], selIdx = new Map(sel.map((p, j) => [p, j]));
      pool.forEach((p, q) => { const j = selIdx.get(q);
        if (j === undefined) { p.setAttribute("fill", css3(tint(q % 2 ? C.red : C.blue, .4))); p.setAttribute("opacity", 1); return; }
        const gone = c >= depart(j) && fade > .02; p.setAttribute("fill", slotOf[j][0] ? P.red : P.blue); p.setAttribute("opacity", gone ? 0 : seg(c, 0, .3)); });
      fly.forEach((f, j) => { const p = ease(seg(c, depart(j), arrive(j))); if (u < 0 || p <= 0 || p >= 1) { f.setAttribute("opacity", 0); return; }
        const [tt, i] = slotOf[j], src = pool[sel[j]], x0 = +src.getAttribute("x") + 2.5, y0 = +src.getAttribute("y") + 2.5, grow = ease(seg(p, .7, 1)), s = 6 + (TS - 6) * grow;
        const cx = x0 + (SX(i) + TS / 2 - x0) * p, cy = y0 + (SY[tt] + TS / 2 - y0) * p - 40 * Math.sin(Math.PI * p);
        f.setAttribute("x", cx - s / 2); f.setAttribute("y", cy - s / 2); f.setAttribute("width", s); f.setAttribute("height", s); f.setAttribute("opacity", 1 - .85 * grow); });
      seats.forEach(st => { const { tt, i } = st, side = tt ? dr.them : dr.us, isYou = !tt && i === 0 && you !== undefined, j = isYou ? -1 : slotOf.findIndex(([a, b]) => a === tt && b === i);
        st.g.setAttribute("opacity", fade);
        const seated = u >= 0 && (isYou || c >= arrive(j) - .12), picked = u >= 0 && c >= pickAt(tt, i), f = side.forced[i];
        if (!seated) { st.main.setAttribute("opacity", 0); st.pick.setAttribute("opacity", 0); st.cross.setAttribute("opacity", 0); st.mainBox.setAttribute("opacity", 0); st.frame.setAttribute("opacity", 0); st.outline.setAttribute("opacity", 1); return; }
        setImg(st.main, side.team[i], `${k}-${side.team[i]}`); setImg(st.pick, side.picks[i], `${k}-${side.picks[i]}`);
        st.outline.setAttribute("opacity", picked ? 0 : 1); st.frame.setAttribute("opacity", picked ? 1 : 0);
        if (!f) { st.main.style.filter = ""; st.main.setAttribute("opacity", 1); st.main.setAttribute("x", st.x); st.main.setAttribute("y", st.y); st.main.setAttribute("width", TS); st.main.setAttribute("height", TS); st.pick.setAttribute("opacity", 0); st.cross.setAttribute("opacity", 0); st.mainBox.setAttribute("opacity", 0); return; }
        const a = ease(seg(c, pickAt(tt, i), pickAt(tt, i) + .5)), s = TS + (22 - TS) * a;
        st.main.setAttribute("x", st.x - 8 * a); st.main.setAttribute("y", st.y - 8 * a); st.main.setAttribute("width", s); st.main.setAttribute("height", s); st.main.setAttribute("opacity", 1); st.pick.setAttribute("opacity", a);
        st.main.style.filter = `grayscale(${a})`;
        st.cross.setAttribute("opacity", a > .9 && side.banned[i] ? 1 : 0); st.mainBox.setAttribute("opacity", a > .9 ? 1 : 0); });
      cells.forEach(({ i, j, r }) => { const m = Math.max(i, j), on = u >= 0 && (m < k || (m === k && c >= 3.0 + (i + j) * .06));
        r.setAttribute("fill", on ? valCol((RA[m].cells.get(i + "," + j) - D.win) * VMAX / .11) : P.panel); });
      const done = u < 0 ? -1 : c >= 4.1 ? k : k - 1;
      numc.setAttribute("opacity", done < 0 ? 0 : 1);
      if (done < 0) { num.textContent = ""; numn.textContent = ""; }
      else { num.textContent = `${(100 * RA[done].avg).toFixed(1)}%`; num.setAttribute("opacity", .45 + .55 * (done + 1) / NDRAW); numn.textContent = `${(done + 1) * (done + 1)} matchups scored`; }
    }
    return player($("t3pp"), $("t3ch"), [[0, "Bans", "The six bans on this branch."], [T0, "Players", "Unseen seats are filled with real players from your rank."],
      [T0 + 1.6, "Picks", "Everyone picks. A player whose main is banned switches the way real players do."], [T0 + 3.0, "Matchups", "Each lineup is scored against every opposing lineup."],
      [T0 + CYC * 2, "Average", `More draws, and the win chance settles. This draw's ${EN.mu} x ${EN.k} matchups average ${(100 * EN.win).toFixed(1)}%.`]], DUR, render);
  }

  let A, B; const played = { t2: false, t3: false };
  const build = () => { if (!D) return; pal(); A = buildT2(); B = buildT3(); if (played.t2) A.seek(1e3); if (played.t3) B.seek(1e3); };
  window.FIG = { get t2() { return A; }, get t3() { return B; } };
  // a new lobby: new numbers; once the figures have played, they show their last frame and play again from the button
  window.MethodFigs.show = d => { D = d; N = D.heroes; img = h => `img/heroes/${D.portraits[h]}.webp`;
    nOurs = D.nOurs; paths = 1; for (let k = 0; k < 6 - D.FB; k++) paths *= (nOurs - k); VMAX = Math.max(...D.ours.map(q => Math.abs(q.v))) || .001;
    const lb = D.lobby, fx = D.fixed.map(f => f.given ? N[f.h] : `their likeliest, ${N[f.h]}`);
    if ($("figLobby")) $("figLobby").textContent = `${lb.map}, ${lb.rank}${lb.you ? `, playing ${lb.you}` : ""}, banning ${D.first ? "first" : "second"}`
      + (fx.length ? `, after ${fx.join(", then ")}` : "") + (D.replay ? " (your bans are all in, so this is your last one)" : "");
    build(); };
  // the page's theme or view changes the palette: redraw with the new colours
  new MutationObserver(build).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", build);
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const io = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting || !A) return; const f = e.target.id === "t2" ? A : B; if (!f || f.stub) return; played[e.target.id] = true;
    if (still) f.seek(1e3); else f.start(); io.unobserve(e.target); }), { threshold: .45 });
  io.observe($("t2")); io.observe($("t3"));
  // scrolled out of view: a playing figure pauses where it is, and carries on when it comes back into view (one paused by hand stays paused)
  const away = { t2: false, t3: false };
  const vis = new IntersectionObserver(es => es.forEach(e => { const id = e.target.id, f = id === "t2" ? A : B; if (!f) return;
    if (!e.isIntersecting) { if (f.playing) { f.seek(f.t); away[id] = true; } }
    else if (away[id]) { away[id] = false; f.start(); } }), { threshold: 0 });
  vis.observe($("t2")); vis.observe($("t3"));
  // the section hidden: both figures stop at their first frame, and play again from there when the section is next seen
  // the simulator's draw for the lobby being shown: rebuild "Inside one ending" only (a playing "Forward, then back" carries on)
  window.MethodFigs.ending = e => { if (!D) return; D.ending = e; pal(); B = buildT3(); if (played.t3) B.seek(1e3); else { io.unobserve($("t3")); io.observe($("t3")); } };
  window.MethodFigs.reset = () => { if (A) A.seek(0); if (B) B.seek(0); played.t2 = played.t3 = false; away.t2 = away.t3 = false; io.observe($("t2")); io.observe($("t3")); };
} };
