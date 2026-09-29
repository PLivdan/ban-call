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
  // a binary of the release: exactly the manifest's size and (when the manifest has it) its SHA-256, or the load fails
  async function fetchBin(url, bytes, label, sha) {
    const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    let buf;
    if (!r.body || !r.body.getReader) buf = await r.arrayBuffer();
    else {
      const rd = r.body.getReader(), parts = []; let got = 0;
      for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; if (label) status(`${label} ${Math.round(100 * got / bytes)}%`); }
      const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } buf = out.buffer;
    }
    if (bytes !== undefined && buf.byteLength !== bytes) throw new Error(`${url}: ${buf.byteLength} bytes, the release says ${bytes}`);
    if (sha && self.crypto && crypto.subtle) {
      const d = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf))).map(b => b.toString(16).padStart(2, "0")).join("");
      if (d !== sha) throw new Error(`${url}: its checksum does not match the release`);
    }
    return buf;
  }
  const LAY = await fetch("model8/value_v8.json", { cache: "no-cache" }).then(r => r.json()), VQ = `?v=${LAY.run}`;   // the other model files carry the run, so a cached one never mixes runs
  const [BAN, SUBS, REP, META, W7, PORT] = await Promise.all(["model8/ban_v8.json" + VQ, "model8/substitutes_v8.json" + VQ, "model8/report_v8.json" + VQ,
    "model/meta.json"].map(u => fetch(u).then(r => r.json())).concat([fetch("model/weights.bin").then(r => r.arrayBuffer()), fetch("model/portraits.json").then(r => r.json())]));
  if ((BAN.run && BAN.run !== LAY.run) || (REP.run && REP.run !== LAY.run)) throw new Error(`the model files come from different runs (${LAY.run}, ${BAN.run}, ${REP.run})`);
  const E = new Engine8(LAY, BAN), E7 = new BanEngine(META, W7, META.engine ? { NS: 64, NOWN: META.engine.nown } : { NS: 64 });
  const H = E.H, ORDER = LAY.order, NAMES = LAY.heroes, ROLES = LAY.roles;
  status(`Loading the model (${(LAY.files.opt.bytes / 1e6).toFixed(0)} MB)…`);
  E.addBuffer("opt", await fetchBin(`model8/${LAY.files.opt.path}${VQ}`, LAY.files.opt.bytes, "Loading the model", LAY.files.opt.sha256));   // throws on a bad file
  const auxP = LAY.files.aux ? fetchBin(`model8/${LAY.files.aux.path}${VQ}`, LAY.files.aux.bytes, null, LAY.files.aux.sha256) : null;   // behaviour and robust members: after the page is up
  // a value's range, in plain words: the page never says how many networks sit behind it (the members' lowest to highest in
  // v8.1, one SD either side of the teachers' mean from v8.2 on)
  const spreadTxt = sp => `range ${pp(sp.lo)} to ${pp(sp.hi)}`;
  const img = h => `img/heroes/${PORT[NAMES[h]]}.webp`, short = h => NAMES[h];
  const mapName = s => s.includes(" · ") ? s.replace(" · ", " (") + ")" : s;
  const V7 = new Map(META.maps.map((m, i) => [m.name, i]));                          // the lineup network's map index, by name
  // the v8 model's maps, less those it has barely seen (fewer than MAPMIN Season 10 matches in the data: its advice there is a guess)
  const MAPMIN = 1000, MAPN = REP.map_matches || null, THIN = MAPN ? LAY.maps.filter(m => (MAPN[m.label] ?? 0) < MAPMIN).map(m => ({ name: mapName(m.label), n: MAPN[m.label] ?? 0 })) : [];
  const MAPS = LAY.maps.map((m, i) => ({ i, name: mapName(m.label), v7: V7.get(m.label) })).filter((m, _, a) => !MAPN || (MAPN[LAY.maps[m.i].label] ?? 0) >= MAPMIN).sort((a, b) => a.name.localeCompare(b.name));
  const v7map = i => (MAPS.find(m => m.i === i) || {}).v7;                           // the previous model's index, undefined where it lacks the map
  const TIERS = Object.keys(META.tiers);
  const SUB = new Map(SUBS.table.map(r => [r.hero, r]));

  // ---------------------------------------------------------------- state (mirrored in the URL hash, so a lobby can be shared)
  const kly = MAPS.find(m => /Klyntar \(Dom/.test(m.name));
  const LS = LobbyState, st = Object.assign({ tier: "Grandmaster 3", map: kly ? kly.i : MAPS[0].i, first: true, active: { kind: "team", i: 0 } }, LS.fresh());
  let MINE = []; try { MINE = JSON.parse(localStorage.getItem("bancall-mine") || "[]").filter(h => Number.isInteger(h)); } catch (e) {}
  const rememberMine = h => { MINE = [h].concat(MINE.filter(x => x !== h)).slice(0, 8); try { localStorage.setItem("bancall-mine", JSON.stringify(MINE)); } catch (e) {} };
  function readHash() {                                  // lobby-state.js checks every value, and keeps banned hovers (g) so a link carries what the model reads
    const d = LS.decode(location.hash, { H, tiers: META.tiers, maps: new Set(MAPS.map(m => m.i)), tier: st.tier, map: st.map }); if (!d) return;
    Object.assign(st, d); st.active = LS.shownOf(st, 0) < 0 ? { kind: "team", i: 0 } : { kind: "ban" };
  }
  let lastHash = "";
  function writeHash() { lastHash = LS.encode(st); history.replaceState(null, "", lastHash); }
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
  // a banned hero, drawn the same way everywhere: greyed out, a slash from corner to corner, slash and frame in the colour of the
  // team that banned it (the frame is the portrait's border; the slash runs along the border's middle into its corners)
  const banSide = h => { const i = st.bans.indexOf(h); return i >= 0 && ours(i) ? "us" : "them"; };
  const slash = (sz, off = 0) => `<svg class="xs" width="${sz}" height="${sz}" style="left:${off}px;top:${off}px;width:${sz}px;height:${sz}px" aria-hidden="true"><line x1="1" y1="${sz - 1}" x2="${sz - 1}" y2="1"/></svg>`;
  const teamSet = () => new Set(st.team.filter(h => h >= 0));
  // the lobby as the value networks see it: the heroes your team showed stay shown even if the other team bans them
  const shownOf = i => LS.shownOf(st, i);
  const lobby = () => LS.lobby(st, META.tiers[st.tier]);

  // ---------------------------------------------------------------- controls
  $("tierSel").innerHTML = TIERS.map(t => `<option${t === st.tier ? " selected" : ""}>${esc(t)}</option>`).join("");
  $("mapSel").innerHTML = MAPS.map(m => `<option value="${m.i}"${m.i === st.map ? " selected" : ""}>${esc(m.name)}</option>`).join("");
  $("tierSel").onchange = e => { st.tier = e.target.value; update(); };
  $("mapSel").onchange = e => { st.map = +e.target.value; update(); };
  $("firstBtn").onclick = () => { st.first = true; update(); };
  $("secondBtn").onclick = () => { st.first = false; update(); };
  const undo = () => { if (LS.unban(st) < 0) return; st.active = { kind: "ban" }; update(); };
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
      LS.hover(st, a.i, h); if (a.i === 0) rememberMine(h);
      const nxt = a.i === 0 ? -1 : st.team.findIndex((x, i) => x < 0 && i > a.i);
      st.active = nxt >= 0 ? { kind: "team", i: nxt } : { kind: "ban" };
    } else {
      if (nextBan() >= 6 || !LS.ban(st, h)) return;         // a banned hover is gone from the lobby, not from what your team showed
    }
    $("search").value = ""; renderMatches(); update();
    if (matchMedia("(pointer: fine)").matches) $("search").focus({ preventScroll: true });
  }
  function banBoth(a, b) { for (const h of [a, b]) LS.ban(st, h); st.active = { kind: "ban" }; update(); }
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
      if (ev.target.dataset.clear !== undefined) { LS.clearSlot(st, i); st.active = { kind: "team", i }; update(); return; }
      st.active = { kind: "team", i }; update(false);
    });
  }
  function suggested() {                              // our ban(s) this turn: the advice; on a two-ban turn PAIRS[0], the advice then the advice again after it
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
      const pic = h !== undefined ? `<img src="${img(h)}" alt="${esc(NAMES[h])}">${slash(60, -2)}<span class="x">✕</span>`
                : s !== undefined ? `<img src="${img(s)}" alt="suggested ${esc(NAMES[s])}">` : f ? `<img src="${img(f.h)}" alt="" style="opacity:.4">` : (i + 1);
      const lab = h !== undefined ? esc(short(h)) : s !== undefined ? `<i>${esc(short(s))}?</i>` : f ? `<span class="pct">${pct(f.p)}</span> ${esc(NAMES[f.h])}` : "";
      return `<div class="slot ${side}${h === undefined ? " empty" : " xban"}${isNext ? " active" : ""}${s !== undefined ? " sug" : ""}${f ? " fc" : ""}" data-i="${i}"
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
  function undoQuiet() { LS.unban(st); }
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
        const cls = ["tile"]; if (bans.has(h)) cls.push("banned", banSide(h)); if (team.has(h)) cls.push("ours");
        if (q && !NAMES[h].toLowerCase().includes(q) && !(SHORT[NAMES[h]] || "").toLowerCase().includes(q)) cls.push("dim");
        return `<div class="${cls.join(" ")}" data-h="${h}" title="${esc(NAMES[h])}">${rank.has(h) ? `<span class="${rkc}">${rank.get(h)}</span>` : ""}${bans.has(h) ? `<span class="tx"><img src="${img(h)}" alt="" loading="lazy">${slash(48)}</span>` : `<img src="${img(h)}" alt="" loading="lazy">`}<span class="nm">${esc(short(h))}</span></div>`;
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
  // a value and its range, drawn the same way in every figure: a pale band from low to high, a dot at the value, and (when y0 < y1)
  // a dashed line at a typical ban
  const rangeMark = (X, sp, v, y, y0 = 0, y1 = 0) => { const c = v < 0 ? "them" : "us";
    return (y1 > y0 ? `<line class="rng0" x1="${X(0)}" x2="${X(0)}" y1="${y0}" y2="${y1}"/>` : "")
      + `<rect class="rng ${c}" x="${X(sp.lo)}" y="${y - 3}" width="${Math.max(1, X(sp.hi) - X(sp.lo))}" height="6" rx="3"/><circle cx="${X(v)}" cy="${y}" r="3.6" class="${c}"/>`; };
  function rankTable(top, cols, cap) {                // one row per ban: value, the networks' range drawn in the row, extra columns
    const lo = Math.min(0, ...top.map(h => RES.spread(h).lo)), hi = Math.max(0, ...top.map(h => RES.spread(h).hi)), CW = 200, X = v => 17 + (v - lo) / (hi - lo || 1) * (CW - 34);
    const step = niceStep(hi - lo, 3); let ticks = "";
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-12; t += step) ticks += `<text x="${X(t)}" y="10" font-size="10" text-anchor="middle" class="faint">${pp(t, step < .005 ? 2 : 1)}</text>`;
    const cell = h => `<svg width="${CW}" height="16" viewBox="0 0 ${CW} 16" style="display:inline-block;vertical-align:middle;min-width:${CW}px">${rangeMark(X, RES.spread(h), RES.V[h], 8, 0, 16)}</svg>`;
    return `<div style="overflow-x:auto"><table style="width:100%"><caption>${cap}</caption>
      <tr><th>#</th><th></th><th>Ban</th><th class="r">Value</th><th><svg width="${CW}" height="13" viewBox="0 0 ${CW} 13" style="display:block;min-width:${CW}px">${ticks}</svg></th>${cols.map(c => `<th${c.r === false ? "" : ' class="r"'}>${c.th}</th>`).join("")}</tr>` +
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
  // a square portrait with the page's thin frame: every figure but the ban board (whose bubbles are circles) uses this
  const sqp = (h, x, y, s) => `<image href="${img(h)}" x="${x}" y="${y}" width="${s}" height="${s}" preserveAspectRatio="xMidYMid slice"/><rect x="${x + .5}" y="${y + .5}" width="${s - 1}" height="${s - 1}" fill="none" stroke="var(--hair)"/>`;
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
  /* ---- the ban board: every ban as its portrait on one axis (a beeswarm, so none overlap); click to ban.
     Your turn: placed by value against a typical ban, the advice ringed in blue with its range, rare bans greyed.
     Their turn: placed by what the ban would do to your win chance against their typical ban, sized by how likely they are to make
     it, their likeliest ringed in red. The board is one lasting drawing: when the lobby changes, every portrait glides to its new
     place and size, heroes that leave the board shrink away, and the axis and labels fade across. */
  function boardSpec(W) {
    const them = !RES, PAD = 30, rb = W < 560 ? 21 : 25, rs = W < 560 ? 11 : 13;
    let items, vs, ov = "", zeroLab, axLab;
    if (!them) {
      const R = RES, best = R.best; items = R.cands.map(h => ({ h, v: R.V[h] })).sort((a, b) => b.v - a.v).slice(0, 22);
      if (!items.some(i => i.h === best)) items.push({ h: best, v: R.V[best] });
      items.sort((a, b) => (b.h === best) - (a.h === best) || b.v - a.v);
      for (const it of items) { const h = it.h, rare = !R.supported.has(h); it.r = h === best ? rb : rs; it.hl = h === best; it.rare = rare;
        it.tip = `<b>${esc(NAMES[h])}</b> ${pp(it.v)}<br><span class="d">${spreadTxt(R.spread(h))}<br>typical teams ban it now: ${R.pe[h] < .001 ? "under 0.1%" : pct1(R.pe[h])}${LU ? `<br>they open it: ${pct(LU.pt[h])} · you: ${pct(LU.pu[h])}` : ""}${rare ? "<br>too rare for the advice to pick" : ""}</span><br>click to ban`; }
      const sb = R.spread(best); vs = items.map(i => i.v).concat([sb.lo, sb.hi]); zeroLab = "a typical ban"; axLab = "points against a typical ban →";
    } else {
      const T = THEM, d = h => T.mu[h] - T.base, ok = !isNaN(d(T.cands[0])), top = T.cands.slice().sort((a, b) => T.pe[b] - T.pe[a]).slice(0, 22), pmax = T.pe[top[0]] || 1;
      // unlikely bans (under the 4% "worst for you" looks at) are greyed out, as rare bans are on your turn
      items = top.map(h => { const rare = T.pe[h] < .04; return { h, v: ok ? d(h) : T.pe[h], r: rs + (rb - rs) * Math.sqrt(T.pe[h] / pmax), hl: h === top[0], them: true, rare,
        tip: `<b>${esc(NAMES[h])}</b> ${pct(T.pe[h])} chance${ok ? `<br><span class="d">if they ban it, your win chance ${pp(d(h))} against their typical ban` : `<br><span class="d">`}${rare ? "<br>unlikely, so not counted as the worst for you" : ""}</span><br>click if they banned it` }; });
      vs = items.map(i => i.v); zeroLab = ok ? "their typical ban" : ""; axLab = ok ? "points for you if they ban it →" : "chance they ban it →";
    }
    const vlo = Math.min(0, ...vs), vhi = Math.max(0, ...vs), span = vhi - vlo || .001, lo = vlo - span * .05, hi = vhi + span * .06;
    const X = v => PAD + (v - lo) / (hi - lo) * (W - 2 * PAD), placed = [];
    for (const it of items) {
      it.x = X(it.v); it.y = 0;
      for (let k = 0; k < 400; k++) { const dy = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2; if (!placed.some(p => Math.hypot(p.x - it.x, p.y - dy) < p.r + it.r + 2)) { it.y = dy; break; } }
      placed.push(it);
    }
    const ext = Math.max(...items.map(i => Math.abs(i.y) + i.r)) + 4, cy = ext + 28, base = cy + ext + 18, Hh = base + 36;
    items.forEach(it => it.y += cy);
    let ax = ticks(lo, hi, W < 560 ? 3 : 5).map(t => `<line x1="${X(t)}" x2="${X(t)}" y1="14" y2="${base}" stroke="var(--hair)"/><text x="${X(t)}" y="${base + 15}" font-size="11" text-anchor="middle" class="faint">${them && !zeroLab ? pct(t) : pp(t, t && Math.abs(t) < .01 ? 2 : 1)}</text>`).join("");
    if (zeroLab) ax += `<line class="rng0" x1="${X(0)}" x2="${X(0)}" y1="14" y2="${base}"/><text x="${X(0)}" y="${base + 29}" font-size="11" text-anchor="middle" class="faint">${zeroLab}</text>`;
    ax += `<text x="${W - PAD}" y="${base + 29}" font-size="11" text-anchor="end" class="faint">${axLab}</text>`;
    if (!them) { const R = RES, m = R.spread(R.best), my = base - 8;          // the advice's range, on a line of its own under the board
      ov += `<g${T_(`<b>${esc(NAMES[R.best])}</b> ${pp(R.V[R.best])}<br><span class="d">${spreadTxt(m)}</span>`)}>${rangeMark(X, m, R.V[R.best], my)}`
        + `<rect x="${X(m.lo) - 4}" y="${my - 6}" width="${X(m.hi) - X(m.lo) + 8}" height="12" fill="transparent"/></g>`; }
    return { W, Hh, items, ax, ov };
  }
  const BOARD = { svg: null, nodes: new Map(), H: 0, raf: 0 };
  const SVGNS = "http://www.w3.org/2000/svg", still = matchMedia("(prefers-reduced-motion: reduce)");
  function drawBoard(W) {
    const sp = boardSpec(W), B = BOARD, key = W + "|" + sp.items.map(i => `${i.h}:${i.x.toFixed(1)},${i.y.toFixed(1)},${i.r.toFixed(1)},${+!!i.hl}${+!!i.rare}`).join(" ");
    if (B.svg && key === B.key) { sp.items.forEach(it => { const n = B.nodes.get(it.h); if (n) n.g.setAttribute("data-tip", it.tip); }); return B.svg; }
    B.key = key;
    const mk = (tag, at, par) => { const e = document.createElementNS(SVGNS, tag); for (const k in at) e.setAttribute(k, at[k]); if (par) par.appendChild(e); return e; };
    const first = !B.svg;
    if (first) { B.svg = mk("svg", { class: "board" }); B.ax = mk("g", {}, B.svg); B.bub = mk("g", {}, B.svg); B.ov = mk("g", {}, B.svg);
      B.svg.addEventListener("click", ev => { const g = ev.target.closest("[data-ban]"); if (!g) return; const h = +g.dataset.ban;
        if (ourTurn() || THEM) { st.active = { kind: "ban" }; place(h); } }); }
    // an update that arrives mid-move: finish what the last one left behind (faded-out axes and labels), then move on from here
    cancelAnimationFrame(B.raf); if (B.done) B.done(true);
    const anim = !first && !still.matches, H0 = B.H || sp.Hh;
    B.svg.setAttribute("width", sp.W); B.W = sp.W;
    // the axis and labels: the new ones fade in over the old
    const swap = (key, html) => { const old = B[key], nu = mk("g", { opacity: anim ? 0 : 1 }, B.svg); nu.innerHTML = html;
      B.svg.insertBefore(nu, key === "ax" ? B.bub : null); B[key] = nu; return { old, nu, o0: old ? +(old.getAttribute("opacity") ?? 1) : 1 }; };
    const fAx = swap("ax", sp.ax), fOv = swap("ov", sp.ov);
    // the portraits: one element per hero, kept across updates
    const want = new Set(sp.items.map(i => i.h)), moves = [];
    for (const it of sp.items) {
      let n = B.nodes.get(it.h);
      if (!n) { const g = mk("g", { "data-ban": it.h }); const im = mk("image", { href: img(it.h), x: -1, y: -1, width: 2, height: 2, "clip-path": "url(#cc)", preserveAspectRatio: "xMidYMid slice" }, g);
        const ring = mk("circle", { class: "ring", r: 1, fill: "none", "vector-effect": "non-scaling-stroke" }, g);
        n = { g, im, ring, x: it.x, y: it.y, r: 0 }; B.nodes.set(it.h, n); }
      n.g.setAttribute("data-tip", it.tip); n.im.classList.toggle("rare", !!it.rare);
      n.ring.setAttribute("stroke", it.hl ? (it.them ? "var(--red)" : "var(--blue)") : "var(--paper)"); n.ring.setAttribute("stroke-width", it.hl ? 3 : 1.5);
      moves.push({ n, x0: n.x, y0: n.y, r0: anim ? n.r : it.r, x1: it.x, y1: it.y, r1: it.r });
    }
    for (const [h, n] of B.nodes) if (!want.has(h)) moves.push({ n, x0: n.x, y0: n.y, r0: n.r, x1: n.x, y1: n.y, r1: 0, gone: h });
    // draw order: small first, the highlighted and larger ones on top, leaving heroes underneath
    moves.slice().sort((a, b) => (!!b.gone - !!a.gone) || a.r1 - b.r1).forEach(m => B.bub.appendChild(m.n.g));
    const setH = h => { B.svg.setAttribute("viewBox", `0 0 ${sp.W} ${h}`); B.svg.setAttribute("height", h); B.H = h; };
    const frame = u => { const e = u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      for (const m of moves) { const x = m.x0 + (m.x1 - m.x0) * e, y = m.y0 + (m.y1 - m.y0) * e, r = Math.max(0, m.r0 + (m.r1 - m.r0) * e);
        m.n.x = x; m.n.y = y; m.n.r = r; m.n.g.setAttribute("transform", `translate(${x.toFixed(2)},${y.toFixed(2)}) scale(${r.toFixed(3)})`); }
      setH(H0 + (sp.Hh - H0) * e); fAx.nu.setAttribute("opacity", e); fOv.nu.setAttribute("opacity", e);
      if (fAx.old) fAx.old.setAttribute("opacity", fAx.o0 * (1 - e)); if (fOv.old) fOv.old.setAttribute("opacity", fOv.o0 * (1 - e)); };
    // cut: a newer update took over, so only clear the old axis and labels; the portraits carry on from where they are
    const finish = cut => { B.done = null; if (!cut) { frame(1); for (const m of moves) if (m.gone !== undefined) { m.n.g.remove(); B.nodes.delete(m.gone); } }
      if (fAx.old) fAx.old.remove(); if (fOv.old) fOv.old.remove(); };
    B.done = finish;
    if (!anim) { finish(); return B.svg; }
    const t0 = performance.now(), DUR = 650, step = now => { const u = Math.min(1, (now - t0) / DUR); if (u >= 1) { finish(); return; } frame(u); B.raf = requestAnimationFrame(step); };
    frame(0); B.raf = requestAnimationFrame(step); return B.svg;
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
    g += `<rect x="${x0}" y="${top + gap * (nodes.length - 1) / 2}" width="${nw}" height="${avail}" fill="var(--ink)"/>` + sqp(h, x0 - 66, cyl - 28, 56)
      + `<text x="${x0 - 38}" y="${cyl + 45}" font-size="11" text-anchor="middle" class="faint">${fmt(r.mains)} mains</text>`;
    const ly = spread(ys, 23, top + 8, Hh - top - 8);
    nodes.forEach((n, i) => { const yy = ly[i], x = x1 + nw + 8;
      if (Math.abs(yy - ys[i]) > 3) g += `<line x1="${x1 + nw + 1}" x2="${x - 2}" y1="${ys[i]}" y2="${yy}" stroke="var(--hair)"/>`;
      g += n.other ? `<text x="${x + 2}" y="${yy + 4}" font-size="12" class="faint">${esc(n.other)} <tspan font-weight="600">${pct(n.p)}</tspan></text>`
                   : sqp(n.h, x, yy - 10, 20) + `<text x="${x + 25}" y="${yy + 4}" font-size="12.5">${esc(nm(n.h))} <tspan font-weight="600">${pct(n.p)}</tspan></text>`; });
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
        + `<rect x="${x + .5}" y="${y0}" width="${Math.max(0, w - 1)}" height="${sh}" fill="${!ok ? "var(--faint)" : dv < 0 ? "var(--red)" : "var(--blue)"}" fill-opacity="${op}"/>${r >= 9 ? sqp(h, x + w / 2 - r, y0 + sh / 2 - r, 2 * r) : ""}</g>`;
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
  /* The ban of theirs that would hurt you most, in plain words, only when it costs you at least 0.1 points: "worst for you:
     Emma Frost (−0.25 points)", or "also the worst for you" when it is their likeliest ban anyway. */
  function worstTxt(F, T) {
    if (F.worst === undefined) return ""; const d = T.mu[F.worst] - T.base; if (!(d <= -.001)) return "";
    return hs(F.worst === F.top ? `also the worst for you (${pp(d)} points)` : `worst for you: ${esc(nm(F.worst))} (${pp(d)} points)`);
  }
  // ---- two-ban turns: first ban (rows) then second (columns), colour only, the best pair outlined with its value; click a cell to ban both
  function pairGrid(P, W) {
    const rows = [], seen = new Set(); for (const p of P) if (!seen.has(p.a)) { seen.add(p.a); rows.push(p.a); }
    const val = new Map(P.map(p => [p.a + "," + p.b, p])), colBest = new Map(); for (const p of P) colBest.set(p.b, Math.max(colBest.get(p.b) ?? -9, p.V));
    const cs = W < 560 ? 40 : 48, L = cs + 10, T = cs + 14, nc = Math.max(4, Math.min(10, Math.floor((W - L) / cs))), cols = Array.from(colBest.keys()).sort((a, b) => colBest.get(b) - colBest.get(a)).slice(0, nc);
    const best = P[0], mx = Math.max(...P.map(p => Math.abs(p.V))), Wd = L + cols.length * cs + 4, Hh = T + rows.length * cs + 4, r = cs * .38;
    // the heroes along the top and down the side: squares the size of the cells, in line with them
    let g = cols.map((h, j) => `<g${T_(`then: <b>${esc(NAMES[h])}</b>`)}>${sqp(h, L + j * cs + 2, T - cs - 6, cs - 4)}</g>`).join("") + rows.map((h, i) => `<g${T_(`first: <b>${esc(NAMES[h])}</b>`)}>${sqp(h, L - cs - 6, T + i * cs + 2, cs - 4)}</g>`).join("");
    g += `<text x="${L - 4}" y="${T - 4}" font-size="10.5" text-anchor="end" class="faint">first ↓ then →</text>`;
    rows.forEach((a, i) => cols.forEach((b, j) => { const p = val.get(a + "," + b), x = L + j * cs, y = T + i * cs;
      if (!p) { g += `<rect x="${x + 2}" y="${y + 2}" width="${cs - 4}" height="${cs - 4}" fill="var(--panel)"/>`; return; }
      const op = (.1 + .82 * Math.min(1, Math.abs(p.V) / mx)).toFixed(2), isB = p === best;
      g += `<rect data-pair="${a},${b}" x="${x + 2}" y="${y + 2}" width="${cs - 4}" height="${cs - 4}" fill="${p.V >= 0 ? "var(--blue)" : "var(--red)"}" fill-opacity="${op}" style="cursor:pointer"${isB ? ' stroke="var(--ink)" stroke-width="2.5"' : ""}${T_(`<b>${esc(NAMES[a])}</b>, then <b>${esc(NAMES[b])}</b>: ${pp(p.V)}<br><span class="d">${spreadTxt(p.spread)}</span><br>click to ban both`)}/>`;
      if (isB) g += `<text x="${x + cs / 2}" y="${y + cs / 2 + 4}" font-size="${cs < 44 ? 11 : 12.5}" font-weight="700" text-anchor="middle" style="fill:var(--paper)" pointer-events="none">${pp(p.V)}</text>`; }));
    return `<svg viewBox="0 0 ${Wd} ${Hh}" width="${Wd}">${g}</svg>`;
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
    return `<div class="wscore"><div class="wtop"><div class="wbig">${pct1(o)}</div><div class="wlab">${done ? "your win chance after these bans" : left ? "the model's win chance, with its best later bans" : "your win chance, whatever they ban last"}</div></div>${gainTxt}${scale}</div>`;
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
    while (compPool.length < CW) { const w = new Worker("sim8-worker.js?v=052b6b4c33"); w.onmessage = ev => compMsg(ev.data); w.onerror = () => compFail(); compPool.push(w); }
    const id = ++compId, s = Object.assign(lobby(), { mates6: [1, 2, 3, 4, 5].map(shownOf) }), parts = compPool.map(() => []);
    for (let j = 0; j < CRUNS; j++) parts[(j % CDRAWS) % compPool.length].push(j);
    COMP = { key, id, done: false, failed: false, pending: 0, us: new Float64Array(H), them: new Float64Array(H), nu: 0, nt: 0, runs: 0, splits: { us: {}, them: {} } };
    parts.forEach((runs, k) => { if (!runs.length) return; COMP.pending++; compPool[k].postMessage({ id, v: LAY.run, type: "values", st: s, cands: ["typ"], opens: true, runs }); });
  }
  function compMsg(d) {
    const C = COMP; if (!C || d.id !== C.id) return;
    if (d.error) { compFail(); return; }
    if (!d.done) return;
    const o = d.opens; for (let h = 0; h < H; h++) { C.us[h] += o.us[h]; C.them[h] += o.them[h]; } C.nu += o.nu; C.nt += o.nt; C.runs += o.runs;
    for (const t of ["us", "them"]) for (const k in o.splits[t]) C.splits[t][k] = (C.splits[t][k] || 0) + o.splits[t][k];
    if (--C.pending === 0) { C.done = true; const el = $("comp"); if (el) el.innerHTML = quiet(compInner()); }
  }
  function compFail() {
    if (!COMP || COMP.failed) return; COMP.failed = true; compPool.forEach(w => w.terminate()); compPool = [];   // new workers on a retry
    const el = $("comp"); if (el) el.innerHTML = quiet(compInner());
  }
  document.addEventListener("click", ev => { if (ev.target && ev.target.id === "compRetry") { COMP = null; compStart(); const el = $("comp"); if (el) el.innerHTML = quiet(compInner()); } });
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
    if (COMP.failed) return `<h2>Likely comps</h2><p class="small">The drafts could not be run. <button class="retry" id="compRetry">Try again</button></p>`;
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
    return `<h2>Likely comps</h2>${head}${grid}`;
  }
  function openers() { compStart(); return `<section class="comp" id="comp">${compInner()}</section>`; }
  // the charts under the advice can be hidden, leaving the call itself, so the panel stays still while you enter bans.
  // The charts and the methods start hidden on every load; their buttons show them for the visit
  let CHARTS = false;
  const chartsBtn = () => `<span class="hbtn"><button id="chartsBtn" title="Show or hide the charts under the advice">${CHARTS ? "Hide charts" : "Show charts"}</button></span>`;
  let METHODS = false;
  const applyMethods = () => { $("methods").classList.toggle("lean", !METHODS); $("methodsBtn").textContent = METHODS ? "Hide" : "Show"; };
  $("methodsBtn").onclick = () => { METHODS = !METHODS; applyMethods(); if (METHODS) figUpdate(); else if (window.MethodFigs && MethodFigs.reset) MethodFigs.reset(); };
  applyMethods();
  const applyCharts = () => { $("advice").classList.toggle("lean", !CHARTS); const b = $("chartsBtn"); if (b) b.textContent = CHARTS ? "Hide charts" : "Show charts"; };
  function renderAdvice() {
    const e = nextBan(), W = figW(); let html = "";
    if (e >= 6) html += `<h2 class="hh">Ban phase complete ${chartsBtn()}</h2>${winLine()}<div class="det">${openers()}</div>`;
    else if (ourTurn() && RES) {
      const cnt = turnCount(), R = RES, pair = cnt === 2 && PAIRS && PAIRS.length ? PAIRS[0] : null;
      const runner = R.cands.filter(h => h !== R.best).sort((a, b) => R.V[b] - R.V[a])[0], clr = runner !== undefined && R.clear(R.best, runner);
      html += `<h2 class="hh"><span>Your ban #${e + 1}${cnt === 2 ? ` and #${e + 2}` : ""}</span>${chartsBtn()}</h2>`;
      html += pair ? `<p class="head">Ban <span class="u">${esc(NAMES[pair.a])}</span>, then <span class="u">${esc(NAMES[pair.b])}</span> <span class="n u">${pp(pair.V)}</span> ${hs("the best ban, then the best ban after it; against a typical first ban followed by the best second ban")}</p>`
        : `<p class="head">Ban <span class="u">${esc(NAMES[R.best])}</span> <span class="n u">${pp(R.V[R.best])}</span> ${hs(runner === undefined ? "" : clr ? `clear of ${esc(nm(runner))}` : `close call with ${esc(nm(runner))}`)}</p>`;
      html += `<div class="fig8" id="boardSlot"></div><div class="det">`;
      if (cnt === 2) html += `<h2>Your two bans</h2>` + (PAIRS && PAIRS.length ? `<div class="fig8">${pairGrid(PAIRS, W)}</div><p class="small">The outlined square is the advice: the best first ban,
        then the best ban once it is made. The other squares score both bans together, for comparison.</p>` : `<p class="small">Scoring pairs&hellip;</p>`);
      const h0 = pair ? pair.a : R.best, SF = subsFlow(h0, W);
      if (SF) html += `<h2>What ${esc(nm(h0))} does to them</h2><p class="head"><span class="n u">${pct(SF.leave)}</span> of ${esc(NAMES[h0])} mains leave ${RN[SF.role]}</p><div class="fig8">${SF.svg}</div>`;
      if (cnt === 1 && REPLY) { const F = forecastStrip(REPLY, W);
        html += `<h2>Their reply</h2><p class="head">They likely answer with <span class="t">${esc(nm(F.top))}</span> <span class="n t">${pct(REPLY.pe[F.top])}</span> ${worstTxt(F, REPLY)}</p><div class="fig8">${F.svg}</div>`; }
      html += more("All bans as a table", rankTable(topBans(12), [
        { th: "Typical", td: h => R.pe[h] < .001 ? "&lt;0.1%" : pct1(R.pe[h]) }, { th: "They open", td: h => LU ? pct(LU.pt[h]) : "" }, { th: "You open", td: h => LU ? pct(LU.pu[h]) : "" }],
        `Value: change in your team's win probability, in points, if you make this ban and follow the advice afterwards, against a typical ban. Band: the range, dot: the value, dashed line: a typical ban. Typical: how often a
        typical team in your seat makes this ban now (the advice only picks bans typical teams make at least 0.1% of the time). They open, you open: the previous model's draft predictions.`));
      html += openers() + "</div>";
    } else if (THEM) {
      const T = THEM, F = forecastStrip(T, W);
      html += `<h2 class="hh"><span>Their ban #${e + 1}</span>${chartsBtn()}</h2><p class="head">Likeliest <span class="t">${esc(NAMES[F.top])}</span> <span class="n t">${pct(T.pe[F.top])}</span> ${worstTxt(F, T)}</p>`;
      html += `<div class="fig8" id="boardSlot"></div><div class="det">`;
      html += more("Why they would ban these", `<figure>${whySplit(T)}<figcaption>The ban model's reasons against an average hero (log-odds). "Your team plays it": teams go after the heroes the
        other team's players play, and the heroes your team shows say who your players are.</figcaption></figure>`);
      html += openers() + "</div>";
    }
    // a timing race can leave the old board in the page: take it out before the new html, so it moves rather than rebuilds
    if (BOARD.svg && BOARD.svg.parentNode) BOARD.svg.parentNode.removeChild(BOARD.svg);
    $("adviceBody").innerHTML = quiet(html); applyCharts();
    if ($("boardSlot")) $("boardSlot").appendChild(drawBoard(W));
    if ($("chartsBtn")) $("chartsBtn").onclick = () => { CHARTS = !CHARTS; applyCharts(); };
    $("adviceBody").querySelectorAll("tr.pick").forEach(el => el.onclick = () => { st.active = { kind: "ban" }; place(+el.dataset.h); });
    $("adviceBody").querySelectorAll("[data-pair]").forEach(el => el.onclick = () => { if (ourTurn() && turnCount() === 2) { const [a, b] = el.dataset.pair.split(",").map(Number); banBoth(a, b); } });
  }
  let REPLY = null;
  window.addEventListener("resize", () => { clearTimeout(window.__rz); window.__rz = setTimeout(() => { if (RES || THEM || DONE) renderAdvice(); }, 150); });

  // ---------------------------------------------------------------- update loop
  let pending = 0;
  function update(recompute = true) {
    writeHash(); figUpdate();
    $("firstBtn").classList.toggle("on", st.first); $("secondBtn").classList.toggle("on", !st.first);
    $("tierSel").value = st.tier; $("mapSel").value = String(st.map);
    renderTeam(); renderTurnHint();
    if (!recompute && (RES || THEM || DONE)) { renderBans(); renderRoster(); return; }
    $("mainEl").classList.add("busy"); const my = ++pending;
    setTimeout(() => {
      if (my !== pending) return;
      const s = lobby(), e = s.bans.length;
      RES = PAIRS = THEM = PATH = REPLY = null; DONE = e >= 6 ? true : null;
      // the turn itself first: the advice line and the board can move at once. Everything else (their reply, the likeliest path,
      // the win chance, the draft forecasts, and on two-ban turns the pairs, about half a second) waits until the board has
      // settled, so no computing lands in the middle of its move
      if (e < 6 && ours(e)) RES = E.ourTurn(s); else if (e < 6) THEM = E.theirTurn(s);
      const rest = () => {
        if (RES && turnCount() === 1 && e + 1 < 6) REPLY = E.theirTurn(Object.assign({}, s, { bans: s.bans.concat([RES.best]) }));
        WIN = { opt: E.winNow(s), beh: E.ready("aux") ? E.winNow(s, "behaviour") : null }; if (!WIN.opt) WIN = null;
        PATH = e < 6 ? E.path(s) : null;
        const m7 = v7map(st.map), s7 = { firstUs: st.first, bans: st.bans.slice(), rev: st.team.filter(h => h >= 0), m: m7, r0: META.tiers[st.tier] };
        LU = m7 === undefined ? null : E7.lineups(E7.ctx(s7)); };
      if (DONE) rest();
      renderBans(); renderRoster(); renderAdvice(); $("mainEl").classList.remove("busy");
      if (DONE) return;
      setTimeout(() => {
        if (my !== pending) return;
        rest(); renderBans(); renderAdvice();
        if (RES && turnCount() === 2) setTimeout(() => {
          if (my !== pending) return;
          const SQ = E.sequence(s, RES), P = E.pairs(s, RES, 6, true) || [];   // the advice first; the other pairs for comparison
          PAIRS = SQ ? E.onAdviceScale([SQ].concat(P.filter(p => !(p.a === SQ.a && p.b === SQ.b))), SQ) : P; renderBans(); renderRoster(); renderAdvice();
        }, 30);
      }, still.matches ? 0 : 700);
    }, 15);
  }

  // ---------------------------------------------------------------- methods: the figures' numbers for the lobby on the page
  /* The ban phase as it stands in this lobby (rank, map, your hero, the teammates shown, the ban order, the bans made): the bans
     already made, their likeliest bans before your next turn, and at that turn your options with their values and ranges; when
     their bans follow, their likeliest replies to your best few and their next ban after those. Also the likeliest path through
     all six bans and the win chance at its end, for "Inside one ending". Once your bans are all made, it shows your last one.
     About twenty turns of the model, so it waits until the lobby settles. */
  function figData() {
    const s0 = lobby(), pat = [0, 1, 2, 3, 4, 5].map(ours), top = (pe, cs, n) => cs.slice().sort((a, b) => pe[b] - pe[a]).slice(0, n);
    let made = st.bans.filter(h => h >= 0), FB = pat.findIndex((u, e) => u && e >= made.length), replay = false;
    if (FB < 0) { FB = pat.lastIndexOf(true); made = made.slice(0, FB); replay = true; }
    const fixed = made.slice(0, FB).map((h, e) => ({ h, us: pat[e], given: true }));
    let bans = fixed.map(f => f.h);
    for (let e = bans.length; e < FB; e++) { const T = E.theirTurn(Object.assign({}, s0, { bans })), h = top(T.pe, T.cands, 1)[0]; fixed.push({ h, us: false, given: false }); bans = bans.concat([h]); }
    const sF = Object.assign({}, s0, { bans }), R = E.ourTurn(sF); if (!R) return null;
    const r5 = x => Math.round(x * 1e5) / 1e5;
    const opts = R.cands.map(h => { const sp = R.spread(h); return { h, v: r5(R.V[h]), lo: r5(sp.lo), hi: r5(sp.hi), p: r5(R.pe[h]) }; }).sort((a, b) => b.v - a.v).slice(0, 6);
    if (FB + 1 < 6 && !pat[FB + 1]) for (const q of opts) {   // their replies, and their next ban after each when that is theirs too
      const T = E.theirTurn(Object.assign({}, sF, { bans: bans.concat([q.h]) })); q.reply = top(T.pe, T.cands, 2).map(h => [h, r5(T.pe[h])]);
      if (FB + 2 < 6 && !pat[FB + 2]) for (const rp of q.reply) { const T2 = E.theirTurn(Object.assign({}, sF, { bans: bans.concat([q.h, rp[0]]) })); rp.push(top(T2.pe, T2.cands, 2).map(h => [h, r5(T2.pe[h])])); } }
    const path = fixed.map((f, e) => ({ e, h: f.h, us: f.us })).concat(E.path(sF).map(x => ({ e: x.e, h: x.h, us: x.us })));
    if (path.length < 6) return null;
    const W = E.winNow(Object.assign({}, s0, { bans: path.map(x => x.h) })), you = st.team[0];
    return { first: st.first, us: pat, FB, fixed, replay, ours: opts, nOurs: R.cands.length, path, win: W ? W[0] : .5, heroes: NAMES, roles: ROLES, portraits: NAMES.map(n => PORT[n]),
      lobby: { map: mapName(LAY.maps[st.map].label || LAY.maps[st.map]), rank: st.tier, you: you >= 0 ? NAMES[you] : null, youH: you, mates: st.team.slice(1) } };
  }
  // the figures are about a third of a second of computing, so they are brought up to date only while the section is open and near
  // the screen, and only once the lobby has been still for a moment (after the board has moved and the advice has filled in)
  let figKey = null, figTimer = 0, figNear = false;
  function figUpdate() {
    if (!window.MethodFigs || !MethodFigs.show) return;
    const key = JSON.stringify([st.tier, st.map, st.first, st.team, st.bans]); if (key === figKey) return;
    clearTimeout(figTimer); if (!figNear || !METHODS) return;
    figTimer = setTimeout(() => { if (!figNear || !METHODS) return; try { const d = figData(); if (d) { figKey = key; MethodFigs.show(d); } } catch (e) { console.error(e); } }, figKey ? 1200 : 0);
  }
  new IntersectionObserver(es => { figNear = es.some(e => e.isIntersecting); if (figNear) figUpdate(); }, { rootMargin: "600px 0px" }).observe($("methods"));

  // ---------------------------------------------------------------- methods: the text around the two figures (methods8.js draws them)
  function renderMethod() {
    const R = REP, C = R.checks, d = C.drafts, W = R.world_model || {}, lob = W.lobbies || 400000, pool = W.stand_in_pool;
    const v83 = !!R.estimator_checks, drq = q => v83 ? q.doubly_robust : q.doubly_robust_capped, simGain = (C.policy.students_vs_players || C.policy.optimal_vs_players).gain_pts;
    const allZero = R.ope.decisions.every(q => drq(q).lo_pts <= 0 && drq(q).hi_pts >= 0), bc = R.ope.behaviour_calibration;
    const slopes = Object.values(bc).map(v => v.slope), sLo = Math.min(...slopes).toFixed(2), sHi = Math.max(...slopes).toFixed(2);
    const ag = C.agreement_by_shown ? Object.values(C.agreement_by_shown).filter(v => v.student_same_advice !== undefined) : [], nAg = sum(ag.map(v => v.lobbies));
    const same = E.S && nAg ? sum(ag.map(v => v.lobbies * v.student_same_advice)) / nAg : null;
    const key = `<svg width="60" height="12" viewBox="0 0 60 12" style="display:inline-block;vertical-align:-1px"><line class="rng0" x1="6" x2="6" y1="0" y2="12"/><rect class="rng us" x="18" y="3" width="36" height="6" rx="3"/><circle class="us" cx="38" cy="6" r="3.6"/></svg>`;
    $("mT2s").textContent = `Each ban opens new branches. Simulated games play them out and are scored where they end, then the scores are carried back to the ban you are about to make. `
      + `This is done ahead of time for ${fmt(lob)} simulated lobbies like yours, so the advice appears instantly.`;
    $("method").innerHTML = `<div class="mgrid"><div class="mcol"><h2>What the numbers mean</h2>
      <p class="formula">value(<i>x</i>) = win chance after you ban <i>x</i> − win chance after a typical ban</p>
      <p>Values are in points of win chance. Every range on the page is drawn the same way: a pale band from low to high, a dot at the value, and a dashed line at
      a typical ban <span style="white-space:nowrap">${key}</span>. A range shows how far the model's own fits disagree. It is not a guarantee.</p>
      <p>Everything is learned from real matches: every PC ranked Season 10 match in our data (${fmt(fitN)} of them) shows how players draft, how teams ban, what people do
      when their main is banned, and which lineups win, each from the players' histories as they stood on the day. The seats you can't see are filled with the habits of real
      players at your rank${pool ? `, drawn from over ${fmt(Math.floor(pool / 1000) * 1000)} of them` : ""}, and the heroes your team has shown stay in.
      The model runs in your browser, so nothing you enter is sent anywhere.</p>
      </div><div class="mcol"><h2>How we check it</h2>
      <p>Every part was chosen on earlier matches and then scored once on ${fmt(R.splits.test.n)} later ones. Simulated drafts look like real teams: 2-2-2 in ${pct(d.two_two_two.model)}
      of teams (real ${pct(d.two_two_two.real)}), and a player whose main is banned stays in role ${pct(d.role_stay_when_forced.model)} of the time (real ${pct(d.role_stay_when_forced.real)}).
      ${same !== null ? `The page gives the same advice as the full model on ${pct(same)} of the turns tested. ` : ""}Inside the simulation, following the advice beats banning the way
      players do by about ${simGain.toFixed(1)} points of win chance. ${allZero ? "In real games that edge is too small to confirm yet: with the matches we have, every interval includes zero." : "In real games the intervals are still wide."}</p>
      <h2>Limits</h2>
      <ul class="small">
        <li>Fitted on PC ranked Season 10 matches from ${fitDates}, mostly Diamond to Celestial. Few lobbies average above 5,000.</li>
        <li>The values average over real players at your rank, not the people in your lobby. Hovers are not in the data, so a shown hero counts as a likely pick.</li>
        <li>The model drafts opening lineups. Mid-match swaps are left out.</li>
        <li>Simulated win chances spread lobbies further apart than real games do (a calibration slope of ${sLo} to ${sHi}), so read them as a ranking more than as exact percentages.</li>
        ${THIN.length ? `<li>Left off the map menu because the data has almost no ranked matches there: ${THIN.map(m => `${esc(m.name)} (${fmt(m.n)})`).join(", ")}.</li>` : ""}
      </ul></div></div>`;
  }
  const SPL = REP.splits, day = t => new Date(t.replace(" ", "T") + "Z").toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" });
  const fitN = SPL.train.n + SPL.validation.n;
  const fitDates = `${day(SPL.train.first_utc)} to ${day(SPL.validation.last_utc)} ${new Date(SPL.validation.last_utc.replace(" ", "T") + "Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`;
  status(""); $("fitted").textContent = `Fitted on ${fmt(fitN)} PC ranked matches from Season 10 (${fitDates}), model ${REP.version} (run ${REP.run}).`;
  renderMethod(); update();
  if (window.MethodFigs) MethodFigs.init({ vq: VQ, pool: (REP.world_model || {}).stand_in_pool }).then(figUpdate).catch(e => console.error(e));
  document.fonts && document.fonts.ready.then(() => { renderMethod(); if (RES || THEM || DONE) renderAdvice(); });
  if (auxP) auxP.then(b => { E.addBuffer("aux", b); update(); }).catch(() => {});
})().catch(e => {                                          // a bad or partial release: no advice rather than a made-up one
  console.error(e); const st_ = document.getElementById("status"), ab = document.getElementById("adviceBody");
  if (st_) st_.textContent = "The model failed to load, so no advice is shown. Reload the page to try again.";
  if (ab) ab.innerHTML = `<p class="small">The model failed to load (${String(e && e.message || e).replace(/[<>&"]/g, "")}). No advice is shown.</p>`;
});
