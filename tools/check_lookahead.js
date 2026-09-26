/* Does optimising our NEXT ban turn change or improve the first ban? A 2 x 2 test with the fitted models held fixed.
   Rows: the score (the value model's additive W, or the re-draft simulator). Columns: the continuation (our later bans
   typical, as in the site today, or chosen by a one-turn lookahead planner).

   Planner (additive score, the engine's own W with the hero worths w(y) fixed at the current state):
     Q(a) = E_{their bans until our next turn | a} [ max_{our next action u} E_{their remaining ban | a, ..., u} W(a, ..., u, ...) ]
   Their bans come from the fitted ban model (the engine's rollout utilities), sampled with shared Gumbel draws for every
   candidate. Our next action is chosen on the expected value given what we would have observed (their actual bans),
   never per simulated lobby or per network, and their last ban is taken in exact expectation. Our own chosen bans are
   interventions: w(y) is not updated from them.
   Evaluation never reuses the draws the planner maximised on: the additive check re-samples their bans with a new seed,
   and the simulator plays both first bans with fresh stand-ins and draws (our next turn chosen by the planner from the
   bans the simulator actually produced). Differences are paired (same draws / same runs, clustered by stand-in draw).
   Usage (repo root): node tools/check_lookahead.js [lobbies=40] [simRuns=128] [planSamples=128] */
const fs = require("fs"), path = require("path");
const { BanEngine } = require("../engine.js"), { SimEngine } = require("../sim.js");
const meta = JSON.parse(fs.readFileSync("model/meta.json")), buf = fs.readFileSync("model/weights.bin"), SM = JSON.parse(fs.readFileSync("model/sim.json"));
const E = new BanEngine(meta, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), { NS: meta.engine.ns, NOWN: meta.engine.nown, SHORT: meta.engine.short });
if (E.B2) throw new Error("the richer ban model is on: the planner's ban utilities would need its extra terms");
const LOB = JSON.parse(fs.readFileSync("tools/lookahead_lobbies.json")), N = meta.heroes, H = N.length, ORDER = meta.ban_order, BM = meta.ban, DP = meta.pair_removal;
const NL = +(process.argv[2] || 40), NR = +(process.argv[3] || 128), NP = +(process.argv[4] || 128), KTOP = 14, DRAWS = 32;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gumbel = r => -Math.log(-Math.log(r() * (1 - 2e-12) + 1e-12));
const mean = a => a.reduce((s, x) => s + x, 0) / a.length, sdv = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const cse = (js, d) => { const m = mean(d), G = new Map(); js.forEach((j, i) => { const g = j % DRAWS, o = G.get(g) || { s: 0, n: 0 }; o.s += d[i]; o.n++; G.set(g, o); }); const k = G.size; let s2 = 0; for (const o of G.values()) s2 += (o.s - o.n * m) ** 2; return Math.sqrt(k / (k - 1) * s2) / d.length; };
const pp = x => (x >= 0 ? "+" : "−") + Math.abs(100 * x).toFixed(2), nm = a => a.map(h => N[h]).join("+");

