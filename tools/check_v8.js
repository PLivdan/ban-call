/* Checks engine8.js against the notebook (run from the repo root: node tools/check_v8.js).
   1. Value networks: every parity case of the run (float16 weights, the notebook's input), for all five members (v8.1) or
      the student's three outputs (v8.2 on); the input the page builds from the same lobby must equal the notebook's input
      exactly.
   2. Ban model: the probabilities for 40 random states against the notebook's formula with the fitted parameters
      (tools/check_v8_ref.py writes them). From v8.3 also whole turns as the notebook computed them with the float16
      students and the exported tables: every candidate's value, spread and typical-ban probability, and the advice.
   3. The advice on random lobbies: finite values, the advice supported, pairs on two-ban turns, and timings. */
const fs = require("fs"), { Engine8 } = require("../engine8.js"), MD = process.env.MODEL_DIR || "model8";   // MODEL_DIR: a staged bundle (tools/build_site_v8.py)
const L = JSON.parse(fs.readFileSync(`${MD}/value_v8.json`, "utf8")), BAN = JSON.parse(fs.readFileSync(`${MD}/ban_v8.json`, "utf8"));
const E = new Engine8(L, BAN);
const ab = f => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
for (const f of Object.keys(L.files)) E.addBuffer(f, ab(`${MD}/${L.files[f].path}`));
const H = E.H, O = E.O, out = []; let bad = 0; const log = s => { console.log(s); out.push(s); };
// ---- 1. parity
const PAR = JSON.parse(fs.readFileSync(`${MD}/parity_v8.json`, "utf8")); let worstL = 0, worstX = 0;
const members = [["optimal", 0], ["optimal", 1], ["optimal", 2], ["behaviour", 0], ["robust", 0]];
for (const c of PAR.cases) {
  const x = new Float64Array(E.FD); for (const [j, v] of c.input_nonzero) x[j] = v;
  const at = (blk, n) => { const o = []; for (let k = 0; k < n; k++) if (x[O[blk] + k]) o.push(k); return o; };
  const s = { m: at("map", E.NM)[0], r0: x[O.rank_z] * L.rank_sd + L.rank_mean, firstUs: x[O.we_ban_first] === 1, bans: c.bans, you: (at("your_hero", H)[0] ?? -1), mates: at("teammates_heroes", H) };
  const mine = E.input(s, c.position); for (let j = 0; j < E.FD; j++) worstX = Math.max(worstX, Math.abs(mine[j] - x[j]));
  if (E.band(s.r0) !== at("band", E.NB)[0]) { bad++; log(`  band mismatch in a parity case: ${E.band(s.r0)} against ${at("band", E.NB)[0]}`); }
  if (E.S) E.outputs(c.position, x).forEach((v, k) => { worstL = Math.max(worstL, Math.abs(v - c.outputs[k])); });
  else members.forEach(([ch, m], k) => { worstL = Math.max(worstL, Math.abs(E.logit(c.position, ch, m, x) - c.logits[k])); });
}
log(`value networks: ${PAR.cases.length} parity cases x ${E.S ? "the student's 3 outputs" : "5 members"}, largest output difference ${worstL.toExponential(2)}; page input against the notebook's ${worstX.toExponential(2)}`);
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
if (PAR.turns) {                                           // v8.3: whole turns, the notebook's float16 students and exported tables
  let wm = 0, ws = 0, wp = 0, same = 0, ours = 0;
  for (const t of PAR.turns) {
    const s = t.state;
    if (t.ours) {
      const R = E.ourTurn(s); ours++; if (R.best === t.best) same++; else log(`  turn at position ${t.position}: the page advises ${L.heroes[R.best]}, the notebook ${L.heroes[t.best]}`);
      t.cands.forEach((h, k) => { wm = Math.max(wm, Math.abs(R.mu[h] - t.mu[k])); ws = Math.max(ws, Math.abs(R.sd[h] - t.sd[k])); wp = Math.max(wp, Math.abs(R.pe[h] - t.pe[k])); });
    } else { const T = E.theirTurn(s); t.cands.forEach((h, k) => { wp = Math.max(wp, Math.abs(T.pe[h] - t.pe[k])); }); }
  }
  log(`whole turns: ${PAR.turns.length} (${ours} ours), same advice ${same} of ${ours}; largest difference in value ${wm.toExponential(2)}, spread ${ws.toExponential(2)}, ban probability ${wp.toExponential(2)}`);
  if (same < ours || wm > 1e-4 || ws > 1e-4 || wp > 1e-4) { bad++; log("  FAIL"); }
}
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
    const runner = R.cands.filter(h => h !== R.best).sort((a, b) => R.V[b] - R.V[a])[0]; if (runner === undefined || R.clear(R.best, runner)) agree++;
    const sp = R.spread(R.best); if (!(sp.lo <= R.V[R.best] + 1e-12 && R.V[R.best] <= sp.hi + 1e-12) && !E.S) { bad++; log(`  the advice's value outside its members' range in lobby ${i}`); }
    if (E.S && !(R.cands.every(h => R.sd[h] >= 0))) { bad++; log(`  negative spread in lobby ${i}`); }
    const two = e + 1 < 6 && E.ours(s.firstUs, e + 1);
    if (two) { t = performance.now(); const P = E.pairs(s, R); tPair += performance.now() - t; nPair++; if (!P || !P.length || !isFinite(P[0].V)) { bad++; log(`  no pairs in lobby ${i}`); } }
  } else { const t = performance.now(); const T = E.theirTurn(s); tThem += performance.now() - t; nThem++; let sp = 0; for (let h = 0; h < H; h++) sp += T.pe[h]; if (Math.abs(sp - 1) > 1e-9) { bad++; log(`  their forecast sums to ${sp}`); } }
}
log(`advice on ${n} of our turns (${agree} clear of the runner-up, ${unsupported} outside the support): ${(tOur / Math.max(n, 1)).toFixed(0)} ms each; ${nPair} two-ban turns, pairs ${(tPair / Math.max(nPair, 1)).toFixed(0)} ms; ${nThem} of their turns ${(tThem / Math.max(nThem, 1)).toFixed(0)} ms`);
if (unsupported) { bad++; log("  FAIL: advice outside the support"); }
// ---- 4. two-ban turns as the page advises them (the recommendation the page shows, not only ourTurn): the advised first ban,
// then the advice again at the state after it, the support rule at both states, both camps; and the pairs shown for comparison
// only among supported first bans and bans supported after them. States where the highest raw score is an unsupported ban are
// counted: the advice must still be supported there.
const supAt = (s, e, h) => { const L_ = E.legal(s), sh = E.shownSet(s), al = new Uint8Array(H); let any = false;
  for (let k = 0; k < H; k++) al[k] = L_[k] && !(E.ours(s.firstUs, e) && sh.has(k)) ? 1 : 0;
  const p = E.banProbs(s, e, al); for (let k = 0; k < H; k++) if (al[k] && p[k] >= E.SUPP) any = true; return !any || p[h] >= E.SUPP; };
