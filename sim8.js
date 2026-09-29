/* Re-draft simulator v8: the ban-solver v8 notebook's world model (section 6) in the browser.
   A lobby is played out with stand-ins: real players near your rank (a systematic sample of the notebook's pool, drawn in
   proportion to how often they play), your team's players conditioned on the heroes it shows. After all six bans both teams
   draft jointly with the fitted pick model (Gibbs sweeps over the six slots: co-picks, team-ups, role counts, the pull toward
   the main's role when the main is banned), and the fitted outcome model, with its recalibration, scores every pair of our and
   their lineups. Their bans come from the ban model with the lobby's own stand-ins (what a team that knows its players does);
   ours from the ban model as the page sees the lobby, the way a typical team bans. Exported by ban-solver
   export/build_sim_v8.py from the run's fitted models; checked against the notebook's own functions by tools/check_sim_v8.js.
   Runs in the browser (sim8-worker.js) and in Node. */
(function (root) {
  "use strict";
  function f16(u) { const s = (u & 0x8000) ? -1 : 1, e = (u >> 10) & 0x1f, f = u & 0x3ff; if (e === 0) return s * Math.pow(2, -14) * (f / 1024); if (e === 31) return f ? NaN : s * Infinity; return s * Math.pow(2, e - 15) * (1 + f / 1024); }
  // small fast seeded generator (mulberry32), uniform in (0, 1)
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4294967296; }; }
  const gumbel = r => -Math.log(-Math.log(r()));
  const hash = (...xs) => { let h = 2166136261 >>> 0; for (const x of xs) { h ^= x & 0xffff; h = Math.imul(h, 16777619); h ^= x >>> 16; h = Math.imul(h, 16777619); } return h >>> 0; };
  const sig = z => 1 / (1 + Math.exp(-z));

  class Sim8 {
    constructor(meta, buffer) {
      this.meta = meta; const H = this.H = meta.heroes.length; this.ROLE = meta.roles; this.ORDER = meta.order; this.BANDS = meta.bands;
      const A = {};
      for (const a of meta.arrays) {
        const n = a.shape.reduce((p, q) => p * q, 1);
        if (a.dtype === "float16") { const u = new Uint16Array(buffer, a.offset, n), o = new Float64Array(n); for (let i = 0; i < n; i++) o[i] = f16(u[i]); A[a.name] = o; }
        else if (a.dtype === "float32") A[a.name] = Float64Array.from(new Float32Array(buffer, a.offset, n));
        else A[a.name] = Int32Array.from(new Int32Array(buffer, a.offset, n));
        A[a.name].shape = a.shape;
        if (a.dtype !== "int32") for (let i = 0; i < A[a.name].length; i++) if (!Number.isFinite(A[a.name][i])) throw new Error(`simulator array ${a.name}: a value is not finite`);
      }
      this.A = A; this.S = meta.scalars; this.N = A["pool.RANK"].length; this.NM = A["G.dm"].shape[0]; this.NB = A["G.db"].shape[0];
      this.MU = meta.mu; this.K = meta.k; this.J = Math.min(meta.jban, meta.mu, meta.k); this.SW = meta.sweeps;
      this.K3 = A["G.t3"].length; this.cw = new Float64Array(this.N + 1); for (let i = 0; i < this.N; i++) this.cw[i + 1] = this.cw[i] + A["pool.W"][i];
    }
    row(name, i) { const a = this.A[name], w = a.shape[a.shape.length - 1]; return a.subarray(i * w, (i + 1) * w); }
    band(r0) { let b = 0; for (const t of this.BANDS) if (r0 > t) b++; return b; }
    // ---- the lobby's constant parts (camp 0 bans first)
    lobby(s) {
      const H = this.H, A = this.A, S = this.S, camp = s.firstUs ? 0 : 1, a = camp === 0 ? 1 : -1, m = s.m, bd = this.band(s.r0), rs = (s.r0 - this.meta.rank_mean) / this.meta.rank_sd;
      const cb = sgn => { const o = new Float64Array(H), d = A["G.d"], dm = this.row("G.dm", m), da = A["G.da"], dma = this.row("G.dma", m), db = this.row("G.db", bd); for (let h = 0; h < H; h++) o[h] = d[h] + dm[h] + sgn * (da[h] + dma[h]) + db[h]; return o; };
      const w = sgn => { const o = new Float64Array(H), b = A["G.b"], bm = this.row("G.bm", m), ba = A["G.ba"], bam = this.row("G.bam", m), br = A["G.br"], bt = A["G.bt"]; for (let h = 0; h < H; h++) o[h] = b[h] + bm[h] + sgn * (ba[h] + bam[h]) + rs * br[h] + S.T * bt[h]; return o; };
      const shown = [s.you].concat(s.mates6 || s.mates.concat([-1, -1, -1, -1, -1]).slice(0, 5));
      return { m, bd, camp, a, rs, cbu: cb(a), cbo: cb(-a), wu: w(a), wo: w(-a), c0: a * (S.b0 + A["G.mm"][m]), ourpos: this.ORDER.map(o => o === camp), shown };
    }
    // ---- stand-ins: the pool window around the rank (the notebook's pool_window, scaled to the sample)
    window(r0) {
      const R = this.A["pool.RANK"], N = this.N, lb = v => { let lo = 0, hi = N; while (lo < hi) { const md = (lo + hi) >> 1; if (R[md] < v) lo = md + 1; else hi = md; } return lo; };
      const ub = v => { let lo = 0, hi = N; while (lo < hi) { const md = (lo + hi) >> 1; if (R[md] <= v) lo = md + 1; else hi = md; } return lo; };
      let lo = lb(r0 - this.meta.win), hi = ub(r0 + this.meta.win);
      if (hi - lo < this.meta.min_window) { const n = Math.min(this.meta.nearest, N); lo = Math.max(0, Math.min(lb(r0) - (n >> 1), N - n)); hi = lo + n; }
      return [lo, hi];
    }
    drawAny(r, lo, hi) { const cw = this.cw, x = cw[lo] + r() * (cw[hi] - cw[lo]); let a = lo, b = hi; while (b - a > 1) { const md = (a + b) >> 1; if (cw[md] <= x) a = md; else b = md; } return a; }
    /* One stand-in draw for a lobby: our MU lineups (conditioned on the shown heroes) and their K lineups, the draft's random
       numbers, and the stand-in teams' hero shares for the ban model. Everything comes from the seed. */
    draw(L, s, seed) {
      const r = rng(seed), H = this.H, MU = this.MU, K = this.K, [lo, hi] = this.window(s.r0), PL = [], NALT = this.meta.nalt || 8;
      // players who open a shown hero: weight x their pick-model chance of opening it, exact over the window. Each player's
      // softmax max and sum depend only on the window and the lobby's utilities (map, rank band, side), and a hero's cumulative
      // weights only on those and the hero, so both are kept across draws and hovers: the same numbers, computed once (they
      // were 80% of a draw's time)
      const ck = `${lo},${hi},${L.m},${L.bd},${L.camp}`, PB = this.A["pool.PB"], W = this.A["pool.W"];
      if (!this._cc || this._cc.key !== ck) {
        const mxA = new Float64Array(hi - lo), seA = new Float64Array(hi - lo);
        for (let i = lo; i < hi; i++) { let mx = -Infinity; const o = i * H; for (let k = 0; k < H; k++) { const u = PB[o + k] + L.cbu[k]; if (u > mx) mx = u; }
          let se = 0; for (let k = 0; k < H; k++) se += Math.exp(PB[o + k] + L.cbu[k] - mx); mxA[i - lo] = mx; seA[i - lo] = se; }
        this._cc = { key: ck, mx: mxA, se: seA, byH: new Map() };
      }
      const CC = this._cc, cond = new Map();
      for (const h of L.shown) if (h >= 0 && !cond.has(h)) {
        let cw = CC.byH.get(h);
        if (!cw) { cw = new Float64Array(hi - lo + 1); for (let i = lo; i < hi; i++) cw[i - lo + 1] = cw[i - lo] + W[i] * Math.exp(PB[i * H + h] + L.cbu[h] - CC.mx[i - lo]) / CC.se[i - lo]; CC.byH.set(h, cw); }
        cond.set(h, cw);
      }
      const pickC = cw => { const x = r() * cw[cw.length - 1]; let a = 0, b = cw.length - 1; while (b - a > 1) { const md = (a + b) >> 1; if (cw[md] <= x) a = md; else b = md; } return lo + a; };
      for (let u = 0; u < MU + K; u++) {
        const team = new Int32Array(6), keep = new Uint8Array(6);
        for (let j = 0; j < 6; j++) {
          const h = u < MU ? L.shown[j] : -1;
          if (h < 0) { team[j] = this.drawAny(r, lo, hi); continue; }
          // v8.4 (the notebook's _sir): up to NALT draws, the first one no earlier shown slot holds; none free: a window draw
          for (let t = 0; t < NALT && !keep[j]; t++) { const p = pickC(cond.get(h)); let held = false; for (let k = 0; k < j; k++) if (keep[k] && team[k] === p) held = true; if (!held) { team[j] = p; keep[j] = 1; } }
          if (!keep[j]) team[j] = this.drawAny(r, lo, hi);
        }
        for (let tries = 0; tries < 30; tries++) {                  // the notebook's dedupe: a repeated stand-in is redrawn (not one drawn for a shown hero)
          let dup = false; for (let j = 0; j < 6; j++) { if (keep[j]) continue; for (let k = 0; k < 6; k++) if (k !== j && team[k] === team[j] && (k < j || keep[k])) { team[j] = this.drawAny(r, lo, hi); dup = true; break; } }
          if (!dup) break;
        }
        if (new Set(team).size < 6) throw new Error("a stand-in team still repeats a player after 30 redraws");
        PL.push(team);
      }
      const S = this.SW, NZ = new Float64Array((MU + K) * 6 * S * H), OD = [], CU = new Float64Array(MU * 6);
      for (let i = 0; i < NZ.length; i++) NZ[i] = gumbel(r);
      for (let u = 0; u < MU + K; u++) { const k = [0, 1, 2, 3, 4, 5].map(i => [r(), i]).sort((p, q) => p[0] - q[0]).map(p => p[1]); OD.push(k); }
      for (let i = 0; i < CU.length; i++) CU[i] = r();
      const rel = us => { const o = []; for (let j = 0; j < this.J; j++) { const v = new Float64Array(H), t = PL[us ? j : MU + j]; for (const p of t) { const sh = this.row("pool.SH", p); for (let k = 0; k < H; k++) v[k] += sh[k]; } o.push(v); } return o; };
      return { PL, NZ, OD, CU, RELu: rel(true), RELo: rel(false) };
    }
    /* draft8: B lineups (the notebook's function, one lineup at a time). base[i]: the slot's utilities (Float64Array H),
       fixed[i] a committed hero or -1, noise(i, s, h), order: the slot order, phi[i] the team-up weight. */
    draft(base, legal, fixed, noise, order, phi) {
      const H = this.H, A = this.A, g6 = A["G.g6"], Qs = A["G.Qs"], TU = A["G.TU"], ROLE = this.ROLE, S = this.SW;
      const picks = Int32Array.from(fixed), free = fixed.map(h => h < 0), tk = new Uint8Array(H), rc = [0, 0, 0], bq = new Float64Array(H), bt = new Float64Array(H);
      const add = (h, sgn) => { tk[h] += sgn; rc[ROLE[h]] += sgn; const o = h * H; for (let k = 0; k < H; k++) { bq[k] += sgn * Qs[o + k]; bt[k] += sgn * TU[o + k]; } };
      for (let i = 0; i < 6; i++) if (fixed[i] >= 0) add(fixed[i], 1);
      for (let s = 0; s < S; s++) for (let t = 0; t < 6; t++) {
        const i = order[t]; if (!free[i]) continue;
        if (s) add(picks[i], -1);
        const bs = base[i], ph = phi[i]; let best = -1, bv = -Infinity;
        for (let h = 0; h < H; h++) { if (!legal[h] || tk[h]) continue; const u = bs[h] + bq[h] + ph * bt[h] + g6[Math.min(rc[ROLE[h]], 5)] + noise(i, s, h); if (u > bv) { bv = u; best = h; } }
        picks[i] = best; add(best, 1);
      }
      return picks;
    }
    /* A lineup's side of the outcome model's log-odds (the notebook's lineup_value). */
    lineup(pk, pl, legal, w) {
      const H = this.H, A = this.A, ROLE = this.ROLE, cnt = [0, 0, 0], X = new Uint8Array(H);
      for (const h of pk) { X[h] = 1; cnt[ROLE[h]]++; }
      let v = 0; const S = A["G.S"], rcp = A["G.rcp"], PH = A["pool.PH"], MAIN = A["pool.MAIN"], KV = A["pool.KV"], KF = A["pool.KF"], PC = A["pool.PC"];
      for (let i = 0; i < 6; i++) {
        const h = pk[i], p = pl[i], cc = cnt[ROLE[h]];
        v += w[h] + PH[p * H + h] + rcp[h * 3 + (cc === 1 ? 0 : cc >= 3 ? 1 : 2)] + PC[p];
        const mn = MAIN[p]; v -= legal[mn] ? KV[p] * (h !== mn ? 1 : 0) : KF[p];
        for (let j = i + 1; j < 6; j++) v += S[h * H + pk[j]];
      }
      v += A["G.sh"][cnt[0] * 7 + cnt[1]];
      const T = A["G.TRI"], t3 = A["G.t3"]; for (let k = 0; k < this.K3; k++) if (X[T[3 * k]] && X[T[3 * k + 1]] && X[T[3 * k + 2]]) v += t3[k];
      return v;
    }
    /* P(we win | all six bans) for one draw: the mean over MU x K pairs of drafted lineups. Returns the picks too. nex > 0 (the
       Methods figure): also the first nex lineups of each team, seat by seat (the seat's hero: the one it shows, else the
       stand-in's main; the pick; whether that hero is banned), and their nex x nex matchup win chances. extraOurs: which team
       made a ban beyond the six (the flow job adds our advised ban as a seventh; the fixed order covers positions 0 to 5 only). */
    terminal(L, D, bans, keep = false, nex = 0, extraOurs = true) {
      const H = this.H, A = this.A, MU = this.MU, K = this.K, S = this.SW, legal = new Uint8Array(H).fill(1), ourB = new Float64Array(H), thB = new Float64Array(H);
      bans.forEach((h, e) => { legal[h] = 0; ((e < L.ourpos.length ? L.ourpos[e] : extraOurs) ? ourB : thB)[h] = 1; });
      const tilt = (vecs) => { const o = new Float64Array(H); for (const [v, M] of vecs) for (let i = 0; i < H; i++) if (v[i]) { const r = i * H; for (let k = 0; k < H; k++) o[k] += M[r + k]; } return o; };
      const tu = tilt([[thB, A["G.Wp"]]]), to = tilt([[thB, A["G.Wo"]], [ourB, A["G.Wp"]]]);
      const PB = A["pool.PB"], PT = A["pool.PT"], MAIN = A["pool.MAIN"], MSP = A["pool.MSP"], phi0 = this.S.phi, phit = this.S.phi_t, commit = this.meta.commit;
      const side = (u, cb, tl) => { const base = [], phi = []; for (let i = 0; i < 6; i++) { const p = D.PL[u][i], top = !legal[MAIN[p]] && MSP[p] ? 1 : 0, o = new Float64Array(H);
        for (let h = 0; h < H; h++) o[h] = PB[p * H + h] + cb[h] + tl[h] + top * PT[p * H + h]; base.push(o); phi.push(phi0 + phit * top); } return { base, phi }; };
      const pu = [], po = [], au = new Float64Array(MU), ao = new Float64Array(K), ex = nex > 0 ? { us: [], them: [], pairs: new Array(nex * nex).fill(0) } : null;
      for (let u = 0; u < MU + K; u++) {
        const us = u < MU, sd = side(u, us ? L.cbu : L.cbo, us ? tu : to), fixed = new Int32Array(6).fill(-1);
        if (us) for (let j = 0; j < 6; j++) { const h = L.shown[j]; if (h >= 0 && legal[h] && (j === 0 || D.CU[u * 6 + j] < commit)) fixed[j] = h; }
        const off = u * 6 * S * H, pk = this.draft(sd.base, legal, fixed, (i, s, h) => D.NZ[off + (i * S + s) * H + h], D.OD[u], sd.phi);
        const v = this.lineup(pk, D.PL[u], legal, us ? L.wu : L.wo); if (us) { pu.push(pk); au[u] = v; } else { po.push(pk); ao[u - MU] = v; }
        if (ex && (us ? u : u - MU) < nex) { const mains = [], forced = [];
          for (let i = 0; i < 6; i++) { const m = us && L.shown[i] >= 0 ? L.shown[i] : MAIN[D.PL[u][i]]; mains.push(m); forced.push(!legal[m]); }
          (us ? ex.us : ex.them).push({ mains, picks: Array.from(pk), forced }); }
      }
      const C = A["G.C"], ca = this.S.cal_a, cbb = this.S.cal_b; let tot = 0;
      for (let u = 0; u < MU; u++) for (let o = 0; o < K; o++) { let x = au[u] - ao[o] + L.c0; const X = pu[u], Y = po[o]; for (const h of X) { const r = h * H; for (const k of Y) x += C[r + k]; }
        const w = sig(cbb * x + ca * L.a); tot += w; if (ex && u < nex && o < nex) ex.pairs[u * nex + o] = w; }
      const win = tot / (MU * K); return keep ? { win, pu, po, ex } : win;
    }
    /* The ban model for the team banning at position e, averaged over stand-in teams (the notebook's ban_probs): RELu / RELo
       our and their stand-in teams' summed hero shares. allowed: Uint8Array. */
    banProbs(L, bans, e, allowed, RELu, RELo) {
      const H = this.H, A = this.A, S = this.S, m = L.m, bd = L.bd, us = L.ourpos[e], own = new Uint8Array(H), oth = new Uint8Array(H);
      for (let i = 0; i < e; i++) ((L.ourpos[i] === us) ? own : oth)[bans[i]] = 1;
      const last = e > 0 ? bans[e - 1] : -1, same = e > 0 && this.ORDER[e - 1] === this.ORDER[e], sg = this.ORDER[e] === 0 ? 1 : -1;
      const base = new Float64Array(H), Ro = A["G.B_Ro"], Rt = A["G.B_Rt"], Lx = A[same ? "G.B_Lo" : "G.B_Lt"];
      const a = A["G.B_a"], am = this.row("G.B_am", m), ab = this.row("G.B_ab", bd), ae = this.row("G.B_ae", e), acm = this.row("G.B_acm", m);
      for (let h = 0; h < H; h++) { let v = a[h] + am[h] + ab[h] + ae[h] + sg * acm[h]; if (last >= 0) v += Lx[last * H + h]; base[h] = v; }
      for (let i = 0; i < H; i++) { if (own[i]) { const r = i * H; for (let h = 0; h < H; h++) base[h] += Ro[r + h]; } if (oth[i]) { const r = i * H; for (let h = 0; h < H; h++) base[h] += Rt[r + h]; } }
      const pre = this.meta.pre_pop, cr = -(S.B_lam + A["G.B_lam_e"][e] + pre * S.B_lam_p), cf = S.B_gam + A["G.B_gam_e"][e] + pre * S.B_gam_p, tau = S.B_tau + A["G.B_tau_e"][e];
      const CT = A["G.CT"], p = new Float64Array(H), u = new Float64Array(H), J = RELu.length;
      for (let j = 0; j < J; j++) {
        const REL = us ? RELu[j] : RELo[j], RX = us ? RELo[j] : RELu[j]; let mx = -Infinity;
        for (let h = 0; h < H; h++) { if (!allowed[h]) continue; let f = 0; for (let k = 0; k < H; k++) f += REL[k] * CT[k * H + h]; u[h] = base[h] + cr * REL[h] + cf * f + tau * RX[h]; if (u[h] > mx) mx = u[h]; }
        let se = 0; for (let h = 0; h < H; h++) if (allowed[h]) se += Math.exp(u[h] - mx);
        for (let h = 0; h < H; h++) if (allowed[h]) p[h] += Math.exp(u[h] - mx) / se / J;
      }
      return p;
    }
    /* The rest of the ban phase for run j after `bans`: their bans from the ban model with this draw's stand-ins, ours from
       `ourProbs(bans, e, allowed)` (the page's view: how a typical team bans). The same random numbers for every candidate. */
    complete(L, D, bans, j, ourProbs) {
      const H = this.H, out = bans.slice();
      for (let e = out.length; e < 6; e++) {
        const allowed = new Uint8Array(H).fill(1); for (const h of out) allowed[h] = 0;
        if (L.ourpos[e]) for (const h of L.shown) if (h >= 0) allowed[h] = 0;
        const p = L.ourpos[e] ? ourProbs(out, e, allowed) : this.banProbs(L, out, e, allowed, D.RELu, D.RELo), r = rng(hash(j, e, 7919));
        let best = -1, bv = -Infinity; for (let h = 0; h < H; h++) if (allowed[h] && p[h] > 0) { const v = Math.log(p[h]) + gumbel(r); if (v > bv) { bv = v; best = h; } }
        out.push(best);
      }
      return out;
    }
    /* Who opens what when the lobby is played out: counts of each hero in our and their drafted lineups. */
    static opens(H, res, acc, bans) {                  // bans: this phase's six bans, so rates can be read for the phases where a hero was available
      for (const pk of res.pu) for (const h of pk) acc.us[h]++; for (const pk of res.po) for (const h of pk) acc.them[h]++; acc.nu += res.pu.length; acc.nt += res.po.length;
      if (bans && acc.av) { acc.runs = (acc.runs || 0) + 1; for (let h = 0; h < H; h++) if (!bans.includes(h)) acc.av[h]++; }
      if (acc.slots) for (const pk of res.pu) for (let i = 0; i < pk.length; i++) acc.slots[i * H + pk[i]]++;   // our lineups by seat: what each of our players opens
      if (acc.splits && acc.roles) {                     // role splits (vanguards-duelists-strategists) of the drafted lineups
        const key = pk => { const c = [0, 0, 0]; for (const h of pk) c[acc.roles[h]]++; return c.join("-"); };
        for (const pk of res.pu) { const k = key(pk); acc.splits.us[k] = (acc.splits.us[k] || 0) + 1; }
        for (const pk of res.po) { const k = key(pk); acc.splits.them[k] = (acc.splits.them[k] || 0) + 1; }
      }
    }
  }
  Sim8.rng = rng; Sim8.hash = hash; Sim8.gumbel = gumbel;
  root.Sim8 = Sim8;
  if (typeof module !== "undefined") module.exports = { Sim8 };
})(typeof window !== "undefined" ? window : globalThis);
