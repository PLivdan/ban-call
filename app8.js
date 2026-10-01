/* Ban Call, v8: interface. The value networks and the ban model live in engine8.js; the lineup network of the previous model
   (engine.js) still draws the likely openers and orders the roster. This file handles the lobby, input and figures. */
(async function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const LB = document.documentElement.dataset.layout === "b";   // the test layout (beta.html): one column, their likely team as seats, the charts below the heroes
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
  const [BAN, REP, META, PORT] = await Promise.all(["model8/ban_v8.json" + VQ, "model8/report_v8.json" + VQ, "model/meta.json", "model/portraits.json"]
    .map(u => fetch(u).then(r => r.json())));                                          // META: the rank tiers (names and scores) only
  if ((BAN.run && BAN.run !== LAY.run) || (REP.run && REP.run !== LAY.run)) throw new Error(`the model files come from different runs (${LAY.run}, ${BAN.run}, ${REP.run})`);
  const E = new Engine8(LAY, BAN);
  const H = E.H, ORDER = LAY.order, NAMES = LAY.heroes, ROLES = LAY.roles;
  status(`Loading the model (${(LAY.files.opt.bytes / 1e6).toFixed(0)} MB)…`);
  E.addBuffer("opt", await fetchBin(`model8/${LAY.files.opt.path}${VQ}`, LAY.files.opt.bytes, "Loading the model", LAY.files.opt.sha256));   // throws on a bad file
  const auxP = LAY.files.aux ? fetchBin(`model8/${LAY.files.aux.path}${VQ}`, LAY.files.aux.bytes, null, LAY.files.aux.sha256) : null;   // behaviour and robust members: after the page is up
  // a value's range, in plain words: the page never says how many networks sit behind it (the members' lowest to highest in
  // v8.1, one SD either side of the teachers' mean from v8.2 on)
  const spreadTxt = sp => `range ${pp(sp.lo)} to ${pp(sp.hi)}`;
  const img = h => `img/heroes/${PORT[NAMES[h]]}.webp`, short = h => NAMES[h];
  const mapName = s => s.includes(" · ") ? s.replace(" · ", " (") + ")" : s;
  // the v8 model's maps, less those it has barely seen (fewer than MAPMIN Season 10 matches in the data: its advice there is a guess)
  const MAPMIN = 1000, MAPN = REP.map_matches || null, THIN = MAPN ? LAY.maps.filter(m => (MAPN[m.label] ?? 0) < MAPMIN).map(m => ({ name: mapName(m.label), n: MAPN[m.label] ?? 0 })) : [];
  const MAPS = LAY.maps.map((m, i) => ({ i, name: mapName(m.label) })).filter((m, _, a) => !MAPN || (MAPN[LAY.maps[m.i].label] ?? 0) >= MAPMIN).sort((a, b) => a.name.localeCompare(b.name));
  const TIERS = Object.keys(META.tiers);

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
  const slash = (sz, off = 0) => `<svg class="xs" width="${sz}" height="${sz}" style="left:${off}px;top:${off}px;width:${sz}px;height:${sz}px" aria-hidden="true"><line x1="1" y1="1" x2="${sz - 1}" y2="${sz - 1}"/></svg>`;
  const teamSet = () => new Set(st.team.filter(h => h >= 0));
  // the test layout's banned seat: a slash from the parallelogram's top left corner to its bottom right one (the seat's clip-path
  // is 12% in at the top left and at the bottom right), drawn over the whole seat so it meets the corners
  const GSLASH = `<svg class="xs gs" viewBox="0 0 100 100" preserveAspectRatio="none" style="left:0;top:0;width:100%;height:100%" aria-hidden="true"><line x1="12" y1="0" x2="88" y2="100" vector-effect="non-scaling-stroke"/></svg>`;
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
  // Delete or Backspace with a seat selected clears that seat's hero (yours, or theirs as you entered it) and never undoes a ban;
  // with the ban row active it undoes the last ban. Returns whether a seat was selected.
  const clearActive = () => { const a = st.active;
    if (a.kind === "team") { if (st.team[a.i] >= 0 || st.gone.some(g => g.i === a.i)) { LS.clearSlot(st, a.i); update(); } return true; }
    if (a.kind === "them") { if (st.them[a.i] >= 0) { st.them[a.i] = -1; update(); } return true; }
    return false; };
  $("undoBtn").onclick = undo;
  $("newBtn").onclick = () => newLobby();
  $("resetBtn").onclick = () => { st.team = [-1, -1, -1, -1, -1, -1]; st.them = [-1, -1, -1, -1, -1, -1]; st.bans = []; st.gone = []; st.active = { kind: "team", i: 0 }; $("search").value = ""; update(); };
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
    if (a.kind === "them") {                                // the test layout: a hero you see on their team, in place of the prediction
      if (st.bans.includes(h)) return flash(`${NAMES[h]} is banned`);
      for (let k = 0; k < 6; k++) if (st.them[k] === h) st.them[k] = -1; st.them[a.i] = h;
      const nxt = st.them.findIndex((x, i) => x < 0 && i > a.i); st.active = nxt >= 0 ? { kind: "them", i: nxt } : { kind: "ban" };
    } else if (a.kind === "team") {
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
  const score = h => RES.score(h);                                  // the page's rule (engine8.js), anchor included
  const topBans = k => RES ? RES.cands.slice().sort((a, b) => score(b) - score(a)).slice(0, k) : [];
  function quickList() {
    if (st.active.kind === "them") return enemyList(st.active.i);
    if (st.active.kind === "team") {
      const bans = bannedSet(), team = teamSet(), ok = h => h < H && !bans.has(h) && !team.has(h), i = st.active.i;
      const P = i === 0 && st.team[0] >= 0 ? null : seatP(i);            // you keep your hero while it is allowed: your list is for choosing one
      if (!P && i > 0 && shownOf(i) >= 0) return [];                  // a seat with a hero: its own forecast, once the drafts are in
      const src = P || popularity(), ranked = Array.from(src.keys()).filter(ok).sort((a, b) => src[b] - src[a]);
      if (i === 0) { const seen = new Set(), out = [];
        for (const h of MINE.concat(ranked)) if (ok(h) && !seen.has(h) && out.length < 8) { seen.add(h); out.push({ h, lab: MINE.includes(h) ? "yours" : pct(src[h]) }); }
        return out; }
      return ranked.slice(0, 8).map(h => ({ h, lab: pct(src[h]) }));
    }
    if (nextBan() >= 6) return [];
    if (ourTurn()) { if (!RES) return []; let o = topBans(8); const sg = suggested(); if (sg.length) o = [sg[0].h].concat(o.filter(h => h !== sg[0].h)).slice(0, 8); return o.map(h => ({ h, lab: pp(RES.V[h]) })); }
    return THEM ? THEM.cands.slice().sort((a, b) => THEM.pe[b] - THEM.pe[a]).slice(0, 8).map(h => ({ h, lab: pct(THEM.pe[h]) })) : [];
  }
  const quickSide = () => st.active.kind === "them" ? "them" : st.active.kind === "team" || ourTurn() ? "us" : "them";
  /* What the player in seat i opens: the simulator's drafts of this lobby (stand-ins who show what the seat shows, the bans so
     far, the rest of the ban phase as typical teams make it, forced switches when a hero is banned), counted seat by seat; null
     until the drafts for this lobby are in. A seat showing a hero that is still allowed: the other heroes, as shares of the drafts
     where that player switches. */
  function seatP(i) {
    const C = COMP; if (!C || C.failed || C.key !== compKey() || !C.nu) return null;   // from the first batch on
    const p = new Float64Array(H); for (let h = 0; h < H; h++) p[h] = C.slots[i * H + h] / C.nu;
    const own = st.team[i]; if (own >= 0 && p[own] < 1) { const r = 1 - p[own]; for (let h = 0; h < H; h++) p[h] = h === own ? 0 : p[h] / r; }
    return p;
  }
  function teamLab(i) {
    if (i === 0) return "Your hero";
    const g = st.gone.find(x => x.i === i), wait = !seatP(i) && COMP && !COMP.failed;
    if (g) return wait ? `Mate ${i + 1}: drafting&hellip;` : `Mate ${i + 1} swaps from ${esc(short(g.h))}`;
    if (st.team[i] >= 0) return wait ? `Mate ${i + 1}: drafting&hellip;` : `Mate ${i + 1} if they change from ${esc(short(st.team[i]))}`;
    return `Mate ${i + 1}: likely`;
  }
  function renderQuick() {
    const q = quickList(), themMode = st.active.kind === "them", teamMode = st.active.kind === "team" || themMode;
    const lab = themMode ? enemyLab(st.active.i) : teamMode ? teamLab(st.active.i) : ourTurn() ? "Best bans" : "Their likely ban";
    const html = q.length || teamMode ? `<span class="qlab">${lab}</span>` + q.map((x, k) =>
      `<button class="qt ${quickSide()}" data-h="${x.h}" title="${esc(NAMES[x.h])} (key ${k + 1})"><span class="qk">${k + 1}</span><img src="${img(x.h)}" alt=""><span class="qv">${x.lab}</span></button>`).join("") : "";
    $("quickTeam").innerHTML = teamMode && !themMode ? html : ""; $("quick").innerHTML = teamMode ? "" : html; if ($("quickThem")) $("quickThem").innerHTML = themMode ? html : "";
    document.querySelectorAll("#quick .qt, #quickTeam .qt, #quickThem .qt").forEach(el => el.onclick = () => place(+el.dataset.h));
  }
  const quickPick = k => { const q = quickList()[k - 1]; if (q) { place(q.h); return true; } return false; };
  function newLobby() {
    st.bans = []; st.gone = []; st.them = [-1, -1, -1, -1, -1, -1]; for (let i = 1; i < 6; i++) st.team[i] = -1; st.active = st.team[0] < 0 ? { kind: "team", i: 0 } : { kind: "ban" };
    $("search").value = ""; renderMatches(); update();
  }
  let flashT; function flash(msg) { $("turnHint").textContent = msg; clearTimeout(flashT); flashT = setTimeout(renderTurnHint, 1600); }

  // ---------------------------------------------------------------- lobby rendering
  let RES = null, PAIRS = null, THEM = null, PATH = null, WIN = null, DONE = null;
  function renderTeam() {
    $("teamSlots").innerHTML = st.team.map((h, i) => {
      const act = st.active.kind === "team" && st.active.i === i, g = h < 0 ? st.gone.find(x => x.i === i) : null;
      return `<div class="slot${h < 0 ? " empty" : ""}${g ? ` gone ${banSide(g.h)}` : ""}${act ? " active" : ""}" data-i="${i}" title="${h < 0 ? (g ? `${esc(NAMES[g.h])} was banned: click, then pick a hero` : "click, then pick a hero") : esc(NAMES[h]) + ": click to change"}">
        <div class="pw"><div class="pic">${h < 0 ? (g ? `<img src="${img(g.h)}" alt="" style="filter:grayscale(1)">${LB ? GSLASH : slash(60, -2)}` : "+") : `<img src="${img(h)}" alt="${esc(NAMES[h])}"><span class="x" data-clear="${i}">✕</span>`}</div></div>
        ${LB ? `${IDEAL_ON ? `<div class="iw" data-i="${i}"></div>` : ""}<div class="lab">${i === 0 ? "You" : "&nbsp;"}</div></div>`
             : `<div class="lab">${i === 0 ? "You" : "Mate " + (i + 1)}</div><div class="lab">${h >= 0 ? esc(short(h)) : g ? `<s>${esc(short(g.h))}</s>` : "&nbsp;"}</div></div>`}`;
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
    if (LB) for (const [side, id] of [["us", "banUs"], ["them", "banThem"]]) {   // the test layout: each team's three bans sit above its seats
      const box = $(id); box.innerHTML = "";   // theirs mirrored, so both teams' last bans face each other across the middle
      $("banSlots").querySelectorAll(`.slot.${side}`).forEach(el => { el.querySelector(".pic").dataset.n = +el.dataset.i + 1; side === "us" ? box.appendChild(el) : box.prepend(el); }); }   // data-n: the ban's number, as a corner badge
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
  function renderTurnHint() { const e = nextBan(); $("target").innerHTML = ""; $("turnHint").innerHTML = e >= 6 && !LB ? "Ban phase complete." : ""; }   // the test layout: no completion line
  // roster order and the lists before the drafts are in: how much each hero is played at the selected rank, from the v8 world
  // model's stand-in teams at the rank band (the ban model's view of a lobby)
  const POPC = new Map();
  function popularity() {
    const bd = E.band(META.tiers[st.tier]); if (POPC.has(bd)) return POPC.get(bd);
    const T = BAN.stand_in_team_shares[bd], p = new Float64Array(H); for (const t of T) for (let h = 0; h < H; h++) p[h] += t[h] / (6 * T.length);
    POPC.set(bd, p); return p;
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
        const team = st.active.kind === "team", miss = []; let i = team ? st.active.i : 0;
        for (const q of parts) {
          if (team) { while (i < 6 && st.team[i] >= 0 && i !== st.active.i) i++; if (i >= 6) break; st.active = { kind: "team", i }; }
          $("search").value = q; const m = searchMatches();
          if (m.length) { place(m[0]); if (team) i++; } else miss.push(q);           // a name that matches nothing keeps its seat free
        }
        if (team) st.active = { kind: "ban" }; $("search").value = miss.join(", "); renderMatches(); update(false); }   // unmatched names stay in the box
      else { const m = searchMatches(); if (m.length) place(m[0]); }
      ev.preventDefault(); }
    else if (/^[1-8]$/.test(ev.key) && !$("search").value) { quickPick(+ev.key); ev.preventDefault(); }
    else if ((ev.key === "Backspace" || ev.key === "Delete") && !$("search").value) { if (!clearActive() && st.bans.length) undo(); ev.preventDefault(); }
    else if (ev.key === "Escape") { $("search").value = ""; renderRoster(); }
  };
  document.addEventListener("keydown", ev => {
    if (ev.target.tagName === "INPUT" || ev.target.tagName === "SELECT" || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key === "/") { $("search").focus(); ev.preventDefault(); }
    else if (/^[1-8]$/.test(ev.key)) { quickPick(+ev.key); ev.preventDefault(); }
    else if (ev.key.length === 1 && /[a-z&]/i.test(ev.key)) { $("search").focus(); }
    else if (ev.key === "Backspace" || ev.key === "Delete") { if (!clearActive() && st.bans.length) undo(); ev.preventDefault(); }
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
  let tipEl = null, tipText = "", tipW = 0, tipH = 0;         // the tooltip is filled and measured once per element, then only moved
  document.addEventListener("mousemove", ev => {
    const el = ev.target.closest ? ev.target.closest("[data-tip]") : null; if (!el) { tipEl = null; tip.classList.remove("on"); return; }
    const txt = el.getAttribute("data-tip");
    if (el !== tipEl || txt !== tipText) { tipEl = el; tipText = txt; tip.innerHTML = txt; tipW = tip.offsetWidth; tipH = tip.offsetHeight; }
    const w = tipW, h = tipH; let x = ev.clientX + 14, y = ev.clientY + 16; if (x + w > innerWidth - 8) x = ev.clientX - w - 14; if (y + h > innerHeight - 8) y = ev.clientY - h - 12;
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
        it.tip = `<b>${esc(NAMES[h])}</b> ${pp(it.v)}<br><span class="d">${spreadTxt(R.spread(h))}<br>typical teams ban it now: ${R.pe[h] < .001 ? "under 0.1%" : pct1(R.pe[h])}${rare ? "<br>too rare for the advice to pick" : ""}</span><br>click to ban`; }
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
    const ext0 = Math.max(...items.map(i => Math.abs(i.y) + i.r)) + 4, ext = LB ? Math.max(ext0, W < 560 ? 96 : 128) : ext0;   // the test layout keeps the board one height
    const cy = ext + 28, base = cy + ext + 18, Hh = base + 36;
    items.forEach(it => it.y += cy);
    let ax = ticks(lo, hi, W < 560 ? 3 : 5).map(t => `<line x1="${X(t)}" x2="${X(t)}" y1="14" y2="${base}" stroke="var(--hair)"/><text x="${X(t)}" y="${base + 15}" font-size="11" text-anchor="middle" class="faint">${them && !zeroLab ? pct(t) : pp(t, t && Math.abs(t) < .01 ? 2 : 1)}</text>`).join("");
    if (zeroLab) ax += `<line class="rng0" x1="${X(0)}" x2="${X(0)}" y1="14" y2="${base}"/>` + (LB ? "" : `<text x="${X(0)}" y="${base + 29}" font-size="11" text-anchor="middle" class="faint">${zeroLab}</text>`);
    if (!LB) ax += `<text x="${W - PAD}" y="${base + 29}" font-size="11" text-anchor="end" class="faint">${axLab}</text>`;   // the test layout: a legend under the board instead
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
  // ---- where the banned hero's players go: a Sankey, each flow in the colour of the role it ends in. r: top ([name, share]),
  // same_role (the share staying in the hero's role) and n (the players behind it)
  function subsFlow(h, W, r) {
    if (!r || !r.top.length || r.same_role === null) return null;
    const role = ROLES[h], tops = r.top.slice(0, 6).map(([n, p]) => ({ h: IDX.get(n), p })), same = tops.filter(t => ROLES[t.h] === role), oth = tops.filter(t => ROLES[t.h] !== role);
    const remS = Math.max(0, r.same_role - sum(same.map(t => t.p))), remO = Math.max(0, 1 - r.same_role - sum(oth.map(t => t.p)));
    const nodes = same.sort((a, b) => b.p - a.p).concat(remS > .005 ? [{ other: `other ${RN[role]}s`, p: remS, role }] : [])
      .concat(oth.sort((a, b) => ROLES[a.h] - ROLES[b.h] || b.p - a.p)).concat(remO > .005 ? [{ other: "another role", p: remO, role: -1 }] : []);
    const Hh = 290, top = 12, gap = 7, avail = Hh - 2 * top - gap * (nodes.length - 1), x0 = 96, nw = 11, x1 = Math.min(W - 180, x0 + 230);
    let y = top, yl = top + gap * (nodes.length - 1) / 2, g = ""; const ys = [];
    nodes.forEach(n => { const hgt = Math.max(1.5, n.p * avail); n.y0 = y; n.y1 = y + hgt; n.l0 = yl; n.l1 = yl + n.p * avail; y += hgt + gap; yl += n.p * avail; ys.push((n.y0 + n.y1) / 2); });
    const col = n => (n.other ? n.role === role : ROLES[n.h] === role) ? "var(--faint)" : "var(--blue)";
    for (const n of nodes) {
      g += `<path d="${band(x0 + nw, n.l0, n.l1, x1, n.y0, n.y1)}" fill="${col(n)}" opacity="${n.other ? .22 : .38}"${T_(`${esc(NAMES[h])} players → <b>${esc(n.other || NAMES[n.h])}</b> ${pct(n.p)}`)}/>`
        + `<rect x="${x1}" y="${n.y0}" width="${nw}" height="${n.y1 - n.y0}" fill="${col(n)}"/>`;
    }
    const cyl = top + gap * (nodes.length - 1) / 2 + avail / 2;
    g += `<rect x="${x0}" y="${top + gap * (nodes.length - 1) / 2}" width="${nw}" height="${avail}" fill="var(--ink)"/>` + sqp(h, x0 - 66, cyl - 28, 56)
      + `<text x="${x0 - 38}" y="${cyl + 45}" font-size="11" text-anchor="middle" class="faint">${fmt(r.n)} players</text>`;
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
    const scale = `<svg viewBox="0 0 ${Wd} 42" aria-hidden="true" data-lo="${lo}" data-hi="${hi}" data-wd="${Wd}"><line x1="12" x2="${Wd - 12}" y1="14" y2="14" stroke="var(--hair)" stroke-width="6" stroke-linecap="round"/>
      ${half ? `<line x1="${X(.5)}" x2="${X(.5)}" y1="4" y2="24" stroke="var(--faint)" stroke-dasharray="2 2"/><text x="${X(.5)}" y="38" font-size="12" text-anchor="middle" class="faint">50%, a coin flip</text>` : ""}
      ${b !== null && !done ? `<line x1="${X(Math.min(o, b))}" x2="${X(Math.max(o, b))}" y1="14" y2="14" stroke="var(--blue)" stroke-width="6"/><circle cx="${X(b)}" cy="14" r="5" fill="var(--paper)" stroke="var(--faint)" stroke-width="2"><title>both teams ban as usual: ${pct1(b)}</title></circle>` : ""}
      <circle class="wdot" cx="${X(o)}" cy="14" r="7" fill="var(--blue)"><title>${pct1(o)}</title></circle>
      <text x="12" y="38" font-size="12" class="faint">${Math.round(100 * lo)}%</text><text x="${Wd - 12}" y="38" font-size="12" text-anchor="end" class="faint">${Math.round(100 * hi)}%</text></svg>`;
    const gainTxt = !done && gain !== null ? `<div class="wgain"><span class="wchip">${pp(gain, 1)}</span>points over both teams banning as usual (${pct1(b)})</div>` : "";
    return `<div class="wscore"><div class="wtop"><div class="wbig" data-v="${o}">${pct1(o)}</div><div class="wlab">${done ? "your win chance after these bans" : left ? "the model's win chance, with its best later bans" : "your win chance, whatever they ban last"}</div></div>${gainTxt}${scale}</div>`;
  }
  const quiet = html => html.replace(/<(figcaption|caption)>([\s\S]*?)<\/\1>/g, (m, t, x) => `<${t}><details class="more"><summary>How to read this</summary>${x}</details></${t}>`);
  const more = (label, body) => `<details class="more" style="margin:2px 0 10px 0"><summary>${label}</summary>${body}</details>`;
  // ---- likely comps: the v8 simulator plays this lobby out in background workers (stand-ins near your rank, the rest of the
  // bans as typical teams make them, both teams' drafts from the pick model) and counts what each team opens, and what each of
  // our seats opens (the teammate lists). It runs for every lobby state
  // The workers stay up (their model files load once, at the start). A lobby is 16 stand-in draws, each played out twice (run j
  // uses draw j % 32, so runs 32-47 replay the draws of runs 0-15 with new random numbers for the rest of the ban phase). A draw is
  // the slow part and each worker keeps its own, so a batch carries a block of draws with both of their runs: one batch per worker
  // (at least two), so the seat forecasts show after the first batch and sharpen as the rest come in
  const CW = Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)), CNB = Math.max(CW, 2);
  const CBATCHES = Array.from({ length: CNB }, (_, i) => { const a = Math.round(i * 16 / CNB), b = Math.round((i + 1) * 16 / CNB), d = Array.from({ length: b - a }, (_, k) => a + k); return d.concat(d.map(x => x + 32)); });
  let compPool = [], COMP = null, compId = 0, COMP_LAST = null;   // COMP_LAST: the last lobby's drafts, shown on their seats while a new lobby's first batch runs
  const compKey = () => JSON.stringify([st.tier, st.map, st.first, [0, 1, 2, 3, 4, 5].map(shownOf), st.bans, st.them]);
  function compWorkers() {
    while (compPool.length < CW) { const w = new Worker("sim8-worker.js?v=546a374ed8"); w.busy = true; w.onmessage = ev => compMsg(w, ev.data); w.onerror = () => compFail(); compPool.push(w);
      w.postMessage({ id: 0, v: LAY.run, type: "warm" }); }                       // load the model now, not on the first click
  }
  function compDispatch() {
    const C = COMP; if (!C || C.failed) return;
    for (const w of compPool) {
      if (w.busy || C.next >= CBATCHES.length) continue;
      const runs = CBATCHES[C.next++];
      w.busy = true; C.pending++; w.postMessage({ id: C.id, v: LAY.run, type: "values", st: C.st, cands: ["typ"], opens: true, runs, plan: C.plan });
    }
  }
  function compStart() {
    const key = compKey(); if (COMP && COMP.key === key) return;                   // a failed lobby stays failed until Try again (compRetry clears COMP)
    if (COMP && !COMP.failed && COMP.nt) COMP_LAST = COMP;
    compWorkers();
    // the test layout: our later bans in the drafts follow the page's advice (its likeliest path), not a typical team's, so showing a
    // hero moves their predicted team only through the bans you would make and theirs (a typical team protects its own players' heroes)
    let plan = null; if (LB && st.bans.length < 6) { const pth = E.path(lobby()) || []; plan = {}; for (const x of pth) if (x.us) plan[x.e] = x.h; }
    COMP = { key, id: ++compId, st: Object.assign(lobby(), { mates6: [1, 2, 3, 4, 5].map(shownOf) }), next: 0, pending: 0, done: false, failed: false,
             us: new Float64Array(H), them: new Float64Array(H), slots: new Float64Array(6 * H), nu: 0, nt: 0, runs: 0, splits: { us: {}, them: {} }, swap: {}, plan };
    compDispatch();
  }
  function compMsg(w, d) {
    if (!d.done && !d.error) return;                                            // only finished jobs and errors count
    w.busy = false; const C = COMP;
    if (C && d.id === C.id && !C.failed) {
      if (d.error) { compFail(); return; }
      const o = d.opens; for (let h = 0; h < H; h++) { C.us[h] += o.us[h]; C.them[h] += o.them[h]; } C.nu += o.nu; C.nt += o.nt; C.runs += o.runs;
      if (o.slots) for (let k = 0; k < o.slots.length; k++) C.slots[k] += o.slots[k];
      if (o.swap) for (const j in o.swap) { const v = C.swap[j] || (C.swap[j] = new Float64Array(H)); o.swap[j].forEach((x, k) => v[k] += x); }
      for (const t of ["us", "them"]) for (const k in o.splits[t]) C.splits[t][k] = (C.splits[t][k] || 0) + o.splits[t][k];
      C.pending--; if (C.next >= CBATCHES.length && C.pending === 0) { C.done = true; const el = $("comp"); if (el) el.innerHTML = quiet(compInner()); }
      renderEnemy(); renderQuick(); fillOpens();                                // the forecasts so far (their seats first: their list reads them)
    }
    compDispatch();                                                             // this worker is free: the current lobby's next batch
  }
  function compFail() {
    if (!COMP || COMP.failed) return; COMP.failed = true; compPool.forEach(w => w.terminate()); compPool = [];   // new workers on a retry
    const el = $("comp"); if (el) el.innerHTML = quiet(compInner()); renderQuick(); fillOpens(); renderEnemy();
  }
  const opnVal = (side, h) => { const C = COMP; if (!C || C.key !== compKey() || C.failed) return ""; if (!C.nu) return "&hellip;"; const n = side === "us" ? C.nu : C.nt; return n ? pct(C[side][h] / n) : ""; };
  const opnCell = (side, h) => `<span class="opn" data-s="${side}" data-h="${h}">${opnVal(side, h)}</span>`;
  function fillOpens() { document.querySelectorAll(".opn").forEach(el => el.innerHTML = opnVal(el.dataset.s, +el.dataset.h)); }
  document.addEventListener("click", ev => { if (ev.target && ev.target.id === "compRetry") { COMP = null; compStart(); const el = $("comp"); if (el) el.innerHTML = quiet(compInner()); renderEnemy(); } });
  const splitName = k => k.split("-").map((n, r) => `${n} ${RN[r]}${n === "1" ? "" : "s"}`).join(", ");
  const RNC = ["Vanguard", "Duelist", "Strategist"];
  /* One team's numbers: open chances per hero, role splits by frequency, and per role a ranked list: the heroes that fill the
     most common split (picks), then the next two (alternatives, at least 3% of drafts). */
  function compSide(side, C = COMP) {
    const n = side === "us" ? C.nu : C.nt, P = Array.from(C[side], x => x / Math.max(n, 1));   // a plain array: a typed array's map can only return numbers
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
  /* Their likely team (test layout): the most common role split in the simulated drafts of this lobby, filled role by role with
     the heroes their stand-ins open most, each with how often it is opened and the next hero of that role. A click bans it. */
  /* Their seat i's list (test layout), as your seats have one: a seat you entered, what that player would switch to (the simulator's
     stand-ins who play that hero, choosing again without it); a predicted seat, the other heroes of its role their team opens. */
  let ENEMY = [];
  const themComp = () => { const C = COMP, live = C && C.key === compKey();
    if (live && (C.failed || C.nt)) return C;                         // this lobby's drafts, once in
    if (!LB) return null;
    if (C && !C.failed && C.nt) return C;                             // the lobby just left (its drafts, until the new ones start)
    return COMP_LAST && !(live && C.failed) ? COMP_LAST : null; };      // the lobby before, while the new one's first batch runs
  function enemyList(i) {
    const E_ = ENEMY[i], C = themComp(); if (!E_ || !C || C.failed || !C.nt) return [];
    const bans = bannedSet(), onThem = new Set(ENEMY.filter(Boolean).map(x => x.h)), ok = h => !bans.has(h) && !onThem.has(h);
    let P;
    if (E_.seen) { const v = C.swap[i]; if (!v) return []; const s = v.reduce((a, b) => a + b, 0) || 1; P = Array.from(v, x => x / s); }
    else { const r = ROLES[E_.h]; P = Array.from(C.them, (x, h) => ROLES[h] === r ? x / C.nt : 0); }
    return P.map((p, h) => ({ h, p })).filter(x => x.p > 0 && ok(x.h)).sort((a, b) => b.p - a.p).slice(0, 8).map(x => ({ h: x.h, lab: pct(x.p) }));
  }
  function enemyLab(i) {
    const E_ = ENEMY[i]; if (!E_) return "Their seat: drafting&hellip;";
    return E_.seen ? `If they switch from ${esc(short(E_.h))}` : `Their ${ROLE_NAMES[ROLES[E_.h]].toLowerCase()}: likely`;
  }
  function renderEnemy() {
    const box = $("enemySlots"); if (!LB || !box) return;
    const C = themComp(), live = !!C, seen = st.them, act = i => st.active.kind === "them" && st.active.i === i;
    // the prediction for the seats you have not entered: the commonest role split, filled role by role with their commonest heroes
    // (the drafts already hold the entered heroes fixed), skipping the heroes you entered
    let pred = [];
    if (live && !C.failed && C.nt) {
      const S = compSide("them", C), P = S.P, best = S.sp.length ? S.sp[0].k.split("-").map(Number) : [2, 2, 2], taken = new Set(seen.filter(h => h >= 0));
      const need = best.slice(); for (const h of taken) need[ROLES[h]] = Math.max(0, need[ROLES[h]] - 1);
      pred = [0, 1, 2].flatMap(r => P.map((p, h) => ({ h, p })).filter(x => ROLES[x.h] === r && x.p > 0 && !taken.has(x.h)).sort((a, b) => b.p - a.p).slice(0, need[r]));
    }
    let k = 0; ENEMY = seen.map(h => h >= 0 ? { h, seen: true } : null);
    box.innerHTML = seen.map((h, i) => {
      if (h >= 0) return `<div class="slot them seen${act(i) ? " active" : ""}" data-i="${i}" title="${esc(NAMES[h])}, seen in the game: click to change"><div class="pic"><img src="${img(h)}" alt="${esc(NAMES[h])}"><span class="x" data-clear="${i}">✕</span></div><div class="lab">&nbsp;</div></div>`;
      const x = pred[k++]; if (x) ENEMY[i] = { h: x.h, seen: false };
      if (!x) return `<div class="slot them empty${act(i) ? " active" : ""}" data-i="${i}" title="click, then pick the hero you see"><div class="pic">?</div><div class="lab">&nbsp;</div></div>`;
      return `<div class="slot them${act(i) ? " active" : ""}" data-i="${i}" title="Predicted: ${esc(NAMES[x.h])} (${pct(x.p)} of simulated drafts). Click, then pick the hero you see"><div class="pic"><img src="${img(x.h)}" alt="${esc(NAMES[x.h])}"></div><div class="lab"><span class="pct">${pct(x.p)}</span></div></div>`;
    }).join("");
    $("enemyHead").innerHTML = live && C.failed ? `The drafts could not be run. <button class="retry" id="compRetry">Try again</button>` : "";
    box.querySelectorAll(".slot").forEach(el => el.onclick = ev => { const i = +el.dataset.i;
      if (ev.target.dataset.clear !== undefined) { st.them[i] = -1; st.active = { kind: "them", i }; update(); return; }
      st.active = act(i) ? { kind: "ban" } : { kind: "them", i }; update(false); });
  }
  /* Our ideal lineup (test layout): the six heroes that win most against their likely drafts for the players behind our seats,
     after the ban phase the page expects (the advice for our bans, their likeliest for theirs), from a worker (Sim8.idealComp over 8 stand-in draws). Swaps stay within a seat's role unless changing roles gains at least
     half a point, and a seat that shows a hero keeps it unless switching gains that much on its own. Shown as icons under the seats.
     No gain in points is shown: an optimised lineup's modelled edge is far larger than any real one (the outcome model adds
     hero effects up and the search picks its maximum). */
  let IDEAL = null, idealW = null, idealId = 0;
  const IDEAL_ON = document.documentElement.dataset.ideal === "on";   // hidden for now: <html data-ideal="on"> shows it again
  function idealStart() {
    if (!LB || !IDEAL_ON) return; const key = compKey(); if (IDEAL && IDEAL.key === key) return;
    IDEAL = { key, id: ++idealId, done: false, failed: false }; renderIdeal();
    if (!idealW) {
      idealW = new Worker("sim8-worker.js?v=546a374ed8");
      idealW.onmessage = ev => { const d = ev.data; if (!IDEAL || d.id !== IDEAL.id) return;
        if (d.error) IDEAL.failed = true; else if (d.done) Object.assign(IDEAL, d.ideal, { done: true }); else return; renderIdeal(); };
      idealW.onerror = () => { idealW.terminate(); idealW = null; if (IDEAL) { IDEAL.failed = true; renderIdeal(); } };
    }
    // the ban phase as the page expects it to go (your advised bans, their likeliest), so the lineup never uses a hero about to be banned
    const s = lobby(), rest = s.bans.length < 6 ? (E.path(s) || []).map(x => x.h) : [];
    idealW.postMessage({ id: IDEAL.id, v: LAY.run, type: "ideal", st: Object.assign(s, { bans: s.bans.concat(rest), mates6: [1, 2, 3, 4, 5].map(shownOf) }), runs: [0, 1, 2, 3, 4, 5, 6, 7], thr: .005 });
  }
  function renderIdeal() {
    if (!LB || !IDEAL_ON) return; const I = IDEAL && IDEAL.key === compKey() && IDEAL.done ? IDEAL : null;
    document.querySelectorAll("#teamSlots .iw").forEach(el => {
      const i = +el.dataset.i; if (!I) { el.innerHTML = `<span class="ipic empty"></span>`; el.title = ""; return; }
      const h = I.A[i], s = shownOf(i), same = h === s, roleSwap = s >= 0 && !same && ROLES[s] !== ROLES[h];
      el.className = "iw" + (same ? " same" : "") + (roleSwap ? " role" : "");
      el.title = same ? `Ideal after the bans: keep ${NAMES[h]}` : s < 0 ? `Ideal after the bans: ${NAMES[h]}` : `Ideal after the bans: swap ${NAMES[s]} for ${NAMES[h]}${roleSwap ? " (a role change: it gains at least half a point over staying in role)" : ""}`;
      el.innerHTML = `<span class="ipic"><img src="${img(h)}" alt="${esc(NAMES[h])}"></span>`;
    });
  }
  function openers() { compStart(); return `<section class="comp" id="comp">${compInner()}</section>`; }
  // the charts under the advice can be hidden, leaving the call itself, so the panel stays still while you enter bans.
  // The charts and the methods start hidden on every load; their buttons show them for the visit
  let CHARTS = false;
  const chartsBtnHtml = () => `<span class="hbtn"><button id="chartsBtn" title="Show or hide the charts under the advice">${CHARTS ? "Hide charts" : "Show charts"}</button></span>`;
  const chartsBtn = () => LB ? "" : chartsBtnHtml();          // the test layout has no charts, so no button
  let METHODS = false;
  const applyMethods = () => { $("methods").classList.toggle("lean", !METHODS); $("methodsBtn").textContent = METHODS ? "Hide" : "Show"; };
  $("methodsBtn").onclick = () => { METHODS = !METHODS; applyMethods(); if (METHODS) figUpdate(); else if (window.MethodFigs && MethodFigs.reset) MethodFigs.reset(); };
  applyMethods();
  const comps = () => LB ? (compStart(), "") : openers();       // the test layout shows the drafts as their likely team instead
  const applyCharts = () => { $("advice").classList.toggle("lean", !CHARTS); if ($("adviceMore")) $("adviceMore").classList.toggle("lean", !CHARTS); const b = $("chartsBtn"); if (b) b.textContent = CHARTS ? "Hide charts" : "Show charts"; };
  /* The board's legend (test layout): a key of its marks, and what left to right means, in place of the labels inside the board. */
  function boardLegend(them) {
    // the keys use portraits from this lobby's board, drawn as the board draws them
    const sw = inner => `<svg width="30" height="22" viewBox="0 0 30 22" aria-hidden="true">${inner}</svg>`;
    const face = (h, r, stroke, w, rare) => h === undefined ? "" : sw(`<image href="${img(h)}" x="${15 - r}" y="${11 - r}" width="${2 * r}" height="${2 * r}" clip-path="url(#cc)" preserveAspectRatio="xMidYMid slice"${rare ? ' class="rare"' : ""}/>`
      + `<circle cx="15" cy="11" r="${r}" fill="none" stroke="${stroke}" stroke-width="${w}"/>`);
    const typ = sw(`<line class="rng0" x1="15" x2="15" y1="2" y2="20"/>`);
    let items, axis;
    if (them) {
      const T = THEM, o = T.cands.slice().sort((a, b) => T.pe[b] - T.pe[a]), rare = o.find(h => T.pe[h] < .04);
      items = [[face(o[0], 9, "var(--red)", 2.5), "Their likeliest ban"],
               [sw(`<image href="${img(o[2])}" x="1" y="7" width="9" height="9" clip-path="url(#cc)"/><image href="${img(o[1])}" x="12" y="2" width="17" height="17" clip-path="url(#cc)"/>`), "Bigger: more likely"],
               [face(rare, 6, "var(--paper)", 1.5, true), "Unlikely (under 4%)"], [typ, "Their typical ban"]];
      axis = "Across: your win chance, in points, if they ban it, against their typical ban. Click a portrait if they banned it.";
    } else {
      const R = RES, other = R.cands.filter(h => h !== R.best && R.supported.has(h)).sort((a, b) => R.V[b] - R.V[a])[0], rare = R.cands.find(h => !R.supported.has(h));
      items = [[face(R.best, 9, "var(--blue)", 2.5), "The advice"], [face(other, 6, "var(--paper)", 1.5), "Other bans"], [face(rare, 6, "var(--paper)", 1.5, true), "Too rare to advise"],
               [typ, "A typical ban"], [sw(`<rect class="rng us" x="2" y="8" width="26" height="6" rx="3"/><circle cx="18" cy="11" r="3.6" class="us"/>`), "The advice's range"]];
      axis = "Across: your win chance, in points, after the ban, against a typical ban. Click a portrait to ban it.";
    }
    return `<div class="blegend">${items.filter(([s]) => s).map(([s, l]) => `<span class="bkey">${s}${l}</span>`).join("")}<span class="baxis">${axis}</span></div>`;
  }
  /* The test layout: the win chance glides from the value on screen to the new one (the number and its dot), whenever the lobby
     changes it; a change mid-glide carries on from where it is. */
  let WSHOW = null, WRAF = 0;
  function animWin() {
    const el = document.querySelector("#adviceBody .wbig"); if (!el) { WSHOW = null; cancelAnimationFrame(WRAF); return; }
    const v1 = +el.dataset.v, v0 = WSHOW; cancelAnimationFrame(WRAF);
    if (v0 === null || Math.abs(v1 - v0) < 1e-6 || still.matches || document.hidden) { WSHOW = v1; return; }   // hidden: frames are paused, so no glide
    const svg = el.closest(".wscore").querySelector("svg[data-lo]"), dot = svg && svg.querySelector(".wdot");
    const lo = svg ? +svg.dataset.lo : 0, hi = svg ? +svg.dataset.hi : 1, Wd = svg ? +svg.dataset.wd : 0, X = v => 12 + (Math.min(Math.max(v, lo), hi) - lo) / (hi - lo) * (Wd - 24);
    const t0 = performance.now(), D = 600;
    const step = now => { const u = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - u, 3), v = v0 + (v1 - v0) * e; WSHOW = v;
      el.textContent = pct1(v); if (dot) dot.setAttribute("cx", X(v)); if (u < 1) WRAF = requestAnimationFrame(step); };
    step(t0);
  }
  function renderAdvice() {
    const e = nextBan(), W = figW(); let html = "";
    // the test layout: when the board gives way to the result (or comes back on an undo), fade out, ease the height, fade in
    if (LB && ADV_ANIM) { ADV_PENDING = true; return; }             // mid-animation: draw the latest state once it ends
    if (LB) { const mode = e >= 6 ? "done" : "board";
      if (ADV_MODE && mode !== ADV_MODE && !still.matches && !ADV_ANIM) {
        ADV_ANIM = true; const A = $("advice"), B = $("adviceBody"), h0 = A.offsetHeight;
        B.style.transition = "opacity .22s ease"; B.style.opacity = "0";
        setTimeout(() => {
          ADV_MODE = mode; A.style.minHeight = ""; A.style.height = h0 + "px"; A.style.overflow = "hidden";
          ADV_ANIM = false; ADVH = 0; renderAdvice(); ADV_ANIM = true; A.style.minHeight = "";   // no minimum while it eases
          A.style.height = "auto"; const h1 = A.offsetHeight; A.style.height = h0 + "px";   // the block's own height, margins included (the inner body's is short of it)
          A.style.transition = "height .45s ease"; void A.offsetHeight;
          requestAnimationFrame(() => { A.style.height = h1 + "px"; B.style.opacity = "1"; });
          setTimeout(() => { A.style.transition = ""; A.style.height = ""; A.style.overflow = ""; B.style.transition = "";
            ADV_ANIM = false; ADVH = A.offsetHeight; A.style.minHeight = ADVH + "px"; if (ADV_PENDING) { ADV_PENDING = false; renderAdvice(); } }, 480);
        }, 230);
        return;
      }
      ADV_MODE = mode; }
    if (e >= 6) html += `<h2 class="hh">Ban phase complete ${chartsBtn()}</h2>${winLine()}<div class="det">${comps()}</div>`;
    else if (ourTurn() && RES) {
      const cnt = turnCount(), R = RES, pair = cnt === 2 && PAIRS && PAIRS.length ? PAIRS[0] : null;
      const runner = R.cands.filter(h => h !== R.best).sort((a, b) => R.V[b] - R.V[a])[0], clr = runner !== undefined && R.clear(R.best, runner);
      if (!LB) html += `<h2 class="hh"><span>Your ban #${e + 1}${cnt === 2 ? ` and #${e + 2}` : ""}</span>${chartsBtn()}</h2>`;
      if (!LB) html += pair ? `<p class="head">Ban <span class="u">${esc(NAMES[pair.a])}</span>, then <span class="u">${esc(NAMES[pair.b])}</span> <span class="n u">${pp(pair.V)}</span> ${hs("the best ban, then the best ban after it; against a typical first ban followed by the best second ban")}</p>`
        : `<p class="head">Ban <span class="u">${esc(NAMES[R.best])}</span> <span class="n u">${pp(R.V[R.best])}</span> ${hs(runner === undefined ? "" : clr ? `clear of ${esc(nm(runner))}` : `close call with ${esc(nm(runner))}`)}</p>`;
      html += `<div class="fig8" id="boardSlot"></div>${LB ? boardLegend(false) : ""}<div class="det">`;
      if (cnt === 2) html += `<h2>Your two bans</h2>` + (PAIRS && PAIRS.length ? `<div class="fig8">${pairGrid(PAIRS, W)}</div><p class="small">The outlined square is the advice: the best first ban,
        then the best ban once it is made. The other squares score both bans together, for comparison.</p>` : `<p class="small">Scoring pairs&hellip;</p>`);
      const h0 = pair ? pair.a : R.best; html += `<div id="sfSlot">${sfHtml(h0, W)}</div>`; if (CHARTS) flowStart(h0);
      if (cnt === 1 && REPLY) { const F = forecastStrip(REPLY, W);
        html += `<h2>Their reply</h2><p class="head">They likely answer with <span class="t">${esc(nm(F.top))}</span> <span class="n t">${pct(REPLY.pe[F.top])}</span> ${worstTxt(F, REPLY)}</p><div class="fig8">${F.svg}</div>`; }
      const cntBinds = !!E.CNT && E.CNT.some(p => p.some(r => r.some(x => x !== 1)));   // an all-ones count table rules nothing out
      html += more("All bans as a table", rankTable(topBans(12), [
        { th: "Typical", td: h => R.pe[h] < .001 ? "&lt;0.1%" : pct1(R.pe[h]) }, { th: "They open", td: h => opnCell("them", h) }, { th: "You open", td: h => opnCell("us", h) }],
        `Value: change in your team's win probability, in points, if you make this ban and follow the advice afterwards, against a typical ban. Band: the range, dot: the value, dashed line: a typical ban. Typical: how often a
        typical team in your seat makes this ban now (${E.SUPP > 0 || cntBinds ? `the advice only picks bans typical teams make at least ${+(100 * E.SUPP).toFixed(2)}% of the time${cntBinds ? " and that real teams at your rank have made at this point" : ""}` : "the advice weighs every legal ban, including ones typical teams rarely make"})${E.LAM ? ". The advice also leans toward bans real teams make often, so it is not always the ban with the highest value here" : ""}. They open, you open: how often each team opens the hero in the simulator's drafts of this lobby (the rest of the ban phase as typical teams make it).`));
      html += comps() + "</div>";
    } else if (THEM) {
      const T = THEM, F = forecastStrip(T, W);
      if (!LB) html += `<h2 class="hh"><span>Their ban #${e + 1}</span>${chartsBtn()}</h2><p class="head">Likeliest <span class="t">${esc(NAMES[F.top])}</span> <span class="n t">${pct(T.pe[F.top])}</span> ${worstTxt(F, T)}</p>`;
      html += `<div class="fig8" id="boardSlot"></div>${LB ? boardLegend(true) : ""}<div class="det">`;
      html += more("Why they would ban these", `<figure>${whySplit(T)}<figcaption>The ban model's reasons against an average hero (log-odds). "Your team plays it": teams go after the heroes the
        other team's players play, and the heroes your team shows say who your players are.</figcaption></figure>`);
      html += comps() + "</div>";
    }
    // a timing race can leave the old board in the page: take it out before the new html, so it moves rather than rebuilds
    if (BOARD.svg && BOARD.svg.parentNode) BOARD.svg.parentNode.removeChild(BOARD.svg);
    $("adviceBody").innerHTML = quiet(html); applyCharts();
    if ($("boardSlot")) $("boardSlot").appendChild(drawBoard(W));
    if ($("chartsBtn")) $("chartsBtn").onclick = () => { CHARTS = !CHARTS; applyCharts(); const h0 = adviceBan(); if (CHARTS && h0 !== null) flowStart(h0); };
    $("adviceBody").querySelectorAll("tr.pick").forEach(el => el.onclick = () => { st.active = { kind: "ban" }; place(+el.dataset.h); });
    $("adviceBody").querySelectorAll("[data-pair]").forEach(el => el.onclick = () => { if (ourTurn() && turnCount() === 2) { const [a, b] = el.dataset.pair.split(",").map(Number); banBoth(a, b); } });
    if (LB) { const d = $("adviceBody").querySelector(".det"); if (d) d.remove(); }   // the test layout has no charts (their drafts still run: comps() started them)
    if (LB) animWin();
    if (LB && !ADV_ANIM) { const A = $("advice"); ADVH = Math.max(ADVH, A.offsetHeight); A.style.minHeight = ADVH + "px"; }   // no jump of the lobby below when a turn is shorter
  }
  let REPLY = null;
  let ADV_MODE = null, ADV_ANIM = false, ADV_PENDING = false;                            // the test layout's board / result switch, and whether it is animating
  let ADVH = 0; if (LB) window.addEventListener("resize", () => { ADVH = 0; $("advice").style.minHeight = ""; });
  // the advised ban's swaps: the simulator drafts this lobby with and without it (the same stand-ins and random numbers) and follows
  // their players who would have opened it. Run only while the charts are shown
  let FL = null, flowW = null, flowId = 0;
  const adviceBan = () => { if (!ourTurn() || !RES || nextBan() >= 6) return null; const pair = turnCount() === 2 && PAIRS && PAIRS.length ? PAIRS[0] : null; return pair ? pair.a : RES.best; };
  function flowStart(h) {                                  // one long-lived worker: its model loads once; a newer job makes the older one stop
    const key = compKey() + "|" + h; if (FL && FL.key === key) return;
    FL = { key, h, id: ++flowId, done: false, failed: false };
    if (!flowW) {
      flowW = new Worker("sim8-worker.js?v=546a374ed8");
      const fill = () => { const el = $("sfSlot"); if (el && FL && adviceBan() === FL.h) el.innerHTML = sfHtml(FL.h, figW()); };
      flowW.onmessage = ev => { const d = ev.data; if (!FL || d.id !== FL.id) return;
        if (d.error) FL.failed = true; else if (d.done) Object.assign(FL, d.flow, { done: true }); else return; fill(); };
      flowW.onerror = () => { flowW.terminate(); flowW = null; if (FL) { FL.failed = true; fill(); } };   // a broken worker is replaced on the next request
    }
    flowW.postMessage({ id: FL.id, v: LAY.run, type: "flow", st: Object.assign(lobby(), { mates6: [1, 2, 3, 4, 5].map(shownOf) }), h, runs: Array.from({ length: 48 }, (_, j) => j) });
  }
  function sfHtml(h, W) {
    const F = FL && FL.key === compKey() + "|" + h ? FL : null, head = `<h2>What ${esc(nm(h))} does to them</h2>`;
    if (!F || (!F.done && !F.failed)) return head + `<p class="small">Drafting this lobby with and without ${esc(nm(h))}&hellip;</p>`;
    if (F.failed) return head + `<p class="small">The drafts could not be run in this browser.</p>`;
    if (F.nt < 20) return head + `<p class="small">They rarely open ${esc(nm(h))} in this lobby (${F.nt} of their simulated players in ${F.runs} ban phases).</p>`;
    const Pt = F.them.map(x => x / F.nt), role = ROLES[h], same = Pt.reduce((a, p, x) => a + (ROLES[x] === role ? p : 0), 0);
    const SF = subsFlow(h, W, { top: Pt.map((p, x) => [NAMES[x], p]).filter(t => t[1] > 0).sort((a, b) => b[1] - a[1]), same_role: same, n: F.nt });
    return SF ? head + `<p class="head"><span class="n u">${pct(SF.leave)}</span> of their players who would open ${esc(NAMES[h])} leave ${RN[SF.role]}</p><div class="fig8">${SF.svg}</div>
      <p class="small">From ${F.runs} simulated ban phases of this lobby, drafted with and without ${esc(nm(h))} on the same stand-ins and random numbers.</p>` : "";
  }
  window.addEventListener("resize", () => { clearTimeout(window.__rz); window.__rz = setTimeout(() => { if (RES || THEM || DONE) renderAdvice(); }, 150); });

  // ---------------------------------------------------------------- update loop
  let pending = 0;
  function update(recompute = true) {
    writeHash(); figUpdate();
    $("firstBtn").classList.toggle("on", st.first); $("secondBtn").classList.toggle("on", !st.first);
    $("tierSel").value = st.tier; $("mapSel").value = String(st.map);
    renderTeam(); renderTurnHint(); renderEnemy(); renderIdeal();
    if (!recompute && (RES || THEM || DONE)) { renderBans(); renderRoster(); return; }
    compStart();                                                                // the drafts start at once, in the workers (the board's move is not disturbed)
    idealStart();
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
        renderQuick(); };
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
  // "Inside one ending": one real draw of the simulator on the figure's six-ban path, from a worker
  let endW = null, endId = 0;
  function endingStart(d) {                               // one long-lived worker, as for the flow: only the latest request's answer is used
    if (!MethodFigs.ending) return;
    const id = ++endId;
    if (!endW) {
      endW = new Worker("sim8-worker.js?v=546a374ed8");
      endW.onmessage = ev => { const m = ev.data; if (m.id !== endId || !(m.done || m.error)) return; MethodFigs.ending(m.error ? { failed: true } : m.ending); };
      endW.onerror = () => { endW.terminate(); endW = null; MethodFigs.ending({ failed: true }); };
    }
    endW.postMessage({ id, v: LAY.run, type: "ending", st: lobby(), bans: d.path.slice().sort((a, b) => a.e - b.e).map(p => p.h), n: 9, draw: 0 });
  }
  // the figures are about a third of a second of computing, so they are brought up to date only while the section is open and near
  // the screen, and only once the lobby has been still for a moment (after the board has moved and the advice has filled in)
  // OLD_FIGS: the previous Methods figures (methods8.js), kept in the page but hidden since the Methods section became the game tree
  // (methods-tree.js). While false they are never built, so their numbers and their drafting worker cost nothing.
  const OLD_FIGS = false;
  let figKey = null, figTimer = 0, figNear = false;
  // the game tree (methods-tree.js) with the lobby's own numbers: the worker's tree job (about two seconds), for the lobby only (rank,
  // map, side, the heroes on show; not the bans), while the section is open and near the screen and the lobby has been still a moment
  let treeKey = null, treeTimer = 0, treeW = null, treeId = 0;
  const slugOf = h => PORT[NAMES[h]];
  function treeConvert(T) {                                // hero numbers to the figure's portrait names
    const names = {}, sl = h => { const k = slugOf(h); names[k] = NAMES[h]; return k; };
    const tree = {}; for (const id of ["A1", "B2", "A2", "B1"]) tree[id] = { us: id[0] === "A" ? 1 : 0, row: { A1: 1, B2: 2, A2: 3, B1: 4 }[id],
      kids: T.tree[id].kids.map((k, i) => Object.assign({}, k, k.b ? { b: k.b.map(sl) } : {}, i === 0 && id !== "B1" ? { to: { A1: "B2", B2: "A2", A2: "B1" }[id] } : {})) };
    const line = a => a.map(x => ({ p: x.p.map(sl), f: x.f }));                // the endings' lineups, as portraits
    return Object.assign({}, T, { names, tree, types: T.types.map(t => ({ prior: t.prior, mains: t.mains.map(sl) })),
      grids: (T.grids || []).map(g => g.map(x => ({ pairs: x.pairs, us: line(x.us), them: line(x.them) }))) });
  }
  function treeUpdate() {
    if (!window.GameTree || !GameTree.load) return;
    const key = JSON.stringify([st.tier, st.map, st.first, [0, 1, 2, 3, 4, 5].map(shownOf)]); if (key === treeKey) return;
    clearTimeout(treeTimer); if (!figNear || !METHODS) return;
    treeTimer = setTimeout(() => { if (!figNear || !METHODS) return; treeKey = key; const id = ++treeId;
      if (!treeW) {
        treeW = new Worker("sim8-worker.js?v=546a374ed8");
        treeW.onmessage = ev => { const m = ev.data; if (m.id !== treeId || !(m.done || m.error)) return;
          if (m.tree) { try { GameTree.load(treeConvert(m.tree)); } catch (e) { console.error(e); } } else if (m.error) { console.error(m.error); treeKey = null; } };
        treeW.onerror = () => { treeW.terminate(); treeW = null; treeKey = null; };
      }
      treeW.postMessage({ id, v: LAY.run, type: "tree", st: Object.assign(lobby(), { mates6: [1, 2, 3, 4, 5].map(shownOf) }) }); }, treeKey ? 900 : 0);
  }
  function figUpdate() {
    treeUpdate();
    if (!OLD_FIGS || !window.MethodFigs || !MethodFigs.show) return;
    const key = JSON.stringify([st.tier, st.map, st.first, st.team, st.bans]); if (key === figKey) return;
    clearTimeout(figTimer); if (!figNear || !METHODS) return;
    figTimer = setTimeout(() => { if (!figNear || !METHODS) return; try { const d = figData(); if (d) { figKey = key; MethodFigs.show(d); endingStart(d); } } catch (e) { console.error(e); } }, figKey ? 1200 : 0);
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
      players do by about ${simGain.toFixed(1)} points of win chance. ${R.ope_note ? esc(R.ope_note) : allZero ? "In real games that edge is too small to confirm yet: with the matches we have, every interval includes zero." : "In real games the intervals are still wide."}</p>
      <h2>Limits</h2>
      <ul class="small">
        <li>Fitted on PC ranked Season 10 matches from ${fitDates}, mostly Diamond to Celestial. Few lobbies average above 5,000.</li>
        <li>The values average over real players at your rank, not the people in your lobby. Hovers are not in the data, so a shown hero counts as a likely pick.</li>
        <li>The model drafts opening lineups. Mid-match swaps are left out.</li>
        <li>${+sHi < .8 ? `Simulated win chances spread lobbies further apart than real games do (a calibration slope of ${sLo} to ${sHi}), so read them as a ranking more than as exact percentages.`
          : `Against real games the win chances are about the right size (calibration slopes of ${sLo} to ${sHi}, where 1 is exact), but a single game is still close to a coin flip.`}</li>
        ${THIN.length ? `<li>Left off the map menu because the data has almost no ranked matches there: ${THIN.map(m => `${esc(m.name)} (${fmt(m.n)})`).join(", ")}.</li>` : ""}
      </ul></div></div>`;
  }
  const SPL = REP.splits, day = t => new Date(t.replace(" ", "T") + "Z").toLocaleDateString("en-GB", { day: "numeric", timeZone: "UTC" });
  const fitN = SPL.train.n + SPL.validation.n;
  const fitDates = `${day(SPL.train.first_utc)} to ${day(SPL.validation.last_utc)} ${new Date(SPL.validation.last_utc.replace(" ", "T") + "Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}`;
  status(""); $("fitted").textContent = `Fitted on ${fmt(fitN)} PC ranked matches from Season 10 (${fitDates}), model ${REP.version} (run ${REP.run}).`;
  renderMethod(); update();
  compWorkers();                                                               // the drafting workers load the model while the page settles
  if (OLD_FIGS && window.MethodFigs) MethodFigs.init({ vq: VQ, pool: (REP.world_model || {}).stand_in_pool }).then(figUpdate).catch(e => console.error(e));
  document.fonts && document.fonts.ready.then(() => { renderMethod(); if (RES || THEM || DONE) renderAdvice(); });
  if (auxP) auxP.then(b => { E.addBuffer("aux", b); update(); }).catch(() => {});
})().catch(e => {                                          // a bad or partial release: no advice rather than a made-up one
  console.error(e); const st_ = document.getElementById("status"), ab = document.getElementById("adviceBody");
  if (st_) st_.textContent = "The model failed to load, so no advice is shown. Reload the page to try again.";
  if (ab) ab.innerHTML = `<p class="small">The model failed to load (${String(e && e.message || e).replace(/[<>&"]/g, "")}). No advice is shown.</p>`;
});