function planner(st) {
  const R = E.values(st), rc = R._rc, c = rc.c, bd = R.band, e0 = c.e, wm = R.w, S0 = c.bans;
  const dpt = new Float64Array(H); for (let y = 0; y < H; y++) dpt[y] = R.Pt[y] - R.Pu[y];
  // the turn structure from here: our action now, their bans, our next action, their remaining bans
  const pos = [], seg = []; for (let i = e0; i < 6; i++) { const us = c.ours(i), k = pos.length; if (!k || seg[k - 1] !== us) { pos.push([i]); seg.push(us); } else pos[k - 1].push(i); }
  const [A0, T1, U2, T2] = [pos[0], pos[1] || [], pos[2] || [], pos[3] || []];
  if (!seg[0] || !U2.length || T2.length > 1) throw new Error("expected: our turn, their bans, our next turn, at most one ban after it");
  const W = seq => { let t = 0; for (const y of seq) t += wm[y];                      // the engine's W, with the joint-removal terms
    if (DP) for (let i = 0; i < seq.length; i++) { let ex = 0; for (let j = 0; j < seq.length; j++) if (j !== i) ex += DP[seq[i]][seq[j]][bd]; for (const y of S0) ex += DP[seq[i]][y][bd]; t += dpt[seq[i]] * ex; }
    return t; };
  const init = () => { const done = new Uint8Array(H); for (let h = 0; h < H; h++) done[h] = c.BU[h] || c.BT[h]; return { done, rU: Float64Array.from(rc.respU), rT: Float64Array.from(rc.respT) }; };
  const clone = S => ({ done: S.done.slice(), rU: S.rU.slice(), rT: S.rT.slice() });
  const apply = (S, h, us) => { S.done[h] = 1; const Ro = BM.Ro[h], Rt = BM.Rt[h], own = us ? S.rU : S.rT, oth = us ? S.rT : S.rU; for (let x = 0; x < H; x++) { own[x] += Ro[x]; oth[x] += Rt[x]; } };
  const util = (S, ep, us) => { const base = us ? rc.baseU : rc.baseT, resp = us ? S.rU : S.rT, u = new Float64Array(H); for (let x = 0; x < H; x++) u[x] = S.done[x] || (us && c.rv[x]) ? -Infinity : base[x] + BM.ae[ep][x] + resp[x]; return u; };
  const stateOf = seq => { const S = init(); seq.forEach((h, i) => apply(S, h, c.ours(e0 + i))); return S; };
  // our next action given the bans so far (seq from e0), on the expectation over their remaining ban
  const memo = new Map();
  function bestNext(seq) {
    const key = seq.join(","); if (memo.has(key)) return memo.get(key);
    const S = stateOf(seq), pool = []; for (let x = 0; x < H; x++) if (!S.done[x] && !c.rv[x]) pool.push(x);
    const top = pool.sort((a, b) => wm[b] - wm[a]).slice(0, KTOP), acts = [];
    if (U2.length === 2) { for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) acts.push([top[i], top[j]]); } else for (const x of top) acts.push([x]);
    let best = null;
    for (const act of acts) {
      const seq2 = seq.concat(act); let val;
      if (!T2.length) val = W(seq2);
      else { const S2 = clone(S); act.forEach(h => apply(S2, h, true)); const u = util(S2, T2[0], false); let mx = -Infinity; for (const v of u) if (v > mx) mx = v; let Z = 0, acc = 0;
        for (let h = 0; h < H; h++) if (u[h] > -Infinity) { const p = Math.exp(u[h] - mx); Z += p; acc += p * W(seq2.concat([h])); } val = acc / Z; }
      if (!best || val > best.val) best = { act, val };
    }
    memo.set(key, best); return best;
  }
  // Q of each first action, on NP samples of their bans until our next turn (shared Gumbel draws across actions)
  function noise(seed) { const r = rng(seed), G = []; for (let s = 0; s < NP; s++) { const g = []; for (const ep of T1) g.push(Float64Array.from({ length: H }, () => gumbel(r))); G.push(g); } return G; }
  function Q(act, G) {
    const vals = [];
    for (let s = 0; s < NP; s++) { const S = init(), seq = act.slice(); act.forEach(h => apply(S, h, true));
      T1.forEach((ep, i) => { const u = util(S, ep, false); let b = -1, bv = -Infinity; for (let h = 0; h < H; h++) { const v = u[h] + G[s][i][h]; if (v > bv) { bv = v; b = h; } } apply(S, b, false); seq.push(b); });
      vals.push(bestNext(seq).val); }
    return vals;
  }
  return { R, c, A0, T1, U2, T2, bestNext, Q, noise };
}