let nTwo = 0, seqBad = 0, pairBad = 0, rare = 0, camps = new Set();
for (let i = 0; i < 200 && nTwo < 24; i++) {
  const heroes = Array.from({ length: H }, (_, k) => k).sort(() => rnd() - .5), firstUs = rnd() < .5;
  const e = [1, 2, 3, 4, 5].find(k => k + 1 < 6 && E.ours(firstUs, k) && E.ours(firstUs, k + 1) && rnd() < .7); if (e === undefined) continue;
  const s = { m: Math.floor(rnd() * E.NM), r0: tiers[Math.floor(rnd() * tiers.length)], firstUs, bans: heroes.slice(0, e), you: rnd() < .75 ? heroes[e] : -1, mates: heroes.slice(e + 1, e + 1 + Math.floor(rnd() * 3)) };
  const R = E.ourTurn(s), Q = E.sequence(s, R), P = E.pairs(s, R, 6, true) || []; nTwo++; camps.add(firstUs);
  const s2 = Object.assign({}, s, { bans: s.bans.concat([Q.a]) }), R2 = E.ourTurn(s2);
  if (Q.a !== R.best || Q.b !== R2.best || !supAt(s, e, Q.a) || !supAt(s2, e + 1, Q.b)) { seqBad++; log(`  two-ban turn ${i}: the sequence ${L.heroes[Q.a]}, ${L.heroes[Q.b]} breaks the policy`); }
  for (const p of P.slice(0, 12)) if (!supAt(s, e, p.a) || !supAt(Object.assign({}, s, { bans: s.bans.concat([p.a]) }), e + 1, p.b)) pairBad++;
  const raw = R.cands.reduce((b, h) => (R.mu[h] - E.KAPPA * R.sd[h] > R.mu[b] - E.KAPPA * R.sd[b] ? h : b), R.cands[0]); if (!supAt(s, e, raw)) rare++;
}
log(`two-ban turns as the page advises them: ${nTwo} (camps: ${[...camps].map(f => f ? "first" : "second").join(", ")}), advice = the advised ban then the advice again, supported at both states: ${nTwo - seqBad} of ${nTwo}; `
  + `compared pairs outside the support: ${pairBad}; states where the highest raw score is unsupported: ${rare} (the advice was supported in all of them)`);
