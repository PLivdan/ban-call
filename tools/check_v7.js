// Verification of the v7 value engine against the rules it is meant to follow, and against the frozen v6 engine.
// Everything here is computational: it says whether the engine does what it claims with the fitted models taken as
// given, not whether its bans win more real games.
// Usage: node tools/check_v7.js [n_lobbies=60] > tools/reports/check_v7.txt
const fs = require("fs"); const { BanEngine } = require("../engine.js"); const V6 = require("../baseline/engine_v6.js").BanEngine;
const meta = JSON.parse(fs.readFileSync("model/meta.json")), buf = fs.readFileSync("model/weights.bin"), AB = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
const E = new BanEngine(meta, AB), E6 = new V6(meta, AB), H = E.H, N = meta.heroes, ORDER = meta.ban_order;
const NL = +(process.argv[2] || 60);
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log("  FAIL " + msg); } };
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(2026), pick = a => a[Math.floor(R() * a.length)];
const draw = (P, excl) => { let s = 0; for (let h = 0; h < H; h++) if (!excl.has(h)) s += P[h]; let t = R() * s; for (let h = 0; h < H; h++) { if (excl.has(h)) continue; t -= P[h]; if (t <= 0) return h; } for (let h = H - 1; h >= 0; h--) if (!excl.has(h)) return h; };
const tiers = Object.values(meta.tiers), top = V => Array.from(V.keys()).filter(h => !isNaN(V[h])).sort((a, b) => V[b] - V[a]);
const spear = (A, B) => { const a = top(A), rb = new Map(top(B).map((h, i) => [h, i])), hs = a.filter(h => rb.has(h)), n = hs.length; let d2 = 0; hs.forEach((h, i) => d2 += (i - rb.get(h)) ** 2); return 1 - 6 * d2 / (n * (n * n - 1)); };
const ours = (st, i) => (ORDER[i] === 0) === st.firstUs;
const cntOf = (st, e) => (e + 1 < 6 && ours(st, e) && ours(st, e + 1)) ? 2 : 1;
// a realistic lobby: shown heroes drawn from what a team opens, bans drawn from the ban model, stopped at one of our turns (or at the end)
function lobby(stopAtEnd = false) {
  const st = { firstUs: R() < .5, m: Math.floor(R() * meta.maps.length), r0: pick(tiers), bans: [], rev: [] };
  const k = pick([0, 1, 1, 2, 3, 4, 5, 6]), c0 = E.ctx(st), P0 = E.lineups(c0).pu, ex = new Set();
  for (let i = 0; i < k; i++) { const h = draw(P0, ex); st.rev.push(h); ex.add(h); }
  const stops = [0, 1, 2, 3, 4, 5].filter(e => ours(st, e)), stop = stopAtEnd ? 6 : pick(stops);
  for (let e = 0; e < stop; e++) {
    const c = E.ctx(st), L = E.lineups(c), us = ours(st, e), u = E.banUtil(e, us ? L.pu : L.pt, us ? c.BU : c.BT, us ? c.BT : c.BU, c.m, c.bd), mask = new Uint8Array(H);
    for (let h = 0; h < H; h++) mask[h] = c.BU[h] || c.BT[h] || (us && c.rv[h]) ? 1 : 0;
    const p = BanEngine.softmaxMasked(u, mask), h = draw(p, new Set([...Array(H).keys()].filter(x => mask[x]))); st.bans.push(h);
  }
  st.rev = st.rev.filter(h => !st.bans.includes(h)); st.cnt = st.bans.length < 6 ? cntOf(st, st.bans.length) : 1; return st;
}
const fmt = (x, d = 2) => (x >= 0 ? "+" : "") + (100 * x).toFixed(d);

console.log(`v7 engine checks on model ${meta.source} (${NL} lobbies per section, NS = ${E.NS} rollouts)\n`);

