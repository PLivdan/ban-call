// Seed-to-seed stability of the re-draft simulator's top ban at a given number of runs (other stand-ins and draws).
// Usage: node tools/check_sim_seeds.js [n_lobbies=4] [runs=64] [seeds=3] [stand-in draws per seed=1]
const fs = require("fs"); const { SimEngine } = require("../sim.js");
const M = JSON.parse(fs.readFileSync("model/sim.json")), H = M.heroes.length, N = M.heroes, ORDER = M.ban_order;
const NL = +(process.argv[2] || 4), NR = +(process.argv[3] || 64), NSEED = +(process.argv[4] || 3), DRAWS = +(process.argv[5] || 1);
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(99), pick = a => a[Math.floor(R() * a.length)], ours = (st, i) => (ORDER[i] === 0) === st.firstUs;
const popular = "Gambit,Rocket Raccoon,Emma Frost,Magneto,Invisible Woman,Luna Snow,Cloak & Dagger,Psylocke,Hela,Ultron,Spider-man,Doctor Strange,Hulk,Mantis,Loki,Devil Dinosaur,Jubilee,Magik,Iron Fist,Gorr The God Butcher,Peni Parker,Thor".split(",").map(n => N.indexOf(n));
const looks = Array.from({ length: NR }, (_, i) => i);
for (let t = 0; t < NL; t++) {
  const st = { firstUs: R() < .5, m: Math.floor(R() * M.maps.length), r0: pick([3800, 4250, 4550, 4900]) }, stops = [0, 1, 2, 3, 4, 5].filter(e => ours(st, e)), e = pick(stops), used = new Set(); st.bans = [];
  for (let i = 0; i < e; i++) { let h; do h = pick(popular); while (used.has(h)); used.add(h); st.bans.push(h); }
  const hov6 = [-1, -1, -1, -1, -1, -1], k = 1 + Math.floor(R() * 4); for (let j = 0; j < k; j++) { let h; do h = pick(popular); while (used.has(h)); used.add(h); hov6[j] = h; } st.hov6 = hov6;
  const cands = []; for (let h = 0; h < H; h++) if (!st.bans.includes(h) && !hov6.includes(h)) cands.push(h);
  const res = [];
  for (let s = 0; s < NSEED; s++) {
    const E = new SimEngine(M, { MU: 48, K: 96, LOOK: NR, DRAWS, seed: 12345 + 104729 * s }), o = E.evaluate(st, cands, looks, looks), V = {};
    const SE = {}; for (const h of cands) { const d = looks.map(j => o.vals[h][j] - o.base[j]), mu = d.reduce((a, b) => a + b) / NR; V[h] = mu; SE[h] = Math.sqrt(d.reduce((a, b) => a + (b - mu) ** 2, 0) / (NR * (NR - 1))); }
    res.push(cands.slice().sort((a, b) => V[b] - V[a]).slice(0, 3).map(h => `${N[h]} ${(100 * V[h]).toFixed(2)} ± ${(196 * SE[h]).toFixed(2)}`));
  }
  console.log(`lobby ${t + 1} (${st.bans.length} bans, ${k} shown), ${NR} runs, ${DRAWS} stand-in draw(s) per seed:`); res.forEach((r, s) => console.log(`  seed ${s + 1}: ${r.join(", ")}`));
}
