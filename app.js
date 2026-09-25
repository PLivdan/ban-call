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
  const E = new BanEngine(META, W), H = META.heroes.length, ORDER = META.ban_order, NAMES = META.heroes;
  const img = h => `img/heroes/${PORT[NAMES[h]]}.webp`, short = h => NAMES[h];
  const mapName = s => s.includes(" · ") ? s.replace(" · ", " (") + ")" : s;
  const MAPS = META.maps.map((m, i) => ({ i, name: mapName(m.name) })).sort((a, b) => a.name.localeCompare(b.name));
  const TIERS = Object.keys(META.tiers);

  // ---------------------------------------------------------------- state (mirrored in the URL hash, so a lobby can be shared)
  const st = { tier: "Grandmaster 3", map: MAPS.find(m => /Klyntar \(Dom/.test(m.name)) ? MAPS.find(m => /Klyntar \(Dom/.test(m.name)).i : 0,
               first: true, team: [-1, -1, -1, -1, -1, -1], bans: [], active: { kind: "team", i: 0 }, model: "value" };
  function readHash() {
    const q = new URLSearchParams(location.hash.slice(1)); if (!q.has("m")) return;
    if (q.get("t") && META.tiers[q.get("t")]) st.tier = q.get("t");
    st.map = Math.max(0, Math.min(META.maps.length - 1, +q.get("m") || 0)); st.first = q.get("f") !== "0"; st.model = q.get("x") === "1" ? "sim" : "value";
    const tm = (q.get("u") || "").split(",").map(x => (x === "" || x === "-") ? -1 : +x); for (let i = 0; i < 6; i++) st.team[i] = Number.isInteger(tm[i]) && tm[i] >= 0 && tm[i] < H ? tm[i] : -1;
    st.bans = (q.get("b") || "").split(",").filter(x => x !== "").map(Number).filter(h => h >= 0 && h < H).slice(0, 6);
    st.active = st.team[0] < 0 ? { kind: "team", i: 0 } : { kind: "ban" };
  }
  function writeHash() {
    const q = new URLSearchParams({ t: st.tier, m: st.map, f: st.first ? 1 : 0, x: st.model === "sim" ? 1 : 0, u: st.team.map(h => h < 0 ? "-" : h).join(","), b: st.bans.join(",") });
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
  $("valueBtn").onclick = () => { st.model = "value"; update(); };
  $("simBtn").onclick = () => { st.model = "sim"; update(); };
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
        <div class="lab">${i === 0 ? "You" : "Mate " + (i + 1)}</div><div class="lab">${h >= 0 ? esc(short(h)) : "&nbsp;"}</div></div>`;
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
      const lab = h !== undefined ? esc(short(h)) : s !== undefined ? `<i>${esc(short(s))}?</i>` : "";
      return `<div class="slot ${side}${h === undefined ? " empty" : ""}${isNext ? " active" : ""}${s !== undefined ? " sug" : ""}" data-i="${i}"
        title="${h !== undefined ? "click to undo this ban and the ones after it" : s !== undefined ? "click to ban " + esc(NAMES[s]) : "click, then pick the banned hero"}">
        <div class="who">${i + 1} ${side}</div><div class="pic">${pic}</div><div class="lab">${lab || "&nbsp;"}</div></div>`;
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
      ourTurn() ? `Next: <span class="sideB">our ban #${e + 1}</span>${turnCount() === 2 ? ` and #${e + 2}` : ""}. The dashed portrait is the suggestion. Click it to use it.`
                : `Next: <span class="sideR">their ban #${e + 1}</span>. Pick the hero they ban.`;
  }
  function renderRoster() {
    const q = $("search").value.trim().toLowerCase(), bans = bannedSet(), team = teamSet();
    const rank = new Map(); if (ourTurn() && RES) topBans(3).forEach((h, k) => rank.set(h, k + 1));
    $("roster").innerHTML = [0, 1, 2].map(r => {
      const hs = NAMES.map((n, h) => h).filter(h => META.roles[h] === r).sort((a, b) => NAMES[a].localeCompare(NAMES[b]));
      return `<h3>${ROLE_NAMES[r]}</h3><div class="grid">` + hs.map(h => {
        const cls = ["tile"]; if (bans.has(h)) cls.push("banned"); if (team.has(h)) cls.push("ours");
        if (q && !NAMES[h].toLowerCase().includes(q) && !(SHORT[NAMES[h]] || "").toLowerCase().includes(q)) cls.push("dim");
        return `<div class="${cls.join(" ")}" data-h="${h}" title="${esc(NAMES[h])}">${rank.has(h) ? `<span class="rk">${rank.get(h)}</span>` : ""}<img src="${img(h)}" alt="" loading="lazy"><span class="nm">${esc(short(h))}</span></div>`;
      }).join("") + "</div>";
    }).join("");
    $("roster").querySelectorAll(".tile").forEach(el => el.onclick = () => { if (!el.classList.contains("banned")) place(+el.dataset.h); });
  }
  const searchMatches = () => { const q = $("search").value.trim().toLowerCase(); if (!q) return [];
    const b = bannedSet(); return NAMES.map((n, h) => h).filter(h => !b.has(h) && (NAMES[h].toLowerCase().includes(q) || (SHORT[NAMES[h]] || "").toLowerCase().includes(q)))
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
  function rankTable(top, V, se, cols, cap) {        // the ranking: one row per ban, with its 95% interval drawn in the row
    const lo = Math.min(0, ...top.map(h => V[h] - 1.96 * se[h])), hi = Math.max(0, ...top.map(h => V[h] + 1.96 * se[h])), CW = 190, X = v => 6 + (v - lo) / (hi - lo || 1) * (CW - 12);
    const step = niceStep(hi - lo, 3); let ticks = "";
    for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-12; t += step) ticks += `<text x="${X(t)}" y="10" font-size="10" text-anchor="middle" class="faint">${pp(t, step < .005 ? 2 : 1)}</text>`;
    const cell = h => { const neg = V[h] < 0;
      return `<svg width="${CW}" height="16" viewBox="0 0 ${CW} 16" style="display:inline-block;vertical-align:middle"><line class="grid" x1="${X(0)}" x2="${X(0)}" y1="0" y2="16"/>
        <line class="whisk" x1="${X(V[h] - 1.96 * se[h])}" x2="${X(V[h] + 1.96 * se[h])}" y1="8" y2="8"/><circle cx="${X(V[h])}" cy="8" r="3.6" class="${neg ? "them" : "us"}"/></svg>`; };
    return `<div style="overflow-x:auto"><table><caption>${cap}</caption>
      <tr><th>#</th><th></th><th>Ban</th><th class="r">Value</th><th><svg width="${CW}" height="13" viewBox="0 0 ${CW} 13" style="display:block">${ticks}</svg></th>${cols.map(c => `<th${c.r === false ? "" : ' class="r"'}>${c.th}</th>`).join("")}</tr>` +
      top.map((h, k) => `<tr class="pick" data-h="${h}" title="${esc(NAMES[h])}: ${pp(V[h])} ± ${(196 * se[h]).toFixed(2)} points. Click to ban."><td class="num">${k + 1}</td><td><img class="mini" src="${img(h)}" alt=""></td>
        <td>${esc(NAMES[h])}</td><td class="r">${pp(V[h])}</td><td>${cell(h)}</td>${cols.map(c => `<td${c.r === false ? "" : ' class="r"'}>${c.td(h)}</td>`).join("")}</tr>`).join("") + `</table></div>`;
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
    const rows = top.map(h => { const l = 1 - R.PL[h]; return { h, d: l * R.Pt[h] * R.R[h], s: -l * R.Pu[h] * R.Rus[h], r: R.reply[h] }; });
    const pos = r => Math.max(r.d, 0) + Math.max(r.s, 0) + Math.max(r.r, 0), neg = r => Math.min(r.d, 0) + Math.min(r.s, 0) + Math.min(r.r, 0);
    const lo = Math.min(0, ...rows.map(neg)), hi = Math.max(...rows.map(pos)), Lw = labW(rows.map(r => NAMES[r.h]), 11.5) + 10, val = Math.ceil(tw("+0.00", 10.5)) + 8, W = Lw + 330 + val, rowH = 19;
    const X = v => Lw + (v - lo) / (hi - lo || 1) * 330, hgt = rows.length * rowH + 42;
    const seg = (a, v, cls, op) => `<rect x="${X(Math.min(a, a + v))}" y="0" width="${Math.abs(X(a + v) - X(a))}" height="11" class="${cls}" opacity="${op}"/>`;
    let g = rows.map((r, k) => { let p = 0, n = 0; const parts = [];
      for (const [v, cls, op] of [[r.d, "us", 1], [r.r, "us", .45], [r.s, "them", .8]]) { if (v >= 0) { parts.push(seg(p, v, cls, op)); p += v; } else { parts.push(seg(n, v, cls, op)); n += v; } }
      return `<g transform="translate(0 ${k * rowH + 4})"><text x="${Lw - 6}" y="10" font-size="11.5" text-anchor="end">${esc(NAMES[r.h])}</text>${parts.join("")}<text x="${X(p) + 4}" y="10" font-size="10.5" class="faint">${pp(R.V[r.h])}</text></g>`; }).join("");
    const ly = rows.length * rowH + 24, key = [["denies them", "us", 1], ["their reply", "us", .45], ["effect on your team", "them", .8]]; let kx = Lw;
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
  function topBans(k) {
    const V = st.model === "sim" && SIM ? SIM.V : RES.V; if (st.model === "sim" && !SIM) return [];
    return Array.from(V.keys()).filter(h => !isNaN(V[h])).sort((a, b) => V[b] - V[a]).slice(0, k);
  }
  function renderAdvice() {
    const e = nextBan(), R = RES; let html = "", fig = 0;
    const F = () => `Figure ${++fig}.`;
    if (e >= 6) html += `<h2>Ban phase complete</h2><p class="small">All six bans are in. The figure below shows what each team is now likely to open.</p>`;
    else if (ourTurn() && st.model === "sim") html += simAdvice(F);
    else if (ourTurn()) {
      const cnt = turnCount(), top = topBans(15), best = top.slice(0, cnt);
      html += `<h2>Your ban #${e + 1}${cnt === 2 ? ` and #${e + 2}` : ""}</h2>`;
      html += `<p class="big">Ban ${best.map(h => `<b>${esc(NAMES[h])}</b>`).join(" and ")}
        <span class="small">&nbsp;${best.map(h => `${pp(R.V[h])} ± ${(196 * R.se[h]).toFixed(2)}`).join(", ")} points of win probability${cnt === 2 ? " (the two values add)" : ""}</span></p>`;
      html += rankTable(top, R.V, R.se, [
        { th: "They open", td: h => pct(R.Pt[h]) }, { th: "You open", td: h => pct(R.Pu[h]) }, { th: "Cost to lose", td: h => (100 * R.R[h]).toFixed(1) },
        { th: "Banned later", td: h => pct(R.PL[h]) }, { th: "Their reply", td: h => pp(R.reply[h]) }],
        `Table 1. The fifteen best bans. Value: change in your team's win probability, in points, against leaving the hero open. The dot and whisker show the value and its 95% interval
        (from the four networks and the bootstrap of removal costs), so overlapping bans are close to tied.`);
      html += `<p class="small">They open, you open: chance each team opens the hero if it stays available. Cost to lose: points the team that would open it loses without it,
        averaged over real players who open it at your rank and adjusted for the heroes your team shows. Banned later: chance it is banned later anyway.
        Their reply: value of how your ban changes the other team's remaining bans. Click a row to ban it.</p>`;
      const t8 = top.slice(0, 8);
      html += `<h2>${esc(NAMES[best[0]])} leads mostly by ${(1 - R.PL[best[0]]) * R.Pt[best[0]] * R.R[best[0]] >= R.V[best[0]] * .5 ? "denying them" : "protecting your team"}</h2>
        <figure>${splitBars(t8, R)}<figcaption>${F()} Each ban's value split into its parts, in points: what it takes from the other team (their chance of opening the hero times
        what losing it costs them), the change in their remaining bans, and the effect on your team (negative when your team would have played it).
        The first two parts are discounted by the chance the hero is banned later anyway. The parts use the average of the four networks, so they can differ slightly from the value on the right.</figcaption></figure>`;
    } else {
      const top = Array.from(THEIRS.keys()).filter(h => THEIRS[h] > 0).sort((a, b) => THEIRS[b] - THEIRS[a]).slice(0, 10);
      html += `<h2>Their ban #${e + 1}</h2><p class="big">Most likely: ${top.slice(0, 3).map(h => `<b>${esc(NAMES[h])}</b> ${pct(THEIRS[h])}`).join(", ")}</p>
        <figure>${probChart(top.map(h => ({ h, p: THEIRS[h] })), "them", 420)}<figcaption>${F()} What a typical team in their position bans next, from the ban model (map, rank, ban order, the heroes the team plays and fears, and the bans so far).
        Enter what they actually ban in the ban phase.</figcaption></figure>`;
    }
    const bans = bannedSet(), revs = teamSet();
    const them = Array.from(R.Pt.keys()).filter(h => !bans.has(h)).sort((a, b) => R.Pt[b] - R.Pt[a]).slice(0, 10);
    const us = Array.from(R.Pu.keys()).filter(h => !bans.has(h) && !revs.has(h)).sort((a, b) => R.Pu[b] - R.Pu[a]).slice(0, 10);
    html += `<h2>Most likely openers: ${esc(NAMES[them[0]])} for them, ${esc(NAMES[us[0]])} for you</h2>
      <figure>${butterfly(them, us, R.Pt, R.Pu, revs)}<figcaption>${F()} Chance each team opens a hero, given the bans so far and the heroes your team shows.
      The ten likeliest for each team, on one list. Where both bars are long, a ban costs both teams. Teams protect their own heroes and ban what beats them, so their bans shift the left side.</figcaption></figure>`;
    $("adviceBody").innerHTML = html;
    $("adviceBody").querySelectorAll("tr.pick").forEach(el => el.onclick = () => { st.active = { kind: "ban" }; place(+el.dataset.h); });
    const mf = $("methodFig"); if (mf) mf.textContent = `Figure ${fig + 1}.`;
    if (RUN && !RUN.finished && st.model === "sim") progress();
  }

  function simAdvice(F) {
    const e = nextBan(), cnt = turnCount(); let html = `<h2>Your ban #${e + 1}${cnt === 2 ? ` and #${e + 2}` : ""} (re-draft simulator)</h2>`;
    const bar = `<div class="prog"><span id="simProg"></span></div><p class="small" id="simMsg"><span id="simCount"></span></p>`;
    if (!SIM) return html + bar + `<p class="small">Every legal ban gets 6 simulated continuations of the ban phase, each re-drafting 48 of your lineups against 96 of theirs.
      The 12 best then get 10 more.</p>`;
    const S = SIM, top = topBans(15), best = top.slice(0, cnt);
    html += `<p class="big">Ban ${best.map(h => `<b>${esc(NAMES[h])}</b>`).join(" and ")} <span class="small">&nbsp;${best.map(h => `${pp(S.V[h])} ± ${(196 * S.se[h]).toFixed(2)}`).join(", ")} points against a typical ban.
      Your chance of winning after a typical ban: ${(100 * S.base).toFixed(1)}%</span></p>`;
    html += S.prelim ? bar : `<p class="small">${fmt(S.total)} simulated ban phases in ${(S.ms / 1000).toFixed(1)} s on ${pool.length} thread${pool.length > 1 ? "s" : ""}.</p>`;
    const repl = h => { let b = -1, bv = 0; for (let x = 0; x < H; x++) { if (x === h) continue; const d = S.co[h][x] - S.baseCo[x]; if (d > bv) { bv = d; b = x; } } return b < 0 ? "" : `${esc(NAMES[b])} +${(100 * bv).toFixed(0)}`; };
    html += rankTable(top, S.V, S.se, [
      { th: "Win if banned", td: h => (100 * S.win[h]).toFixed(1) + "%" }, { th: "They draft it", td: h => pct(S.baseCo[h]) },
      { th: "They switch to", td: repl, r: false }, { th: "Runs", td: h => S.n[h] }],
      `Table 1. The fifteen best bans by simulation. Value: change in your team's win probability, in points, from banning the hero instead of what a typical team would ban here.
      The dot and whisker show the value and its 95% interval over the simulated continuations, paired so every ban faces the same stand-in players and random draws.`);
    html += `<p class="small">They draft it: share of the other team's simulated drafts that include the hero after a typical ban. They switch to: the hero whose share of their drafts rises most
      when you ban it, in points. Runs: simulated continuations of the ban phase behind the value. Click a row to ban it.</p>`;
    const h = best[0], dO = [], dU = [];
    for (let x = 0; x < H; x++) { dO.push({ h: x, d: S.co[h][x] - S.baseCo[x] }); dU.push({ h: x, d: S.cu[h][x] - S.baseCu[x] }); }
    const big = a => a.filter(r => Math.abs(r.d) >= .005).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 10).sort((a, b) => b.d - a.d);
    const up = big(dO).filter(r => r.d > 0 && r.h !== h).slice(0, 2);
    html += `<h2>Banning ${esc(NAMES[h])}${up.length ? " moves them to " + up.map(r => `${esc(NAMES[r.h])} (+${(100 * r.d).toFixed(0)})`).join(" and ") : ""}</h2><div class="cols">
      ${colFig(shiftChart(big(dO), "them"), `${F()} The other team's simulated drafts: change in the share that include each hero, in points, against a typical ban.`)}
      ${colFig(shiftChart(big(dU), "us"), `${F()} Your team's simulated drafts, the same comparison.`)}</div>`;
    return html;
  }

  // ---------------------------------------------------------------- re-draft simulator: a pool of workers, two stages, a progress bar
  const NW = Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)), TOP2 = 12;
  const L1 = [0, 1, 2, 3, 4, 5], L2 = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15], LB = L1.concat(L2);
  let pool = [], RUN = null, SIM = null, simId = 0;
  function newWorker() { const w = new Worker("sim-worker.js"); w.onmessage = ev => onSim(ev.data); w.onerror = () => simFail(); return w; }
  function ensurePool(fresh) { if (fresh) { pool.forEach(w => w.terminate()); pool = []; } while (pool.length < NW) pool.push(newWorker()); }
  function simFail() { if (!RUN || RUN.finished) return; RUN.finished = true; $("mainEl").classList.remove("busy"); const el = $("simMsg"); if (el) el.textContent = "The simulator could not start in this browser. The ban value model still works."; }
  function send(k, cands, looks, baseLooks) { if (!cands.length && !baseLooks.length) return; RUN.pending++; pool[k].postMessage({ id: RUN.id, st: RUN.st, cands, looks, baseLooks }); }
  function startSim(s) {
    ensurePool(RUN && !RUN.finished);                       // a busy pool would finish stale work first, so start it over
    const prot = new Set(s.hov6.filter(h => h >= 0)), cands = [];
    for (let h = 0; h < H; h++) if (!s.bans.includes(h) && !prot.has(h)) cands.push(h);
    const top2 = Math.min(TOP2, cands.length);
    RUN = { id: ++simId, st: s, cands, top2, ticks: 0, total: LB.length + cands.length * L1.length + top2 * L2.length, pending: 0, stage: 1,
            vals: {}, cs: {}, base: {}, baseCnt: null, t0: performance.now(), finished: false };
    const load = pool.map(() => 0), jobs = pool.map(() => ({ cands: [], base: [] }));
    jobs[0].base = LB; load[0] = LB.length;
    for (const h of cands) { const k = load.indexOf(Math.min(...load)); jobs[k].cands.push(h); load[k] += L1.length; }
    jobs.forEach((j, k) => send(k, j.cands, L1, j.base));
  }
  function onSim(d) {
    const R = RUN; if (!R || d.id !== R.id || R.finished) return;
    if (!d.done) { R.ticks += d.tick || 0; progress(); return; }
    for (const h in d.vals) {
      Object.assign(R.vals[h] || (R.vals[h] = {}), d.vals[h]);
      const c = R.cs[h] || (R.cs[h] = { u: new Float64Array(H), o: new Float64Array(H), n: 0 }), n = Object.keys(d.vals[h]).length;
      for (let x = 0; x < H; x++) { c.u[x] += d.cnt[h].u[x] * n; c.o[x] += d.cnt[h].o[x] * n; } c.n += n;
    }
    if (d.baseCnt) { Object.assign(R.base, d.base); R.baseCnt = d.baseCnt; }
    if (--R.pending > 0) return;
    SIM = summarize(R);
    if (R.stage === 1 && R.top2 > 0) {                      // stage 2: more continuations for the leaders
      R.stage = 2; SIM.prelim = true;
      R.cands.slice().sort((a, b) => SIM.V[b] - SIM.V[a]).slice(0, R.top2).forEach((h, i) => send(i % pool.length, [h], L2, []));
    } else { R.finished = true; SIM.ms = performance.now() - R.t0; $("mainEl").classList.remove("busy"); $("busy").textContent = "computing"; }
    renderBans(); renderRoster(); renderAdvice();
  }
  function progress() {
    const f = Math.min(1, RUN.ticks / RUN.total), el = $("simProg");
    if (el) el.style.width = (100 * f).toFixed(1) + "%";
    const t = $("simCount"); if (t) t.textContent = `${fmt(RUN.ticks)} of ${fmt(RUN.total)} ban phases simulated`;
    $("busy").textContent = `simulating ${Math.round(100 * f)}%`;
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
    return { V, se, win, n, base: bm, co, cu, baseCo: R.baseCnt.o, baseCu: R.baseCnt.u, total: R.total };
  }

  // ---------------------------------------------------------------- update loop
  let pending = 0;
  function update(recompute = true) {
    writeHash();
    $("firstBtn").classList.toggle("on", st.first); $("secondBtn").classList.toggle("on", !st.first);
    $("valueBtn").classList.toggle("on", st.model === "value"); $("simBtn").classList.toggle("on", st.model === "sim");
    $("tierSel").value = st.tier; $("mapSel").value = String(st.map);
    if (st.active.kind === "ban" && nextBan() >= 6) st.active = { kind: "ban" };
    renderTeam(); renderTurnHint();
    if (!recompute && RES) { renderBans(); renderRoster(); return; }
    $("mainEl").classList.add("busy"); const my = ++pending;
    setTimeout(() => {
      if (my !== pending) return;
      const s = { firstUs: st.first, bans: st.bans.slice(), rev: st.team.filter(h => h >= 0), m: st.map, r0: META.tiers[st.tier], cnt: turnCount() };
      RES = E.values(s); THEIRS = !ourTurn() && nextBan() < 6 ? E.theirNextBan(s) : null; SIM = null;
      if (st.model === "sim" && ourTurn()) { $("busy").textContent = "simulating 0%"; startSim(Object.assign({}, s, { hov6: st.team.slice(), cnt: 1 })); }
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
    $("method").innerHTML = `<h2>Method</h2>
      <p>A ban removes a hero from both teams, and in ranked you usually don't know who is on the other side. Its value depends on how likely each team is to open the hero,
      what losing it costs the team that would have played it, and whether it would be banned later anyway. For every legal ban <i>x</i>, the value in win probability is</p>
      <p class="formula">V(<i>x</i>) = (1 − <i>P</i><sub>later</sub>(<i>x</i>)) × [ <i>P</i><sub>them</sub>(<i>x</i>) × <i>R</i><sub>them</sub>(<i>x</i>) − <i>P</i><sub>us</sub>(<i>x</i>) × <i>R</i><sub>us</sub>(<i>x</i>) ] + reply(<i>x</i>)</p>
      <ul>
        <li><b><i>P</i><sub>them</sub>, <i>P</i><sub>us</sub></b>: a masked team-lineup network (two hidden layers of 512, an ensemble of four) that sees only what a lobby shows: the bans so far and who made them,
          the heroes your team shows, map, rank and side. It was trained on 243k Season 10 matches with random parts of each team hidden.</li>
        <li><b><i>R</i></b>: the cost of losing a hero, computed with a fitted outcome model on 1.8 million real opening picks. Each player is moved to their next choice (from a pick model) and the change
          in the team's win probability is recorded. That includes the hero, map, side, rank, compositions, teammates and matchups, and the player's familiarity with both heroes.
          Losing a main costs far more for a player with a narrow pool. In the raw data, a team whose one-trick has their main banned wins 7.5 points less often.</li>
        <li><b><i>P</i><sub>later</sub> and the reply</b>: a ban model fitted on every Season 10 ban. Teams avoid banning their own players' heroes, ban heroes that beat what they play, and react to earlier bans.
          It gives the chance a hero goes later anyway, and how your ban changes theirs.</li>
      </ul>
      <figure><div class="cols">${[0, 1, 2].map(panel).join("")}</div>
        <figcaption><span id="methodFig">Figure 3.</span> Cost to a team of losing each hero, in win-probability points, by average lobby rank (${lg}). Averaged over maps.
        A negative value means the team does better on its next choice, so banning that hero helps whoever planned to play it.</figcaption></figure>
      <h2>Checks on 27,016 later matches</h2>
      <table><tr><th>Check (matches the model never saw)</th><th class="r">Result</th></tr>
        <tr><td>Predicting the other team's heroes before any ban (cross-entropy, against ${L_["0"].bce_popularity.toFixed(4)} from popularity alone)</td><td class="r">${L_["0"].bce_model.toFixed(4)}</td></tr>
        <tr><td>&hellip; after three bans / after all six</td><td class="r">${L_["3"].bce_model.toFixed(4)} / ${L_["6"].bce_model.toFixed(4)}</td></tr>
        <tr><td>Share of the other team's six heroes in the model's top six guesses, after all six bans</td><td class="r">${pct(L_["6"].top6_recall)}</td></tr>
        <tr><td>Win probability a typical team's three bans leave on the table, by the model's own values</td><td class="r">${v.bans.mean_regret_pp.toFixed(2)} pts</td></tr>
        <tr><td>Do teams whose real bans scored higher win more? Slope of winning on ban value (1 = right size)</td><td class="r">${v.bans.slope.toFixed(2)} ± ${(1.96 * v.bans.slope_se).toFixed(2)}</td></tr></table>
      <p class="small">The last line is inconclusive. Real teams' bans differ by fractions of a point, and 27k coin-flip outcomes can only detect a slope of about ±${v.bans.detectable_slope_80pct.toFixed(1)}.
      Each piece of the model is checked separately instead. Bans reveal only a little about a team you can't see. Your teammates' hovers reveal much more. A good ban is worth about
      one point of win probability per game, and bans within about 0.1 points of each other are tied.</p>
      <h2>Limits</h2>
      <ul class="small">
        <li>Fitted on PC ranked Season 10 matches from 11 to 21 September 2026, mostly Diamond to Celestial. Few lobbies average above 5,000.</li>
        <li>Ranks map to scores at about 100 points per division (Grandmaster 3 ≈ 4,550). The exact tier boundaries are approximate.</li>
        <li>Hovers are not in the data. The model treats a shown hero as that player's likely pick and assumes a hover sticks about four times in five.</li>
        <li>Every other player is anonymous. The values average over the real players who play at your rank, not the people in your lobby.</li>
        <li>Values are first order. A ban that reshapes a whole composition is only approximated, and on a two-ban turn the two values are simply added.</li>
      </ul>`;
  }

  $("status").textContent = "Fitted on 243,143 PC ranked matches from Season 10 (11 to 21 September 2026).";
  renderMethod(); update();
  document.fonts && document.fonts.ready.then(() => { renderMethod(); if (RES) renderAdvice(); });
})();