// ---- 1. lineup coherence
console.log("1. Lineup probabilities");
{
  const rows = [];
  for (let k = 0; k <= 6; k++) for (let t = 0; t < 8; t++) {
    const st = lobby(true); const c0 = E.ctx(Object.assign({}, st, { rev: [] })), P0 = E.lineups(c0).pu, ex = new Set(st.bans);
    st.rev = []; for (let i = 0; i < k; i++) { const h = draw(P0, ex); st.rev.push(h); ex.add(h); }
    const r = E.values(st), c = E.ctx(st); let su = 0, st_ = 0, sr = 0, str = 0, lo = 1, hi = 0, bz = 0, out = 0;
    for (let h = 0; h < H; h++) { su += r.Pu[h]; st_ += r.Pt[h]; sr += r.PuRaw[h]; str += r.PtRaw[h]; lo = Math.min(lo, r.Pu[h], r.Pt[h]); hi = Math.max(hi, r.Pu[h], r.Pt[h]); if (!c.legal[h]) bz += r.Pu[h] + r.Pt[h]; if (k === 6 && !c.rv[h]) out += r.Pu[h]; }
    rows.push({ k, su, st_, sr, str }); check(Math.abs(su - 6) < 1e-6 && Math.abs(st_ - 6) < 1e-6, `after six bans the expected lineup is 6 heroes (ours ${su.toFixed(4)}, theirs ${st_.toFixed(4)}, k=${k})`);
    check(lo >= 0 && hi <= 1, "probabilities stay in [0, 1]"); check(bz === 0, "banned heroes get probability 0"); if (k === 6) check(out === 0, "six fixed heroes leave no open slot");
  }
  for (let k = 0; k <= 6; k++) { const a = rows.filter(r => r.k === k), m = f => a.reduce((s, r) => s + r[f], 0) / a.length;
    console.log(`  after all six bans, ${k} of our heroes fixed: expected heroes ours ${m("su").toFixed(3)} (raw ${m("sr").toFixed(3)}), theirs ${m("st_").toFixed(3)} (raw ${m("str").toFixed(3)})`); }
  // before the ban phase ends each probability is its own hypothetical ("would open it if available"), left as the network gives it
  let st = lobby(); while (st.rev.length > 3) st = lobby(); const r = E.values(st); let su = 0; for (let h = 0; h < H; h++) su += r.Pu[h];
  console.log(`  mid ban phase (${st.bans.length} bans, ${st.rev.length} shown): our "if available" probabilities add to ${su.toFixed(2)} (not forced to 6, by design)`);
}

// ---- 2. rollouts: exactly the remaining number of distinct, legal bans
console.log("\n2. Rollouts of the rest of the ban phase");
{
  let n = 0, oldSum = [], newSum = [];
  for (let t = 0; t < NL; t++) {
    const st = lobby(), c = E.ctx(st), L = E.lineups(c), rc = E.rolloutCtx(c, L.pu, L.pt), rem = 6 - c.e;
    E.rollout(rc, [], null, (s, seq) => {
      n++; const set = new Set(seq); check(seq.length === rem && set.size === rem, `${rem} positions left give ${set.size} distinct bans`);
      for (let i = 0; i < seq.length; i++) { check(!c.BU[seq[i]] && !c.BT[seq[i]], "no hero banned twice"); if (ours(st, c.e + i)) check(!c.rv[seq[i]], "we never ban a hero we show"); }
    });
    const r = E.values(st), o = E6.values(st); let a = 0, b = 0; for (let h = 0; h < H; h++) { a += o.PL[h]; b += r.PL[h]; }
    oldSum.push({ rem: 6 - c.e - (st.cnt || 1), v: a }); newSum.push({ rem: 6 - r.turnStart, v: b });
  }
  console.log(`  ${n.toLocaleString()} rollouts checked: every one has exactly the remaining number of distinct, legal bans`);
  for (const rem of [1, 2, 3, 4, 5]) { const a = oldSum.filter(x => x.rem === rem); if (a.length) console.log(`  v6 later(): ${rem} later positions imply ${(a.reduce((s, x) => s + x.v, 0) / a.length).toFixed(2)} distinct bans on average (${a.length} lobbies)`); }
  for (const rem of [1, 2, 3, 4, 5, 6]) { const a = newSum.filter(x => x.rem === rem); if (a.length) console.log(`  v7 rollout: ${rem} positions from the start of our turn give ${(a.reduce((s, x) => s + x.v, 0) / a.length).toFixed(2)} distinct bans`); }
}

