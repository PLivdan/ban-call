/* Worker for the v8 re-draft simulator (sim8.js). Jobs:
   values: every candidate (a hero, a pair, or "typ": the ban a typical team makes now) for a list of runs. Run j uses stand-in
           draw j % DRAWS and the same random numbers for the rest of the ban phase whatever the candidate, so candidates are
           compared on the same lobbies. Returns P(we win) per candidate and run, and who opened what in the typical runs
           (each team, and our team seat by seat: slots[i * H + h] counts our seat i opening h).
   flow:   where the players who would open hero x go when x is banned too, on the same lobbies and draft random numbers.
   ideal:  our ideal lineup (Sim8.idealComp) over the given runs' stand-in draws.
   tree:   the Methods figure's numbers for the lobby (treeJob below).
   ending: one stand-in draw on a given six-ban path (the Methods figure): the first n lineups of each team seat by seat and
           their n x n matchup win chances. */
importScripts("sim8.js" + self.location.search, "engine8.js" + self.location.search);   // the page stamps this worker's address; the scripts share the stamp
const DRAWS = 32;
let SIM = null, E8 = null, loading = null, BASE0 = "", VQ0 = "", LAY0 = null;
const draws = new Map(), probs = new Map(), latest = {}; let lobbyNow = null, cancelBelow = 0;   // cancelBelow: values jobs with a smaller id are obsolete   // latest[type]: the newest flow or ideal job (an older one stops early)
async function load(base, v) {
  const q = v ? `?v=${v}` : "";
  const [meta, bin, lay, ban] = await Promise.all([fetch(`${base}model8/sim_v8.json${q}`).then(r => r.json()), fetch(`${base}model8/sim_v8.bin${q}`).then(r => r.arrayBuffer()),
    fetch(`${base}model8/value_v8.json${q}`).then(r => r.json()), fetch(`${base}model8/ban_v8.json${q}`).then(r => r.json())]);
  if (meta.run !== lay.run || (ban.run && ban.run !== lay.run)) throw new Error(`the simulator (${meta.run}) and the value networks (${lay.run}) come from different runs`);
  if (meta.bin_bytes !== undefined && bin.byteLength !== meta.bin_bytes) throw new Error(`sim_v8.bin: ${bin.byteLength} bytes, the release says ${meta.bin_bytes}`);
  if (meta.bin_sha256 && self.crypto && crypto.subtle) {
    const d = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bin))).map(b => b.toString(16).padStart(2, "0")).join("");
    if (d !== meta.bin_sha256) throw new Error("sim_v8.bin: its checksum does not match the release");
  }
  SIM = new Sim8(meta, bin); E8 = new Engine8(lay, ban); BASE0 = base; VQ0 = q; LAY0 = lay;
}
const lobbyKey = s => [s.m, s.r0, s.firstUs, s.you, (s.mates6 || []).join("."), (s.them6 || []).join(".")].join("|");   // their seen heroes change the draws
function drawFor(L, s, d) {
  const lk = lobbyKey(s); if (lk !== lobbyNow) { draws.clear(); probs.clear(); lobbyNow = lk; }   // keep the current lobby's draws only (about 750 KB each)
  if (draws.has(d)) return draws.get(d);
  const D = SIM.draw(L, s, Sim8.hash(20260927, d)); draws.set(d, D); return D;
}
function ourProbs(s) {                                            // a typical team's ban as the page sees the lobby, cached per ban sequence
  return (bans, e, allowed) => {
    const k = lobbyKey(s) + "#" + bans.join(","); if (probs.has(k)) return probs.get(k);
    if (probs.size > 5000) probs.clear();
    const p = E8.banProbs({ m: s.m, r0: s.r0, firstUs: s.firstUs, bans, you: s.you, mates: (s.mates6 || []).filter(h => h >= 0) }, e, allowed); probs.set(k, p); return p;
  };
}
/* tree: the Methods figure's numbers for one lobby (methods-tree.js draws them). The figure is the ban phase as you banning first:
   your first ban, their two, your two, their last. The lobby's hidden players come in three types: their stand-in teams from
   TREE_ND draws, clustered by their hero shares (k-means, three groups, the type's prior its share of the teams; your unseen
   teammates are the draws' own). Each type is played by those teams. Their bans: the ban model with the type's teams (sigma-hat_B
   given theta_B); a pair is both orders of its two bans. Your bans: the page's advice (the value networks). Values: the simulator's
   win chance after six bans with the type's teams (V6), carried back as the figure's recursion does; the folded branches are
   expectations over their bans (exact over the likely ones) or short simulated continuations with the advice for your later bans.
   One path through the figure: at your forks the page's choice, kept only if the figure's own numbers agree with it (else the
   next of the advice's ranking), at theirs their likeliest pair or ban as the page sees it (the types' mixture). */
