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
  status(`Loading the model (${(LAY.files.opt.bytes / 1e6).toFixed(0)} MB)…`);
  E.addBuffer("opt", await fetchBin(`model8/${LAY.files.opt.path}${VQ}`, LAY.files.opt.bytes, "Loading the model"));
  const auxP = LAY.files.aux ? fetchBin(`model8/${LAY.files.aux.path}${VQ}`, LAY.files.aux.bytes, null) : null;   // behaviour and robust members: after the page is up
  // a value's range, in plain words: the page never says how many networks sit behind it (the members' lowest to highest in
  // v8.1, one SD either side of the teachers' mean from v8.2 on)
  const spreadTxt = sp => `range ${pp(sp.lo)} to ${pp(sp.hi)}`;
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
  function rankTable(top, cols, cap) {                // one row per ban: value, the networks' range drawn in the row, extra columns
    const lo = Math.min(0, ...top.map(h => RES.spread(h).lo)), hi = Math.max(0, ...top.map(h => RES.spread(h).hi)), CW = 200, X = v => 17 + (v - lo) / (hi - lo || 1) * (CW - 34);
    const step = niceStep(hi - lo, 3); let ticks = "";
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-12; t += step) ticks += `<text x="${X(t)}" y="10" font-size="10" text-anchor="middle" class="faint">${pp(t, step < .005 ? 2 : 1)}</text>`;
    const cell = h => { const v = RES.spread(h), neg = RES.V[h] < 0, tk = [v.lo, v.hi];
      return `<svg width="${CW}" height="16" viewBox="0 0 ${CW} 16" style="display:inline-block;vertical-align:middle"><line class="grid" x1="${X(0)}" x2="${X(0)}" y1="0" y2="16"/>
        <line class="whisk" x1="${X(v.lo)}" x2="${X(v.hi)}" y1="8" y2="8"/>${tk.map(u => `<line class="whisk" x1="${X(u)}" x2="${X(u)}" y1="5" y2="11"/>`).join("")}<circle cx="${X(RES.V[h])}" cy="8" r="3.6" class="${neg ? "them" : "us"}"/></svg>`; };
    return `<div style="overflow-x:auto"><table style="width:100%"><caption>${cap}</caption>
      <tr><th>#</th><th></th><th>Ban</th><th class="r">Value</th><th><svg width="${CW}" height="13" viewBox="0 0 ${CW} 13" style="display:block">${ticks}</svg></th>${cols.map(c => `<th${c.r === false ? "" : ' class="r"'}>${c.th}</th>`).join("")}</tr>` +
      top.map((h, k) => `<tr class="pick" data-h="${h}" title="${esc(NAMES[h])}: ${pp(RES.V[h])} points (${spreadTxt(RES.spread(h))}). Click to ban."><td class="num">${k + 1}</td><td><img class="mini" src="${img(h)}" alt=""></td>
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

  // ---------------------------------------------------------------- the advice's figures: portraits for labels, numbers on hover
  // The page's palette only: ink and greys, blue for good for you, red for bad for you. Roles are told apart by position and labels.
  const RN = ["vanguard", "duelist", "strategist"];
  const sum = a => a.reduce((x, y) => x + y, 0), mean = a => sum(a) / a.length, IDX = new Map(NAMES.map((n, i) => [n, i]));
  const nm = h => SHORT[NAMES[h]] || NAMES[h];
  const tip = document.createElement("div"); tip.className = "tip"; document.body.appendChild(tip);
  document.addEventListener("mousemove", ev => {
    const el = ev.target.closest ? ev.target.closest("[data-tip]") : null; if (!el) { tip.classList.remove("on"); return; }
    tip.innerHTML = el.getAttribute("data-tip"); const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = ev.clientX + 14, y = ev.clientY + 16; if (x + w > innerWidth - 8) x = ev.clientX - w - 14; if (y + h > innerHeight - 8) y = ev.clientY - h - 12;
    tip.style.left = x + "px"; tip.style.top = y + "px"; tip.classList.add("on");
  });
  const T_ = html => ` data-tip="${esc(html)}"`;
  const pic = (h, cx, cy, r, cls = "") => `<image href="${img(h)}" x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" clip-path="url(#cc)" preserveAspectRatio="xMidYMid slice"${cls ? ` class="${cls}"` : ""}/>`;
  function ticks(lo, hi, n = 4) { const raw = (hi - lo) / n || .001, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p, s_ = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; const o = []; for (let t = Math.ceil(lo / s_) * s_; t <= hi + 1e-12; t += s_) o.push(+t.toFixed(10)); return o; }
  function spread(ys, gap, lo, hi) {                   // 1-D label placement: keep the order, push apart to at least `gap`, stay inside [lo, hi]
    const o = ys.slice(); for (let i = 1; i < o.length; i++) o[i] = Math.max(o[i], o[i - 1] + gap);
    if (o.length && o[o.length - 1] > hi) { o[o.length - 1] = hi; for (let i = o.length - 2; i >= 0; i--) o[i] = Math.min(o[i], o[i + 1] - gap); }
    for (let i = 0; i < o.length; i++) o[i] = Math.max(o[i], lo + i * gap); return o;
  }
  const band = (x0, y0a, y0b, x1, y1a, y1b) => { const xm = (x0 + x1) / 2; return `M${x0},${y0a}C${xm},${y0a} ${xm},${y1a} ${x1},${y1a}L${x1},${y1b}C${xm},${y1b} ${xm},${y0b} ${x0},${y0b}Z`; };
  const figW = () => Math.max(340, Math.min(820, ($("adviceBody").clientWidth || 640) - 4));
  const hs = t => t ? `<span class="hs">${t}</span>` : "";
  // ---- the ban board: every ban as its portrait, placed by its value (a beeswarm, so none overlap); rare bans greyed; click to ban
  function banBoard(W) {
    const R = RES, best = R.best, items = R.cands.map(h => ({ h, v: R.V[h] })).sort((a, b) => b.v - a.v).slice(0, 22);
    if (!items.some(i => i.h === best)) items.push({ h: best, v: R.V[best] });
    items.sort((a, b) => (b.h === best) - (a.h === best) || b.v - a.v);
    const sb = R.spread(best), PAD = 30, vs = items.map(i => i.v).concat([sb.lo, sb.hi]), vlo = Math.min(0, ...vs), vhi = Math.max(...vs), span = vhi - vlo || .001, lo = vlo - span * .05, hi = vhi + span * .06;
    const X = v => PAD + (v - lo) / (hi - lo) * (W - 2 * PAD), rb = W < 560 ? 21 : 25, rs = W < 560 ? 11 : 13, placed = [];
    for (const it of items) {
      it.r = it.h === best ? rb : rs; it.x = X(it.v); it.y = 0;
      for (let k = 0; k < 400; k++) { const dy = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2; if (!placed.some(p => Math.hypot(p.x - it.x, p.y - dy) < p.r + it.r + 2)) { it.y = dy; break; } }
      placed.push(it);
    }
    const ext = Math.max(...items.map(i => Math.abs(i.y) + i.r)) + 4, cy = ext + 28, base = cy + ext + 18, Hh = base + 36;
    let g = ticks(lo, hi, W < 560 ? 3 : 5).map(t => `<line x1="${X(t)}" x2="${X(t)}" y1="14" y2="${base}" stroke="var(--hair)"/><text x="${X(t)}" y="${base + 15}" font-size="11" text-anchor="middle" class="faint">${pp(t, t && Math.abs(t) < .01 ? 2 : 1)}</text>`).join("");
    g += `<line x1="${X(0)}" x2="${X(0)}" y1="14" y2="${base}" stroke="var(--ink)" stroke-dasharray="2 3"/><text x="${X(0)}" y="${base + 29}" font-size="11" text-anchor="middle" class="faint">a typical ban</text>`;
    g += `<text x="${W - PAD}" y="${base + 29}" font-size="11" text-anchor="end" class="faint">points against a typical ban →</text>`;
    const b0 = items[0], m = sb;
    const my = base - 8;                                 // the advice's range, on a line of its own under the board
    g += `<g${T_(`<b>${esc(NAMES[best])}</b> ${pp(R.V[best])}<br><span class="d">${spreadTxt(m)}</span>`)}><line x1="${X(m.lo)}" x2="${X(m.hi)}" y1="${my}" y2="${my}" stroke="var(--blue)" stroke-width="1.5"/>`
      + [m.lo, m.hi].map(u => `<line x1="${X(u)}" x2="${X(u)}" y1="${my - 4}" y2="${my + 4}" stroke="var(--blue)" stroke-width="1.5"/>`).join("") + `<circle cx="${X(R.V[best])}" cy="${my}" r="3" fill="var(--blue)"/>`
      + `<rect x="${X(m.lo) - 4}" y="${my - 6}" width="${X(m.hi) - X(m.lo) + 8}" height="12" fill="transparent"/></g>`;
    for (const it of items.slice().reverse()) {
      const h = it.h, rare = !R.supported.has(h), isB = h === best, x = it.x, y = cy + it.y;
      const tipH = `<b>${esc(NAMES[h])}</b> ${pp(it.v)}<br><span class="d">${spreadTxt(R.spread(h))}<br>typical teams ban it now: ${R.pe[h] < .001 ? "under 0.1%" : pct1(R.pe[h])}${LU ? `<br>they open it: ${pct(LU.pt[h])} · you: ${pct(LU.pu[h])}` : ""}${rare ? "<br>too rare for the advice to pick" : ""}</span><br>click to ban`;
      g += `<g data-ban="${h}"${T_(tipH)}>${pic(h, x, y, it.r, rare ? "rare" : "")}<circle class="ring" cx="${x}" cy="${y}" r="${it.r}" fill="none" stroke="${isB ? "var(--blue)" : "var(--paper)"}" stroke-width="${isB ? 3 : 1.5}"/></g>`;
    }
    g += `<text x="${b0.x}" y="${cy + b0.y - b0.r - 8}" font-size="13" font-weight="600" text-anchor="middle" class="us">${esc(nm(best))}</text>`;
    return `<svg viewBox="0 0 ${W} ${Hh}" width="${W}">${g}</svg>`;
  }
  // ---- where the banned hero's mains go: a Sankey, each flow in the colour of the role it ends in
  function subsFlow(h, W) {
    const r = SUB.get(NAMES[h]); if (!r || !r.top.length || r.same_role === null) return null;
    const role = ROLES[h], tops = r.top.slice(0, 6).map(([n, p]) => ({ h: IDX.get(n), p })), same = tops.filter(t => ROLES[t.h] === role), oth = tops.filter(t => ROLES[t.h] !== role);
    const remS = Math.max(0, r.same_role - sum(same.map(t => t.p))), remO = Math.max(0, 1 - r.same_role - sum(oth.map(t => t.p)));
    const nodes = same.sort((a, b) => b.p - a.p).concat(remS > .005 ? [{ other: `other ${RN[role]}s`, p: remS, role }] : [])
      .concat(oth.sort((a, b) => ROLES[a.h] - ROLES[b.h] || b.p - a.p)).concat(remO > .005 ? [{ other: "another role", p: remO, role: -1 }] : []);
    const Hh = 290, top = 12, gap = 7, avail = Hh - 2 * top - gap * (nodes.length - 1), x0 = 96, nw = 11, x1 = Math.min(W - 180, x0 + 230);
    let y = top, yl = top + gap * (nodes.length - 1) / 2, g = ""; const ys = [];
    nodes.forEach(n => { const hgt = Math.max(1.5, n.p * avail); n.y0 = y; n.y1 = y + hgt; n.l0 = yl; n.l1 = yl + n.p * avail; y += hgt + gap; yl += n.p * avail; ys.push((n.y0 + n.y1) / 2); });
    const col = n => (n.other ? n.role === role : ROLES[n.h] === role) ? "var(--faint)" : "var(--blue)";
    for (const n of nodes) {
      g += `<path d="${band(x0 + nw, n.l0, n.l1, x1, n.y0, n.y1)}" fill="${col(n)}" opacity="${n.other ? .22 : .38}"${T_(`${esc(NAMES[h])} mains → <b>${esc(n.other || NAMES[n.h])}</b> ${pct(n.p)}`)}/>`
        + `<rect x="${x1}" y="${n.y0}" width="${nw}" height="${n.y1 - n.y0}" fill="${col(n)}"/>`;
    }
    const cyl = top + gap * (nodes.length - 1) / 2 + avail / 2;
    g += `<rect x="${x0}" y="${top + gap * (nodes.length - 1) / 2}" width="${nw}" height="${avail}" fill="var(--ink)"/>` + pic(h, x0 - 38, cyl, 28)
      + `<text x="${x0 - 38}" y="${cyl + 45}" font-size="11" text-anchor="middle" class="faint">${fmt(r.mains)} mains</text>`;
    const ly = spread(ys, 23, top + 8, Hh - top - 8);
    nodes.forEach((n, i) => { const yy = ly[i], x = x1 + nw + 8;
      if (Math.abs(yy - ys[i]) > 3) g += `<line x1="${x1 + nw + 1}" x2="${x - 2}" y1="${ys[i]}" y2="${yy}" stroke="var(--hair)"/>`;
      g += n.other ? `<text x="${x + 2}" y="${yy + 4}" font-size="12" class="faint">${esc(n.other)} <tspan font-weight="600">${pct(n.p)}</tspan></text>`
                   : pic(n.h, x + 10, yy, 10) + `<text x="${x + 25}" y="${yy + 4}" font-size="12.5">${esc(nm(n.h))} <tspan font-weight="600">${pct(n.p)}</tspan></text>`; });
    return { svg: `<svg viewBox="0 0 ${W} ${Hh}" width="${W}">${g}</svg>`, leave: 1 - r.same_role, role };
  }
  // ---- their ban as one strip: width is its chance, colour what it does to you (red hurts, blue helps)
  function forecastStrip(T, W) {
    const top = T.cands.slice().sort((a, b) => T.pe[b] - T.pe[a]), seg = []; let cum = 0;
    for (const h of top) { if (seg.length >= 11 || (cum > .8 && seg.length >= 6)) break; seg.push(h); cum += T.pe[h]; }
    const d = h => T.mu[h] - T.base, ok = !isNaN(d(seg[0])), dmax = ok ? Math.max(.001, ...seg.map(h => Math.abs(d(h)))) : 1, sh = W < 600 ? 54 : 64, y0 = 4, Hh = sh + 58;
    let x = 0, g = "";
    for (const h of seg) {
      const w = T.pe[h] * W, dv = ok ? d(h) : 0, op = ok ? (.14 + .78 * Math.min(1, Math.abs(dv) / dmax)).toFixed(2) : .3, r = Math.min(sh / 2 - 6, w / 2 - 4);
      g += `<g${T_(`<b>${esc(NAMES[h])}</b> ${pct(T.pe[h])} chance${ok ? `<br><span class="d">if they ban it, your win chance ${pp(dv)} against their typical ban</span>` : ""}`)}>`
        + `<rect x="${x + .5}" y="${y0}" width="${Math.max(0, w - 1)}" height="${sh}" fill="${!ok ? "var(--faint)" : dv < 0 ? "var(--red)" : "var(--blue)"}" fill-opacity="${op}"/>${r >= 9 ? pic(h, x + w / 2, y0 + sh / 2, r) : ""}</g>`;
      if (w >= 56) g += `<text x="${x + 3}" y="${y0 + sh + 15}" font-size="12">${esc(nm(h))}</text><text x="${x + 3}" y="${y0 + sh + 29}" font-size="12" font-weight="600">${pct(T.pe[h])}</text>`;
      x += w;
    }
    g += `<rect x="${x + .5}" y="${y0}" width="${Math.max(0, W - x - 1)}" height="${sh}" fill="var(--panel)"${T_(`${top.length - seg.length} other heroes, ${pct(1 - cum)} together`)}/>`;
    if (W - x >= 56) g += `<text x="${x + 3}" y="${y0 + sh + 15}" font-size="12" class="faint">others</text><text x="${x + 3}" y="${y0 + sh + 29}" font-size="12" class="faint">${pct(1 - cum)}</text>`;
    if (ok) g += `<defs><linearGradient id="dv"><stop offset="0" stop-color="var(--red)"/><stop offset=".5" stop-color="var(--red)" stop-opacity=".1"/><stop offset=".5" stop-color="var(--blue)" stop-opacity=".1"/><stop offset="1" stop-color="var(--blue)"/></linearGradient></defs>`
      + `<rect x="${W - 170}" y="${Hh - 13}" width="90" height="8" fill="url(#dv)"/><text x="${W - 176}" y="${Hh - 5}" font-size="11" text-anchor="end" class="faint">hurts you</text><text x="${W - 74}" y="${Hh - 5}" font-size="11" class="faint">helps you</text>`;
    const worst = ok ? seg.filter(h => T.pe[h] >= .04).sort((a, b) => d(a) - d(b))[0] : undefined;
    return { svg: `<svg viewBox="0 0 ${W} ${Hh}" width="${W}">${g}</svg>`, top: top[0], worst };
  }
  // ---- two-ban turns: first ban (rows) then second (columns), colour only, the best pair outlined with its value; click a cell to ban both
  function pairGrid(P, W) {
    const rows = [], seen = new Set(); for (const p of P) if (!seen.has(p.a)) { seen.add(p.a); rows.push(p.a); }
    const val = new Map(P.map(p => [p.a + "," + p.b, p])), colBest = new Map(); for (const p of P) colBest.set(p.b, Math.max(colBest.get(p.b) ?? -9, p.V));
    const cs = W < 560 ? 40 : 48, L = cs + 10, T = cs + 14, nc = Math.max(4, Math.min(10, Math.floor((W - L) / cs))), cols = Array.from(colBest.keys()).sort((a, b) => colBest.get(b) - colBest.get(a)).slice(0, nc);
    const best = P[0], mx = Math.max(...P.map(p => Math.abs(p.V))), Wd = L + cols.length * cs + 4, Hh = T + rows.length * cs + 4, r = cs * .38;
    let g = cols.map((h, j) => `<g${T_(`then: <b>${esc(NAMES[h])}</b>`)}>${pic(h, L + j * cs + cs / 2, cs / 2 + 2, r)}</g>`).join("") + rows.map((h, i) => `<g${T_(`first: <b>${esc(NAMES[h])}</b>`)}>${pic(h, cs / 2 + 2, T + i * cs + cs / 2, r)}</g>`).join("");
    g += `<text x="${L - 4}" y="${T - 4}" font-size="10.5" text-anchor="end" class="faint">first ↓ then →</text>`;
    rows.forEach((a, i) => cols.forEach((b, j) => { const p = val.get(a + "," + b), x = L + j * cs, y = T + i * cs;
      if (!p) { g += `<rect x="${x + 2}" y="${y + 2}" width="${cs - 4}" height="${cs - 4}" fill="var(--panel)"/>`; return; }
      const op = (.1 + .82 * Math.min(1, Math.abs(p.V) / mx)).toFixed(2), isB = p === best;
      g += `<rect data-pair="${a},${b}" x="${x + 2}" y="${y + 2}" width="${cs - 4}" height="${cs - 4}" fill="${p.V >= 0 ? "var(--blue)" : "var(--red)"}" fill-opacity="${op}" style="cursor:pointer"${isB ? ' stroke="var(--ink)" stroke-width="2.5"' : ""}${T_(`<b>${esc(NAMES[a])}</b>, then <b>${esc(NAMES[b])}</b>: ${pp(p.V)}<br><span class="d">${spreadTxt(p.spread)}</span><br>click to ban both`)}/>`;
      if (isB) g += `<text x="${x + cs / 2}" y="${y + cs / 2 + 4}" font-size="${cs < 44 ? 11 : 12.5}" font-weight="700" text-anchor="middle" style="fill:var(--paper)" pointer-events="none">${pp(p.V)}</text>`; }));
    return `<svg viewBox="0 0 ${Wd} ${Hh}" width="${Wd}">${g}</svg>`;
  }
  // ---- where mains go when their hero is banned, every hero: one small Sankey per role; hover a hero to follow it
  function roleFlows() {
    const shares = r => { const role = ROLES[IDX.get(r.hero)], o = [0, 0, 0]; o[role] = r.same_role; const lst = [0, 0, 0];
      for (const [n, p] of r.top) { const q = ROLES[IDX.get(n)]; if (q !== role) lst[q] += p; }
      const others = [0, 1, 2].filter(q => q !== role), rest = Math.max(0, 1 - r.same_role - sum(others.map(q => lst[q]))), tot = sum(others.map(q => lst[q]));
      for (const q of others) o[q] = lst[q] + rest * (tot > 0 ? lst[q] / tot : .5); return o; };
    return [0, 1, 2].map(role => {
      const rows = SUBS.table.filter(r => r.same_role !== null && ROLES[IDX.get(r.hero)] === role).map(r => ({ r, h: IDX.get(r.hero), s: shares(r) })).sort((a, b) => b.r.same_role - a.r.same_role);
      const rh = 12, rg = 3, n = rows.length, Lw = Math.max(...rows.map(x => tw(NAMES[x.h], 11.5))) + 8, x0 = Lw + 4, nw = 5, x1 = x0 + 150, W = x1 + 104, top = 6, Hh = top + n * (rh + rg) + 10;
      const tot = [0, 1, 2].map(q => sum(rows.map(x => x.s[q]))), ng = 16, avail = n * rh, nodeY = []; let y = top + (n * (rh + rg) - rg - avail - 2 * ng) / 2;
      for (const q of [0, 1, 2]) { nodeY[q] = { y0: y, y1: y + tot[q] / n * avail }; y = nodeY[q].y1 + ng; }
      const fill = [0, 1, 2].map(q => nodeY[q].y0); let g = "";
      rows.forEach((x, i) => {
        const ry = top + i * (rh + rg); let yy = ry;
        for (const q of [0, 1, 2]) { const hL = x.s[q] * rh, hR = x.s[q] / n * avail; if (hL < .05) continue;
          g += `<path class="flow" data-hero="${x.h}" d="${band(x0 + nw, yy, yy + hL, x1, fill[q], fill[q] + hR)}" fill="${q === role ? "var(--ink)" : "var(--faint)"}" opacity="${q === role ? .5 : .3}"/>`; yy += hL; fill[q] += hR; }
        g += `<g class="rowlab" data-hero="${x.h}"${T_(`<b>${esc(NAMES[x.h])}</b>: ${pct(x.r.same_role)} of ${fmt(x.r.mains)} mains stay ${RN[role]}<br><span class="d">first choices: ${x.r.top.slice(0, 4).map(([a, p]) => `${esc(SHORT[a] || a)} ${pct(p)}`).join(", ")}</span>`)}>`
          + `<rect x="0" y="${ry - 1}" width="${x0 + nw}" height="${rh + 2}" fill="transparent"/><rect x="${x0}" y="${ry}" width="${nw}" height="${rh}" fill="var(--ink)"/><text x="${x0 - 5}" y="${ry + rh - 2}" font-size="11.5" text-anchor="end">${esc(NAMES[x.h])}</text></g>`;
      });
      for (const q of [0, 1, 2]) { const ny = nodeY[q], cyq = (ny.y0 + ny.y1) / 2;
        g += `<rect x="${x1}" y="${ny.y0}" width="${nw + 2}" height="${Math.max(1, ny.y1 - ny.y0)}" fill="${q === role ? "var(--ink)" : "var(--faint)"}"/><text x="${x1 + nw + 8}" y="${cyq}" font-size="12" font-weight="600">${ROLE_NAMES[q]}</text><text x="${x1 + nw + 8}" y="${cyq + 14}" font-size="12" class="faint">${pct(tot[q] / n)}</text>`; }
      const stay = mean(rows.map(x => x.r.same_role));
      return `<div><p class="head"><span class="n">${pct(stay)}</span> of ${RN[role]} mains stay ${RN[role]}</p><svg class="sk" viewBox="0 0 ${W} ${Hh}" width="${W}">${g}</svg></div>`;
    }).join("");
  }
  function wireSankeys(root) {
    root.querySelectorAll("svg.sk").forEach(sv => {
      sv.addEventListener("mouseover", ev => { const el = ev.target.closest("[data-hero]"); if (!el) return; const h = el.dataset.hero; sv.classList.add("hl"); sv.querySelectorAll("[data-hero]").forEach(x => x.classList.toggle("on", x.dataset.hero === h)); });
      sv.addEventListener("mouseleave", () => { sv.classList.remove("hl"); sv.querySelectorAll(".on").forEach(x => x.classList.remove("on")); });
    });
  }

  // ---------------------------------------------------------------- advice
  /* Your win chance as a scoreboard: the number with the advice as the headline, the gain over both teams banning as usual as
     a chip, and a small 45-60% scale with a coin flip marked, so a one-point gain is visible but not inflated. */
  function winLine() {
    if (!WIN) return "";
    // with none of your bans left, following the advice and banning as usual are the same thing: one number, no chip
    const left = [0, 1, 2, 3, 4, 5].slice(nextBan()).some(ours), o = mean(WIN.opt), b = WIN.beh && left ? WIN.beh[0] : null, done = nextBan() >= 6, gain = b === null ? null : o - b;
    const vs = [o].concat(b === null || done ? [] : [b]), lo = Math.min(.45, Math.floor(100 * Math.min(...vs) - 2) / 100), hi = Math.max(.60, Math.ceil(100 * Math.max(...vs) + 2) / 100);
    const Wd = 440, X = v => 12 + (v - lo) / (hi - lo) * (Wd - 24), half = .5 >= lo && .5 <= hi;
    const scale = `<svg viewBox="0 0 ${Wd} 42" aria-hidden="true"><line x1="12" x2="${Wd - 12}" y1="14" y2="14" stroke="var(--hair)" stroke-width="6" stroke-linecap="round"/>
      ${half ? `<line x1="${X(.5)}" x2="${X(.5)}" y1="4" y2="24" stroke="var(--faint)" stroke-dasharray="2 2"/><text x="${X(.5)}" y="38" font-size="12" text-anchor="middle" class="faint">50%, a coin flip</text>` : ""}
      ${b !== null && !done ? `<line x1="${X(Math.min(o, b))}" x2="${X(Math.max(o, b))}" y1="14" y2="14" stroke="var(--blue)" stroke-width="6"/><circle cx="${X(b)}" cy="14" r="5" fill="var(--paper)" stroke="var(--faint)" stroke-width="2"><title>both teams ban as usual: ${pct1(b)}</title></circle>` : ""}
      <circle cx="${X(o)}" cy="14" r="7" fill="var(--blue)"><title>${pct1(o)}</title></circle>
      <text x="12" y="38" font-size="12" class="faint">${Math.round(100 * lo)}%</text><text x="${Wd - 12}" y="38" font-size="12" text-anchor="end" class="faint">${Math.round(100 * hi)}%</text></svg>`;
    const gainTxt = !done && gain !== null ? `<div class="wgain"><span class="wchip">${pp(gain, 1)}</span>points over both teams banning as usual (${pct1(b)})</div>` : "";
    return `<div class="wscore"><div class="wtop"><div class="wbig">${pct1(o)}</div><div class="wlab">${done ? "your win chance after these bans" : left ? "your win chance if you follow the advice" : "your win chance, whatever they ban last"}</div></div>${gainTxt}${scale}</div>`;
  }
  const quiet = html => html.replace(/<(figcaption|caption)>([\s\S]*?)<\/\1>/g, (m, t, x) => `<${t}><details class="more"><summary>How to read this</summary>${x}</details></${t}>`);
  const more = (label, body) => `<details class="more" style="margin:2px 0 10px 0"><summary>${label}</summary>${body}</details>`;
  // ---- likely comps: the v8 simulator plays this lobby out in background workers (stand-ins near your rank, the rest of the
  // bans as typical teams make them, both teams' drafts from the pick model) and counts what each team opens
  const CW = Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)), CRUNS = 64, CDRAWS = 32;
  let compPool = [], COMP = null, compId = 0;
  const compKey = () => JSON.stringify([st.tier, st.map, st.first, [0, 1, 2, 3, 4, 5].map(shownOf), st.bans]);
  function compStart() {
    const key = compKey(); if (COMP && COMP.key === key) return;
    if (COMP && !COMP.done && !COMP.failed) { compPool.forEach(w => w.terminate()); compPool = []; }   // a stale run: start over rather than queue behind it
    while (compPool.length < CW) { const w = new Worker("sim8-worker.js?v=a6261486d4"); w.onmessage = ev => compMsg(ev.data); w.onerror = () => compFail(); compPool.push(w); }
    const id = ++compId, s = Object.assign(lobby(), { mates6: [1, 2, 3, 4, 5].map(shownOf) }), parts = compPool.map(() => []);
    for (let j = 0; j < CRUNS; j++) parts[(j % CDRAWS) % compPool.length].push(j);
    COMP = { key, id, done: false, failed: false, pending: 0, us: new Float64Array(H), them: new Float64Array(H), nu: 0, nt: 0, runs: 0, splits: { us: {}, them: {} } };
    parts.forEach((runs, k) => { if (!runs.length) return; COMP.pending++; compPool[k].postMessage({ id, v: LAY.run, type: "values", st: s, cands: ["typ"], opens: true, runs }); });
  }
  function compMsg(d) {
    const C = COMP; if (!C || d.id !== C.id || !d.done) return;
    if (d.error) { compFail(); return; }
    const o = d.opens; for (let h = 0; h < H; h++) { C.us[h] += o.us[h]; C.them[h] += o.them[h]; } C.nu += o.nu; C.nt += o.nt; C.runs += o.runs;
    for (const t of ["us", "them"]) for (const k in o.splits[t]) C.splits[t][k] = (C.splits[t][k] || 0) + o.splits[t][k];
    if (--C.pending === 0) { C.done = true; const el = $("comp"); if (el) el.innerHTML = quiet(compInner()); }
  }
  function compFail() { if (!COMP || COMP.failed) return; COMP.failed = true; const el = $("comp"); if (el) el.innerHTML = quiet(compInner()); }
  const splitName = k => k.split("-").map((n, r) => `${n} ${RN[r]}${n === "1" ? "" : "s"}`).join(", ");
  const RNC = ["Vanguard", "Duelist", "Strategist"];
  /* One team's numbers: open chances per hero, role splits by frequency, and per role a ranked list: the heroes that fill the
     most common split (picks), then the next two (alternatives, at least 3% of drafts). */
  function compSide(side) {
    const C = COMP, n = side === "us" ? C.nu : C.nt, P = Array.from(C[side], x => x / Math.max(n, 1));   // a plain array: a typed array's map can only return numbers
    const sp = Object.entries(C.splits[side]).map(([k, c]) => ({ k, p: c / Math.max(n, 1) })).sort((a, b) => b.p - a.p);
    const best = sp.length ? sp[0].k.split("-").map(Number) : [2, 2, 2];
    const roles = [0, 1, 2].map(r => { const cand = P.map((p, h) => ({ h, p })).filter(x => ROLES[x.h] === r && x.p > 0).sort((a, b) => b.p - a.p);
      const k = Math.max(1, best[r]); return { picks: cand.slice(0, k), alts: cand.slice(k, k + 2).filter(x => x.p >= .03) }; });
    return { side, P, sp, best, roles };
  }
  function compCell(S, r, mx, adv) {
    const you = shownOf(0), shown = new Set([1, 2, 3, 4, 5].map(shownOf).filter(h => h >= 0)), R = S.roles[r], cls = S.side === "us" ? "u" : "t";
    const row = (x, alt) => { const tag = S.side === "us" && x.h === you ? "you" : S.side === "us" && shown.has(x.h) ? "shown" : adv.has(x.h) ? "ban?" : "";
      const w = tag === "you" || tag === "shown" ? 100 : Math.min(100, 100 * x.p / mx);
      return `<div class="crow${alt ? " calt" : ""}" title="${esc(NAMES[x.h])}: opened in ${pct(x.p)} of simulated drafts"><img src="${img(x.h)}" alt="">
        <div class="cn"><div class="cl"><span class="nm">${esc(nm(x.h))}</span><span class="pv">${tag === "you" || tag === "shown" ? "" : pct(x.p)}</span></div>
        <i class="cbar ${cls}"><b style="width:${w.toFixed(1)}%"></b></i>${tag ? `<span class="ctag${tag === "ban?" ? " cban" : ""}">${tag === "ban?" ? "advised ban" : tag}</span>` : ""}</div></div>`; };
    return R.picks.map(x => row(x, false)).join("") + (R.alts.length ? `<div class="cor">or</div>${R.alts.map(x => row(x, true)).join("")}` : "");
  }
  const shapes = S => S.sp.filter(x => x.p >= .02).slice(0, 3).map((x, i) => `<span class="cshape${i ? "" : " on"}" title="${splitName(x.k)}">${x.k.replaceAll("-", "·")}<b>${pct(x.p)}</b></span>`).join("");
  function compInner() {
    if (!COMP || COMP.key !== compKey() || (!COMP.done && !COMP.failed)) return `<h2>Likely comps</h2><p class="small">Drafting both teams&hellip;</p>`;
    if (COMP.failed) return `<h2>Likely comps</h2><p class="small">The drafts could not be run in this browser.</p>`;
    const T = compSide("them"), U = compSide("us"), adv = new Set(ourTurn() && RES ? (turnCount() === 2 && PAIRS && PAIRS.length ? [PAIRS[0].a, PAIRS[0].b] : [RES.best]) : []);
    const vis = [T, U].flatMap(S => S.roles.flatMap(R => R.picks.concat(R.alts))).filter(x => !(x.h === shownOf(0))).map(x => x.p), mx = Math.max(...vis, .05);
    const same = T.sp[0] && U.sp[0] && T.sp[0].k === U.sp[0].k;
    const head = T.sp[0] ? `<p class="chead">Most likely, <span class="t">they</span> run ${splitName(T.sp[0].k)} (${pct(T.sp[0].p)} of drafts)${U.sp[0] ? same ? `, and <span class="u">your team</span> the same (${pct(U.sp[0].p)})` : `, and <span class="u">your team</span> ${splitName(U.sp[0].k)} (${pct(U.sp[0].p)})` : ""}.</p>` : "";
    const narrow = ($("adviceBody").clientWidth || 700) < 600;
    let grid;
    if (!narrow) {                                           // roles across, the two teams down: compare role by role
      grid = `<div class="cgrid"><div></div>${RNC.map(t => `<div class="cgh">${t}</div>`).join("")}` +
        [T, U].map((S, i) => `${i ? `<div class="csep"></div>` : ""}<div class="cgt ${S.side === "us" ? "u" : "t"}"><b>${S.side === "us" ? "Your team" : "Other team"}</b><div class="cshapes">${shapes(S)}</div></div>` +
          [0, 1, 2].map(r => `<div class="ccell ${S.side}">${compCell(S, r, mx, adv)}</div>`).join("")).join("") + `</div>`;
    } else {                                                 // phones: one block per role, the two teams side by side
      grid = `<div class="cshapes2"><div><b class="t">Other team</b>${shapes(T)}</div><div><b class="u">Your team</b>${shapes(U)}</div></div>` +
        [0, 1, 2].map(r => `<div class="cgh">${RNC[r]}</div><div class="cgrid2"><div class="ccell them">${compCell(T, r, mx, adv)}</div><div class="ccell us">${compCell(U, r, mx, adv)}</div></div>`).join("");
    }
    return `<h2>Likely comps</h2>${head}${grid}<figure style="margin:6px 0 0 0"><figcaption>From ${COMP.runs} simulated ban phases of this lobby: players near your rank, the rest of the bans as
      typical teams make them, and both teams' drafts from the pick model. Split chips count vanguards, duelists and strategists. In each role, the heroes above "or" fill that
      role in the team's most common split; below it, the next likeliest. Bars and percentages: how often the hero is opened, on one scale for both teams.
      Lineups vary too much for any single one to be likely, so this is who fills each role, not one fixed lineup.</figcaption></figure>`;
  }
  function openers() { compStart(); return `<section class="comp" id="comp">${compInner()}</section>`; }
  function renderAdvice() {
    const e = nextBan(), W = figW(); let html = "";
    if (e >= 6) html += `<h2>Ban phase complete</h2>${winLine()}${openers()}`;
    else if (ourTurn() && RES) {
      const cnt = turnCount(), R = RES, pair = cnt === 2 && PAIRS && PAIRS.length ? PAIRS[0] : null;
      const runner = R.cands.filter(h => h !== R.best).sort((a, b) => R.V[b] - R.V[a])[0], clr = runner !== undefined && R.clear(R.best, runner);
      html += `<h2>Your ban #${e + 1}${cnt === 2 ? ` and #${e + 2}` : ""}</h2>`;
      html += pair ? `<p class="head">Ban <span class="u">${esc(NAMES[pair.a])}</span>, then <span class="u">${esc(NAMES[pair.b])}</span> <span class="n u">${pp(pair.V)}</span> ${hs("scored as a pair")}</p>`
        : `<p class="head">Ban <span class="u">${esc(NAMES[R.best])}</span> <span class="n u">${pp(R.V[R.best])}</span> ${hs(runner === undefined ? "" : clr ? `clear of ${esc(nm(runner))}` : `close call with ${esc(nm(runner))}`)}</p>`;
      html += winLine() + `<div class="fig8">${banBoard(W)}</div>`;
      if (cnt === 2) html += `<h2>Your two bans</h2>` + (PAIRS && PAIRS.length ? `<div class="fig8">${pairGrid(PAIRS, W)}</div>` : `<p class="small">Scoring pairs&hellip;</p>`);
      const h0 = pair ? pair.a : R.best, SF = subsFlow(h0, W);
      if (SF) html += `<h2>What ${esc(nm(h0))} does to them</h2><p class="head"><span class="n u">${pct(SF.leave)}</span> of ${esc(NAMES[h0])} mains leave ${RN[SF.role]}</p><div class="fig8">${SF.svg}</div>`;
      if (cnt === 1 && REPLY) { const F = forecastStrip(REPLY, W);
        html += `<h2>Their reply</h2><p class="head">They likely answer with <span class="t">${esc(nm(F.top))}</span> <span class="n t">${pct(REPLY.pe[F.top])}</span>${F.worst !== undefined && F.worst !== F.top ? ` ${hs(`the one to fear: ${esc(nm(F.worst))}`)}` : ""}</p><div class="fig8">${F.svg}</div>`; }
      html += more("All bans as a table", rankTable(topBans(12), [
        { th: "Typical", td: h => R.pe[h] < .001 ? "&lt;0.1%" : pct1(R.pe[h]) }, { th: "They open", td: h => LU ? pct(LU.pt[h]) : "" }, { th: "You open", td: h => LU ? pct(LU.pu[h]) : "" }],
        `Value: change in your team's win probability, in points, if you make this ban and follow the advice afterwards, against a typical ban. Bar: the range. Typical: how often a
        typical team in your seat makes this ban now (the advice only picks bans typical teams make at least 0.1% of the time). They open, you open: the previous model's draft predictions.`));
      html += openers();
    } else if (THEM) {
      const T = THEM, F = forecastStrip(T, W);
      html += `<h2>Their ban #${e + 1}</h2><p class="head">Likeliest <span class="t">${esc(NAMES[F.top])}</span> <span class="n t">${pct(T.pe[F.top])}</span>${F.worst !== undefined && F.worst !== F.top ? ` ${hs(`the one to fear: ${esc(nm(F.worst))}, ${pp(T.mu[F.worst] - T.base)} for you`)}` : ""}</p>`;
      html += winLine() + `<div class="fig8">${F.svg}</div>`;
      html += more("Why they would ban these", `<figure>${whySplit(T)}<figcaption>The ban model's reasons against an average hero (log-odds). "Your team plays it": teams go after the heroes the
        other team's players play, and the heroes your team shows say who your players are.</figcaption></figure>`);
      html += openers();
    }
    $("adviceBody").innerHTML = quiet(html);
    $("adviceBody").querySelectorAll("tr.pick").forEach(el => el.onclick = () => { st.active = { kind: "ban" }; place(+el.dataset.h); });
    $("adviceBody").querySelectorAll("[data-ban]").forEach(el => el.onclick = () => { if (ourTurn()) { st.active = { kind: "ban" }; place(+el.dataset.ban); } });
    $("adviceBody").querySelectorAll("[data-pair]").forEach(el => el.onclick = () => { if (ourTurn() && turnCount() === 2) { const [a, b] = el.dataset.pair.split(",").map(Number); banBoth(a, b); } });
  }
  let REPLY = null;
  window.addEventListener("resize", () => { clearTimeout(window.__rz); window.__rz = setTimeout(() => { if (RES || THEM || DONE) renderAdvice(); }, 150); });

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
      RES = PAIRS = THEM = PATH = REPLY = null; DONE = e >= 6 ? true : null;
      if (e < 6 && ours(e)) RES = E.ourTurn(s); else if (e < 6) THEM = E.theirTurn(s);
      if (RES && turnCount() === 1 && e + 1 < 6) REPLY = E.theirTurn(Object.assign({}, s, { bans: s.bans.concat([RES.best]) }));
      WIN = { opt: E.winNow(s), beh: E.ready("aux") ? E.winNow(s, "behaviour") : null }; if (!WIN.opt) WIN = null;
      PATH = e < 6 ? E.path(s) : null;
      const s7 = { firstUs: st.first, bans: st.bans.slice(), rev: st.team.filter(h => h >= 0), m: v7map(st.map), r0: META.tiers[st.tier] };
      LU = E7.lineups(E7.ctx(s7));
      renderBans(); renderRoster(); renderAdvice(); $("mainEl").classList.remove("busy");
      if (RES && turnCount() === 2) setTimeout(() => {                      // pairs take about half a second: after the first render
        if (my !== pending) return;
        PAIRS = E.pairs(s, RES, 6, true) || []; renderBans(); renderRoster(); renderAdvice();
      }, 20);
    }, 15);
  }

  // ---------------------------------------------------------------- method section (text + figures from the model's report)
  function renderMethod() {
    const R = REP, C = R.checks, cmp = R.comparisons, t = R.test, d = C.drafts, ope = R.ope.decisions, bc = R.ope.behaviour_calibration;
    const ci = r => `${(r.mean >= 0 ? "+" : "−") + Math.abs(r.mean).toFixed(4)} (${r.lo.toFixed(4)} to ${r.hi.toFixed(4)})`;
    const cq = q => `${q.mean_pts >= 0 ? "+" : "−"}${Math.abs(q.mean_pts).toFixed(2)} (${q.lo_pts.toFixed(2)} to ${q.hi_pts.toFixed(2)})`;
    // v8.3 runs: the uncapped doubly robust estimate is the result (capping is a sensitivity check), and the simulated gain is the page's own policy
    const v83 = !!R.estimator_checks, drq = q => v83 ? q.doubly_robust : q.doubly_robust_capped, simGain = (C.policy.students_vs_players || C.policy.optimal_vs_players).gain_pts;
    const allZero = ope.every(q => drq(q).lo_pts <= 0 && drq(q).hi_pts >= 0), WU = C.world_model_uncertainty;
    const out8 = t.outcome_recalibrated || t.outcome.v8, out7 = t.outcome["v7.2"], banT = t.ban;
    const slopes = Object.values(bc).map(v => v.slope), sLo = Math.min(...slopes).toFixed(2), sHi = Math.max(...slopes).toFixed(2);
    const fb = C.first_ban_by_role;
    const ag = C.agreement_by_shown ? Object.values(C.agreement_by_shown).filter(v => v.student_same_advice !== undefined) : [], nAg = sum(ag.map(v => v.lobbies));
    const stu = E.S && nAg ? { same: sum(ag.map(v => v.lobbies * v.student_same_advice)) / nAg, regret: sum(ag.map(v => v.lobbies * v.student_regret_pts)) / nAg } : null;
    $("method").innerHTML = `<details class="how"><summary>How it works, and how well it holds up</summary><div class="mgrid"><div class="mcol"><h2>Method</h2>
      <p>A ban removes a hero from both teams, you usually don't know who is on the other side, and a ban changes what both teams draft. So the model plays lobbies out. It simulates
      ${fmt(R.world_model.lobbies)} lobbies like yours: stand-in players near the lobby's rank, drawn from the real players who play there and following the heroes your team shows, the rest of the ban phase,
      both teams' drafts after the bans, and who wins. Then it trains one small network per ban position, backwards from the last ban: each network values a lobby after that many bans,
      assuming your later bans follow the advice and theirs follow what teams really do.</p>
      <p class="formula">value(<i>x</i>) = win chance after you ban <i>x</i> − win chance after a typical ban</p>
      <p>A ban's value is read straight from the next position's network, so the rest of the ban phase, the other team's replies, and both teams' substitutions are all inside it.
      The model is fitted several times on different resamples of the simulated lobbies${E.S ? `, and a compact copy that runs on this page reproduces their average and how far they disagree` : ""}.
      The ranges on the page show that disagreement. The advice takes the highest average minus half the range, among bans a typical team makes at least 0.1% of the time, so it does not
      rest on a ban the data never shows.</p>
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
      <p class="small">From the notebook run ${esc(R.run)} that fitted these models. Every model was chosen on earlier matches, by a rule fixed before any result, and the last ${fmt(R.splits.test.n)} matches were scored once.${R.test_consulted ? ` Those matches were also looked at while earlier
      versions were built, so treat these as development checks until newer matches are scored.` : ""}</p>
      <table><tr><th>Check</th><th class="r">Result</th></tr>
        <tr><td>Their bans: log loss per ban (the previous model's ban model)</td><td class="r">${banT[R.selected.ban].toFixed(4)} (${banT.A.toFixed(4)})</td></tr>
        <tr><td>Who wins: log loss per match (previous model), calibration slope</td><td class="r">${out8.logloss.toFixed(4)} (${out7.logloss.toFixed(4)}), ${out8.calib_slope.toFixed(2)}</td></tr>
        <tr><td>Simulated drafts on real teams: 2-2-2 / triple support / stays in role when the main is banned</td><td class="r">${pct(d.two_two_two.model)} / ${pct(d.triple_support.model)} / ${pct(d.role_stay_when_forced.model)} (real ${pct(d.two_two_two.real)} / ${pct(d.triple_support.real)} / ${pct(d.role_stay_when_forced.real)})</td></tr>
        <tr><td>The model against a brute-force simulation of your last ban: points left on the table (a typical ban)</td><td class="r">${C.brute_force.regret_network_pts.toFixed(2)} (${C.brute_force.regret_typical_pts.toFixed(2)})</td></tr>
        ${stu ? `<tr><td>The compact copy on this page against the full model, at your first ban: same advice, points lost</td><td class="r">${pct(stu.same)}, ${stu.regret.toFixed(3)}</td></tr>` : ""}
        <tr><td>Inside the simulation: following the advice against banning as players do</td><td class="r">+${simGain.toFixed(2)} pts</td></tr>
        ${ope.map(q => `<tr><td>Real games: following the advice at your ban ${q.decision} (${v83 ? "" : "weights capped, "}95% interval)</td><td class="r">${cq(drq(q))} pts</td></tr>`).join("")}
      </table>
      <p class="small">${allZero ? "In real games the advice cannot be told apart from what players do: every interval includes zero." : "In real games the intervals are wide."} The gain the simulation expects (about
      ${simGain.toFixed(1)} points per game) is too small for ${fmt(R.ope.matches)} games to show, players made the advised ban only about ${pct(ope[0].match_rate)} of the time,
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
        <li>A range shows where the model's fits disagree, not a full interval: ${WU ? `refitting the models on resampled matches moves a last ban's value by about
          ${WU.world_sd_pts.toFixed(2)} points, against ranges of about ${WU.network_sd_pts.toFixed(2)} here.` : "refitting everything on other matches would move the values more."}</li>
        <li>God Quarry is left out (7 matches in the data).</li>
      </ul></div></div></details>
      <h2>Where mains go when their hero is banned</h2>
      <div class="roles">${roleFlows()}</div>
      <p class="small">Each row is a hero. Its mains (30% or more of their minutes on it) flow to the role they pick when it is banned, before teammates pick (the pick model's average over
      maps and sides). Dark: they stay in the role. Light: they switch to the role on the right. Hover a hero to follow it.</p>`;
    wireSankeys($("method"));
  }
  const SPL = REP.splits, day = t => new Date(t.replace(" ", "T") + "Z").toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" });
  const fitN = SPL.train.n + SPL.validation.n;
  const fitDates = `${day(SPL.train.first_utc)} to ${day(SPL.validation.last_utc)} ${new Date(SPL.validation.last_utc.replace(" ", "T") + "Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`;
  status(""); $("fitted").textContent = `Fitted on ${fmt(fitN)} PC ranked matches from Season 10 (${fitDates}), model ${REP.version} (run ${REP.run}).`;
  renderMethod(); update();
  document.fonts && document.fonts.ready.then(() => { renderMethod(); if (RES || THEM || DONE) renderAdvice(); });
  if (auxP) auxP.then(b => { E.addBuffer("aux", b); update(); }).catch(() => {});
})();