// ---- 3. information boundaries
console.log("\n3. Information boundaries");
{
  let mdRaw = 0, mdInt = 0, nT = 0, hovers = 0;
  for (let t = 0; t < NL; t++) {
    const st = lobby(); const c = E.ctx(st); if (!c.ownU.length) continue;
    // our own bans are interventions: swapping which hero we banned changes our lineup only by legality
    const last = st.bans.map((h, i) => ours(st, i) ? i : -1).filter(i => i >= 0).pop(), alt = st.bans.slice();
    const r0 = E.values(st), cands = top(r0.V).filter(h => !st.bans.includes(h)); alt[last] = cands[0];
    const r1 = E.values(Object.assign({}, st, { bans: alt })), X = st.bans[last], Y = alt[last];
    for (let h = 0; h < H; h++) if (h !== X && h !== Y && !st.bans.includes(h)) { mdInt = Math.max(mdInt, Math.abs(r0.Pu[h] - r1.Pu[h])); mdRaw = Math.max(mdRaw, Math.abs(r0.PuRaw[h] - r1.PuRaw[h])); }
    nT++;
    // the other team never sees our hovers: their lineup and their next-ban policy ignore them
    if (!ours(st, st.bans.length)) continue;
  }
  check(mdInt < 1e-12, "our lineup does not depend on which hero we banned (other than legality)");
  console.log(`  swapping our own last ban for another hero (${nT} lobbies): our lineup moves by at most ${mdInt.toExponential(1)} (v6-style conditioning: ${(100 * mdRaw).toFixed(1)} points)`);
  for (let t = 0; t < 30; t++) {
    const st = lobby(); const a = E.values(st), b = E.values(Object.assign({}, st, { rev: [] })); let d = 0;
    for (let h = 0; h < H; h++) d = Math.max(d, Math.abs(a.Pt[h] - b.Pt[h]));
    const ta = E.theirNextBan(st, a), tb = E.theirNextBan(Object.assign({}, st, { rev: [] }), b); for (let h = 0; h < H; h++) d = Math.max(d, Math.abs(ta[h] - tb[h]));
    hovers = Math.max(hovers, d);
  }
  check(hovers < 1e-12, "the other team's lineup and bans ignore our hovers");
  console.log(`  adding or removing our hovers changes the other team's lineup and next-ban chances by at most ${hovers.toExponential(1)}`);
}

// ---- 4. stability of the rollout values (different random draws)
console.log("\n4. Stability across random draws (NS = " + E.NS + ")");
{
  const Es = [1, 2].map(s => new BanEngine(meta, AB, { salt: s })); let agree = 0, t3 = 0, sp = 0, z = 0, zn = 0, n = 0, pairAgree = 0, pn = 0;
  for (let t = 0; t < NL; t++) {
    const st = lobby(), a = Es[0].values(st), b = Es[1].values(st); const A = top(a.V), B = top(b.V);
    agree += A[0] === B[0]; t3 += A.slice(0, 3).filter(h => B.slice(0, 3).includes(h)).length / 3; sp += spear(a.V, b.V); n++;
    for (const h of A.slice(0, 10)) { z = Math.max(z, Math.abs(a.V[h] - b.V[h]) / Math.hypot(a.seMC[h], b.seMC[h])); zn++; }
    if (a.pairs) { pn++; const pa = a.pairs[0], pb = b.pairs[0]; pairAgree += (pa.a === pb.a && pa.b === pb.b) || (pa.a === pb.b && pa.b === pb.a); }
  }
  console.log(`  two independent sets of draws agree on the top ban in ${agree}/${n} lobbies, top-3 overlap ${(100 * t3 / n).toFixed(0)}%, rank correlation ${(sp / n).toFixed(3)}`);
  console.log(`  largest difference in a top-10 value, in simulation standard errors (rollouts and the own-ban average): ${z.toFixed(2)} (over ${zn} values; about 3.5 is expected for the largest of 600 normal draws)`);
  if (pn) console.log(`  best pair agrees in ${pairAgree}/${pn} two-ban lobbies`);
}

