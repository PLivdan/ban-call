/* Worker for the v8 re-draft simulator (sim8.js). Jobs:
   values: every candidate (a hero, a pair, or "typ": the ban a typical team makes now) for a list of runs. Run j uses stand-in
           draw j % DRAWS and the same random numbers for the rest of the ban phase whatever the candidate, so candidates are
           compared on the same lobbies. Returns P(we win) per candidate and run, and who opened what in the typical runs
           (each team, and our team seat by seat: slots[i * H + h] counts our seat i opening h).
   flow:   where the players who would open hero x go when x is banned too, on the same lobbies and draft random numbers.
   ending: one stand-in draw on a given six-ban path (the Methods figure): the first n lineups of each team seat by seat and
           their n x n matchup win chances. */
importScripts("sim8.js" + self.location.search, "engine8.js" + self.location.search);   // the page stamps this worker's address; the scripts share the stamp
const DRAWS = 32;
let SIM = null, E8 = null, loading = null;
const draws = new Map(), probs = new Map();
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
const lobbyKey = s => [s.m, s.r0, s.firstUs, s.you, (s.mates6 || []).join(".")].join("|");
function drawFor(L, s, d) {
  const k = lobbyKey(s) + "#" + d; if (draws.has(k)) return draws.get(k);
  if (draws.size > 64) draws.clear();                               // one lobby at a time, at most
  const D = SIM.draw(L, s, Sim8.hash(20260927, d)); draws.set(k, D); return D;
}
function ourProbs(s) {                                            // a typical team's ban as the page sees the lobby, cached per ban sequence
  return (bans, e, allowed) => {
    const k = lobbyKey(s) + "#" + bans.join(","); if (probs.has(k)) return probs.get(k);
    if (probs.size > 5000) probs.clear();
    const p = E8.banProbs({ m: s.m, r0: s.r0, firstUs: s.firstUs, bans, you: s.you, mates: (s.mates6 || []).filter(h => h >= 0) }, e, allowed); probs.set(k, p); return p;
  };
}
onmessage = async ev => {
  const d = ev.data;
  try {
    if (!SIM) { loading = loading || load(d.base || "", d.v).catch(e => { loading = null; throw e; }); await loading; }   // a failed load is tried again on the next job
    const s = d.st, L = SIM.lobby(s), op = ourProbs(s), H = SIM.H;
    if (d.type === "flow") {
      const us = new Float64Array(H), them = new Float64Array(H); let nu = 0, nt = 0, n = 0;
      for (const j of d.runs) {
        const D = drawFor(L, s, j % DRAWS), B = SIM.complete(L, D, s.bans, j, op); if (B.includes(d.h)) continue;
        const A = SIM.terminal(L, D, B, true), X = SIM.terminal(L, D, B.concat([d.h]), true); n++;
        A.pu.forEach((pk, u) => pk.forEach((h, i) => { if (h === d.h) { us[X.pu[u][i]]++; nu++; } }));
        A.po.forEach((pk, u) => pk.forEach((h, i) => { if (h === d.h) { them[X.po[u][i]]++; nt++; } }));
        postMessage({ id: d.id, tick: 1 });
      }
      postMessage({ id: d.id, done: true, flow: { us: Array.from(us), them: Array.from(them), nu, nt, runs: n, mu: SIM.MU, k: SIM.K } });
      return;
    }
    if (d.type === "ending") {
      const n = d.n || 9, D = drawFor(L, s, d.draw || 0), r = SIM.terminal(L, D, d.bans, true, n);
      postMessage({ id: d.id, done: true, ending: { n, win: r.win, us: r.ex.us, them: r.ex.them, pairs: r.ex.pairs, mu: SIM.MU, k: SIM.K } });
      return;
    }
    const vals = {}, acc = { us: new Float64Array(H), them: new Float64Array(H), av: new Float64Array(H), slots: new Float64Array(6 * H), nu: 0, nt: 0, runs: 0, roles: SIM.ROLE, splits: { us: {}, them: {} } };
    for (const c of d.cands) vals[String(c)] = {};
    for (const j of d.runs) {
      const D = drawFor(L, s, j % DRAWS);
      for (const c of d.cands) {
        const pre = c === "typ" ? s.bans : s.bans.concat(Array.isArray(c) ? c : [c]), B = SIM.complete(L, D, pre, j, op);
        if (c === "typ" && d.opens) { const r = SIM.terminal(L, D, B, true); vals.typ[j] = r.win; Sim8.opens(H, r, acc, B); }
        else vals[String(c)][j] = SIM.terminal(L, D, B);
        postMessage({ id: d.id, tick: 1 });
      }
    }
    postMessage({ id: d.id, done: true, vals, opens: d.opens ? { us: Array.from(acc.us), them: Array.from(acc.them), av: Array.from(acc.av), slots: Array.from(acc.slots), nu: acc.nu, nt: acc.nt, runs: acc.runs, splits: acc.splits } : null });
  } catch (e) { postMessage({ id: d.id, error: String(e && e.stack || e) }); }
};
