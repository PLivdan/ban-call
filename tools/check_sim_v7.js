// Verification of the v7 re-draft simulator: the intervention change against the frozen v6 simulator, joint pair search
// on two-ban turns (shortlist of 10 against a wider one), stability across random seeds, ban-phase legality, and timing.
// Computational checks only: the fitted models are taken as given.
// Usage: node tools/check_sim_v7.js [n_lobbies=8] [runs=16] > tools/reports/check_sim_v7.txt
const fs = require("fs"); const { SimEngine } = require("../sim.js"); const S6 = require("../baseline/sim_v6.js").SimEngine;
const M = JSON.parse(fs.readFileSync("model/sim.json")), H = M.heroes.length, N = M.heroes, ORDER = M.ban_order;
const NL = +(process.argv[2] || 8), NR = +(process.argv[3] || 16), OPT = { MU: 48, K: 96, LOOK: NR };
const E7 = new SimEngine(M, OPT), E6 = new S6(M, OPT), E7b = new SimEngine(M, Object.assign({ seed: 777 }, OPT));
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(99), pick = a => a[Math.floor(R() * a.length)], tiers = [3800, 4250, 4550, 4900];
let fails = 0; const check = (ok, msg) => { if (!ok) { fails++; console.log("  FAIL " + msg); } };
const ours = (st, i) => (ORDER[i] === 0) === st.firstUs;
const popular = [..."Gambit,Rocket Raccoon,Emma Frost,Magneto,Invisible Woman,Luna Snow,Cloak & Dagger,Psylocke,Hela,Ultron,Spider-man,Doctor Strange,Hulk,Mantis,Loki,Devil Dinosaur,Jubilee,Magik,Iron Fist,Gorr The God Butcher,Peni Parker,Thor".split(",")].map(n => N.indexOf(n)).filter(h => h >= 0);
function lobby(twoBan) {                               // a lobby at one of our turns; twoBan: at the start of our two-ban turn
  for (;;) {
    const st = { firstUs: R() < .5, m: Math.floor(R() * M.maps.length), r0: pick(tiers) }, stops = [0, 1, 2, 3, 4, 5].filter(e => ours(st, e) && (!twoBan || (e + 1 < 6 && ours(st, e + 1))));
    if (!stops.length) continue; const e = pick(stops), used = new Set(); st.bans = [];
    for (let i = 0; i < e; i++) { let h; do h = pick(popular); while (used.has(h)); used.add(h); st.bans.push(h); }
    const hov6 = [-1, -1, -1, -1, -1, -1], k = pick([0, 1, 2, 3, 4]); for (let j = 0; j < k; j++) { let h; do h = pick(popular); while (used.has(h)); used.add(h); hov6[j] = h; }
    if (hov6[0] < 0) { let h; do h = pick(popular); while (used.has(h)); used.add(h); hov6[0] = h; }
    st.hov6 = hov6; st.rev = hov6.filter(h => h >= 0); st.cnt = e + 1 < 6 && ours(st, e) && ours(st, e + 1) ? 2 : 1; return st;
  }
}
const looks = Array.from({ length: NR }, (_, i) => i), top = V => Array.from(V.keys()).filter(h => !isNaN(V[h])).sort((a, b) => V[b] - V[a]);
function singles(E, st) {                              // every legal ban on all runs, against the typical-ban baseline (like the site, without its two stages)
  const prot = new Set(st.hov6.filter(h => h >= 0)), cands = []; for (let h = 0; h < H; h++) if (!st.bans.includes(h) && !prot.has(h)) cands.push(h);
  const out = E.evaluate(st, cands, looks, looks), V = new Float64Array(H).fill(NaN), se = new Float64Array(H).fill(NaN);
  for (const h of cands) { const d = looks.map(j => out.vals[h][j] - out.base[j]), m = d.reduce((a, b) => a + b) / d.length; V[h] = m; se[h] = Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / (d.length * (d.length - 1))); }
  return { V, se, base: out.base };
}
function pairs(E, st, sl, base) {
  const cands = []; for (let i = 0; i < sl.length; i++) for (let j = i + 1; j < sl.length; j++) cands.push([sl[i], sl[j]]);
  const out = E.evaluate(st, cands, looks, []);
  return cands.map(p => { const d = looks.map(j => out.vals[String(p)][j] - base[j]), m = d.reduce((a, b) => a + b) / d.length; return { a: p[0], b: p[1], V: m, se: Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / (d.length * (d.length - 1))) }; }).sort((x, y) => y.V - x.V);
}
const f = x => (x >= 0 ? "+" : "") + (100 * x).toFixed(2), pn = p => `${N[p.a]} + ${N[p.b]} ${f(p.V)} ± ${(196 * p.se).toFixed(2)}`;
console.log(`v7 simulator checks (${NL} lobbies per section, ${NR} runs per ban, ${OPT.MU} of our lineups x ${OPT.K} of theirs)\n`);