// ---- 5. v6 against v7 recommendations
console.log("\n5. What changed against the v6 engine");
{
  let same = 0, n = 0, sp = 0, ex = [];
  const parts = { coherent: 0, intervention: 0, rollout: 0 };
  for (let t = 0; t < NL; t++) {
    const st = lobby(), a = E6.values(st), b = E.values(st), A = top(a.V), B = top(b.V); n++; same += A[0] === B[0]; sp += spear(a.V, b.V);
    if (A[0] !== B[0] && ex.length < 8) ex.push(`${st.bans.length} bans, ${st.rev.length} shown, ${st.cnt === 2 ? "two-ban turn" : "one ban"}: v6 ${N[A[0]]} (${fmt(a.V[A[0]])}), v7 ${N[B[0]]} (${fmt(b.V[B[0]])}; v6 had it ${A.indexOf(B[0]) + 1}th)`);
  }
  console.log(`  same top ban in ${same}/${n} lobbies; rank correlation of all values ${(sp / n).toFixed(3)}`);
  console.log("  v6 values are against leaving the hero open, v7 values against a typical ban, so the levels differ by design; the ranking is what compares.");
  for (const x of ex) console.log("   - " + x);
}

// ---- 6. pairs on two-ban turns
console.log("\n6. Pairs on two-ban turns");
{
  let n = 0, sumTop = 0, wideSame = 0, gap = 0, cons = 0, ms = [];
  const Ew = new BanEngine(meta, AB, { SHORT: 56 });
  for (let t = 0; t < 4 * NL && n < Math.max(12, NL / 3); t++) {
    const st = lobby(); if (st.cnt !== 2) continue; n++;
    const r = E.values(st), p = r.pairs[0], T = top(r.V);
    sumTop += (new Set([p.a, p.b, T[0], T[1]])).size === 2;                     // best pair = the two best single bans?
    const w = Ew.values(st), q = w.pairs[0]; const sameP = (q.a === p.a && q.b === p.b) || (q.a === p.b && q.b === p.a);
    wideSame += sameP; gap = Math.max(gap, q.V - p.V);
    const first = r.V[p.a] >= r.V[p.b] ? p.a : p.b, partner = first === p.a ? p.b : p.a;   // enter the first, as the page suggests
    const st2 = Object.assign({}, st, { bans: st.bans.concat([first]), cnt: 1, rev: st.rev.filter(h => h !== first) }), r2 = E.values(st2);
    cons += top(r2.V)[0] === partner;
  }
  console.log(`  ${n} two-ban lobbies. The best pair is simply the two best single bans in ${sumTop}/${n}.`);
  console.log(`  Searching every pair instead of the top-${E.SHORT} shortlist finds the same best pair in ${wideSame}/${n} (largest value missed: ${(100 * gap).toFixed(3)} points).`);
  console.log(`  After entering the pair's first ban, the page's next suggestion is the pair's partner in ${cons}/${n}.`);
}

// ---- 7. latency
console.log("\n7. Latency (Node, one thread)");
{
  const one = [], two = [];
  for (let t = 0; t < 30; t++) { const st = lobby(); const t0 = process.hrtime.bigint(); E.values(st); const ms = Number(process.hrtime.bigint() - t0) / 1e6; (st.cnt === 2 ? two : one).push(ms); }
  const q = (a, f) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))].toFixed(0) : "-";
  console.log(`  one-ban turns: median ${q(one, .5)} ms, 90th percentile ${q(one, .9)} ms (${one.length}); two-ban turns with pairs: median ${q(two, .5)} ms, 90th ${q(two, .9)} ms (${two.length})`);
}
console.log(fails ? `\n${fails} checks FAILED` : "\nall v7 engine checks passed");
process.exit(fails ? 1 : 0);
