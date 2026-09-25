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

  // ---------------------------------------------------------------- load
  const t0 = performance.now();
  const [META, W, PORT] = await Promise.all([
    fetch("model/meta.json").then(r => r.json()), fetch("model/weights.bin").then(r => r.arrayBuffer()), fetch("model/portraits.json").then(r => r.json())]);
  const E = new BanEngine(META, W), H = META.heroes.length, ORDER = META.ban_order, NAMES = META.heroes;
  const img = h => `img/heroes/${PORT[NAMES[h]]}.webp`, short = h => SHORT[NAMES[h]] || NAMES[h];
  const MAPS = META.maps.map((m, i) => ({ i, name: m.name })).sort((a, b) => a.name.localeCompare(b.name));
  const TIERS = Object.keys(META.tiers);

  // ---------------------------------------------------------------- state (mirrored in the URL hash, so a lobby can be shared)
  const st = { tier: "Grandmaster 3", map: MAPS.find(m => /Klyntar · Dom/.test(m.name)) ? MAPS.find(m => /Klyntar · Dom/.test(m.name)).i : 0,
               first: true, team: [-1, -1, -1, -1, -1, -1], bans: [], active: { kind: "team", i: 0 } };
  function readHash() {
    const q = new URLSearchParams(location.hash.slice(1)); if (!q.has("m")) return;
    if (q.get("t") && META.tiers[q.get("t")]) st.tier = q.get("t");
    st.map = Math.max(0, Math.min(META.maps.length - 1, +q.get("m") || 0)); st.first = q.get("f") !== "0";
    const tm = (q.get("u") || "").split(",").map(x => (x === "" || x === "-") ? -1 : +x); for (let i = 0; i < 6; i++) st.team[i] = Number.isInteger(tm[i]) && tm[i] >= 0 && tm[i] < H ? tm[i] : -1;
    st.bans = (q.get("b") || "").split(",").filter(x => x !== "").map(Number).filter(h => h >= 0 && h < H).slice(0, 6);
    st.active = st.team[0] < 0 ? { kind: "team", i: 0 } : { kind: "ban" };
  }
  function writeHash() {
    const q = new URLSearchParams({ t: st.tier, m: st.map, f: st.first ? 1 : 0, u: st.team.map(h => h < 0 ? "-" : h).join(","), b: st.bans.join(",") });
    lastHash = "#" + q.toString(); history.replaceState(null, "", lastHash);
  }
  let lastHash = "";
  readHash();
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
  $("secondBtn").onclick = () => { st.first = false; update(); };
  $("resetBtn").onclick = () => { st.team = [-1, -1, -1, -1, -1, -1]; st.bans = []; st.active = { kind: "team", i: 0 }; $("search").value = ""; update(); };
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
      st.team[a.i] = h;
      const nxt = st.team.findIndex((x, i) => x < 0 && i > a.i);   // next empty teammate slot, else the ban phase
      st.active = nxt >= 0 ? { kind: "team", i: nxt } : { kind: "ban" };
    } else {
      if (nextBan() >= 6 || st.bans.includes(h)) return;
      for (let i = 0; i < 6; i++) if (st.team[i] === h) st.team[i] = -1;    // a banned hover is gone
      st.bans.push(h);
    }
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
        <div class="lab">${i === 0 ? "You" : "Mate " + (i + 1)}${h >= 0 ? " · " + esc(short(h)) : ""}</div></div>`;
    }).join("");
    $("teamSlots").querySelectorAll(".slot").forEach(el => el.onclick = ev => {
      const i = +el.dataset.i;
      if (ev.target.dataset.clear !== undefined) { st.team[i] = -1; st.active = { kind: "team", i }; }
      else st.active = { kind: "team", i };
      update(false);
    });
  }
  function renderBans() {
    const e = nextBan(), cnt = turnCount();
    const sug = ourTurn() && RES ? topBans(cnt) : [];
    $("banSlots").innerHTML = [0, 1, 2, 3, 4, 5].map(i => {
      const h = st.bans[i], side = ours(i) ? "us" : "them", isNext = i === e && st.active.kind === "ban";
      const s = h === undefined && i >= e && i < e + sug.length && ours(i) ? sug[i - e] : undefined;
      const pic = h !== undefined ? `<img src="${img(h)}" alt="${esc(NAMES[h])}"><span class="x">✕</span>`
                : s !== undefined ? `<img src="${img(s)}" alt="suggested ${esc(NAMES[s])}">` : (i + 1);
      const lab = h !== undefined ? esc(short(h)) : s !== undefined ? "suggested" : "";
      return `<div class="slot ${side}${h === undefined ? " empty" : ""}${isNext ? " active" : ""}${s !== undefined ? " sug" : ""}" data-i="${i}"
        title="${h !== undefined ? "click to undo this ban and the ones after it" : s !== undefined ? "click to ban " + esc(NAMES[s]) : "click, then pick the banned hero"}">
        <div class="who">${i + 1} · ${side.toUpperCase()}</div><div class="pic">${pic}</div><div class="lab">${lab || "&nbsp;"}</div></div>`;
    }).join("");
    $("banSlots").querySelectorAll(".slot").forEach(el => el.onclick = () => {
      const i = +el.dataset.i;
      if (i < st.bans.length) { st.bans = st.bans.slice(0, i); st.active = { kind: "ban" }; }
      else if (el.classList.contains("sug")) { const s = topBans(turnCount())[i - nextBan()]; st.active = { kind: "ban" }; if (i === nextBan()) return place(s); }
      else st.active = { kind: "ban" };
      update();
    });
  }
  function renderTurnHint() {
    const e = nextBan(), a = st.active;
    const dest = a.kind === "team" ? `<b>${a.i === 0 ? "You" : "Mate " + (a.i + 1)}</b> (click the ban phase to enter bans instead)`
               : e < 6 ? `<b>ban #${e + 1}</b> (${ours(e) ? "us" : "them"})` : "nowhere (ban phase complete)";
    $("target").innerHTML = "Next pick goes to " + dest + ".";
    $("turnHint").innerHTML = e >= 6 ? "Ban phase complete." :
      ourTurn() ? `Next: <span class="sideB">our ban #${e + 1}</span>${turnCount() === 2 ? ` and #${e + 2}` : ""}. Suggestions show dashed; click one to use it.`
                : `Next: <span class="sideR">their ban #${e + 1}</span>. Pick the hero they ban.`;
  }
  function renderRoster() {
    const q = $("search").value.trim().toLowerCase(), bans = bannedSet(), team = teamSet();
    const rank = new Map(); if (ourTurn() && RES) topBans(3).forEach((h, k) => rank.set(h, k + 1));
    $("roster").innerHTML = [0, 1, 2].map(r => {
      const hs = NAMES.map((n, h) => h).filter(h => META.roles[h] === r).sort((a, b) => NAMES[a].localeCompare(NAMES[b]));
      return `<h3>${ROLE_NAMES[r]}</h3><div class="grid">` + hs.map(h => {
        const cls = ["tile"]; if (bans.has(h)) cls.push("banned"); if (team.has(h)) cls.push("ours");
        if (q && !NAMES[h].toLowerCase().includes(q) && !short(h).toLowerCase().includes(q)) cls.push("dim");
        return `<div class="${cls.join(" ")}" data-h="${h}" title="${esc(NAMES[h])}">${rank.has(h) ? `<span class="rk">${rank.get(h)}</span>` : ""}<img src="${img(h)}" alt="" loading="lazy"><span class="nm">${esc(short(h))}</span></div>`;
      }).join("") + "</div>";
    }).join("");
    $("roster").querySelectorAll(".tile").forEach(el => el.onclick = () => { if (!el.classList.contains("banned")) place(+el.dataset.h); });
  }
  const searchMatches = () => { const q = $("search").value.trim().toLowerCase(); if (!q) return [];
    const b = bannedSet(); return NAMES.map((n, h) => h).filter(h => !b.has(h) && (NAMES[h].toLowerCase().includes(q) || short(h).toLowerCase().includes(q)))
      .sort((a, b2) => ((NAMES[a].toLowerCase().startsWith(q) ? 0 : 1) - (NAMES[b2].toLowerCase().startsWith(q) ? 0 : 1)) || NAMES[a].length - NAMES[b2].length); };
  function renderMatches() {
    const m = searchMatches().slice(0, 4);
    $("matches").innerHTML = m.length ? "Enter → " + m.map((h, k) => `<a href="#" data-h="${h}"${k ? "" : " style=\"font-weight:600\""}>${esc(NAMES[h])}</a>`).join(", ") : "";
    $("matches").querySelectorAll("a").forEach(el => el.onclick = ev => { ev.preventDefault(); place(+el.dataset.h); });
  }
  $("search").oninput = () => { renderRoster(); renderMatches(); };
  $("search").onkeydown = ev => {
    if (ev.key === "Enter") { const m = searchMatches(); if (m.length) place(m[0]); ev.preventDefault(); }
    else if (ev.key === "Backspace" && !$("search").value && st.bans.length) { st.bans.pop(); update(); ev.preventDefault(); }
    else if (ev.key === "Escape") { $("search").value = ""; renderRoster(); }
  };
  document.addEventListener("keydown", ev => {
    if (ev.target.tagName === "INPUT" || ev.target.tagName === "SELECT" || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.key.length === 1 && /[a-z&]/i.test(ev.key)) { $("search").focus(); }
    else if (ev.key === "Backspace" && st.bans.length) { st.bans.pop(); update(); ev.preventDefault(); }
  });

  // ---------------------------------------------------------------- figures (inline SVG, drawn from the model output)
  function valueChart(rows) {                          // rows: {h, v, se}
    const W = 600, L = 118, R = 64, rowH = 18, top = 16, hgt = top + rows.length * rowH + 22;
    let lo = Math.min(0, ...rows.map(r => r.v - 2 * r.se)), hi = Math.max(0, ...rows.map(r => r.v + 2 * r.se)); const pad = (hi - lo) * .04; lo -= pad; hi += pad;
    const X = v => L + (v - lo) / (hi - lo) * (W - L - R);
    const step = niceStep(hi - lo); let g = "";
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-12; t += step) g += `<line class="grid" x1="${X(t)}" x2="${X(t)}" y1="${top - 4}" y2="${hgt - 20}"/><text x="${X(t)}" y="${hgt - 6}" font-size="10" text-anchor="middle" class="faint">${pp(t, 1)}</text>`;
    const bars = rows.map((r, k) => {
      const y = top + k * rowH, x0 = X(Math.min(0, r.v)), x1 = X(Math.max(0, r.v));
      return `<text x="${L - 6}" y="${y + 12}" font-size="11.5" text-anchor="end">${esc(NAMES[r.h])}</text>
        <rect x="${x0}" y="${y + 4}" width="${Math.max(1, x1 - x0)}" height="10" class="${r.v >= 0 ? "us" : "them"}" opacity="${k < 2 ? 1 : .55}"/>
        <line class="whisk" x1="${X(r.v - 1.96 * r.se)}" x2="${X(r.v + 1.96 * r.se)}" y1="${y + 9}" y2="${y + 9}"/>
        <text x="${W - R + 6}" y="${y + 12}" font-size="11">${pp(r.v)}</text>`;
    }).join("");
    return `<svg viewBox="0 0 ${W} ${hgt}" width="${W}">${g}<line class="axis" x1="${X(0)}" x2="${X(0)}" y1="${top - 4}" y2="${hgt - 20}"/>${bars}</svg>`;
  }
  function probChart(rows, cls, W = 290) {             // rows: {h, p}
    const L = 96, R = 34, rowH = 16, hgt = rows.length * rowH + 4, mx = Math.max(.05, ...rows.map(r => r.p));
    return `<svg viewBox="0 0 ${W} ${hgt}" width="${W}">` + rows.map((r, k) => {
      const y = k * rowH, w = r.p / mx * (W - L - R);
      return `<text x="${L - 5}" y="${y + 12}" font-size="11" text-anchor="end">${esc(short(r.h))}</text><rect x="${L}" y="${y + 3}" width="${w}" height="10" class="${cls}"/>
        <text x="${L + w + 4}" y="${y + 12}" font-size="10.5" class="faint">${pct(r.p)}</text>`;
    }).join("") + "</svg>";
  }
  function niceStep(span) { const raw = span / 5, p = Math.pow(10, Math.floor(Math.log10(raw))); const f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }

  // ---------------------------------------------------------------- advice
  function topBans(k) {
    const V = RES.V; return Array.from(V.keys()).filter(h => !isNaN(V[h])).sort((a, b) => V[b] - V[a]).slice(0, k);
  }
  function renderAdvice() {
    const e = nextBan(), R = RES; let html = "";
    if (e >= 6) html += `<h2>Ban phase complete</h2><p class="small">All six bans are in. The charts below show what each team is now likely to open.</p>`;
    else if (ourTurn()) {
      const cnt = turnCount(), top = topBans(15), best = top.slice(0, cnt);
      html += `<h2>Your ban #${e + 1}${cnt === 2 ? ` and #${e + 2}` : ""}</h2>`;
      html += `<p class="big">Ban ${best.map(h => `<b>${esc(NAMES[h])}</b>`).join(" and ")}
        <span class="small">&nbsp;${best.map(h => `${pp(R.V[h])} ± ${(196 * R.se[h]).toFixed(2)}`).join(", ")} win-probability points${cnt === 2 ? " (values add to first order)" : ""}</span></p>`;
      html += `<figure>${valueChart(top.slice(0, 12).map(h => ({ h, v: R.V[h], se: R.se[h] })))}
        <figcaption>Figure 1. Value of each candidate ban: the change in your team's win probability, in points, against not banning it.
        Whiskers are 95% intervals from the model ensemble and the bootstrap of removal costs. Red bars would help the other team.</figcaption></figure>`;
      html += `<div style="overflow-x:auto"><table><tr><th>#</th><th></th><th>Ban</th><th class="r">Value</th><th></th><th class="r">They open</th><th class="r">You open</th>
        <th class="r">Cost to lose</th><th class="r">Goes later</th><th class="r">Their reply</th></tr>` +
        top.map((h, k) => `<tr class="pick" data-h="${h}" title="click to ban ${esc(NAMES[h])}"><td class="num">${k + 1}</td><td><img class="mini" src="${img(h)}" alt=""></td><td>${esc(NAMES[h])}</td>
          <td class="r">${pp(R.V[h])}</td><td><span class="bar" style="width:${Math.max(0, R.V[h]) / Math.max(1e-9, R.V[top[0]]) * 60}px"></span></td>
          <td class="r">${pct(R.Pt[h])}</td><td class="r">${pct(R.Pu[h])}</td><td class="r">${(100 * R.R[h]).toFixed(1)}</td><td class="r">${pct(R.PL[h])}</td>
          <td class="r">${pp(R.reply[h])}</td></tr>`).join("") + `</table></div>
        <p class="small">They open / you open: chance each team opens the hero if it stays available. Cost to lose: points the team that would open it loses when it can't
        (averaged over the real players who open it at your rank, adjusted for the heroes your team shows). Goes later: chance it is banned later anyway.
        Their reply: value of how your ban changes the other team's remaining bans. Click a row to ban it.</p>`;
      const h = best[0], later = 1 - R.PL[h];
      html += `<h2>How the top ban is valued</h2><table class="eq">
        <tr><td>They open ${esc(short(h))}</td><td class="r">${pct(R.Pt[h])}</td><td class="op">×</td><td>cost to them</td><td class="r">${(100 * R.R[h]).toFixed(2)}</td><td class="op">=</td><td class="r">${pp(R.Pt[h] * R.R[h])}</td></tr>
        <tr><td>You open ${esc(short(h))}</td><td class="r">${pct(R.Pu[h])}</td><td class="op">×</td><td>cost to you</td><td class="r">${(100 * R.Rus[h]).toFixed(2)}</td><td class="op">=</td><td class="r">${pp(-R.Pu[h] * R.Rus[h])}</td></tr>
        <tr><td>Not banned later anyway</td><td class="r">${pct(later)}</td><td class="op">×</td><td>net</td><td></td><td class="op">=</td><td class="r">${pp(R.first[h])}</td></tr>
        <tr><td>Their reply</td><td></td><td></td><td></td><td></td><td class="op">+</td><td class="r">${pp(R.reply[h])}</td></tr>
        <tr><td><b>Value</b></td><td></td><td></td><td></td><td></td><td class="op">=</td><td class="r"><b>${pp(R.V[h])}</b></td></tr></table>
        <p class="small">Points of win probability. The first-order line uses the ensemble average, so its product can differ slightly from the rows above.</p>`;
    } else {
      const top = Array.from(THEIRS.keys()).filter(h => THEIRS[h] > 0).sort((a, b) => THEIRS[b] - THEIRS[a]).slice(0, 10);
      html += `<h2>Their ban #${e + 1}</h2><p class="big">Most likely: ${top.slice(0, 3).map(h => `<b>${esc(NAMES[h])}</b> ${pct(THEIRS[h])}`).join(", ")}</p>
        <figure>${probChart(top.map(h => ({ h, p: THEIRS[h] })), "them", 420)}<figcaption>Figure 1. What a typical team in their position bans next
        (ban model: map, rank, ban order, what the team plays, what it fears, and the bans so far). Enter what they actually ban in the ban phase.</figcaption></figure>`;
    }
    const bans = bannedSet(), revs = teamSet();
    const them = Array.from(R.Pt.keys()).filter(h => !bans.has(h)).sort((a, b) => R.Pt[b] - R.Pt[a]).slice(0, 10);
    const us = Array.from(R.Pu.keys()).filter(h => !bans.has(h) && !revs.has(h)).sort((a, b) => R.Pu[b] - R.Pu[a]).slice(0, 10);
    html += `<h2>What the lobby tells us</h2><div class="cols">
      <figure>${probChart(them.map(h => ({ h, p: R.Pt[h] })), "them")}<figcaption>Figure 2. Heroes the other team is likely to open, given the bans so far.
      Teams protect their own heroes and ban what beats them, so their bans shift this.</figcaption></figure>
      <figure>${probChart(us.map(h => ({ h, p: R.Pu[h] })), "us")}<figcaption>Figure 3. Heroes your team is likely to fill in around the heroes shown.</figcaption></figure></div>`;
    $("adviceBody").innerHTML = html;
    $("adviceBody").querySelectorAll("tr.pick").forEach(el => el.onclick = () => { st.active = { kind: "ban" }; place(+el.dataset.h); });
  }

  // ---------------------------------------------------------------- update loop
  let pending = 0;
  function update(recompute = true) {
    writeHash();
    $("firstBtn").classList.toggle("on", st.first); $("secondBtn").classList.toggle("on", !st.first);
    $("tierSel").value = st.tier; $("mapSel").value = String(st.map);
    if (st.active.kind === "ban" && nextBan() >= 6) st.active = { kind: "ban" };
    renderTeam(); renderTurnHint();
    if (!recompute && RES) { renderBans(); renderRoster(); return; }
    $("mainEl").classList.add("busy"); const my = ++pending;
    setTimeout(() => {
      if (my !== pending) return;
      const s = { firstUs: st.first, bans: st.bans.slice(), rev: st.team.filter(h => h >= 0), m: st.map, r0: META.tiers[st.tier], cnt: turnCount() };
      RES = E.values(s); THEIRS = !ourTurn() && nextBan() < 6 ? E.theirNextBan(s) : null;
      renderBans(); renderRoster(); renderAdvice(); $("mainEl").classList.remove("busy");
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
      const W = 300, L = 92, rowH = 13, top = 18, hgt = top + rows.length * rowH + 22, X = v => L + (v - lo) / (hi - lo) * (W - L - 10);
      let g = `<text x="${L}" y="11" font-size="11.5" font-weight="600">${ROLE_NAMES[r]}</text>`;
      for (let t = Math.ceil(lo * 50) / 50; t <= hi; t += .02) g += `<line class="grid" x1="${X(t)}" x2="${X(t)}" y1="${top - 3}" y2="${hgt - 20}"/><text x="${X(t)}" y="${hgt - 7}" font-size="9.5" text-anchor="middle" class="faint">${(100 * t).toFixed(0)}</text>`;
      g += `<line class="axis" x1="${X(0)}" x2="${X(0)}" y1="${top - 3}" y2="${hgt - 20}"/>`;
      rows.forEach((x, k) => { const y = top + k * rowH + 6; g += `<text x="${L - 5}" y="${y + 3.5}" font-size="10.5" text-anchor="end">${esc(short(x.h))}</text><g style="color:var(--ink)">${x.c.map((c, b) => mark(b, X(c), y)).join("")}</g>`; });
      return `<svg viewBox="0 0 ${W} ${hgt}" width="${W}">${g}</svg>`;
    };
    const lg = bandLab.map((b, k) => `<svg width="10" height="10" style="display:inline;vertical-align:-1px"><g style="color:var(--ink)">${mark(k, 5, 5)}</g></svg> ${b}`).join(" &nbsp; ");
    const L_ = v.lineup;
    $("method").innerHTML = `<h2>Method</h2>
      <p>In ranked you rarely know who the other team is. A ban works by taking a hero away from both teams, so what matters is how likely each team is to open it,
      how much losing it costs whoever would have played it, and whether it would have been banned anyway. For every legal ban <i>x</i>, the value in win probability is</p>
      <p class="formula">V(<i>x</i>) = (1 − <i>P</i><sub>later</sub>(<i>x</i>)) · [ <i>P</i><sub>them</sub>(<i>x</i>) · <i>R</i><sub>them</sub>(<i>x</i>) − <i>P</i><sub>us</sub>(<i>x</i>) · <i>R</i><sub>us</sub>(<i>x</i>) ] + reply(<i>x</i>)</p>
      <ul>
        <li><b><i>P</i><sub>them</sub>, <i>P</i><sub>us</sub></b>: a masked team-lineup network (two hidden layers of 512, an ensemble of four) that sees only what a lobby shows: the bans so far and who made them,
          the heroes your team shows, map, rank and side. It was trained on 243k Season 10 matches with random parts of each team hidden.</li>
        <li><b><i>R</i></b>: the cost of losing a hero, computed with a fitted outcome model on 1.8 million real opening picks. Each player is moved to their next choice (from a pick model) and the change
          in the team's win probability is recorded. That includes the hero, map, side, rank, compositions, teammates and matchups, and the player's familiarity with both heroes.
          A player knocked off a hero they rely on loses far more than one with a wide pool: in the raw data, a team whose one-trick loses their main to a ban wins 7.5 points less often.</li>
        <li><b><i>P</i><sub>later</sub> and the reply</b>: a ban model fitted on every Season 10 ban. Teams avoid banning their own players' heroes, ban heroes that beat what they play, and react to earlier bans.
          It gives the chance a hero goes later anyway, and how your ban changes theirs.</li>
      </ul>
      <figure><div class="cols">${[0, 1, 2].map(panel).join("")}</div>
        <figcaption>Figure 4. Cost to a team of losing each hero, in win-probability points, by average lobby rank (${lg}). Averaged over maps.
        Negative values: the team does better on its next choice, so banning that hero helps whoever planned to play it.</figcaption></figure>
      <h2>How well it holds up</h2>
      <table><tr><th>Check, on 27,016 later matches the model never saw</th><th class="r">Result</th></tr>
        <tr><td>Predicting the other team's heroes before any ban (cross-entropy; popularity baseline ${L_["0"].bce_popularity.toFixed(4)})</td><td class="r">${L_["0"].bce_model.toFixed(4)}</td></tr>
        <tr><td>&hellip; after three bans / after all six</td><td class="r">${L_["3"].bce_model.toFixed(4)} / ${L_["6"].bce_model.toFixed(4)}</td></tr>
        <tr><td>Share of the other team's six heroes in the model's top six guesses, after all six bans</td><td class="r">${pct(L_["6"].top6_recall)}</td></tr>
        <tr><td>Win probability a typical team's three bans leave on the table, by the model's own values</td><td class="r">${v.bans.mean_regret_pp.toFixed(2)} pts</td></tr>
        <tr><td>Do teams whose real bans scored higher win more? Slope of winning on ban value (1 = right size)</td><td class="r">${v.bans.slope.toFixed(2)} ± ${(1.96 * v.bans.slope_se).toFixed(2)}</td></tr></table>
      <p class="small">The last line is inconclusive: real teams' bans differ by fractions of a point, and 27k coin-flip outcomes can only detect a slope of about ±${v.bans.detectable_slope_80pct.toFixed(1)}.
      Each piece of the model is checked separately instead. Bans reveal only a little about a team you can't see; your teammates' hovers reveal much more. The whole lever is about
      one point of win probability per game, so treat the ranking as a well-informed nudge, not a guarantee.</p>
      <h2>Limits</h2>
      <ul class="small">
        <li>Fitted on PC ranked Season 10 matches from 11 to 21 September 2026, mostly Diamond to Celestial. Few lobbies average above 5,000.</li>
        <li>Ranks map to scores at about 100 points per division (Grandmaster 3 ≈ 4,550). The exact tier boundaries are approximate.</li>
        <li>Hovers are not in the data. The model treats a shown hero as that player's likely pick and assumes a hover sticks about four times in five.</li>
        <li>Every other player is anonymous: the values average over the real players who play at your rank, not the people in your lobby.</li>
        <li>Values are first order. A ban that reshapes a whole composition is only approximated, and on a two-ban turn the two values are simply added.</li>
      </ul>`;
  }

  $("status").textContent = `Ban value model (${META.source.replace(/^ban_value_model_|\.json$/g, "")}) · 56 heroes, 16 maps · lineup networks ×${META.weights.models.length} ·
    loaded in ${Math.round(performance.now() - t0)} ms · runs entirely in your browser`;
  renderMethod(); update();
})();