console.log("1. Ban-phase legality in the simulated continuations");
{
  let n = 0; for (let t = 0; t < 6; t++) { const st = lobby(false), S = E7.setup(st);
    for (let j = 0; j < NR; j++) { const fu = E7.future(S, st.bans, [], j); let k = 0; for (let h = 0; h < H; h++) k += fu.BU[h] + fu.BT[h]; check(k === 6, "six distinct bans at the end of every continuation"); for (const h of S.prot) check(!fu.BU[h], "we never ban a hero we show"); n++; } }
  console.log(`  ${n} continuations: each ends with exactly six distinct bans, none of them a hero we show`);
}

console.log("\n2. Our bans as interventions: v6 simulator against v7 (single bans)");
{
  let same = 0, n = 0, ms = 0;
  for (let t = 0; t < NL; t++) {
    const st = lobby(false); const t0 = Date.now(); const a = singles(E6, st), b = singles(E7, st); ms += (Date.now() - t0) / 2; n++;
    const A = top(a.V), B = top(b.V); same += A[0] === B[0];
    console.log(`  ${st.bans.length} bans, ${st.rev.length} shown: v6 ${N[A[0]]} ${f(a.V[A[0]])}, v7 ${N[B[0]]} ${f(b.V[B[0]])}${A[0] === B[0] ? "" : ` (v6 had it ${A.indexOf(B[0]) + 1}th)`}`);
  }
  console.log(`  same top ban in ${same}/${n}; ${(ms / n / 1000).toFixed(1)} s per lobby for all single bans on one thread`);
}

console.log("\n3. Two-ban turns: pairs scored jointly, a shortlist of 10 against 20");
{
  let sameWide = 0, sumTop = 0, n = 0, missed = 0, ms10 = 0;
  for (let t = 0; t < Math.max(3, Math.ceil(NL / 2)); t++) {
    const st = lobby(true), s = singles(E7, st), T = top(s.V);
    const t0 = Date.now(); const p10 = pairs(E7, st, T.slice(0, 10), s.base); ms10 += Date.now() - t0;
    const p20 = pairs(E7, st, T.slice(0, 20), s.base); n++;
    const a = p10[0], b = p20[0], same = (a.a === b.a && a.b === b.b) || (a.a === b.b && a.b === b.a); sameWide += same; missed = Math.max(missed, b.V - a.V);
    sumTop += new Set([a.a, a.b, T[0], T[1]]).size === 2;
    console.log(`  ${st.bans.length} bans, ${st.rev.length} shown: best of 45 ${pn(a)}; best of 190 ${pn(b)}${same ? "" : " (different)"}; top two singles ${N[T[0]]} + ${N[T[1]]}`);
  }
  console.log(`  shortlist of 20 finds the same best pair in ${sameWide}/${n} (largest value missed ${(100 * missed).toFixed(2)} points); the best pair is the two best singles in ${sumTop}/${n}`);
  console.log(`  45 pairs x ${NR} runs: ${(ms10 / n / 1000).toFixed(1)} s per lobby on one thread (the site splits this over its workers)`);
}

console.log("\n4. Stability: a different random seed (other stand-ins and draws)");
{
  let same = 0, n = 0, t3 = 0;
  for (let t = 0; t < Math.max(3, Math.ceil(NL / 2)); t++) {
    const st = lobby(false), a = singles(E7, st), b = singles(E7b, st), A = top(a.V), B = top(b.V); n++; same += A[0] === B[0]; t3 += A.slice(0, 3).filter(h => B.slice(0, 3).includes(h)).length / 3;
    console.log(`  seed 12345: ${N[A[0]]} ${f(a.V[A[0]])} ± ${(196 * a.se[A[0]]).toFixed(2)}; seed 777: ${N[B[0]]} ${f(b.V[B[0]])} ± ${(196 * b.se[B[0]]).toFixed(2)}`);
  }
  console.log(`  same top ban in ${same}/${n}, top-3 overlap ${(100 * t3 / n).toFixed(0)}%. The simulator's intervals cover its own draws, not a change of stand-ins, so seed-to-seed differences are larger.`);
}
console.log(fails ? `\n${fails} checks FAILED` : "\nall simulator checks passed");
process.exit(fails ? 1 : 0);