if (seqBad || pairBad) { bad++; log("  FAIL: a two-ban recommendation or a compared pair breaks the policy"); }
// the same with a stricter support threshold on a copy of the engine (5%), so the best raw score is often a rare ban
{
  const E5 = new Engine8(L, BAN); for (const f of Object.keys(L.files)) E5.addBuffer(f, ab(`${MD}/${L.files[f].path}`)); E5.SUPP = .05;
  const sup5 = (s, e, h) => { const L_ = E5.legal(s), sh = E5.shownSet(s), al = new Uint8Array(H); let any = false;
    for (let k = 0; k < H; k++) al[k] = L_[k] && !(E5.ours(s.firstUs, e) && sh.has(k)) ? 1 : 0;
    const p = E5.banProbs(s, e, al); for (let k = 0; k < H; k++) if (al[k] && p[k] >= E5.SUPP) any = true; return !any || p[h] >= E5.SUPP; };
  let hit = 0, broke = 0, tried = 0;
  for (let i = 0; i < 300 && hit < 10; i++) {
    const heroes = Array.from({ length: H }, (_, k) => k).sort(() => rnd() - .5), firstUs = rnd() < .5;
    const e = [1, 2, 3, 4, 5].find(k => k + 1 < 6 && E5.ours(firstUs, k) && E5.ours(firstUs, k + 1)); if (e === undefined) continue;
    const s = { m: Math.floor(rnd() * E5.NM), r0: tiers[Math.floor(rnd() * tiers.length)], firstUs, bans: heroes.slice(0, e), you: heroes[e], mates: [] }; tried++;
    const R = E5.ourTurn(s), raw = R.cands.reduce((b, h) => (R.mu[h] - E5.KAPPA * R.sd[h] > R.mu[b] - E5.KAPPA * R.sd[b] ? h : b), R.cands[0]);
    if (sup5(s, e, raw)) continue; hit++;
    const Q = E5.sequence(s, R), P = E5.pairs(s, R, 6, true) || [];
    if (!sup5(s, e, Q.a) || !sup5(Object.assign({}, s, { bans: s.bans.concat([Q.a]) }), e + 1, Q.b) || P.some(p => !sup5(s, e, p.a))) broke++;
  }
  log(`with a 5% support threshold: ${hit} two-ban states where the best raw score is a rare ban; the advice and the compared pairs stayed supported in ${hit - broke} of them`);
  if (!hit || broke) { bad++; log("  FAIL: the rare-ban case was not exercised or the advice left the support"); }
}
// ---- 5. bad weight files are refused before any forecast: empty, truncated, oversized, a value that decodes to NaN
{
  const f0 = Object.keys(L.files)[0], good = ab(`${MD}/${L.files[f0].path}`); let refused = 0;
  const nan = good.slice(0); new Uint16Array(nan)[5] = 0x7e00;
  const cases = [["empty", new ArrayBuffer(0)], ["truncated", good.slice(0, good.byteLength >> 1)], ["oversized", (() => { const x = new Uint8Array(good.byteLength + 2); x.set(new Uint8Array(good)); return x.buffer; })()], ["NaN weight", nan]];
  for (const [nm, buf] of cases) { const E2 = new Engine8(L, BAN); try { E2.addBuffer(f0, buf); log(`  FAIL: a ${nm} weight file was accepted`); } catch (e) { refused++; } if (E2.ready("optimal")) { bad++; log(`  FAIL: ready after a ${nm} file`); } }
  log(`bad weight files refused before any forecast: ${refused} of ${cases.length} (empty, truncated, oversized, a NaN weight)`); if (refused < cases.length) bad++;
}
// ---- 6. complete decisions against an independent transcription of the exported policy (tools/check_decisions.py): the
// advice the page shows on every own turn, both camps, ordered histories and 0-6 shown heroes, and on two-ban turns the
// sequence (the best ban, then the best ban after it). A difference counts only where the reference's lead is above 1e-6.
if (fs.existsSync("tools/reports/check_decisions.json")) {
  const DC = JSON.parse(fs.readFileSync("tools/reports/check_decisions.json", "utf8"));
  if (DC.run !== L.run) { bad++; log(`  FAIL: the decision reference is for run ${DC.run}, the model is ${L.run} (rerun tools/check_decisions.py)`); }
  else {
    let n = 0, same = 0, n2 = 0, same2 = 0, ties = 0, ties2 = 0;
    for (const c of DC.cases) {
      const R = E.ourTurn(c.state); n++;
      if (R.best === c.best) same++; else if (c.margin < 1e-6) ties++; else log(`  decision ${n}: the page advises ${L.heroes[R.best]}, the reference ${L.heroes[c.best]} (lead ${c.margin.toExponential(1)})`);
      if (c.second !== undefined) { n2++; const Q = E.sequence(c.state, R); if (Q && Q.a === c.best && Q.b === c.second) same2++; else if (Q && Q.a === c.best && c.second_margin < 1e-6) ties2++;
        else log(`  two-ban turn ${n}: the page advises ${L.heroes[Q.a]} then ${L.heroes[Q.b]}, the reference ${L.heroes[c.best]} then ${L.heroes[c.second]}`); }
    }
    const camps = new Set(DC.cases.map(c => c.state.firstUs)).size, shownK = new Set(DC.cases.map(c => [c.state.you].concat(c.state.mates).filter(h => h >= 0).length)).size;
    log(`complete decisions against the exported policy: ${same} of ${n} turns and ${same2} of ${n2} two-ban sequences the same (${ties + ties2} exact ties); both camps ${camps === 2}, ${shownK} shown-hero counts`);
    if (same + ties < n || same2 + ties2 < n2) { bad++; log("  FAIL: the page's decisions differ from the exported policy"); }
  }
} else log("complete decisions: tools/reports/check_decisions.json not found (run python tools/check_decisions.py)");
log(bad ? `${bad} problem(s)` : "all checks passed");
fs.writeFileSync("tools/reports/check_v8.txt", out.join("\n") + "\n"); process.exit(bad ? 1 : 0);
