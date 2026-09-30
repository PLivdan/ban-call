/* Worker for the v8 re-draft simulator (sim8.js). Jobs:
   values: every candidate (a hero, a pair, or "typ": the ban a typical team makes now) for a list of runs. Run j uses stand-in
           draw j % DRAWS and the same random numbers for the rest of the ban phase whatever the candidate, so candidates are
           compared on the same lobbies. Returns P(we win) per candidate and run, and who opened what in the typical runs
           (each team, and our team seat by seat: slots[i * H + h] counts our seat i opening h).
   flow:   where the players who would open hero x go when x is banned too, on the same lobbies and draft random numbers.
   ideal:  our ideal lineup (Sim8.idealComp) over the given runs' stand-in draws.
   ending: one stand-in draw on a given six-ban path (the Methods figure): the first n lineups of each team seat by seat and
           their n x n matchup win chances. */
importScripts("sim8.js" + self.location.search, "engine8.js" + self.location.search);   // the page stamps this worker's address; the scripts share the stamp
const DRAWS = 32;
let SIM = null, E8 = null, loading = null;
const draws = new Map(), probs = new Map(), latest = {}; let lobbyNow = null;   // latest[type]: the newest flow or ideal job (an older one stops early)
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
  SIM = new Sim8(meta, bin); E8 = new Engine8(lay, ban);
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
onmessage = async ev => {
  const d = ev.data; if (d.type === "flow" || d.type === "ideal") latest[d.type] = d.id;
  try {
    if (!SIM) { loading = loading || load(d.base || "", d.v).catch(e => { loading = null; throw e; }); await loading; }   // a failed load is tried again on the next job
    if (d.type === "warm") { postMessage({ id: d.id, done: true }); return; }       // the page loads the model before the first lobby
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
    for (const j of d.runs) {
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
