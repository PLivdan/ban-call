/* Ban Call: the Methods figure, "One lobby, three possible types". The ban phase drawn as a game of incomplete information: three
   possible types of a lobby run in lanes of flowing bands (your bans blue, theirs red), dashed lines join the points the page can't
   tell apart, simulated games lead the bands and become the results, the scores come back, and the types fold into the page's tree.
   Illustrative numbers, each worked out from the ones to its right. Used by index.html (the Methods section) and tree.html (the
   test page). It needs #gt, #gtLegend, #gtMline, #gtpp, #gtch, #gtRec and #gtTip, and it plays by the old figures' rules: only once
   it is in view (Methods open), pausing out of view, back to the start when Methods is hidden, a still frame for reduced motion. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id), root = document.documentElement, NS = "http://www.w3.org/2000/svg";
  if (!$("gt")) return;
  const cl = x => Math.max(0, Math.min(1, x)), ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const seg = (t, a, b) => cl((t - a) / (b - a)), E = (t, a, b) => ease(seg(t, a, b)), lerp = (a, b, f) => a + (b - a) * f;
  const bump = (t, a, b) => { const s = seg(t, a, b); return s > 0 && s < 1 ? Math.sin(Math.PI * s) : 0; };
  const f1 = x => x.toFixed(1), fmt = x => x.toLocaleString("en-US");
  const pc = x => { const r = 100 * x; return (r >= 9.5 || r === 0 ? Math.round(r) : +r.toFixed(1)) + "%"; };

  // ================================================================ the example: one lobby, three types of the players the page can't see
  const NAME0 = { "gorr-the-god-butcher": "Gorr", "hela": "Hela", "magik": "Magik", "luna-snow": "Luna Snow", "scarlet-witch": "Scarlet Witch",
    "rocket-raccoon": "Rocket Raccoon", "peni-parker": "Peni Parker", "psylocke": "Psylocke", "mantis": "Mantis" };
  let NAME = NAME0; const nm = h => NAME[h] || h, nms = b => b.map(nm).join(" and "), img = h => `img/heroes/${h}.webp`;
  const DEFAULT = { names: NAME0, types: [
    { prior: .5, mains: ["hela", "magik", "luna-snow"] },
    { prior: .3, mains: ["scarlet-witch", "rocket-raccoon", "peni-parker"] },
    { prior: .2, mains: ["gorr-the-god-butcher", "psylocke", "mantis"] }], tree: {
  // the visible tree: four forks on one path (row: the ban column), the other options folded into one band each. p: their ban model's
  // odds in each type (sigma-hat_B), v: a folded branch's value in each type, leaf: the win chance after six bans in each type (V6)
    A1: { us: 1, row: 1, kids: [
      { b: ["gorr-the-god-butcher"], to: "B2" },
      { b: ["hela"], v: [56.0, 50.5, 50.0] },
      { more: 53 }] },
    B2: { us: 0, row: 2, kids: [
      { b: ["scarlet-witch", "rocket-raccoon"], p: [.40, .03, .30], to: "A2" },
      { b: ["hela", "magik"], p: [.03, .35, .25], v: [57.0, 51.5, 52.0] },
      { more: 1483, p: [.57, .62, .45], v: [52.0, 53.6, 57.0] }] },
    A2: { us: 1, row: 3, kids: [
      { b: ["hela", "magik"], to: "B1" },
      { b: ["peni-parker", "mantis"], v: [51.0, 60.0, 55.0] },
      { more: 1324 }] },
    B1: { us: 0, row: 4, kids: [
      { b: ["psylocke"], p: [.35, .30, .01], leaf: [58.6, 49.6, 52.0] },
      { b: ["peni-parker"], p: [.25, .01, .40], leaf: [57.6, 51.0, 49.4] },
      { more: 49, p: [.40, .69, .59], v: [58.0, 50.2, 50.6] }] },
  } };

  const OURSPLIT = [.7, .12, .18];                                        // how the simulated games spread over your options (the same in every type)
  // ================================================================ drawing helpers
  const P = {}, C = {}; let TINT = [];
  const css = n => getComputedStyle(root).getPropertyValue(n).trim();
  const rgb = h => { h = h.replace("#", ""); if (h.length === 3) h = h.split("").map(c => c + c).join(""); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const mixA = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t)), c3 = a => `rgb(${a.join(",")})`;
  const pal = () => { ["paper", "ink", "faint", "hair", "panel", "blue", "red", "d1", "d2", "d3"].forEach(k => { P[k] = css("--" + k); C[k] = rgb(P[k]); });
    TINT = [C.d1, C.d2, C.d3]; };
  const winCol = v => { const d = (v - 50) / 10, t = Math.min(1, Math.abs(d)); return c3(mixA(C.paper, d >= 0 ? C.blue : C.red, .12 + .88 * Math.pow(t, .7))); };
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const S = (e, k, v) => { if (typeof v === "number") v = String(+v.toFixed(2)); const c = e.__c || (e.__c = {}); if (c[k] !== v) { c[k] = v;
    if (k === "fill" && (e.tagName === "text" || e.tagName === "tspan")) e.style.fill = v; else e.setAttribute(k, v); } };     // text fills as style: the main page styles svg text
  const txt = (e, s) => { if (e.__t !== s) { e.__t = s; e.textContent = s; } };
  let HL = null;                                                       // the recursion term hovered: everything else fades
  const hl = keys => HL && !(keys || []).includes(HL) ? .1 : 1;
  const op = (e, o, keys) => S(e, "opacity", Math.max(0, o) * hl(keys));
  const rng = s => () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  // a ban as on the page: the portrait greyed, a slash from corner to corner and a frame, both in the banning team's colour
  function banTile(parent, h, s) { const g = el("g", {}, parent);
    el("rect", { x: -s / 2 - 1.5, y: -s / 2 - 1.5, width: s + 3, height: s + 3 }, g).dataset.r = "back";
    const im = el("image", { href: img(h), x: -s / 2, y: -s / 2, width: s, height: s, preserveAspectRatio: "xMidYMid slice" }, g); im.style.filter = "grayscale(1)";
    el("line", { x1: -s / 2, y1: -s / 2, x2: s / 2, y2: s / 2, "stroke-width": 1.6 }, g).dataset.r = "ink";
    el("rect", { x: -s / 2, y: -s / 2, width: s, height: s, fill: "none", "stroke-width": 1.6 }, g).dataset.r = "ink"; return g; }
  const paintTile = (g, col) => g.querySelectorAll("[data-r]").forEach(e => { if (e.dataset.r === "back") S(e, "fill", P.paper); else S(e, "stroke", col); });

  const TS = { now: [.2, .8], cards: w => [2.0 + .3 * w, 2.9 + .3 * w], info: { A1: [8.0, 8.9], A2: [19.2, 20.0] }, pulse: [9.2, 11.2], tags: [13.9, 14.6],
    post: [15.0, 17.5], grid: [28.6, 34.6], leafVal: [34.6, 35.6], open: [28.3, 29.0], cells: [28.9, 32.0], avg: [32.1, 32.7], close: [34.7, 35.7], wave: [36.7, 42.7], note: [42.7, 43.5],
    fold: [44.7, 47.5], merged: [46.9, 47.9], panel: [47.3, 48.3] };
  const CH = [0, 6, 12, 19, 28, 36.5, 44.5], DUR = 57;
  // ================================================================ playing it: the chapters, the step's equation, the legend
  const chapter = t => { let c = 0; CH.forEach((a, i) => { if (t >= a) c = i; }); return c; };
  const M = s => `<span class="math">${s}</span>`;
  const STEP = [
    [M(`<i>θ</i> = (<i>θ</i><sub><i>A</i></sub>, <i>θ</i><sub><i>B</i></sub>) ~ <i>π</i>(<i>θ</i> | <i>x</i>)`), "Nature draws the type given what the page sees (x: map, rank band, rank, side, heroes on show)"],
    [M(`<i>V</i><sub>0</sub>(<i>s</i><sub>0</sub>) = max<sub><i>b</i></sub> <i>V̄</i><sub>1</sub>(<i>s</i><sub>0</sub><i>b</i>)`), "one b for the whole information set s₀, the best in expectation"],
    [M(`<i>π</i>(<i>θ</i> | <i>s</i><sub>3</sub>) ∝ <i>π</i>(<i>θ</i> | <i>x</i>) <i>σ̂</i><sub><i>B</i></sub>(<i>b</i><sub><i>B</i></sub><sup>1</sup><i>b</i><sub><i>B</i></sub><sup>2</sup> | <i>s</i><sub>1</sub>, <i>θ</i><sub><i>B</i></sub>)`), "Bayes' rule: their bans depend on their type, so they are evidence about it"],
    [M(`max<sub><i>a</i></sub> max<sub><i>b</i></sub> <i>V̄</i><sub>5</sub>(<i>s</i><sub>3</sub><i>ab</i>) = max<sub>{<i>a</i>,<i>b</i>}</sub> <i>V̄</i><sub>5</sub>(<i>s</i><sub>3</sub><i>ab</i>)`), "two of your bans in a row are one choice of pair, the same across the information set"],
    [M(`<i>V</i><sub>6</sub>(<i>s</i><sub>6</sub>; <i>θ</i>) = <sup>1</sup>/<sub>28²</sub> Σ<sub><i>i</i>,<i>j</i></sub> <i>P</i>(<i>W</i><sub><i>A</i></sub> = 1 | <i>L</i><sub><i>A</i></sub><sup><i>i</i></sup>, <i>L</i><sub><i>B</i></sub><sup><i>j</i></sup>, <i>m</i>)`), "the payoff in type θ: 28 lineups a side, every pairing scored on the map"],
    [M(`<i>V</i><sub><i>k</i></sub>(<i>s</i><sub><i>k</i></sub>; <i>θ</i>) = Σ<sub><i>b</i></sub> <i>σ̂</i><sub><i>B</i></sub>(<i>b</i> | <i>s</i><sub><i>k</i></sub>, <i>θ</i><sub><i>B</i></sub>) <i>V</i><sub><i>k</i>+1</sub>(<i>s</i><sub><i>k</i></sub><i>b</i>; <i>θ</i>)`), "backward induction within a type: an expectation at their bans, the page's choice at yours"],
    [M(`<i>V</i><sub><i>k</i></sub>(<i>s</i><sub><i>k</i></sub>) = 𝔼<sub><i>θ</i> | <i>s</i><sub><i>k</i></sub></sub>[<i>V</i><sub><i>k</i></sub>(<i>s</i><sub><i>k</i></sub>; <i>θ</i>)]`), "a regression on s_k alone learns this: simulated games reach s_k from each type in proportion to its posterior"]];
  STEP[6][1] = STEP[6][1].replace("s_k", "s<sub>k</sub>").replace("s_k", "s<sub>k</sub>");
  let shownStep = -1;
  // ================================================================ the figure for one data set (the example, or the lobby's)
  function build(D) {
  NAME = D.names; const TYPES = D.types, TREE = JSON.parse(JSON.stringify(D.tree)), LIVE = !!D.live, MU = D.mu || 28, KK = D.k || 28;
  const WS = [0, 1, 2], PRIOR = TYPES.map(d => d.prior);
  const IDS = ["A1", "B2", "A2", "B1"];       // OURSPLIT (outside): how the simulated games spread over your options (the same in every type)
  const bayes = (pi, p) => { const u = pi.map((x, w) => x * p[w]), s = u.reduce((a, b) => a + b, 0); return u.map(x => x / s); };
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  // what the page has seen at each point: the types' odds (Bayes' rule here, implicit in the model), top down
  const POST = { A1: PRIOR }, MASS = { A1: 1 };
  IDS.forEach(id => { const n = TREE[id]; n.kids.forEach((k, i) => {
    k.post = n.us ? POST[id] : bayes(POST[id], k.p); if (!n.us) k.pp = dot(POST[id], k.p);
    k.mass = MASS[id] * (n.us ? OURSPLIT[i] : k.pp); if (k.to) { POST[k.to] = k.post; MASS[k.to] = k.mass; k.node = k.to; } }); });
  // the values: each type's (the page's choices on your turns, their odds on theirs) bottom up, and the page's (averaged over the types)
  const WV = {}, kv = (k, w) => k.leaf ? k.leaf[w] : k.v ? k.v[w] : k.to ? WV[k.to][w] : null;
  [...IDS].reverse().forEach(id => { const n = TREE[id];
    n.kids.forEach(k => { if (k.more && !k.v) return; k.wv = WS.map(w => kv(k, w)); k.pv = dot(k.post, k.wv); k.prv = dot(PRIOR, k.wv); });
    if (n.us) { const opts = n.kids.filter(k => k.wv); n.pick = n.kids.indexOf(opts.reduce((a, b) => dot(POST[id], b.wv) > dot(POST[id], a.wv) ? b : a));
      n.alone = WS.map(w => n.kids.indexOf(opts.reduce((a, b) => b.wv[w] > a.wv[w] ? b : a))); WV[id] = n.kids[n.pick].wv; }
    else WV[id] = WS.map(w => n.kids.reduce((s, k) => s + k.p[w] * kv(k, w), 0));
    n.wv = WV[id]; n.post = POST[id]; n.pv = dot(POST[id], WV[id]); });

  // ================================================================ the figure: the ban phase as flowing bands (the look of "Forward, then back")
  // The bans run left to right and every band is as tall as its share of the simulated games. The three types first run in lanes
  // of their own. In the last chapter they slide together into the one tree the page can see, each band striped by the types its
  // games came from.
  const VW = 1000, VH = 626, XN = 84, XS = [196, 336, 476, 608, 726], X5 = XS[4], TOPY = 76, BOTY = 548, FLOW = 306;
  const svg = el("svg", { viewBox: `0 0 ${VW} ${VH}`, role: "img", "aria-label": "The ban phase as flowing bands: three types of hidden players in lanes, the page's choices joined across them, then the types folded into the page's tree" }, $("gt"));
  const defs = el("defs", {}, svg), clipR = el("rect", { x: 0, y: 0, height: VH, width: 0 }, el("clipPath", { id: "gtclip" }, defs));
  const gClip = el("g", { "clip-path": "url(#gtclip)" }, svg), L = { band: el("g", {}, gClip), mark: el("g", {}, gClip), stream: el("g", {}, gClip) };
  ["res", "info", "lab", "tok", "txt", "card", "panel", "head", "grid"].forEach(k => L[k] = el("g", {}, svg));
  const ITEMS = [], add = f => ITEMS.push(f);
  const REV = [[0, XN], [1.0, XN], [2.6, XS[0] + 2], [6.2, XS[0] + 2], [7.8, XS[1] + 2], [12.2, XS[1] + 2], [13.8, XS[2] + 2], [20.4, XS[2] + 2], [22.6, XS[3] + 2], [23.4, XS[3] + 2], [26.4, X5 + 42], [26.5, VW]];
  const reveal = t => { for (let i = 1; i < REV.length; i++) if (t < REV[i][0]) { const [ta, xa] = REV[i - 1], [tb, xb] = REV[i]; return lerp(xa, xb, ease(seg(t, ta, tb))); } return VW; };
  const WAVE = t => lerp(X5 + 34, XS[0] - 34, ease(seg(t, ...TS.wave)));
  const passed = (x, t) => t < TS.wave[0] ? 0 : ease(cl((x - WAVE(t)) / 40));
  let FOLD = 0;
  const fold = t => E(t, ...TS.fold);
  const post3 = POST.A2, pmax = Math.max(...post3);
  const dim = (w, t, f) => lerp(lerp(1, .32 + .68 * Math.sqrt(post3[w] / pmax), E(t, ...TS.post)), 1, f);
  const tipOf = new Map(), tip = (e, fn) => { e.dataset.gtip = 1; tipOf.set(e, fn); };   // data-gtip: the page's own tooltips read data-tip
  const tint = (c, k) => mixA(C.paper, c, k), winA = v => { const d = (v - 50) / 10, q = Math.min(1, Math.abs(d)); return mixA(C.paper, d >= 0 ? C.blue : C.red, .12 + .88 * Math.pow(q, .7)); };
  const hsh = a => { const x = Math.sin(a) * 43758.5453; return x - Math.floor(x); };

  // ---------------------------------------------------------------- the page's tree: one point per thing the page can see, a lane per type
  const V = [], mk = (id, col, parent, ci, k, t) => { const v = { id, col, parent, ci, k, t, kids: [], x: col < 0 ? XN : XS[col] }; V.push(v); if (parent) parent.kids.push(v); return v; };
  const ROOT = mk("now", -1, null, 0, null, null);
  (function grow(tid, parent, ci, k) { const n = mk(tid, TREE[tid].row - 1, parent, ci, k, TREE[tid]);
    TREE[tid].kids.forEach((kk, i) => { if (kk.to) grow(kk.to, n, i, kk); else mk(`${tid}.${i}`, 4, n, i, kk, null).term = true; }); })("A1", ROOT, 0, null);
  const VID = Object.fromEntries(V.map(v => [v.id, v]));
  // their forks' shares of the band: the probabilities, or (the lobby's numbers) their square roots renormalised, so a likely branch
  // among a thousand pairs is still drawn; the tips keep the probabilities
  IDS.forEach(id => { const n = TREE[id]; if (n.us) return; WS.forEach(w => { const r = n.kids.map(k => LIVE ? Math.sqrt(k.p[w]) * (k.more ? .5 : 1) : k.p[w]), t = r.reduce((a, b) => a + b, 0);   // the folded band at half: it stands for hundreds of options
    n.kids.forEach((k, i) => (k.q = k.q || [])[w] = r[i] / t); }); });
  V.forEach(v => { v.m = WS.map(w => !v.parent || !v.parent.t ? 1 : v.parent.m[w] * (v.parent.t.us ? OURSPLIT[v.ci] : v.k.q[w]));
    v.h = WS.map(w => FLOW * PRIOR[w] * v.m[w]); v.H = v.h[0] + v.h[1] + v.h[2]; v.mix = v.h.map(x => x / v.H); });
  // lanes: the endings stacked with gaps (wider between branches than within one), each fork centred on its branches
  const TERMS = V.filter(v => v.term), units = TERMS.map((t, i) => i ? (t.parent === TERMS[i - 1].parent ? 1 : 2) : 0), U1 = units.reduce((a, b) => a + b, 0), LGU = 6;
  const gsW = (BOTY - TOPY - FLOW) / (3 * U1 + 2 * LGU), LANE = [];
  let yy = TOPY;
  WS.forEach(w => { const y0 = yy; TERMS.forEach((t, i) => { yy += units[i] * gsW; (t.tw = t.tw || [])[w] = yy; yy += t.h[w]; }); LANE[w] = [y0, yy]; yy += LGU * gsW; });
  [...V].reverse().forEach(v => { if (v.term || v === ROOT) return; const f = v.kids[0], l = v.kids[v.kids.length - 1]; v.tw = WS.map(w => (f.tw[w] + l.tw[w] + l.h[w]) / 2 - v.h[w] / 2); });
  { const r0 = (LANE[0][0] + LANE[2][1]) / 2 - FLOW / 2; let c = r0; ROOT.tw = WS.map(w => { const q = c; c += ROOT.h[w]; return q; }); }
  // folded: one tree, every band the three types' bands side by side
  const gsM = Math.min(11, (BOTY - TOPY - FLOW) / U1); let ym = TOPY + (BOTY - TOPY - FLOW - U1 * gsM) / 2;
  TERMS.forEach((t, i) => { ym += units[i] * gsM; t.tm = ym; ym += t.H; });
  [...V].reverse().forEach(v => { if (v.term) return; const f = v.kids[0], l = v.kids[v.kids.length - 1]; v.tm = (f.tm + l.tm + l.H) / 2 - v.H / 2; });
  V.forEach(v => { let c = v.tm; v.tmw = WS.map(w => { const q = c; c += v.h[w]; return q; }); });
  const topOf = (v, w, f) => lerp(v.tw[w], v.tmw[w], f);
  function ribG(v, w, f) { const p = v.parent; let pa = p.tw[w], pm = p.tm;
    for (let c = 0; c < v.ci; c++) { pa += p.kids[c].h[w]; pm += p.kids[c].H; } for (let q = 0; q < w; q++) pm += v.h[q];
    const a0 = lerp(pa, pm, f), b0 = topOf(v, w, f), h = v.h[w]; return { xa: p.x, xb: v.x, a0, a1: a0 + h, b0, b1: b0 + h }; }
  const bundle = (v, f) => { const g0 = ribG(v, 0, f), g2 = ribG(v, 2, f); return { xa: g0.xa, xb: g0.xb, a0: g0.a0, a1: g2.a1, b0: g0.b0, b1: g2.b1 }; };
  const r2 = x => Math.round(x * 100) / 100;
  const dRib = g => { const xm = (g.xa + g.xb) / 2, a0 = r2(g.a0), a1 = r2(g.a1), b0 = r2(g.b0), b1 = r2(g.b1);
    return `M${g.xa},${a0}C${xm},${a0} ${xm},${b0} ${g.xb},${b0}L${g.xb},${b1}C${xm},${b1} ${xm},${a1} ${g.xa},${a1}Z`; };
  // a point on a band's centre line, u from 0 at the fork to 1 at the far end, and the u where the line reaches x
  const onRib = (g, u) => { const v = 1 - u, xm = (g.xa + g.xb) / 2, ya = (g.a0 + g.a1) / 2, yb = (g.b0 + g.b1) / 2;
    return [g.xa * v * v * v + 3 * xm * v * u + g.xb * u * u * u, ya + (yb - ya) * (3 * u * u - 2 * u * u * u)]; };
  const uAtX = (g, x) => { let lo = 0, hi = 1; for (let i = 0; i < 24; i++) { const u = (lo + hi) / 2; if (onRib(g, u)[0] < x) lo = u; else hi = u; } return (lo + hi) / 2; };

  // ---------------------------------------------------------------- colours: the type's grey, then blue through your bans and red through theirs
  const valOf = (v, w) => v.term ? (v.k.leaf ? v.k.leaf[w] : v.k.v ? v.k.v[w] : null) : WV[v.id][w];
  const blueOf = x => tint(C.blue, (DK() ? .45 : .28) + (DK() ? .55 : .72) * cl((x - 50) / 6.5));
  const DK = () => C.paper[0] + C.paper[1] + C.paper[2] < 300;            // the dark theme
  function own(v, w, t, f) { const p = v.parent; let c;
    if (!p.t) c = TINT[w];
    else if (p.t.us) { const val = valOf(v, w); c = tint(C.blue, DK() ? .66 : .5);
      if (val !== null) c = mixA(c, blueOf(val), passed(Math.min((p.x + v.x) / 2, p.x + 70), t));        // the scores coming back deepen your bands by their value
      if (v.ci !== p.t.pick) c = mixA(c, tint(C.blue, .12), passed(p.x + 8, t));                        // and the options the page would not take fade
      if (p.id === "A1" && v.ci === p.t.pick) c = mixA(c, C.blue, .55 * bump(t, ...TS.pulse)); }
    else { c = tint(C.red, DK() ? .8 : .7); if (v === VID.A2) c = mixA(c, C.red, .55 * bump(t, TS.post[0] - .5, TS.post[1])); }
    return mixA(c, C.paper, [0, .3, .56][w] * f); }                       // folded: the types as shades of the same blue or red, type 1 strongest
  const KEYS = v => !v.parent.t ? ["E"] : v.parent.t.us ? ["max"] : ["sig"];
  const reason = (k, w) => { const own_ = k.b ? k.b.filter(h => TYPES[w].mains.includes(h)) : [];
    return own_.length ? ` Their players main ${nms(own_)} in this type, so they rarely ban ${own_.length > 1 ? "them" : "that hero"}.` : ""; };
  const nameOf = v => v.k.b ? nms(v.k.b) : `one of ${fmt(v.k.more)} more ${v.parent.id === "A1" || v.parent.id === "B1" ? "heroes" : "pairs"}`;

  // ---------------------------------------------------------------- the bands
  const RIB = [];
  V.forEach(v => { if (!v.parent) return; WS.forEach(w => {
    const id = `gtg${w}_${v.id.replace(".", "_")}`, gr = el("linearGradient", { id, gradientUnits: "userSpaceOnUse", x1: v.parent.x, x2: v.x, y1: 0, y2: 0 }, defs);
    const st = [0, Math.min(.5, 64 / (v.x - v.parent.x)), 1].map(o => el("stop", { offset: o }, gr));
    const R = { v, w, st, p: el("path", { fill: `url(#${id})`, stroke: `url(#${id})`, "stroke-width": .5 }, L.band) }; RIB.push(R);
    tip(R.p, () => { const p = v.parent, val = valOf(v, w);
      if (!p.t) return `<b>Type ${w + 1}</b>: ${FOLD > .5 ? `${pc(PRIOR[w])} of the simulated games start with this type` : `prior probability ${pc(PRIOR[w])} (π(θ<sub>${w + 1}</sub> | x)), before anyone bans`}.`;
      if (FOLD > .5) return `<b>${p.t.us ? "You" : "They"} ban ${nameOf(v)}</b><br>${pc(v.mix[w])} of the games on this band come from type ${w + 1}.`;
      return p.t.us ? `<b>You ban ${nameOf(v)}</b>${val !== null ? `: worth ${f1(val)}% in type ${w + 1}.` : `. Each one is scored the same way, and none beats ${nms(p.kids[p.t.pick].k.b)} on average.`}`
        : `<b>They ban ${nameOf(v)}</b>: ${pc(v.k.p[w])} in type ${w + 1} (σ̂<sub>B</sub>).${reason(v.k, w)}`; }); }); });
  add(t => { const f = FOLD, OWN = WS.map(() => ({}));
    S(clipR, "width", reveal(t));
    RIB.forEach(R => OWN[R.w][R.v.id] = own(R.v, R.w, t, f));
    RIB.forEach(R => { const { v, w } = R, o = OWN[w][v.id], pin = v.parent.parent ? OWN[w][v.parent.id] : o;
      const nx = v.term ? o : OWN[w][(v.t.us ? v.kids[v.t.pick] : v.kids[0]).id];
      S(R.p, "d", dRib(ribG(v, w, f))); S(R.st[0], "stop-color", c3(mixA(pin, o, .5))); S(R.st[1], "stop-color", c3(o)); S(R.st[2], "stop-color", c3(mixA(o, nx, .5)));
      op(R.p, v.parent.t ? dim(w, t, f) : 1, KEYS(v)); }); });

  // the forks: a thin bar in the colour of whoever bans there (a choice for you, odds for them)
  const nodeTip = (v, w) => { const n = v.t, first = v.id === "A1";
    if (n.us) return `<b>Your ${first ? "first ban" : "second and third bans"}, type ${w + 1}</b><br>`
      + (n.alone[w] !== n.pick ? `If the page knew the type it would ban ${nms(n.kids[n.alone[w]].b)} (${f1(n.kids[n.alone[w]].wv[w])}%). ` : `${nms(n.kids[n.pick].b)} would be best even if the page knew the type. `)
      + `It doesn't, so it takes the best in expectation: ${nms(n.kids[n.pick].b)}, ${f1(n.kids[n.pick].pv)}%.`
      + (!first ? (n.kids[1].prv > n.kids[0].prv ? `<br><span class="d">Before their bans, ${nms(n.kids[1].b)} looked best (${f1(n.kids[1].prv)}% against ${f1(n.kids[0].prv)}%). Their bans changed how likely each type is, and that changed the call.</span>`
        : `<br><span class="d">Their bans moved the types' odds from ${PRIOR.map(pc).join(" / ")} to ${POST[v.id].map(pc).join(" / ")}, not enough to change the call.</span>`) : "");
    return `<b>Their ${v.id === "B2" ? "first two bans" : "last ban"}, type ${w + 1}</b><br>Worth ${f1(n.wv[w])}% to you here: ${n.kids.map(k => `${pc(k.p[w])} × ${f1(kv(k, w))}`).join(" + ")}.`; };
  V.forEach(v => { if (!v.t) return; WS.forEach(w => { const r = el("rect", { width: 3 }, L.mark); tip(r, () => nodeTip(v, w));
    add(t => { const f = FOLD; S(r, "x", v.x - 1.5); S(r, "y", topOf(v, w, f)); S(r, "height", Math.max(.6, v.h[w])); S(r, "fill", v.t.us ? P.blue : P.red);
      op(r, dim(w, t, f), v.t.us ? ["max", "s"] : ["sig"]); }); }); });

  // now: the lobby, before anything is drawn
  const nowR = el("rect", { x: XN - 10, width: 10, height: FLOW }, L.res), nowT = el("text", { x: XN - 16, class: "ar", "font-size": 13, "text-anchor": "end" }, L.res), nowS = el("text", { x: XN - 16, "font-size": 11.5, "text-anchor": "end" }, L.res);
  nowT.textContent = "Now"; nowS.textContent = LIVE ? (D.banSecond ? "your lobby, as if first" : "your lobby (x)") : "the lobby (x)";
  tip(nowR, () => `<b>Now (x)</b>: what the page can see. The map, the rank, who bans first and the heroes on show.` + (LIVE ? `<br><span class="d">These are your lobby's numbers from the model${D.banSecond ? ", drawn as if you ban first" : ""}: the types are its simulated opponent teams in three groups.</span>` : `<br><span class="d">An illustration: the numbers are made up to show the reasoning.</span>`));
  add(t => { const y = lerp(ROOT.tw[0], ROOT.tm, FOLD), a = seg(t, ...TS.now); S(nowR, "y", y); S(nowR, "fill", P.ink); op(nowR, a, ["E"]);
    S(nowT, "y", y + FLOW / 2 - 2); S(nowS, "y", y + FLOW / 2 + 12); S(nowT, "fill", P.ink); S(nowS, "fill", P.faint); op(nowT, a); op(nowS, a); });

  // ---------------------------------------------------------------- an ending opened in full: a click on a result bar (once scored)
  // The endings with their own value (their named last bans, each type): every one of your drafted lineups against every one of
  // theirs, and on hover the two lineups behind a square. The lobby's are one draw of the simulator; the example's are made up.
  let CURT = 0;
  const ov = document.createElement("div"); ov.className = "gtOv"; $("gt").appendChild(ov);
  const gridOf = (kid, w) => { const G = D.grids && D.grids[kid] && D.grids[kid][w]; if (G) return { n: D.n, vals: G.pairs, us: G.us, them: G.them };
    const base = TREE.B1.kids[kid].leaf[w], n = 28, ra = Array.from({ length: n }, (_, i) => (hsh(i * 1.31 + kid * 7 + w * 3) - .5) * 16), ca = Array.from({ length: n }, (_, j) => (hsh(j * 2.11 + kid * 5 + w) - .5) * 16);
    let v = []; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v.push(base + ra[i] + ca[j] + (hsh(i * 29.3 + j * 13.7 + kid + w) - .5) * 14);
    const m = v.reduce((a, b) => a + b, 0) / v.length; v = v.map(x => x + base - m); return { n, vals: v, us: null, them: null }; };
  const tiles = (L_, side) => L_.p.map((h, j) => `<span class="pt ${side}${L_.f[j] ? " sw" : ""}" title="${nm(h)}${L_.f[j] ? ": their main was banned, so they switched" : ""}"><img src="${img(h)}" alt="${nm(h)}"></span>`).join("");
  function openGrid(kid, w) {
    const G = gridOf(kid, w), n = G.n, avg = G.vals.reduce((a, b) => a + b, 0) / G.vals.length, k = TREE.B1.kids[kid];
    if (window.GameTree && GameTree.playing) GameTree.pause();
    ov.innerHTML = `<div class="gtOvBox" role="dialog" aria-label="One ending opened up"><div class="gtOvHead"><b>Type ${w + 1}, then they ban ${nm(k.b[0])}</b><button class="gtX" aria-label="Close">×</button></div>
      <div class="gtOvSub">Your ${n} drafted lineups down, their ${n} across, every pairing scored on the map. Average ${f1(avg)}%${G.us ? ", one draw of the simulator (the ending's " + f1(k.leaf[w]) + "% averages four)" : " (made-up numbers in the example)"}.</div>
      <div class="gtOvBody"><div class="gtGrid" style="grid-template-columns:repeat(${n},1fr)">${G.vals.map((v, i) => `<i data-i="${i}" style="background:${c3(winA(v))}"></i>`).join("")}</div>
      <div class="gtLine"><p class="d">${G.us ? "Hover a square: the two lineups behind it." : "With your lobby's numbers, hovering a square shows the two lineups behind it."}</p></div></div></div>`;
    ov.classList.add("on");
    const line = ov.querySelector(".gtLine"), grid = ov.querySelector(".gtGrid");
    grid.addEventListener("mouseover", e => { const c = e.target.closest("i"); if (!c) return; const i = +c.dataset.i, u = Math.floor(i / n), o = i % n, v = G.vals[i];
      grid.querySelectorAll("i.hr, i.hc").forEach(x => x.classList.remove("hr", "hc"));
      for (let j = 0; j < n; j++) { grid.children[u * n + j].classList.add("hr"); grid.children[j * n + o].classList.add("hc"); }
      line.innerHTML = G.us ? `<div class="lt us"><b>Your lineup ${u + 1}</b><div class="row">${tiles(G.us[u], "us")}</div></div>
        <div class="vs"><span class="big" style="color:${v >= 50 ? P.blue : P.red}">${f1(v)}%</span><span class="d">your win chance in this pairing</span></div>
        <div class="lt them"><b>Their lineup ${o + 1}</b><div class="row">${tiles(G.them[o], "them")}</div></div>
        <p class="d">A dot: that player's main was banned, so they switched heroes.</p>`
        : `<div class="vs"><span class="big">${f1(v)}%</span><span class="d">your win chance, row ${u + 1} against column ${o + 1}</span></div>`; });
    ov.querySelector(".gtX").onclick = closeGrid; ov.onclick = e => { if (e.target === ov) closeGrid(); };
  }
  function closeGrid() { ov.classList.remove("on"); ov.innerHTML = ""; }
  // ---------------------------------------------------------------- the endings: every ending is drafted and scored (the result bars)
  TERMS.forEach((tv, ti) => WS.forEach(w => {
    const g = el("g", {}, L.res), blk = el("rect", {}, g), cells = [0, 1, 2, 3, 4].map(() => el("rect", { width: 4.2 }, g)), val = valOf(tv, w), vk = tv.parent.t.us ? ["score", "vbar"] : ["score", "vnext"];
    tip(g, () => tv.k.leaf ? `<b>After six bans, type ${w + 1}</b>: both teams draft ${MU} lineups from the players in this type and all ${MU * KK} pairings are scored. Their average: ${f1(val)}% (V<sub>6</sub>).${CURT >= TS.leafVal[0] ? "<br><b>Click to open it.</b>" : ""}`
      : val !== null ? `<b>${tv.k.b ? nms(tv.k.b) : `Their other ${fmt(tv.k.more)} ${tv.parent.id === "B2" ? "pairs" : "bans"}`}</b>: a branch of its own, played out and scored the same way, folded up here. Worth ${f1(val)}% in type ${w + 1}.`
      : `<b>${fmt(tv.k.more)} more legal ${tv.parent.id === "A1" ? "bans" : "pairs"}</b>, each played out and scored the same way. None beats ${nms(tv.parent.kids[tv.parent.t.pick].k.b)} on average.`);
    if (tv.k.leaf) { g.style.cursor = "pointer"; g.addEventListener("click", () => { if (CURT >= TS.leafVal[0]) openGrid(tv.ci, w); }); }
    const vt = val !== null && tv.h[w] >= 7 ? el("text", { x: X5 + 30, "font-size": 11.5, "font-weight": 600 }, L.txt) : null;
    if (vt) tip(vt, () => `<b>${f1(val)}%</b> in type ${w + 1}`);
    let off = null;                                                     // the offset of the game that runs into this bar (the bar grows as it goes in)
    add(t => { if (off === null) { const T = TOK.find(T_ => T_.w === w && T_.r[T_.r.length - 1] === tv); off = T ? T.off : 4; }
      const f = FOLD, y0 = topOf(tv, w, f), h = tv.h[w], grow = Math.max(0, Math.min(22, reveal(t) - 3 - off - X5 + 4)), sc = seg(t, TS.grid[0] - .5, TS.grid[0]);
      const res = E(t, ...TS.leafVal), step = Math.floor(Math.min(t, TS.leafVal[0]) * 8);
      // grown as one solid block in the colour of the band that fed it, then split into the scored lineups when the scoring starts
      S(blk, "x", X5 + 2); S(blk, "y", y0); S(blk, "height", Math.max(.6, h)); S(blk, "width", grow); S(blk, "fill", c3(mixA(own(tv, w, t, f), moverA(tv), .35))); S(blk, "opacity", 1 - sc);
      cells.forEach((c, j) => { S(c, "x", X5 + 2 + j * 4.4); S(c, "y", y0); S(c, "height", Math.max(.6, h)); S(c, "width", Math.max(0, Math.min(4.2, grow - j * 4.4))); S(c, "opacity", sc);
        S(c, "fill", c3(val === null ? tint(C.faint, .3) : mixA(winA(val + (hsh(ti * 31 + w * 7 + j * 3.3 + step * 11.1) - .5) * 26), winA(val), res))); });
      op(g, (grow > 0 ? 1 : 0) * dim(w, t, f), vk);
      if (vt) { S(vt, "y", y0 + h / 2 + 4); S(vt, "fill", P.ink); txt(vt, f1(val)); op(vt, res * dim(w, t, f) * (1 - cl(f * 2)), vk); } }); }));
  TERMS.forEach(tv => { if (!tv.k.wv || tv.H < 7) return; const vt = el("text", { x: X5 + 30, "font-size": 11.5, "font-weight": 700 }, L.txt);
    tip(vt, () => avgTip(tv.k.wv, tv.k.post, tv.k.pv));
    add(t => { S(vt, "y", tv.tm + tv.H / 2 + 4); S(vt, "fill", P.ink); txt(vt, f1(tv.k.pv)); op(vt, E(t, ...TS.merged), tv.parent.t.us ? ["vbar"] : ["vnext"]); }); });
  const avgTip = (vals, post, v) => `<b>${f1(v)}%</b> = ${post.map((q, w) => `${pc(q)} × ${f1(vals[w])}`).join(" + ")}<br><span class="d">The types weighted by the page's beliefs at this point (the posterior).</span>`;

  // ---------------------------------------------------------------- the values carried back: the scores line, then each fork's value
  const wg = el("linearGradient", { id: "gtwglow", x1: 0, x2: 1, y1: 0, y2: 0 }, defs), wstops = [[0, 0], [.55, .22], [.8, .35], [1, 0]].map(([o]) => el("stop", { offset: o }, wg));
  const wave = el("g", {}, L.head), wgl = el("rect", { x: -2, y: TOPY - 8, width: 40, height: BOTY - TOPY + 16, fill: "url(#gtwglow)" }, wave);
  const wln = el("line", { x1: 0, x2: 0, y1: TOPY - 8, y2: BOTY + 12, "stroke-width": 2.2 }, wave), war = el("path", { d: `M-4,${BOTY + 6} l-10,0 m4,-4 l-4,4 l4,4`, fill: "none", "stroke-width": 1.6 }, wave);
  const wtx = el("text", { x: 4, y: BOTY + 10, "font-size": 11.5, "font-weight": 600 }, wave); wtx.textContent = "Scores";
  add(t => { const on = t > TS.wave[0] && t < TS.wave[1] + .25 ? Math.min(1, seg(t, TS.wave[0], TS.wave[0] + .25), 1 - seg(t, TS.wave[1], TS.wave[1] + .25)) : 0;
    S(wave, "transform", `translate(${WAVE(t)} 0)`); S(wave, "opacity", on); [0, .22, .35, 0].forEach((a, i) => { S(wstops[i], "stop-color", P.blue); S(wstops[i], "stop-opacity", a); });
    S(wln, "stroke", P.blue); S(war, "stroke", P.blue); S(wtx, "fill", P.blue); });
  const NKEY = { A1: ["max"], B2: ["vbar"], A2: ["vnext"], B1: ["vbar"] };     // a fork's value is V-bar for your options, V(k+1) for theirs
  V.forEach(v => { if (!v.t) return;
    WS.forEach(w => { if (v.h[w] < 6) return; const vt = el("text", { "font-size": 12, class: "ar", "text-anchor": "end" }, L.txt);
      tip(vt, () => v.t.us ? `<b>${f1(v.t.wv[w])}%</b>: the value of the page's choice (${nms(v.t.kids[v.t.pick].b)}) in type ${w + 1}.` : `<b>${f1(v.t.wv[w])}%</b> = ${v.t.kids.map(k => `${pc(k.p[w])} × ${f1(kv(k, w))}`).join(" + ")}`);
      add(t => { const f = FOLD, a = passed(v.x + 4, t); S(vt, "x", v.x - 5); S(vt, "y", topOf(v, w, f) - 5 + 4 * (1 - a)); S(vt, "fill", P.ink); txt(vt, f1(v.t.wv[w]));
        op(vt, a * dim(w, t, f) * (1 - cl(f * 2)), NKEY[v.id]); }); });
    const mt = el("text", { "font-size": 12.5, class: "ar", "text-anchor": "end" }, L.txt); tip(mt, () => avgTip(v.t.wv, v.t.post, v.t.pv));
    add(t => { S(mt, "x", v.x - 5); S(mt, "y", v.tm - 5); S(mt, "fill", P.ink); txt(mt, f1(v.t.pv)); op(mt, E(t, ...TS.merged), NKEY[v.id]); }); });

  // ---------------------------------------------------------------- what the page sees: dashed lines join its choices across the types
  ["A1", "A2"].forEach(id => {
    const v = VID[id], n = v.t, g = el("g", {}, L.info), halo = el("line", { "stroke-width": 3.5 }, g), ln = el("line", { "stroke-width": 1.4, "stroke-dasharray": "4 3.5" }, g);
    const tg = el("g", {}, g), tr = el("rect", { x: -10, y: -10, width: 20, height: 15 }, tg), tt = el("text", { x: 0, y: 2, class: "mt", "font-size": 14, "text-anchor": "middle" }, tg);
    tt.textContent = id === "A1" ? "s₀" : "s₃";
    const say = id === "A1" ? `<b>Information set s₀</b>: the page sees only the lobby, which is the same in every type, so it has to make the same ban in all of them.`
      : `<b>Information set s₃</b>: the lobby and the first three bans, in order. Still the same in every type, so the page picks one pair for all of them.`;
    tip(ln, () => say); tip(tg, () => say);
    add(t => { const f = FOLD, y0 = topOf(v, 0, f) - 18, y1 = topOf(v, 2, f) + v.h[2] + 4, a = E(t, ...TS.info[id]), pulse = id === "A1" ? bump(t, ...TS.pulse) : 0;
      [halo, ln].forEach(e => { S(e, "x1", v.x); S(e, "x2", v.x); S(e, "y1", y0); S(e, "y2", lerp(y0, y1, a)); });
      S(halo, "stroke", P.paper); S(ln, "stroke", P.ink); S(ln, "stroke-width", 1.4 + 1.2 * pulse); S(tg, "transform", `translate(${v.x} ${y0 - 8})`);
      S(tr, "fill", P.paper); S(tt, "fill", P.ink); op(g, (a > 0 ? 1 : 0) * (1 - cl(f * 1.6)), ["s"]); });
    // under the line, once the scores are back: the page's averages, and the types that would choose differently on their own
    const blk = el("g", {}, L.txt), o = n.kids.filter(k => k.wv).sort((p, q) => q.pv - p.pv), lab = k => k.b.map(h => nm(h).split(" ")[0]).join(" and ");
    const bt = el("text", { x: v.x, y: BOTY + 24, "font-size": 11.5, "text-anchor": "middle" }, blk); bt.textContent = `the page at ${id === "A1" ? "s₀" : "s₃"}, expected value`;
    const ts = 15, items = o.map((k, i) => { const gi = el("g", {}, blk), tl = k.b.map((h, j) => { const tg = banTile(gi, h, ts); tg.setAttribute("transform", `translate(${j * (ts + 3) + ts / 2} 0)`); return tg; });
      const tx = el("text", { x: k.b.length * (ts + 3) + 3, y: 4.5, class: "ar", "font-size": 13 }, gi); tx.textContent = f1(k.pv);
      return { gi, tl, tx, best: i === 0, wd: k.b.length * (ts + 3) + 33 }; });
    let cx = v.x - (items.reduce((a, it) => a + it.wd, 0) + 18 * (items.length - 1)) / 2;
    items.forEach(it => { it.gi.setAttribute("transform", `translate(${cx} ${BOTY + 44})`); cx += it.wd + 18; });
    const ws = WS.filter(w => n.alone[w] !== n.pick), nt = el("text", { x: v.x, y: BOTY + 70, "font-size": 11.5, "font-style": "italic", "text-anchor": "middle" }, blk);
    nt.textContent = ws.length ? `knowing it was type ${ws.map(w => w + 1).join(" or ")}, it would ban ${lab(n.kids[n.alone[ws[0]]])}` : "knowing the type would not change this ban";
    tip(blk, () => `<b>The page's choice</b>: the best in expectation, with the types weighted by the page's beliefs at this point.<br>
      <span class="d">${o.map(k => `${nms(k.b)}: ${avgTipShort(k)}`).join("<br>")}</span>`);
    add(t => { const a = passed(v.x + 30, t); S(bt, "fill", P.faint);
      items.forEach(it => { it.tl.forEach(tg => paintTile(tg, it.best ? P.blue : P.faint)); S(it.tx, "fill", it.best ? P.blue : P.faint); });
      S(nt, "fill", P.faint); S(nt, "opacity", E(t, ...TS.note) * (1 - cl(FOLD * 2))); op(blk, a, ["vbar", "max"]); });
  });
  const avgTipShort = k => `${f1(k.pv)} = ${k.post.map((q, w) => `${pc(q)} × ${f1(k.wv[w])}`).join(" + ")}`;

  // ---------------------------------------------------------------- the bans' portraits (type 1's lane, then the folded tree) and their odds by type
  const lane = (w, f) => w ? 1 - cl(f * 2) : 1;                          // in the fold, type 1's labels move onto the folded tree and the others go
  V.forEach(v => { if (!v.k || !v.k.b) return;
    const s = v.parent.id === "B1" ? 12 : 15, n = v.k.b.length, col = v.parent.t.us ? "blue" : "red", xAt = v.x - v.parent.x > 160 ? v.parent.x + 64 : null;
    WS.forEach(w => { if (w && v.h[w] < 12) return;
      const g = el("g", {}, L.lab), tiles = v.k.b.map((h, j) => { const tg = banTile(g, h, s); tg.setAttribute("transform", `translate(${(j - (n - 1) / 2) * (s + 3)} 0)`); return tg; });
      tip(g, () => `<b>${v.parent.t.us ? "You" : "They"} ban ${nms(v.k.b)}</b>${v.parent.t.us ? "" : `: ${WS.map(q => `${pc(v.k.p[q])} in type ${q + 1}`).join(", ")}`}`);
      add(t => { const f = FOLD, gw = ribG(v, w, 0), gm = bundle(v, 1), pw = onRib(gw, xAt ? uAtX(gw, xAt) : .5), pm = onRib(gm, xAt ? uAtX(gm, xAt) : .5);
        const x = lerp(pw[0], pm[0], f), y = lerp(pw[1], pm[1], f);
        S(g, "transform", `translate(${x} ${y})`); tiles.forEach(tg => paintTile(tg, P[col])); op(g, cl((reveal(t) - x - 10) / 30) * dim(w, t, f) * lane(w, f), KEYS(v)); }); }); });
  // the other options, folded into one band each: a label at the start of the band, outlined so it reads on any colour
  const NOUN = { A1: "bans", B2: "pairs", A2: "pairs", B1: "bans" };
  V.forEach(v => { if (!v.k || !v.k.more) return; const x0 = v.parent.x + 14;
    WS.forEach(w => { if (v.h[w] < 12) return;
      const ft = el("text", { x: x0, class: "halo", "font-size": 11.5, "font-weight": 600 }, L.lab); ft.textContent = `+${fmt(v.k.more)} more ${NOUN[v.parent.id]}`;
      tip(ft, () => v.parent.t.us ? `<b>${fmt(v.k.more)} more legal ${NOUN[v.parent.id]}</b>, each played out and scored the same way. None beats ${nms(v.parent.kids[v.parent.t.pick].k.b)} on average.`
        : `<b>Their other ${fmt(v.k.more)} ${NOUN[v.parent.id]}</b>: ${WS.map(q => `${pc(v.k.p[q])} in type ${q + 1}`).join(", ")}. Each is played out and scored, then folded into this band.`);
      add(t => { const f = FOLD, gw = ribG(v, w, 0), gm = bundle(v, 1), yw = onRib(gw, uAtX(gw, x0 + 44))[1], ym_ = onRib(gm, uAtX(gm, x0 + 44))[1];
        S(ft, "y", lerp(yw, ym_, f) + 4); S(ft, "fill", P.ink); op(ft, cl((reveal(t) - x0 - 70) / 30) * dim(w, t, f) * lane(w, f), KEYS(v)); }); }); });
  const R1 = VID.A2;                                                    // their two bans that happened: the odds in each type, above where they land
  WS.forEach(w => { const g = el("g", {}, L.lab), r = el("rect", { x: -13, y: -12, width: 26, height: 12 }, g), tx = el("text", { x: 0, y: -2.5, "font-size": 10, "font-weight": 700, "text-anchor": "middle" }, g);
    tip(g, () => `<b>They ban ${nms(R1.k.b)}</b>: ${pc(R1.k.p[w])} in type ${w + 1}.${reason(R1.k, w)}`);
    add(t => { const f = FOLD; S(g, "transform", `translate(${R1.x - 52} ${topOf(R1, w, f) - 3})`); S(r, "fill", P.red); S(tx, "fill", "#fff"); txt(tx, pc(R1.k.p[w]));
      op(g, E(t, ...TS.tags) * (1 - cl(f * 2)), ["sig"]); }); });
  { const g = el("g", {}, L.lab), r = el("rect", { x: -13, y: -12, width: 26, height: 12 }, g), tx = el("text", { x: 0, y: -2.5, "font-size": 10, "font-weight": 700, "text-anchor": "middle" }, g);
    tip(g, () => `<b>They ban ${nms(R1.k.b)}</b>: ${pc(R1.k.pp)} as the page sees it = ${PRIOR.map((q, w) => `${pc(q)} × ${pc(R1.k.p[w])}`).join(" + ")}`);
    add(t => { S(g, "transform", `translate(${R1.x - 52} ${R1.tm - 3})`); S(r, "fill", P.red); S(tx, "fill", "#fff"); txt(tx, pc(R1.k.pp)); op(g, E(t, ...TS.merged), ["sig"]); }); }

  // ---------------------------------------------------------------- the column heads
  const SEGS = [[XN, XS[0], "Nature", "ink", "draws the type (θ)"], [XS[0], XS[1], "Your ban", "blue", "decision (max)"], [XS[1], XS[2], "Their two bans", "red", "chance (fitted model)"],
    [XS[2], XS[3], "Your two bans", "blue", "decision (max)"], [XS[3], XS[4], "Their last ban", "red", "chance (fitted model)"], [X5, X5 + 92, "Result", "faint", `${MU} × ${KK} lineups`]];
  SEGS.forEach(([a, b, h, col, sub], i) => { const x = i === 5 ? a + 2 : (a + b) / 2, an = i === 5 ? "start" : "middle";
    const t1 = el("text", { x, y: 22, class: "ar", "font-size": 13.5, "text-anchor": an }, L.head), t2 = el("text", { x, y: 38, "font-size": 12, "text-anchor": an }, L.head);
    t1.textContent = h; t2.textContent = sub;
    add(t => { const ci = chapter(t), on = [[0], [1], [2], [3], [3], [4]][i].includes(ci) || ci >= 5, a_ = i === 5 ? cl((reveal(t) - X5 - 6) / 30) : cl((reveal(t) - a - 20) / 30);
      S(t1, "fill", P[col]); S(t2, "fill", P.faint); op(t1, a_ * (on ? 1 : .55), i === 0 ? ["E"] : i === 5 ? ["score"] : i % 2 ? ["max"] : ["sig"]); op(t2, a_ * (on ? 1 : .55)); }); });

  // ---------------------------------------------------------------- the types' cards (right of the lanes)
  WS.forEach(w => { const D = TYPES[w], g = el("g", {}, L.card), x0 = 812, bg = el("rect", { x: 0, y: 0, width: 176, height: 62 }, g), bar = el("rect", { x: 0, y: 0, width: 3, height: 62 }, g);
    const tt = el("text", { x: 12, y: 17, class: "ar", "font-size": 12.5 }, g), pw = el("text", { x: 166, y: 18, class: "ar", "font-size": 15, "text-anchor": "end" }, g), sub = el("text", { x: 12, y: 31, "font-size": 11 }, g);
    tt.textContent = `Type ${w + 1}`; sub.textContent = "their players main";
    const fr = D.mains.map((h, i) => { const tg = el("g", { transform: `translate(${12 + 27 * i} 36)` }, g); el("image", { href: img(h), width: 22, height: 22, preserveAspectRatio: "xMidYMid slice" }, tg);
      return el("rect", { width: 22, height: 22, fill: "none", "stroke-width": 1.5 }, tg); });
    tip(bg, () => `<b>Type ${w + 1}</b>: their players main ${D.mains.map(nm).join(", ")}. Your unseen teammates are part of the type too. They change the draft, not their bans.<br>
      <span class="d">Probability: ${pc(PRIOR[w])} before any ban (the prior), ${pc(post3[w])} after their first two bans (the posterior).</span>`);
    add(t => { const f = FOLD, a = E(t, ...TS.cards(w)), q = lerp(PRIOR[w], post3[w], E(t, ...TS.post)), yc = (LANE[w][0] + LANE[w][1]) / 2;
      S(g, "transform", `translate(${x0 + 10 * (1 - a)} ${yc - 31})`); op(g, a * (1 - cl(f * 1.8)) * (1 - E(t, TS.open[0] - .2, TS.open[1]) + E(t, TS.close[1], TS.close[1] + .6)), ["E"]);
      S(bg, "fill", P.panel); S(bar, "fill", c3(TINT[w])); S(tt, "fill", P.ink); S(sub, "fill", P.faint); S(pw, "fill", P.ink); txt(pw, pc(q)); fr.forEach(r => S(r, "stroke", P.red)); }); });

  // ---------------------------------------------------------------- the panel (folded): how likely each type is at each point
  const PX = 800, PWD = 192, BH = 17, pan = el("g", {}, L.panel), ph = el("text", { x: PX, y: 92, class: "ar", "font-size": 13.5 }, pan);
  ph.textContent = "Beliefs about the type";
  const pn = ["The probability of each type, given what", "the page has seen, by Bayes' rule. The", "networks never compute it. Simulated", "games reach each point in this mix."]
    .map((s_, j) => { const e = el("text", { x: PX, y: 110 + 15 * j, "font-size": 12 }, pan); e.textContent = s_; return e; });
  const BARS = [
    { y: 210, lab: "lobby only (s₀)", post: PRIOR },
    { y: 280, lab: "after their two bans (s₃)", post: POST.A2 },
    { y: 350, lab: `then ${nm(TREE.B1.kids[0].b[0])} banned (s₆)`, post: TREE.B1.kids[0].post },
    { y: 420, lab: `then ${nm(TREE.B1.kids[1].b[0])} banned (s₆)`, post: TREE.B1.kids[1].post }];
  const lum = c => .3 * c[0] + .59 * c[1] + .11 * c[2], con = c => Math.abs(lum(c) - lum(C.paper)) > Math.abs(lum(c) - lum(C.ink)) ? P.paper : P.ink;
  BARS.forEach(B => {
    const g = el("g", {}, pan), lt = el("text", { x: PX, y: B.y - 8, "font-size": 12 }, g), bg = el("rect", { x: PX, y: B.y, width: PWD, height: BH }, g);
    lt.textContent = B.lab; B.segs = WS.map(() => el("rect", { y: B.y, height: BH }, g)); B.segT = WS.map(() => el("text", { y: B.y + 12.5, "font-size": 11, "font-weight": 600, "text-anchor": "middle" }, g));
    Object.assign(B, { g, lt, bg });
    tip(g, () => `<b>${B.lab[0].toUpperCase() + B.lab.slice(1)}</b><br>${B.post.map((q, w) => `type ${w + 1}: ${pc(q)}`).join("<br>")}`);
  });
  add(t => { const a = E(t, ...TS.panel); op(pan, a, ["E"]); S(ph, "fill", P.ink); pn.forEach(e => S(e, "fill", P.faint));
    BARS.forEach((B, i) => { const g_ = E(t, TS.panel[0] + .15 * i, TS.panel[1] + .4 + .15 * i); let c = 0; S(B.lt, "fill", P.faint); S(B.bg, "fill", P.panel);
      B.segs.forEach((r, w) => { const q = B.post[w] * g_; S(r, "x", PX + PWD * c); S(r, "width", PWD * q); S(r, "fill", c3(TINT[w]));
        const st = B.segT[w]; S(st, "x", PX + PWD * (c + q / 2)); S(st, "fill", con(TINT[w])); txt(st, PWD * B.post[w] >= 30 ? `${Math.round(100 * B.post[w])}%` : ""); S(st, "opacity", g_); c += q; }); }); });

  // ---------------------------------------------------------------- the games: portraits that lead the bands, dots that follow them
  // One simulated game leads each ending's band in each lane. The games set off from Now together and split at every fork into the
  // branches they take, so each branch is drawn behind its own games. The middle game of each band shows the ban the band stands for
  // (on the type's band, the ban it is about to make). The others are dots in the colour of whoever bans there, and a dot that
  // becomes the middle game of its new branch at a fork turns into that branch's portrait. At the scoring they all run into the result
  // bars and become the endings' values. Behind them a light stream of games keeps the bands moving.
  const OTHER = ["storm", "loki", "magneto", "thor", "the-punisher", "black-panther", "iron-man", "namor", "venom", "jeff-the-land-shark", "invisible-woman", "wolverine"];
  const gInv = s_ => { let u = s_; for (let i = 0; i < 5; i++) u = cl(u - (1.5 * u - 1.5 * u * u + u * u * u - s_) / (1.5 - 3 * u + 3 * u * u)); return u; };   // a band's x(u), inverted
  const sm = u => u * u * (3 - 2 * u), MORPH = 22;
  const moverA = v => !v.parent.t ? C.faint : v.parent.t.us ? C.blue : C.red;
  const TOK = []; { let oi = 0;
    WS.forEach(w => TERMS.forEach(tv => { if (tv.h[w] < 2.5) return; const path = []; for (let v = tv; v.parent; v = v.parent) path.unshift(v);
      oi++; TOK.push({ w, r: path, other: OTHER[oi % OTHER.length], off: 7 * hsh(oi * 7.31 + w * 1.7) }); })); }
  // its height in each band: the games in a band are spaced evenly across it (in the order of their endings, so they never cross),
  // and over the band each one glides to where its next band starts, arriving at the fork in its own branch
  const BANDT = new Map(); TOK.forEach(T => T.r.forEach(v => { const k = `${T.w}|${v.id}`; if (!BANDT.has(k)) BANDT.set(k, []); BANDT.get(k).push(T); }));
  TOK.forEach(T => { const legs = T.r.map(v => { const list = BANDT.get(`${T.w}|${v.id}`), i = list.indexOf(T);
      return { v, g: ribG(v, T.w, 0), qs: (i + .5) / list.length, lead: i === Math.floor((list.length - 1) / 2) ? 1 : 0 }; });
    legs.forEach((L_, j) => { const nx = legs[j + 1], h = L_.g.b1 - L_.g.b0; L_.qe = nx && h > 1e-6 ? (nx.g.a0 + nx.qs * (nx.g.a1 - nx.g.a0) - L_.g.b0) / h : L_.qs; });
    T.legs = legs; T.g = el("g", {}, L.tok); T.dot = el("circle", { r: 3.1, "stroke-width": 1 }, T.g); T.ic = el("g", {}, T.g);
    T.tl = [0, 1].map(() => { const g_ = el("g", {}, T.ic); return { g: g_, bg: el("rect", {}, g_), im: el("image", { preserveAspectRatio: "xMidYMid slice" }, g_), fr: el("rect", { fill: "none", "stroke-width": 1.5 }, g_) }; }); });
  const legOf = (legs, x) => { let j = 0; while (j < legs.length - 1 && x > legs[j].g.xb) j++; return j; };
  const tokAt = (T, x) => { const j = legOf(T.legs, x), L_ = T.legs[j], g = L_.g, u = gInv(cl((x - g.xa) / (g.xb - g.xa)));
    return [g.a0 + (g.b0 - g.a0) * sm(u) + (L_.qs + (L_.qe - L_.qs) * sm(cl((u - .1) / .9))) * (g.a1 - g.a0), j]; };
  const bansOf = (T, v) => { const k = (v.parent.t ? v : T.r[1]).k; return k.b ? k.b : [T.other]; };
  add(t => { const front = reveal(t);
    TOK.forEach(T => { const x = front - 3 - T.off, into = cl((x - X5 + 6) / 30);   // into: how far it has run into its result bar
      if (FOLD > 0 || x < XN + 3 || into >= 1) { S(T.g, "opacity", 0); return; }
      const [y, j] = tokAt(T, x), L_ = T.legs[j], P_ = T.legs[Math.max(0, j - 1)], k = j ? sm(cl((x - L_.g.xa) / MORPH)) : 1;   // just past a fork: becoming what the new band makes it
      const lead = lerp(P_.lead, L_.lead, k), v = L_.v, hs = bansOf(T, v), n = hs.length, sz = n > 1 ? 12 : 14, col = c3(mixA(moverA(P_.v), moverA(v), k));
      S(T.dot, "fill", col); S(T.dot, "stroke", P.paper); S(T.dot, "opacity", 1 - lead); S(T.dot, "r", 3.1 * (1 - .5 * lead));
      S(T.ic, "opacity", lead); S(T.ic, "transform", `scale(${r2(.35 + .65 * lead)})`);
      T.tl.forEach((tl, i) => { if (i >= n) { S(tl.g, "opacity", 0); return; } const dx = (i - (n - 1) / 2) * (sz + 2);
        S(tl.g, "opacity", 1); S(tl.im, "href", img(hs[i]));
        [tl.bg, tl.im, tl.fr].forEach(e => { S(e, "x", dx - sz / 2); S(e, "y", -sz / 2); S(e, "width", sz); S(e, "height", sz); });
        S(tl.bg, "fill", P.paper); S(tl.fr, "stroke", col); });
      S(T.g, "transform", `translate(${r2(x)} ${r2(y)}) scale(${r2(1 - .75 * sm(into))})`);
      op(T.g, cl((x - XN - 3) / 14) * dim(T.w, t, 0) * (1 - sm(into)), ["E"]); }); });

  // the stream behind the front: small dots at a steady pace, each keeping its height in its band and drifting only as far as its
  // branch needs before a fork, turning blue or red with the band; drawn under the front, so the bands show them only once drawn
  const share = (n, p) => { const raw = p.map(x => n * x), fl = raw.map(Math.floor), r = n - fl.reduce((a, b) => a + b, 0);
    raw.map((x, j) => [x - fl[j], j]).sort((a, b) => b[0] - a[0]).slice(0, r).forEach(([, j]) => fl[j]++); return fl; };
  const route = (w, v, n) => { if (!n) return []; if (v.term) return Array.from({ length: n }, () => [v]);
    const cnt = share(n, v.t.us ? OURSPLIT : v.kids.map(c => c.k.q[w])), out = []; v.kids.forEach((c, i) => route(w, c, cnt[i]).forEach(r => out.push([v].concat(r)))); return out; };
  // one stream in the lanes while they are drawn, one in the folded tree (each dot in its type's stripe)
  const stream = (n, f, ta, tb, speed, seed) => { const out = [], r_ = rng(seed); WS.forEach(w => route(w, VID.A1, Math.round(n * PRIOR[w])).forEach(r => out.push({ w, r, f, o: r_() })));
    out.sort((a, b) => a.o - b.o); out.forEach((d, j) => { d.t0 = ta + (tb - ta) * j / out.length; d.speed = speed; }); return out; };
  const SD = stream(170, 0, 1.6, 27.0, 120, 41).concat(stream(240, 1, TS.fold[1] + .2, TS.fold[1] + 4.6, 150, 43));
  { const r_ = rng(57); SD.forEach(d => { let c = d.t0;
    d.legs = d.r.map(v => { const g = ribG(v, d.w, d.f), L_ = { v, g, ta: c }; c += (g.xb - g.xa) / d.speed; L_.tb = c; return L_; });
    d.legs[0].qs = .1 + .8 * r_();
    d.legs.forEach((L_, j) => { const nx = d.legs[j + 1], h = L_.g.b1 - L_.g.b0; if (!nx) { L_.qe = L_.qs; return; }
      const hn = nx.g.a1 - nx.g.a0; let q = hn > 1e-6 ? (L_.g.b0 + L_.qs * h - nx.g.a0) / hn : .5;
      q = q < .08 ? .08 + .3 * r_() : q > .92 ? .92 - .3 * r_() : q; nx.qs = Math.min(.92, Math.max(.08, q)); L_.qe = h > 1e-6 ? (nx.g.a0 + nx.qs * hn - L_.g.b0) / h : L_.qs; });
    d.tEnd = c; d.c = el("circle", { r: 2.3, "stroke-width": .8 }, L.stream); }); }
  add(t => { SD.forEach(d => { if ((d.f ? FOLD < 1 : FOLD > 0) || t < d.t0 || t > d.tEnd + .3) { S(d.c, "opacity", 0); return; }
    const tt = Math.min(t, d.tEnd), j = legOf(d.legs.map(L_ => ({ g: { xb: L_.tb } })), tt), L_ = d.legs[j], P_ = d.legs[Math.max(0, j - 1)], g = L_.g;
    const s_ = cl((tt - L_.ta) / (L_.tb - L_.ta)), u = gInv(s_), x = g.xa + (g.xb - g.xa) * s_, y = g.a0 + (g.b0 - g.a0) * sm(u) + (L_.qs + (L_.qe - L_.qs) * sm(cl((u - .1) / .9))) * (g.a1 - g.a0);
    const k = j ? sm(cl((x - g.xa) / MORPH)) : 1;
    S(d.c, "cx", r2(x)); S(d.c, "cy", r2(y)); S(d.c, "fill", c3(mixA(moverA(P_.v), moverA(L_.v), k))); S(d.c, "stroke", P.paper);
    op(d.c, .9 * dim(d.w, t, d.f) * (t > d.tEnd ? 1 - (t - d.tEnd) / .3 : cl((t - d.t0) / .25)), ["E"]); }); });

  // ---------------------------------------------------------------- one ending opened up: 28 of your lineups against 28 of theirs
  const LF = VID["B1.0"], GX = 828, GY = 82, GN = D.grid ? D.n : 28, GC = 137.2 / GN, GS = GN * GC;
  const gg = el("g", {}, L.grid), gIn = el("g", {}, gg), gBg = el("rect", { x: -3, y: -3, width: GS + 5, height: GS + 5 }, gIn);
  const gT1 = el("text", { x: 0, y: -26, class: "ar", "font-size": 12.5 }, gIn), gT2 = el("text", { x: 0, y: -11, "font-size": 11.5 }, gIn);
  gT1.textContent = "One ending, opened up"; gT2.textContent = `your ${GN} lineups down, their ${GN} across`;
  const gAv = el("text", { x: 0, y: GS + 20, "font-size": 12 }, gIn), gAvA = el("tspan", {}, gAv), gAvB = el("tspan", { class: "ar", "font-size": 13 }, gAv);
  gAvA.textContent = `average of all ${GN * GN} games`; gAvB.setAttribute("dx", 6);
  const gLead = el("path", { fill: "none", "stroke-width": 1.2, "stroke-dasharray": "3 3" }, L.grid);
  const base6 = LF.k.leaf[0], rr = Array.from({ length: GN }, (_, i) => (hsh(i * 1.71 + .3) - .5) * 16), cc = Array.from({ length: GN }, (_, j) => (hsh(j * 2.37 + 5.1) - .5) * 16);
  let GV = []; for (let i = 0; i < GN; i++) for (let j = 0; j < GN; j++) GV.push(base6 + rr[i] + cc[j] + (hsh(i * 31.7 + j * 17.3) - .5) * 14);
  { const m = GV.reduce((a, b) => a + b, 0) / GV.length; GV = GV.map(x => x + base6 - m); }   // the example's cells average to the ending's value exactly
  if (D.grid) GV = D.grid.slice();                                     // the lobby's: one draw's matchups (their average is that draw's value, near the ending's)
  const GCELL = GV.map((_, k) => el("rect", { x: (k % GN) * GC, y: Math.floor(k / GN) * GC, width: GC - .7, height: GC - .7 }, gIn));
  tip(gBg, () => `<b>One ending in type 1, opened up</b>: each square is one of your ${GN} drafted lineups against one of theirs, scored on the map (P(W<sub>A</sub> = 1 | L<sub>A</sub><sup>i</sup>, L<sub>B</sub><sup>j</sup>, m)). Blue squares favour you. Their average, ${f1(GV.reduce((a, b) => a + b, 0) / GV.length)}%, is ${D.grid ? "this draw's value (the ending's averages several draws)" : "the ending's value"}.`);
  add(t => { const op_ = E(t, ...TS.open), cl_ = E(t, ...TS.close), on = op_ * (1 - seg(t, TS.close[1] - .3, TS.close[1]));
    if (on <= 0 || FOLD > 0) { S(gg, "opacity", 0); S(gLead, "opacity", 0); return; }
    const y0 = topOf(LF, 0, 0), h = LF.h[0], sx = lerp(1, 22 / GS, cl_), sy = lerp(1, Math.max(h, 2) / GS, cl_), tx = lerp(GX, X5 + 2, cl_), ty = lerp(GY, y0, cl_);
    S(gIn, "transform", `translate(${tx} ${ty}) scale(${sx} ${sy})`); op(gg, on, ["score"]);
    S(gBg, "fill", P.paper); S(gBg, "stroke", P.hair); [gT1, gAvB].forEach(e => S(e, "fill", P.ink)); [gT2, gAvA].forEach(e => S(e, "fill", P.faint));
    [gT1, gT2, gAv].forEach(e => S(e, "opacity", 1 - cl_)); txt(gAvB, `${f1(GV.reduce((a, b) => a + b, 0) / GV.length)}%`); S(gAvB, "opacity", E(t, ...TS.avg));
    GCELL.forEach((c, k) => { const i = Math.floor(k / GN), j = k % GN, at = TS.cells[0] + (TS.cells[1] - TS.cells[0]) * (i + j) / (2 * GN - 2);
      S(c, "fill", c3(winA(GV[k]))); S(c, "opacity", t >= at ? 1 : 0); });
    const lx = X5 + 24, ly = y0 + h / 2; S(gLead, "d", `M${lx},${ly} C${lx + 40},${ly} ${GX - 50},${GY + GS / 2} ${GX - 6},${GY + GS / 2}`);
    S(gLead, "stroke", P.faint); op(gLead, op_ * (1 - cl_), ["score"]); });

  // a clicked term of the recursion, worked out with this figure's numbers (shown under the figure while the term is picked out)
  function explain(k) {
    const A1 = TREE.A1, A2 = TREE.A2, B2 = TREE.B2, B1 = TREE.B1, opts = n => n.kids.filter(x => x.wv).sort((a, b) => b.pv - a.pv);
    const list = n => opts(n).map(x => `${nms(x.b)} <b>${f1(x.pv)}%</b>`).join(", "), byType = a => a.map(pc).join(" / ");
    const ch = A1.kids[A1.pick], last = B1.kids[0];
    switch (k) {
      case "E": return `<b>𝔼 over θ</b>: Nature draws the type, and the page weighs the types by what it believes: ${PRIOR.map((q, w) => `type ${w + 1} ${pc(q)}`).join(", ")} with the lobby alone, ${byType(POST.A2)} after their two bans, ${byType(last.post)} if they then ban ${nm(last.b[0])}.`;
      case "score": return `<b>V<sub>6</sub></b>: an ending is worth the average of its ${MU * KK} lineup pairings. In type 1, after ${nm(last.b[0])}: <b>${f1(last.leaf[0])}%</b>; in types 2 and 3: ${f1(last.leaf[1])}% and ${f1(last.leaf[2])}%. Click a result bar to open its grid.`;
      case "max": return `<b>max</b>: at your turns the page takes the best option in expectation. First ban: ${list(A1)}. Your pair: ${list(A2)}.`;
      case "s": return `<b>The information set</b>: the page sees the same lobby (and later the same bans, in order) whatever the type, so the dashed line joins the three lanes and one choice is made for all of them: ${nms(ch.b)} at s₀, ${nms(A2.kids[A2.pick].b)} at s₃.`;
      case "vbar": return `<b>V̄</b>: an option's value averaged over the types at the page's beliefs. ${nms(ch.b)}: <b>${f1(ch.pv)}%</b> = ${ch.post.map((q, w) => `${pc(q)} × ${f1(ch.wv[w])}`).join(" + ")}.`;
      case "sig": return `<b>σ̂<sub>B</sub></b>: their bans come from the fitted ban model, type by type. ${nms(B2.kids[0].b)}: ${byType(B2.kids[0].p)}. Then ${nm(last.b[0])}: ${byType(last.p)}. A ban likelier in one type makes that type likelier (Bayes' rule).`;
      case "vnext": return `<b>V<sub>k+1</sub></b>: at their turns the value is the expectation over their bans. Their last ban, type 1: ${B1.kids.map(x => `${pc(x.p[0])} × ${f1(kv(x, 0))}`).join(" + ")} = <b>${f1(B1.wv[0])}%</b>.`;
    }
    return "";
  }
  function render(t) { CURT = t; FOLD = fold(t); ITEMS.forEach(f => f(t)); }
  // tooltips
  const tipEl = $("gtTip");
  svg.addEventListener("mousemove", ev => { let e = ev.target; while (e && e !== svg && !tipOf.has(e)) e = e.parentNode;
    let vis = e && e !== svg; for (let a = e; vis && a && a !== svg; a = a.parentNode) if (a.getAttribute && +(a.getAttribute("opacity") ?? 1) < .2) vis = false;
    if (!vis) { tipEl.classList.remove("on"); return; }
    tipEl.innerHTML = tipOf.get(e)(); tipEl.classList.add("on");
    const r = tipEl.getBoundingClientRect(); let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14; if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
    tipEl.style.left = x + "px"; tipEl.style.top = y + "px"; });
  svg.addEventListener("mouseleave", () => tipEl.classList.remove("on"));

  return { svg, render, ov, closeGrid, explain };
  }
  pal(); let CUR = build(DEFAULT);
  function render(t) { CUR.render(t); const c = chapter(t); if (c !== shownStep) { shownStep = c; $("gtMline").innerHTML = `${STEP[c][0]}<span class="what">${STEP[c][1]}</span>`; } }
  const ICON = { play: `<svg viewBox="0 0 14 14"><path d="M2 1 L13 7 L2 13 Z"/></svg>`, pause: `<svg viewBox="0 0 14 14"><rect x="2" y="1" width="3.5" height="12"/><rect x="8.5" y="1" width="3.5" height="12"/></svg>` };
  function player(pp, chEl, chapters, dur, draw0) {
    let t = 0, playing = false, last = 0;
    chEl.innerHTML = chapters.map((c, i) => `<button data-i="${i}"><span class="track"><span class="fill"></span></span><b>${c[1]}</b>${c[2]}</button>`).join("");
    const btns = [...chEl.querySelectorAll("button")], fills = btns.map(b => b.querySelector(".fill"));
    const paint = () => { draw0(Math.min(t, dur)); btns.forEach((b, i) => { const a = chapters[i][0], z = i + 1 < chapters.length ? chapters[i + 1][0] : dur;
      b.classList.toggle("on", t >= a && (t < z || i === btns.length - 1)); fills[i].style.width = `${100 * cl((t - a) / (z - a))}%`; }); };
    const frame = now => { if (!playing) return; t += Math.min(.05, (now - last) / 1000); last = now;
      if (t >= dur) { t = dur; playing = false; setIcon(); paint(); return; }
      paint(); requestAnimationFrame(frame); };
    const setIcon = () => { pp.innerHTML = playing ? ICON.pause : ICON.play; pp.setAttribute("aria-label", playing ? "Pause" : t >= dur ? "Play again" : "Play"); };
    const toggle = () => { playing = !playing; if (playing && t >= dur) t = 0; setIcon(); if (playing) { last = performance.now(); requestAnimationFrame(frame); } };
    btns.forEach(b => b.onclick = () => { t = chapters[+b.dataset.i][0]; if (!playing) toggle(); paint(); });
    pp.onclick = toggle; setIcon(); paint();
    return { start: () => { if (!playing) toggle(); }, pause: () => { if (playing) toggle(); }, seek: x => { if (playing) toggle(); t = Math.min(x, dur); setIcon(); paint(); },
      redraw: () => paint(), get t() { return t; }, get playing() { return playing; } };
  }
  const CHAP = [
    [CH[0], "Nature", "Nature draws who is playing. The page can't see it."],
    [CH[1], "Your first ban", "One information set, so one ban for every type."],
    [CH[2], "Their two bans", "Their bans depend on their type, so beliefs update."],
    [CH[3], "Your pair, their last", "One pair for every type, then their last ban."],
    [CH[4], "Draft and score", "28 lineups a side, every pairing scored."],
    [CH[5], "Back up", "The best option at yours, the expected value at theirs."],
    [CH[6], "What the page sees", "Merge the types. Values are weighted by beliefs."]];
  pal();
  const PL = player($("gtpp"), $("gtch"), CHAP, DUR, render);
  window.GameTree = PL;
  // the page sends the lobby's numbers (sim8-worker's tree job): the figure is rebuilt from them where it is in its play
  PL.load = D => { CUR.svg.remove(); CUR.ov.remove(); CUR = build(D); pal(); legend(!!D.live); const sub = document.querySelector("#methods .mfs");
    if (sub) sub.textContent = D.live ? `Your lobby's numbers from the model${D.banSecond ? ", drawn as if you ban first" : ""}. Hover anything for its arithmetic.` : "Illustrative numbers. Hover anything for its arithmetic.";
    PL.redraw(); };                                                 // for checks from the console: GameTree.seek(t)

  // the legend
  const key = (svgIn, s) => `<span class="key"><svg width="18" height="14" viewBox="0 0 18 14">${svgIn}</svg>${s}</span>`;
  const legend = live => $("gtLegend").innerHTML = [
    key(`<rect x="0" y="2" width="18" height="10" fill="color-mix(in srgb, var(--blue) 50%, var(--paper))"/><rect x="8" y="1" width="3" height="12" fill="var(--blue)"/>`, "Your bans: decisions (max)"),
    key(`<rect x="0" y="2" width="18" height="10" fill="color-mix(in srgb, var(--red) 70%, var(--paper))"/><rect x="8" y="1" width="3" height="12" fill="var(--red)"/>`, "Their bans: chance, from a fitted model (expectation)"),
    key(`<path d="M9,0 V14" stroke="var(--ink)" stroke-width="1.4" stroke-dasharray="3 2.5"/>`, "Information set"),
    key(`<rect x="0" y="1" width="18" height="4" fill="var(--d1)"/><rect x="0" y="5" width="18" height="4" fill="var(--d2)"/><rect x="0" y="9" width="18" height="4" fill="var(--d3)"/>`, "The three types (θ)"),
    key(`<rect x="0" y="0" width="12" height="12" fill="color-mix(in srgb, var(--blue) 18%, var(--paper))" stroke="var(--blue)" stroke-width="1.6"/><circle cx="15.5" cy="9" r="2.4" fill="var(--blue)"/><circle cx="15.5" cy="2.8" r="2.4" fill="var(--red)"/>`, "Simulated games"),
    `<span>${live ? "Band height: share of games; at their forks drawn by square root (the folded options at half), so the named bans show" : "Band height: share of games"}</span>`].join("");
  legend(false);

  // the recursion's terms: a click picks one out in the figure and fades the rest (the figure shown complete, or folded if it already
  // is), and it stays picked out. Clicking it again, or anywhere outside the figure, lets go. Clicking another term switches to it.
  let hold = null;
  const pick = k => { document.querySelectorAll("#gtRec .t").forEach(x => x.classList.toggle("on", x.dataset.k === k));
    if (k) { if (HL === null) { if (PL.playing) PL.pause(); hold = PL.t; } HL = k; render(TERM_T[k] !== undefined ? TERM_T[k] : Math.max(hold, TS.fold[0] - .3));
      $("gtMline").innerHTML = `<span class="what">${CUR.explain(k)}</span>`; shownStep = -1; }
    else if (HL !== null) { HL = null; render(hold === null ? PL.t : hold); hold = null; } };
  // where each term is easiest to see: the lanes once the scores are back (your choices and values), their two bans as the odds update,
  // the opened-up ending (the payoff), the folded tree (the expectation over the types)
  const TERM_T = { max: 43.4, s: 43.4, vbar: 43.4, vnext: 43.4, sig: 17.6, score: 33.0, E: 48.4 };
  document.querySelectorAll("#gtRec .t").forEach(s => { s.setAttribute("role", "button"); s.tabIndex = 0;
    s.title = "Click to show this in the figure";
    s.addEventListener("click", e => { e.stopPropagation(); pick(HL === s.dataset.k ? null : s.dataset.k); });
    s.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); s.click(); } }); });
  document.addEventListener("click", e => { if (HL !== null && !e.target.closest("#gt")) pick(null); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { pick(null); CUR.closeGrid(); } });

  // the theme: whatever sets the page's theme (its button), the figure redraws in the new colours
  new MutationObserver(() => { pal(); PL.redraw(); }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { pal(); PL.redraw(); });
  document.fonts && document.fonts.ready.then(() => PL.redraw());

  // as the old figures: plays when it comes into view (a still frame of the whole tree if the reader prefers less motion), pauses
  // when it leaves and carries on when it is back (one paused by hand stays paused), and goes back to its first frame when the Methods
  // section is hidden, to play again from there when it is next seen
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let away = false;
  const io = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; if (still) PL.seek(TS.fold[0] - .3); else PL.start(); io.unobserve(e.target); }), { threshold: .45 });
  io.observe($("gt"));
  new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) { if (PL.playing) { PL.pause(); away = true; } } else if (away) { away = false; PL.start(); } }), { threshold: 0 }).observe($("gt"));
  const sec = $("methods");
  if (sec) new MutationObserver(() => { if (!sec.classList.contains("lean")) return; pick(null); PL.seek(0); away = false; io.unobserve($("gt")); io.observe($("gt")); })
    .observe(sec, { attributes: true, attributeFilter: ["class"] });
})();
