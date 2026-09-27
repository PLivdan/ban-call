/* Data for the options page: one lobby, the v8 value networks' win chances along the advised and the typical ban path, and
   who opens what in 256 simulated ban phases (the v8 simulator, typical bans for the rest of the phase). node options/build_data.js */
const fs = require("fs"), path = require("path"), R = p => path.join(__dirname, "..", p);
const { Sim8 } = require(R("sim8.js")), { Engine8 } = require(R("engine8.js"));
const rd = f => JSON.parse(fs.readFileSync(R(f))), bin = f => { const b = fs.readFileSync(R(f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
const LAY = rd("model8/value_v8.json"), E = new Engine8(LAY, rd("model8/ban_v8.json")); E.addBuffer("opt", bin("model8/value_opt.bin"));
const S = new Sim8(rd("model8/sim_v8.json"), bin("model8/sim_v8.bin")), META = rd("model/meta.json"), PORT = rd("model/portraits.json"), H = E.H, N = LAY.heroes;
const tier = "Grandmaster 3", m = LAY.maps.findIndex(x => /Klyntar · Dom/.test(x.label)), you = N.indexOf("Loki");
const s0 = { m, r0: META.tiers[tier], firstUs: true, bans: [], you, mates: [] };
const win = s => ({ opt: E.winNow(s)[0], beh: E.winNow(s, "behaviour")[0] });
// the advised path: your bans as advised (pairs on two-ban turns), theirs the likeliest
function advised() { const out = [], s = E.state(s0);
  while (s.bans.length < 6) { const e = s.bans.length;
    if (E.ours(true, e)) { const Rr = E.ourTurn(s), two = e + 1 < 6 && E.ours(true, e + 1);
      if (two) { const P = E.pairs(s, Rr, 4)[0], ab = Rr.V[P.a] >= Rr.V[P.b] ? [P.a, P.b] : [P.b, P.a]; for (const h of ab) { s.bans.push(h); out.push({ e: s.bans.length - 1, h, us: true, w: win(s) }); } }
      else { s.bans.push(Rr.best); out.push({ e, h: Rr.best, us: true, V: Rr.V[Rr.best], w: win(s) }); } }
    else { const L = E.legal(s), p = E.banProbs(s, e, L); let h = -1; for (let k = 0; k < H; k++) if (L[k] && (h < 0 || p[k] > p[h])) h = k; s.bans.push(h); out.push({ e, h, us: false, p: p[h], w: win(s) }); } }
  return out; }
// the typical path: both teams' likeliest bans from the ban model
function typical() { const out = [], s = E.state(s0);
  for (let e = 0; e < 6; e++) { const L = E.legal(s), sh = E.shownSet(s), al = new Uint8Array(H); for (let k = 0; k < H; k++) al[k] = L[k] && !(E.ours(true, e) && sh.has(k)) ? 1 : 0;
    const p = E.banProbs(s, e, al); let h = -1; for (let k = 0; k < H; k++) if (al[k] && (h < 0 || p[k] > p[h])) h = k; s.bans.push(h); out.push({ e, h, us: E.ours(true, e), p: p[h], w: win(s) }); }
  return out; }
// who opens what: 256 simulated ban phases, typical bans for the whole phase
const st = { m, r0: s0.r0, firstUs: true, bans: [], you, mates6: [-1, -1, -1, -1, -1] }, L = S.lobby(st), probs = new Map();
const op = (bans, e, al) => { const k = bans.join(","); if (!probs.has(k)) probs.set(k, E.banProbs(Object.assign({}, s0, { bans }), e, al)); return probs.get(k); };
const acc = { us: new Array(H).fill(0), them: new Array(H).fill(0) }, lu = new Map(), lt = new Map(), ru = new Map(), rt = new Map(), bansC = new Array(H).fill(0); let nu = 0, nt = 0;
const key = pk => Array.from(pk).sort((a, b) => a - b).join(","), roleKey = pk => { const c = [0, 0, 0]; for (const h of pk) c[LAY.roles[h]]++; return c.join("-"); };
const draws = [], RUNS = 256, t0 = Date.now();
for (let j = 0; j < RUNS; j++) { const d = j % 32; if (!draws[d]) draws[d] = S.draw(L, st, Sim8.hash(20260927, d)); const D = draws[d], B = S.complete(L, D, [], j, op), r = S.terminal(L, D, B, true);
  for (const h of B) bansC[h]++;
  for (const pk of r.pu) { nu++; for (const h of pk) acc.us[h]++; lu.set(key(pk), (lu.get(key(pk)) || 0) + 1); ru.set(roleKey(pk), (ru.get(roleKey(pk)) || 0) + 1); }
  for (const pk of r.po) { nt++; for (const h of pk) acc.them[h]++; lt.set(key(pk), (lt.get(key(pk)) || 0) + 1); rt.set(roleKey(pk), (rt.get(roleKey(pk)) || 0) + 1); } }
const top = (M, n, k) => [...M.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([x, c]) => ({ x, p: c / n }));
const out = { lobby: { tier, map: LAY.maps[m].label, first: true, you }, heroes: N, roles: LAY.roles, port: N.map(n => PORT[n]),
  now: win(s0), advised: advised(), typical: typical(),
  opens: { runs: RUNS, us: acc.us.map(c => c / nu), them: acc.them.map(c => c / nt), banned: bansC.map(c => c / RUNS),
           lineups: { us: top(lu, nu, 5), them: top(lt, nt, 5) }, roles: { us: top(ru, nu, 6), them: top(rt, nt, 6) } } };
fs.writeFileSync(path.join(__dirname, "data.json"), JSON.stringify(out));
console.log(`win now: advice ${(100 * out.now.opt).toFixed(1)}%, usual ${(100 * out.now.beh).toFixed(1)}%; advised path ${out.advised.map(x => (x.us ? "+" : "-") + N[x.h]).join(", ")}`);
console.log(`typical path ${out.typical.map(x => (x.us ? "+" : "-") + N[x.h]).join(", ")}; final ${(100 * out.typical[5].w.beh).toFixed(1)}% vs advised ${(100 * out.advised[5].w.opt).toFixed(1)}%`);
console.log(`opens: ${RUNS} runs in ${((Date.now() - t0) / 1000).toFixed(0)}s; their top lineup ${top(lt, nt, 1).map(o => o.x.split(",").map(h => N[h]).join("+") + " " + (100 * o.p).toFixed(1) + "%")}; role splits them ${top(rt, nt, 3).map(o => o.x + " " + (100 * o.p).toFixed(0) + "%").join(", ")}`);
