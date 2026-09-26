// Model output for the example pages (one fixed lobby), written to studio/examples/data.json.
// Usage (from the repo root): node studio/examples/build_data.js
const fs = require("fs"); const { BanEngine } = require("../../engine.js"), { SimEngine } = require("../../sim.js");
const meta = JSON.parse(fs.readFileSync("model/meta.json")), buf = fs.readFileSync("model/weights.bin"), M = JSON.parse(fs.readFileSync("model/sim.json"));
const E = new BanEngine(meta, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), { NS: meta.engine.ns, NOWN: meta.engine.nown, SHORT: meta.engine.short });
const N = meta.heroes, H = N.length, ix = n => N.indexOf(n), ORDER = meta.ban_order;
const lobby = { tier: "Grandmaster 3", map: meta.maps.findIndex(m => m.name === "Klyntar · Domination"), first: true, you: ix("Hela") };
const r0 = meta.tiers[lobby.tier], st = (bans, cnt = 1) => ({ firstUs: lobby.first, bans, rev: [lobby.you], m: lobby.map, r0, cnt });
const ours = i => (ORDER[i] === 0) === lobby.first, r = a => Array.from(a, v => Number.isFinite(v) ? +v.toFixed(5) : null);
const t0 = Date.now(), R = E.values(st([]));
const out = { lobby: { ...lobby, mapName: meta.maps[lobby.map].name, order: ORDER.map((_, i) => ours(i) ? "us" : "them") }, heroes: N, roles: meta.roles,
  value: { V: r(R.V), se: r(R.se), Pt: r(R.Pt), Pu: r(R.Pu), R: r(R.R), Rus: r(R.Rus), PL: r(R.PL) } };
const top = Array.from(R.V.keys()).filter(h => !isNaN(R.V[h])).sort((a, b) => R.V[b] - R.V[a]);
console.error(`value model ${Date.now() - t0} ms; top ${top.slice(0, 5).map(h => N[h]).join(", ")}`);
// simulator: 128 paired runs for the 12 leading bans (per-run values), plus draft shares for the flows
const S = new SimEngine(M, { MU: 48, K: 96, LOOK: 128, DRAWS: 4 }), looks = Array.from({ length: 128 }, (_, j) => j), cands = top.slice(0, 12);
const sv = S.evaluate({ firstUs: lobby.first, bans: [], m: lobby.map, r0, hov6: [lobby.you, -1, -1, -1, -1, -1] }, cands, looks, looks);
out.sim = { cands, base: looks.map(j => +sv.base[j].toFixed(5)), runs: Object.fromEntries(cands.map(h => [h, looks.map(j => +sv.vals[h][j].toFixed(5))])),
  baseCo: r(sv.baseCnt.o), baseCu: r(sv.baseCnt.u), co: Object.fromEntries(cands.map(h => [h, r(sv.cnt[h].o)])), cu: Object.fromEntries(cands.map(h => [h, r(sv.cnt[h].u)])) };
console.error(`simulator ${Date.now() - t0} ms`);
// the ban phase as a tree: our ban 1 (3 leaders) -> their ban 2 (3 likeliest) -> their ban 3 (2 likeliest) -> our best pair for bans 4 and 5
const pmf = (bans, k) => { const s = st(bans), res = E.values(s), P = E.theirNextBan(s, res); return Array.from(P.keys()).sort((a, b) => P[b] - P[a]).slice(0, k).map(h => ({ h, p: +P[h].toFixed(4) })); };
out.tree = top.slice(0, 3).map(a => ({ h: a, V: +R.V[a].toFixed(5), next: pmf([a], 3).map(b => ({ ...b, next: pmf([a, b.h], 2).map(c => {
  const s = st([a, b.h, c.h], 2), res = E.values(s), p = res.pairs && res.pairs[0];
  return { ...c, pair: p ? { a: p.a, b: p.b, V: +p.V.toFixed(5) } : null }; }) })) }));
console.error(`tree ${Date.now() - t0} ms`);
fs.writeFileSync("studio/examples/data.json", JSON.stringify(out));
console.error("wrote studio/examples/data.json", (fs.statSync("studio/examples/data.json").size / 1024).toFixed(0), "KB");