let OPT = null;
async function loadOpt() {
  if (OPT) return OPT;
  OPT = (async () => { const f = LAY0.files.opt, b = await fetch(`${BASE0}model8/${f.path}${VQ0}`).then(r => r.arrayBuffer()); E8.addBuffer("opt", b); return true; })()
    .catch(e => { OPT = null; throw e; });
  return OPT;
}
async function treeJob(d) {
  await loadOpt();
  const H = SIM.H, MU = SIM.MU, K = SIM.K, ND = 4, s = Object.assign({}, d.st, { firstUs: true, them6: undefined, bans: [] }), L = SIM.lobby(s);
  const tick = () => new Promise(r => setTimeout(r, 0)), stale = () => d.id !== latest.tree;
  let seed = 9176; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  // ---- the types: their stand-in teams, clustered by hero shares
  const base = Array.from({ length: ND }, (_, i) => SIM.draw(L, s, Sim8.hash(20261001, i))), teams = [];
  base.forEach(D => { for (let u = MU; u < MU + K; u++) teams.push(D.PL[u]); });
  const prof = teams.map(t => { const v = new Float64Array(H); for (const p of t) { const sh = SIM.row("pool.SH", p); for (let k = 0; k < H; k++) v[k] += sh[k] / 6; } return v; });
  const dist = (a, b) => { let x = 0; for (let k = 0; k < H; k++) { const q = a[k] - b[k]; x += q * q; } return x; };
  // k-means, three groups, from 12 seeded starts: the lowest within-group spread among the splits whose smallest type holds 12%+ of
  // the teams (a type of a few odd teams is not a type), else the most even split
  const kmeans = () => { let cen = [Float64Array.from(prof[Math.floor(rnd() * prof.length)])];
    while (cen.length < 3) { const dd = prof.map(v => Math.min(...cen.map(c => dist(v, c)))), tot = dd.reduce((a, b) => a + b, 0); let r = rnd() * tot, i = 0;
      for (; i < dd.length - 1; i++) { r -= dd[i]; if (r <= 0) break; } cen.push(Float64Array.from(prof[i])); }
    let asg = new Int32Array(prof.length);
    for (let it = 0; it < 30; it++) {
      asg = Int32Array.from(prof.map(v => { let b = 0; for (let c = 1; c < 3; c++) if (dist(v, cen[c]) < dist(v, cen[b])) b = c; return b; }));
      cen = [0, 1, 2].map(c => { const m = new Float64Array(H); let n = 0; prof.forEach((v, i) => { if (asg[i] === c) { n++; for (let k = 0; k < H; k++) m[k] += v[k]; } });
        if (!n) return cen[c]; for (let k = 0; k < H; k++) m[k] /= n; return m; });
    }
    const sizes = [0, 1, 2].map(c => asg.filter(x => x === c).length), sse = prof.reduce((t, v, i) => t + dist(v, cen[asg[i]]), 0);
    return { cen, asg, sse, minShare: Math.min(...sizes) / prof.length }; };
  const runs = Array.from({ length: 12 }, kmeans), okRuns = runs.filter(r => r.minShare >= .12);
  const best = okRuns.length ? okRuns.reduce((a, b) => b.sse < a.sse ? b : a) : runs.reduce((a, b) => b.minShare > a.minShare ? b : a), cen = best.cen, asg = best.asg;
  const groups = [0, 1, 2].map(c => ({ c, mem: prof.map((_, i) => i).filter(i => asg[i] === c) })).filter(g => g.mem.length).sort((a, b) => b.mem.length - a.mem.length);
  if (groups.length < 3) throw new Error("the stand-in teams fall into fewer than three types");
  const types = groups.map(g => { const m = cen[g.c], top = Array.from(m.keys()).sort((a, b) => m[b] - m[a]).slice(0, 3); return { prior: g.mem.length / prof.length, mains: top }; });
  const WS = [0, 1, 2], PRIOR = types.map(t => t.prior);
  const DW = groups.map(g => base.map((B, dd) => { const PL = B.PL.slice(0, MU); for (let k = 0; k < K; k++) PL.push(teams[g.mem[(k + 5 * dd) % g.mem.length]]);
    return { PL, NZ: B.NZ, OD: B.OD, CU: B.CU, RELu: B.RELu, RELo: SIM.relOf(PL, false) }; }));
  // ---- the model's pieces: the win chance after six bans, their bans in a type, the page's advice
  const Vc = new Map(), V = (w, bans, nd = ND) => { const k = w + "|" + nd + "|" + bans.join(","); if (Vc.has(k)) return Vc.get(k);
    let x = 0; for (let i = 0; i < nd; i++) x += SIM.terminal(L, DW[w][i], bans); Vc.set(k, x / nd); return x / nd; };
  const allowed = bans => { const a = new Uint8Array(H).fill(1); for (const h of bans) a[h] = 0; return a; };
  const Pc = new Map(), pT = (w, bans) => { const k = w + "|" + bans.join(","); if (Pc.has(k)) return Pc.get(k);
    const al = allowed(bans), p = new Float64Array(H); for (let i = 0; i < ND; i++) { const D = DW[w][i], q = SIM.banProbs(L, bans, bans.length, al, D.RELu, D.RELo); for (let h = 0; h < H; h++) p[h] += q[h] / ND; }
    Pc.set(k, p); return p; };
  const pairP = (w, pre) => { const p1 = pT(w, pre), M = new Map();
    for (let x = 0; x < H; x++) { if (p1[x] < 1e-7) continue; const p2 = pT(w, pre.concat([x]));
      for (let y = 0; y < H; y++) if (p2[y] > 0) { const k = Math.min(x, y) * H + Math.max(x, y); M.set(k, (M.get(k) || 0) + p1[x] * p2[y]); } }
    return M; };
  const pairOf = k => [Math.floor(k / H), k % H];
  const es = bans => ({ m: s.m, r0: s.r0, firstUs: true, bans: bans.slice(), you: s.you, mates: (s.mates6 || []).filter(h => h >= 0) });
  const ourPair = bans => { const st = es(bans), R = E8.ourTurn(st); if (!R) throw new Error("the value networks are not ready"); const q = E8.sequence(st, R); return [q.a, q.b]; };
  // in the simulated continuations (folded branches), your pair follows the advice's ranking at the main path's pair turn, skipping
  // heroes already banned: the networks once, not at every simulated state (they were nine tenths of the time)
  let RANK3 = null; const fastPair = bans => { const o = RANK3.filter(h => !bans.includes(h)); return [o[0], o[1]]; };
  const sampleMap = (M, skip) => { let tot = 0; for (const [k, v] of M) if (!skip.has(k)) tot += v; let r = rnd() * tot;
    for (const [k, v] of M) { if (skip.has(k)) continue; r -= v; if (r <= 0) return k; } for (const [k] of M) if (!skip.has(k)) return k; return null; };
  const sampleP = p => { let tot = 0; for (const x of p) tot += x; let r = rnd() * tot; for (let h = 0; h < H; h++) { r -= p[h]; if (r <= 0) return h; } return p.indexOf(Math.max(...p)); };
  // their last ban, in expectation: exact over the bans with 0.4%+ (renormalised), the win chances on two draws
  const lastEV = (w, b5) => { const p = pT(w, b5); let m = 0, x = 0; for (let h = 0; h < H; h++) if (p[h] >= .004) { m += p[h]; x += p[h] * V(w, b5.concat([h]), 2); } return x / m; };
  const dot = (a, b) => a.reduce((t, x, i) => t + x * b[i], 0), bayes = (pi, p) => { const u = pi.map((x, i) => x * p[i]), t = u.reduce((a, b) => a + b, 0); return u.map(x => x / t); };
  const MC = 12;                                                                   // simulated continuations per type for a folded branch
  const rollFrom = async (w, pre) => { let x = 0;                                  // pre: our first ban; then their pair (sampled), our pair (advice), their last (sampled)
    for (let r = 0; r < MC; r++) { const M = pairP(w, pre), b3 = pre.concat(pairOf(sampleMap(M, new Set()))), b5 = b3.concat(fastPair(b3)); x += V(w, b5.concat([sampleP(pT(w, b5))]), 1); if (r % 4 === 3) await tick(); }
    return x / MC; };
  // ---- A1: your first ban
  const R0 = E8.ourTurn(es([])); if (!R0) throw new Error("the value networks are not ready");
  const rank0 = R0.cands.slice().sort((a, b) => R0.score(b) - R0.score(a));
  await tick(); if (stale()) return null;
  // the rest of the path for a first ban a1, and its value in each type
  const pathFrom = async a1 => {
    const MP = WS.map(w => pairP(w, [a1])), mix = new Map(); MP.forEach((M, w) => { for (const [k, v] of M) mix.set(k, (mix.get(k) || 0) + PRIOR[w] * v); });
    const top = Array.from(mix.keys()).sort((a, b) => mix.get(b) - mix.get(a)), k0 = top[0], k1 = top[1];
    const B2 = { kids: [{ b: pairOf(k0), p: WS.map(w => MP[w].get(k0) || 0) }, { b: pairOf(k1), p: WS.map(w => MP[w].get(k1) || 0) }, { more: Math.max(0, mix.size - 2) }] };
    B2.kids[2].p = WS.map(w => Math.max(0, 1 - B2.kids[0].p[w] - B2.kids[1].p[w]));
    const s3 = [a1].concat(B2.kids[0].b), post3 = bayes(PRIOR, B2.kids[0].p);
    // A2: your pair, the advice's; the alternative the advice's next distinct pair, kept below the advice in the figure's numbers
    const R3 = E8.ourTurn(es(s3)), q = E8.sequence(es(s3), R3), pk = [q.a, q.b]; if (!RANK3) RANK3 = [q.a, q.b].concat(R3.cands.slice().sort((a, b) => R3.score(b) - R3.score(a)).filter(h => h !== q.a && h !== q.b)); const key = p => Math.min(p[0], p[1]) + "," + Math.max(p[0], p[1]);
    const alts = E8.pairs(es(s3), R3).filter(p => key([p.a, p.b]) !== key(pk)).map(p => [p.a, p.b]);
    const s5 = s3.concat(pk), mixL = new Float64Array(H), PL5 = WS.map(w => pT(w, s5)); WS.forEach(w => { for (let h = 0; h < H; h++) mixL[h] += post3[w] * PL5[w][h]; });
    const lt = Array.from(mixL.keys()).filter(h => !s5.includes(h)).sort((a, b) => mixL[b] - mixL[a]), l0 = lt[0], l1 = lt[1];
    const B1 = { kids: [{ b: [l0], p: WS.map(w => PL5[w][l0]), leaf: WS.map(w => 100 * V(w, s5.concat([l0]))) }, { b: [l1], p: WS.map(w => PL5[w][l1]), leaf: WS.map(w => 100 * V(w, s5.concat([l1]))) },
                         { more: lt.length - 2, p: WS.map(w => Math.max(0, 1 - PL5[w][l0] - PL5[w][l1])) }] };
    B1.kids[2].v = WS.map(w => { const p = PL5[w]; let m = 0, x = 0; for (const h of lt.slice(2)) if (p[h] >= .004) { m += p[h]; x += p[h] * V(w, s5.concat([h]), 2); } return m ? 100 * x / m : B1.kids[0].leaf[w]; });
    await tick(); if (stale()) return null;
    const wB1 = WS.map(w => B1.kids.reduce((t, k) => t + k.p[w] * (k.leaf ? k.leaf[w] : k.v[w]), 0));
    let alt = null, altV = null;
    for (const a of alts.slice(0, 4)) { const v = WS.map(w => 100 * lastEV(w, s3.concat(a))); if (dot(post3, v) < dot(post3, wB1)) { alt = a; altV = v; break; } await tick(); if (stale()) return null; }
    if (!alt) { alt = alts[0]; altV = WS.map(w => 100 * lastEV(w, s3.concat(alt))); }
    const nPairs = (n => n * (n - 1) / 2)(R3.cands.length);
    const A2 = { kids: [{ b: pk, to: "B1" }, { b: alt, v: altV }, { more: Math.max(0, nPairs - 2) }] };
    // B2's other branches: their second likeliest pair, then the advice's pair and their last; the rest, simulated continuations
    const s3b = [a1].concat(B2.kids[1].b), pkb = ourPair(s3b); B2.kids[1].v = WS.map(w => 100 * lastEV(w, s3b.concat(pkb)));
    await tick(); if (stale()) return null;
    const skip = new Set([k0, k1]); B2.kids[2].v = [];
    for (const w of WS) { let x = 0; for (let r = 0; r < MC; r++) { const b3 = [a1].concat(pairOf(sampleMap(MP[w], skip))), b5 = b3.concat(fastPair(b3)); x += V(w, b5.concat([sampleP(pT(w, b5))]), 1); }
      B2.kids[2].v.push(100 * x / MC); await tick(); if (stale()) return null; }
    const wA2 = wB1, wB2 = WS.map(w => B2.kids[0].p[w] * wA2[w] + B2.kids[1].p[w] * B2.kids[1].v[w] + B2.kids[2].p[w] * B2.kids[2].v[w]);
    return { B2, A2, B1, s5, l0, wB2 };
  };
  const P0 = await pathFrom(R0.best); if (!P0) return null;
  // A1's alternative: the advice's next first ban whose simulated value stays below the advice's in the figure's numbers
  let alt1 = null, alt1V = null, fb = null;
  for (const a of rank0.filter(h => h !== R0.best).slice(0, 4)) { const v = []; for (const w of WS) v.push(100 * await rollFrom(w, [a])); if (stale()) return null;
    if (dot(PRIOR, v) < dot(PRIOR, P0.wB2)) { alt1 = a; alt1V = v; break; } if (!fb) fb = [a, v]; }
  if (alt1 === null) [alt1, alt1V] = fb;
  const A1 = { kids: [{ b: [R0.best], to: "B2" }, { b: [alt1], v: alt1V }, { more: Math.max(0, R0.cands.length - 2) }] };
  // the endings the figure opens (their two named last bans, each type): the first draw's 28 x 28 matchups and every drafted lineup,
  // seat by seat (the hero picked, and whether the player's main was banned so they switched)
  const n = MU, grids = P0.B1.kids.slice(0, 2).map(k => WS.map(w => { const ex = SIM.terminal(L, DW[w][0], P0.s5.concat(k.b), true, MU).ex, side = a => a.map(x => ({ p: x.picks, f: x.forced.map((y, i) => y && x.banned[i]), m: x.mains }));
    const path = P0.s5.concat(k.b);                                     // who banned each hero (you ban first in the figure)
    return { pairs: Array.from({ length: n * n }, (_, i) => 100 * ex.pairs[i]), us: side(ex.us), them: side(ex.them), bans: path.map((h, e) => ({ h, us: !!L.ourpos[e] })) }; }));
  return { live: true, types, tree: { A1, B2: P0.B2, A2: P0.A2, B1: P0.B1 }, grid: grids[0][0].pairs, grids, n, mu: MU, k: K, banSecond: !d.st.firstUs };
}