// the simulator's ban phase with our next turn chosen by the planner (chooser = null: typical, as sim.js future())
function simFuture(Es, S, bans, first, j, chooser, e0, ours) {
  const b = SM.ban, BU = new Uint8Array(H), BT = new Uint8Array(H), accU = new Float32Array(H), accT = new Float32Array(H), seqFromE0 = [];
  bans.forEach((h, i) => ((ours(i) ? BU : BT)[h] = 1));
  const addBan = (h, byUs) => { const Ro = b.Ro[h], Rt = b.Rt[h]; if (byUs) for (let k = 0; k < H; k++) { accU[k] += Ro[k]; accT[k] += Rt[k]; } else for (let k = 0; k < H; k++) { accT[k] += Ro[k]; accU[k] += Rt[k]; } };
  for (let h = 0; h < H; h++) { if (BU[h]) addBan(h, true); if (BT[h]) addBan(h, false); }
  for (const h of first) { BU[h] = 1; addBan(h, true); seqFromE0.push(h); }
  let ep = bans.length + first.length;
  while (ep < 6) {
    const us = ours(ep);
    if (us && chooser) { const act = chooser(seqFromE0); for (const h of act) { BU[h] = 1; addBan(h, true); seqFromE0.push(h); ep++; } continue; }
    const base = us ? S.ubUs : S.ubOp[j], acc = us ? accU : accT, ae = b.ae[ep], gbe = S.gb[j][ep]; let best = -1, bv = -Infinity;
    for (let h = 0; h < H; h++) { if (BU[h] || BT[h] || (us && S.protA[h])) continue; const v = base[h] + ae[h] + gbe[h] + acc[h]; if (v > bv) { bv = v; best = h; } }
    (us ? BU : BT)[best] = 1; addBan(best, us); seqFromE0.push(best); ep++;
  }
  const legal = new Uint8Array(H); for (let h = 0; h < H; h++) legal[h] = BU[h] || BT[h] ? 0 : 1;
  return Es.scoreMask(S, legal, BU, BT).p;
}

