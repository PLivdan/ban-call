/* Ban Call Studio v8: a second interface on the site's v8 models.
   Value mode: the v8 value networks (../engine8.js), trained by backward induction over the six bans on simulated lobbies,
   give every ban's value against a typical ban in a fraction of a second, with the networks' range.
   Simulator mode: the notebook's world model (../sim8.js in workers) plays the ban phase out with stand-in players near your
   rank, re-drafts both teams and scores the drafts, for the networks' leading bans. Your later bans are played the way a
   typical team bans, so its numbers are compared with the networks' own typical-play values.
   The chapters under the board use both: who opens a hero and where its players go come from simulated drafts of this lobby. */
(async function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const ROLE_NAMES = ["Vanguard", "Duelist", "Strategist"];
  const SHORT = { "Deadpool (Vanguard)": "Deadpool V", "Deadpool (Duelist)": "Deadpool D", "Deadpool (Strategist)": "Deadpool S",
    "Gorr The God Butcher": "Gorr", "Jeff The Land Shark": "Jeff", "Mister Fantastic": "Mr. Fantastic", "Captain America": "Cap",
    "Rocket Raccoon": "Rocket", "Elsa Bloodstone": "Elsa", "Doctor Strange": "Dr. Strange", "Devil Dinosaur": "Devil Dino", "Cloak & Dagger": "Cloak & Dagger" };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pp = (x, d = 2) => (x >= 0 ? "+" : "−") + Math.abs(100 * x).toFixed(d);
  const pct = x => (100 * x < 1 && x > 0 ? "<1" : (100 * x).toFixed(0)) + "%";
  const pct1 = x => (100 * x).toFixed(1) + "%";
  const fmt = n => Math.round(n).toLocaleString("en-US");
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dec = step => Math.max(0, -Math.floor(Math.log10(step * 100) + 1e-9));
  const niceStep = (span, n = 4) => { const raw = span / n || 1e-9, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; };
  const argsort = (a, keys) => keys.slice().sort((x, y) => a[y] - a[x]);

  // ---------------------------------------------------------------- load: the tables, then the networks with a progress line
  const say = t => { const c = $("call"); if (c) c.innerHTML = `<p class="q">${t}</p>`; };
  // a binary of the release: exactly the manifest's size and (when the manifest has it) its SHA-256, or the load fails
  async function fetchBin(url, bytes, label, sha) {
    const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    let buf;
    if (!r.body || !r.body.getReader) buf = await r.arrayBuffer();
    else {
      const rd = r.body.getReader(), parts = []; let got = 0;
      for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; say(`${label} ${Math.round(100 * got / bytes)}%`); }
      const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } buf = out.buffer;
    }
    if (bytes !== undefined && buf.byteLength !== bytes) throw new Error(`${url}: ${buf.byteLength} bytes, the release says ${bytes}`);
    if (sha && self.crypto && crypto.subtle) {
      const d = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf))).map(b => b.toString(16).padStart(2, "0")).join("");
      if (d !== sha) throw new Error(`${url}: its checksum does not match the release`);
    }
    return buf;
  }
  const LAY = await fetch("../model8/value_v8.json", { cache: "no-cache" }).then(r => r.json()), VQ = `?v=${LAY.run}`;
  const [BAN, SUBS, REP, META, PORT] = await Promise.all(["../model8/ban_v8.json" + VQ, "../model8/substitutes_v8.json" + VQ, "../model8/report_v8.json" + VQ,
    "../model/meta.json", "../model/portraits.json"].map(u => fetch(u).then(r => r.json())));
  if ((BAN.run && BAN.run !== LAY.run) || (REP.run && REP.run !== LAY.run)) throw new Error(`the model files come from different runs (${LAY.run}, ${BAN.run}, ${REP.run})`);
  const E = new Engine8(LAY, BAN), H = E.H, ORDER = LAY.order, NAMES = LAY.heroes, ROLE = LAY.roles;
  E.addBuffer("opt", await fetchBin(`../model8/${LAY.files.opt.path}${VQ}`, LAY.files.opt.bytes, `Loading the value networks (${(LAY.files.opt.bytes / 1e6).toFixed(0)} MB)`, LAY.files.opt.sha256));
  const img = h => `../img/heroes/${PORT[NAMES[h]]}.webp`, short = h => SHORT[NAMES[h]] || NAMES[h];
  const mapName = s => s.includes(" · ") ? s.replace(" · ", " (") + ")" : s;
  const MAPN = REP.map_matches || null;                                        // maps the model has barely seen (fewer than 1,000 matches) are left out
  const MAPS = LAY.maps.map((m, i) => ({ i, name: mapName(m.label) })).filter(m => !MAPN || (MAPN[LAY.maps[m.i].label] ?? 0) >= 1000).sort((a, b) => a.name.localeCompare(b.name));
  const TIERS = Object.keys(META.tiers);
  const SUB = new Map(SUBS.table.map(r => [r.hero, r]));

  // ---------------------------------------------------------------- state, mirrored in the URL hash (the main page's keys, plus the model and runs)
  const kly = MAPS.find(m => /Klyntar \(Dom/.test(m.name));
  const LS = LobbyState, st = Object.assign({ tier: "Grandmaster 3", map: kly ? kly.i : MAPS[0].i, first: true, active: { kind: "team", i: 0 }, model: "value", runs: 64 }, LS.fresh());
  let MINE = []; try { MINE = JSON.parse(localStorage.getItem("bancall-mine") || "[]").filter(h => Number.isInteger(h) && h < H); } catch (e) {}
  const rememberMine = h => { MINE = [h].concat(MINE.filter(x => x !== h)).slice(0, 8); try { localStorage.setItem("bancall-mine", JSON.stringify(MINE)); } catch (e) {} };
  let lastHash = "";
  function readHash() {                                  // lobby-state.js: the main page's checks and schema, banned hovers kept (g)
    const d = LS.decode(location.hash, { H, tiers: META.tiers, maps: new Set(MAPS.map(m => m.i)), tier: st.tier, map: st.map }); if (!d) return;
    const q = new URLSearchParams(location.hash.slice(1)); Object.assign(st, d);
    st.model = q.get("x") === "1" ? "sim" : "value"; st.runs = [32, 64, 128, 256].includes(+q.get("n")) ? +q.get("n") : 64;
    st.active = LS.shownOf(st, 0) < 0 ? { kind: "team", i: 0 } : { kind: "ban" };
  }
  function writeHash() { lastHash = LS.encode(st, { x: st.model === "sim" ? 1 : 0, n: st.runs }); history.replaceState(null, "", lastHash); }
  readHash();
  if (!location.hash && MINE.length) { st.team[0] = MINE[0]; st.active = { kind: "ban" }; }
  window.addEventListener("hashchange", () => { if (location.hash === lastHash) return; Object.assign(st, LS.fresh()); readHash(); syncControls(); update(); });
  const ours = i => (ORDER[i] === 0) === st.first;
  const nextBan = () => st.bans.length;
  const ourTurn = () => nextBan() < 6 && ours(nextBan());
  const turnCount = () => { const e = nextBan(); return (e + 1 < 6 && ours(e) && ours(e + 1)) ? 2 : 1; };
  const bannedSet = () => new Set(st.bans), teamSet = () => new Set(st.team.filter(h => h >= 0));
  const lobby = (bans = st.bans) => Object.assign(LS.lobby(st, META.tiers[st.tier]), { bans: bans.slice() });   // a banned hover still counts as shown
  const simLobby = () => lobby();
  const lobbyKey = () => JSON.stringify([st.tier, st.map, st.first, [0, 1, 2, 3, 4, 5].map(i => LS.shownOf(st, i)), st.bans]);

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
  $("valueBtn").onclick = () => { st.model = "value"; update(false); };
  $("simBtn").onclick = () => { st.model = "sim"; update(false); };
  document.querySelectorAll("#runsCtl button").forEach(b => b.onclick = () => { st.runs = +b.dataset.n; SIM = null; update(false); });
  $("undoBtn").onclick = () => { if (LS.unban(st) >= 0) { st.active = { kind: "ban" }; update(); } };
  $("newBtn").onclick = () => { st.bans = []; st.gone = []; for (let i = 1; i < 6; i++) st.team[i] = -1; st.active = st.team[0] < 0 ? { kind: "team", i: 0 } : { kind: "ban" }; $("search").value = ""; update(); };
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
      LS.hover(st, a.i, h); if (a.i === 0) rememberMine(h);
      const nxt = a.i === 0 ? -1 : st.team.findIndex((x, i) => x < 0 && i > a.i);
      st.active = nxt >= 0 ? { kind: "team", i: nxt } : { kind: "ban" };
    } else {
      if (nextBan() >= 6 || !LS.ban(st, h)) return;         // a banned hover stays shown for the model (as on the main page)
    }
    $("search").value = ""; renderHits(); update();
  }
  function banAll(hs) { for (const h of hs) LS.ban(st, h); st.active = { kind: "ban" }; update(); }
  // how much each hero is played at this rank: the page's stand-in teams (the ban model's view of a lobby at the rank band)
  const POPC = new Map();
  function popularity() {
    const bd = E.band(META.tiers[st.tier]); if (POPC.has(bd)) return POPC.get(bd);
    const T = BAN.stand_in_team_shares[bd], p = new Float64Array(H); for (const t of T) for (let h = 0; h < H; h++) p[h] += t[h] / (6 * T.length);
    POPC.set(bd, p); return p;
  }
  const openUs = () => OPN && OPN.key === lobbyKey() ? OPN.us : null, openThem = () => OPN && OPN.key === lobbyKey() ? OPN.them : null;
  const openA = () => OPN && OPN.key === lobbyKey() ? OPN : null;          // rates when the hero is available, and how often it is banned anyway
  const whenOpen = (x, h) => isNaN(x.themA[h]) ? "" : `When nobody bans ${esc(short(h))}, they open it in <b>${Math.round(100 * x.themA[h])} of 100</b> drafts`;
  function quickList() {
    if (st.active.kind === "team") {
      const bans = bannedSet(), team = teamSet(), ok = h => !bans.has(h) && !team.has(h), pop = popularity();
      if (st.active.i === 0) { const seen = new Set(), out = [];
        for (const h of MINE.concat(argsort(pop, [...pop.keys()]))) if (ok(h) && !seen.has(h) && out.length < 8) { seen.add(h); out.push({ h, v: pop[h], lab: MINE.includes(h) ? "yours" : pct(pop[h]) }); }
        return out; }
      const P = openUs() || pop; return argsort(P, [...P.keys()].filter(ok)).slice(0, 8).map(h => ({ h, v: P[h], lab: pct(P[h]) }));
    }
    if (nextBan() >= 6) return [];
    if (ourTurn()) { const V = valueNow(); if (!V) return []; return topBans(8).map(h => ({ h, v: V[h], lab: pp(V[h]) })); }
    return T8 ? argsort(T8.pe, T8.cands).slice(0, 8).map(h => ({ h, v: T8.pe[h], lab: pct(T8.pe[h]) })) : [];
  }
  const side = () => st.active.kind === "team" || ourTurn() ? "us" : "them";
  const quickPick = k => { const q = quickList()[k - 1]; if (q) place(q.h); };
  const matches = () => { const q = $("search").value.split(",").pop().trim().toLowerCase(); if (!q) return [];
    const b = bannedSet(); return NAMES.map((n, h) => h).filter(h => !b.has(h) && (NAMES[h].toLowerCase().includes(q) || short(h).toLowerCase().includes(q)))
      .sort((a, c) => ((NAMES[a].toLowerCase().startsWith(q) ? 0 : 1) - (NAMES[c].toLowerCase().startsWith(q) ? 0 : 1)) || NAMES[a].length - NAMES[c].length); };
  let QUERY = "";
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
      if (parts.length > 1) { for (const q of parts) { $("search").value = q; const m = matches(); if (m.length) place(m[0]); } }
      else { const m = matches(); if (m.length) place(m[0]); }
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

  // ================================================================ the model's answers for this lobby
  let R8 = null, P8 = null, T8 = null, WIN = null, OPN = null, SIM = null, SIMP = null, BEH = null;
  // the value shown for each ban: the networks', or the simulator's for the bans it has played out
  const simReady = () => st.model === "sim" && SIM && SIM.done && SIM.key === lobbyKey();
  const simSingles = () => simReady() && SIM.cands.length > 0;       // on a two-ban turn the simulator scores pairs; single bans keep the networks' values
  const valueNow = () => simSingles() ? SIM.V : R8 ? R8.V : null;
  const seNow = h => simReady() ? SIM.se[h] : NaN;
  function topBans(k) {
    const V = valueNow(); if (!V) return [];
    if (simSingles()) return SIM.cands.filter(h => !isNaN(V[h])).sort((a, b) => V[b] - V[a]).slice(0, k);
    const lcb = h => R8.mu[h] - E.KAPPA * R8.sd[h], pool = R8.cands.filter(h => R8.supported.has(h));
    return (pool.length ? pool : R8.cands).slice().sort((a, b) => lcb(b) - lcb(a)).slice(0, k);
  }
  const rangeOf = h => simSingles() ? { lo: SIM.V[h] - 1.96 * SIM.se[h], hi: SIM.V[h] + 1.96 * SIM.se[h] } : R8.spread(h);
  // is a ban clearly better than the runner-up? networks: their ranges do not overlap; simulator: the paired difference over
  // the same runs (clustered by stand-in draw)
  function clearOf(a, b) {
    if (simSingles()) { const d = pairedDiff(SIM, a, b); return d ? { clear: d.d - 1.96 * d.se > 0, d } : null; }
    return { clear: R8.clear(a, b), d: null };
  }
  function suggested() {       // our ban(s) this turn: the best single ban; on a two-ban turn the networks' advice (best ban, then the best after it), or the simulator's best pair
    if (turnCount() === 2) { const P = simReady() ? SIMP : P8; if (P && P.length) { const p = P[0], ab = p.seq || R8.V[p.a] >= R8.V[p.b] ? [p.a, p.b] : [p.b, p.a]; return { hs: ab, V: p.V, pair: p }; } }
    const h = topBans(1)[0]; return h === undefined ? null : { hs: [h], V: valueNow()[h] };
  }

  // ================================================================ the board: every hero in a fixed place, the model's answer as a bar
  const board = $("board"), TILES = [], BCOLS = [3, 5, 3];
  function mkTile(h) {
    const el = document.createElement("button"); el.className = "tile"; el.dataset.h = h; el.setAttribute("aria-label", NAMES[h]);
    el.innerHTML = `<span class="pic"><img src="${img(h)}" alt="" loading="lazy"><span class="k"></span></span><span class="nm">${esc(short(h))}</span><span class="bar"><i></i></span><span class="v"></span>`;
    el.onclick = () => { hideTip(); if (!st.bans.includes(h)) place(h); };
    el.onmouseenter = ev => showTip(h, ev); el.onmousemove = moveTip; el.onmouseleave = hideTip;
    return { el, k: el.querySelector(".k"), bar: el.querySelector(".bar i"), v: el.querySelector(".v") };
  }
  let boardBand = -1;
  function buildBoard() {
    const pop = popularity();
    board.innerHTML = [0, 1, 2].map(r => `<div class="role"><h4>${ROLE_NAMES[r]}</h4><div class="tiles" style="grid-template-columns:repeat(${BCOLS[r]}, minmax(0, 1fr))"></div></div>`).join("");
    const boxes = board.querySelectorAll(".tiles");
    for (let r = 0; r < 3; r++) NAMES.map((n, h) => h).filter(h => ROLE[h] === r).sort((a, b) => pop[b] - pop[a]).forEach(h => boxes[r].appendChild((TILES[h] || (TILES[h] = mkTile(h))).el));
  }
  function metric() {
    const bans = bannedSet(), team = teamSet(), e = nextBan();
    if (st.active.kind === "team") {
      const Pm = st.active.i === 0 || !openUs() ? popularity() : openUs();
      return { v: h => Pm[h], f: pct, q: "Pick the hero", m: st.active.i === 0 || !openUs() ? "Bars: how much players at this rank play each hero." : "Bars: the chance your team opens each hero, from simulated drafts of this lobby.",
               ok: h => !bans.has(h) && !team.has(h) };
    }
    if (e >= 6) { const P = openThem(); return { v: h => P ? P[h] : 0, f: pct, q: "What they will likely play", m: "Bars: the chance the other team opens each hero, from simulated drafts.", ok: h => !bans.has(h) && !!P }; }
    if (ourTurn()) {
      const V = valueNow(); if (!V) return { v: () => 0, f: pp, q: "Working", m: "", ok: () => false };
      return { v: h => V[h], f: pp, q: "Click a hero to ban it",
               m: simReady() ? `Bars: the simulator's value of each ban it played out, in points of win chance against the ban a typical team makes (your later bans played as a typical team would).`
                            : "Bars: the value networks' worth of each ban, in points of win chance against the ban a typical team makes, if you follow the advice afterwards.",
               ok: h => !bans.has(h) && !team.has(h) && !isNaN(V[h]) };
    }
    return { v: h => T8 ? T8.pe[h] : 0, f: pct, q: "Click the hero they banned", m: "Bars: the chance they ban each hero next, from the ban model fitted on every Season 10 ban.", ok: h => !bans.has(h) };
  }
  function paintBoard() {
    const M = metric(), bans = bannedSet(), team = teamSet(), sd = side(), q = quickList(), rank = new Map(q.map((x, k) => [x.h, k + 1])), best = q.length ? q[0].h : -1;
    let mx = 1e-9; for (let h = 0; h < H; h++) if (M.ok(h)) mx = Math.max(mx, M.v(h));
    for (let h = 0; h < H; h++) {
      const t = TILES[h]; if (!t) continue; const ok = M.ok(h), cls = ["tile", sd];
      if (bans.has(h)) cls.push("gone"); else if (team.has(h)) cls.push("mine");
      if (rank.has(h)) cls.push("top"); if (h === best) cls.push("best");
      if (QUERY && !NAMES[h].toLowerCase().includes(QUERY) && !short(h).toLowerCase().includes(QUERY)) cls.push("dim");
      if (ourTurn() && R8 && ok && !simReady() && !R8.supported.has(h)) cls.push("rare");
      t.el.className = cls.join(" ");
      t.bar.style.width = ok ? (100 * Math.max(0, M.v(h)) / mx).toFixed(1) + "%" : "0%";
      t.v.textContent = ok ? M.f(M.v(h)) : bans.has(h) ? "banned" : team.has(h) ? "your team" : "";
      t.k.textContent = rank.get(h) || "";
    }
    $("boardQ").textContent = M.q; $("boardM").textContent = M.m;
  }
  const tip = $("tip");
  function showTip(h, ev) {
    const rows = [];
    if (st.bans.includes(h)) rows.push(`Banned in box ${st.bans.indexOf(h) + 1}`);
    else {
      if (ourTurn() && st.active.kind === "ban" && R8 && !isNaN(R8.V[h])) { const r = R8.spread(h);
        rows.push(`Value networks <em>${pp(R8.V[h])}</em> (range ${pp(r.lo)} to ${pp(r.hi)})`);
        if (simReady() && !isNaN(SIM.V[h])) rows.push(`Simulator <em>${pp(SIM.V[h])}</em> ± ${(196 * SIM.se[h]).toFixed(2)} pts`);
        if (!R8.supported.has(h)) rows.push(`A ban teams almost never make here, so it is not advised`); }
      if (T8 && !ourTurn() && nextBan() < 6) rows.push(`They ban it next <em>${pct(T8.pe[h])}</em>`);
      if (openA()) { const x = openA(); rows.push(`When it is open, they open it <em>${pct(x.themA[h])}</em>, your team <em>${teamSet().has(h) ? "shown" : pct(x.usA[h])}</em>`); if (nextBan() < 6) rows.push(`Banned anyway in <em>${pct(x.ban[h])}</em> of ban phases`); }
    }
    tip.innerHTML = `<img src="${img(h)}" alt=""><div><b>${esc(NAMES[h])}</b><div class="r">${ROLE_NAMES[ROLE[h]]}<br>${rows.join("<br>")}</div></div>`;
    tip.classList.add("on"); moveTip(ev);
  }
  function moveTip(ev) { const w = tip.offsetWidth, hh = tip.offsetHeight; let x = ev.clientX + 16, y = ev.clientY + 14;
    if (x + w > innerWidth - 8) x = ev.clientX - w - 16; if (y + hh > innerHeight - 110) y = ev.clientY - hh - 14; tip.style.left = x + "px"; tip.style.top = y + "px"; }
  const hideTip = () => tip.classList.remove("on");

  // ================================================================ the call panel
  function ciSvg(x, rx, runner, rr) {                       // the value, its range, zero, and the runner-up's
    const lo = Math.min(0, rx.lo, runner !== undefined ? rr.lo : 0), hi = Math.max(rx.hi, runner !== undefined ? rr.hi : 0, 1e-4);
    const Wd = 330, X = v => 10 + (v - lo) / (hi - lo) * (Wd - 20), step = niceStep(hi - lo, 4); let t = "";
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) t += `<text x="${X(v)}" y="42" text-anchor="middle">${pp(v, dec(step))}</text>`;
    const r = runner !== undefined ? `<line class="w" x1="${X(rr.lo)}" x2="${X(rr.hi)}" y1="26" y2="26" style="stroke:var(--graphite)"/><circle cx="${X(runner)}" cy="26" r="3.5" style="fill:var(--graphite)"/>` : "";
    return `<svg class="ci" viewBox="0 0 ${Wd} 46" width="100%" style="max-width:${Wd}px"><line class="ax" x1="10" x2="${Wd - 10}" y1="31" y2="31"/><line class="z" x1="${X(0)}" x2="${X(0)}" y1="4" y2="34"/>
      <rect class="band" x="${X(rx.lo)}" y="7" width="${Math.max(1, X(rx.hi) - X(rx.lo))}" height="12"/><line class="w" x1="${X(rx.lo)}" x2="${X(rx.hi)}" y1="13" y2="13"/><circle cx="${X(x)}" cy="13" r="5"/>${r}${t}</svg>`;
  }
  const rung = (it, k, sd, max, fmtv, pics) => `<div class="rung ${sd}" data-h="${it.h}"${it.b !== undefined ? ` data-b="${it.b}"` : ""}><span class="k">${k}</span>${pics || `<img src="${img(it.h)}" alt="">`}
    <div><div class="rn">${it.name || esc(NAMES[it.h])}</div><div class="bar"><i style="width:${Math.max(1.5, 100 * Math.max(0, it.v) / (max || 1)).toFixed(1)}%"></i></div></div><span class="v">${fmtv(it.v)}</span></div>`;
  const pairPics = (a, b) => `<span style="display:flex"><img src="${img(a)}" alt="" style="width:22px;height:30px;object-fit:cover"><img src="${img(b)}" alt="" style="width:22px;height:30px;object-fit:cover"></span>`;
  function wireRungs(root) {
    root.querySelectorAll(".rung").forEach(r => r.onclick = () => r.dataset.b !== undefined ? banAll([+r.dataset.h, +r.dataset.b]) : place(+r.dataset.h));
    root.querySelectorAll("[data-place]").forEach(b => b.onclick = () => place(+b.dataset.place));
    root.querySelectorAll(".rung").forEach(r => { const t = TILES[+r.dataset.h]; if (!t) return; r.onmouseenter = () => t.el.classList.add("hover"); r.onmouseleave = () => t.el.classList.remove("hover"); });
  }
  const verdictHtml = (hs, sd, act, value, extra) => `<div class="verdict ${sd}"><div class="pics">${hs.map(h => `<img src="${img(h)}" alt="">`).join("")}</div><div>
      <div class="act">${act}</div><div class="nm">${hs.map(h => esc(NAMES[h])).join(" and ")}</div>${value}${extra || ""}</div></div>`;
  function winLine() {
    if (!WIN) return "";
    return nextBan() >= 6 ? `<p class="winl">Win chance after these bans: <b>${pct1(WIN.opt)}</b></p>`
      : `<p class="winl">The model's win chance <b>${pct1(WIN.opt)}</b> with its best later bans${WIN.beh !== null ? ` · ${pct1(WIN.beh)} if both teams ban as usual` : ""}</p>`;
  }
  const WHYK = [["base", "it is popular on this map, rank and position"], ["react", "of the bans so far"], ["prot", "they do not play it themselves"], ["fear", "it beats what they play"], ["targ", "your team plays it"]];
  function whyRows(T, k = 5) {                                  // the ban model's utility for their next ban, split into its parts, against an average legal hero
    const W = T.why, parts = h => WHYK.map(([key]) => key === "base" ? W.base[h] : key === "react" ? W.react[h] : W[key][h]);
    const all = T.cands.map(parts), mean = WHYK.map((_, j) => all.reduce((a, p) => a + p[j], 0) / all.length);
    return argsort(T.pe, T.cands).slice(0, k).map(h => ({ h, c: parts(h).map((v, j) => v - mean[j]) }));
  }
  function renderCall() {
    const e = nextBan(); let html = "";
    if (st.active.kind === "team") {
      const i = st.active.i, q = quickList().slice(0, 6), mx = Math.max(...q.map(x => x.v), 1e-9);
      html += `<p class="eyebrowless">Before the bans, step ${i + 1} of 6</p><p class="q">${i === 0 ? "Which hero are you playing?" : `Who is teammate ${i + 1} playing?`}</p>
        <p class="reason">Click the hero on the board, type the name, or press its number. ${i === 0 ? "Your hero is remembered for next time." : "Skip teammates you do not know. Each one you add changes which stand-in players the model expects on your team."}</p>
        <div class="ladder">${q.map((x, k) => rung({ h: x.h, v: x.v }, k + 1, "us", mx, () => x.lab)).join("")}</div>
        <div class="go">${i > 0 ? `<button class="btn2" id="toBans">Skip to the bans</button>` : ""}</div>`;
    } else if (e >= 6) {
      const P = openThem();
      if (!P) html += `<p class="eyebrowless">All six bans are in</p>${winLine()}<div class="wait"><i></i>drafting both teams</div>`;
      else { const top = argsort(P, [...P.keys()].filter(h => !st.bans.includes(h))).slice(0, 6), mx = P[top[0]];
        html += `<p class="eyebrowless">All six bans are in</p>${verdictHtml([top[0]], "them", "They will most likely play", `<div class="big">${pct(P[top[0]])}<small>of simulated drafts</small></div>`)}${winLine()}
          <div><h3>Their other likely heroes</h3><div class="ladder">${top.slice(1).map((h, k) => rung({ h, v: P[h] }, k + 2, "them", mx, pct)).join("")}</div></div>`; }
      html += `<div class="go"><button class="btn" id="again">Start the next lobby</button></div>`;
    } else if (ourTurn()) html += ourCall();
    else {
      const top = argsort(T8.pe, T8.cands).slice(0, 6), mx = T8.pe[top[0]], w = whyRows(T8, 1)[0], main = w ? w.c.indexOf(Math.max(...w.c)) : 0;
      const hurt = h => T8.mu[h] - T8.base;                    // what their ban does to you, against their typical ban
      html += `<p class="eyebrowless">Their ban ${e + 1} of 6</p>`;
      html += verdictHtml([top[0]], "them", "They will most likely ban", `<div class="big">${pct(T8.pe[top[0]])}<small>chance</small></div>`);
      html += `<p class="reason">Mostly because ${WHYK[main][1]}. If they ban it, your win chance moves ${pp(hurt(top[0]))} points against their typical ban. When they lock it in, enter what they actually banned.</p>`;
      html += `<div class="go"><button class="btn them" data-place="${top[0]}"><img src="${img(top[0])}" alt="">They banned ${esc(short(top[0]))}<span class="kb">1</span></button><span class="note" style="margin:0">or click it on the board</span></div>`;
      html += winLine() + `<div><h3>Other likely bans</h3><div class="ladder">${top.slice(1).map((h, k) => rung({ h, v: T8.pe[h] }, k + 2, "them", mx, pct)).join("")}</div></div>`;
    }
    $("call").innerHTML = html; wireRungs($("call"));
    if ($("toBans")) $("toBans").onclick = () => { st.active = { kind: "ban" }; update(false); };
    if ($("again")) $("again").onclick = () => $("newBtn").click();
    if ($("doBan")) $("doBan").onclick = () => banAll($("doBan").dataset.hs.split(",").map(Number));
    renderWhy();
  }
  function ourCall() {
    const e = nextBan(), cnt = turnCount(), sim = st.model === "sim";
    let html = `<p class="eyebrowless">${cnt === 2 ? `Your bans ${e + 1} and ${e + 2} of 6, ${sim ? "chosen together" : "the best ban, then the best ban after it"}` : `Your ban ${e + 1} of 6`}${sim ? `. Simulator, ${st.runs} runs for each leading ban` : ""}</p>`;
    if (sim && !simReady()) {
      if (SIM && SIM.failed) return html + `<p class="note">The simulator stopped with an error in this browser. Reload the page, or switch to the value networks.</p>`;
      return html + `<div><p class="q">Playing the ban phase out</p><div class="prog"><i id="simBar"></i></div><p class="note" id="simCount"></p>
        <p class="reason" style="margin-top:12px">The value networks' leading bans are each played out ${st.runs} times with stand-in players near your rank. Their advice while you wait: <b>${esc(short(R8.best))}</b> (${pp(R8.V[R8.best])}).</p></div>`;
    }
    const sug = suggested(); if (!sug) return html + `<p class="note">No ban to suggest.</p>`;
    const V = valueNow(), pairs = sug.pair, top = topBans(6);
    let runner, rr, rname = "", cj = null;
    if (pairs) { const P = sim ? SIMP : P8; if (P && P[1]) { runner = P[1].V; rr = P[1].range || P[1].spread; rname = `${short(P[1].a)} and ${short(P[1].b)}`;
      cj = sim ? (d => d ? { clear: d.d - 1.96 * d.se > 0, d } : null)(pairedDiff(SIMP.src, String([P[0].a, P[0].b]), String([P[1].a, P[1].b]))) : { clear: P[0].mu - P[1].mu > P[0].sd + P[1].sd, d: null }; } }
    else { const r = top.find(h => h !== sug.hs[0]); if (r !== undefined) { runner = V[r]; rr = rangeOf(r); rname = short(r); cj = clearOf(sug.hs[0], r); } }
    const rx = pairs ? (pairs.range || pairs.spread) : rangeOf(sug.hs[0]), clear = cj && cj.clear, dtx = cj && cj.d ? `, difference ${pp(cj.d.d)} ± ${(196 * cj.d.se).toFixed(2)}` : "";
    const against = !pairs ? "against a typical ban" : sim ? "against the two bans a typical team makes" : "against a typical first ban followed by the best second ban";
    html += verdictHtml(sug.hs, "us", "Ban", `<div class="big">${pp(sug.V)}<small>points of win chance ${against}</small></div>`,
      `${ciSvg(sug.V, rx, runner, rr)}<div class="judge">${runner !== undefined ? (clear ? `Clearly better than ${esc(rname)} (${pp(runner)}${dtx}).` : `About as good as ${esc(rname)} (${pp(runner)}${dtx}). Either is a sound ban.`) : ""}</div>`);
    html += `<p class="reason">${reasonFor(sug.hs[0], pairs)}</p>`;
    html += `<div class="go"><button class="btn us" id="doBan" data-hs="${sug.hs.join(",")}"><img src="${img(sug.hs[0])}" alt="">${pairs ? "Ban both" : `Ban ${esc(short(sug.hs[0]))}`}<span class="kb">${pairs ? "Enter" : "1"}</span></button></div>` + winLine();
    if (pairs) { const P = (sim ? SIMP : P8).slice(1, 6), mx = Math.max(...(sim ? SIMP : P8).slice(0, 6).map(p => p.V), 1e-9);
      html += `<div><h3>Other pairs</h3><div class="ladder">${P.map((p, k) => rung({ h: p.a, b: p.b, v: p.V, name: `${esc(short(p.a))} + ${esc(short(p.b))}` }, k + 2, "us", mx, pp, pairPics(p.a, p.b))).join("")}</div></div>`; }
    else { const mx = Math.max(...top.map(h => V[h]), 1e-9); html += `<div><h3>Other good bans</h3><div class="ladder">${top.filter(h => h !== sug.hs[0]).slice(0, 5).map((h, k) => rung({ h, v: V[h] }, k + 2, "us", mx, pp)).join("")}</div></div>`; }
    if (sim) html += `<div class="cloud"><h3>Every simulated ban phase<span class="n">one dot per run, the tick is the average</span></h3><div id="cloud"></div></div>`;
    return html;
  }
  function reasonFor(h, pairs) {                                // the value in plain words, from this lobby's simulated drafts and the ban model
    const OA = openA(), sh = shiftFor(h), bits = [];
    if (OA && !isNaN(OA.themA[h])) bits.push(`${whenOpen(OA, h)} of lobbies like this one${OA.usA[h] >= .03 ? `, your team in ${Math.round(100 * OA.usA[h])}` : ", your team almost never"}${OA.ban[h] >= .15 ? `. Someone bans it anyway in ${pct(OA.ban[h])} of ban phases` : ""}.`);
    if (sh && sh.up) bits.push(`Banning it moves their next ban toward <b>${esc(short(sh.up.h))}</b> (${pct(sh.up.a)} instead of ${pct(sh.up.b)}).`);
    bits.push(st.model === "sim" ? "The simulator plays your later bans the way a typical team would." : "The value assumes you follow the advice for your later bans.");
    if (pairs) bits.unshift("The two are scored as a pair, so heroes that replace each other are not counted twice.");
    return bits.join(" ");
  }
  /* How our ban moves their next ban: the ban model at their next position after banning h, against the same after a typical
     ban (the ban model's own chances for our team, over its ten likeliest bans). */
  const SHIFTC = new Map();
  function shiftFor(h) {
    if (!R8 || turnCount() === 2) return null;                   // on a two-ban turn the pair decides; no single-ban shift
    const et = nextBan() + 1; if (et >= 6 || ours(et)) return null;
    const key = lobbyKey() + "|" + h; if (SHIFTC.has(key)) return SHIFTC.get(key);
    const after = x => { const s = lobby(st.bans.concat([x])); return E.banProbs(s, et, E.legal(s)); };
    const A = after(h), typ = argsort(R8.pe, R8.cands).slice(0, 10), Z = typ.reduce((a, x) => a + R8.pe[x], 0), B = new Float64Array(H);
    for (const x of typ) { const q = after(x); for (let k = 0; k < H; k++) B[k] += R8.pe[x] / Z * q[k]; }
    let up = null; for (let k = 0; k < H; k++) { if (k === h || st.bans.includes(k)) continue; const d = A[k] - B[k]; if (!up || d > up.d) up = { h: k, d, a: A[k], b: B[k] }; }
    const out = { up: up && up.d > .02 ? up : null, A, B }; SHIFTC.set(key, out); return out;
  }
  function renderWhy() {                                        // on their turn: the ban model's reasons
    const e = nextBan(), W = $("chW");
    if (st.active.kind === "team") { W.hidden = false; $("whyH").textContent = "Why enter your team";
      $("whyP").textContent = "The heroes you enter tell the model which stand-in players to expect on your team. It then never suggests banning them, and the other team's ban forecast shifts toward what your team plays.";
      $("why").innerHTML = `<p class="reason" style="max-width:60ch">Teams ban heroes the other side plays: the ban model's targeting term is the largest gain found in its fit (a placebo team with the same rank does not reproduce it). Skip teammates you do not know: the model fills them in from players at your rank.</p>`; return; }
    if (e >= 6 || ourTurn() || !T8) { W.hidden = true; return; }
    const top = argsort(T8.pe, T8.cands)[0];
    W.hidden = false; $("whyH").innerHTML = `Why they would ban <span class="them">${esc(short(top))}</span>`;
    $("whyP").textContent = "The ban model's reasons for each likely ban, against an average hero still available. Only the lengths relative to each other matter.";
    $("why").innerHTML = whySvg(T8, Math.min(860, Math.max(520, $("why").clientWidth - 56)));
  }
  function whySvg(T, Wd) {
    const rs = whyRows(T), key = [["popular here", "var(--graphite)", .8], ["reaction to earlier bans", "var(--us)", .7], ["they do not play it", "var(--graphite)", .45], ["it beats what they play", "var(--them)", .5], ["your team plays it", "var(--them)", .9]];
    const sum = (r, sg) => r.c.filter(v => sg * v > 0).reduce((a, b) => a + b, 0), lo = Math.min(0, ...rs.map(r => sum(r, -1))), hi = Math.max(1e-6, ...rs.map(r => sum(r, 1)));
    const L = 120, X = v => L + (v - lo) / (hi - lo) * (Wd - L - 8), rowH = 22;
    let g = rs.map((r, k) => { let p = 0, n = 0; const segs = r.c.map((v, j) => { const a = v >= 0 ? p : n; if (v >= 0) p += v; else n += v;
      return `<rect x="${X(Math.min(a, a + v))}" y="${k * rowH + 3}" width="${Math.abs(X(a + v) - X(a))}" height="13" fill="${key[j][1]}" opacity="${key[j][2]}"><title>${key[j][0]}: ${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}</title></rect>`; }).join("");
      return `<text x="${L - 8}" y="${k * rowH + 14}" text-anchor="end">${esc(short(r.h))} ${pct(T.pe[r.h])}</text>${segs}`; }).join("");
    g += `<line x1="${X(0)}" x2="${X(0)}" y1="0" y2="${rs.length * rowH}" stroke="var(--ink)"/>`;
    let kx = 0, ky = rs.length * rowH + 20; g += key.map(([t, c, o]) => { const s = `<rect x="${kx}" y="${ky - 9}" width="10" height="10" fill="${c}" opacity="${o}"/><text x="${kx + 14}" y="${ky}">${t}</text>`; kx += 22 + t.length * 5.8; if (kx > Wd - 160) { kx = 0; ky += 17; } return s; }).join("");
    return `<svg viewBox="0 0 ${Wd} ${ky + 6}" width="100%" style="max-width:${Wd}px;font-size:11.5px;font-stretch:78%;fill:var(--text)">${g}</svg>`;
  }

  // ================================================================ openers: both teams' likely heroes, mirrored (simulated drafts)
  function renderFly() {
    const P = openThem(), U = openUs(), f = $("fly");
    if (!P) { f.innerHTML = `<div class="wait"><i></i>drafting both teams</div>`; return; }
    const bans = bannedSet(), revs = teamSet();
    const hs = NAMES.map((n, h) => h).filter(h => !bans.has(h)).sort((a, b) => Math.max(P[b], U[b]) - Math.max(P[a], U[a])).slice(0, 12);
    const Wd = Math.min(900, Math.max(560, f.clientWidth)), mid = Wd / 2, half = mid - 100, rowH = 32, top = 28, mx = Math.max(...hs.map(h => Math.max(P[h], U[h])), 1e-6);
    let g = `<text class="hd them" x="${mid - 60}" y="12" text-anchor="end">Other team</text><text class="hd us" x="${mid + 60}" y="12">Your team</text>`;
    hs.forEach((h, k) => { const y = top + k * rowH, a = P[h] / mx * half, b = U[h] / mx * half;
      g += `<rect class="them" x="${mid - 58 - a}" y="${y + 9}" width="${Math.max(1, a)}" height="10"/><text class="p" x="${mid - 62 - a}" y="${y + 18}" text-anchor="end">${pct(P[h])}</text>
        <image href="${img(h)}" x="${mid - 54}" y="${y + 1}" width="24" height="24"/><text x="${mid - 24}" y="${y + 18}">${esc(short(h))}</text>
        <rect class="us" x="${mid + 58}" y="${y + 9}" width="${Math.max(1, b)}" height="10"/><text class="p" x="${mid + 62 + b}" y="${y + 18}">${pct(U[h])}${revs.has(h) ? " (shown)" : ""}</text>`; });
    g += `<line class="mid" x1="${mid - 58}" x2="${mid - 58}" y1="${top - 4}" y2="${top + hs.length * rowH}"/><line class="mid" x1="${mid + 58}" x2="${mid + 58}" y1="${top - 4}" y2="${top + hs.length * rowH}"/>`;
    f.innerHTML = `<svg viewBox="0 0 ${Wd} ${top + hs.length * rowH + 4}">${g}</svg><p class="note">From ${fmt(OPN.runs)} simulated ban phases of this lobby: stand-in players near your rank, the rest of the bans from the ban model, and both teams' drafts from the pick model.</p>`;
  }

  // ================================================================ the pipeline: what runs when you click
  function renderPipe() {
    const sim = st.model === "sim", N = [
      { x: 0, y: 18, t: "Your lobby", s: "rank, map, side, bans, team" },
      { x: 150, y: 18, t: "Value networks", s: `one per ban position` },
      { x: 300, y: 18, t: "Value of each ban", s: "against a typical ban", hot: !sim },
      { x: 150, y: 104, t: "Ban model", s: "their bans, and a typical ban" },
      { x: 0, y: 190, t: "Stand-in players", s: "real players near your rank", sim: true },
      { x: 150, y: 190, t: "Both teams draft", s: "the pick model, jointly", sim: true },
      { x: 300, y: 190, t: "Outcome model", s: `${st.runs} runs per leading ban`, sim: true, hot: sim }];
    const w = 132, h = 58, box = n => `<g class="node${n.hot ? " hot" : ""}${n.sim ? " sim" : ""}"><rect x="${n.x}" y="${n.y}" width="${w}" height="${h}"/><text class="t" x="${n.x + 10}" y="${n.y + 24}">${n.t}</text><text x="${n.x + 10}" y="${n.y + 42}">${n.s}</text></g>`;
    const E2 = (a, b, cls) => { const A = N[a], B = N[b], x1 = A.x + w, y1 = A.y + h / 2, x2 = B.x, y2 = B.y + h / 2;
      const d = A.y === B.y ? `M${x1} ${y1}H${x2}` : A.x === B.x ? `M${A.x + w / 2} ${A.y + h}V${B.y}` : `M${A.x + w / 2} ${A.y + h}V${y2}H${x2}`;
      return `<path class="${cls || ""}" d="${d}"/>` + (((!sim && !cls) || (sim && cls === "sim")) ? `<path class="flow" d="${d}"/>` : ""); };
    const edges = [E2(0, 1), E2(1, 2), E2(3, 2), E2(0, 4, "sim"), E2(4, 5, "sim"), E2(3, 5, "sim"), E2(5, 6, "sim")];
    $("pipe").innerHTML = `<svg viewBox="-2 0 436 256">${edges.join("")}${N.map(box).join("")}</svg>`;
    $("pipeP").textContent = sim ? "The simulator plays each leading ban out with stand-in players near your rank: the rest of the bans from the ban model, both teams' drafts from the pick model, and the outcome model's win chance for every pair of drafts. It is the same world the value networks were trained in."
      : `The value networks answer in a fraction of a second. They were trained on ${fmt(REP.world_model.lobbies)} simulated lobbies (${fmt(REP.world_model.lobbies * REP.world_model.phases_per_lobby)} ban phases), one network per ban position, working back from the last ban. Switch to the simulator to play a lobby out instead.`;
  }
  const SPL = REP.splits, fitN = SPL.train.n + SPL.validation.n;
  const dayOf = t => new Date(t.replace(" ", "T") + "Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
  $("facts").innerHTML = [[fmt(fitN), "ranked matches fitted"], [String(H), "heroes modelled"], [fmt(REP.world_model.lobbies), "lobbies simulated"], [String(LAY.maps.length), "maps"]].map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join("");
  $("fitted").textContent = `Model ${REP.version}, fitted on ${fmt(fitN)} PC ranked matches from Season 10, ${dayOf(SPL.train.first_utc)} to ${dayOf(SPL.validation.last_utc)}. The models run in your browser.`;

  // ================================================================ the step bar
  function renderSteps() {
    $("team").innerHTML = st.team.map((h, i) => { const on = st.active.kind === "team" && st.active.i === i;
      return `<button class="sl us${h >= 0 ? " filled" : ""}${on ? " on" : ""}" data-i="${i}" title="${i === 0 ? "You" : "Teammate " + (i + 1)}${h >= 0 ? ": " + esc(NAMES[h]) : ""}"><span class="box">${h >= 0 ? `<img src="${img(h)}" alt="">` : "+"}</span><span class="cap">${i === 0 ? "You" : "Mate " + (i + 1)}</span>${h >= 0 ? `<span class="x" data-clear="${i}">✕</span>` : ""}</button>`; }).join("");
    $("team").querySelectorAll(".sl").forEach(b => b.onclick = ev => { const i = +b.dataset.i, clr = ev.target.dataset.clear !== undefined; if (clr) LS.clearSlot(st, i); st.active = { kind: "team", i }; update(clr); });
    const e = nextBan(), sug = ourTurn() && R8 && st.active.kind === "ban" ? suggested() : null, path = PATH || [];
    $("track").innerHTML = [0, 1, 2, 3, 4, 5].map(i => {
      const h = st.bans[i], sd = ours(i) ? "us" : "them", sg = h === undefined && sug && i >= e && i < e + sug.hs.length ? sug.hs[i - e] : undefined, f = h === undefined && sg === undefined ? path.find(x => x.e === i) : null;
      const inner = h !== undefined ? `<img src="${img(h)}" alt="">` : sg !== undefined ? `<img class="gh" src="${img(sg)}" alt="">` : f ? `<img class="gh" src="${img(f.h)}" alt="">` : i + 1;
      return `<button class="sl b ${sd}${h !== undefined ? " filled" : ""}${i === e && st.active.kind === "ban" ? " on" : ""}" data-i="${i}"
        title="Ban ${i + 1}, ${sd === "us" ? "your team" : "their team"}${h !== undefined ? ": " + esc(NAMES[h]) + ". Click to undo from here" : sg !== undefined ? ": suggested " + esc(NAMES[sg]) : f ? (f.us ? ": advised then " : ": likely ") + esc(NAMES[f.h]) + (f.p ? " (" + pct(f.p) + ")" : "") : ""}"><span class="box">${inner}</span><span class="cap">${sd === "us" ? "You" : "Them"}</span></button>`; }).join("");
    $("track").querySelectorAll(".sl").forEach(b => b.onclick = () => { const i = +b.dataset.i;
      if (i < st.bans.length) { st.bans = st.bans.slice(0, i); st.active = { kind: "ban" }; update(); } else { st.active = { kind: "ban" }; update(false); } });
    const t = $("nowT"); t.className = "t " + side();
    t.textContent = st.active.kind === "team" ? (st.active.i === 0 ? "Now: your hero" : `Now: teammate ${st.active.i + 1}`) : e >= 6 ? "Ban phase complete" : ourTurn() ? (turnCount() === 2 ? `Now: your bans ${e + 1} and ${e + 2}` : `Now: your ban ${e + 1}`) : `Now: their ban ${e + 1}`;
    $("undoBtn").disabled = !st.bans.length;
  }

  // ================================================================ the simulator: a pool of workers running ../sim8.js
  const NW = Math.min(8, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), DRAWS = 32, NSIM = 12, NPAIR = 8;
  // intervals over runs that share stand-in draws (run j uses draw j % 32) are clustered by draw (CR1)
  function cse(js, d, m) {
    const G = new Map(); js.forEach((j, i) => { const g = (+j) % DRAWS, o = G.get(g) || { s: 0, n: 0 }; o.s += d[i]; o.n++; G.set(g, o); });
    const k = G.size, n = d.length; if (k < 2) return NaN; let s2 = 0; for (const o of G.values()) s2 += (o.s - o.n * m) ** 2; return Math.sqrt(k / (k - 1) * s2) / n;
  }
  function pairedDiff(S, a, b) { const A = S.vals[String(a)], B = S.vals[String(b)]; if (!A || !B) return null;
    const js = Object.keys(A).filter(j => B[j] !== undefined), d = js.map(j => A[j] - B[j]); if (!d.length) return null; const m = d.reduce((p, q) => p + q, 0) / d.length; return { d: m, se: cse(js, d, m) }; }
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  let pool = [], jobs = new Map(), jobId = 0;
  function newWorker() { const w = new Worker("../sim8-worker.js?v=659393b3bd"); w.onmessage = ev => onMsg(ev.data); w.onerror = () => { for (const J of jobs.values()) fail(J); }; return w; }
  function ensurePool(fresh) {
    if (fresh) { pool.forEach(w => w.terminate()); pool = []; jobs.clear(); for (const [k, F] of FLOWC) if (!F.done) FLOWC.delete(k); OPNRUN = ""; }
    while (pool.length < NW) pool.push(newWorker());
  }
  const byDraw = runs => { const o = pool.map(() => []); for (const j of runs) o[(j % DRAWS) % pool.length].push(j); return o; };
  /* A job over runs, split by stand-in draw so each worker builds only its own draws. msg: the worker message without runs. */
  function job(msg, runs, total, done, tick) {
    const J = { id: ++jobId, pending: 0, ticks: 0, total, done, tick, vals: {}, opens: null, flow: null, key: lobbyKey(), failed: false };
    jobs.set(J.id, J); byDraw(runs).forEach((js, k) => { if (!js.length) return; J.pending++; pool[k].postMessage(Object.assign({ id: J.id, v: LAY.run, runs: js }, msg)); });
    return J;
  }
  function fail(J) { if (J.failed) return; J.failed = true; jobs.delete(J.id); J.done(null); }
  function onMsg(d) {
    const J = jobs.get(d.id); if (!J) return;
    if (d.error) { console.error(d.error); fail(J); return; }
    if (!d.done) { J.ticks += d.tick || 0; if (J.tick) J.tick(J); return; }
    if (d.vals) for (const c in d.vals) Object.assign(J.vals[c] || (J.vals[c] = {}), d.vals[c]);
    if (d.opens) { if (!J.opens) J.opens = { us: new Float64Array(H), them: new Float64Array(H), av: new Float64Array(H), nu: 0, nt: 0, runs: 0 };
      for (let h = 0; h < H; h++) { J.opens.us[h] += d.opens.us[h]; J.opens.them[h] += d.opens.them[h]; J.opens.av[h] += d.opens.av[h]; } J.opens.nu += d.opens.nu; J.opens.nt += d.opens.nt; J.opens.runs += d.opens.runs; }
    if (d.flow) { if (!J.flow) J.flow = { us: new Float64Array(H), them: new Float64Array(H), nu: 0, nt: 0, runs: 0, mu: d.flow.mu, k: d.flow.k }; for (let h = 0; h < H; h++) { J.flow.us[h] += d.flow.us[h]; J.flow.them[h] += d.flow.them[h]; } J.flow.nu += d.flow.nu; J.flow.nt += d.flow.nt; J.flow.runs += d.flow.runs; }
    if (--J.pending > 0) return;
    jobs.delete(J.id); J.done(J);
  }
  const running = () => [...jobs.values()].some(J => J.key !== lobbyKey());
  function summarize(J, cands) {                              // per candidate: the average difference from the typical ban over the same runs
    const V = new Float64Array(H).fill(NaN), se = new Float64Array(H).fill(NaN), base = J.vals.typ || {}, out = [];
    for (const c of cands) { const v = J.vals[String(c)]; if (!v) continue; const js = Object.keys(v).filter(j => base[j] !== undefined), d = js.map(j => v[j] - base[j]); if (!d.length) continue;
      const m = d.reduce((a, b) => a + b, 0) / d.length, s = cse(js, d, m); if (!Array.isArray(c)) { V[c] = m; se[c] = s; } out.push({ c, m, se: s, js, d }); }
    return { V, se, rows: out, vals: J.vals };
  }
  function startSim() {
    const cnt = turnCount(), key = lobbyKey(), s = simLobby(), NR = st.runs, runs = range(0, NR);
    let cands;
    if (cnt === 2 && P8) cands = P8.slice(0, NPAIR).map(p => [p.a, p.b]);
    else cands = topBans(NSIM);
    const me = SIM = { key, done: false, cands: cands.filter(c => !Array.isArray(c)), pairs: cands.filter(c => Array.isArray(c)), total: (cands.length + 1) * NR, ticks: 0, want: NR };
    job({ type: "values", st: s, cands: cands.concat(["typ"]), opens: true }, runs, SIM.total, J_ => {
      if (SIM !== me) return;                                      // a newer run replaced this one (other lobby, runs or model)
      if (!J_) { SIM.failed = true; busy(false); renderCall(); return; }
      const S = summarize(J_, cands); Object.assign(SIM, S, { done: true, runs: NR });
      if (SIM.pairs.length) { SIMP = S.rows.filter(r => Array.isArray(r.c)).map(r => ({ a: r.c[0], b: r.c[1], V: r.m, se: r.se, range: { lo: r.m - 1.96 * r.se, hi: r.m + 1.96 * r.se } })).sort((a, b) => b.V - a.V); SIMP.src = S; }
      if (J_.opens) setOpens(J_.opens, NR, key);
      busy(false); refresh();
    }, J_ => { if (SIM !== me) return; SIM.ticks = J_.ticks; progress(); if (performance.now() - cloudT > 150) { cloudT = performance.now(); drawCloudFrom(J_); } });
  }
  let cloudT = 0;
  function progress() {
    if (!SIM) return; const f = Math.min(1, SIM.ticks / SIM.total), bar = $("simBar"); if (bar) bar.style.width = (100 * f).toFixed(1) + "%";
    const t = $("simCount"); if (t) t.textContent = `${fmt(SIM.ticks)} of ${fmt(SIM.total)} ban phases played out`;
    $("busyT").textContent = `simulating ${Math.round(100 * f)}%`;
  }
  /* Who opens what: us / them over every simulated phase (a hero banned in a phase counts as not opened), usA / themA only over
     the phases where the hero was available, and ban: the share of phases in which someone banned it. */
  function setOpens(o, runs, key) {
    const n = Math.max(o.runs, 1), perU = o.nu / n, perT = o.nt / n;
    OPN = { key, runs, us: o.us.map(x => x / Math.max(o.nu, 1)), them: o.them.map(x => x / Math.max(o.nt, 1)),
            usA: o.us.map((x, h) => o.av[h] ? x / (o.av[h] * perU) : NaN), themA: o.them.map((x, h) => o.av[h] ? x / (o.av[h] * perT) : NaN), ban: o.av.map(a => 1 - a / n) };
  }
  let OPNRUN = "";
  function startOpens() {                                        // who opens what, for the board and the chapters: 32 typical ban phases
    const key = lobbyKey(), s = simLobby(); if (OPNRUN === key) return; OPNRUN = key;
    job({ type: "values", st: s, cands: ["typ"], opens: true }, range(0, 32), 32, J => { if (OPNRUN === key) OPNRUN = ""; if (!J || J.key !== lobbyKey()) return; setOpens(J.opens, 32, key); refresh(); });
  }
  const FLOWC = new Map();
  function startFlow(h) {                                        // where the players who would open h go when it is banned too
    const key = lobbyKey() + "|" + h; if (FLOWC.has(key)) return FLOWC.get(key);
    const F = { key, h, done: false }; FLOWC.set(key, F);
    job({ type: "flow", st: simLobby(), h }, range(0, 48), 48, J => { if (!J) { F.failed = true; return; } Object.assign(F, J.flow, { done: true }); if (J.key === lobbyKey()) renderChapters(); });
    return F;
  }

  // ================================================================ chapters under the board
  const CHS = { d: null, b: null }, CHKEY = { v: "" };
  const chEl = id => ({ root: $(id), h2: $(id).querySelector("h2"), p: $(id).querySelector("p"), chips: $(id).querySelector(".chips"), f: $(id).querySelector(".chF") });
  const fw = (el, min = 560) => Math.max(min, el.clientWidth - 56);
  function chipRow(el, hs, cur, set) {
    el.innerHTML = hs.map(h => `<button class="chip${h === cur ? " on" : ""}" data-h="${h}"><img src="${img(h)}" alt="">${esc(short(h))}</button>`).join("");
    el.querySelectorAll(".chip").forEach(b => b.onclick = () => { set(+b.dataset.h); renderChapters(); });
  }
  function renderChapters() {
    const show = !!(R8 && st.active.kind === "ban" && ourTurn());
    for (const id of ["chD", "chA", "chB", "chC"]) $(id).hidden = !show;
    renderWhy(); renderFly();
    if (!show) return;
    if (CHKEY.v !== lobbyKey()) { CHKEY.v = lobbyKey(); CHS.d = CHS.b = null; }
    const sug = suggested(), top5 = topBans(5), lead = sug ? sug.hs[0] : top5[0];
    if (lead !== undefined && !top5.includes(lead)) { top5.unshift(lead); top5.pop(); }
    chapD(CHS.d ?? lead, top5); chapA(); chapB(CHS.b ?? lead, top5); chapC();
  }
  // ---- D: what the ban does in this lobby
  function dots(n, col, hollow = 0, hcol) { let s = ""; for (let i = 0; i < 100; i++) { const x = (i % 10) * 20 + 10, y = Math.floor(i / 10) * 20 + 10, on = i < n, ho = !on && i < n + hollow;
    s += ho ? `<circle cx="${x}" cy="${y}" r="6.5" fill="none" stroke="${hcol}" stroke-width="1.5" stroke-dasharray="2.5 2"/>` : `<circle cx="${x}" cy="${y}" r="${on ? 7.5 : 3}" fill="${on ? col : "var(--hair)"}"/>`; } return `<svg viewBox="0 0 200 200">${s}</svg>`; }
  function miniFlow(tg, col) {                                    // up to four destinations as bars
    const top = tg.slice(0, 4), mx = Math.max(...top.map(r => r.d), 1e-9);
    return `<svg viewBox="0 0 200 150">${top.map((r, k) => `<image href="${img(r.y)}" x="0" y="${k * 36 + 4}" width="28" height="28"/><text class="t11 g" x="36" y="${k * 36 + 14}">${esc(short(r.y))}</text>
      <rect x="36" y="${k * 36 + 19}" width="${(130 * r.d / mx).toFixed(1)}" height="9" fill="${col}"/><text class="t11 ink" x="${40 + 130 * r.d / mx}" y="${k * 36 + 28}">${pct(r.d)}</text>`).join("")}</svg>`;
  }
  const flowTargets = (F, side) => { const n = side === "them" ? F.nt : F.nu, v = F[side]; return n ? [...v.keys()].filter(h => v[h] > 0).map(y => ({ y, d: v[y] / n })).sort((a, b) => b.d - a.d) : []; };
  function chapD(h, hs) {
    const C = chEl("chD"), OA = openA(), F = startFlow(h), sh = shiftFor(h), V = valueNow(), r = rangeOf(h), nm = esc(short(h));
    C.h2.innerHTML = `What banning <span class="us">${esc(NAMES[h])}</span> does in this lobby`;
    C.p.innerHTML = `From simulated drafts of this lobby (stand-in players near your rank, the rest of the bans from the ban model) and the ban model's reactions. The value comes from the ${simReady() ? "simulator" : "value networks"}.`;
    chipRow(C.chips, hs, h, x => CHS.d = x);
    const them = F.done ? flowTargets(F, "them") : [], wait = `<div class="wait" style="min-height:120px"><i></i>drafting</div>`;
    const pn = [
      [OA && !isNaN(OA.themA[h]) ? `${whenOpen(OA, h)}.` : `How often they open ${nm}`, OA && !isNaN(OA.themA[h]) ? dots(Math.round(100 * OA.themA[h]), "var(--them)") : wait,
        OA ? `in the ban phases where it stays open; someone bans it anyway in ${pct(OA.ban[h])} of them` : "the other team's drafted lineups"],
      [them.length ? `Without it, those players move to <b>${esc(short(them[0].y))}</b>${them[1] ? ` and ${esc(short(them[1].y))}` : ""}.` : `Where their players go`, F.done ? (them.length ? miniFlow(them, "var(--them)") : `<p class="note">They almost never open it here.</p>`) : wait, "the same drafts with it banned too"],
      [sh ? (sh.up ? `Their next ban moves toward <b>${esc(short(sh.up.h))}</b>: ${pct(sh.up.a)} instead of ${pct(sh.up.b)}.` : `Their next ban hardly changes.`) : `Their next ban`, sh ? shiftSvg(sh, h) : `<p class="note">No ban of theirs follows this one directly.</p>`, "the ban model, against a typical ban"],
      [OA && !isNaN(OA.usA[h]) ? `Your team opens it in <b>${Math.round(100 * OA.usA[h])} of 100</b> when it is open.` : `Your team`, OA && !isNaN(OA.usA[h]) ? dots(Math.round(100 * OA.usA[h]), "var(--us)") : wait,
        OA && OA.usA[h] < .03 ? "so the ban costs you almost nothing" : "your team's drafted lineups"],
      [`What the ban is worth to your team.`, `<div class="op">${pp(V[h])}</div>`, `points of win chance against a typical ban, range ${pp(r.lo)} to ${pp(r.hi)}${simReady() ? " (the simulator's 95% interval)" : ""}`]];
    C.f.innerHTML = `<div class="strip">${pn.map(([t, fig, sub], k) => `<div class="pn" style="animation-delay:${k * 90}ms"><span class="n">${k + 1}</span><p>${t}</p>${fig}<span class="sub">${sub}</span></div>`).join("")}</div>`;
  }
  function shiftSvg(sh, h) {                                     // their next ban's four likeliest, after this ban (solid) and after a typical one (hollow)
    const ks = [...sh.A.keys()].filter(k => k !== h).sort((a, b) => Math.max(sh.A[b], sh.B[b]) - Math.max(sh.A[a], sh.B[a])).slice(0, 4), mx = Math.max(...ks.map(k => Math.max(sh.A[k], sh.B[k])), 1e-9);
    return `<svg viewBox="0 0 200 150">${ks.map((k, i) => `<image href="${img(k)}" x="0" y="${i * 36 + 4}" width="28" height="28"/>
      <rect x="36" y="${i * 36 + 8}" width="${(130 * sh.B[k] / mx).toFixed(1)}" height="8" fill="none" stroke="var(--graphite)" stroke-dasharray="2 2"/>
      <rect x="36" y="${i * 36 + 20}" width="${(130 * sh.A[k] / mx).toFixed(1)}" height="8" fill="var(--them)"/><text class="t11 ink" x="${40 + 130 * Math.max(sh.A[k], sh.B[k]) / mx}" y="${i * 36 + 28}">${pct(sh.A[k])}</text>`).join("")}</svg>`;
  }
  // ---- A: how sure
  function chapA() {
    const C = chEl("chA"), WU = REP.checks.world_model_uncertainty, BF = REP.checks.brute_force;
    if (st.model !== "sim") {
      const top = topBans(8), Wd = Math.min(900, fw(C.f)), L = 150, rowH = 34, rs = top.map(h => R8.spread(h)), lo = Math.min(0, ...rs.map(r => r.lo)), hi = Math.max(...rs.map(r => r.hi), 1e-4), X = v => L + (v - lo) / (hi - lo) * (Wd - L - 70);
      C.h2.innerHTML = `How sure is the model?`;
      C.p.innerHTML = `Each value comes with the networks' range: how far apart the networks behind the advice land (one SD either side). Ranges that overlap are close calls.` +
        (WU ? ` Refitting the models on resampled matches moves a ban's value by about as much again (${(WU.world_sd_pts).toFixed(2)} points), so treat small leads as ties.` : "");
      let g = `<line x1="${X(0)}" x2="${X(0)}" y1="0" y2="${top.length * rowH}" stroke="var(--ink)" stroke-dasharray="2 3"/>`;
      top.forEach((h, k) => { const y = k * rowH + 17, r = rs[k];
        g += `<image href="${img(h)}" x="${L - 34}" y="${y - 13}" width="26" height="26"/><text class="t13 tx" x="${L - 42}" y="${y + 4}" text-anchor="end" font-weight="600">${esc(short(h))}</text>
          <rect x="${X(r.lo)}" y="${y - 5}" width="${Math.max(1, X(r.hi) - X(r.lo))}" height="10" fill="var(--us-soft)"/><line x1="${X(r.lo)}" x2="${X(r.hi)}" y1="${y}" y2="${y}" stroke="var(--ink)" stroke-width="1.5"/>
          <circle cx="${X(R8.V[h])}" cy="${y}" r="5.5" fill="var(--us)" stroke="var(--paper)" stroke-width="2"/><text class="t13 ink" x="${Wd}" y="${y + 4}" text-anchor="end" font-weight="700">${pp(R8.V[h])}</text>`; });
      C.f.innerHTML = `<div class="lab2"><span>Value of each ban with the networks' range</span><span>points of win chance</span></div><svg viewBox="0 0 ${Wd} ${top.length * rowH + 4}" class="fadein">${g}</svg>
        ${BF ? (BF.gap_network_pts !== undefined
          ? `<p class="note">In the notebook's test on held-out lobbies, a brute-force simulation of every last ban, which knows the hidden players, beat the networks' ban by ${BF.gap_network_pts.toFixed(2)} ± ${BF.gap_network_se_pts.toFixed(2)} points (and a typical ban by ${BF.gap_typical_pts.toFixed(2)}), with its best ban picked and scored on separate runs. They picked the same ban in ${pct(BF.same_choice)} of lobbies.</p>`
          : `<p class="note">In the notebook's test on held-out lobbies, the networks picked the same last ban as a brute-force simulation of every ban in ${pct(BF.same_choice)} of lobbies and lost ${BF.regret_network_pts.toFixed(2)} points on average where they differed (a typical ban loses ${BF.regret_typical_pts.toFixed(2)}).</p>`) : ""}
        <div class="go runsim"><button class="btn us" id="runSim">Play it out: simulator, ${st.runs} runs</button><span class="note" style="margin:0">stand-in players, both teams re-drafted, for the networks' ${turnCount() === 2 ? NPAIR + " best pairs" : NSIM + " best bans"}</span></div>`;
      $("runSim").onclick = () => { st.model = "sim"; update(false); };
      return;
    }
    if (!simReady()) { C.h2.innerHTML = "How sure is the model?"; C.p.innerHTML = "The simulator is playing the ban phase out for each leading ban."; C.f.innerHTML = `<div class="wait"><i></i>simulating</div>`; return; }
    const rows = SIM.rows.filter(r => !Array.isArray(r.c)); if (rows.length < 2) { C.f.innerHTML = ""; return; }
    const js = Object.keys(SIM.vals.typ || {}).filter(j => rows.every(r => SIM.vals[String(r.c)][j] !== undefined)), J = js.length;
    const wins = new Map(rows.map(r => [r.c, 0])); for (const j of js) { let b = -1, bv = -Infinity; for (const r of rows) { const v = SIM.vals[String(r.c)][j]; if (v > bv) { bv = v; b = r.c; } } wins.set(b, wins.get(b) + 1); }
    const R = rows.map(r => ({ h: r.c, m: r.m, se: r.se, p: wins.get(r.c) / J, d: js.map(j => SIM.vals[String(r.c)][j] - SIM.vals.typ[j]) }));
    const byP = R.slice().sort((a, b) => b.p - a.p), byM = R.slice().sort((a, b) => b.m - a.m).slice(0, 8), L0 = byP[0], pick = byM[0], pk = esc(short(pick.h));
    C.h2.innerHTML = `<span class="us">${pk}</span> comes out best in ${pct(pick.p)} of simulated ban phases`;
    C.p.innerHTML = (L0.h !== pick.h ? `${esc(short(L0.h))} is best more often (${pct(L0.p)}), but its average is lower (${pp(L0.m)} against ${pp(pick.m)}) because its value swings more from run to run. The recommendation follows the average. `
      : pick.p < .5 ? `No ban wins most of the time. ` : `It wins most simulated ban phases. `) + `The averages are measured far more precisely than any single run: see the black bars. Below: the simulator against the networks' own values for the same play.`;
    const strip = `<div class="lab2"><span>Share of the ${J} simulated ban phases in which each ban comes out best</span></div><div class="bstrip">${byP.filter(r => r.p > 0).map((r, k) => `<div class="bseg" style="flex:${r.p} 1 0;animation-delay:${k * 55}ms" title="${esc(NAMES[r.h])}: best in ${pct(r.p)}">${r.p >= .06 ? `<img src="${img(r.h)}" alt="">` : ""}${r.p >= .1 ? `<div><b>${pct(r.p)}</b><br><span>${esc(short(r.h))}</span></div>` : r.p >= .06 ? `<b style="font-size:13px">${pct(r.p)}</b>` : ""}</div>`).join("")}</div>`;
    const all = byM.flatMap(r => r.d).sort((a, b) => a - b), lo = all[Math.floor(.01 * (all.length - 1))], hi = all[Math.floor(.99 * (all.length - 1))], Wd = fw(C.f, 620), L = 140, Rr = 160, rowH = 38, amp = 44, top = 66;
    const x = v => L + (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo || 1) * (Wd - L - Rr);
    const kde = d => { const n = d.length, m = d.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) || 1e-4, bw = 1.06 * sd * Math.pow(n, -.2);
      const pts = []; for (let i = 0; i <= 90; i++) { const v = lo + (hi - lo) * i / 90; let s = 0; for (const u of d) s += Math.exp(-.5 * ((v - u) / bw) ** 2); pts.push([v, s / (n * bw)]); } return pts; };
    const dens = byM.map(r => kde(r.d)), dmax = Math.max(...dens.flat().map(p => p[1])), Hh = top + (byM.length - 1) * rowH + 40;
    let g = `<defs><clipPath id="cpPos"><rect x="${x(0)}" y="0" width="${Wd}" height="3000"/></clipPath><clipPath id="cpNeg"><rect x="0" y="0" width="${x(0)}" height="3000"/></clipPath></defs>
      <line x1="${x(0)}" x2="${x(0)}" y1="${top - 60}" y2="${Hh - 26}" stroke="var(--ink)" stroke-dasharray="2 3"/><text class="t11 g" x="${x(0) + 4}" y="${top - 50}">a typical ban</text>`, over = "";
    byM.forEach((r, k) => {
      const base = top + k * rowH, pts = dens[k].map(([v, p]) => `${x(v).toFixed(1)} ${(base - p / dmax * amp).toFixed(1)}`), line = "M" + pts.join("L"), area = line + `L${x(hi)} ${base}L${x(lo)} ${base}Z`;
      g += `<g class="ridge" style="transform-origin:0 ${base}px;animation-delay:${100 + k * 50}ms"><path d="${area}" fill="var(--paper)"/><path d="${area}" fill="var(--them)" opacity=".36" clip-path="url(#cpNeg)"/><path d="${area}" fill="var(--us)" opacity=".48" clip-path="url(#cpPos)"/><path d="${line}" fill="none" stroke="var(--ink)" stroke-width="1.2"/></g>
        <image href="${img(r.h)}" x="${L - 34}" y="${base - 26}" width="26" height="26"/><text class="t13 tx" x="${L - 42}" y="${base - 8}" text-anchor="end" font-weight="600">${esc(short(r.h))}</text>
        <text class="t13 ink" x="${Wd - Rr + 20}" y="${base - 8}" font-weight="700">${pp(r.m)}</text><rect x="${Wd - Rr + 72}" y="${base - 17}" width="80" height="7" fill="var(--hair)"/><rect x="${Wd - Rr + 72}" y="${base - 17}" width="${(80 * r.p / Math.max(L0.p, 1e-9)).toFixed(1)}" height="7" fill="var(--us)"/><text class="t11 g" x="${Wd - Rr + 72}" y="${base - 1}">best ${pct(r.p)}</text>`;
      over += `<line x1="${x(r.m)}" x2="${x(r.m)}" y1="${base - 15}" y2="${base + 2}" stroke="var(--ink)" stroke-width="3"/><rect x="${x(r.m - 1.96 * r.se)}" y="${base - 1}" width="${Math.max(2, x(r.m + 1.96 * r.se) - x(r.m - 1.96 * r.se))}" height="5" fill="var(--ink)"/>`;
    });
    const step = niceStep(hi - lo, 4); for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) over += `<text class="t11 g" x="${x(v)}" y="${Hh - 8}" text-anchor="middle">${pp(v, dec(step))}</text>`;
    C.f.innerHTML = strip + `<div class="lab2" style="margin-top:22px"><span>What each ban is worth, run by run. The tick is the average, the black bar its 95% interval.</span><span>average and chance it is best</span></div><svg viewBox="0 0 ${Wd} ${Hh}">${g}${over}</svg>` + versusNets(byM);
  }
  /* The simulator against the networks' behaviour values: both are "this ban now, then typical bans from both teams", so they
     should agree up to simulation noise. The advice itself assumes you follow the advice later, which the simulator does not play. */
  function versusNets(rows) {
    if (!BEH) return "";
    const Wd = 520, L = 140, rowH = 26, vs = rows.flatMap(r => [r.m - 1.96 * r.se, r.m + 1.96 * r.se, BEH.V[r.h]]).filter(isFinite), lo = Math.min(0, ...vs), hi = Math.max(1e-4, ...vs), X = v => L + (v - lo) / (hi - lo) * (Wd - L - 20);
    let g = `<line x1="${X(0)}" x2="${X(0)}" y1="0" y2="${rows.length * rowH}" stroke="var(--ink)" stroke-dasharray="2 3"/>`;
    rows.forEach((r, k) => { const y = k * rowH + 13, b = BEH.V[r.h];
      g += `<text class="t12 tx" x="${L - 10}" y="${y + 4}" text-anchor="end">${esc(short(r.h))}</text><line x1="${X(r.m - 1.96 * r.se)}" x2="${X(r.m + 1.96 * r.se)}" y1="${y}" y2="${y}" stroke="var(--ink)" stroke-width="1.5"/>
        <circle cx="${X(r.m)}" cy="${y}" r="4.5" fill="var(--us)"/>${isFinite(b) ? `<path d="M${X(b)} ${y - 6}l5 6l-5 6l-5 -6z" fill="none" stroke="var(--them)" stroke-width="1.6"/>` : ""}`; });
    return `<div class="lab2" style="margin-top:26px"><span>Simulator (dot, 95% interval) against the value networks' typical-play value (diamond), same bans</span><span>points against a typical ban</span></div><svg viewBox="0 0 ${Wd} ${rows.length * rowH + 4}" style="max-width:${Wd}px">${g}</svg>
      <p class="note">Both answer the same question: this ban now, then both teams ban the way typical teams do. The networks learn from many lobbies at once, which pulls their values toward a typical ban, so the simulator, which plays this lobby alone, often finds larger differences; it is also noisier. The advice above assumes you follow the advice for your later bans, which is worth more.</p>`;
  }
  // ---- B: where the players go, in this lobby's drafts
  function flowSvg(h, tg, share, col, Wd, total) {
    const shown = tg.slice(0, share), rest = tg.slice(share).reduce((a, r) => a + r.d, 0), T = shown.concat(rest > .005 ? [{ y: -1, d: rest, n: tg.length - share }] : []);
    const sum = T.reduce((a, r) => a + r.d, 0), K = 300 / Math.max(sum, 1e-6), gap = 8, L = 120, Rx = Wd - 190, nodeW = 12, top = 6;
    let y = top; const nodes = T.map(r => { const o = { ...r, y0: y, hh: Math.max(1.5, r.d * K) }; y += Math.max(o.hh, r.y < 0 ? 0 : 28) + gap; return o; });
    const Hh = y + 4, srcH = sum * K, sy0 = top + (Hh - top - 4 - srcH) / 2;
    let g = `<rect x="${L - nodeW}" y="${sy0}" width="${nodeW}" height="${srcH}" fill="${col}"/><image href="${img(h)}" x="${L - nodeW - 50}" y="${sy0 + srcH / 2 - 20}" width="40" height="40"/>
      <text class="t12 g" x="${L - nodeW - 54}" y="${sy0 + srcH / 2 + 4}" text-anchor="end">${total}</text>`, sy = sy0;
    nodes.forEach((r, k) => { const w = r.d * K, c = (L + Rx) / 2;
      g += `<path class="rib" d="M${L} ${sy}C${c} ${sy} ${c} ${r.y0} ${Rx} ${r.y0}L${Rx} ${r.y0 + w}C${c} ${r.y0 + w} ${c} ${sy + w} ${L} ${sy + w}Z" fill="${r.y < 0 ? "var(--graphite)" : col}" opacity="${r.y < 0 ? .25 : Math.max(.3, .78 - k * .06)}" style="animation:fadein .7s ${k * 60}ms both"><title>${r.y < 0 ? "other heroes" : esc(NAMES[r.y])}: ${pct(r.d)}</title></path>
        <rect x="${Rx}" y="${r.y0}" width="${nodeW}" height="${r.hh}" fill="var(--ink)"/>` +
        (r.y < 0 ? `<text class="t12 g" x="${Rx + 20}" y="${r.y0 + r.hh / 2 + 4}">${r.n} other heroes, ${pct(r.d)}</text>`
          : `<image href="${img(r.y)}" x="${Rx + 20}" y="${r.y0 + r.hh / 2 - 12}" width="24" height="24"/><text class="t12 tx" x="${Rx + 50}" y="${r.y0 + r.hh / 2 - 1}" font-weight="700">${esc(short(r.y))}</text><text class="t11 g" x="${Rx + 50}" y="${r.y0 + r.hh / 2 + 11}">${pct(r.d)}</text>`);
      sy += w; });
    return `<svg class="flowsvg" viewBox="0 0 ${Wd} ${Hh}">${g}</svg>`;
  }
  function chapB(h, hs) {
    const C = chEl("chB"), F = startFlow(h), W2 = fw(C.f), OA = openA();
    chipRow(C.chips, hs, h, x => CHS.b = x);
    if (!F.done) { C.h2.innerHTML = `Ban <span class="us">${esc(short(h))}</span>: where do the players go?`; C.p.innerHTML = "Drafting this lobby with and without it.";
      C.f.innerHTML = F.failed ? `<p class="note">The drafts could not be run in this browser.</p>` : `<div class="wait"><i></i>drafting</div>`; return; }
    const them = flowTargets(F, "them"), us = flowTargets(F, "us"), names = them.slice(0, 3).map(r => esc(short(r.y)));
    const list = names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0] || "other heroes";
    C.h2.innerHTML = them.length ? `Ban <span class="us">${esc(short(h))}</span> and their players move to ${list}` : `They rarely open ${esc(short(h))} in this lobby`;
    C.p.innerHTML = `The same simulated drafts of this lobby, once as they are and once with ${esc(short(h))} banned too, with the same stand-in players and the same random numbers. Each ribbon is where a player who would have opened it goes instead: team-ups, roles and the rest of the lineup all count.`;
    const sub = SUB.get(NAMES[h]);
    C.f.innerHTML = `<div class="two"><div><h4 style="color:var(--them)">Their players</h4>${them.length ? flowSvg(h, them, 7, "var(--them)", Math.max(520, W2 * .56), `${OA && !isNaN(OA.themA[h]) ? Math.round(100 * OA.themA[h]) : "?"} in 100 drafts`) : `<p class="note">Too few of their drafts open it to draw.</p>`}</div>
      <div><h4 style="color:var(--us)">Your players</h4>${us.length && F.nu >= 8 ? flowSvg(h, us, 5, "var(--us)", Math.max(420, W2 * .4), `${OA && !isNaN(OA.usA[h]) ? Math.round(100 * OA.usA[h]) : "?"} in 100 drafts`) : `<p class="note">Your team rarely opens ${esc(short(h))}, so the ban moves almost none of your players.</p>`}</div></div>
      <p class="note">${F.runs} simulated ban phases${sub && sub.top.length ? `. Across all Season 10 players whose main is ${esc(short(h))}, the pick model sends them to ${sub.top.slice(0, 3).map(t => `${esc(SHORT[t[0]] || t[0])} (${pct(t[1])})`).join(", ")}, before teammates pick` : ""}.</p>`;
    C.f.querySelectorAll(".flowsvg").forEach(sv => sv.querySelectorAll(".rib").forEach(p => { p.onmouseenter = () => { sv.classList.add("focus"); p.classList.add("hot"); }; p.onmouseleave = () => { sv.classList.remove("focus"); p.classList.remove("hot"); }; }));
  }
  // ---- C: the rest of the ban phase as a tree (the value networks, in a worker)
  const TREE = { key: "", root: null, calls: 0, done: false, id: 0 };
  let treeW = null, treeTimer = 0;
  function chapC() {
    const C = chEl("chC");
    C.h2.innerHTML = `Your ban decides what they take next, and what is left for you`;
    C.p.innerHTML = `Your best options now, the other team's likeliest replies from the ban model (branch width is their chance), and the value networks' best ban for your next turn, with its worth against a typical ban at that point. The likeliest path is solid. Hover an option to follow it.`;
    const key = lobbyKey();
    if (TREE.key !== key && R8) {
      TREE.key = key; TREE.root = null; TREE.done = false; TREE.calls = 0; const id = ++TREE.id;
      if (treeW) treeW.terminate();
      treeW = new Worker("tree8-worker.js?v=ba218d30e7");
      treeW.onmessage = ev => { if (ev.data.id !== TREE.id) return; if (ev.data.error) { TREE.failed = true; drawTree(); return; } TREE.root = ev.data.root; TREE.calls = ev.data.calls; TREE.done = ev.data.done; ev.data.done ? drawTree() : drawTreeSoon(); };
      const opts = turnCount() === 2 && P8 ? P8.slice(0, 3).map(p => ({ hs: [p.a, p.b], V: p.V })) : topBans(3).map(h => ({ hs: [h], V: R8.V[h] }));
      treeW.postMessage({ id, base: lobby(), opts, v: LAY.run });
    }
    drawTree();
  }
  const drawTreeSoon = () => { if (!treeTimer) treeTimer = setTimeout(() => { treeTimer = 0; drawTree(); }, 700); };
  function drawTree() {
    const f = chEl("chC").f;
    if (TREE.failed) { f.innerHTML = `<p class="note">The tree could not be built in this browser.</p>`; return; }
    if (!TREE.root || !TREE.root.kids.length) { f.innerHTML = `<div class="wait"><i></i>building the tree</div>`; return; }
    const depth = n => !n.kids || !n.kids.length ? 0 : 1 + Math.max(...n.kids.map(depth)), D = Math.max(...TREE.root.kids.map(depth)) + 1;
    const leaves = []; const walk = (n, path) => { if (!n.kids || !n.kids.length) leaves.push(path.concat([n])); else n.kids.forEach(k => walk(k, path.concat([n]))); };
    TREE.root.kids.forEach(k => walk(k, []));
    const rowH = 36, top = 44, Wd = fw(f, 700), labW = 230, colX = i => 40 + i * (Wd - labW - 40) / Math.max(1, D - 1 || 1), Hh = top + leaves.length * rowH + 6;
    const ys = new Map(); leaves.forEach((p, i) => ys.set(p[p.length - 1], top + i * rowH + rowH / 2));
    const Y = n => { if (ys.has(n)) return ys.get(n); const v = n.kids.map(Y).reduce((a, b) => a + b, 0) / n.kids.length; ys.set(n, v); return v; };
    TREE.root.kids.forEach(Y);
    let links = "", nodes = "", heads = ""; const e0 = nextBan(), colBan = [];
    const probe = (n, c) => { if (!colBan[c]) colBan[c] = { who: n.who, from: n.bans.length - n.hs.length, n: n.hs.length }; (n.kids || []).forEach(k => probe(k, c + 1)); };
    TREE.root.kids.forEach(k => probe(k, 0));
    colBan.forEach((cb, c) => { const lab = c === 0 ? (cb.n === 2 ? `Bans ${e0 + 1} and ${e0 + 2}: you` : `Ban ${e0 + 1}: you`) : cb.who === "them" ? `Ban ${cb.from + 1}: them` : cb.n === 2 ? `Your next two bans` : `Your next ban`;
      heads += `<text x="${colX(c) - 18}" y="14" class="t12" font-weight="800" fill="${cb.who === "us" ? "var(--us)" : "var(--them)"}">${lab}</text><line x1="${colX(c) - 18}" x2="${colX(c) + 120}" y1="22" y2="22" stroke="var(--ink)"/>`; });
    const pics = (n, x, y, s, ring) => n.hs.map((h, i) => `<rect x="${x - s / 2 - 2 + i * (s + 2)}" y="${y - s / 2 - 2}" width="${s + 4}" height="${s + 4}" fill="var(--paper)" stroke="${ring}" stroke-width="2"/><image href="${img(h)}" x="${x - s / 2 + i * (s + 2)}" y="${y - s / 2}" width="${s}" height="${s}"/>`).join("");
    const draw = (n, c, pid) => {
      const x = colX(c), y = Y(n), ring = n.who === "us" ? "var(--us)" : "var(--them)", s = c === 0 ? 40 : 28;
      (n.kids || []).forEach(k => { const x2 = colX(c + 1), y2 = Y(k), w = k.who === "them" ? Math.max(1.5, k.p * 110) : k.main ? 3 : 1.4;
        const col = k.who === "them" ? "var(--them)" : "var(--us)", op = k.main ? .78 : .26, x0 = x + (n.hs.length > 1 ? s + 22 : s / 2 + 10) + (n.who === "them" ? 64 : 0);
        links += `<path class="lk br" data-leaf="${pid}" d="M${x0} ${y}C${(x0 + x2) / 2} ${y} ${(x0 + x2) / 2} ${y2} ${x2 - s / 2 - 10} ${y2}" stroke="${col}" stroke-width="${w}" opacity="${op}"/>`;
        draw(k, c + 1, pid); });
      nodes += `<g class="br" data-leaf="${pid}">${pics(n, x, y, s, ring)}` + (n.who === "them"
        ? `<text class="t12 tx" x="${x + s / 2 + 8}" y="${y - 2}" font-weight="600">${esc(short(n.hs[0]))}</text><text class="t11 g" x="${x + s / 2 + 8}" y="${y + 11}">${pct(n.p)}</text>`
        : c === 0 ? `<text class="t13 ink" x="${x - s / 2}" y="${y + s / 2 + 16}" font-weight="800">${n.hs.map(h => esc(short(h))).join(" + ")}</text><text class="t11 g" x="${x - s / 2}" y="${y + s / 2 + 29}">${pp(n.V)} points</text>`
        : `<text class="t12 ink" x="${x + n.hs.length * (s + 2) - s / 2 + 8}" y="${y - 1}" font-weight="${n.main ? 800 : 600}">${n.hs.map(h => esc(short(h))).join(" + ")}</text><text class="t11 g" x="${x + n.hs.length * (s + 2) - s / 2 + 8}" y="${y + 12}">${pp(n.V)} points</text>`) + `</g>`;
    };
    TREE.root.kids.forEach((k, i) => draw(k, 0, i));
    f.innerHTML = `<svg class="treesvg" viewBox="0 0 ${Wd} ${Hh}">${heads}${links}${nodes}</svg>${TREE.done ? "" : `<div class="wait" style="min-height:30px"><i></i>working out your next turns, ${TREE.calls} scored</div>`}`;
    const sv = f.querySelector("svg");
    sv.querySelectorAll("g.br").forEach(g => { g.onmouseenter = () => { sv.classList.add("focus"); sv.querySelectorAll(`[data-leaf="${g.dataset.leaf}"]`).forEach(x => x.classList.add("hot")); };
      g.onmouseleave = () => { sv.classList.remove("focus"); sv.querySelectorAll(".hot").forEach(x => x.classList.remove("hot")); }; });
  }
  // the run cloud in the call panel: one dot per simulated ban phase for the leading bans, as the workers report
  function drawCloudFrom(J) {
    const box = $("cloud"); if (!box || !J) return; const bj = J.vals.typ || {}, rows = [];
    for (const c in J.vals) { if (c === "typ" || c.includes(",")) continue; const v = J.vals[c], d = Object.keys(v).filter(j => bj[j] !== undefined).map(j => v[j] - bj[j]); if (d.length) rows.push({ h: +c, d, m: d.reduce((a, b) => a + b, 0) / d.length }); }
    rows.sort((a, b) => b.m - a.m); const top = rows.slice(0, 10); if (!top.length) return;
    const all = top.flatMap(r => r.d).sort((a, b) => a - b), lo = Math.min(0, all[Math.floor(.01 * (all.length - 1))]), hi = Math.max(0, all[Math.floor(.99 * (all.length - 1))]) || 1e-3;
    const L = 92, Wd = 380, X = v => L + (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * (Wd - L - 46), rowH = 22;
    let g = `<line class="zero" x1="${X(0)}" x2="${X(0)}" y1="0" y2="${top.length * rowH}"/>`;
    top.forEach((r, k) => { const y = k * rowH + 11; g += `<text x="${L - 8}" y="${y + 4}" text-anchor="end">${esc(short(r.h))}</text>`;
      r.d.forEach((v, j) => { const jit = ((j * 7919) % 13) / 13 - .5; g += `<circle cx="${X(v).toFixed(1)}" cy="${(y + jit * 12).toFixed(1)}" r="1.9"${v < 0 ? ' class="neg"' : ""}/>`; });
      g += `<line class="mean" x1="${X(r.m)}" x2="${X(r.m)}" y1="${y - 8}" y2="${y + 8}"/><text class="v" x="${Wd}" y="${y + 4}" text-anchor="end">${pp(r.m)}</text>`; });
    const step = niceStep(hi - lo, 3); for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) g += `<text class="ax" x="${X(v)}" y="${top.length * rowH + 12}" text-anchor="middle">${pp(v, dec(step))}</text>`;
    box.innerHTML = `<svg viewBox="0 0 ${Wd} ${top.length * rowH + 16}">${g}</svg>`;
  }

  // ================================================================ update loop
  let PATH = null;
  function ghostPath() {                                          // the step bar's ghosts: the advice now, then their likeliest bans until your next turn
    const bans = st.bans.slice(), out = [];
    if (ourTurn() && R8) { const sg = suggested(); if (sg) bans.push(...sg.hs); } else if (T8) { const h = argsort(T8.pe, T8.cands)[0]; out.push({ e: bans.length, h, p: T8.pe[h], us: false }); bans.push(h); }
    for (let e = bans.length; e < 6 && !ours(e); e++) { const s = lobby(bans), L = E.legal(s), p = E.banProbs(s, e, L); let h = -1; for (let k = 0; k < H; k++) if (L[k] && (h < 0 || p[k] > p[h])) h = k; out.push({ e, h, p: p[h], us: false }); bans.push(h); }
    return out;
  }
  const busy = on => { document.body.classList.toggle("computing", on); if (!on) $("busyT").textContent = ""; };
  function refresh() { renderSteps(); paintBoard(); renderCall(); if (simReady()) drawCloudFrom({ vals: SIM.vals }); renderChapters(); }
  let pending = 0;
  function update(recompute = true) {
    writeHash(); syncControls(); renderPipe();
    if (!recompute && (R8 || T8 || nextBan() >= 6)) { afterModel(); refresh(); return; }
    busy(true); const my = ++pending;
    setTimeout(() => {
      if (my !== pending) return;
      if (boardBand !== E.band(META.tiers[st.tier])) { buildBoard(); boardBand = E.band(META.tiers[st.tier]); }
      const s = lobby(), e = nextBan();
      R8 = P8 = T8 = BEH = null; PATH = null; SIM = SIMP = null; SHIFTC.clear();
      if (e < 6 && ourTurn()) {
        R8 = E.ourTurn(s);
        if (turnCount() === 2 && R8) { const SQ = E.sequence(s, R8), P = E.pairs(s, R8, 6) || []; P8 = SQ ? E.onAdviceScale([SQ].concat(P.filter(p => !(p.a === SQ.a && p.b === SQ.b))), SQ) : P; }
      } else if (e < 6) T8 = E.theirTurn(s);
      const w = E.winNow(s), wb = E.winNow(s, "behaviour"); WIN = w ? { opt: w[0], beh: e < 6 && wb ? wb[0] : null } : null;
      PATH = e < 6 ? ghostPath() : null;
      ensurePool(running());
      if (!OPN || OPN.key !== lobbyKey()) OPN = null;
      afterModel(); refresh();
    }, 15);
  }
  function afterModel() {                                        // start what runs in the background for this lobby and model
    if (st.model === "sim" && ourTurn() && st.active.kind === "ban" && R8) {
      if (!(SIM && SIM.key === lobbyKey() && SIM.want === st.runs && !SIM.failed)) { busy(true); $("busyT").textContent = "simulating 0%"; startSim(); }
      if (!BEH && turnCount() === 1) {                            // the networks' typical-play values, for the comparison with the simulator
        const s = lobby(), Vv = E.studentChildren(s, nextBan(), R8.cands, true);
        if (Vv) { let b = 0; for (const h of R8.cands) b += R8.pe[h] * Vv.beh[h]; const V = new Float64Array(H).fill(NaN); for (const h of R8.cands) V[h] = Vv.beh[h] - b; BEH = { V }; }
      }
    } else if (!OPN) startOpens();                               // in simulator mode on your turn the run itself records who opens what
    if (!(st.model === "sim" && ourTurn() && st.active.kind === "ban")) busy(false);
  }
  if (!REDUCED) $("word").querySelectorAll("span").forEach((s, i) => s.animate([{ transform: "translateY(40%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 700, delay: 80 * i, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" }));
  update();
})().catch(e => {                                          // a bad or partial release: no answer rather than a made-up one
  console.error(e); const c = document.getElementById("call");
  if (c) c.innerHTML = `<p class="q">The model failed to load (${String(e && e.message || e).replace(/[<>&"]/g, "")}). No answer is shown. Reload the page to try again.</p>`;
});