onmessage = async ev => {
  const d = ev.data; if (d.type === "flow" || d.type === "ideal" || d.type === "tree") latest[d.type] = d.id;
  if (d.type === "cancel") { cancelBelow = Math.max(cancelBelow, d.below); return; }   // the page moved to a newer lobby
  try {
    if (!SIM) { loading = loading || load(d.base || "", d.v).catch(e => { loading = null; throw e; }); await loading; }   // a failed load is tried again on the next job
    if (d.type === "warm") { postMessage({ id: d.id, done: true }); return; }       // the page loads the model before the first lobby
    if (d.type === "tree") { const r = await treeJob(d); if (r) postMessage({ id: d.id, done: true, tree: r }); return; }   // stale: a newer lobby's job runs
    const s = d.st, L = SIM.lobby(s), op = ourProbs(s), H = SIM.H;
    if (d.type === "flow") {
      const us = new Float64Array(H), them = new Float64Array(H); let nu = 0, nt = 0, n = 0;
      for (const [t, j] of d.runs.entries()) {
        if (t && t % 4 === 0) { await new Promise(r => setTimeout(r, 0)); if (d.id !== latest.flow) return; }   // let a newer flow job in; this one is stale
        const D = drawFor(L, s, j % DRAWS), B = SIM.complete(L, D, s.bans, j, op); if (B.includes(d.h)) continue;
        const A = SIM.terminal(L, D, B, true), X = SIM.terminal(L, D, B.concat([d.h]), true, 0, true); n++;   // x is our advised ban
        A.pu.forEach((pk, u) => pk.forEach((h, i) => { if (h === d.h) { us[X.pu[u][i]]++; nu++; } }));
        A.po.forEach((pk, u) => pk.forEach((h, i) => { if (h === d.h) { them[X.po[u][i]]++; nt++; } }));
      }
      postMessage({ id: d.id, done: true, flow: { us: Array.from(us), them: Array.from(them), nu, nt, runs: n, mu: SIM.MU, k: SIM.K } });
      return;
    }
    if (d.type === "ideal") {                                      // our ideal lineup for this lobby (Sim8.idealComp), over d.runs stand-in draws
      const runs = [];
      for (const [t, j] of d.runs.entries()) {
        if (t) { await new Promise(r => setTimeout(r, 0)); if (d.id !== latest.ideal) return; }   // a newer lobby: stop
        const D = drawFor(L, s, j % DRAWS), B = SIM.complete(L, D, s.bans, j, op); runs.push({ D, B, r: SIM.terminal(L, D, B, true) });
      }
      const legal = new Uint8Array(H).fill(1); for (const h of s.bans) legal[h] = 0;
      const R = SIM.idealComp(L, runs, legal, d.thr);
      postMessage({ id: d.id, done: true, ideal: { A: Array.from(R.A), pick: R.pick, shown: R.shown, v: R.v, typical: R.typical } });
      return;
    }
    if (d.type === "ending") {
      const n = d.n || 9, D = drawFor(L, s, d.draw || 0), r = SIM.terminal(L, D, d.bans, true, n);
      postMessage({ id: d.id, done: true, ending: { n, win: r.win, us: r.ex.us, them: r.ex.them, pairs: r.ex.pairs, mu: SIM.MU, k: SIM.K } });
      return;
    }
    // d.plan (test layout): our remaining bans as the page advises them, by position; a planned hero their bans have taken falls back
    // to how a typical team bans. Without it, all of our later bans are a typical team's (the main page)
    const opv = d.plan ? (bans, e, allowed) => { const h = d.plan[e]; if (h !== undefined && allowed[h]) { const p = new Float64Array(H); p[h] = 1; return p; } return op(bans, e, allowed); } : op;
    const vals = {}, acc = { us: new Float64Array(H), them: new Float64Array(H), av: new Float64Array(H), slots: new Float64Array(6 * H), nu: 0, nt: 0, runs: 0, roles: SIM.ROLE, splits: { us: {}, them: {} } };
    const seen = (s.them6 || []).map((h, j) => [h, j]).filter(([h]) => h >= 0), swap = {}; for (const [, j] of seen) swap[j] = new Float64Array(H);   // their entered seats: likely switches
    for (const c of d.cands) vals[String(c)] = {};
    for (const [t, j] of d.runs.entries()) {
      // every second run, let a cancel message in; an obsolete batch stops and reports itself, so the page frees this worker
      if (t && t % 2 === 0) { await new Promise(r => setTimeout(r, 0)); if (d.id < cancelBelow) { postMessage({ id: d.id, done: true, stale: true }); return; } }
      const D = drawFor(L, s, j % DRAWS);
      for (const c of d.cands) {
        const pre = c === "typ" ? s.bans : s.bans.concat(Array.isArray(c) ? c : [c]), B = SIM.complete(L, D, pre, j, opv);
        if (c === "typ" && d.opens) { const r = SIM.terminal(L, D, B, true); vals.typ[j] = r.win; Sim8.opens(H, r, acc, B);
          if (seen.length) { const lg = new Uint8Array(H).fill(1); for (const b of B) lg[b] = 0; for (const [h, jj] of seen) { const q = SIM.swapProbs(L, D, jj, lg, h); for (let k = 0; k < H; k++) swap[jj][k] += q[k]; } } }
        else vals[String(c)][j] = SIM.terminal(L, D, B);
      }
    }
    postMessage({ id: d.id, done: true, vals, opens: d.opens ? { us: Array.from(acc.us), them: Array.from(acc.them), av: Array.from(acc.av), slots: Array.from(acc.slots), nu: acc.nu, nt: acc.nt, runs: acc.runs, splits: acc.splits, swap: Object.fromEntries(Object.entries(swap).map(([k, v]) => [k, Array.from(v)])) } : null });
  } catch (e) { postMessage({ id: d.id, error: String(e && e.stack || e) }); }
};
