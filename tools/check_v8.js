/* Checks engine8.js against the notebook (run from the repo root: node tools/check_v8.js).
   1. Value networks: every parity case of the run (float16 weights, the notebook's input), for all five members; the input
      the page builds from the same lobby must equal the notebook's input exactly.
   2. Ban model: the probabilities for 40 random states against the notebook's formula with the fitted parameters
      (tools/check_v8_ref.py writes them).
   3. The advice on random lobbies: finite values, the advice supported, pairs on two-ban turns, and timings. */
const fs = require("fs"), { Engine8 } = require("../engine8.js");
const L = JSON.parse(fs.readFileSync("model8/value_v8.json", "utf8")), BAN = JSON.parse(fs.readFileSync("model8/ban_v8.json", "utf8"));
const E = new Engine8(L, BAN);
const ab = f => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
E.addBuffer("opt", ab("model8/value_opt.bin")); E.addBuffer("aux", ab("model8/value_aux.bin"));
const H = E.H, O = E.O, out = []; let bad = 0; const log = s => { console.log(s); out.push(s); };
// ---- 1. parity
const PAR = JSON.parse(fs.readFileSync("model8/parity_v8.json", "utf8")); let worstL = 0, worstX = 0;
const members = [["optimal", 0], ["optimal", 1], ["optimal", 2], ["behaviour", 0], ["robust", 0]];
for (const c of PAR.cases) {
  const x = new Float64Array(E.FD); for (const [j, v] of c.input_nonzero) x[j] = v;
  const at = (blk, n) => { const o = []; for (let k = 0; k < n; k++) if (x[O[blk] + k]) o.push(k); return o; };
  const s = { m: at("map", E.NM)[0], r0: x[O.rank_z] * L.rank_sd + L.rank_mean, firstUs: x[O.we_ban_first] === 1, bans: c.bans, you: (at("your_hero", H)[0] ?? -1), mates: at("teammates_heroes", H) };
  const mine = E.input(s, c.position); for (let j = 0; j < E.FD; j++) worstX = Math.max(worstX, Math.abs(mine[j] - x[j]));
  if (E.band(s.r0) !== at("band", E.NB)[0]) { bad++; log(`  band mismatch in a parity case: ${E.band(s.r0)} against ${at("band", E.NB)[0]}`); }
  members.forEach(([ch, m], k) => { worstL = Math.max(worstL, Math.abs(E.logit(c.position, ch, m, x) - c.logits[k])); });
}
log(`value networks: ${PAR.cases.length} parity cases x 5 members, largest logit difference ${worstL.toExponential(2)}; page input against the notebook's ${worstX.toExponential(2)}`);
if (worstL > 2e-4 || worstX > 1e-5) { bad++; log("  FAIL"); }
// ---- 2. ban model
const REF = JSON.parse(fs.readFileSync("tools/reports/check_v8_ban.json", "utf8")); let worstP = 0;
for (const c of REF.cases) {
  const s = { m: c.m, r0: c.r0, firstUs: c.firstUs, bans: c.bans, you: c.you, mates: c.mates }, e = c.bans.length, legal = E.legal(s), shown = E.shownSet(s);
  const allowed = new Uint8Array(H); for (let h = 0; h < H; h++) allowed[h] = legal[h] && !(E.ours(s.firstUs, e) && shown.has(h)) ? 1 : 0;
  const p = E.banProbs(s, e, allowed); for (let h = 0; h < H; h++) worstP = Math.max(worstP, Math.abs(p[h] - c.p[h]));
}
log(`ban model: ${REF.cases.length} states against the notebook's formula with the fitted parameters, largest probability difference ${worstP.toExponential(2)} (export rounding ${REF.export_rounding_max.toExponential(2)})`);
if (worstP > 1e-4) { bad++; log("  FAIL"); }
// ---- 3. the advice on random lobbies
let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const tiers = [4050, 4250, 4450, 4550, 4650, 4850, 5050]; let n = 0, tOur = 0, tPair = 0, tThem = 0, nPair = 0, nThem = 0, unsupported = 0, agree = 0;
for (let i = 0; i < 30; i++) {
  const heroes = Array.from({ length: H }, (_, k) => k).sort(() => rnd() - .5), e = Math.floor(rnd() * 6), m = Math.floor(rnd() * E.NM);
  const s = { m: m === 15 ? 3 : m, r0: tiers[Math.floor(rnd() * tiers.length)], firstUs: rnd() < .5, bans: heroes.slice(0, e), you: rnd() < .75 ? heroes[e] : -1, mates: heroes.slice(e + 1, e + 1 + Math.floor(rnd() * 3)) };
  if (E.ours(s.firstUs, e)) {
    let t = performance.now(); const R = E.ourTurn(s); tOur += performance.now() - t; n++;
    const fin = R.cands.every(h => isFinite(R.V[h]) && isFinite(R.sd[h])); if (!fin) { bad++; log(`  non-finite values in lobby ${i}`); }
    if (R.supported.size && !R.supported.has(R.best)) unsupported++;
    if (R.votes.every(v => v === R.best)) agree++;
    const two = e + 1 < 6 && E.ours(s.firstUs, e + 1);
    if (two) { t = performance.now(); const P = E.pairs(s, R); tPair += performance.now() - t; nPair++; if (!P || !P.length || !isFinite(P[0].V)) { bad++; log(`  no pairs in lobby ${i}`); } }
  } else { const t = performance.now(); const T = E.theirTurn(s); tThem += performance.now() - t; nThem++; let sp = 0; for (let h = 0; h < H; h++) sp += T.pe[h]; if (Math.abs(sp - 1) > 1e-9) { bad++; log(`  their forecast sums to ${sp}`); } }
}
log(`advice on ${n} of our turns (${agree} with all three members agreeing on the ban, ${unsupported} outside the support): ${(tOur / Math.max(n, 1)).toFixed(0)} ms each; ${nPair} two-ban turns, pairs ${(tPair / Math.max(nPair, 1)).toFixed(0)} ms; ${nThem} of their turns ${(tThem / Math.max(nThem, 1)).toFixed(0)} ms`);
if (unsupported) { bad++; log("  FAIL: advice outside the support"); }
log(bad ? `${bad} problem(s)` : "all checks passed");
fs.writeFileSync("tools/reports/check_v8.txt", out.join("\n") + "\n"); process.exit(bad ? 1 : 0);