const out = [], rows = [], t0 = Date.now();
for (let li = 0; li < Math.min(NL, LOB.length); li++) {
  const L = LOB[li], ours = i => (ORDER[i] === 0) === L.firstUs, e0 = L.bans.length, cnt = ours(e0 + 1) ? 2 : 1;
  const st = { firstUs: L.firstUs, bans: L.bans, rev: L.shown, m: L.m, r0: L.r0, cnt };
  const P = planner(st), R = P.R;
  // first actions: every legal single, or the engine's shortlist pairs on a two-ban turn
  const acts = cnt === 2 ? R.pairs.map(p => [p.a, p.b]) : Array.from(R.V.keys()).filter(h => !isNaN(R.V[h])).map(h => [h]);
  const Vof = a => a.length === 2 ? R.pairs.find(p => p.a === a[0] && p.b === a[1]).V : R.V[a[0]];
  const a0 = acts.slice().sort((x, y) => Vof(y) - Vof(x))[0];                                  // the site today (one step)
  const G1 = P.noise(1000 + li), Qs = acts.map(a => ({ a, q: mean(P.Q(a, G1)) })).sort((x, y) => y.q - x.q), a1 = Qs[0].a;   // the lookahead's choice
  const same = String(a1) === String(a0);
  // additive score, fresh draws: lookahead continuation (both first actions) and typical continuation (engine, paired)
  const G2 = P.noise(5000 + li), q1 = P.Q(a1, G2), q0 = P.Q(a0, G2), dAddOpt = q1.map((v, s) => v - q0[s]);
  const dTyp = same ? { d: 0, se: 0 } : E.diff(R, a1.length === 2 ? a1 : a1[0], a0.length === 2 ? a0 : a0[0]);
  // simulator, fresh stand-ins and draws: 4 policies on the same runs
  const Es = new SimEngine(SM, { MU: 48, K: 96, LOOK: NR, DRAWS, seed: 777 + li }), hov6 = [-1, -1, -1, -1, -1, -1]; L.shown.forEach((h, i) => hov6[i] = h);
  const sst = { firstUs: L.firstUs, m: L.m, r0: L.r0, bans: L.bans, hov6 }, chooser = seq => P.bestNext(seq).act, js = Array.from({ length: NR }, (_, j) => j);
  const sim = { t0: [], t1: [], o0: [], o1: [] };
  for (const j of js) { const S = Es.setup(sst, j % DRAWS);
    sim.t0.push(simFuture(Es, S, L.bans, a0, j, null, e0, ours)); sim.o0.push(simFuture(Es, S, L.bans, a0, j, chooser, e0, ours));
    if (same) { sim.t1.push(sim.t0[sim.t0.length - 1]); sim.o1.push(sim.o0[sim.o0.length - 1]); }
    else { sim.t1.push(simFuture(Es, S, L.bans, a1, j, null, e0, ours)); sim.o1.push(simFuture(Es, S, L.bans, a1, j, chooser, e0, ours)); } }
  const D = (x, y) => { const d = x.map((v, i) => v - y[i]); return { d: mean(d), se: cse(js, d) }; };
  const r = { li, match: L.match, firstUs: L.firstUs, a0: nm(a0), a1: nm(a1), same, rankOfA0inQ: Qs.findIndex(x => String(x.a) === String(a0)) + 1,
    add_typ: dTyp, add_opt: { d: mean(dAddOpt), se: sdv(dAddOpt) / Math.sqrt(NP) },
    sim_typ: D(sim.t1, sim.t0), sim_opt: D(sim.o1, sim.o0), sim_planGain_a0: D(sim.o0, sim.t0), sim_planGain_a1: D(sim.o1, sim.t1) };
  rows.push(r);
  const f = x => `${pp(x.d)}±${(196 * x.se).toFixed(2)}`;
  const line = `lobby ${li + 1} (${L.firstUs ? "first" : "second"}, rank ${Math.round(L.r0)}): now ${r.a0} | lookahead ${same ? "same" : r.a1 + ` (current pick ranks ${r.rankOfA0inQ} in lookahead)`} | lookahead − current: additive typ ${f(r.add_typ)}, additive opt ${f(r.add_opt)}, sim typ ${f(r.sim_typ)}, sim opt ${f(r.sim_opt)} | planning next turn in sim: ${f(r.sim_planGain_a0)} [${Math.round((Date.now() - t0) / 1000)} s]`;
  console.log(line); out.push(line);
}
// summary across lobbies
const sum = (k, rs) => { const v = rs.map(r => r[k].d), m = mean(v), se = sdv(v) / Math.sqrt(v.length); return `${pp(m)} (±${(196 * se).toFixed(2)} across lobbies)`; };
const ch = rows.filter(r => !r.same);
const S = [`\nSUMMARY: ${rows.length} lobbies (${rows.filter(r => r.firstUs).length} first-ban, ${rows.filter(r => !r.firstUs).length} second), simulator ${NR} runs, planner ${NP} samples of their bans`,
  `lookahead changes the first ban in ${ch.length} of ${rows.length} lobbies`,
  `where it changes it, lookahead − current (points of win chance, mean over those lobbies):`,
  `  additive score, typical continuation:   ${ch.length ? sum("add_typ", ch) : "-"}`,
  `  additive score, lookahead continuation: ${ch.length ? sum("add_opt", ch) : "-"}   (fresh draws)`,
  `  simulator,      typical continuation:   ${ch.length ? sum("sim_typ", ch) : "-"}`,
  `  simulator,      lookahead continuation: ${ch.length ? sum("sim_opt", ch) : "-"}`,
  `planning our next turn (planner's choice vs a typical next turn), simulator, current first ban, all lobbies: ${sum("sim_planGain_a0", rows)}`];
console.log(S.join("\n")); out.push(...S);
fs.mkdirSync("tools/reports", { recursive: true }); fs.writeFileSync(`tools/reports/check_lookahead_${NR}_${NP}.txt`, out.join("\n") + "\n");
fs.writeFileSync(`tools/reports/check_lookahead_${NR}_${NP}.json`, JSON.stringify(rows));
