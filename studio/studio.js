/* Ban Call Studio: a second interface on the same models (../engine.js, ../sim.js through ../sim-worker.js).
   The lobby is drawn as an architectural model: every hero is a prism on its role's plate, and the prism's height is the
   model's answer for the step you are on (how likely your team opens it, what banning it is worth, how likely they ban it). */
(async function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const SVGNS = "http://www.w3.org/2000/svg";
  const ROLE_NAMES = ["Vanguard", "Duelist", "Strategist"];
  const SHORT = { "Deadpool (Vanguard)": "Deadpool V", "Deadpool (Duelist)": "Deadpool D", "Deadpool (Strategist)": "Deadpool S",
    "Gorr The God Butcher": "Gorr", "Jeff The Land Shark": "Jeff", "Mister Fantastic": "Mr. Fantastic", "Captain America": "Cap",
    "Invisible Woman": "Invisible Woman", "Rocket Raccoon": "Rocket", "Elsa Bloodstone": "Elsa", "Doctor Strange": "Dr. Strange", "Devil Dinosaur": "Devil Dino" };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pp = (x, d = 2) => (x >= 0 ? "+" : "−") + Math.abs(100 * x).toFixed(d);
  const pct = x => (100 * x < 1 && x > 0 ? "<1" : (100 * x).toFixed(0)) + "%";
  const fmt = n => n.toLocaleString("en-US");
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dec = step => Math.max(0, -Math.floor(Math.log10(step * 100) + 1e-9));     // decimals that tell ticks apart (points)
  const niceStep = (span, n = 4) => { const raw = span / n || 1e-9, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; };

  // ---------------------------------------------------------------- load (the same files as the main page)
  const [META, W, PORT] = await Promise.all([
    fetch("../model/meta.json").then(r => r.json()), fetch("../model/weights.bin").then(r => r.arrayBuffer()), fetch("../model/portraits.json").then(r => r.json())]);
  const EO = META.engine ? { NS: META.engine.ns, NOWN: META.engine.nown, SHORT: META.engine.short } : {};
  const E = new BanEngine(META, W, EO), H = META.heroes.length, ORDER = META.ban_order, NAMES = META.heroes, ROLE = META.roles;
  const img = h => `../img/heroes/${PORT[NAMES[h]]}.webp`, short = h => SHORT[NAMES[h]] || NAMES[h];
  const mapName = s => s.includes(" · ") ? s.replace(" · ", " (") + ")" : s;
  const MAPS = META.maps.map((m, i) => ({ i, name: mapName(m.name) })).sort((a, b) => a.name.localeCompare(b.name));
  const TIERS = Object.keys(META.tiers);

  // ---------------------------------------------------------------- state, mirrored in the URL hash (same keys as the main page)
  const st = { tier: "Grandmaster 3", map: (MAPS.find(m => /Klyntar \(Dom/.test(m.name)) || MAPS[0]).i, first: true,
               team: [-1, -1, -1, -1, -1, -1], bans: [], active: { kind: "team", i: 0 }, model: "value", runs: 64 };
  let MINE = []; try { MINE = JSON.parse(localStorage.getItem("bancall-mine") || "[]").filter(h => Number.isInteger(h) && h < H); } catch (e) {}
  const rememberMine = h => { MINE = [h].concat(MINE.filter(x => x !== h)).slice(0, 8); try { localStorage.setItem("bancall-mine", JSON.stringify(MINE)); } catch (e) {} };
  let lastHash = "";
  function readHash() {
    const q = new URLSearchParams(location.hash.slice(1)); if (!q.has("m")) return;
    if (q.get("t") && META.tiers[q.get("t")]) st.tier = q.get("t");
    st.map = Math.max(0, Math.min(META.maps.length - 1, +q.get("m") || 0)); st.first = q.get("f") !== "0"; st.model = q.get("x") === "1" ? "sim" : "value";
    st.runs = [32, 64, 128, 256].includes(+q.get("n")) ? +q.get("n") : 64;
    const tm = (q.get("u") || "").split(",").map(x => (x === "" || x === "-") ? -1 : +x); for (let i = 0; i < 6; i++) st.team[i] = Number.isInteger(tm[i]) && tm[i] >= 0 && tm[i] < H ? tm[i] : -1;
    st.bans = (q.get("b") || "").split(",").filter(x => x !== "").map(Number).filter(h => h >= 0 && h < H).slice(0, 6);
    st.active = st.team[0] < 0 ? { kind: "team", i: 0 } : { kind: "ban" };
  }
  function writeHash() {
    const q = new URLSearchParams({ t: st.tier, m: st.map, f: st.first ? 1 : 0, x: st.model === "sim" ? 1 : 0, n: st.runs, u: st.team.map(h => h < 0 ? "-" : h).join(","), b: st.bans.join(",") });
    lastHash = "#" + q.toString(); history.replaceState(null, "", lastHash);
  }
  readHash();
  if (!location.hash && MINE.length) { st.team[0] = MINE[0]; st.active = { kind: "ban" }; }
  window.addEventListener("hashchange", () => { if (location.hash === lastHash) return; st.team = [-1, -1, -1, -1, -1, -1]; st.bans = []; readHash(); syncControls(); update(); });
  const ours = i => (ORDER[i] === 0) === st.first;
  const nextBan = () => st.bans.length;
  const ourTurn = () => nextBan() < 6 && ours(nextBan());
  const turnCount = () => { const e = nextBan(); return (e + 1 < 6 && ours(e) && ours(e + 1)) ? 2 : 1; };
  const bannedSet = () => new Set(st.bans), teamSet = () => new Set(st.team.filter(h => h >= 0));

  // ---------------------------------------------------------------- controls
  $("tierSel").innerHTML = TIERS.map(t => `<option>${esc(t)}</option>`).join("");
  $("mapSel").innerHTML = MAPS.map(m => `<option value="${m.i}">${esc(m.name)}</option>`).join("");
  function syncControls() {
    $("tierSel").value = st.tier; $("mapSel").value = String(st.map);
    $("firstBtn").classList.toggle("on", st.first); $("secondBtn").classList.toggle("on", !st.first);
    $("valueBtn").classList.toggle("on", st.model === "value"); $("simBtn").classList.toggle("on", st.model === "sim");
    $("runsCtl").hidden = st.model !== "sim"; document.querySelectorAll("#runsCtl button").forEach(b => b.classList.toggle("on", +b.dataset.n === st.runs));
  }
  $("tierSel").onchange = e => { st.tier = e.target.value; update(); };
  $("mapSel").onchange = e => { st.map = +e.target.value; update(); };
  $("firstBtn").onclick = () => { st.first = true; update(); };
  $("secondBtn").onclick = () => { st.first = false; update(); };
  $("valueBtn").onclick = () => { st.model = "value"; update(); };
  $("simBtn").onclick = () => { st.model = "sim"; update(); };
  document.querySelectorAll("#runsCtl button").forEach(b => b.onclick = () => { st.runs = +b.dataset.n; update(); });
  $("undoBtn").onclick = () => { if (st.bans.length) { st.bans.pop(); st.active = { kind: "ban" }; update(); } };
  $("newBtn").onclick = () => { st.bans = []; for (let i = 1; i < 6; i++) st.team[i] = -1; st.active = st.team[0] < 0 ? { kind: "team", i: 0 } : { kind: "ban" }; $("search").value = ""; update(); };
  $("linkBtn").onclick = () => { writeHash(); navigator.clipboard && navigator.clipboard.writeText(location.href); $("linkBtn").textContent = "Link copied"; setTimeout(() => $("linkBtn").textContent = "Copy link", 1400); };
  const themeNow = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const setThemeLabel = () => $("themeBtn").textContent = themeNow() === "dark" ? "Light" : "Dark";
  $("themeBtn").onclick = () => { document.documentElement.dataset.theme = themeNow() === "dark" ? "light" : "dark"; try { localStorage.setItem("bancall-theme", document.documentElement.dataset.theme); } catch (e) {} setThemeLabel(); };
  try { const t = localStorage.getItem("bancall-theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
  setThemeLabel();

  // ---------------------------------------------------------------- entering heroes
  function place(h) {
    if (h < 0) return;
    const a = st.active;
    if (a.kind === "team") {
      if (st.bans.includes(h)) return;
      for (let i = 0; i < 6; i++) if (st.team[i] === h) st.team[i] = -1;
      st.team[a.i] = h; if (a.i === 0) rememberMine(h);
      const nxt = a.i === 0 ? -1 : st.team.findIndex((x, i) => x < 0 && i > a.i);   // your hero: on to the bans; a teammate: the next empty slot
      st.active = nxt >= 0 ? { kind: "team", i: nxt } : { kind: "ban" };
    } else {
      if (nextBan() >= 6 || st.bans.includes(h)) return;
      for (let i = 0; i < 6; i++) if (st.team[i] === h) st.team[i] = -1;
      st.bans.push(h);
    }
    $("search").value = ""; renderHits(); update();
  }
  const POPC = new Map();
  function popularity() {                  // how often each hero is opened at this rank (lineup networks, nothing shown), for team entry
    const key = st.tier; if (POPC.has(key)) return POPC.get(key);
    const rf = E.rankFeat(META.tiers[st.tier]), p = new Float64Array(H); let n = 0;
    for (let m = 0; m < META.maps.length; m++) for (const side of [0, 1]) {
      const x = E.features([], [], [], m, rf, side, 0);
      for (const net of E.nets) { const P = E.netProb(net, x); for (let h = 0; h < H; h++) p[h] += P[h]; n++; }
    }
    for (let h = 0; h < H; h++) p[h] /= n; POPC.set(key, p); return p;
  }
  function topBans(k) {
    if (st.model === "sim" && (!SIM || SIM.prelim)) return [];
    const V = st.model === "sim" ? SIM.V : RES.V;
    return Array.from(V.keys()).filter(h => !isNaN(V[h])).sort((a, b) => V[b] - V[a]).slice(0, k);
  }
  function quickList() {
    if (st.active.kind === "team") {
      const bans = bannedSet(), team = teamSet(), ok = h => !bans.has(h) && !team.has(h);
      if (st.active.i === 0) {
        const pop = popularity(), seen = new Set(), out = [];
        for (const h of MINE.concat(Array.from(pop.keys()).sort((a, b) => pop[b] - pop[a]))) if (ok(h) && !seen.has(h) && out.length < 8) { seen.add(h); out.push({ h, v: pop[h], lab: MINE.includes(h) ? "yours" : pct(pop[h]) }); }
        return out;
      }
      return RES ? Array.from(RES.Pu.keys()).filter(ok).sort((a, b) => RES.Pu[b] - RES.Pu[a]).slice(0, 8).map(h => ({ h, v: RES.Pu[h], lab: pct(RES.Pu[h]) })) : [];
    }
    if (nextBan() >= 6) return [];
    if (ourTurn()) { const V = st.model === "sim" ? (SIM && !SIM.prelim ? SIM.V : null) : RES && RES.V; if (!V) return [];
      return topBans(8).map(h => ({ h, v: V[h], lab: pp(V[h]) })); }
    return THEIRS ? Array.from(THEIRS.keys()).filter(h => THEIRS[h] > 0).sort((a, b) => THEIRS[b] - THEIRS[a]).slice(0, 8).map(h => ({ h, v: THEIRS[h], lab: pct(THEIRS[h]) })) : [];
  }
  const side = () => st.active.kind === "team" || ourTurn() ? "us" : "them";
  const quickPick = k => { const q = quickList()[k - 1]; if (q) place(q.h); };

  // search: type a name, Enter takes the first match; commas enter several in order
  const matches = () => { const q = $("search").value.split(",").pop().trim().toLowerCase(); if (!q) return [];
    const b = bannedSet(); return NAMES.map((n, h) => h).filter(h => !b.has(h) && (NAMES[h].toLowerCase().includes(q) || short(h).toLowerCase().includes(q)))
      .sort((a, c) => ((NAMES[a].toLowerCase().startsWith(q) ? 0 : 1) - (NAMES[c].toLowerCase().startsWith(q) ? 0 : 1)) || NAMES[a].length - NAMES[c].length); };
  function renderHits() {
    const m = matches().slice(0, 4);
    $("hits").innerHTML = m.length ? "Enter: " + m.map((h, k) => `<a href="#" data-h="${h}"${k ? "" : ' style="font-weight:700"'}>${esc(NAMES[h])}</a>`).join(", ") : "";
    $("hits").querySelectorAll("a").forEach(a => a.onclick = ev => { ev.preventDefault(); place(+a.dataset.h); });
    LAND.query = $("search").value.split(",").pop().trim().toLowerCase(); LAND.dirty = true; kick();
  }
  $("search").oninput = renderHits;
  $("search").onkeydown = ev => {
    if (ev.key === "Enter") {
      const parts = $("search").value.split(",").map(x => x.trim()).filter(Boolean);
      if (parts.length > 1) {
        for (const q of parts) { $("search").value = q; const m = matches(); if (m.length) place(m[0]); }
      } else { const m = matches(); if (m.length) place(m[0]); }
      $("search").value = ""; renderHits(); ev.preventDefault();
    } else if (/^[1-8]$/.test(ev.key) && !$("search").value) { quickPick(+ev.key); ev.preventDefault(); }
    else if (ev.key === "Backspace" && !$("search").value && st.bans.length) { st.bans.pop(); update(); ev.preventDefault(); }
    else if (ev.key === "Escape") { $("search").value = ""; renderHits(); $("search").blur(); }
  };
  document.addEventListener("keydown", ev => {
    if (ev.target.tagName === "INPUT" || ev.target.tagName === "SELECT" || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === "/") { $("search").focus(); ev.preventDefault(); }
    else if (/^[1-8]$/.test(ev.key)) { quickPick(+ev.key); ev.preventDefault(); }
    else if (ev.key.length === 1 && /[a-z&]/i.test(ev.key)) $("search").focus();
    else if (ev.key === "Backspace" && st.bans.length) { st.bans.pop(); update(); ev.preventDefault(); }
  });

  // ================================================================ the landscape
  // World: one unit per plot. Three plates (Vanguard, Duelist, Strategist), each hero on its own plot, the most played at the
  // back so the tallest towers stand behind the rest. Camera: azimuth th and elevation ph, drifting a little with the pointer.
  const svg = $("land"), wrap = $("landWrap");
  const el = (tag, attrs, parent) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const LAND = { cells: [], th: 31 * Math.PI / 180, ph: 45 * Math.PI / 180, thT: 31 * Math.PI / 180, phT: 45 * Math.PI / 180, S: 40, ox: 0, oy: 0, W: 800, Hh: 520,
                 plates: [], tagsOn: true, dirty: true, query: "", metricMax: 1, unit: null, running: false };
  const COLS = [3, 4, 3], GAP = 1, FOOT = .7, HMAX = 2.3;
  const defs = el("defs", {}, svg);
  const pat = el("pattern", { id: "hatch", width: 5, height: 5, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
  el("rect", { width: 5, height: 5, fill: "var(--plate)" }, pat); el("line", { x1: 0, y1: 0, x2: 0, y2: 5, stroke: "var(--graphite)", "stroke-width": 1.2 }, pat);
  const gPlates = el("g", {}, svg), gPr = el("g", {}, svg), gTags = el("g", {}, svg), gScale = el("g", { class: "scale" }, svg);

  function layout() {                                       // plots by role, most played first (back rows), fixed per rank
    const pop = popularity(); let x0 = 0; const rowsMax = Math.max(...[0, 1, 2].map(r => Math.ceil(ROLE.filter(q => q === r).length / COLS[r])));
    LAND.plates = [];
    for (let r = 0; r < 3; r++) {
      const hs = NAMES.map((n, h) => h).filter(h => ROLE[h] === r).sort((a, b) => pop[b] - pop[a]), C = COLS[r], R = Math.ceil(hs.length / C), y0 = (rowsMax - R) / 2;
      hs.forEach((h, i) => { const c = LAND.cells[h] || (LAND.cells[h] = { h, z: 0, v: 0, t: 0, delay: 0 }); c.gx = x0 + (i % C); c.gy = y0 + Math.floor(i / C); });
      LAND.plates.push({ r, x0, y0, x1: x0 + C, y1: y0 + R }); x0 += C + GAP;
    }
    LAND.WX = x0 - GAP; LAND.WY = rowsMax;
  }
  const proj = (x, y, z) => { const c = Math.cos(LAND.th), s = Math.sin(LAND.th), xr = x * c - y * s, yr = x * s + y * c;
    return [LAND.ox + xr * LAND.S, LAND.oy + (yr * Math.sin(LAND.ph) - z * Math.cos(LAND.ph)) * LAND.S]; };
  const depth = (x, y) => x * Math.sin(LAND.th) + y * Math.cos(LAND.th);
  const poly = pts => "M" + pts.map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") + "Z";
  function fit() {                                          // scale and offset so the whole model (towers included) fits the frame
    if (LAND.WX === undefined) return;
    const r = wrap.getBoundingClientRect(); LAND.W = r.width; LAND.Hh = Math.max(380, r.height); svg.setAttribute("viewBox", `0 0 ${LAND.W} ${LAND.Hh}`);
    LAND.tagsOn = LAND.W > 620;
    const colW = LAND.tagsOn ? 200 : 0, top = 70, bottom = 18;
    const save = [LAND.S, LAND.ox, LAND.oy]; LAND.S = 1; LAND.ox = 0; LAND.oy = 0;
    let xs = [], ys = [];
    for (const [x, y] of [[0, 0], [LAND.WX, 0], [0, LAND.WY + 1.4], [LAND.WX, LAND.WY + 1.4]]) for (const z of [-.35, HMAX * .8]) { const p = proj(x, y, z); xs.push(p[0]); ys.push(p[1]); }
    const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
    const S = Math.min((LAND.W - colW - 34) / bw, (LAND.Hh - top - bottom) / bh);
    LAND.S = S; LAND.ox = 22 + (LAND.W - colW - 34 - bw * S) / 2 - Math.min(...xs) * S; LAND.oy = top + (LAND.Hh - top - bottom - bh * S) / 2 - Math.min(...ys) * S;
    void save; LAND.dirty = true;
  }

  function buildPlates() {
    gPlates.innerHTML = "";
    for (const P of LAND.plates) {
      P.edgeX = el("path", { class: "plateEdge" }, gPlates); P.edgeY = el("path", { class: "plateEdge" }, gPlates); P.top = el("path", { class: "plate" }, gPlates);
      P.lab = el("text", { class: "dist", "font-size": 60 }, gPlates); P.lab.textContent = ROLE_NAMES[P.r];
    }
  }
  function drawPlates() {
    const T = .32;
    for (const P of LAND.plates) {
      const x0 = P.x0 - .12, y0 = P.y0 - .12, x1 = P.x1 + .12, y1 = P.y1 + .12;
      P.top.setAttribute("d", poly([proj(x0, y0, 0), proj(x1, y0, 0), proj(x1, y1, 0), proj(x0, y1, 0)]));
      P.edgeX.setAttribute("d", poly([proj(x1, y0, 0), proj(x1, y1, 0), proj(x1, y1, -T), proj(x1, y0, -T)]));
      P.edgeY.setAttribute("d", poly([proj(x0, y1, 0), proj(x1, y1, 0), proj(x1, y1, -T), proj(x0, y1, -T)]));
      // the role's name lettered on the plate's front strip, in the plane of the ground
      const o = proj(x0 + .02, y1 + .95, -.32), ex = proj(x0 + 1.02, y1 + .95, -.32), ey = proj(x0 + .02, y1 + 1.95, -.32), k = .0072;
      P.lab.setAttribute("transform", `matrix(${(ex[0] - o[0]) * k} ${(ex[1] - o[1]) * k} ${(ey[0] - o[0]) * k} ${(ey[1] - o[1]) * k} ${o[0]} ${o[1]})`);
    }
  }
  function buildPrisms() {
    gPr.innerHTML = "";
    for (const c of LAND.cells) {
      c.g = el("g", { class: "pr", "data-h": c.h, tabindex: -1 }, gPr);
      c.sa = el("path", { class: "sa" }, c.g); c.sb = el("path", { class: "sb" }, c.g); c.rf = el("path", { class: "rf" }, c.g);
      c.im = el("image", { href: img(c.h), width: 1, height: 1, preserveAspectRatio: "none" }, c.g);
      c.ol = el("path", { class: "ol" }, c.g);
      c.g.addEventListener("mouseenter", ev => showTip(c.h, ev)); c.g.addEventListener("mousemove", moveTip); c.g.addEventListener("mouseleave", hideTip);
      c.g.addEventListener("click", () => { hideTip(); if (!st.bans.includes(c.h)) place(c.h); });
    }
  }
  function drawPrisms() {
    const f = (1 - FOOT) / 2;
    const order = LAND.cells.slice().sort((a, b) => depth(a.gx, a.gy) - depth(b.gx, b.gy));
    let k = 0; for (const c of order) { if (gPr.children[k] !== c.g) gPr.insertBefore(c.g, gPr.children[k] || null); k++; }
    for (const c of LAND.cells) {
      const x0 = c.gx + f, y0 = c.gy + f, x1 = x0 + FOOT, y1 = y0 + FOOT, z = Math.max(.015, c.z);
      c.sa.setAttribute("d", poly([proj(x1, y0, 0), proj(x1, y1, 0), proj(x1, y1, z), proj(x1, y0, z)]));
      c.sb.setAttribute("d", poly([proj(x0, y1, 0), proj(x1, y1, 0), proj(x1, y1, z), proj(x0, y1, z)]));
      const roof = poly([proj(x0, y0, z), proj(x1, y0, z), proj(x1, y1, z), proj(x0, y1, z)]); c.rf.setAttribute("d", roof); c.ol.setAttribute("d", roof);
      const o = proj(x0, y0, z), ex = proj(x1, y0, z), ey = proj(x0, y1, z);
      c.im.setAttribute("transform", `matrix(${ex[0] - o[0]} ${ex[1] - o[1]} ${ey[0] - o[0]} ${ey[1] - o[1]} ${o[0]} ${o[1]})`);
      c.top = proj(x0 + FOOT / 2, y0 + FOOT / 2, z);
    }
  }
  function drawTags() {                                     // numbered callouts for the eight tallest, set in a column like drawing annotations
    gTags.innerHTML = ""; const q = quickList(); if (!q.length) return;
    const sd = side(), items = q.map((x, k) => ({ ...x, k: k + 1, p: LAND.cells[x.h].top }));
    if (!LAND.tagsOn) {                                    // narrow screens: a numbered square on each roof instead
      for (const it of items) { const g = el("g", { class: "tag " + sd }, gTags); el("rect", { class: "k", x: it.p[0] - 8, y: it.p[1] - 26, width: 16, height: 16 }, g);
        const t = el("text", { class: "kn", x: it.p[0], y: it.p[1] - 14, "text-anchor": "middle" }, g); t.textContent = it.k; }
      return;
    }
    const colX = LAND.W - 190, top = 96, gap = Math.min(34, (LAND.Hh - top - 40) / items.length);
    const sorted = items.slice().sort((a, b) => a.p[1] - b.p[1]);
    sorted.forEach((it, i) => {
      const y = top + i * gap, g = el("g", { class: "tag " + sd, "data-h": it.h }, gTags), kx = colX;
      el("path", { class: "lead " + sd, d: `M${it.p[0].toFixed(1)} ${it.p[1].toFixed(1)}V${Math.min(it.p[1], y).toFixed(1)}L${(kx - 10).toFixed(1)} ${y.toFixed(1)}H${kx - 2}` }, g);
      el("circle", { class: "dot", cx: it.p[0], cy: it.p[1], r: 2.4 }, g);
      el("rect", { class: "k", x: kx, y: y - 9, width: 18, height: 18 }, g);
      const tk = el("text", { class: "kn", x: kx + 9, y: y + 4, "text-anchor": "middle" }, g); tk.textContent = it.k;
      const tn = el("text", { class: "nm", x: kx + 25, y: y + 4.5 }, g); tn.textContent = short(it.h);
      const tv = el("text", { class: "v", x: LAND.W - 14, y: y + 4.5, "text-anchor": "end" }, g); tv.textContent = it.lab;
      g.addEventListener("click", () => place(it.h)); g.addEventListener("mouseenter", () => LAND.cells[it.h].g.classList.add("hover")); g.addEventListener("mouseleave", () => LAND.cells[it.h].g.classList.remove("hover"));
    });
  }
  function drawScale() {                                    // a scale bar: how tall one unit of the answer stands
    gScale.innerHTML = ""; if (!LAND.unit) return;
    const u = LAND.unit, hz = u.v / LAND.metricMax * HMAX, px = hz * Math.cos(LAND.ph) * LAND.S, a = [26, LAND.Hh - 26], b = [26, LAND.Hh - 26 - px];
    if (!isFinite(px) || px <= 0) return;
    el("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], "stroke-width": 1.5 }, gScale);
    for (const p of [a, b]) el("line", { x1: p[0] - 4, y1: p[1], x2: p[0] + 4, y2: p[1] }, gScale);
    const t = el("text", { x: a[0] + 8, y: (a[1] + b[1]) / 2 + 4 }, gScale); t.textContent = u.lab;
  }
  function frame() {                                        // springs for the towers, easing for the camera
    const now = performance.now(); let moving = false;
    LAND.th += (LAND.thT - LAND.th) * .08; LAND.ph += (LAND.phT - LAND.ph) * .08;
    if (Math.abs(LAND.thT - LAND.th) > 1e-4 || Math.abs(LAND.phT - LAND.ph) > 1e-4) moving = true;
    for (const c of LAND.cells) {
      if (now < c.delay) { moving = true; continue; }
      if (REDUCED) { c.z = c.t; continue; }
      c.v = c.v * .74 + (c.t - c.z) * .11; c.z += c.v;
      if (Math.abs(c.v) > 1e-4 || Math.abs(c.t - c.z) > 1e-4) moving = true; else c.z = c.t;
    }
    if (moving || LAND.dirty) { drawPlates(); drawPrisms(); drawTags(); drawScale(); LAND.dirty = false; }
    LAND.running = moving; if (moving) requestAnimationFrame(frame);
  }
  const kick = () => { if (!LAND.running) { LAND.running = true; requestAnimationFrame(frame); } };
  wrap.addEventListener("pointermove", ev => { if (REDUCED || ev.pointerType !== "mouse") return; const r = wrap.getBoundingClientRect();
    LAND.thT = (31 + ((ev.clientX - r.left) / r.width - .5) * 12) * Math.PI / 180; LAND.phT = (45 + ((ev.clientY - r.top) / r.height - .5) * -8) * Math.PI / 180; kick(); });
  wrap.addEventListener("pointerleave", () => { LAND.thT = 31 * Math.PI / 180; LAND.phT = 45 * Math.PI / 180; kick(); });
  new ResizeObserver(() => { fit(); kick(); }).observe(wrap);
  const rootStyle = document.documentElement.style;             // the stage fills the window between the masthead and the dock
  new ResizeObserver(() => { rootStyle.setProperty("--dockH", $("dock").offsetHeight + "px"); rootStyle.setProperty("--mastH", document.querySelector(".mast").offsetHeight + "px"); }).observe(document.querySelector(".mast")); new ResizeObserver(() => rootStyle.setProperty("--dockH", $("dock").offsetHeight + "px")).observe($("dock"));

  // what the towers show at this step of the lobby
  function metric() {
    const bans = bannedSet(), team = teamSet(), e = nextBan();
    if (st.active.kind === "team") {
      const P = st.active.i === 0 || !RES ? popularity() : RES.Pu;
      return { v: h => P[h], q: st.active.i === 0 ? "Which hero are you playing?" : `Who is teammate ${st.active.i + 1} playing?`,
               m: st.active.i === 0 ? "Height: how often players at this rank open each hero." : "Height: the chance your team opens each hero, given who you have entered.",
               unit: x => ({ v: x, lab: pct(x) }), ok: h => !bans.has(h) && !team.has(h) };
    }
    if (e >= 6) return { v: h => RES.Pt[h], q: "The ban phase is done.", m: "Height: the chance the other team opens each hero now.", unit: x => ({ v: x, lab: pct(x) }), ok: h => !bans.has(h) };
    if (ourTurn()) {
      const V = st.model === "sim" ? (SIM && !SIM.prelim ? SIM.V : null) : RES.V;
      if (!V) return { v: h => RES.V[h], q: `Simulating your ban ${e + 1}`, m: "Every legal ban is being played out against re-drafted teams. Until it finishes, the towers show the ban value model.",
                       unit: x => ({ v: x, lab: (100 * x).toFixed(dec(x)) + " pts" }), ok: h => !bans.has(h) && !team.has(h) && !isNaN(RES.V[h]) };
      return { v: h => V[h], q: `${turnCount() === 2 ? `Your bans ${e + 1} and ${e + 2}` : `Your ban ${e + 1}`}: what is each ban worth?`,
               m: "Height: the win chance your team gains by banning the hero, against the ban a typical team would make.", unit: x => ({ v: x, lab: (100 * x).toFixed(dec(x)) + " pts" }), ok: h => !bans.has(h) && !team.has(h) && !isNaN(V[h]) };
    }
    return { v: h => THEIRS ? THEIRS[h] : 0, q: `Their ban ${e + 1}: what will they take?`, m: "Height: the chance they ban each hero next, from the ban model fitted on every Season 10 ban.",
             unit: x => ({ v: x, lab: pct(x) }), ok: h => !bans.has(h) };
  }
  function setTowers(first) {
    const M = metric(), bans = bannedSet(), team = teamSet(), sd = side(), q = quickList(), hot = new Set(q.map(x => x.h)), best = q.length ? q[0].h : -1;
    const vals = LAND.cells.map(c => M.ok(c.h) ? Math.max(0, M.v(c.h)) : 0), mx = Math.max(1e-9, ...vals); LAND.metricMax = mx;
    const now = performance.now();
    for (const c of LAND.cells) {
      c.t = bans.has(c.h) ? .015 : M.ok(c.h) ? .06 + Math.max(0, M.v(c.h)) / mx * HMAX : team.has(c.h) ? .35 : .04;
      const cls = ["pr"]; if (bans.has(c.h)) cls.push("gone"); else if (team.has(c.h) && st.active.kind !== "team") cls.push("mine");
      if (hot.has(c.h)) cls.push("hot", sd); if (c.h === best) cls.push("best", sd);
      if (LAND.query && !NAMES[c.h].toLowerCase().includes(LAND.query) && !short(c.h).toLowerCase().includes(LAND.query)) cls.push("dim");
      c.g.setAttribute("class", cls.join(" "));
      if (first) c.delay = now + 120 + depth(c.gx, c.gy) * 45;
    }
    if (M.unit) { const step = niceStep(mx, 2); LAND.unit = M.unit(step); } else LAND.unit = null;
    $("landQ").textContent = M.q; $("landM").textContent = M.m; LAND.dirty = true; kick();
  }

  // tooltip: the numbers behind a tower
  const tip = $("tip");
  function showTip(h, ev) {
    if (!RES) return; const bans = bannedSet(), rows = [];
    if (bans.has(h)) rows.push(`Banned in box ${st.bans.indexOf(h) + 1}`);
    else {
      if (ourTurn() && st.active.kind === "ban") { const S = st.model === "sim" && SIM && !SIM.prelim ? SIM : RES;
        if (!isNaN(S.V[h])) rows.push(`Ban value <em>${pp(S.V[h])}</em> ± ${(196 * S.se[h]).toFixed(2)} pts`); }
      if (THEIRS && !ourTurn() && nextBan() < 6) rows.push(`They ban it next <em>${pct(THEIRS[h])}</em>`);
      rows.push(`They open it <em>${pct(RES.Pt[h])}</em>, your team <em>${teamSet().has(h) ? "shown" : pct(RES.Pu[h])}</em>`);
      if (RES.R) rows.push(`Losing it costs its team <em>${(100 * RES.R[h]).toFixed(1)}</em> pts`);
    }
    tip.innerHTML = `<img src="${img(h)}" alt=""><div><b>${esc(NAMES[h])}</b><div class="r">${ROLE_NAMES[ROLE[h]]}<br>${rows.join("<br>")}</div></div>`;
    tip.classList.add("on"); moveTip(ev);
  }
  function moveTip(ev) { const w = tip.offsetWidth, hh = tip.offsetHeight; let x = ev.clientX + 16, y = ev.clientY + 14;
    if (x + w > innerWidth - 8) x = ev.clientX - w - 16; if (y + hh > innerHeight - 110) y = ev.clientY - hh - 14; tip.style.left = x + "px"; tip.style.top = y + "px"; }
  const hideTip = () => tip.classList.remove("on");

  // ================================================================ the call panel
  let RES = null, THEIRS = null, FC = null;
  const top2 = P => Array.from(P.keys()).sort((a, b) => P[b] - P[a]).slice(0, 2).map(h => ({ h, p: P[h] }));
  function forecastChain(s) {
    const e = s.bans.length, top = [], fix = [];
    for (let i = e; i < 6; i++) { if (ours(i)) continue; const L = i === e && THEIRS ? top2(THEIRS) : E.forecast(RES, fix)[i]; top[i] = L; if (L && L.length) fix[i] = L[0].h; }
    return { top };
  }
  function suggested(cnt) {
    const h1 = topBans(1)[0]; if (h1 === undefined) return [];
    const S1 = st.model === "sim" ? SIM : RES, one = { h: h1, V: S1.V[h1], se: S1.se[h1] };
    if (cnt < 2) return [one];
    const P = st.model === "sim" ? SIMP : RES.pairs;
    if (P === "failed") return [one]; if (!P || !P.length) return [one, null];
    const p = P[0], ab = S1.V[p.a] >= S1.V[p.b] ? [p.a, p.b] : [p.b, p.a];
    return ab.map(h => ({ h, V: p.V, se: p.se, pair: p }));
  }
  function ciSvg(x, runner) {                              // the estimate, its 95% interval, zero, and the runner-up
    const lo = Math.min(0, x.V - 1.96 * x.se, runner ? runner.V - 1.96 * runner.se : 0), hi = Math.max(x.V + 1.96 * x.se, runner ? runner.V + 1.96 * runner.se : 0, 1e-4);
    const Wd = 330, X = v => 10 + (v - lo) / (hi - lo) * (Wd - 20), step = niceStep(hi - lo, 4); let t = "";
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) t += `<text x="${X(v)}" y="42" text-anchor="middle">${pp(v, dec(step))}</text>`;
    const r = runner ? `<line class="w" x1="${X(runner.V - 1.96 * runner.se)}" x2="${X(runner.V + 1.96 * runner.se)}" y1="26" y2="26" style="stroke:var(--graphite)"/><circle cx="${X(runner.V)}" cy="26" r="3.5" style="fill:var(--graphite)"/>` : "";
    return `<svg class="ci" viewBox="0 0 ${Wd} 46" width="100%" style="max-width:${Wd}px"><line class="ax" x1="10" x2="${Wd - 10}" y1="31" y2="31"/><line class="z" x1="${X(0)}" x2="${X(0)}" y1="4" y2="34"/>
      <rect class="band" x="${X(x.V - 1.96 * x.se)}" y="7" width="${X(x.V + 1.96 * x.se) - X(x.V - 1.96 * x.se)}" height="12"/>
      <line class="w" x1="${X(x.V - 1.96 * x.se)}" x2="${X(x.V + 1.96 * x.se)}" y1="13" y2="13"/><circle cx="${X(x.V)}" cy="13" r="5"/>${r}${t}</svg>`;
  }
  function anatomy(h, R) {                                  // the value as an area equation: denies them − costs you + the rest of the ban phase
    const l = 1 - R.PL[h], a = { w: l * R.Pt[h], h: R.R[h] }, b = { w: l * R.Pu[h], h: R.Rus[h] };
    const dA = a.w * a.h, dB = b.w * b.h, rest = R.V[h] - dA + dB;           // the rest of the ban phase, so the equation adds up exactly
    const mxH = Math.max(a.h, b.h, 1e-6), mxW = Math.max(a.w, b.w, .05), kh = 92 / mxH, kw = 110 / mxW;
    const A = { w: Math.max(2, a.w * kw), h: Math.max(2, a.h * kh) }, B = { w: Math.max(2, b.w * kw), h: Math.max(2, b.h * kh) };
    const base = 120, x1 = 8, x2 = x1 + A.w + 40, x3 = x2 + B.w + 40, restH = Math.min(96, Math.abs(rest) * kw * kh / 12), x4 = x3 + 12 + 34;
    const tot = R.V[h];
    return `<svg viewBox="0 0 ${Math.max(x4 + 110, 380)} 176">
      <rect class="a-us" x="${x1}" y="${base - A.h}" width="${A.w}" height="${A.h}"/>
      <text x="${x1}" y="${base + 16}">they open it ${pct(a.w)}</text><text x="${x1}" y="${base - A.h - 6}">costs them ${(100 * a.h).toFixed(1)} pts</text>
      <text class="num" x="${x1 + A.w / 2}" y="${base + 34}" text-anchor="middle">${pp(dA)}</text>
      <text class="op" x="${x2 - 20}" y="${base - 30}" text-anchor="middle">−</text>
      <rect class="a-them" x="${x2}" y="${base - B.h}" width="${B.w}" height="${B.h}"/>
      <text x="${x2}" y="${base + 16}">you open it ${pct(b.w)}</text>${b.w > .004 ? `<text x="${x2}" y="${base - B.h - 6}">costs you ${(100 * b.h).toFixed(1)}</text>` : ""}
      <text class="num" x="${x2 + B.w / 2}" y="${base + 34}" text-anchor="middle">${pp(dB)}</text>
      <text class="op" x="${x3 - 20}" y="${base - 30}" text-anchor="middle">${rest >= 0 ? "+" : "−"}</text>
      <rect class="a-rest" x="${x3}" y="${base - Math.max(2, restH)}" width="12" height="${Math.max(2, restH)}"/>
      <text x="${x3}" y="${base + 16}">rest of the ban phase</text><text class="num" x="${x3 + 6}" y="${base + 34}" text-anchor="middle">${pp(Math.abs(rest))}</text>
      <text class="op" x="${x4 - 16}" y="${base - 30}" text-anchor="middle">=</text>
      <text class="res" x="${x4}" y="${base - 22}">${pp(tot)}</text><text x="${x4}" y="${base - 4}">points of win chance</text>
      <line class="dim" x1="0" x2="${Math.max(x4 + 110, 380)}" y1="${base}" y2="${base}"/></svg>`;
  }
  const rung = (it, k, sd, max, fmtv, pics) => `<div class="rung ${sd}" data-h="${it.h}"${it.b !== undefined ? ` data-b="${it.b}"` : ""}><span class="k">${k}</span>${pics || `<img src="${img(it.h)}" alt="">`}
    <div><div class="rn">${it.name || esc(NAMES[it.h])}</div><div class="bar"><i style="width:${Math.max(1.5, 100 * Math.max(0, it.v) / (max || 1)).toFixed(1)}%"></i></div></div><span class="v">${fmtv(it.v)}</span></div>`;
  function wireRungs(root) {
    root.querySelectorAll(".rung").forEach(r => r.onclick = () => {
      if (r.dataset.b !== undefined) { for (const h of [+r.dataset.h, +r.dataset.b]) { for (let i = 0; i < 6; i++) if (st.team[i] === h) st.team[i] = -1; if (!st.bans.includes(h)) st.bans.push(h); } st.active = { kind: "ban" }; update(); }
      else place(+r.dataset.h); });
    root.querySelectorAll("[data-place]").forEach(b => b.onclick = () => place(+b.dataset.place));
    root.querySelectorAll(".rung").forEach(r => { const c = LAND.cells[+r.dataset.h]; r.onmouseenter = () => c.g.classList.add("hover"); r.onmouseleave = () => c.g.classList.remove("hover"); });
  }
  function verdictHtml(hs, sd, act, value, extra) {
    return `<div class="verdict ${sd}"><div class="pics">${hs.map(h => `<img src="${img(h)}" alt="">`).join("")}</div><div>
      <div class="act">${act}</div><div class="nm">${hs.map(h => esc(NAMES[h])).join(" and ")}</div>${value}${extra || ""}</div></div>`;
  }
  function whyParts(P) {                                    // the ban model's utility for their next ban, split into its terms, against an average hero
    const B = META.ban, C = META.C, e = nextBan(), bd = E.band(META.tiers[st.tier]), m = st.map, BU = new Uint8Array(H), BT = new Uint8Array(H);
    st.bans.forEach((h, i) => (ours(i) ? BU : BT)[h] = 1);
    const parts = h => { let cr = 0, ro = 0; for (let j = 0; j < H; j++) cr += C[h][j] * RES.Pt[j]; for (let i = 0; i < H; i++) { if (BT[i]) ro += B.Ro[i][h]; if (BU[i]) ro += B.Rt[i][h]; }
      return [B.a[h] + B.am[m][h] + B.ab[bd][h] + B.ae[e][h], -B.lam * RES.Pt[h], B.gam * cr, ro]; };
    const legal = []; for (let h = 0; h < H; h++) if (!BU[h] && !BT[h]) legal.push(h);
    const all = legal.map(parts), mean = [0, 1, 2, 3].map(k => all.reduce((a, p) => a + p[k], 0) / all.length);
    return Array.from(P.keys()).sort((a, b) => P[b] - P[a]).slice(0, 5).map(h => ({ h, c: parts(h).map((v, k) => v - mean[k]) }));
  }
  function whySvg(P) {
    const rs = whyParts(P), key = [["popular here", "var(--them)", 1], ["they protect it", "var(--graphite)", .55], ["it beats what they play", "var(--them)", .45], ["reaction to earlier bans", "var(--us)", .7]];
    const sum = (r, sg) => r.c.filter(v => sg * v > 0).reduce((a, b) => a + b, 0), lo = Math.min(0, ...rs.map(r => sum(r, -1))), hi = Math.max(1e-6, ...rs.map(r => sum(r, 1)));
    const L = 96, Wd = 360, X = v => L + (v - lo) / (hi - lo) * (Wd - L - 8), rowH = 20;
    let g = rs.map((r, k) => { let p = 0, n = 0; const segs = r.c.map((v, j) => { const a = v >= 0 ? p : n; if (v >= 0) p += v; else n += v;
      return `<rect x="${X(Math.min(a, a + v))}" y="${k * rowH + 3}" width="${Math.abs(X(a + v) - X(a))}" height="11" fill="${key[j][1]}" opacity="${key[j][2]}"/>`; }).join("");
      return `<text x="${L - 8}" y="${k * rowH + 13}" text-anchor="end">${esc(short(r.h))}</text>${segs}`; }).join("");
    g += `<line x1="${X(0)}" x2="${X(0)}" y1="0" y2="${rs.length * rowH}" stroke="var(--ink)"/>`;
    let kx = 0, ky = rs.length * rowH + 18; g += key.map(([t, c, o]) => { const s = `<rect x="${kx}" y="${ky - 9}" width="10" height="10" fill="${c}" opacity="${o}"/><text x="${kx + 14}" y="${ky}">${t}</text>`; kx += 20 + t.length * 5.6; if (kx > 300) { kx = 0; ky += 16; } return s; }).join("");
    return `<svg viewBox="0 0 ${Wd} ${ky + 6}" width="100%" style="max-width:${Wd}px;font-size:11.5px;font-stretch:78%;fill:var(--text)">${g}</svg>`;
  }
  function renderCall() {
    const e = nextBan(), R = RES; let html = "";
    if (st.active.kind === "team") {
      const q = quickList(), mx = Math.max(...q.map(x => x.v), 1e-9), who = st.active.i === 0 ? "you" : `teammate ${st.active.i + 1}`;
      html += `<p class="eyebrowless">Step ${st.active.i + 1} of 6 before the bans. Skip teammates you do not know.</p>
        <div><div class="big" style="font-size:34px">${st.active.i === 0 ? "Which hero are you playing?" : `Who is ${who} playing?`}</div><p class="note">Click a tower, type a name, or press a number. ${st.active.i === 0 ? "Your hero is remembered for next time." : "Teammates you enter shape the lineups the model expects from your team."}</p></div>
        <div class="ladder">${q.map((x, k) => rung({ h: x.h, v: x.v }, k + 1, "us", mx, () => x.lab)).join("")}</div>
        ${st.active.i > 0 ? `<button class="pill" id="toBans">Go to the bans</button>` : ""}`;
    } else if (e >= 6) {
      const top = Array.from(R.Pt.keys()).filter(h => !st.bans.includes(h)).sort((a, b) => R.Pt[b] - R.Pt[a]).slice(0, 8), mx = R.Pt[top[0]];
      html += `<p class="eyebrowless">All six bans are in.</p>${verdictHtml([top[0]], "them", "Their most likely opener", `<div class="big">${pct(R.Pt[top[0]])}<small>chance they open it</small></div>`)}
        <div><h3>What they will likely play</h3><div class="ladder">${top.map((h, k) => rung({ h, v: R.Pt[h] }, k + 1, "them", mx, pct)).join("")}</div></div>
        <button class="pill" id="again">Start the next lobby</button>`;
    } else if (ourTurn() && st.model === "sim") html += simCall();
    else if (ourTurn()) {
      const cnt = turnCount(), sug = suggested(cnt).filter(Boolean), top = topBans(8);
      const pairs = cnt === 2 && sug[1], x = sug[0];
      let runner = null, rname = "";
      if (pairs && R.pairs && R.pairs[1]) { runner = R.pairs[1]; rname = `${short(runner.a)} and ${short(runner.b)}`; }
      else if (!pairs) { const r = top.find(h => h !== x.h); if (r !== undefined) { runner = { V: R.V[r], se: R.se[r] }; rname = short(r); } }
      const clear = runner && x.V - 1.96 * x.se > runner.V + 1.96 * runner.se;
      html += `<p class="eyebrowless">${cnt === 2 ? `Your bans ${e + 1} and ${e + 2} of 6, chosen together` : `Your ban ${e + 1} of 6`}. Ban value model, ${fmt(E.NS)} simulated ban phases.</p>`;
      html += verdictHtml(pairs ? [sug[0].h, sug[1].h] : [x.h], "us", "Ban", `<div class="big">${pp(x.V)}<small>points of win chance</small></div>`,
        `${ciSvg(x, runner)}<div class="judge">${runner ? (clear ? `Clear of ${esc(rname)} (${pp(runner.V)}), 95% intervals apart.` : `Tied with ${esc(rname)} (${pp(runner.V)}). Either is a sound ban.`) : ""}</div>`);
      if (!pairs) html += `<div class="anat"><h3>Why it is worth ${pp(x.V)}<span class="n">each area is a chance times a cost</span></h3>${anatomy(x.h, R)}</div>`;
      if (pairs) { const P = R.pairs.slice(0, 6), mx = Math.max(...P.map(p => p.V), 1e-9);
        html += `<div><h3>Best pairs<span class="n">scored together, so heroes that replace each other are not counted twice</span></h3><div class="ladder">${P.map((p, k) => rung({ h: p.a, b: p.b, v: p.V, name: `${esc(short(p.a))} + ${esc(short(p.b))}` }, k + 1, "us", mx, v => pp(v),
          `<span style="display:flex"><img src="${img(p.a)}" alt="" style="width:22px;height:30px;object-fit:cover"><img src="${img(p.b)}" alt="" style="width:22px;height:30px;object-fit:cover"></span>`)).join("")}</div></div>`; }
      else { const mx = Math.max(...top.map(h => R.V[h]), 1e-9);
        html += `<div><h3>Every good ban<span class="n">press the number to ban</span></h3><div class="ladder">${top.map((h, k) => rung({ h, v: R.V[h] }, k + 1, "us", mx, v => pp(v))).join("")}</div></div>`; }
    } else {
      const top = Array.from(THEIRS.keys()).filter(h => THEIRS[h] > 0).sort((a, b) => THEIRS[b] - THEIRS[a]).slice(0, 8), mx = THEIRS[top[0]];
      html += `<p class="eyebrowless">Their ban ${e + 1} of 6. They cannot see your team's hovers.</p>`;
      html += verdictHtml([top[0]], "them", "They will likely ban", `<div class="big">${pct(THEIRS[top[0]])}<small>chance</small></div>`,
        `<div class="judge" style="margin-top:10px"><button class="pill them" data-place="${top[0]}">They banned ${esc(short(top[0]))}</button></div>`);
      html += `<div><h3>Other likely bans<span class="n">click the one they made</span></h3><div class="ladder">${top.map((h, k) => rung({ h, v: THEIRS[h] }, k + 1, "them", mx, pct)).join("")}</div></div>`;
      html += `<div><h3>Why they would ban it<span class="n">the ban model's reasons, against an average hero</span></h3>${whySvg(THEIRS)}</div>`;
    }
    $("call").innerHTML = html; wireRungs($("call"));
    if ($("toBans")) $("toBans").onclick = () => { st.active = { kind: "ban" }; update(false); };
    if ($("again")) $("again").onclick = () => $("newBtn").click();
  }

  // ================================================================ openers: both teams' likely heroes, mirrored
  function renderFly() {
    const R = RES, bans = bannedSet(), revs = teamSet();
    const hs = NAMES.map((n, h) => h).filter(h => !bans.has(h)).sort((a, b) => Math.max(R.Pt[b], revs.has(b) ? 0 : R.Pu[b]) - Math.max(R.Pt[a], revs.has(a) ? 0 : R.Pu[a])).slice(0, 12);
    const Wd = 640, mid = Wd / 2, half = mid - 92, rowH = 30, top = 26, mx = Math.max(...hs.map(h => Math.max(R.Pt[h], revs.has(h) ? 0 : R.Pu[h])), 1e-6);
    let g = `<text class="hd them" x="${mid - 60}" y="12" text-anchor="end">Other team</text><text class="hd us" x="${mid + 60}" y="12">Your team</text>`;
    hs.forEach((h, k) => { const y = top + k * rowH, a = R.Pt[h] / mx * half, b = revs.has(h) ? 0 : R.Pu[h] / mx * half;
      g += `<rect class="them" x="${mid - 58 - a}" y="${y + 9}" width="${Math.max(1, a)}" height="10"/><text class="p" x="${mid - 62 - a}" y="${y + 18}" text-anchor="end">${pct(R.Pt[h])}</text>
        <image href="${img(h)}" x="${mid - 54}" y="${y + 1}" width="24" height="24"/><text x="${mid - 24}" y="${y + 18}">${esc(short(h))}</text>
        ${revs.has(h) ? `<text class="p" x="${mid + 64}" y="${y + 18}">on your team</text>` : `<rect class="us" x="${mid + 58}" y="${y + 9}" width="${Math.max(1, b)}" height="10"/><text class="p" x="${mid + 62 + b}" y="${y + 18}">${pct(R.Pu[h])}</text>`}`; });
    g += `<line class="mid" x1="${mid - 58}" x2="${mid - 58}" y1="${top - 4}" y2="${top + hs.length * rowH}"/><line class="mid" x1="${mid + 58}" x2="${mid + 58}" y1="${top - 4}" y2="${top + hs.length * rowH}"/>`;
    $("fly").innerHTML = `<svg viewBox="0 0 ${Wd} ${top + hs.length * rowH + 4}">${g}</svg><p class="note">The chance each team opens a hero, given the bans so far and the heroes your team shows. Long bars on both sides mean a ban costs both teams.</p>`;
  }

  // ================================================================ the pipeline: what runs when you click
  function renderPipe() {
    const sim = st.model === "sim", N = [
      { x: 0, y: 18, t: "Your lobby", s: "rank, map, bans, team" },
      { x: 150, y: 18, t: `${E.nets.length} lineup networks`, s: "who each team opens" },
      { x: 300, y: 18, t: "Removal costs", s: "what losing a hero costs" },
      { x: 150, y: 104, t: `${fmt(E.NS)} ban rollouts`, s: "the rest of the ban phase" },
      { x: 300, y: 104, t: "Value of each ban", s: "against a typical ban", hot: !sim },
      { x: 150, y: 190, t: "Stand-in players", s: "real players near your rank", sim: true },
      { x: 300, y: 190, t: "Re-draft, score", s: `${st.runs} runs per leading ban`, sim: true, hot: sim }];
    const w = 132, h = 58, box = n => `<g class="node${n.hot ? " hot" : ""}${n.sim ? " sim" : ""}"><rect x="${n.x}" y="${n.y}" width="${w}" height="${h}"/><text class="t" x="${n.x + 10}" y="${n.y + 24}">${n.t}</text><text x="${n.x + 10}" y="${n.y + 42}">${n.s}</text></g>`;
    const E2 = (a, b, cls) => { const A = N[a], B = N[b], x1 = A.x + w, y1 = A.y + h / 2, x2 = B.x, y2 = B.y + h / 2;
      const d = A.y === B.y ? `M${x1} ${y1}H${x2}` : A.x === B.x ? `M${A.x + w / 2} ${A.y + h}V${B.y}` : `M${A.x + w / 2} ${A.y + h}V${y2}H${x2}`;
      return `<path class="${cls || ""}" d="${d}"/>` + (((!sim && !cls) || (sim && cls === "sim")) ? `<path class="flow" d="${d}"/>` : ""); };
    const edges = [E2(0, 1), E2(1, 2), E2(1, 3), E2(2, 4), E2(3, 4), E2(0, 5, "sim"), E2(5, 6, "sim")];
    $("pipe").innerHTML = `<svg viewBox="-2 0 436 256">${edges.join("")}${N.map(box).join("")}</svg><p class="note">${sim ? "The simulator re-drafts both teams with real players near your rank for every leading ban, then scores the drafts with the outcome model." : "The value model answers in a fraction of a second. Switch to the simulator to re-draft both teams instead."}</p>`;
  }
  const SPL = META.validation && META.validation.splits, fitN = SPL ? SPL.train.n + SPL.validation.n : 243143;
  const dayOf = t => new Date(t.replace(" ", "T") + "Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
  $("facts").innerHTML = [[fmt(fitN), "ranked matches fitted"], [String(H), "heroes modelled"], [fmt(E.NS), "ban phases per call"], [String(META.maps.length), "maps"]].map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join("");
  $("fitted").textContent = SPL ? `Fitted on ${fmt(fitN)} PC ranked matches from Season 10, ${dayOf(SPL.train.first_utc)} to ${dayOf(SPL.validation.last_utc)}. The models run in your browser.` : "The models run in your browser.";

  // ================================================================ the dock
  function renderDock() {
    $("team").innerHTML = st.team.map((h, i) => { const on = st.active.kind === "team" && st.active.i === i;
      return `<button class="sl${h >= 0 ? " filled us" : ""}${on ? " on" : ""}" data-i="${i}" title="${i === 0 ? "You" : "Teammate " + (i + 1)}${h >= 0 ? ": " + esc(NAMES[h]) : ""}">${h >= 0 ? `<img src="${img(h)}" alt=""><span class="x" data-clear="${i}">✕</span>` : i === 0 ? "You" : i + 1}</button>`; }).join("");
    $("team").querySelectorAll(".sl").forEach(b => b.onclick = ev => { const i = +b.dataset.i; if (ev.target.dataset.clear !== undefined) st.team[i] = -1; st.active = { kind: "team", i }; update(ev.target.dataset.clear !== undefined); });
    const e = nextBan(), sug = ourTurn() && RES && st.active.kind === "ban" ? suggested(turnCount()) : [];
    $("track").innerHTML = [0, 1, 2, 3, 4, 5].map(i => {
      const h = st.bans[i], sd = ours(i) ? "us" : "them", sg = h === undefined && i >= e && i < e + sug.length ? sug[i - e] : null, f = h === undefined && !ours(i) && FC && FC.top[i] && FC.top[i][0];
      const inner = h !== undefined ? `<img src="${img(h)}" alt="">` : sg ? `<img class="gh" src="${img(sg.h)}" alt="">` : f ? `<img class="gh" src="${img(f.h)}" alt="">` : i + 1;
      return `<button class="sl b ${sd}${h !== undefined ? " filled" : ""}${i === e && st.active.kind === "ban" ? " on" : ""}" data-i="${i}" style="transform:translateY(${ours(i) ? 0 : -6}px)"
        title="Ban ${i + 1}, ${sd === "us" ? "your team" : "their team"}${h !== undefined ? ": " + esc(NAMES[h]) + ". Click to undo from here" : sg ? ": suggested " + esc(NAMES[sg.h]) : f ? ": likely " + esc(NAMES[f.h]) + " (" + pct(f.p) + ")" : ""}"><span class="who"></span>${inner}</button>`; }).join("");
    $("track").querySelectorAll(".sl").forEach(b => b.onclick = () => { const i = +b.dataset.i;
      if (i < st.bans.length) { st.bans = st.bans.slice(0, i); st.active = { kind: "ban" }; update(); } else { st.active = { kind: "ban" }; update(false); } });
    const q = quickList(), sd = side();
    $("quickT").textContent = st.active.kind === "team" ? (st.active.i === 0 ? "Your hero" : `Teammate ${st.active.i + 1}`) : nextBan() >= 6 ? "Done" : ourTurn() ? "Best bans" : "Their likely ban";
    $("quick").innerHTML = q.map((x, k) => `<button class="qt ${sd}" data-h="${x.h}" title="${esc(NAMES[x.h])}, ${x.lab} (key ${k + 1})"><span class="k">${k + 1}</span><img src="${img(x.h)}" alt=""></button>`).join("");
    $("quick").querySelectorAll(".qt").forEach(b => b.onclick = () => place(+b.dataset.h));
    $("undoBtn").disabled = !st.bans.length;
  }

  // ================================================================ re-draft simulator: the main page's worker pool, two stages
  const NW = Math.min(8, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), TOP2 = 12, FIRST = { 32: 8, 64: 12, 128: 16, 256: 24 }, PAIR_RUNS = 64, PAIRS = 10;
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  const chunks = (a, k) => { const n = Math.ceil(a.length / k), o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
  let pool = [], RUN = null, SRUN = null, SIM = null, SIMP = null, simId = 0;
  function newWorker() { const w = new Worker("../sim-worker.js?v=1c092ab7d8"); w.onmessage = ev => onSim(ev.data); w.onerror = () => simFail(); return w; }
  function ensurePool(fresh) { if (fresh) { pool.forEach(w => w.terminate()); pool = []; } while (pool.length < NW) pool.push(newWorker()); }
  function simFail() { if (!RUN || RUN.finished) return; RUN.finished = true; if (RUN.pairs) { SIMP = "failed"; refresh(); return; } RUN.failed = true; busy(false); renderCall(); }
  function send(k, cands, looks, baseLooks) { if (!cands.length && !baseLooks.length) return; RUN.pending++; pool[k].postMessage({ id: RUN.id, st: RUN.st, cands, looks, baseLooks }); }
  function startSim(s) {
    ensurePool(RUN && !RUN.finished);
    const prot = new Set(s.hov6.filter(h => h >= 0)), cands = []; for (let h = 0; h < H; h++) if (!s.bans.includes(h) && !prot.has(h)) cands.push(h);
    const top2 = Math.min(TOP2, cands.length), NR = st.runs, L1 = range(0, FIRST[NR]), L2 = range(FIRST[NR], NR);
    SRUN = RUN = { id: ++simId, st: s, cands, top2, L1, L2, NR, ticks: 0, total: NR + cands.length * L1.length + top2 * L2.length, pending: 0, stage: 1, vals: {}, base: {}, t0: performance.now(), finished: false };
    const load = pool.map(() => 0), jobs = pool.map(() => ({ cands: [], base: [] }));
    chunks(range(0, NR), pool.length).forEach((b, k) => { jobs[k].base = b; load[k] = b.length; });
    for (const h of cands) { const k = load.indexOf(Math.min(...load)); jobs[k].cands.push(h); load[k] += L1.length; }
    // three jobs per worker (the baseline goes with the first), so results and the run cloud arrive in waves
    jobs.forEach((j, k) => { const parts = j.cands.length ? chunks(j.cands, 3) : [[]]; send(k, parts[0], L1, j.base); parts.slice(1).forEach(p => send(k, p, L1, [])); });
  }
  function startPairs(s, base) {
    const sl = topBans(PAIRS), cands = []; for (let i = 0; i < sl.length; i++) for (let j = i + 1; j < sl.length; j++) cands.push([sl[i], sl[j]]);
    const NR = Math.min(st.runs, PAIR_RUNS);
    RUN = { id: ++simId, st: s, cands, NR, ticks: 0, total: cands.length * NR, pending: 0, stage: 2, vals: {}, base, t0: performance.now(), finished: false, pairs: true };
    const jobs = pool.map(() => []); cands.forEach((p, i) => jobs[i % pool.length].push(p)); jobs.forEach((j, k) => send(k, j, range(0, NR), []));
  }
  let cloudT = 0;
  function onSim(d) {
    const R = RUN; if (!R || d.id !== R.id || R.finished) return;
    if (!d.done) { R.ticks += d.tick || 0; if (!R.pairs) progress(); return; }
    for (const h in d.vals) Object.assign(R.vals[h] || (R.vals[h] = {}), d.vals[h]);
    if (d.baseCnt) Object.assign(R.base, d.base);
    if (!R.pairs && performance.now() - cloudT > 120) { cloudT = performance.now(); drawCloud(); }
    if (--R.pending > 0) return;
    if (R.pairs) { R.finished = true; SIMP = summarizePairs(R); refresh(); return; }
    const S = summarize(R); SIM = S;
    if (R.stage === 1 && R.top2 > 0 && R.L2.length) {
      R.stage = 2; S.prelim = true; let k = 0; const parts = chunks(R.L2, Math.max(1, Math.ceil(pool.length * 4 / R.top2)));
      R.cands.slice().sort((a, b) => S.V[b] - S.V[a]).slice(0, R.top2).forEach(h => parts.forEach(js => send(k++ % pool.length, [h], js, [])));
      return;
    }
    R.finished = true; busy(false); refresh();
    if (R.st.pair) startPairs(R.st, R.base);
  }
  function summarize(R) {
    const V = new Float64Array(H).fill(NaN), se = new Float64Array(H).fill(NaN), bj = Object.keys(R.base), bm = bj.reduce((a, j) => a + R.base[j], 0) / bj.length;
    for (const h of R.cands) { const v = R.vals[h]; if (!v) continue; const d = Object.keys(v).map(j => v[j] - R.base[j]), m = d.reduce((a, b) => a + b, 0) / d.length;
      V[h] = m; se[h] = Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / (d.length * Math.max(1, d.length - 1))); }
    return { V, se, base: bm, total: R.total };
  }
  function summarizePairs(R) {
    const out = []; for (const p of R.cands) { const v = R.vals[String(p)]; if (!v) continue; const d = Object.keys(v).map(j => v[j] - R.base[j]), m = d.reduce((a, b) => a + b, 0) / d.length;
      out.push({ a: p[0], b: p[1], V: m, se: Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / (d.length * Math.max(1, d.length - 1))) }); }
    return out.sort((x, y) => y.V - x.V);
  }
  function progress() {
    const f = Math.min(1, RUN.ticks / RUN.total), bar = $("simBar"); if (bar) bar.style.width = (100 * f).toFixed(1) + "%";
    const t = $("simCount"); if (t) t.textContent = `${fmt(RUN.ticks)} of ${fmt(RUN.total)} ban phases simulated`;
    $("busyT").textContent = `simulating ${Math.round(100 * f)}%`;
  }
  // the run cloud: one dot per simulated ban phase, for the leading bans, as the workers report
  function drawCloud() {
    const box = $("cloud"), R = SRUN; if (!box || !R) return;
    const bj = R.base; const rows = [];
    for (const h of R.cands) { const v = R.vals[h]; if (!v) continue; const d = Object.keys(v).filter(j => bj[j] !== undefined).map(j => v[j] - bj[j]); if (d.length) rows.push({ h, d, m: d.reduce((a, b) => a + b, 0) / d.length }); }
    rows.sort((a, b) => b.m - a.m); const top = rows.slice(0, 10); if (!top.length) { box.innerHTML = ""; return; }
    const all = top.flatMap(r => r.d).sort((a, b) => a - b), lo = Math.min(0, all[Math.floor(.01 * (all.length - 1))]), hi = Math.max(0, all[Math.floor(.99 * (all.length - 1))]) || 1e-3;
    const L = 92, Wd = 380, X = v => L + (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * (Wd - L - 46), rowH = 22;
    let g = `<line class="zero" x1="${X(0)}" x2="${X(0)}" y1="0" y2="${top.length * rowH}"/>`;
    top.forEach((r, k) => { const y = k * rowH + 11;
      g += `<text x="${L - 8}" y="${y + 4}" text-anchor="end">${esc(short(r.h))}</text>`;
      r.d.forEach((v, j) => { const jit = ((j * 7919) % 13) / 13 - .5; g += `<circle cx="${X(v).toFixed(1)}" cy="${(y + jit * 12).toFixed(1)}" r="1.9"${v < 0 ? ' class="neg"' : ""}/>`; });
      g += `<line class="mean" x1="${X(r.m)}" x2="${X(r.m)}" y1="${y - 8}" y2="${y + 8}"/><text class="v" x="${Wd}" y="${y + 4}" text-anchor="end">${pp(r.m)}</text>`; });
    const step = niceStep(hi - lo, 3); for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) g += `<text class="ax" x="${X(v)}" y="${top.length * rowH + 12}" text-anchor="middle">${pp(v, dec(step))}</text>`;
    box.innerHTML = `<svg viewBox="0 0 ${Wd} ${top.length * rowH + 16}">${g}</svg>`;
  }
  function simCall() {
    const e = nextBan(), cnt = turnCount();
    let html = `<p class="eyebrowless">${cnt === 2 ? `Your bans ${e + 1} and ${e + 2}` : `Your ban ${e + 1}`} of 6. Re-draft simulator, ${st.runs} runs for each leading ban.</p>`;
    if (RUN && RUN.failed) return html + `<p class="note">The simulator stopped with an error in this browser. Reload the page, or switch to the ban value model.</p>`;
    const cloud = `<div class="cloud"><h3>Every simulated ban phase<span class="n">one dot per run, the tick is the average</span></h3><div id="cloud"></div></div>`;
    if (!SIM || SIM.prelim) return html + `<div><div class="big" style="font-size:32px">Simulating</div><div class="prog"><i id="simBar"></i></div><p class="note" id="simCount"></p></div>` + cloud;
    const sug = suggested(cnt), top = topBans(8), x = sug[0], pairs = cnt === 2 && sug[1];
    let runner = null, rname = "";
    if (pairs && Array.isArray(SIMP) && SIMP[1]) { runner = SIMP[1]; rname = `${short(SIMP[1].a)} and ${short(SIMP[1].b)}`; }
    else if (!pairs) { const r = top.find(h => h !== x.h); if (r !== undefined) { runner = { V: SIM.V[r], se: SIM.se[r] }; rname = short(r); } }
    const clear = runner && x.V - 1.96 * x.se > runner.V + 1.96 * runner.se;
    html += verdictHtml(pairs ? [sug[0].h, sug[1].h] : [x.h], "us", "Ban", `<div class="big">${pp(x.V)}<small>points of win chance</small></div>`,
      `${ciSvg(x, runner)}<div class="judge">${runner ? (clear ? `Clear of ${esc(rname)} (${pp(runner.V)}).` : `Tied with ${esc(rname)} (${pp(runner.V)}). Either is a sound ban.`) : ""}${cnt === 2 && !pairs ? " Scoring pairs next." : ""}</div>`);
    const mx = Math.max(...top.map(h => SIM.V[h]), 1e-9);
    return html + cloud + `<div><h3>Every good ban<span class="n">press the number to ban</span></h3><div class="ladder">${top.map((h, k) => rung({ h, v: SIM.V[h] }, k + 1, "us", mx, v => pp(v))).join("")}</div></div>`;
  }

  // ================================================================ update loop
  const busy = on => { $("busy").classList.toggle("on", on); if (!on) $("busyT").textContent = "computing"; };
  function refresh() { renderDock(); setTowers(false); renderCall(); drawCloud(); if (RES) renderFly(); }
  let pending = 0, lastTier = null, firstDraw = true;
  function update(recompute = true) {
    writeHash(); syncControls(); renderPipe();
    if (!recompute && RES) { refresh(); return; }
    busy(true); const my = ++pending;
    setTimeout(() => {
      if (my !== pending) return;
      if (lastTier !== st.tier) { layout(); if (!LAND.cells[0].g) { buildPlates(); buildPrisms(); } fit(); lastTier = st.tier; }
      const s = { firstUs: st.first, bans: st.bans.slice(), rev: st.team.filter(h => h >= 0), m: st.map, r0: META.tiers[st.tier], cnt: turnCount() };
      RES = E.values(s); THEIRS = !ourTurn() && nextBan() < 6 ? E.theirNextBan(s, RES) : null; SIM = SIMP = null; SRUN = null;
      FC = nextBan() < 6 ? forecastChain(s) : null;
      if (st.model === "sim" && ourTurn() && st.active.kind === "ban") { $("busyT").textContent = "simulating 0%"; startSim(Object.assign({}, s, { hov6: st.team.slice(), cnt: 1, pair: s.cnt === 2 })); }
      else { if (RUN) RUN.finished = true; busy(false); }
      renderDock(); setTowers(firstDraw); firstDraw = false; renderCall(); renderFly(); if (RUN && !RUN.finished) progress();
    }, 15);
  }
  // the masthead's one entrance: the two words slide up while the towers rise
  if (!REDUCED) $("word").querySelectorAll("span").forEach((s, i) => s.animate([{ transform: "translateY(40%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 700, delay: 80 * i, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" }));
  update();
})();
