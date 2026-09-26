/* Ban Call, v8: interface. The value networks and the ban model live in engine8.js; the lineup network of the previous model
   (engine.js) still draws the likely openers and orders the roster. This file handles the lobby, input and figures. */
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
  const pct = x => (100 * x).toFixed(0) + "%", pct1 = x => (100 * x).toFixed(1) + "%";
  const fmt = n => n.toLocaleString("en-US");
  const FONT = '"Archivo Narrow", "Arial Narrow", Arial, sans-serif', ctx2d = document.createElement("canvas").getContext("2d");
  const tw = (s, px) => { ctx2d.font = `${px}px ${FONT}`; return ctx2d.measureText(String(s)).width; };
  const labW = (arr, px) => Math.ceil(Math.max(0, ...arr.map(s => tw(s, px)))) + 4;
  try { await Promise.race([document.fonts.load('12px "Archivo Narrow"'), new Promise(r => setTimeout(r, 1500))]); } catch (e) {}

  // ---------------------------------------------------------------- load: the tables first, then the networks with a progress line
  const status = t => { $("status").textContent = t; };
  async function fetchBin(url, bytes, label) {
    const r = await fetch(url); if (!r.ok) throw new Error(url);
    if (!r.body || !r.body.getReader) return r.arrayBuffer();
    const rd = r.body.getReader(), parts = []; let got = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; if (label) status(`${label} ${Math.round(100 * got / bytes)}%`); }
    const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out.buffer;
  }
  const LAY = await fetch("model8/value_v8.json", { cache: "no-cache" }).then(r => r.json()), VQ = `?v=${LAY.run}`;   // the other model files carry the run, so a cached one never mixes runs
  const [BAN, SUBS, REP, META, W7, PORT] = await Promise.all(["model8/ban_v8.json" + VQ, "model8/substitutes_v8.json" + VQ, "model8/report_v8.json" + VQ,
    "model/meta.json"].map(u => fetch(u).then(r => r.json())).concat([fetch("model/weights.bin").then(r => r.arrayBuffer()), fetch("model/portraits.json").then(r => r.json())]));
  const E = new Engine8(LAY, BAN), E7 = new BanEngine(META, W7, META.engine ? { NS: 64, NOWN: META.engine.nown } : { NS: 64 });
  const H = E.H, ORDER = LAY.order, NAMES = LAY.heroes, ROLES = LAY.roles;
  status(`Loading the value networks (${(LAY.files.opt.bytes / 1e6).toFixed(0)} MB)…`);
  E.addBuffer("opt", await fetchBin(`model8/${LAY.files.opt.path}${VQ}`, LAY.files.opt.bytes, "Loading the value networks"));
  const auxP = fetchBin(`model8/${LAY.files.aux.path}${VQ}`, LAY.files.aux.bytes, null);          // behaviour and robust members: after the page is up
  const img = h => `img/heroes/${PORT[NAMES[h]]}.webp`, short = h => NAMES[h];
  const mapName = s => s.includes(" · ") ? s.replace(" · ", " (") + ")" : s;
  const V7 = new Map(META.maps.map((m, i) => [m.name, i]));                          // the lineup network's map index, by name
  const MAPS = LAY.maps.map((m, i) => ({ i, name: mapName(m.label), v7: V7.get(m.label) })).filter(m => m.v7 !== undefined).sort((a, b) => a.name.localeCompare(b.name));
  const v7map = i => (MAPS.find(m => m.i === i) || MAPS[0]).v7;
  const TIERS = Object.keys(META.tiers);
  const SUB = new Map(SUBS.table.map(r => [r.hero, r]));

  // ---------------------------------------------------------------- state (mirrored in the URL hash, so a lobby can be shared)
  const kly = MAPS.find(m => /Klyntar \(Dom/.test(m.name));
  const st = { tier: "Grandmaster 3", map: kly ? kly.i : MAPS[0].i, first: true, team: [-1, -1, -1, -1, -1, -1], bans: [], gone: [], active: { kind: "team", i: 0 } };
  let MINE = []; try { MINE = JSON.parse(localStorage.getItem("bancall-mine") || "[]").filter(h => Number.isInteger(h)); } catch (e) {}
  const rememberMine = h => { MINE = [h].concat(MINE.filter(x => x !== h)).slice(0, 8); try { localStorage.setItem("bancall-mine", JSON.stringify(MINE)); } catch (e) {} };
  function readHash() {
    const q = new URLSearchParams(location.hash.slice(1)); if (!q.has("m")) return;
    if (q.get("t") && META.tiers[q.get("t")]) st.tier = q.get("t");
    let m = +q.get("m") || 0; if (m === 15 && !MAPS.some(x => x.i === 15)) m = 16;        // older links: K'un-Lun was map 15 before God Quarry was added
    st.map = MAPS.some(x => x.i === m) ? m : st.map; st.first = q.get("f") !== "0";
    const tm = (q.get("u") || "").split(",").map(x => (x === "" || x === "-") ? -1 : +x); for (let i = 0; i < 6; i++) st.team[i] = Number.isInteger(tm[i]) && tm[i] >= 0 && tm[i] < H ? tm[i] : -1;
    st.bans = (q.get("b") || "").split(",").filter(x => x !== "").map(Number).filter(h => h >= 0 && h < H).slice(0, 6); st.gone = [];
    st.active = st.team[0] < 0 ? { kind: "team", i: 0 } : { kind: "ban" };
  }
  let lastHash = "";
  function writeHash() {
    const q = new URLSearchParams({ t: st.tier, m: st.map, f: st.first ? 1 : 0, u: st.team.map(h => h < 0 ? "-" : h).join(","), b: st.bans.join(",") });
    lastHash = "#" + q.toString(); history.replaceState(null, "", lastHash);
  }
  readHash();
  if (!location.hash && MINE.length && MINE[0] < NAMES.length) { st.team[0] = MINE[0]; st.active = { kind: "ban" }; }
  window.addEventListener("hashchange", () => {
    if (location.hash === lastHash) return;
    st.team = [-1, -1, -1, -1, -1, -1]; st.bans = []; st.gone = []; readHash();
    $("tierSel").value = st.tier; $("mapSel").value = String(st.map); update();
  });
  const ours = i => (ORDER[i] === 0) === st.first;
  const nextBan = () => st.bans.length;
  const ourTurn = () => nextBan() < 6 && ours(nextBan());
  const turnCount = () => { const e = nextBan(); return (e + 1 < 6 && ours(e) && ours(e + 1)) ? 2 : 1; };
  const bannedSet = () => new Set(st.bans);
  const teamSet = () => new Set(st.team.filter(h => h >= 0));
  // the lobby as the value networks see it: the heroes your team showed stay shown even if the other team bans them
  const shownOf = i => st.team[i] >= 0 ? st.team[i] : (st.gone.find(g => g.i === i) || { h: -1 }).h;
  const lobby = () => ({ m: st.map, r0: META.tiers[st.tier], firstUs: st.first, bans: st.bans.slice(), you: shownOf(0), mates: [1, 2, 3, 4, 5].map(shownOf).filter(h => h >= 0) });

  // ---------------------------------------------------------------- controls
  $("tierSel").innerHTML = TIERS.map(t => `<option${t === st.tier ? " selected" : ""}>${esc(t)}</option>`).join("");
  $("mapSel").innerHTML = MAPS.map(m => `<option value="${m.i}"${m.i === st.map ? " selected" : ""}>${esc(m.name)}</option>`).join("");
  $("tierSel").onchange = e => { st.tier = e.target.value; update(); };
  $("mapSel").onchange = e => { st.map = +e.target.value; update(); };
  $("firstBtn").onclick = () => { st.first = true; update(); };
  $("secondBtn").onclick = () => { st.first = false; update(); };
  const undo = () => { if (!st.bans.length) return; const h = st.bans.pop(), g = st.gone.findIndex(x => x.h === h);
    if (g >= 0) { const x = st.gone[g]; st.gone.splice(g, 1); if (st.team[x.i] < 0) st.team[x.i] = x.h; } st.active = { kind: "ban" }; update(); };
  $("undoBtn").onclick = undo;
  $("newBtn").onclick = () => newLobby();
  $("resetBtn").onclick = () => { st.team = [-1, -1, -1, -1, -1, -1]; st.bans = []; st.gone = []; st.active = { kind: "team", i: 0 }; $("search").value = ""; update(); };
  $("linkBtn").onclick = () => { writeHash(); navigator.clipboard && navigator.clipboard.writeText(location.href); $("linkBtn").textContent = "Link copied"; setTimeout(() => $("linkBtn").textContent = "Copy link", 1400); };
  const themeNow = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const setThemeLabel = () => $("themeBtn").textContent = themeNow() === "dark" ? "Light" : "Dark";
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
      st.gone = st.gone.filter(g => g.i !== a.i);
      st.team[a.i] = h; if (a.i === 0) rememberMine(h);
      const nxt = a.i === 0 ? -1 : st.team.findIndex((x, i) => x < 0 && i > a.i);
      st.active = nxt >= 0 ? { kind: "team", i: nxt } : { kind: "ban" };
    } else {
      if (nextBan() >= 6 || st.bans.includes(h)) return;
      for (let i = 0; i < 6; i++) if (st.team[i] === h) { st.team[i] = -1; st.gone.push({ i, h }); }   // a banned hover is gone from the lobby, not from what your team showed
      st.bans.push(h);
    }
    $("search").value = ""; renderMatches(); update();
    if (matchMedia("(pointer: fine)").matches) $("search").focus({ preventScroll: true });
  }
  function banBoth(a, b) { for (const h of [a, b]) { for (let i = 0; i < 6; i++) if (st.team[i] === h) { st.team[i] = -1; st.gone.push({ i, h }); } st.bans.push(h); } st.active = { kind: "ban" }; update(); }
  const score = h => RES.mu[h] - E.KAPPA * RES.sd[h];
  const topBans = k => RES ? RES.cands.slice().sort((a, b) => score(b) - score(a)).slice(0, k) : [];
  function quickList() {
    if (st.active.kind === "team") {
      const bans = bannedSet(), team = teamSet(), ok = h => !bans.has(h) && !team.has(h);
      if (st.active.i === 0) {
        const pop = popularity(), seen = new Set(), out = [];
        for (const h of MINE.concat(Array.from(pop.keys()).sort((a, b) => pop[b] - pop[a]))) if (h < H && ok(h) && !seen.has(h) && out.length < 8) { seen.add(h); out.push({ h, lab: MINE.includes(h) ? "yours" : pct(pop[h]) }); }
        return out;
      }
      return LU ? Array.from(LU.pu.keys()).filter(ok).sort((a, b) => LU.pu[b] - LU.pu[a]).slice(0, 8).map(h => ({ h, lab: pct(LU.pu[h]) })) : [];
    }
    if (nextBan() >= 6) return [];
    if (ourTurn()) { if (!RES) return []; let o = topBans(8); const sg = suggested(); if (sg.length) o = [sg[0].h].concat(o.filter(h => h !== sg[0].h)).slice(0, 8); return o.map(h => ({ h, lab: pp(RES.V[h]) })); }
    return THEM ? THEM.cands.slice().sort((a, b) => THEM.pe[b] - THEM.pe[a]).slice(0, 8).map(h => ({ h, lab: pct(THEM.pe[h]) })) : [];
  }
  const quickSide = () => st.active.kind === "team" || ourTurn() ? "us" : "them";
  function renderQuick() {
    const q = quickList(), teamMode = st.active.kind === "team";
    const lab = teamMode ? (st.active.i === 0 ? "Your hero" : `Mate ${st.active.i + 1}: likely`) : ourTurn() ? "Best bans" : "Their likely ban";
    const html = q.length ? `<span class="qlab">${lab}</span>` + q.map((x, k) =>
      `<button class="qt ${quickSide()}" data-h="${x.h}" title="${esc(NAMES[x.h])} (key ${k + 1})"><span class="qk">${k + 1}</span><img src="${img(x.h)}" alt=""><span class="qv">${x.lab}</span></button>`).join("") : "";
    $("quickTeam").innerHTML = teamMode ? html : ""; $("quick").innerHTML = teamMode ? "" : html;
    document.querySelectorAll("#quick .qt, #quickTeam .qt").forEach(el => el.onclick = () => place(+el.dataset.h));
  }
  const quickPick = k => { const q = quickList()[k - 1]; if (q) { place(q.h); return true; } return false; };
  function newLobby() {
    st.bans = []; st.gone = []; for (let i = 1; i < 6; i++) st.team[i] = -1; st.active = st.team[0] < 0 ? { kind: "team", i: 0 } : { kind: "ban" };
    $("search").value = ""; renderMatches(); update();
  }
  let flashT; function flash(msg) { $("turnHint").textContent = msg; clearTimeout(flashT); flashT = setTimeout(renderTurnHint, 1600); }

  // ---------------------------------------------------------------- lobby rendering
  let RES = null, PAIRS = null, THEM = null, PATH = null, LU = null, WIN = null, DONE = null;
  function renderTeam() {
    $("teamSlots").innerHTML = st.team.map((h, i) => {
      const act = st.active.kind === "team" && st.active.i === i, g = h < 0 ? st.gone.find(x => x.i === i) : null;
      return `<div class="slot${h < 0 ? " empty" : ""}${act ? " active" : ""}" data-i="${i}" title="${h < 0 ? (g ? `${esc(NAMES[g.h])} was banned: click, then pick a hero` : "click, then pick a hero") : esc(NAMES[h]) + ": click to change"}">
        <div class="pic">${h < 0 ? (g ? `<img src="${img(g.h)}" alt="" style="opacity:.25;filter:grayscale(1)">` : "+") : `<img src="${img(h)}" alt="${esc(NAMES[h])}"><span class="x" data-clear="${i}">✕</span>`}</div>
        <div class="lab">${i === 0 ? "You" : "Mate " + (i + 1)}</div><div class="lab">${h >= 0 ? esc(short(h)) : g ? `<s>${esc(short(g.h))}</s>` : "&nbsp;"}</div></div>`;
    }).join("");
    $("teamSlots").querySelectorAll(".slot").forEach(el => el.onclick = ev => {
      const i = +el.dataset.i;
      if (ev.target.dataset.clear !== undefined) { st.team[i] = -1; st.gone = st.gone.filter(g => g.i !== i); st.active = { kind: "team", i }; update(); return; }
      st.active = { kind: "team", i }; update(false);
    });
  }
  function suggested() {                              // our ban(s) this turn: the advice, or on a two-ban turn the best pair (first, then second)
    if (!RES) return [];
    if (turnCount() === 2 && PAIRS && PAIRS.length) { const p = PAIRS[0]; return [{ h: p.a, pair: p }, { h: p.b, pair: p }]; }
    return [{ h: RES.best }];
  }
  function renderBans() {
    const e = nextBan(), sug = ourTurn() ? suggested() : [];
    const fc = new Map(); if (PATH) for (const s of PATH) if (!s.us) fc.set(s.e, s);
    $("banSlots").innerHTML = [0, 1, 2, 3, 4, 5].map(i => {
      const h = st.bans[i], side = ours(i) ? "us" : "them", isNext = i === e && st.active.kind === "ban";
      const s = h === undefined && i >= e && i < e + sug.length && ours(i) ? sug[i - e].h : undefined;
      const f = h === undefined && !ours(i) ? fc.get(i) : null;
      const pic = h !== undefined ? `<img src="${img(h)}" alt="${esc(NAMES[h])}"><span class="x">✕</span>`
                : s !== undefined ? `<img src="${img(s)}" alt="suggested ${esc(NAMES[s])}">` : f ? `<img src="${img(f.h)}" alt="" style="opacity:.4">` : (i + 1);
      const lab = h !== undefined ? esc(short(h)) : s !== undefined ? `<i>${esc(short(s))}?</i>` : f ? `<span class="pct">${pct(f.p)}</span> ${esc(NAMES[f.h])}` : "";
      return `<div class="slot ${side}${h === undefined ? " empty" : ""}${isNext ? " active" : ""}${s !== undefined ? " sug" : ""}${f ? " fc" : ""}" data-i="${i}"
        title="${h !== undefined ? "click to undo this ban and the ones after it" : s !== undefined ? "click to ban " + esc(NAMES[s])
          : f ? (i === e ? `their likeliest ban here. Click if they banned ${esc(NAMES[f.h])}` : "their likeliest ban here if the bans before it go as shown and as advised") : "click, then pick the banned hero"}">
        <div class="who">${i + 1} ${side}</div><div class="pic">${pic}</div><div class="lab">${lab || "&nbsp;"}</div></div>`;
    }).join("");
    $("banSlots").querySelectorAll(".slot").forEach(el => el.onclick = () => banClick(+el.dataset.i, el.classList));
    renderQuick(); $("undoBtn").disabled = !st.bans.length;
  }
  function banClick(i, cls) {
    if (i < st.bans.length) { while (st.bans.length > i) undoQuiet(); st.active = { kind: "ban" }; }
    else if (cls.contains("sug") && i === nextBan()) { const s = suggested()[0]; st.active = { kind: "ban" }; if (s) return place(s.h); }
    else if (cls.contains("fc") && i === nextBan() && THEM) { st.active = { kind: "ban" }; const t = THEM.cands.slice().sort((a, b) => THEM.pe[b] - THEM.pe[a])[0]; return place(t); }
    else st.active = { kind: "ban" };
    update();
  }
  function undoQuiet() { const h = st.bans.pop(), g = st.gone.findIndex(x => x.h === h); if (g >= 0) { const x = st.gone[g]; st.gone.splice(g, 1); if (st.team[x.i] < 0) st.team[x.i] = x.h; } }
  function renderTurnHint() { const e = nextBan(); $("target").innerHTML = ""; $("turnHint").innerHTML = e >= 6 ? "Ban phase complete." : ""; }
  // roster order: how often each hero is opened at the selected rank (the lineup network, no bans, averaged over maps and sides)
  const POPC = new Map();
  function popularity() {
    const key = st.tier; if (POPC.has(key)) return POPC.get(key);
    const rf = E7.rankFeat(META.tiers[st.tier]), p = new Float64Array(H); let n = 0;
    for (let m = 0; m < META.maps.length; m++) for (const side of [0, 1]) {
      const x = E7.features([], [], [], m, rf, side, 0);
      for (const net of E7.nets) { const P = E7.netProb(net, x); for (let h = 0; h < H; h++) p[h] += P[h]; n++; }
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
    const rank = new Map(); quickList().forEach((x, k) => rank.set(x.h, k + 1));
    const rkc = quickSide() === "us" ? "rk us" : "rk them";
    $("roster").innerHTML = [0, 1, 2].map(r => {
      const hs = heroOrder(NAMES.map((n, h) => h).filter(h => ROLES[h] === r));
      return `<h3>${ROLE_NAMES[r]}</h3><div class="grid">` + hs.map(h => {
        const cls = ["tile"]; if (bans.has(h)) cls.push("banned"); if (team.has(h)) cls.push("ours");
        if (q && !NAMES[h].toLowerCase().includes(q) && !(SHORT[NAMES[h]] || "").toLowerCase().includes(q)) cls.push("dim");
        return `<div class="${cls.join(" ")}" data-h="${h}" title="${esc(NAMES[h])}">${rank.has(h) ? `<span class="${rkc}">${rank.get(h)}</span>` : ""}<img src="${img(h)}" alt="" loading="lazy"><span class="nm">${esc(short(h))}</span></div>`;
      }).join("") + "</div>";
    }).join("");
    $("roster").querySelectorAll(".tile").forEach(el => el.onclick = () => { if (!el.classList.contains("banned")) place(+el.dataset.h); });
  }
  const searchMatches = () => { const q = $("search").value.split(",").pop().trim().toLowerCase(); if (!q) return [];
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
      if (parts.length > 1) {
        const team = st.active.kind === "team"; let i = team ? st.active.i : 0;
        for (const q of parts) {
          if (team) { while (i < 6 && st.team[i] >= 0 && i !== st.active.i) i++; if (i >= 6) break; st.active = { kind: "team", i }; }
          $("search").value = q; const m = searchMatches(); if (m.length) place(m[0]); if (team) i++;
        }
        if (team) st.active = { kind: "ban" }; $("search").value = ""; renderMatches(); update(false); }
      else { const m = searchMatches(); if (m.length) place(m[0]); }
      ev.preventDefault(); }
    else if (/^[1-8]$/.test(ev.key) && !$("search").value) { quickPick(+ev.key); ev.preventDefault(); }
    else if (ev.key === "Backspace" && !$("search").value && st.bans.length) { undo(); ev.preventDefault(); }
    else if (ev.key === "Escape") { $("search").value = ""; renderRoster(); }
  };
  document.addEventListener("keydown", ev => {
    if (ev.target.tagName === "INPUT" || ev.target.tagName === "SELECT" || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === "/") { $("search").focus(); ev.preventDefault(); }
    else if (/^[1-8]$/.test(ev.key)) { quickPick(+ev.key); ev.preventDefault(); }
    else if (ev.key.length === 1 && /[a-z&]/i.test(ev.key)) { $("search").focus(); }
    else if (ev.key === "Backspace" && st.bans.length) { undo(); ev.preventDefault(); }
  });

  // ---------------------------------------------------------------- figures (inline SVG, drawn from the model output)
  function niceStep(span, n = 5) { const raw = span / n || .001, p = Math.pow(10, Math.floor(Math.log10(raw))); const f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
  const memberV = h => RES.Q.map(q => q[h] - RES.base);
  function rankTable(top, cols, cap) {                // one row per ban: value, the members' range drawn in the row, extra columns
    const lo = Math.min(0, ...top.map(h => Math.min(...memberV(h)))), hi = Math.max(0, ...top.map(h => Math.max(...memberV(h)))), CW = 200, X = v => 17 + (v - lo) / (hi - lo || 1) * (CW - 34);
    const step = niceStep(hi - lo, 3); let ticks = "";
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-12; t += step) ticks += `<text x="${X(t)}" y="10" font-size="10" text-anchor="middle" class="faint">${pp(t, step < .005 ? 2 : 1)}</text>`;
    const cell = h => { const v = memberV(h), neg = RES.V[h] < 0;
      return `<svg width="${CW}" height="16" viewBox="0 0 ${CW} 16" style="display:inline-block;vertical-align:middle"><line class="grid" x1="${X(0)}" x2="${X(0)}" y1="0" y2="16"/>
        <line class="whisk" x1="${X(Math.min(...v))}" x2="${X(Math.max(...v))}" y1="8" y2="8"/>${v.map(u => `<line class="whisk" x1="${X(u)}" x2="${X(u)}" y1="5" y2="11"/>`).join("")}<circle cx="${X(RES.V[h])}" cy="8" r="3.6" class="${neg ? "them" : "us"}"/></svg>`; };
    return `<div style="overflow-x:auto"><table style="width:100%"><caption>${cap}</caption>
      <tr><th>#</th><th></th><th>Ban</th><th class="r">Value</th><th><svg width="${CW}" height="13" viewBox="0 0 ${CW} 13" style="display:block">${ticks}</svg></th>${cols.map(c => `<th${c.r === false ? "" : ' class="r"'}>${c.th}</th>`).join("")}</tr>` +
      top.map((h, k) => `<tr class="pick" data-h="${h}" title="${esc(NAMES[h])}: ${pp(RES.V[h])} points (members ${memberV(h).map(v => pp(v)).join(", ")}). Click to ban."><td class="num">${k + 1}</td><td><img class="mini" src="${img(h)}" alt=""></td>
        <td class="nmc">${esc(NAMES[h])}${RES.supported.has(h) ? "" : ' <span class="small" title="typical teams almost never make this ban, so the advice does not pick it">(rare)</span>'}</td><td class="r">${pp(RES.V[h])}</td><td>${cell(h)}</td>${cols.map(c => `<td${c.r === false ? "" : ' class="r"'}>${c.td(h)}</td>`).join("")}</tr>`).join("") + `</table></div>`;
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
  function probChart(rows, cls, W = 290, lab = pct) {  // rows: {h, p}
    const L = labW(rows.map(r => NAMES[r.h]), 11) + 7, R = Math.ceil(tw("100%", 10.5)) + 8; W = Math.max(W, L + R + 150); const rowH = 16, hgt = rows.length * rowH + 4, mx = Math.max(.05, ...rows.map(r => r.p));
    return `<svg viewBox="0 0 ${W} ${hgt}" width="${W}">` + rows.map((r, k) => {
      const y = k * rowH, w = r.p / mx * (W - L - R);
      return `<text x="${L - 5}" y="${y + 12}" font-size="11" text-anchor="end">${esc(short(r.h))}</text><rect x="${L}" y="${y + 3}" width="${w}" height="10" class="${r.cls || cls}"/>
        <text x="${L + w + 4}" y="${y + 12}" font-size="10.5" class="faint">${lab(r.p)}</text>`;
    }).join("") + "</svg>";
  }
  function diverge(rows, W = 330) {                   // rows: {h, d, p}: their likely bans and what each does to your win chance
    const L = labW(rows.map(r => `${NAMES[r.h]} ${pct(r.p)}`), 11) + 8, lab = Math.ceil(tw("−0.00", 10.5)) + 8, plot = W - L - 2 * lab, rowH = 17, hgt = rows.length * rowH + 4;
    const mx = Math.max(.002, ...rows.map(r => Math.abs(r.d))), c = L + lab + plot / 2, X = d => c + d / mx * plot / 2;
    return `<svg viewBox="0 0 ${W} ${hgt}" width="${W}"><line class="axis" x1="${c}" x2="${c}" y1="0" y2="${hgt}"/>` + rows.map((r, k) => {
      const y = k * rowH, x0 = Math.min(c, X(r.d)), w = Math.abs(X(r.d) - c);
      return `<text x="${L - 5}" y="${y + 12}" font-size="11" text-anchor="end">${esc(NAMES[r.h])} <tspan class="faint">${pct(r.p)}</tspan></text><rect x="${x0}" y="${y + 3}" width="${Math.max(.5, w)}" height="10" class="${r.d >= 0 ? "us" : "them"}"/>
        <text x="${r.d >= 0 ? X(r.d) + 4 : X(r.d) - 4}" y="${y + 12}" font-size="10.5" class="faint" text-anchor="${r.d >= 0 ? "start" : "end"}">${pp(r.d)}</text>`;
    }).join("") + "</svg>";
  }
  function whySplit(T) {                              // the ban model's utility for their next ban, split into its parts, against an average legal hero
    const W = T.why, legal = T.cands, P = T.pe, parts = h => [W.base[h], W.prot[h], W.fear[h], W.targ[h], W.react[h]];
    const all = legal.map(parts), mean = [0, 1, 2, 3, 4].map(k => all.reduce((a, p) => a + p[k], 0) / all.length);
    const rs = legal.slice().sort((a, b) => P[b] - P[a]).slice(0, 8).map(h => ({ h, c: parts(h).map((v, k) => v - mean[k]) }));
    const sum = (r, sg) => r.c.filter(v => sg * v > 0).reduce((a, b) => a + b, 0), lo = Math.min(0, ...rs.map(r => sum(r, -1))), hi = Math.max(...rs.map(r => sum(r, 1)));
    const key = [["popular on this map, rank and side", "them", 1], ["they protect it", "faint", .7], ["it beats what they play", "them", .5], ["your team plays it", "us", 1], ["reaction to the bans so far", "us", .45]];
    const Lw = labW(rs.map(r => NAMES[r.h]), 11.5) + 10, val = Math.ceil(tw("100%", 10.5)) + 8, rowH = 19, X = v => Lw + (v - lo) / (hi - lo || 1) * 320;
    let g = rs.map((r, k) => { let p = 0, n = 0; const segs = r.c.map((v, j) => { const a = v >= 0 ? p : n; if (v >= 0) p += v; else n += v;
        return `<rect x="${X(Math.min(a, a + v))}" y="0" width="${Math.abs(X(a + v) - X(a))}" height="11" class="${key[j][1]}" opacity="${key[j][2]}"/>`; }).join("");
      return `<g transform="translate(0 ${k * rowH + 4})"><text x="${Lw - 6}" y="10" font-size="11.5" text-anchor="end">${esc(NAMES[r.h])}</text>${segs}<text x="${X(p) + 4}" y="10" font-size="10.5" class="faint">${pct(P[r.h])}</text></g>`; }).join("");
    let kx = Lw, ky = rs.length * rowH + 24; const rows = [];
    for (const [t, c, o] of key) { const w = 26 + tw(t, 11); if (kx + w > Lw + 320 + val && kx > Lw) { kx = Lw; ky += 16; } rows.push(`<rect x="${kx}" y="${ky - 9}" width="10" height="10" class="${c}" opacity="${o}"/><text x="${kx + 14}" y="${ky}" font-size="11">${t}</text>`); kx += w; }
    g += `<line class="axis" x1="${X(0)}" x2="${X(0)}" y1="0" y2="${rs.length * rowH + 4}"/>` + rows.join("");
    const Wd = Lw + 320 + val;
    return `<svg viewBox="0 0 ${Wd} ${ky + 8}" width="${Wd}">${g}</svg>`;
  }
  const colFig = (svg, cap, title = "") => `<figure style="width:${+/width="(\d+(?:\.\d+)?)"/.exec(svg)[1]}px;max-width:100%">${title ? `<h3>${title}</h3>` : ""}${svg}<figcaption>${cap}</figcaption></figure>`;

  // ---------------------------------------------------------------- advice
  let lastVerdict = "";
  function winLine() {                                 // your win chance as things stand: following the advice, and if both teams ban as usual
    if (!WIN) return "";
    const o = WIN.opt.reduce((a, b) => a + b, 0) / WIN.opt.length, b = WIN.beh ? WIN.beh[0] : null;
    return `<div class="vtb">Win chance ${nextBan() >= 6 ? "after these bans" : "from here"}: <b>${pct1(o)}</b>${nextBan() < 6 ? " if you follow the advice" : ""}${b !== null && nextBan() < 6 ? `, ${pct1(b)} if both teams ban as usual` : ""}</div>`;
  }
  function headline() {
    const sug = suggested(); if (!sug.length) return "";
    const cnt = turnCount(), pair = cnt === 2 && sug.length === 2, hs = sug.map(x => x.h), x = hs[0], key = hs.join("+");
    const fresh = key !== lastVerdict; lastVerdict = key;
    const V = pair ? sug[0].pair.V : RES.V[x], mv = pair ? null : memberV(x);
    const runner = topBans(3).find(h => h !== x);
    let judge = "";
    if (!pair && runner !== undefined) {
      const d = RES.Q.map(q => q[x] - q[runner]), k = d.filter(v => v > 0).length, M = d.length;
      judge = k === M ? `Ahead of ${esc(NAMES[runner])} (${pp(RES.V[runner])}) in all ${M} model members` : `Close to ${esc(NAMES[runner])} (${pp(RES.V[runner])}): ahead in ${k} of ${M} model members`;
    }
    const rare = RES.pe[x] < .01 ? `Typical teams ban ${esc(NAMES[x])} here ${RES.pe[x] < .001 ? "almost never" : `about ${(100 * RES.pe[x]).toFixed(1)}% of the time`}` : "";
    let rob = "";
    if (!pair && E.ready("aux")) { const R = robustCheck(x); if (R) rob = R; }
    const name = pair ? `<span class="vname">${esc(NAMES[hs[0]])}</span> then <span class="vname">${esc(NAMES[hs[1]])}</span>` : `<span class="vname">${esc(NAMES[x])}</span>`;
    const spread = pair ? `members ${pp(Math.min(...sug[0].pair.mv))} to ${pp(Math.max(...sug[0].pair.mv))}` : `members ${pp(Math.min(...mv))} to ${pp(Math.max(...mv))}`;
    return `<div class="verdict${pair ? " pair" : ""}${fresh ? " fresh" : ""}"><div class="vpics">${hs.map(h => `<img src="${img(h)}" alt="">`).join("")}</div>
      <div class="vtext"><div class="vcall">Ban ${name}</div>
        <div class="vest" title="Change in your team's win probability, in points, against ${pair ? "a typical first ban (then the best second ban)" : "a typical ban"}, both followed by the advice"><span class="vnum">${pp(V)}</span> points${pair ? " for the pair" : ""} <span class="vci">${spread}</span></div>
        <div class="vjudge">${[judge, rare, rob].filter(Boolean).join(". ")}</div>${winLine()}</div></div>`;
  }
  function robustCheck(x) {                            // does the ban hold up if they ban as badly for you as they plausibly can?
    const s = lobby(), R = E.children(s, RES.e, RES.cands, true, "robust"); if (!R) return "";
    const Q = R[0], pool = RES.cands.filter(h => RES.supported.has(h)), order = pool.slice().sort((a, b) => Q[b] - Q[a]), rk = order.indexOf(x) + 1;
    return rk <= 3 ? `Also ${rk === 1 ? "the best" : `number ${rk}`} against a worst-case opponent` : `Against a worst-case opponent it ranks ${rk}, behind ${esc(NAMES[order[0]])}`;
  }
  function pairTable(P) {
    return `<div style="overflow-x:auto"><table style="width:100%"><caption>Best pairs for this turn, in the order to ban them (the second ban's value depends on the first). After each of the six best first bans,
      every second ban is scored by the network one position further on. Value: change in your team's win probability, in points, against a typical first ban followed by the best second ban.
      Click a row to ban both.</caption><tr><th>#</th><th>First, then second</th><th class="r">Value</th><th class="r">Members</th></tr>` +
      P.slice(0, 8).map((p, k) => `<tr class="pickpair" data-a="${p.a}" data-b="${p.b}" title="Ban ${esc(NAMES[p.a])}, then ${esc(NAMES[p.b])}"><td class="num">${k + 1}</td>
        <td><img class="mini" src="${img(p.a)}" alt=""><img class="mini" src="${img(p.b)}" alt=""> ${esc(NAMES[p.a])}, then ${esc(NAMES[p.b])}</td>
        <td class="r">${pp(p.V)}</td><td class="r">${pp(Math.min(...p.mv))} to ${pp(Math.max(...p.mv))}</td></tr>`).join("") + `</table></div>`;
  }
  function subsFig(h) {                                // where a hero's mains go when it is banned (the pick model)
    const r = SUB.get(NAMES[h]); if (!r || !r.top.length) return "";
    const idx = new Map(NAMES.map((n, i) => [n, i])), rows = r.top.slice(0, 6).map(([n, p]) => ({ h: idx.get(n), p, cls: ROLES[idx.get(n)] === ROLES[h] ? "them" : "faint" }));
    return colFig(probChart(rows, "them", 290), `Where players whose main is ${esc(NAMES[h])} go when it is banned: the pick model's average first choice, over maps and sides, for
      the ${fmt(r.mains)} players in the stand-in pool whose main it is. ${pct(r.same_role)} stay in the same role (red bars).`);
  }
  const quiet = html => html.replace(/<(figcaption|caption)>([\s\S]*?)<\/\1>/g, (m, t, x) => `<${t}><details class="more"><summary>How to read this</summary>${x}</details></${t}>`);
  function renderAdvice() {
    const e = nextBan(); let html = "";
    if (e >= 6) html += `<h2>Ban phase complete</h2>${winLine() ? `<div class="verdict"><div class="vtext">${winLine()}</div></div>` : ""}<p class="small">All six bans are in. Below: what each team is now likely to open.</p>`;
    else if (ourTurn() && RES) {
      const cnt = turnCount(), top = topBans(10), sug = suggested();
      html += `<h2>Your ban #${e + 1}${cnt === 2 ? ` and #${e + 2}` : ""}</h2>` + headline();
      if (cnt === 2) html += PAIRS ? pairTable(PAIRS) : `<p class="small">Scoring pairs&hellip;</p>`;
      html += rankTable(top, [
        { th: "Typical", td: h => RES.pe[h] < .001 ? "&lt;0.1%" : pct1(RES.pe[h]) }, { th: "They open", td: h => LU ? pct(LU.pt[h]) : "" }, { th: "You open", td: h => LU ? pct(LU.pu[h]) : "" }],
        `Value: change in your team's win probability, in points, if you make this ban and follow the advice afterwards, against a typical ban (also followed by the advice). The dot is the
        average of the three model members and the ticks are the members. Rows are in the advice's order: the average minus half the members' spread. Typical: how often a typical team in
        your seat makes this ban now (the advice only picks bans typical teams make at least 0.1% of the time). They open, you open: the chance each team opens the hero if it stays
        available (the previous model's lineup network). Click a row, or press 1 to 8, to ban.`);
      const h0 = sug.length ? sug[0].h : top[0];
      const sf = subsFig(h0); if (sf) html += `<h2>If you ban ${esc(NAMES[h0])}, where its mains go</h2><div class="cols">${sf}</div>`;
    } else if (THEM) {
      const T = THEM, top = T.cands.slice().sort((a, b) => T.pe[b] - T.pe[a]), nx = top.slice(1, 4).map(h => `${esc(NAMES[h])} ${pct(T.pe[h])}`);
      html += `<h2>Their ban #${e + 1}</h2><div class="verdict them"><div class="vpics"><img src="${img(top[0])}" alt=""></div>
        <div class="vtext"><div class="vcall">Likeliest: <span class="vname">${esc(NAMES[top[0]])}</span></div>
        <div class="vest"><span class="vnum">${pct(T.pe[top[0]])}</span> <span class="vci">then ${nx.join(", ")}</span></div>${winLine()}</div></div>`;
      const rows = top.slice(0, 10).map(h => ({ h, p: T.pe[h], d: T.mu[h] - T.base }));
      html += `<div class="cols">${colFig(whySplit(T), `Why a typical team in their seat would ban each hero next: the ban model's reasons against an average hero (log-odds, so only the
        lengths relative to each other matter). "Your team plays it": teams go after the heroes the other team's players play, and the heroes your team shows say who your players are.
        The percentage is the chance of ban #${e + 1}.`, "Why they would ban it")}
        ${isNaN(rows[0].d) ? "" : colFig(diverge(rows), `What each of their likely bans does to your win chance, in points, against their typical ban (the value networks, with your later
        bans as advised). Enter what they actually ban, or click the faded box if they banned the likeliest hero.`, "What their ban does to your win chance")}</div>`;
    }
    if (LU) {
      const bans = bannedSet(), revs = teamSet();
      const them = Array.from(LU.pt.keys()).filter(h => !bans.has(h)).sort((a, b) => LU.pt[b] - LU.pt[a]).slice(0, 10);
      const us = Array.from(LU.pu.keys()).filter(h => !bans.has(h) && !revs.has(h)).sort((a, b) => LU.pu[b] - LU.pu[a]).slice(0, 10);
      html += `<h2>Likely openers</h2><figure>${butterfly(them, us, LU.pt, LU.pu, revs)}<figcaption>Chance each team opens a hero, given the bans so far and the heroes your team shows
        (the previous model's lineup network: the new model's drafts live inside its value networks). The ten likeliest for each team, on one list.</figcaption></figure>`;
    }
    $("adviceBody").innerHTML = quiet(html);
    $("adviceBody").querySelectorAll("tr.pick").forEach(el => el.onclick = () => { st.active = { kind: "ban" }; place(+el.dataset.h); });
    $("adviceBody").querySelectorAll("tr.pickpair").forEach(el => el.onclick = () => { if (ourTurn() && turnCount() === 2) banBoth(+el.dataset.a, +el.dataset.b); });
  }

  // ---------------------------------------------------------------- update loop
  let pending = 0;
  function update(recompute = true) {
    writeHash();
    $("firstBtn").classList.toggle("on", st.first); $("secondBtn").classList.toggle("on", !st.first);
    $("tierSel").value = st.tier; $("mapSel").value = String(st.map);
    renderTeam(); renderTurnHint();
    if (!recompute && (RES || THEM || DONE)) { renderBans(); renderRoster(); return; }
    $("mainEl").classList.add("busy"); const my = ++pending;
    setTimeout(() => {
      if (my !== pending) return;
      const s = lobby(), e = s.bans.length;
      RES = PAIRS = THEM = PATH = null; DONE = e >= 6 ? true : null;
      if (e < 6 && ours(e)) RES = E.ourTurn(s); else if (e < 6) THEM = E.theirTurn(s);
      WIN = { opt: E.winNow(s), beh: E.ready("aux") ? E.winNow(s, "behaviour") : null }; if (!WIN.opt) WIN = null;
      PATH = e < 6 ? E.path(s) : null;
      const s7 = { firstUs: st.first, bans: st.bans.slice(), rev: st.team.filter(h => h >= 0), m: v7map(st.map), r0: META.tiers[st.tier] };
      LU = E7.lineups(E7.ctx(s7));
      renderBans(); renderRoster(); renderAdvice(); $("mainEl").classList.remove("busy");
      if (RES && turnCount() === 2) setTimeout(() => {                      // pairs take about half a second: after the first render
        if (my !== pending) return;
        PAIRS = (E.pairs(s, RES) || []).slice(0, 12); renderBans(); renderRoster(); renderAdvice();
      }, 20);
    }, 15);
  }

  // ---------------------------------------------------------------- method section (text + figures from the model's report)
  function renderMethod() {
    const R = REP, C = R.checks, cmp = R.comparisons, t = R.test, d = C.drafts, ope = R.ope.decisions, bc = R.ope.behaviour_calibration;
    const ci = r => `${(r.mean >= 0 ? "+" : "−") + Math.abs(r.mean).toFixed(4)} (${r.lo.toFixed(4)} to ${r.hi.toFixed(4)})`;
    const cq = q => `${q.mean_pts >= 0 ? "+" : "−"}${Math.abs(q.mean_pts).toFixed(2)} (${q.lo_pts.toFixed(2)} to ${q.hi_pts.toFixed(2)})`;
    const out8 = t.outcome_recalibrated || t.outcome.v8, out7 = t.outcome["v7.2"], banT = t.ban;
    const slopes = Object.values(bc).map(v => v.slope), sLo = Math.min(...slopes).toFixed(2), sHi = Math.max(...slopes).toFixed(2);
    const fb = C.first_ban_by_role;
    const idx = new Map(NAMES.map((n, i) => [n, i]));
    const panel = r => {                                // share of each hero's mains who stay in the role when it is banned
      const rows = SUBS.table.filter(x => x.same_role !== null && ROLES[idx.get(x.hero)] === r).map(x => ({ h: idx.get(x.hero), p: x.same_role })).sort((a, b) => b.p - a.p);
      return `<div><h3>${ROLE_NAMES[r]}</h3>${probChart(rows, "them", 250)}</div>`;
    };
    $("method").innerHTML = `<details class="how"><summary>How it works, and how well it holds up</summary><div class="mgrid"><div class="mcol"><h2>Method</h2>
      <p>A ban removes a hero from both teams, you usually don't know who is on the other side, and a ban changes what both teams draft. So the model plays lobbies out. It simulates
      ${fmt(R.world_model.lobbies)} lobbies like yours: stand-in players near the lobby's rank, drawn from the real players who play there and following the heroes your team shows, the rest of the ban phase,
      both teams' drafts after the bans, and who wins. Then it trains one small network per ban position, backwards from the last ban: each network values a lobby after that many bans,
      assuming your later bans follow the advice and theirs follow what teams really do.</p>
      <p class="formula">value(<i>x</i>) = win chance after you ban <i>x</i> − win chance after a typical ban</p>
      <p>A ban's value is read straight from the next position's network, so the rest of the ban phase, the other team's replies, and both teams' substitutions are all inside it.
      Three networks are trained on different resamples of the simulated lobbies. The advice takes the highest average minus half their spread, among bans a typical team makes at
      least 0.1% of the time, so it does not rest on a ban the data never shows.</p>
      <ul>
        <li><b>Drafts</b>: a pick model fitted on every Season 10 opening pick, with each player's history as of the match (minutes, skill on each hero, role shares, how they substitute when
          their main is banned) and their teammates' picks. Its simulated drafts match real teams: 2-2-2 in ${pct(d.two_two_two.model)} of drafts (real ${pct(d.two_two_two.real)}),
          triple support ${pct(d.triple_support.model)} (${pct(d.triple_support.real)}), and a player whose main is banned stays in its role ${pct(d.role_stay_when_forced.model)} of the time (${pct(d.role_stay_when_forced.real)}).</li>
        <li><b>What wins</b>: an outcome model on both lineups, the players' histories (familiarity, skill on the hero, whole-match damage and healing, premade pairs), hero pairs and triples,
          map and side. On later matches it beats the previous model's outcome model (log loss ${out8.logloss.toFixed(4)} against ${out7.logloss.toFixed(4)}), and it is recalibrated on held-out matches.</li>
        <li><b>Their bans</b>: a ban model fitted on every Season 10 ban. Teams avoid banning their own players' heroes, ban heroes that beat what they play, react to earlier bans, and go after the
          heroes the other team's players play. That last pull is real: computed from the players of an unrelated match at the same rank, it predicts nothing
          (${cmp["placebo_" + R.selected.ban] ? ci(cmp["placebo_" + R.selected.ban]) : "not tested"} nats per ban better with the real other team).</li>
      </ul>
      </div><div class="mcol"><h2>Checks on ${fmt(R.splits.test.n)} later matches</h2>
      <p class="small">From the notebook run ${esc(R.run)} that fitted these models. Every model was chosen on earlier matches, by a rule fixed before any result, and the last ${fmt(R.splits.test.n)} matches were scored once.</p>
      <table><tr><th>Check</th><th class="r">Result</th></tr>
        <tr><td>Their bans: log loss per ban (the previous model's ban model)</td><td class="r">${banT[R.selected.ban].toFixed(4)} (${banT.A.toFixed(4)})</td></tr>
        <tr><td>Who wins: log loss per match (previous model), calibration slope</td><td class="r">${out8.logloss.toFixed(4)} (${out7.logloss.toFixed(4)}), ${out8.calib_slope.toFixed(2)}</td></tr>
        <tr><td>Simulated drafts on real teams: 2-2-2 / triple support / stays in role when the main is banned</td><td class="r">${pct(d.two_two_two.model)} / ${pct(d.triple_support.model)} / ${pct(d.role_stay_when_forced.model)} (real ${pct(d.two_two_two.real)} / ${pct(d.triple_support.real)} / ${pct(d.role_stay_when_forced.real)})</td></tr>
        <tr><td>Networks against a brute-force simulation of your last ban: points left on the table (a typical ban)</td><td class="r">${C.brute_force.regret_network_pts.toFixed(2)} (${C.brute_force.regret_typical_pts.toFixed(2)})</td></tr>
        <tr><td>Inside the simulation: following the advice against banning as players do</td><td class="r">+${C.policy.optimal_vs_players.gain_pts.toFixed(2)} pts</td></tr>
        ${ope.map(q => `<tr><td>Real games: following the advice at your ban ${q.decision} (weights capped, 95% interval)</td><td class="r">${cq(q.doubly_robust_capped)} pts</td></tr>`).join("")}
      </table>
      <p class="small">In real games the advice cannot be told apart from what players do: every interval includes zero. The gain the simulation expects (about
      ${C.policy.optimal_vs_players.gain_pts.toFixed(1)} points per game) is too small for ${fmt(R.ope.matches)} games to show, players made the advised ban only about ${pct(ope[0].match_rate)} of the time,
      and bans players almost never make (like many of the support bans the advice likes) cannot be tested on past games at all. The simulation's win chances also spread lobbies further
      apart than real games do (a calibration slope of ${sLo} to ${sHi} against real results), so read the win-chance lines as a ranking more than as exact percentages.</p>
      ${fb ? `<p class="small">The advice's first ban by role (vanguard / duelist / strategist): ${fb.policy.map(pct).join(" / ")}, against ${fb.players.map(pct).join(" / ")} for players.
      It bans strategists about twice as often as players do.</p>` : ""}
      <h2>Limits</h2>
      <ul class="small">
        <li>Fitted on PC ranked Season 10 matches from ${fitDates}, mostly Diamond to Celestial. Few lobbies average above 5,000.</li>
        <li>Ranks map to scores at about 100 points per division (Grandmaster 3 ≈ 4,550). The exact tier boundaries are approximate.</li>
        <li>Hovers are not in the data. A shown hero is treated as that player's likely pick, and a teammate keeps a shown hero about four times in five.</li>
        <li>Every other player is anonymous. The values average over the real players who play at your rank, not the people in your lobby.</li>
        <li>Mid-match swaps are outside the model (it drafts opening lineups). Tested separately on real matches: they did not measurably change what a ban is worth.</li>
        <li>The three networks' spread shows where they disagree, not a full interval: refitting everything on other matches would move the values more.</li>
        <li>God Quarry is left out (7 matches in the data).</li>
      </ul></div></div></details>
      <h2>When a hero is banned, how many of its mains stay in the role</h2>
      <figure><div class="cols">${[0, 1, 2].map(panel).join("")}</div>
        <figcaption>The pick model's average first choice for players whose main (30% or more of their minutes) is banned, before teammates pick: the share that picks another hero of the same role.</figcaption></figure>`;
  }
  const SPL = REP.splits, day = t => new Date(t.replace(" ", "T") + "Z").toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" });
  const fitN = SPL.train.n + SPL.validation.n;
  const fitDates = `${day(SPL.train.first_utc)} to ${day(SPL.validation.last_utc)} ${new Date(SPL.validation.last_utc.replace(" ", "T") + "Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`;
  status(""); $("fitted").textContent = `Fitted on ${fmt(fitN)} PC ranked matches from Season 10 (${fitDates}), model ${REP.version} (run ${REP.run}).`;
  renderMethod(); update();
  document.fonts && document.fonts.ready.then(() => { renderMethod(); if (RES || THEM || DONE) renderAdvice(); });
  auxP.then(b => { E.addBuffer("aux", b); update(); }).catch(() => {});
})();
