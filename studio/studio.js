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
    QUERY = $("search").value.split(",").pop().trim().toLowerCase(); if (TILES.length) paintBoard();
    if (!m.length && !$("search").value) $("hits").textContent = "Press / to type. Commas enter several.";
  }
  $("search").oninput = renderHits;
  $("search").onkeydown = ev => {
    if (ev.key === "Enter" && !$("search").value.trim() && $("doBan")) { $("doBan").click(); ev.preventDefault(); return; }
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

  // ================================================================ the board: every hero in a fixed place, the model's answer as a bar
  // Roles side by side, most played first, so a hero is always where you last saw it. The bar and the number badges change
  // with the step you are on; the order never does (it only follows the rank).
  const board = $("board"), TILES = [], BCOLS = [3, 5, 3];
  function mkTile(h) {
    const el = document.createElement("button"); el.className = "tile"; el.dataset.h = h; el.setAttribute("aria-label", NAMES[h]);
    el.innerHTML = `<span class="pic"><img src="${img(h)}" alt="" loading="lazy"><span class="k"></span></span><span class="nm">${esc(short(h))}</span><span class="bar"><i></i></span><span class="v"></span>`;
    el.onclick = () => { hideTip(); if (!st.bans.includes(h)) place(h); };
    el.onmouseenter = ev => showTip(h, ev); el.onmousemove = moveTip; el.onmouseleave = hideTip;
    return { el, k: el.querySelector(".k"), bar: el.querySelector(".bar i"), v: el.querySelector(".v") };
  }
  function buildBoard() {
    const pop = popularity();
    board.innerHTML = [0, 1, 2].map(r => `<div class="role"><h4>${ROLE_NAMES[r]}</h4><div class="tiles" style="grid-template-columns:repeat(${BCOLS[r]}, minmax(0, 1fr))"></div></div>`).join("");
    const boxes = board.querySelectorAll(".tiles");
    for (let r = 0; r < 3; r++) NAMES.map((n, h) => h).filter(h => ROLE[h] === r).sort((a, b) => pop[b] - pop[a])
      .forEach(h => boxes[r].appendChild((TILES[h] || (TILES[h] = mkTile(h))).el));
  }
  // what the bars show at this step of the lobby
  function metric() {
    const bans = bannedSet(), team = teamSet(), e = nextBan(), P = x => pct(x), PT = x => pp(x);
    if (st.active.kind === "team") {
      const Pm = st.active.i === 0 || !RES ? popularity() : RES.Pu;
      return { v: h => Pm[h], f: P, q: "Pick the hero", m: st.active.i === 0 ? "Bars: how often players at this rank open each hero." : "Bars: the chance your team opens each hero, given who you have entered.",
               ok: h => !bans.has(h) && !team.has(h) };
    }
    if (e >= 6) return { v: h => RES.Pt[h], f: P, q: "What they will likely play", m: "Bars: the chance the other team opens each hero now.", ok: h => !bans.has(h) };
    if (ourTurn()) {
      const V = st.model === "sim" ? (SIM && !SIM.prelim ? SIM.V : null) : RES.V, W = V || RES.V;
      return { v: h => W[h], f: PT, q: "Click a hero to ban it", m: V ? "Bars: the win chance your team gains by banning each hero, in points, against the ban a typical team would make."
               : "Bars: the ban value model's answer while the simulator runs.", ok: h => !bans.has(h) && !team.has(h) && !isNaN(W[h]) };
    }
    return { v: h => THEIRS ? THEIRS[h] : 0, f: P, q: "Click the hero they banned", m: "Bars: the chance they ban each hero next, from the ban model fitted on every Season 10 ban.", ok: h => !bans.has(h) };
  }
  let QUERY = "";
  function paintBoard() {
    const M = metric(), bans = bannedSet(), team = teamSet(), sd = side(), q = quickList(), rank = new Map(q.map((x, k) => [x.h, k + 1])), best = q.length ? q[0].h : -1;
    let mx = 1e-9; for (let h = 0; h < H; h++) if (M.ok(h)) mx = Math.max(mx, M.v(h));
    for (let h = 0; h < H; h++) {
      const t = TILES[h], ok = M.ok(h), cls = ["tile", sd];
      if (bans.has(h)) cls.push("gone"); else if (team.has(h)) cls.push("mine");
      if (rank.has(h)) cls.push("top"); if (h === best) cls.push("best");
      if (QUERY && !NAMES[h].toLowerCase().includes(QUERY) && !short(h).toLowerCase().includes(QUERY)) cls.push("dim");
      t.el.className = cls.join(" ");
      t.bar.style.width = ok ? (100 * Math.max(0, M.v(h)) / mx).toFixed(1) + "%" : "0%";
      t.v.textContent = ok ? M.f(M.v(h)) : bans.has(h) ? "banned" : team.has(h) ? "your team" : "";
      t.k.textContent = rank.get(h) || "";
      t.el.title = bans.has(h) ? `${NAMES[h]}: banned` : NAMES[h];
    }
    $("boardQ").textContent = M.q; $("boardM").textContent = M.m;
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
      <text class="num" x="${x1 + A.w / 2}" y="${base + 34}" text-anchor="middle">${(100 * dA).toFixed(2)}</text>
      <text class="op" x="${x2 - 20}" y="${base - 30}" text-anchor="middle">−</text>
      <rect class="a-them" x="${x2}" y="${base - B.h}" width="${B.w}" height="${B.h}"/>
      <text x="${x2}" y="${base + 16}">you open it ${pct(b.w)}</text>${b.w > .004 ? `<text x="${x2}" y="${base - B.h - 6}">costs you ${(100 * b.h).toFixed(1)}</text>` : ""}
      <text class="num" x="${x2 + B.w / 2}" y="${base + 34}" text-anchor="middle">${(100 * dB).toFixed(2)}</text>
      <text class="op" x="${x3 - 20}" y="${base - 30}" text-anchor="middle">${rest >= 0 ? "+" : "−"}</text>
      <rect class="a-rest" x="${x3}" y="${base - Math.max(2, restH)}" width="12" height="${Math.max(2, restH)}"/>
      <text x="${x3}" y="${base + 16}">rest of the ban phase</text><text class="num" x="${x3 + 6}" y="${base + 34}" text-anchor="middle">${(100 * Math.abs(rest)).toFixed(2)}</text>
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
    root.querySelectorAll(".rung").forEach(r => { const t = TILES[+r.dataset.h]; if (!t) return; r.onmouseenter = () => t.el.classList.add("hover"); r.onmouseleave = () => t.el.classList.remove("hover"); });
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
  function reasonFor(h, R) {                                // the value in one sentence, from the same terms as the breakdown
    const l = 1 - R.PL[h], them = l * R.Pt[h], us = l * R.Pu[h];
    return `They open ${esc(short(h))} <b>${pct(them)}</b> of the time, and losing it costs them <b>${(100 * R.R[h]).toFixed(1)} points</b> of win chance when they do. ` +
      (us >= .03 ? `Your team would open it ${pct(us)} of the time, so the ban costs you a little too.` : `Your team rarely opens it, so the ban costs you almost nothing.`);
  }
  const REASONS = ["it is popular on this map and rank", "they do not play it themselves", "it beats what they play", "of the bans so far"];
  function renderCall() {
    const e = nextBan(), R = RES; let html = "";
    if (st.active.kind === "team") {
      const i = st.active.i, q = quickList().slice(0, 6), mx = Math.max(...q.map(x => x.v), 1e-9);
      html += `<p class="eyebrowless">Before the bans, step ${i + 1} of 6</p><p class="q">${i === 0 ? "Which hero are you playing?" : `Who is teammate ${i + 1} playing?`}</p>
        <p class="reason">Click the hero on the board, type the name, or press its number. ${i === 0 ? "Your hero is remembered for next time." : "Skip teammates you do not know. Each one you add sharpens what the model expects from your team."}</p>
        <div class="ladder">${q.map((x, k) => rung({ h: x.h, v: x.v }, k + 1, "us", mx, () => x.lab)).join("")}</div>
        <div class="go">${i > 0 ? `<button class="btn2" id="toBans">Skip to the bans</button>` : ""}</div>`;
    } else if (e >= 6) {
      const top = Array.from(R.Pt.keys()).filter(h => !st.bans.includes(h)).sort((a, b) => R.Pt[b] - R.Pt[a]).slice(0, 6), mx = R.Pt[top[0]];
      html += `<p class="eyebrowless">All six bans are in</p>${verdictHtml([top[0]], "them", "They will most likely play", `<div class="big">${pct(R.Pt[top[0]])}<small>chance</small></div>`)}
        <div><h3>Their other likely heroes</h3><div class="ladder">${top.slice(1).map((h, k) => rung({ h, v: R.Pt[h] }, k + 2, "them", mx, pct)).join("")}</div></div>
        <div class="go"><button class="btn" id="again">Start the next lobby</button></div>`;
    } else if (ourTurn() && st.model === "sim") html += simCall();
    else if (ourTurn()) {
      const cnt = turnCount(), sug = suggested(cnt).filter(Boolean), top = topBans(6), pairs = cnt === 2 && sug[1], x = sug[0];
      let runner = null, rname = "";
      if (pairs && R.pairs && R.pairs[1]) { runner = R.pairs[1]; rname = `${short(runner.a)} and ${short(runner.b)}`; }
      else if (!pairs) { const r = top.find(h => h !== x.h); if (r !== undefined) { runner = { V: R.V[r], se: R.se[r] }; rname = short(r); } }
      const clear = runner && x.V - 1.96 * x.se > runner.V + 1.96 * runner.se, hs = pairs ? [sug[0].h, sug[1].h] : [x.h];
      html += `<p class="eyebrowless">${pairs ? `Your bans ${e + 1} and ${e + 2} of 6, chosen together` : `Your ban ${e + 1} of 6`}</p>`;
      html += verdictHtml(hs, "us", "Ban", `<div class="big">${pp(x.V)}<small>points of win chance</small></div>`,
        `${ciSvg(x, runner)}<div class="judge">${runner ? (clear ? `Clearly better than ${esc(rname)} (${pp(runner.V)}).` : `About as good as ${esc(rname)} (${pp(runner.V)}). Either is a sound ban.`) : ""}</div>`);
      html += `<p class="reason">${pairs ? `The two are scored as a pair, so heroes that replace each other are not counted twice. ${reasonFor(hs[0], R)}` : reasonFor(x.h, R)}</p>`;
      html += `<div class="go"><button class="btn us" id="doBan"><img src="${img(hs[0])}" alt="">${pairs ? `Ban both` : `Ban ${esc(short(x.h))}`}<span class="kb">${pairs ? "Enter" : "1"}</span></button></div>`;
      if (pairs) { const P = R.pairs.slice(1, 6), mx = Math.max(...R.pairs.slice(0, 6).map(p => p.V), 1e-9);
        html += `<div><h3>Other pairs</h3><div class="ladder">${P.map((p, k) => rung({ h: p.a, b: p.b, v: p.V, name: `${esc(short(p.a))} + ${esc(short(p.b))}` }, k + 2, "us", mx, v => pp(v),
          `<span style="display:flex"><img src="${img(p.a)}" alt="" style="width:22px;height:30px;object-fit:cover"><img src="${img(p.b)}" alt="" style="width:22px;height:30px;object-fit:cover"></span>`)).join("")}</div></div>`; }
      else { const mx = Math.max(...top.map(h => R.V[h]), 1e-9);
        html += `<div><h3>Other good bans</h3><div class="ladder">${top.filter(h => h !== x.h).slice(0, 5).map((h, k) => rung({ h, v: R.V[h] }, k + 2, "us", mx, v => pp(v))).join("")}</div></div>`; }
      html = html.replace('id="doBan"', `id="doBan" data-hs="${hs.join(",")}"`);
    } else {
      const top = Array.from(THEIRS.keys()).filter(h => THEIRS[h] > 0).sort((a, b) => THEIRS[b] - THEIRS[a]).slice(0, 6), mx = THEIRS[top[0]];
      const w = whyParts(THEIRS)[0], main = w ? w.c.indexOf(Math.max(...w.c)) : 0;
      html += `<p class="eyebrowless">Their ban ${e + 1} of 6</p>`;
      html += verdictHtml([top[0]], "them", "They will most likely ban", `<div class="big">${pct(THEIRS[top[0]])}<small>chance</small></div>`);
      html += `<p class="reason">Mostly because ${REASONS[main]}. They cannot see your team's hovers. When they lock it in, enter what they actually banned.</p>`;
      html += `<div class="go"><button class="btn them" data-place="${top[0]}"><img src="${img(top[0])}" alt="">They banned ${esc(short(top[0]))}<span class="kb">1</span></button><span class="note" style="margin:0">or click it on the board</span></div>`;
      html += `<div><h3>Other likely bans</h3><div class="ladder">${top.slice(1).map((h, k) => rung({ h, v: THEIRS[h] }, k + 2, "them", mx, pct)).join("")}</div></div>`;
    }
    $("call").innerHTML = html; wireRungs($("call"));
    if ($("toBans")) $("toBans").onclick = () => { st.active = { kind: "ban" }; update(false); };
    if ($("again")) $("again").onclick = () => $("newBtn").click();
    if ($("doBan")) $("doBan").onclick = () => banAll($("doBan").dataset.hs.split(",").map(Number));
    renderWhy();
  }
  function banAll(hs) {                                     // one ban, or both bans of a two-ban turn
    if (hs.length === 1) return place(hs[0]);
    for (const h of hs) { for (let i = 0; i < 6; i++) if (st.team[i] === h) st.team[i] = -1; if (!st.bans.includes(h) && st.bans.length < 6) st.bans.push(h); }
    st.active = { kind: "ban" }; update();
  }
  function renderWhy() {                                    // the section under the answer: the breakdown behind it
    const e = nextBan(); let h3 = "Why", body = "";
    if (st.active.kind === "team") { h3 = "Why enter your team"; body = `<p class="note">Teams avoid banning their own heroes and ban what beats them, and a ban costs most when it hits a hero someone on the team relies on. The heroes you enter tell the model which bans would hurt your team, so it will not suggest them, and they change what it expects the other team to take.</p>`; }
    else if (e >= 6) { h3 = "Done"; body = `<p class="note">All six bans are in. The board shows what the other team is now likely to open.</p>`; }
    else if (ourTurn()) {
      const S = st.model === "sim" && SIM && !SIM.prelim ? SIM : null, x = (S ? topBans(1)[0] : suggested(1)[0] && suggested(1)[0].h);
      if (x !== undefined) { h3 = `Why ${short(x)} is worth ${pp(RES.V[x])}`; body = `<div class="anat">${anatomy(x, RES)}</div><p class="note">Each area is a chance times a cost, from the ban value model${S ? " (the simulator's number above re-drafts both teams instead)" : ""}. Discounted by the chance the hero would be banned anyway.</p>`; }
    } else if (THEIRS) { h3 = "Why they would ban it"; body = whySvg(THEIRS) + `<p class="note">The ban model's reasons for each likely ban, measured against an average hero.</p>`; }
    $("whyH").textContent = h3; $("why").innerHTML = body;
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

  // ================================================================ the step bar
  function renderSteps() {
    $("team").innerHTML = st.team.map((h, i) => { const on = st.active.kind === "team" && st.active.i === i;
      return `<button class="sl us${h >= 0 ? " filled" : ""}${on ? " on" : ""}" data-i="${i}" title="${i === 0 ? "You" : "Teammate " + (i + 1)}${h >= 0 ? ": " + esc(NAMES[h]) : ""}"><span class="box">${h >= 0 ? `<img src="${img(h)}" alt="">` : "+"}</span><span class="cap">${i === 0 ? "You" : "Mate " + (i + 1)}</span>${h >= 0 ? `<span class="x" data-clear="${i}">✕</span>` : ""}</button>`; }).join("");
    $("team").querySelectorAll(".sl").forEach(b => b.onclick = ev => { const i = +b.dataset.i, clr = ev.target.dataset.clear !== undefined; if (clr) st.team[i] = -1; st.active = { kind: "team", i }; update(clr); });
    const e = nextBan(), sug = ourTurn() && RES && st.active.kind === "ban" ? suggested(turnCount()) : [];
    $("track").innerHTML = [0, 1, 2, 3, 4, 5].map(i => {
      const h = st.bans[i], sd = ours(i) ? "us" : "them", sg = h === undefined && i >= e && i < e + sug.length ? sug[i - e] : null, f = h === undefined && !ours(i) && FC && FC.top[i] && FC.top[i][0];
      const inner = h !== undefined ? `<img src="${img(h)}" alt="">` : sg ? `<img class="gh" src="${img(sg.h)}" alt="">` : f ? `<img class="gh" src="${img(f.h)}" alt="">` : i + 1;
      return `<button class="sl b ${sd}${h !== undefined ? " filled" : ""}${i === e && st.active.kind === "ban" ? " on" : ""}" data-i="${i}"
        title="Ban ${i + 1}, ${sd === "us" ? "your team" : "their team"}${h !== undefined ? ": " + esc(NAMES[h]) + ". Click to undo from here" : sg ? ": suggested " + esc(NAMES[sg.h]) : f ? ": likely " + esc(NAMES[f.h]) + " (" + pct(f.p) + ")" : ""}"><span class="box">${inner}</span><span class="cap">${sd === "us" ? "You" : "Them"}</span></button>`; }).join("");
    $("track").querySelectorAll(".sl").forEach(b => b.onclick = () => { const i = +b.dataset.i;
      if (i < st.bans.length) { st.bans = st.bans.slice(0, i); st.active = { kind: "ban" }; update(); } else { st.active = { kind: "ban" }; update(false); } });
    const t = $("nowT"); t.className = "t " + side();
    t.textContent = st.active.kind === "team" ? (st.active.i === 0 ? "Now: your hero" : `Now: teammate ${st.active.i + 1}`) : e >= 6 ? "Ban phase complete" : ourTurn() ? (turnCount() === 2 ? `Now: your bans ${e + 1} and ${e + 2}` : `Now: your ban ${e + 1}`) : `Now: their ban ${e + 1}`;
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
    if (!SIM || SIM.prelim) return html + `<div><p class="q">Simulating every ban</p><div class="prog"><i id="simBar"></i></div><p class="note" id="simCount"></p></div>` + cloud;
    const sug = suggested(cnt), top = topBans(8), x = sug[0], pairs = cnt === 2 && sug[1];
    let runner = null, rname = "";
    if (pairs && Array.isArray(SIMP) && SIMP[1]) { runner = SIMP[1]; rname = `${short(SIMP[1].a)} and ${short(SIMP[1].b)}`; }
    else if (!pairs) { const r = top.find(h => h !== x.h); if (r !== undefined) { runner = { V: SIM.V[r], se: SIM.se[r] }; rname = short(r); } }
    const clear = runner && x.V - 1.96 * x.se > runner.V + 1.96 * runner.se;
    html += verdictHtml(pairs ? [sug[0].h, sug[1].h] : [x.h], "us", "Ban", `<div class="big">${pp(x.V)}<small>points of win chance</small></div>`,
      `${ciSvg(x, runner)}<div class="judge">${runner ? (clear ? `Clear of ${esc(rname)} (${pp(runner.V)}).` : `Tied with ${esc(rname)} (${pp(runner.V)}). Either is a sound ban.`) : ""}${cnt === 2 && !pairs ? " Scoring pairs next." : ""}</div>`);
    const mx = Math.max(...top.map(h => SIM.V[h]), 1e-9), hs = pairs ? [sug[0].h, sug[1].h] : [x.h];
    html += `<div class="go"><button class="btn us" id="doBan" data-hs="${hs.join(",")}"><img src="${img(hs[0])}" alt="">${pairs ? "Ban both" : `Ban ${esc(short(x.h))}`}<span class="kb">${pairs ? "Enter" : "1"}</span></button></div>`;
    return html + cloud + `<div><h3>Other good bans</h3><div class="ladder">${top.filter(h => h !== x.h).slice(0, 5).map((h, k) => rung({ h, v: SIM.V[h] }, k + 2, "us", mx, v => pp(v))).join("")}</div></div>`;
  }

  // ================================================================ update loop
  const busy = on => { document.body.classList.toggle("computing", on); if (!on) $("busyT").textContent = ""; };
  function refresh() { renderSteps(); paintBoard(); renderCall(); drawCloud(); if (RES) renderFly(); }
  let pending = 0, lastTier = null;
  function update(recompute = true) {
    writeHash(); syncControls(); renderPipe();
    if (!recompute && RES) { refresh(); return; }
    busy(true); const my = ++pending;
    setTimeout(() => {
      if (my !== pending) return;
      if (lastTier !== st.tier) { buildBoard(); lastTier = st.tier; }
      const s = { firstUs: st.first, bans: st.bans.slice(), rev: st.team.filter(h => h >= 0), m: st.map, r0: META.tiers[st.tier], cnt: turnCount() };
      RES = E.values(s); THEIRS = !ourTurn() && nextBan() < 6 ? E.theirNextBan(s, RES) : null; SIM = SIMP = null; SRUN = null;
      FC = nextBan() < 6 ? forecastChain(s) : null;
      if (st.model === "sim" && ourTurn() && st.active.kind === "ban") { $("busyT").textContent = "simulating 0%"; startSim(Object.assign({}, s, { hov6: st.team.slice(), cnt: 1, pair: s.cnt === 2 })); }
      else { if (RUN) RUN.finished = true; busy(false); }
      refresh(); if (RUN && !RUN.finished) progress();
    }, 15);
  }
  // the masthead's one entrance
  if (!REDUCED) $("word").querySelectorAll("span").forEach((s, i) => s.animate([{ transform: "translateY(40%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 700, delay: 80 * i, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" }));
  update();
})();
