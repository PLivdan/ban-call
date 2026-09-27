/* Check the v8 simulator (sim8.js) against the notebook's own world model: the fixtures in model8/sim_v8.json were drafted
   and scored by the notebook's compiled functions (draft8, lineup_value, terminal_one, ban_probs) on the exported float16
   tables, with fixed stand-ins, bans and random numbers. The simulator must pick the same heroes, give the same win
   chance, and the same ban-model probabilities with those stand-ins. Then it times one lobby.
     node tools/check_sim_v8.js */
const fs = require("fs"), path = require("path"), { Sim8 } = require(path.join(__dirname, "..", "sim8.js"));
const dir = process.env.MODEL_DIR ? path.resolve(process.env.MODEL_DIR) : path.join(__dirname, "..", "model8"), meta = JSON.parse(fs.readFileSync(path.join(dir, "sim_v8.json"))), b = fs.readFileSync(path.join(dir, "sim_v8.bin"));
const S = new Sim8(meta, b.buffer.slice(b.byteOffset, b.byteOffset + b.length)), H = S.H, F = meta.fixtures;
let bad = 0, worstWin = 0, worstP = 0, pickDiff = 0, picks = 0;
const MU0 = S.MU, K0 = S.K; S.MU = F.mu; S.K = F.k; S.J = Math.min(meta.jban, F.mu, F.k);
for (const [i, f] of F.cases.entries()) {
  const st = { m: f.m, r0: f.r0, firstUs: f.camp === 0, you: f.shown[0], mates6: f.shown.slice(1) }, L = S.lobby(st);
  if (Math.abs(L.rs - f.rs) > 1e-5 || L.bd !== f.band) { console.log(`case ${i}: lobby differs (rank z ${L.rs} vs ${f.rs}, band ${L.bd} vs ${f.band})`); bad++; }
  const SW = S.SW, NZ = new Float64Array((F.mu + F.k) * 6 * SW * H); let o = 0;
  for (const a of f.NZ) for (const bb of a) for (const c of bb) for (const x of c) NZ[o++] = x;
  const CU = new Float64Array(F.mu * 6); f.CU.forEach((r, u) => r.forEach((x, j) => CU[u * 6 + j] = x));
  const rel = us => { const out = []; for (let j = 0; j < S.J; j++) { const v = new Float64Array(H); for (const p of f.PL[us ? j : F.mu + j]) { const sh = S.row("pool.SH", p); for (let k = 0; k < H; k++) v[k] += sh[k]; } out.push(v); } return out; };
  const D = { PL: f.PL.map(t => Int32Array.from(t)), NZ, OD: f.OD, CU, RELu: rel(true), RELo: rel(false) };
  const R = S.terminal(L, D, f.bans, true);
  R.pu.forEach((pk, u) => pk.forEach((h, j) => { picks++; if (h !== f.picks_us[u][j]) pickDiff++; }));
  R.po.forEach((pk, u) => pk.forEach((h, j) => { picks++; if (h !== f.picks_them[u][j]) pickDiff++; }));
  worstWin = Math.max(worstWin, Math.abs(R.win - f.win));
  for (let e = 0; e < 6; e++) {
    const al = new Uint8Array(H).fill(1); for (let q = 0; q < e; q++) al[f.bans[q]] = 0;
    const p = S.banProbs(L, f.bans, e, al, D.RELu, D.RELo); for (let h = 0; h < H; h++) worstP = Math.max(worstP, Math.abs(p[h] - f.ban_probs[e][h]));
  }
}
console.log(`drafts: ${picks - pickDiff} of ${picks} picks identical to the notebook's; win chance, largest difference ${worstWin.toExponential(2)}; ban model with stand-ins ${worstP.toExponential(2)}`);
if (pickDiff || worstWin > 2e-5 || worstP > 2e-6) bad++;
// timing: one lobby at the run's size
S.MU = MU0; S.K = K0; S.J = Math.min(meta.jban, MU0, K0);
const st = { m: 11, r0: 4500, firstUs: true, you: 43, mates6: [-1, -1, -1, -1, -1], bans: [] }, L = S.lobby(st);
let t = Date.now(); const D = S.draw(L, st, 1); const td = Date.now() - t;
t = Date.now(); let n = 0; for (let j = 0; j < 8; j++) { const B = S.complete(L, D, [5], j, (bans, e, al) => { const p = new Float64Array(H); let c = 0; for (let h = 0; h < H; h++) if (al[h]) c++; for (let h = 0; h < H; h++) if (al[h]) p[h] = 1 / c; return p; }); S.terminal(L, D, B); n++; }
console.log(`timing at ${MU0} x ${K0} stand-in lineups, ${S.SW} sweeps: a stand-in draw ${td} ms, a ban phase (complete + draft + score) ${((Date.now() - t) / n).toFixed(1)} ms; pool ${S.N.toLocaleString()} players`);
console.log(bad ? "CHECK FAILED" : "all checks passed"); process.exit(bad ? 1 : 0);
