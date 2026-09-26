/* Ban Call: interface. The model lives in engine.js; this file handles the lobby state, input and figures. */
(async function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const ROLE_NAMES = ["Vanguard", "Duelist", "Strategist"];
  const SHORT = { "Deadpool (Vanguard)": "Deadpool V", "Deadpool (Duelist)": "Deadpool D", "Deadpool (Strategist)": "Deadpool S",
    "Gorr The God Butcher": "Gorr", "Jeff The Land Shark": "Jeff", "Mister Fantastic": "Mr. Fantastic", "Captain America": "Cap",
    "Invisible Woman": "Invisible W.", "Rocket Raccoon": "Rocket", "Cloak & Dagger": "Cloak & Dagger", "Elsa Bloodstone": "Elsa",
    "Winter Soldier": "Winter Soldier", "Doctor Strange": "Dr. Strange", "Devil Dinosaur": "Devil Dino", "Squirrel Girl": "Squirrel Girl" };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pp = (x, d = 2) => (x >= 0 ? "+" : "−") + Math.abs(100 * x).toFixed(d);
  const pct = x => (100 * x).toFixed(0) + "%";
  const fmt = n => n.toLocaleString("en-US");
  // text widths for chart labels, so every label fits its figure
  const FONT = '"Archivo Narrow", "Arial Narrow", Arial, sans-serif', ctx2d = document.createElement("canvas").getContext("2d");
  const tw = (s, px) => { ctx2d.font = `${px}px ${FONT}`; return ctx2d.measureText(String(s)).width; };
  const labW = (arr, px) => Math.ceil(Math.max(0, ...arr.map(s => tw(s, px)))) + 4;
  try { await Promise.race([document.fonts.load('12px "Archivo Narrow"'), new Promise(r => setTimeout(r, 1500))]); } catch (e) {}

  // ---------------------------------------------------------------- load
  const t0 = performance.now();
  const [META, W, PORT] = await Promise.all([
    fetch("model/meta.json").then(r => r.json()), fetch("model/weights.bin").then(r => r.arrayBuffer()), fetch("model/portraits.json").then(r => r.json())]);
  const EO = META.engine ? { NS: META.engine.ns, NOWN: META.engine.nown, SHORT: META.engine.short } : {};   // export v6+: the settings the notebook used
  const E = new BanEngine(META, W, EO), H = META.heroes.length, ORDER = META.ban_order, NAMES = META.heroes;
  const img = h => `img/heroes/${PORT[NAMES[h]]}.webp`, short = h => NAMES[h];
  const mapName = s => s.includes(" · ") ? s.replace(" · ", " (") + ")" : s;
  const MAPS = META.maps.map((m, i) => ({ i, name: mapName(m.name) })).sort((a, b) => a.name.localeCompare(b.name));
  const TIERS = Object.keys(META.tiers);

  // ---------------------------------------------------------------- state (mirrored in the URL hash, so a lobby can be shared)
  const st = { tier: "Grandmaster 3", map: MAPS.find(m => /Klyntar \(Dom/.test(m.name)) ? MAPS.find(m => /Klyntar \(Dom/.test(m.name)).i : 0,
               first: true, team: [-1, -1, -1, -1, -1, -1], bans: [], active: { kind: "team", i: 0 }, model: "value", runs: 16 };
  let MINE = []; try { MINE = JSON.parse(localStorage.getItem("bancall-mine") || "[]").filter(h => Number.isInteger(h)); } catch (e) {}
  const rememberMine = h => { MINE = [h].concat(MINE.filter(x => x !== h)).slice(0, 8); try { localStorage.setItem("bancall-mine", JSON.stringify(MINE)); } catch (e) {} };
  function readHash() {
    const q = new URLSearchParams(location.hash.slice(1)); if (!q.has("m")) return;
    if (q.get("t") && META.tiers[q.get("t")]) st.tier = q.get("t");
    st.map = Math.max(0, Math.min(META.maps.length - 1, +q.get("m") || 0)); st.first = q.get("f") !== "0"; st.model = q.get("x") === "1" ? "sim" : "value"; st.runs = [16, 32, 64, 128, 256].includes(+q.get("n")) ? +q.get("n") : 16;
    const tm = (q.get("u") || "").split(",").map(x => (x === "" || x === "-") ? -1 : +x); for (let i = 0; i < 6; i++) st.team[i] = Number.isInteger(tm[i]) && tm[i] >= 0 && tm[i] < H ? tm[i] : -1;
    st.bans = (q.get("b") || "").split(",").filter(x => x !== "").map(Number).filter(h => h >= 0 && h < H).slice(0, 6);
    st.active = st.team[0] < 0 ? { kind: "team", i: 0 } : { kind: "ban" };
  }
  function writeHash() {
    const q = new URLSearchParams({ t: st.tier, m: st.map, f: st.first ? 1 : 0, x: st.model === "sim" ? 1 : 0, n: st.runs, u: st.team.map(h => h < 0 ? "-" : h).join(","), b: st.bans.join(",") });
    lastHash = "#" + q.toString(); history.replaceState(null, "", lastHash);
  }
  let lastHash = "";
  readHash();
  if (!location.hash && MINE.length && MINE[0] < NAMES.length) { st.team[0] = MINE[0]; st.active = { kind: "ban" }; }
  window.addEventListener("hashchange", () => {                  // a pasted or edited link in an open tab
    if (location.hash === lastHash) return;
    st.team = [-1, -1, -1, -1, -1, -1]; st.bans = []; readHash();
    $("tierSel").value = st.tier; $("mapSel").value = String(st.map); update();
  });
  const ours = i => (ORDER[i] === 0) === st.first;
  const nextBan = () => st.bans.length;
  const ourTurn = () => nextBan() < 6 && ours(nextBan());
  const turnCount = () => { const e = nextBan(); return (e + 1 < 6 && ours(e) && ours(e + 1)) ? 2 : 1; };
  const bannedSet = () => new Set(st.bans);
  const teamSet = () => new Set(st.team.filter(h => h >= 0));

  // ---------------------------------------------------------------- controls
  $("tierSel").innerHTML = TIERS.map(t => `<option${t === st.tier ? " selected" : ""}>${esc(t)}</option>`).join("");
  $("mapSel").innerHTML = MAPS.map(m => `<option value="${m.i}"${m.i === st.map ? " selected" : ""}>${esc(m.name)}</option>`).join("");
  $("tierSel").onchange = e => { st.tier = e.target.value; update(); };
  $("mapSel").onchange = e => { st.map = +e.target.value; update(); };
  $("firstBtn").onclick = () => { st.first = true; update(); };
  $("valueBtn").onclick = () => { st.model = "value"; update(); };
  $("simBtn").onclick = () => { st.model = "sim"; update(); };
  document.querySelectorAll("#runsCtl button").forEach(b => b.onclick = () => { st.runs = +b.dataset.n; update(); });
  $("secondBtn").onclick = () => { st.first = false; update(); };
  $("undoBtn").onclick = () => { if (st.bans.length) { st.bans.pop(); st.active = { kind: "ban" }; update(); } };
  $("newBtn").onclick = () => newLobby();
  $("resetBtn").onclick = () => { st.team = [-1, -1, -1, -1, -1, -1]; st.bans = []; st.active = { kind: "team", i: 0 }; $("search").value = ""; update(); };
  $("linkBtn").onclick = () => { writeHash(); navigator.clipboard && navigator.clipboard.writeText(location.href); $("linkBtn").textContent = "Link copied"; setTimeout(() => $("linkBtn").textContent = "Copy link", 1400); };
  const themeNow = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const setThemeLabel = () => $("themeBtn").textContent = themeNow() === "dark" ? "Light" : "Dark";
  $("chartsBtn").onclick = () => { setView("charts"); if (RES) renderAdvice(); };
  $("termBtn").onclick = () => { setView("term"); if (RES) renderAdvice(); };
  $("themeBtn").onclick = () => { document.documentElement.dataset.theme = themeNow() === "dark" ? "light" : "dark"; try { localStorage.setItem("bancall-theme", document.documentElement.dataset.theme); } catch (e) {} setThemeLabel(); };
  try { const t = localStorage.getItem("bancall-theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
  setThemeLabel();

  // ---------------------------------------------------------------- putting a hero somewhere
  function place(h) {
    if (h < 0) return;
    const a = st.active;
    if (a.kind === "team") {
      if (st.bans.includes(h)) return flash(`${NAMES[h]} is banned`);
      for (let i = 0; i < 6; i++) if (st.team[i] === h) st.team[i] = -1;
      st.team[a.i] = h; if (a.i === 0) rememberMine(h);
      const nxt = a.i === 0 ? -1 : st.team.findIndex((x, i) => x < 0 && i > a.i);   // your hero: on to the bans; a teammate: the next empty teammate slot
      st.active = nxt >= 0 ? { kind: "team", i: nxt } : { kind: "ban" };
    } else {
      if (nextBan() >= 6 || st.bans.includes(h)) return;
      for (let i = 0; i < 6; i++) if (st.team[i] === h) st.team[i] = -1;    // a banned hover is gone
      st.bans.push(h);
    }
    $("search").value = ""; renderMatches(); update();
    if (matchMedia("(pointer: fine)").matches) $("search").focus({ preventScroll: true });   // keep typing the next name
  }
  // one-click picks under the ban track: their likeliest next bans on their turn, our best bans on ours (keys 1-8)
  function quickList() {
    if (st.active.kind === "team") {                                 // filling your team: your usual heroes, or what your team is likely to play
      const bans = bannedSet(), team = teamSet(), ok = h => !bans.has(h) && !team.has(h);
      if (st.active.i === 0) {
        const pop = popularity(), seen = new Set(), out = [];
        for (const h of MINE.concat(Array.from(pop.keys()).sort((a, b) => pop[b] - pop[a]))) if (h < H && ok(h) && !seen.has(h) && out.length < 8) { seen.add(h); out.push({ h, lab: MINE.includes(h) ? "yours" : pct(pop[h]) }); }
        return out;
      }
      return RES ? Array.from(RES.Pu.keys()).filter(ok).sort((a, b) => RES.Pu[b] - RES.Pu[a]).slice(0, 8).map(h => ({ h, lab: pct(RES.Pu[h]) })) : [];
    }
    if (nextBan() >= 6) return [];
    if (ourTurn()) { const V = st.model === "sim" ? (SIM && !SIM.prelim ? SIM.V : null) : RES && RES.V; return V ? topBans(8).map(h => ({ h, lab: pp(V[h]) })) : []; }
    return THEIRS ? Array.from(THEIRS.keys()).filter(h => THEIRS[h] > 0).sort((a, b) => THEIRS[b] - THEIRS[a]).slice(0, 8).map(h => ({ h, lab: pct(THEIRS[h]) })) : [];
  }
  const quickSide = () => st.active.kind === "team" || ourTurn() ? "us" : "them";
  function renderQuick() {                                           // shown under the slots it fills: your team, or the ban track
    const q = quickList(), teamMode = st.active.kind === "team";
    const lab = teamMode ? (st.active.i === 0 ? "Your hero" : `Mate ${st.active.i + 1}: likely`) : ourTurn() ? "Best bans" : "Their likely ban";
    const html = q.length ? `<span class="qlab">${lab}</span>` + q.map((x, k) =>
      `<button class="qt ${quickSide()}" data-h="${x.h}" title="${esc(NAMES[x.h])} (key ${k + 1})"><span class="qk">${k + 1}</span><img src="${img(x.h)}" alt=""><span class="qv">${x.lab}</span></button>`).join("") : "";
    $("quickTeam").innerHTML = teamMode ? html : ""; $("quick").innerHTML = teamMode ? "" : html;
    document.querySelectorAll("#quick .qt, #quickTeam .qt").forEach(el => el.onclick = () => place(+el.dataset.h));
  }
  const quickPick = k => { const q = quickList()[k - 1]; if (q) { place(q.h); return true; } return false; };
  function newLobby() {                                             // the next game: bans and teammates cleared, rank and your hero kept
    st.bans = []; for (let i = 1; i < 6; i++) st.team[i] = -1; st.active = st.team[0] < 0 ? { kind: "team", i: 0 } : { kind: "ban" };
    $("search").value = ""; renderMatches(); update();
  }
  let flashT; function flash(msg) { $("turnHint").textContent = msg; clearTimeout(flashT); flashT = setTimeout(renderTurnHint, 1600); }

  // ---------------------------------------------------------------- lobby rendering
  let RES = null, THEIRS = null;
  function renderTeam() {
    $("teamSlots").innerHTML = st.team.map((h, i) => {
      const act = st.active.kind === "team" && st.active.i === i;
      return `<div class="slot${h < 0 ? " empty" : ""}${act ? " active" : ""}" data-i="${i}" title="${h < 0 ? "click, then pick a hero" : esc(NAMES[h]) + ": click to change"}">
        <div class="pic">${h < 0 ? "+" : `<img src="${img(h)}" alt="${esc(NAMES[h])}"><span class="x" data-clear="${i}">✕</span>`}</div>
        <div class="lab">${i === 0 ? "You" : "Mate " + (i + 1)}</div><div class="lab">${h >= 0 ? esc(short(h)) : "&nbsp;"}</div></div>`;
    }).join("");
    $("teamSlots").querySelectorAll(".slot").forEach(el => el.onclick = ev => {
      const i = +el.dataset.i;
      if (ev.target.dataset.clear !== undefined) { st.team[i] = -1; st.active = { kind: "team", i }; }
      else st.active = { kind: "team", i };
      update(false);
    });
  }
  const top2 = P => Array.from(P.keys()).sort((a, b) => P[b] - P[a]).slice(0, 2).map(h => ({ h, p: P[h] }));
  function renderBans() {
    const e = nextBan(), cnt = turnCount();
    const sug = ourTurn() && RES ? suggested(cnt) : [];
    $("banSlots").innerHTML = [0, 1, 2, 3, 4, 5].map(i => {
      const h = st.bans[i], side = ours(i) ? "us" : "them", isNext = i === e && st.active.kind === "ban";
      const sg = h === undefined && i >= e && i < e + sug.length && ours(i) ? sug[i - e] : undefined, s = sg ? sg.h : undefined, wait = sg === null;
      const f = h === undefined && !ours(i) && FC && FC.top[i] && FC.top[i].length ? FC.top[i] : null;   // their likeliest ban in this box, given their earlier boxes as shown
      const pic = h !== undefined ? `<img src="${img(h)}" alt="${esc(NAMES[h])}"><span class="x">✕</span>`
                : s !== undefined ? `<img src="${img(s)}" alt="suggested ${esc(NAMES[s])}">`
                : f ? `<img src="${img(f[0].h)}" alt="" style="opacity:.4">` : wait ? "…" : (i + 1);
      const lab = h !== undefined ? esc(short(h)) : s !== undefined ? `<i>${esc(short(s))}?</i>` : wait ? `<span class="alt">scoring pairs</span>`
                : f ? `<span class="pct">${pct(f[0].p)}</span> ${esc(NAMES[f[0].h])}` : "";
      return `<div class="slot ${side}${h === undefined ? " empty" : ""}${isNext ? " active" : ""}${s !== undefined ? " sug" : ""}${f ? " fc" : ""}" data-i="${i}"
        title="${h !== undefined ? "click to undo this ban and the ones after it" : s !== undefined ? "click to ban " + esc(NAMES[s])
          : f ? (i === e ? `their likeliest ban here. Click if they banned ${esc(NAMES[f[0].h])}` : "their likeliest ban here if their earlier boxes go as shown") : "click, then pick the banned hero"}">
        <div class="who">${i + 1} ${side}</div><div class="pic">${pic}</div><div class="lab">${lab || "&nbsp;"}</div></div>`;
    }).join("");
    $("banSlots").querySelectorAll(".slot").forEach(el => el.onclick = () => banClick(+el.dataset.i, el.classList));
    renderQuick(); $("undoBtn").disabled = !st.bans.length;
  }
  function banClick(i, cls) {                         // a ban box (picture or text lobby): undo, take the suggestion or forecast, or make it the target
    if (i < st.bans.length) { st.bans = st.bans.slice(0, i); st.active = { kind: "ban" }; }
    else if (cls.contains("sug")) { const s = suggested(turnCount())[i - nextBan()]; st.active = { kind: "ban" }; if (i === nextBan() && s) return place(s.h); }
    else if (cls.contains("fc") && i === nextBan()) { st.active = { kind: "ban" }; return place((THEIRS ? top2(THEIRS) : FC.top[i])[0].h); }
    else st.active = { kind: "ban" };
    update();
  }
  function renderTurnHint() {
    const e = nextBan(), a = st.active;
    const dest = a.kind === "team" ? `<b>${a.i === 0 ? "You" : "Mate " + (a.i + 1)}</b>`
               : e < 6 ? `<b>ban #${e + 1}</b> (${ours(e) ? "us" : "them"})` : "nowhere";
    $("target").innerHTML = ""; $("turnHint").innerHTML = e >= 6 ? "Ban phase complete." : "";
  }
  // hero order in the roster: how often each hero is opened at the selected rank (the lineup model with no bans and nothing
  // shown, averaged over maps and sides), computed once per rank so the order stays put while you click
  const POPC = new Map();
  function popularity() {
    const key = st.tier; if (POPC.has(key)) return POPC.get(key);
    const rf = E.rankFeat(META.tiers[st.tier]), p = new Float64Array(H); let n = 0;
    for (let m = 0; m < META.maps.length; m++) for (const side of [0, 1]) {
      const x = E.features([], [], [], m, rf, side, 0);
      for (const net of E.nets) { const P = E.netProb(net, x); for (let h = 0; h < H; h++) p[h] += P[h]; n++; }
    }
    for (let h = 0; h < H; h++) p[h] /= n; POPC.set(key, p); return p;
  }
  let SORT = "pop"; try { if (localStorage.getItem("bancall-sort") === "az") SORT = "az"; } catch (e) {}
  const heroOrder = hs => { if (SORT === "az") return hs.sort((a, b) => NAMES[a].localeCompare(NAMES[b])); const p = popularity(); return hs.sort((a, b) => p[b] - p[a] || NAMES[a].localeCompare(NAMES[b])); };
  const setSort = v => { SORT = v; try { localStorage.setItem("bancall-sort", v); } catch (e) {} $("sortPop").classList.toggle("on", v === "pop"); $("sortAz").classList.toggle("on", v === "az"); };
  $("sortPop").onclick = () => { setSort("pop"); renderRoster(); }; $("sortAz").onclick = () => { setSort("az"); renderRoster(); };
  setSort(SORT);
  function renderRoster() {
    const q = $("search").value.split(",").pop().trim().toLowerCase(), bans = bannedSet(), team = teamSet();
    const rank = new Map(); quickList().forEach((x, k) => rank.set(x.h, k + 1));    // the same numbers as the quick picks and keys 1-8
    const rkc = quickSide() === "us" ? "rk us" : "rk them";
    $("roster").innerHTML = [0, 1, 2].map(r => {
      const hs = heroOrder(NAMES.map((n, h) => h).filter(h => META.roles[h] === r));
      return `<h3>${ROLE_NAMES[r]}</h3><div class="grid">` + hs.map(h => {
        const cls = ["tile"]; if (bans.has(h)) cls.push("banned"); if (team.has(h)) cls.push("ours");
        if (q && !NAMES[h].toLowerCase().includes(q) && !(SHORT[NAMES[h]] || "").toLowerCase().includes(q)) cls.push("dim");
        return `<div class="${cls.join(" ")}" data-h="${h}" title="${esc(NAMES[h])}">${rank.has(h) ? `<span class="${rkc}">${rank.get(h)}</span>` : ""}<img src="${img(h)}" alt="" loading="lazy"><span class="nm">${esc(short(h))}</span></div>`;
      }).join("") + "</div>";
    }).join("");
    $("roster").querySelectorAll(".tile").forEach(el => el.onclick = () => { if (!el.classList.contains("banned")) place(+el.dataset.h); });
    if (typeof VIEW !== "undefined" && VIEW === "term") renderLobbyTerm();
  }
  const searchMatches = () => { const q = $("search").value.split(",").pop().trim().toLowerCase(); if (!q) return [];   // the name being typed
    const b = bannedSet(); return NAMES.map((n, h) => h).filter(h => !b.has(h) && (NAMES[h].toLowerCase().includes(q) || (SHORT[NAMES[h]] || "").toLowerCase().includes(q)))
      .sort((a, b2) => ((NAMES[a].toLowerCase().startsWith(q) ? 0 : 1) - (NAMES[b2].toLowerCase().startsWith(q) ? 0 : 1)) || NAMES[a].length - NAMES[b2].length); };
  function renderMatches() {
    const m = searchMatches().slice(0, 4);
    $("matches").innerHTML = m.length ? "Enter: " + m.map((h, k) => `<a href="#" data-h="${h}"${k ? "" : " style=\"font-weight:600\""}>${esc(NAMES[h])}</a>`).join(", ") : "";
    $("matches").querySelectorAll("a").forEach(el => el.onclick = ev => { ev.preventDefault(); place(+el.dataset.h); });
  }
  $("search").oninput = () => { renderRoster(); renderMatches(); };
  $("search").onkeydown = ev => {
    if (ev.key === "Enter") {
      const parts = $("search").value.split(",").map(x => x.trim()).filter(Boolean);
      if (parts.length > 1) {                                        // several names: team slots in order if a team slot is highlighted, else bans in order
        const team = st.active.kind === "team"; let i = team ? st.active.i : 0;
        for (const q of parts) {
          if (team) { while (i < 6 && st.team[i] >= 0 && i !== st.active.i) i++; if (i >= 6) break; st.active = { kind: "team", i }; }
          $("search").value = q; const m = searchMatches(); if (m.length) place(m[0]); if (team) i++;
        }
        if (team) st.active = { kind: "ban" }; $("search").value = ""; renderMatches(); update(false); }
      else { const m = searchMatches(); if (m.length) place(m[0]); }
      ev.preventDefault(); }
    else if (/^[1-8]$/.test(ev.key) && !$("search").value) { quickPick(+ev.key); ev.preventDefault(); }
    else if (ev.key === "Backspace" && !$("search").value && st.bans.length) { st.bans.pop(); update(); ev.preventDefault(); }
    else if (ev.key === "Escape") { $("search").value = ""; renderRoster(); }
  };
  document.addEventListener("keydown", ev => {
    if (ev.target.tagName === "INPUT" || ev.target.tagName === "SELECT" || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === "/") { $("search").focus(); ev.preventDefault(); }
    else if (/^[1-8]$/.test(ev.key)) { quickPick(+ev.key); ev.preventDefault(); }
    else if (ev.key.length === 1 && /[a-z&]/i.test(ev.key)) { $("search").focus(); }
    else if (ev.key === "Backspace" && st.bans.length) { st.bans.pop(); update(); ev.preventDefault(); }
  });

  // ---------------------------------------------------------------- figures (inline SVG, drawn from the model output)
  // ---------------------------------------------------------------- their bans: a forecast for each remaining box, and the ban model's reasons
  let FC = null;
  function forecastChain(s) {                       // their likeliest ban in each of their boxes, given that their earlier boxes went as shown (engine rollouts)
    const e = s.bans.length, top = [], fix = [];
    for (let i = e; i < 6; i++) {
      if (ours(i)) continue;
      const L = i === e && THEIRS ? top2(THEIRS) : E.forecast(RES, fix)[i];
      top[i] = L; if (L && L.length) fix[i] = L[0].h;
    }
    return { top };
  }
  function whySplit(s, P) {                            // the ban model's utility for their next ban, split into its terms, against an average legal hero
    const B = META.ban, C = META.C, e = s.bans.length, bd = E.band(s.r0), m = s.m, BU = new Uint8Array(H), BT = new Uint8Array(H);
    s.bans.forEach((h, i) => (ours(i) ? BU : BT)[h] = 1);
    const parts = h => { let cr = 0, ro = 0; for (let j = 0; j < H; j++) cr += C[h][j] * RES.Pt[j]; for (let i = 0; i < H; i++) { if (BT[i]) ro += B.Ro[i][h]; if (BU[i]) ro += B.Rt[i][h]; }
      return [B.a[h] + B.am[m][h] + B.ab[bd][h] + B.ae[e][h], -B.lam * RES.Pt[h], B.gam * cr, ro]; };
    const legal = []; for (let h = 0; h < H; h++) if (!BU[h] && !BT[h]) legal.push(h);
    const all = legal.map(parts), mean = [0, 1, 2, 3].map(k => all.reduce((a, p) => a + p[k], 0) / all.length);
    const rs = Array.from(P.keys()).sort((a, b) => P[b] - P[a]).slice(0, 8).map(h => ({ h, c: parts(h).map((v, k) => v - mean[k]) }));
    const sum = (r, sg) => r.c.filter(v => sg * v > 0).reduce((a, b) => a + b, 0), lo = Math.min(0, ...rs.map(r => sum(r, -1))), hi = Math.max(...rs.map(r => sum(r, 1)));
    const key = [["popular on this map and rank", "them", 1], ["they protect it", "faint", .7], ["it beats what they play", "them", .5], ["reaction to the bans so far", "us", .6]];
    const Lw = labW(rs.map(r => NAMES[r.h]), 11.5) + 10, val = Math.ceil(tw("100%", 10.5)) + 8, rowH = 19, X = v => Lw + (v - lo) / (hi - lo || 1) * 320;
    let g = rs.map((r, k) => { let p = 0, n = 0; const segs = r.c.map((v, j) => { const a = v >= 0 ? p : n; if (v >= 0) p += v; else n += v;
        return `<rect x="${X(Math.min(a, a + v))}" y="0" width="${Math.abs(X(a + v) - X(a))}" height="11" class="${key[j][1]}" opacity="${key[j][2]}"/>`; }).join("");
      return `<g transform="translate(0 ${k * rowH + 4})"><text x="${Lw - 6}" y="10" font-size="11.5" text-anchor="end">${esc(NAMES[r.h])}</text>${segs}<text x="${X(p) + 4}" y="10" font-size="10.5" class="faint">${pct(P[r.h])}</text></g>`; }).join("");
    let kx = Lw; const ly = rs.length * rowH + 24;
    g += `<line class="axis" x1="${X(0)}" x2="${X(0)}" y1="0" y2="${rs.length * rowH + 4}"/>` + key.map(([t, c, o]) => { const q = `<rect x="${kx}" y="${ly - 9}" width="10" height="10" class="${c}" opacity="${o}"/><text x="${kx + 14}" y="${ly}" font-size="11">${t}</text>`; kx += 26 + tw(t, 11); return q; }).join("");
    const Wd = Math.max(Lw + 320 + val, kx + 10);
    return `<svg viewBox="0 0 ${Wd} ${rs.length * rowH + 32}" width="${Wd}">${g}</svg>`;
  }
  function rankTable(top, V, se, cols, cap) {        // the ranking: one row per ban, with its 95% interval drawn in the row
    const lo = Math.min(0, ...top.map(h => V[h] - 1.96 * se[h])), hi = Math.max(0, ...top.map(h => V[h] + 1.96 * se[h])), CW = 200, X = v => 17 + (v - lo) / (hi - lo || 1) * (CW - 34);
    const step = niceStep(hi - lo, 3); let ticks = "";
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-12; t += step) ticks += `<text x="${X(t)}" y="10" font-size="10" text-anchor="middle" class="faint">${pp(t, step < .005 ? 2 : 1)}</text>`;
    const cell = h => { const neg = V[h] < 0;
      return `<svg width="${CW}" height="16" viewBox="0 0 ${CW} 16" style="display:inline-block;vertical-align:middle"><line class="grid" x1="${X(0)}" x2="${X(0)}" y1="0" y2="16"/>
        <line class="whisk" x1="${X(V[h] - 1.96 * se[h])}" x2="${X(V[h] + 1.96 * se[h])}" y1="8" y2="8"/><circle cx="${X(V[h])}" cy="8" r="3.6" class="${neg ? "them" : "us"}"/></svg>`; };
    return `<div style="overflow-x:auto"><table style="width:100%"><caption>${cap}</caption>
      <tr><th>#</th><th></th><th>Ban</th><th class="r">Value</th><th><svg width="${CW}" height="13" viewBox="0 0 ${CW} 13" style="display:block">${ticks}</svg></th>${cols.map(c => `<th${c.r === false ? "" : ' class="r"'}>${c.th}</th>`).join("")}</tr>` +
      top.map((h, k) => `<tr class="pick" data-h="${h}" title="${esc(NAMES[h])}: ${pp(V[h])} ± ${(196 * se[h]).toFixed(2)} points. Click to ban."><td class="num">${k + 1}</td><td><img class="mini" src="${img(h)}" alt=""></td>
        <td class="nmc">${esc(NAMES[h])}</td><td class="r">${pp(V[h])}</td><td>${cell(h)}</td>${cols.map(c => `<td${c.r === false ? "" : ' class="r"'}>${c.td(h)}</td>`).join("")}</tr>`).join("") + `</table></div>`;
  }
  function butterfly(them, us, P1, P2, shown) {       // one shared hero list, the other team to the left and yours to the right
    const hs = Array.from(new Set(them.concat(us))).sort((a, b) => Math.max(P1[b], shown.has(b) ? 0 : P2[b]) - Math.max(P1[a], shown.has(a) ? 0 : P2[a])).slice(0, 14);
    const Lw = labW(hs.map(h => NAMES[h]), 11) + 12, half = 140, pad = Math.ceil(tw("100%", 10.5)) + 8, W = 2 * (half + pad) + Lw, rowH = 16, top = 18, hgt = top + hs.length * rowH + 4;
    const mx = Math.max(...hs.map(h => Math.max(P1[h], shown.has(h) ? 0 : P2[h]))), c0 = pad + half, c1 = c0 + Lw;
    return `<svg viewBox="0 0 ${W} ${hgt}" width="${W}"><text x="${c0}" y="11" font-size="11.5" font-weight="600" text-anchor="end" class="them">Other team</text><text x="${c1}" y="11" font-size="11.5" font-weight="600" class="us">Your team</text>` +
      hs.map((h, k) => { const y = top + k * rowH, a = P1[h] / mx * half, b = P2[h] / mx * half;
        return `<rect x="${c0 - a}" y="${y + 3}" width="${Math.max(.5, a)}" height="10" class="them"/><text x="${c0 - a - 4}" y="${y + 12}" font-size="10.5" text-anchor="end" class="faint">${pct(P1[h])}</text>
          <text x="${(c0 + c1) / 2}" y="${y + 12}" font-size="11" text-anchor="middle">${esc(NAMES[h])}</text>` +
          (shown.has(h) ? `<text x="${c1 + 2}" y="${y + 12}" font-size="10.5" class="faint">shown</text>`
                        : `<rect x="${c1}" y="${y + 3}" width="${Math.max(.5, b)}" height="10" class="us"/><text x="${c1 + b + 4}" y="${y + 12}" font-size="10.5" class="faint">${pct(P2[h])}</text>`); }).join("") + "</svg>";
  }
  function splitBars(top, R) {                         // each ban's value split into its parts
    const rows = top.map(h => { const l = 1 - R.PL[h]; return { h, d: l * R.Pt[h] * R.R[h], s: -l * R.Pu[h] * R.Rus[h], r: R.other[h] }; });
    const pos = r => Math.max(r.d, 0) + Math.max(r.s, 0) + Math.max(r.r, 0), neg = r => Math.min(r.d, 0) + Math.min(r.s, 0) + Math.min(r.r, 0);
    const lo = Math.min(0, ...rows.map(neg)), hi = Math.max(...rows.map(pos)), Lw = labW(rows.map(r => NAMES[r.h]), 11.5) + 10, val = Math.ceil(tw("+0.00", 10.5)) + 8, W = Lw + 330 + val, rowH = 19;
    const X = v => Lw + (v - lo) / (hi - lo || 1) * 330, hgt = rows.length * rowH + 42;
    const seg = (a, v, cls, op) => `<rect x="${X(Math.min(a, a + v))}" y="0" width="${Math.abs(X(a + v) - X(a))}" height="11" class="${cls}" opacity="${op}"/>`;
    let g = rows.map((r, k) => { let p = 0, n = 0; const parts = [];
      for (const [v, cls, op] of [[r.d, "us", 1], [r.r, "us", .45], [r.s, "them", .8]]) { if (v >= 0) { parts.push(seg(p, v, cls, op)); p += v; } else { parts.push(seg(n, v, cls, op)); n += v; } }
      return `<g transform="translate(0 ${k * rowH + 4})"><text x="${Lw - 6}" y="10" font-size="11.5" text-anchor="end">${esc(NAMES[r.h])}</text>${parts.join("")}<text x="${X(p) + 4}" y="10" font-size="10.5" class="faint">${pp(R.V[r.h])}</text></g>`; }).join("");
    const ly = rows.length * rowH + 24, key = [["denies them", "us", 1], ["the rest of the ban phase", "us", .45], ["effect on your team", "them", .8]]; let kx = Lw;
    g += `<line class="axis" x1="${X(0)}" x2="${X(0)}" y1="0" y2="${rows.length * rowH + 4}"/>` + key.map(([t, c, o]) => { const s = `<rect x="${kx}" y="${ly - 9}" width="10" height="10" class="${c}" opacity="${o}"/><text x="${kx + 14}" y="${ly}" font-size="11">${t}</text>`; kx += 26 + tw(t, 11); return s; }).join("");
    return `<svg viewBox="0 0 ${W} ${hgt}" width="${W}">${g}</svg>`;
  }
  function probChart(rows, cls, W = 290) {             // rows: {h, p}
    const L = labW(rows.map(r => NAMES[r.h]), 11) + 7, R = Math.ceil(tw("100%", 10.5)) + 8; W = Math.max(W, L + R + 150); const rowH = 16, hgt = rows.length * rowH + 4, mx = Math.max(.05, ...rows.map(r => r.p));
    return `<svg viewBox="0 0 ${W} ${hgt}" width="${W}">` + rows.map((r, k) => {
      const y = k * rowH, w = r.p / mx * (W - L - R);
      return `<text x="${L - 5}" y="${y + 12}" font-size="11" text-anchor="end">${esc(short(r.h))}</text><rect x="${L}" y="${y + 3}" width="${w}" height="10" class="${cls}"/>
        <text x="${L + w + 4}" y="${y + 12}" font-size="10.5" class="faint">${pct(r.p)}</text>`;
    }).join("") + "</svg>";
  }
  function shiftChart(rows, cls) {                     // rows: {h, d}; change in the share of simulated drafts with each hero
    const L = labW(rows.map(r => NAMES[r.h]), 11) + 7, lab = Math.ceil(tw("−00", 10.5)) + 6, plot = 170, W = L + plot + 2 * lab, rowH = 16, hgt = rows.length * rowH + 4;
    const mx = Math.max(.02, ...rows.map(r => Math.abs(r.d))), c = L + lab + plot / 2, X = d => c + d / mx * plot / 2;
    return `<svg viewBox="0 0 ${W} ${hgt}" width="${W}"><line class="axis" x1="${c}" x2="${c}" y1="0" y2="${hgt}"/>` + rows.map((r, k) => {
      const y = k * rowH, x0 = Math.min(c, X(r.d)), w = Math.abs(X(r.d) - c);
      return `<text x="${L - 5}" y="${y + 12}" font-size="11" text-anchor="end">${esc(NAMES[r.h])}</text><rect x="${x0}" y="${y + 3}" width="${Math.max(.5, w)}" height="10" class="${r.d >= 0 ? cls : "faint"}"/>
        <text x="${r.d >= 0 ? X(r.d) + 4 : X(r.d) - 4}" y="${y + 12}" font-size="10.5" class="faint" text-anchor="${r.d >= 0 ? "start" : "end"}">${(r.d >= 0 ? "+" : "−") + Math.abs(100 * r.d).toFixed(0)}</text>`;
    }).join("") + "</svg>";
  }
  const colFig = (svg, cap) => `<figure style="width:${+/width="(\d+(?:\.\d+)?)"/.exec(svg)[1]}px;max-width:100%">${svg}<figcaption>${cap}</figcaption></figure>`;
  function niceStep(span, n = 5) { const raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))); const f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }

  // ---------------------------------------------------------------- advice
  function suggested(cnt) {                          // our suggested ban(s) this turn; on a two-ban turn the best pair, scored jointly (null while the simulator scores pairs)
    const h1 = topBans(1)[0]; if (h1 === undefined) return [];
    const S1 = st.model === "sim" ? SIM : RES, one = { h: h1, V: S1.V[h1], se: S1.se[h1] };
    if (cnt < 2) return [one];
    const P = st.model === "sim" ? SIMP : RES.pairs;
    if (P === "failed") return [one];
    if (!P || !P.length) return [one, null];
    const p = P[0], ab = S1.V[p.a] >= S1.V[p.b] ? [p.a, p.b] : [p.b, p.a];
    return ab.map(h => ({ h, V: p.V, se: p.se, pair: p }));
  }
  let lastVerdict = "";
  function headline(sug, cnt, tail = "") {           // the verdict: what to ban, the estimate with its interval, and how it compares with the runner-up
    if (!sug.length) return "";
    const lo = x => x.V - 1.96 * x.se, hi = x => x.V + 1.96 * x.se, ci = null;
    const S1 = st.model === "sim" ? SIM : RES, P = st.model === "sim" ? SIMP : RES.pairs, pairs = cnt === 2 && sug[1];
    let runner = null, rname = "";
    if (pairs && Array.isArray(P) && P[1]) { runner = P[1]; rname = `${esc(NAMES[P[1].a])} and ${esc(NAMES[P[1].b])}`; }
    else if (!pairs) { const r = topBans(2)[1]; if (r !== undefined) { runner = { V: S1.V[r], se: S1.se[r] }; rname = esc(NAMES[r]); } }
    const x = sug[0], judge = !runner ? "" : lo(x) > hi(runner)
      ? `Clear of ${rname} (${pp(runner.V)})` : `Tied with ${rname} (${pp(runner.V)})`;
    const hs = pairs ? [sug[0].h, sug[1].h] : [x.h], key = hs.join("+") + st.model;
    const fresh = key !== lastVerdict; lastVerdict = key;
    const name = pairs ? `<span class="vname">${esc(NAMES[hs[0]])}</span> and <span class="vname">${esc(NAMES[hs[1]])}</span>`
                       : `<span class="vname">${esc(NAMES[x.h])}</span>`;
    const against = pairs ? "for the pair" : cnt === 2 ? "scoring pairs" : "";
    return `<div class="verdict${pairs ? " pair" : ""}${fresh ? " fresh" : ""}"><div class="vpics">${hs.map(h => `<img src="${img(h)}" alt="">`).join("")}</div>
      <div class="vtext"><div class="vcall">Ban ${name}</div>
        <div class="vest" title="Change in your team's win probability, in points, against ${pairs ? "two typical bans" : "a typical ban"}"><span class="vnum">${pp(x.V)}</span> points${against ? ` ${against}` : ""} <span class="vci">95% CI ${pp(lo(x))} to ${pp(hi(x))}</span></div>
        <div class="vjudge">${[judge, tail].filter(Boolean).join(". ")}</div></div></div>`;
  }
  function pairTable(P, nShort) {                     // two-ban turns: the best pairs, each scored as a pair
    return `<div style="overflow-x:auto"><table style="width:100%"><caption>Best pairs for this turn. The ${nShort} best single bans are paired every way and each pair is scored together, so heroes that replace each other are not
      counted twice. Value: change in your team's win probability, in points, against two typical bans. Click a row to ban both.</caption><tr><th>#</th><th>Pair</th><th class="r">Value</th><th class="r">95% interval</th></tr>` +
      P.slice(0, 8).map((p, k) => `<tr class="pickpair" data-a="${p.a}" data-b="${p.b}" title="Ban ${esc(NAMES[p.a])} and ${esc(NAMES[p.b])}"><td class="num">${k + 1}</td>
        <td><img class="mini" src="${img(p.a)}" alt=""><img class="mini" src="${img(p.b)}" alt=""> ${esc(NAMES[p.a])} + ${esc(NAMES[p.b])}</td>
        <td class="r">${pp(p.V)}</td><td class="r">± ${(196 * p.se).toFixed(2)}</td></tr>`).join("") + `</table></div>`;
  }
  function topBans(k) {
    if (st.model === "sim" && (!SIM || SIM.prelim)) return [];             // nothing from the simulator until every run is in
    const V = st.model === "sim" ? SIM.V : RES.V;
    return Array.from(V.keys()).filter(h => !isNaN(V[h])).sort((a, b) => V[b] - V[a]).slice(0, k);
  }
  // ---------------------------------------------------------------- terminal view: the same results as plain text, drawn with characters
  // the terminal view is hidden from the site for now: always start in the chart view (the code stays for later)
  let VIEW = "charts";
  const setView = v => { VIEW = v; document.documentElement.dataset.view = v; try { localStorage.setItem("bancall-view", v); } catch (e) {}
    $("chartsBtn").classList.toggle("on", v === "charts"); $("termBtn").classList.toggle("on", v === "term");
    if (RES) { renderRoster(); renderStatusBar(); } };
  const padR = (x, n) => { x = String(x); return x.length >= n ? x.slice(0, n) : x + " ".repeat(n - x.length); };
  const padL = (x, n) => { x = String(x); return x.length >= n ? x.slice(0, n) : " ".repeat(n - x.length) + x; };
  const bar = (f, n) => { const w = Math.max(0, f) * n, k = Math.floor(w), r = w - k; return "█".repeat(k) + (r > .66 ? "▊" : r > .33 ? "▌" : r > .05 ? "▎" : ""); };
  function axisRow(lo, hi, n) {                      // a scale for the interval column: ticks at nice values
    const step = niceStep(hi - lo, 3), X = v => Math.round((v - lo) / (hi - lo || 1) * (n - 1)); const row = Array(n).fill(" ");
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-12; t += step) { const lab = pp(t, step < .005 ? 2 : 1), x = Math.min(n - lab.length, Math.max(0, X(t) - (lab.length >> 1))); for (let i = 0; i < lab.length; i++) row[x + i] = lab[i]; }
    return row.join("");
  }
  function ciRow(v, s_, lo, hi, n) {                // one interval as characters: ├──●──┤ on a line with the zero marked
    const X = u => Math.max(0, Math.min(n - 1, Math.round((u - lo) / (hi - lo || 1) * (n - 1)))), row = Array(n).fill(" ");
    const z = X(0); row[z] = "┊"; const a = X(v - 1.96 * s_), b = X(v + 1.96 * s_);
    for (let i = a; i <= b; i++) row[i] = "─"; row[a] = "├"; row[b] = "┤"; row[X(v)] = "●";
    return row.join("");
  }
  const line = (txt, h, cls = "") => h === undefined ? `${txt}\n` : `<span class="tl${cls}" data-h="${h}">${txt}</span>\n`;
  function termRanking(top, V, se, extra) {         // the ranking: value, 95% interval as characters, and one extra column
    const n = 22, lo = Math.min(0, ...top.map(h => V[h] - 1.96 * se[h])), hi = Math.max(0, ...top.map(h => V[h] + 1.96 * se[h]));
    let o = line(`${padL("#", 2)} ${padR("ban", 21)} ${padL("value", 6)}  ${padR("95% interval", 16)}  ${axisRow(lo, hi, n)}  ${extra.th}`);
    top.forEach((h, k) => { o += line(esc(`${padL(k + 1, 2)} ${padR(NAMES[h], 21)} ${padL(pp(V[h]), 6)}  ${padR(`${pp(V[h] - 1.96 * se[h])} to ${pp(V[h] + 1.96 * se[h])}`, 16)}  ${ciRow(V[h], se[h], lo, hi, n)}  ${extra.td(h)}`), h, k === 0 ? " best" : ""); });
    return o;
  }
  function termBars(rows, title) {                  // label, percentage, bar
    const mx = Math.max(...rows.map(r => r.p), 1e-9); let o = title ? line(title) : "";
    rows.forEach(r => { o += line(esc(`  ${padR(NAMES[r.h], 22)} ${padL(pct(r.p), 4)}  ${bar(r.p / mx, 30)}`)); }); return o;
  }
  function termOpeners(them, us, P1, P2, shown) {   // back to back: their chance on the left, ours on the right
    const hs = Array.from(new Set(them.concat(us))).sort((a, b) => Math.max(P1[b], shown.has(b) ? 0 : P2[b]) - Math.max(P1[a], shown.has(a) ? 0 : P2[a])).slice(0, 12);
    const mx = Math.max(...hs.map(h => Math.max(P1[h], shown.has(h) ? 0 : P2[h]))), w = 20;
    let o = line(`${padL("other team", w + 5)}   ${padR("", 22)}   your team`);
    hs.forEach(h => { const l = bar(P1[h] / mx, w), r = shown.has(h) ? "shown" : `${bar(P2[h] / mx, w)} ${pct(P2[h])}`;
      o += line(esc(`${padL(pct(P1[h]), 4)} ${padL(l, w)}   ${padR(NAMES[h], 22)}   ${r}`)); }); return o;
  }
  const rule = t => `<span class="tsh">── ${t} ${"─".repeat(Math.max(3, 80 - t.length))}</span>\n`;   // section rule in characters
  const kv = (k, v) => `<span class="tp">${padR(k, 11)}</span>${v}\n`;
  function termAdvice() {
    const e = nextBan(), R = RES, sim = st.model === "sim"; let o = "";
    const prompt = t => `<span class="tp">$</span> ${t}\n\n`;
    if (e < 6 && ourTurn()) {
      const cnt = turnCount();
      o += prompt(`ban-call --rank "${esc(st.tier)}" --ban ${e + 1}${cnt === 2 ? `,${e + 2}` : ""} --model ${sim ? `simulator --runs ${st.runs}` : "value"}`);
      if (sim && (!SIM || SIM.prelim)) return `<pre class="term">${o}${line("simulating the rest of the ban phase for every legal ban")}</pre><div class="prog"><span id="simProg"></span></div><p class="small" id="simMsg"><span id="simCount"></span></p>`;
      const S = sim ? SIM : R, top = topBans(15), sug = suggested(cnt).filter(Boolean);
      if (sug.length) {
        const x = sug[0], names = cnt === 2 && sug[1] ? `${NAMES[sug[0].h]} + ${NAMES[sug[1].h]}` : NAMES[x.h];
        const r2 = topBans(2)[1], tied = r2 !== undefined && !(cnt === 2 && sug[1]) && x.V - 1.96 * x.se <= S.V[r2] + 1.96 * S.se[r2];
        o += rule("recommendation");
        o += kv("ban", `<span class="tv">${esc(names)}</span>`);
        o += kv("value", `${pp(x.V)} points of win probability, against ${cnt === 2 && sug[1] ? "two typical bans" : "a typical ban"}`);
        o += kv("95% ci", `${pp(x.V - 1.96 * x.se)} to ${pp(x.V + 1.96 * x.se)}`);
        if (r2 !== undefined && !(cnt === 2 && sug[1])) o += kv("vs next", `${esc(NAMES[r2])} ${pp(S.V[r2])}: ${tied ? "intervals overlap, close to tied" : "intervals do not overlap, clear pick"}`);
        if (sim) o += kv("baseline", `${(100 * S.base).toFixed(1)}% win chance after a typical ban`);
        o += "\n";
      }
      const Pp = sim ? SIMP : R.pairs;
      if (cnt === 2 && Array.isArray(Pp)) { o += rule("best pairs, scored together"); Pp.slice(0, 5).forEach((p, k) => { o += `<span class="tl tp2" data-a="${p.a}" data-b="${p.b}">${esc(`${padL(k + 1, 3)}  ${padR(`${NAMES[p.a]} + ${NAMES[p.b]}`, 40)} ${padL(pp(p.V), 6)}  ± ${(196 * p.se).toFixed(2)}`)}</span>\n`; }); o += "\n"; }
      o += rule("all bans, value and 95% interval   (press 1-9 or click a row to ban)") + termRanking(top, S.V, S.se, sim ? { th: "they switch to", td: h => { let b = -1, bv = 0; for (let y = 0; y < H; y++) { if (y === h) continue; const d = S.co[h][y] - S.baseCo[y]; if (d > bv) { bv = d; b = y; } } return b < 0 ? "" : `${NAMES[b]} +${(100 * bv).toFixed(0)}`; } }
                                                        : { th: "they open", td: h => padL(pct(R.Pt[h]), 4) });
      o += "\n";
    } else if (e < 6) {
      const top = Array.from(THEIRS.keys()).filter(h => THEIRS[h] > 0).sort((a, b) => THEIRS[b] - THEIRS[a]).slice(0, 10);
      o += prompt(`ban-call --their-ban ${e + 1}`);
      o += rule("their next ban") + kv("likeliest", `<span class="tv">${esc(NAMES[top[0]])}</span>  ${pct(THEIRS[top[0]])}`) + "\n";
      o += termBars(top.map(h => ({ h, p: THEIRS[h] })), "") + "\n";
    } else o += prompt("ban-call --done") + line("all six bans are in\n");
    const bans = bannedSet(), revs = teamSet();
    const them = Array.from(R.Pt.keys()).filter(h => !bans.has(h)).sort((a, b) => R.Pt[b] - R.Pt[a]).slice(0, 10);
    const us = Array.from(R.Pu.keys()).filter(h => !bans.has(h) && !revs.has(h)).sort((a, b) => R.Pu[b] - R.Pu[a]).slice(0, 10);
    o += rule("likely openers") + termOpeners(them, us, R.Pt, R.Pu, revs);
    return `<pre class="term">${o}</pre>`;
  }
  function renderLobbyTerm() {                       // the lobby as text: slots as rows, the ban track as a list, heroes in three role columns
    const e = nextBan(), cnt = turnCount(), sug = ourTurn() && RES ? suggested(cnt) : [], bans = bannedSet(), team = teamSet();
    const q = $("search").value.trim().toLowerCase(), rank = new Map(); quickList().forEach((x, k) => rank.set(x.h, k + 1));
    let t = `<div class="tsec">team <span class="tdim">click a row, then a hero</span></div>`;
    st.team.forEach((h, i) => { const act = st.active.kind === "team" && st.active.i === i;
      t += `<div class="trow${act ? " sel" : ""}" data-team="${i}">${act ? "&gt;" : " "} ${padR(i === 0 ? "you" : "mate " + (i + 1), 8)} ${h >= 0 ? esc(NAMES[h]) : '<span class="tdim">_</span>'}${h >= 0 ? ` <span class="tx" data-clear="${i}">[x]</span>` : ""}</div>`; });
    t += `<div class="tsec">ban phase <span class="tdim">${e >= 6 ? "complete" : `next: ban ${e + 1} (${ours(e) ? "us" : "them"})`}</span></div>`;
    for (let i = 0; i < 6; i++) {
      const h = st.bans[i], side = ours(i) ? "us" : "them", isNext = i === e && st.active.kind === "ban";
      const sg = h === undefined && i >= e && i < e + sug.length && ours(i) ? sug[i - e] : undefined, s_ = sg ? sg.h : undefined;
      const f = h === undefined && !ours(i) && FC && FC.top[i] && FC.top[i].length ? (i === e && THEIRS ? top2(THEIRS) : FC.top[i]) : null;
      const body = h !== undefined ? esc(NAMES[h]) : s_ !== undefined ? `${esc(NAMES[s_])}? <span class="tdim">suggested</span>`
                 : f ? `<span class="tdim">${esc(NAMES[f[0].h])}? ${pct(f[0].p)}${f[1] ? `, then ${esc(NAMES[f[1].h])} ${pct(f[1].p)}` : ""}</span>` : '<span class="tdim">_</span>';
      t += `<div class="trow ban ${side}${isNext ? " sel" : ""}${s_ !== undefined ? " sug" : ""}${f ? " fc" : ""}" data-ban="${i}">${isNext ? "&gt;" : " "} ${i + 1} ${padR(side, 5)} ${body}</div>`;
    }
    $("lobbyTerm").innerHTML = t;
    let r = `<div class="tcols">`;
    [0, 1, 2].forEach(k => {
      const hs = heroOrder(NAMES.map((n, h) => h).filter(h => META.roles[h] === k));
      r += `<div><div class="tsec">${ROLE_NAMES[k].toLowerCase()}</div>` + hs.map(h => {
        const b = bans.has(h), o = team.has(h), dim = q && !NAMES[h].toLowerCase().includes(q) && !(SHORT[NAMES[h]] || "").toLowerCase().includes(q);
        return `<div class="thero${b ? " banned" : ""}${o ? " ours" : ""}${dim ? " dim" : ""}" data-h="${h}">${rank.has(h) ? rank.get(h) : b ? "x" : o ? "*" : " "} ${esc(NAMES[h])}</div>`;
      }).join("") + `</div>`;
    });
    $("rosterTerm").innerHTML = r + `</div>`;
    $("lobbyTerm").querySelectorAll("[data-team]").forEach(el => el.onclick = ev => {
      const i = +el.dataset.team; if (ev.target.dataset.clear !== undefined) st.team[i] = -1;
      st.active = { kind: "team", i }; update(ev.target.dataset.clear !== undefined); });
    $("lobbyTerm").querySelectorAll("[data-ban]").forEach(el => el.onclick = () => banClick(+el.dataset.ban, el.classList));
    $("rosterTerm").querySelectorAll(".thero").forEach(el => el.onclick = () => { if (!el.classList.contains("banned")) place(+el.dataset.h); });
  }
  function renderStatusBar() {                       // the terminal view's bottom line: state on the left, keys on the right
    const busy = $("mainEl").classList.contains("busy") ? $("busy").textContent : "ready";
    $("statusbar").innerHTML = `<span><b>ban-call</b>  ${esc(st.tier)}  ${esc(MAPS.find(m => m.i === st.map).name)}  ${st.first ? "we ban first" : "we ban second"}  ${st.model === "sim" ? `simulator ${st.runs} runs` : "value model"}  <span class="tdim">${esc(busy)}</span></span>
      <span class="tkeys"><b>1-9</b> ban row  <b>/</b> search  <b>enter</b> pick  <b>backspace</b> undo  <b>esc</b> clear</span>`;
  }
  // notes stay one click away: every caption, and the column definitions, collapse behind "How to read this"
  const quiet = html => html
    .replace(/<(figcaption|caption)>([\s\S]*?)<\/\1>/g, (m, t, x) => `<${t}><details class="more"><summary>How to read this</summary>${x}</details></${t}>`)
    .replace(/<p class="small defs">([\s\S]*?)<\/p>/g, (m, x) => `<details class="more"><summary>What the columns mean</summary><p class="small">${x}</p></details>`);
  function renderAdvice() {
    const e = nextBan(), R = RES; let html = "";
    if (e >= 6) html += `<h2>Ban phase complete</h2><p class="small">All six bans are in. Below: what each team is now likely to open.</p>`;
    else if (ourTurn() && st.model === "sim") html += simAdvice();
    else if (ourTurn()) {
      const cnt = turnCount(), top = topBans(10), sug = suggested(cnt).filter(Boolean), best = sug.map(x => x.h);
      html += `<h2>Your ban #${e + 1}${cnt === 2 ? ` and #${e + 2}` : ""}</h2>`;
      html += headline(sug, cnt);
      if (cnt === 2 && R.pairs) html += pairTable(R.pairs, R.shortlist.length);
      html += rankTable(top, R.V, R.se, [
        { th: "They open", td: h => pct(R.Pt[h]) }, { th: "You open", td: h => pct(R.Pu[h]) }, { th: "Cost to lose", td: h => (100 * R.R[h]).toFixed(1) }],
        `Value: change in your team's win probability, in points, against the ban a typical team would make, with its 95% interval. They open, you open: chance each team
        opens the hero if it stays available. Cost to lose: points the team that would open it loses without it. Click a row, or press 1 to 8, to ban.`);
      const t8 = top.slice(0, 8);
      html += `<h2>${esc(NAMES[best[0]])} leads mostly by ${(1 - R.PL[best[0]]) * R.Pt[best[0]] * R.R[best[0]] >= R.V[best[0]] * .5 ? "denying them" : "protecting your team"}</h2>
        <figure>${splitBars(t8, R)}<figcaption>Each ban's value split into its parts, in points: what it takes from the other team (their chance of opening the hero times
        what losing it costs them), the effect on your team (negative when your team would have played it), and the change in the rest of the ban phase. The first two are
        discounted by the chance the hero goes anyway. The parts use the average of the four networks, so they can differ slightly from the value on the right.</figcaption></figure>`;
    } else {
      const top = Array.from(THEIRS.keys()).filter(h => THEIRS[h] > 0).sort((a, b) => THEIRS[b] - THEIRS[a]).slice(0, 10);
      const s = { firstUs: st.first, bans: st.bans.slice(), m: st.map, r0: META.tiers[st.tier] };
      const nx = top.slice(1, 4).map(h => `${esc(NAMES[h])} ${pct(THEIRS[h])}`);
      html += `<h2>Their ban #${e + 1}</h2><div class="verdict them"><div class="vpics"><img src="${img(top[0])}" alt=""></div>
        <div class="vtext"><div class="vcall">Likeliest: <span class="vname">${esc(NAMES[top[0]])}</span></div>
        <div class="vest"><span class="vnum">${pct(THEIRS[top[0]])}</span> <span class="vci">then ${nx.join(", ")}</span></div>
        </div></div>
        <figure>${whySplit(s, THEIRS)}<figcaption>Why a typical team in their position would ban each hero next: the ban model's reasons, measured against an average hero
        (log-odds, so only the lengths relative to each other matter). The percentage is the chance of ban #${e + 1}. They cannot see your hovers.
        Enter what they actually ban in the ban phase, or click the faded box if they banned the likeliest hero.</figcaption></figure>`;
    }
    const bans = bannedSet(), revs = teamSet();
    const them = Array.from(R.Pt.keys()).filter(h => !bans.has(h)).sort((a, b) => R.Pt[b] - R.Pt[a]).slice(0, 10);
    const us = Array.from(R.Pu.keys()).filter(h => !bans.has(h) && !revs.has(h)).sort((a, b) => R.Pu[b] - R.Pu[a]).slice(0, 10);
    html += `<h2>Likely openers</h2>
      <figure>${butterfly(them, us, R.Pt, R.Pu, revs)}<figcaption>Chance each team opens a hero, given the bans so far and the heroes your team shows.
      The ten likeliest for each team, on one list. Where both bars are long, a ban costs both teams. Teams protect their own heroes and ban what beats them, so their bans shift the left side.</figcaption></figure>`;
    if (VIEW === "term") html = termAdvice();
    renderStatusBar();
    $("adviceBody").innerHTML = quiet(html);
    $("adviceBody").querySelectorAll(".tl[data-h]").forEach(el => el.onclick = () => { if (ourTurn()) { st.active = { kind: "ban" }; place(+el.dataset.h); } });
    $("adviceBody").querySelectorAll(".tl.tp2").forEach(el => el.onclick = () => {
      if (!ourTurn() || turnCount() < 2) return;
      for (const h of [+el.dataset.a, +el.dataset.b]) { for (let i = 0; i < 6; i++) if (st.team[i] === h) st.team[i] = -1; st.bans.push(h); }
      st.active = { kind: "ban" }; update();
    });
    $("adviceBody").querySelectorAll("tr.pick").forEach(el => el.onclick = () => { st.active = { kind: "ban" }; place(+el.dataset.h); });
    $("adviceBody").querySelectorAll("tr.pickpair").forEach(el => el.onclick = () => {
      if (!ourTurn() || turnCount() < 2) return;
      for (const h of [+el.dataset.a, +el.dataset.b]) { for (let i = 0; i < 6; i++) if (st.team[i] === h) st.team[i] = -1; st.bans.push(h); }
      st.active = { kind: "ban" }; update();
    });
    if (RUN && !RUN.finished && !RUN.pairs && st.model === "sim") progress();
  }

  function simAdvice() {
    const e = nextBan(), cnt = turnCount(); let html = `<h2>Your ban #${e + 1}${cnt === 2 ? ` and #${e + 2}` : ""} (re-draft simulator)</h2>`;
    const bar = `<div class="prog"><span id="simProg"></span></div><p class="small" id="simMsg"><span id="simCount"></span></p>`;
    if (RUN && RUN.failed) return html + `<p class="small">The simulator stopped with an error in this browser. Reload the page to try again. The ban value model still works.</p>`;
    if (!SIM || SIM.prelim) return html + bar;
    const S = SIM, top = topBans(10), sug = suggested(cnt), best = sug.filter(Boolean).map(x => x.h);
    html += headline(sug.filter(Boolean), cnt, `Baseline win chance ${(100 * S.base).toFixed(1)}%`);
    if (cnt === 2 && Array.isArray(SIMP)) html += pairTable(SIMP, PAIRS);
    const repl = h => { let b = -1, bv = 0; for (let x = 0; x < H; x++) { if (x === h) continue; const d = S.co[h][x] - S.baseCo[x]; if (d > bv) { bv = d; b = x; } } return b < 0 ? "" : `${esc(NAMES[b])} +${(100 * bv).toFixed(0)}`; };
    html += rankTable(top, S.V, S.se, [
      { th: "They draft it", td: h => pct(S.baseCo[h]) }, { th: "They switch to", td: repl, r: false }],
      `Value: change in your team's win probability, in points, against a typical ban, with its 95% interval over ${fmt(S.total)} simulated ban phases.
      They draft it: share of their simulated drafts with the hero after a typical ban. They switch to: the hero whose share rises most when you ban it.`);
    const h = best[0], dO = [], dU = [];
    for (let x = 0; x < H; x++) { dO.push({ h: x, d: S.co[h][x] - S.baseCo[x] }); dU.push({ h: x, d: S.cu[h][x] - S.baseCu[x] }); }
    const big = a => a.filter(r => Math.abs(r.d) >= .005).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 10).sort((a, b) => b.d - a.d);
    const up = big(dO).filter(r => r.d > 0 && r.h !== h).slice(0, 2);
    html += `<h2>Banning ${esc(NAMES[h])}${up.length ? " moves them to " + up.map(r => `${esc(NAMES[r.h])} (+${(100 * r.d).toFixed(0)})`).join(" and ") : ""}</h2><div class="cols">
      ${colFig(shiftChart(big(dO), "them"), `The other team's simulated drafts: change in the share that include each hero, in points, against a typical ban.`)}
      ${colFig(shiftChart(big(dU), "us"), `Your team's simulated drafts, the same comparison.`)}</div>`;
    return html;
  }

  // ---------------------------------------------------------------- re-draft simulator: a pool of workers, two stages, a progress bar
  const NW = Math.min(8, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), TOP2 = 12;
  const RUNS = [16, 32, 64, 128, 256], FIRST = { 16: 6, 32: 8, 64: 12, 128: 16, 256: 24 };   // runs for the top bans, and for every ban in stage 1
  const PAIR_RUNS = 64;                                             // two-ban turns: 45 pairs, so pairs stop at 64 runs (the single-ban ranking gets them all)
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  const chunks = (a, k) => { const n = Math.ceil(a.length / k), o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
  const PAIRS = 10;                                               // two-ban turns: pairs among the best PAIRS single bans
  let pool = [], RUN = null, SIM = null, SIMP = null, simId = 0;
  function newWorker() { const w = new Worker("sim-worker.js?v=1c092ab7d8"); w.onmessage = ev => onSim(ev.data); w.onerror = () => simFail(); return w; }
  function ensurePool(fresh) { if (fresh) { pool.forEach(w => w.terminate()); pool = []; } while (pool.length < NW) pool.push(newWorker()); }
  function simFail() {
    if (!RUN || RUN.finished) return; RUN.finished = true;
    if (RUN.pairs) { SIMP = "failed"; renderBans(); renderAdvice(); return; }   // keep the single-ban results
    RUN.failed = true; $("mainEl").classList.remove("busy"); renderAdvice();
  }
  function send(k, cands, looks, baseLooks) { if (!cands.length && !baseLooks.length) return; RUN.pending++; pool[k].postMessage({ id: RUN.id, st: RUN.st, cands, looks, baseLooks }); }
  function startPairs(s, base) {                            // every pair of the shortlist, all runs, against the singles' typical-ban baseline
    const sl = topBans(PAIRS), cands = []; for (let i = 0; i < sl.length; i++) for (let j = i + 1; j < sl.length; j++) cands.push([sl[i], sl[j]]);
    const NR = Math.min(st.runs, PAIR_RUNS), looks = range(0, NR);
    RUN = { id: ++simId, st: s, cands, NR, ticks: 0, total: cands.length * NR, pending: 0, stage: 2, vals: {}, cs: {}, base, t0: performance.now(), finished: false, pairs: true };
    const jobs = pool.map(() => []); cands.forEach((p, i) => jobs[i % pool.length].push(p));
    jobs.forEach((j, k) => send(k, j, looks, []));
  }
  function startSim(s) {
    ensurePool(RUN && !RUN.finished);                       // a busy pool would finish stale work first, so start it over
    const prot = new Set(s.hov6.filter(h => h >= 0)), cands = [];
    for (let h = 0; h < H; h++) if (!s.bans.includes(h) && !prot.has(h)) cands.push(h);
    const top2 = Math.min(TOP2, cands.length), NR = st.runs, L1 = range(0, FIRST[NR]), L2 = range(FIRST[NR], NR);
    RUN = { id: ++simId, st: s, cands, top2, L1, L2, NR, ticks: 0, total: NR + cands.length * L1.length + top2 * L2.length, pending: 0, stage: 1,
            vals: {}, cs: {}, base: {}, bcs: { u: new Float64Array(H), o: new Float64Array(H), n: 0 }, t0: performance.now(), finished: false };
    const load = pool.map(() => 0), jobs = pool.map(() => ({ cands: [], base: [] }));
    chunks(range(0, NR), pool.length).forEach((b, k) => { jobs[k].base = b; load[k] = b.length; });   // the typical-ban baseline, split across workers
    for (const h of cands) { const k = load.indexOf(Math.min(...load)); jobs[k].cands.push(h); load[k] += L1.length; }
    jobs.forEach((j, k) => send(k, j.cands, L1, j.base));
  }
  function onSim(d) {
    const R = RUN; if (!R || d.id !== R.id || R.finished) return;
    if (!d.done) { R.ticks += d.tick || 0; if (!R.pairs) progress(); return; }
    for (const h in d.vals) {
      Object.assign(R.vals[h] || (R.vals[h] = {}), d.vals[h]);
      const c = R.cs[h] || (R.cs[h] = { u: new Float64Array(H), o: new Float64Array(H), n: 0 }), n = Object.keys(d.vals[h]).length;
      for (let x = 0; x < H; x++) { c.u[x] += d.cnt[h].u[x] * n; c.o[x] += d.cnt[h].o[x] * n; } c.n += n;
    }
    if (d.baseCnt) { const n = Object.keys(d.base).length; Object.assign(R.base, d.base); for (let x = 0; x < H; x++) { R.bcs.u[x] += d.baseCnt.u[x] * n; R.bcs.o[x] += d.baseCnt.o[x] * n; } R.bcs.n += n; }
    if (--R.pending > 0) return;
    if (R.pairs) { R.finished = true; SIMP = summarizePairs(R); renderBans(); renderAdvice(); return; }
    const S = summarize(R); SIM = S;
    if (R.stage === 1 && R.top2 > 0 && R.L2.length) {       // stage 2: more continuations for the leaders, spread over the workers
      R.stage = 2; S.prelim = true; let k = 0;
      const parts = chunks(R.L2, Math.max(1, Math.ceil(pool.length * 4 / R.top2)));   // about four jobs per worker, so they finish together
      R.cands.slice().sort((a, b) => S.V[b] - S.V[a]).slice(0, R.top2).forEach(h => parts.forEach(js => send(k++ % pool.length, [h], js, [])));
      return;
    }
    R.finished = true; S.ms = performance.now() - R.t0;
    $("mainEl").classList.remove("busy"); $("busy").textContent = "computing";
    renderBans(); renderRoster(); renderAdvice();
    if (R.st.pair) startPairs(R.st, R.base);                // two-ban turn: score the shortlist's pairs jointly
  }
  function progress() {
    const f = Math.min(1, RUN.ticks / RUN.total), el = $("simProg");
    if (el) el.style.width = (100 * f).toFixed(1) + "%";
    const t = $("simCount"); if (t) t.textContent = `${fmt(RUN.ticks)} of ${fmt(RUN.total)} ban phases simulated`;
    $("busy").textContent = `simulating ${Math.round(100 * f)}%`;
    if (VIEW === "term") renderStatusBar();
  }
  function summarize(R) {
    const V = new Float64Array(H).fill(NaN), se = new Float64Array(H).fill(NaN), win = new Float64Array(H).fill(NaN), n = new Int32Array(H), co = {}, cu = {};
    const bj = Object.keys(R.base), bm = bj.reduce((a, j) => a + R.base[j], 0) / bj.length;
    for (const h of R.cands) {
      const v = R.vals[h]; if (!v) continue; const js = Object.keys(v), d = js.map(j => v[j] - R.base[j]), m = d.reduce((a, b) => a + b, 0) / d.length;
      V[h] = m; n[h] = d.length; win[h] = js.reduce((a, j) => a + v[j], 0) / js.length;
      se[h] = Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / (d.length * Math.max(1, d.length - 1)));
      co[h] = R.cs[h].o.map(x => x / R.cs[h].n); cu[h] = R.cs[h].u.map(x => x / R.cs[h].n);
    }
    return { V, se, win, n, base: bm, co, cu, baseCo: R.bcs.o.map(x => x / R.bcs.n), baseCu: R.bcs.u.map(x => x / R.bcs.n), total: R.total };
  }
  function summarizePairs(R) {
    const out = [];
    for (const p of R.cands) {
      const k = String(p), v = R.vals[k]; if (!v) continue; const js = Object.keys(v), d = js.map(j => v[j] - R.base[j]), m = d.reduce((a, b) => a + b, 0) / d.length;
      out.push({ a: p[0], b: p[1], V: m, n: d.length, se: Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / (d.length * Math.max(1, d.length - 1))) });
    }
    out.ms = performance.now() - R.t0; return out.sort((x, y) => y.V - x.V);
  }

  // ---------------------------------------------------------------- update loop
  let pending = 0;
  function update(recompute = true) {
    writeHash();
    $("firstBtn").classList.toggle("on", st.first); $("secondBtn").classList.toggle("on", !st.first);
    $("valueBtn").classList.toggle("on", st.model === "value"); $("simBtn").classList.toggle("on", st.model === "sim");
    $("runsCtl").style.display = st.model === "sim" ? "" : "none";
    document.querySelectorAll("#runsCtl button").forEach(b => b.classList.toggle("on", +b.dataset.n === st.runs));
    $("tierSel").value = st.tier; $("mapSel").value = String(st.map);
    if (st.active.kind === "ban" && nextBan() >= 6) st.active = { kind: "ban" };
    renderTeam(); renderTurnHint();
    if (!recompute && RES) { renderBans(); renderRoster(); return; }
    $("mainEl").classList.add("busy"); const my = ++pending;
    setTimeout(() => {
      if (my !== pending) return;
      const s = { firstUs: st.first, bans: st.bans.slice(), rev: st.team.filter(h => h >= 0), m: st.map, r0: META.tiers[st.tier], cnt: turnCount() };
      RES = E.values(s); THEIRS = !ourTurn() && nextBan() < 6 ? E.theirNextBan(s, RES) : null; SIM = SIMP = null;
      FC = nextBan() < 6 ? forecastChain(s) : null;
      if (st.model === "sim" && ourTurn()) { $("busy").textContent = "simulating 0%"; startSim(Object.assign({}, s, { hov6: st.team.slice(), cnt: 1, pair: s.cnt === 2 })); }
      else { if (RUN) RUN.finished = true; $("mainEl").classList.remove("busy"); }
      renderBans(); renderRoster(); renderAdvice();
    }, 15);
  }

  // ---------------------------------------------------------------- method section (static text + figures from the model tables)
  function renderMethod() {
    const v = META.validation, NB = META.bands.length + 1, NM = META.maps.length;
    const avg = h => { const o = []; for (let b = 0; b < NB; b++) { let s = 0; for (let m = 0; m < NM; m++) s += META.removal_cost[h][b][m]; o.push(s / NM); } return o; };
    const bandLab = ["below 4,200", "4,200–4,500", "4,500–4,800", "4,800+"], marks = ["circle", "diamond", "square", "tri"];
    const mark = (k, x, y) => k === 0 ? `<circle cx="${x}" cy="${y}" r="2.8" fill="none" stroke="currentColor"/>` : k === 1 ? `<path d="M${x} ${y - 3.4}L${x + 3.4} ${y}L${x} ${y + 3.4}L${x - 3.4} ${y}Z" fill="none" stroke="currentColor"/>`
      : k === 2 ? `<rect x="${x - 2.6}" y="${y - 2.6}" width="5.2" height="5.2" fill="currentColor"/>` : `<path d="M${x} ${y - 3.5}L${x + 3.5} ${y + 3}L${x - 3.5} ${y + 3}Z" fill="currentColor"/>`;
    const all = NAMES.map((n, h) => ({ h, c: avg(h) })); const lo = Math.min(...all.flatMap(r => r.c)), hi = Math.max(...all.flatMap(r => r.c));
    const panel = r => {
      const rows = all.filter(x => META.roles[x.h] === r).sort((a, b) => b.c.reduce((s, t) => s + t) - a.c.reduce((s, t) => s + t));
      const L = labW(rows.map(x => NAMES[x.h]), 10.5) + 7, W = L + 210, rowH = 13, top = 18, hgt = top + rows.length * rowH + 22, X = v => L + (v - lo) / (hi - lo) * (W - L - 10);
      let g = `<text x="${L}" y="11" font-size="11.5" font-weight="600">${ROLE_NAMES[r]}</text>`;
      for (let t = Math.ceil(lo * 50) / 50; t <= hi; t += .02) g += `<line class="grid" x1="${X(t)}" x2="${X(t)}" y1="${top - 3}" y2="${hgt - 20}"/><text x="${X(t)}" y="${hgt - 7}" font-size="9.5" text-anchor="middle" class="faint">${(100 * t).toFixed(0)}</text>`;
      g += `<line class="axis" x1="${X(0)}" x2="${X(0)}" y1="${top - 3}" y2="${hgt - 20}"/>`;
      rows.forEach((x, k) => { const y = top + k * rowH + 6; g += `<text x="${L - 5}" y="${y + 3.5}" font-size="10.5" text-anchor="end">${esc(short(x.h))}</text><g style="color:var(--ink)">${x.c.map((c, b) => mark(b, X(c), y)).join("")}</g>`; });
      return `<svg viewBox="0 0 ${W} ${hgt}" width="${W}">${g}</svg>`;
    };
    const lg = bandLab.map((b, k) => `<svg width="10" height="10" style="display:inline;vertical-align:-1px"><g style="color:var(--ink)">${mark(k, 5, 5)}</g></svg> ${b}`).join(" &nbsp; ");
    const L_ = v.lineup;
    const dsp = v.displacement && v.displacement[v.displacement.length - 1], oneTrick = dsp ? Math.abs(dsp.pp).toFixed(1) : "9.7";
    $("method").innerHTML = `<details class="how"><summary>How it works, and how well it holds up</summary><div class="mgrid"><div class="mcol"><h2>Method</h2>
      <p>A ban removes a hero from both teams, and in ranked you usually don't know who is on the other side. Every hero banned in the rest of the ban phase, by either team, is worth</p>
      <p class="formula">w(<i>y</i>) = <i>P</i><sub>them</sub>(<i>y</i>) × <i>R</i><sub>them</sub>(<i>y</i>) − <i>P</i><sub>us</sub>(<i>y</i>) × <i>R</i><sub>us</sub>(<i>y</i>)</p>
      <p>to your team: how likely each team is to open it, times what losing it costs that team. The rest of the ban phase is simulated ${fmt(E.NS)} times, one ban at a time, from a ban model
      that reacts to every ban before it. The value of banning <i>x</i> is the average total of w over the simulated bans when you ban <i>x</i>, minus the same average when you ban as a
      typical team would. Every candidate faces the same random draws, so their differences are not noise from resampling. A hero that would go anyway, and the other team's replies,
      are already in the simulated bans, so nothing is added on top. On a two-ban turn the best pairs are scored together in the same way.${META.pair_removal ? ` When a hero
      and its players' usual replacement are both banned, the cost of losing the hero includes losing the replacement too (for example a main and its backup).` : ""}</p>
      <ul>
        <li><b><i>P</i><sub>them</sub>, <i>P</i><sub>us</sub></b>: a masked team-lineup network (two hidden layers of 512, an ensemble of four) that sees only what a lobby shows: the bans so far and who made them,
          the heroes your team shows, map, rank and side. It was trained on 243k Season 10 matches with random parts of each team hidden. The other team's side uses public information only.
          Your own bans are treated as choices, not as clues about your players: your side is averaged over the bans a typical team in your seat would have made.</li>
        <li><b><i>R</i></b>: the cost of losing a hero, computed with a fitted outcome model on 1.8 million real opening picks. Each player is moved to their next choice (from a pick model) and the change
          in the team's win probability is recorded. That includes the hero, map, side, rank, compositions, teammates and matchups, and the player's playtime, recent picks and skill on both heroes.
          Losing a main costs far more for a player with a narrow pool, and less if they have a backup in the same role. In the raw data, a team whose one-trick (70% or more of their
          playtime on one hero) has that hero banned wins ${oneTrick} points less often.</li>
        <li><b>The simulated bans</b>: a ban model fitted on every Season 10 ban. Teams avoid banning their own players' heroes, ban heroes that beat what they play, and react to earlier bans.
          It sees your hovers only when it bans for your team.</li>
      </ul>
      </div><div class="mcol"><h2>Checks on 27,016 later matches</h2>
      <p class="small">From the notebook run that fitted these models. ${META.version >= 6 ? `The last two lines score real bans with this page's value function, on ${fmt(v.bans.matches)} of those matches
      (each ban needs its own simulated ban phase).` : `The last two lines score bans with the notebook's earlier value formula (before the simulated ban phase replaced the
      "banned later" discount and the reply term).`}</p>
      <table><tr><th>Check (matches the model never saw)</th><th class="r">Result</th></tr>
        <tr><td>Predicting the other team's heroes before any ban (cross-entropy, against ${L_["0"].bce_popularity.toFixed(4)} from popularity alone)</td><td class="r">${L_["0"].bce_model.toFixed(4)}</td></tr>
        <tr><td>&hellip; after three bans / after all six</td><td class="r">${L_["3"].bce_model.toFixed(4)} / ${L_["6"].bce_model.toFixed(4)}</td></tr>
        <tr><td>Share of the other team's six heroes in the model's top six guesses, after all six bans</td><td class="r">${pct(L_["6"].top6_recall)}</td></tr>
        <tr><td>Win probability a typical team's three bans leave on the table, by the model's own values</td><td class="r">${v.bans.mean_regret_pp.toFixed(2)} pts</td></tr>
        <tr><td>Do teams whose real bans scored higher win more? Slope of winning on ban value (1 = right size)</td><td class="r">${v.bans.slope.toFixed(2)} ± ${(1.96 * v.bans.slope_se).toFixed(2)}</td></tr></table>
      <p class="small">The last line is inconclusive. Real teams' bans differ by fractions of a point, and ${fmt(v.bans.matches || 27016)} coin-flip outcomes can only detect a slope of about ±${v.bans.detectable_slope_80pct.toFixed(1)}.
      Each piece of the model is checked separately instead. Bans reveal only a little about a team you can't see. Your teammates' hovers reveal much more. A good ban is worth about
      one point of win probability per game, and bans within about 0.1 points of each other are tied.</p>
      <h2>Limits</h2>
      <ul class="small">
        <li>Fitted on PC ranked Season 10 matches from ${fitDates}, mostly Diamond to Celestial. Few lobbies average above 5,000.</li>
        <li>Ranks map to scores at about 100 points per division (Grandmaster 3 ≈ 4,550). The exact tier boundaries are approximate.</li>
        <li>Hovers are not in the data. The model treats a shown hero as that player's likely pick and assumes a hover sticks about four times in five.</li>
        <li>Every other player is anonymous. The values average over the real players who play at your rank, not the people in your lobby.</li>
        <li>Values are first order in each banned hero. A ban that reshapes a whole composition is only approximated. The re-draft simulator re-drafts both teams and catches more of that.</li>
        <li>Pairs are searched among the ten best single bans, not every pair.</li>
        <li>Intervals take the fitted models as given. They do not include the uncertainty from refitting the models on other matches, which is larger.</li>
      </ul></div></div></details>
      <h2>Cost of losing each hero, by rank</h2>
      <figure><div class="cols">${[0, 1, 2].map(panel).join("")}</div>
        <figcaption>Win-probability points. ${lg}</figcaption></figure>`;
  }

  // the fitting period comes from the model file's split manifest (training + validation matches) when it has one
  const SPL = META.validation && META.validation.splits, day = t => new Date(t.replace(" ", "T") + "Z").toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" });
  const fitN = SPL ? SPL.train.n + SPL.validation.n : 243143;
  const fitDates = SPL ? `${day(SPL.train.first_utc)} to ${day(SPL.validation.last_utc)} ${new Date(SPL.validation.last_utc.replace(" ", "T") + "Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}` : "11 to 21 September 2026";
  $("status").textContent = ""; $("fitted").textContent = `Fitted on ${fmt(fitN)} PC ranked matches from Season 10 (${fitDates}).`;
  setView(VIEW); renderMethod(); update();
  document.fonts && document.fonts.ready.then(() => { renderMethod(); if (RES) renderAdvice(); });
})();
