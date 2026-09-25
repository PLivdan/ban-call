/* Re-draft simulator: a port of the notebook's Part A `Solver` (sections 7 and 10).
   For each candidate ban it samples the rest of the ban phase from the ban model, re-drafts both teams with the pick model
   (stand-in players drawn from real players near your rank; your hero and hovers kept), and scores the drafts with the
   outcome model. Random numbers are shared across candidates so their differences are not noise from resampling. */
(function (root) {
  "use strict";
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const gumbel = r => -Math.log(-Math.log(r() * (1 - 2e-12) + 1e-12));
  function b64bytes(s) {
    if (typeof atob === "function") { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
    return new Uint8Array(Buffer.from(s, "base64"));
  }

  class SimEngine {
    constructor(M, opt = {}) {
      this.M = M; const H = this.H = M.heroes.length; this.role = M.roles; this.ORDER = M.ban_order;
      this.MU = opt.MU || 32; this.K = opt.K || 64; this.LOOK = opt.LOOK || 4; this.SW = 2; this._key = null;
      const P = M.players, n = P.n; this.n = n; this.rank = P.rank; this.main = P.main; this.SH = new Float32Array(n * H);
      this.v4 = !!P.pb;                                            // notebook v6 export: per-player hero vectors precomputed
      if (this.v4) {                                               // PB: pick-model history utility, PH: outcome player x hero term
        const pb = new Int8Array(b64bytes(P.pb).buffer), ph = new Int8Array(b64bytes(P.ph).buffer), rel = b64bytes(P.rel);
        this.PB = new Float32Array(n * H); this.PH = new Float32Array(n * H); this.kv = P.kv; this.kf = P.kf;
        for (let i = 0; i < n * H; i++) { this.PB[i] = pb[i] / P.pb_scale; this.PH[i] = ph[i] / P.ph_scale; this.SH[i] = rel[i] / 255; }
      } else {
        const lc = b64bytes(P.lc), lc10 = b64bytes(P.lc10), dot = new Int8Array(b64bytes(P.dot).buffer), fm = new Int8Array(b64bytes(P.form).buffer); this.ms = P.main_share;
        this.LC = new Float32Array(n * H); this.LC10 = new Float32Array(n * H); this.DOT = new Float32Array(n * H); this.FORM = new Float32Array(n * H);
        for (let i = 0; i < n * H; i++) { this.LC[i] = lc[i] / P.lc_scale; this.LC10[i] = lc10[i] / P.lc_scale; this.DOT[i] = dot[i] / P.dot_scale; this.FORM[i] = fm[i] / P.form_scale; }
        for (let p = 0; p < n; p++) { let s = 0; for (let h = 0; h < H; h++) s += Math.expm1(this.LC[p * H + h]); for (let h = 0; h < H; h++) this.SH[p * H + h] = s > 0 ? Math.expm1(this.LC[p * H + h]) / s : 0; }
        const o = M.out; this.kdOf = ms => ms <= 0 ? 0 : o.kd[o.kd_bins.filter(t => ms >= t).length] * ms;
      }
      this.Qp = M.pick.Qp; this.g = M.pick.g;
    }
    band(r0) { let b = 0; for (const t of this.M.bands) if (r0 > t) b++; return b; }
    base(p, m, a, bd) {                                           // pick utility of each hero for player p (no bans, no teammates)
      const k = this.M.pick, H = this.H, u = new Float32Array(H), o = p * H;
      if (this.v4) for (let h = 0; h < H; h++) u[h] = k.d[h] + k.dm[m][h] + k.da[h] * a + k.db[bd][h] + this.PB[o + h];
      else for (let h = 0; h < H; h++) u[h] = k.d[h] + k.dm[m][h] + k.da[h] * a + k.db[bd][h] + k.psi * this.LC[o + h] + k.psi10 * this.LC10[o + h] + k.om * this.DOT[o + h];
      return u;
    }
    setup(st) {                                                   // stand-ins, fixed random numbers and per-lineup constants for one lobby
      const key = JSON.stringify([st.firstUs, st.m, st.r0, st.hov6, st.bans, this.MU, this.K, this.LOOK]);
      if (key === this._key) return this._S;
      this._key = key; return (this._S = this.setupNew(st));
    }
    setupNew(st) {
      const { firstUs, m, r0 } = st, H = this.H, a0 = firstUs ? 1 : -1, bd = this.band(r0), R = rng(12345);
      let pool = []; for (let p = 0; p < this.n; p++) if (Math.abs(this.rank[p] - r0) < 150) pool.push(p);
      if (pool.length < 50) pool = Array.from(this.rank.keys()).sort((x, y) => Math.abs(this.rank[x] - r0) - Math.abs(this.rank[y] - r0)).slice(0, 500);
      const hov = st.hov6.slice();                                 // slot 0 = your hero (always kept), 1-5 = hovers or -1
      const baseUs = pool.map(p => this.base(p, m, a0, bd)), baseOp = pool.map(p => this.base(p, m, -a0, bd));
      const draw = w => { let s = 0; for (const x of w) s += x; let t = R() * s; for (let i = 0; i < w.length; i++) { t -= w[i]; if (t <= 0) return i; } return w.length - 1; };
      const pr = hov.map(h => h < 0 ? null : baseUs.map(u => { let mx = -1e9; for (const v of u) mx = Math.max(mx, v); let s = 0; for (const v of u) s += Math.exp(v - mx); return Math.exp(u[h] - mx) / s; }));
      const us = [], op = [];
      for (let i = 0; i < this.MU; i++) us.push(hov.map((h, j) => pool[h < 0 ? Math.floor(R() * pool.length) : draw(pr[j])]));
      for (let i = 0; i < this.K; i++) { const l = []; for (let j = 0; j < 6; j++) l.push(pool[Math.floor(R() * pool.length)]); op.push(l); }
      const idx = new Map(pool.map((p, i) => [p, i]));
      const mkLine = (L, side) => ({ pl: L, base: L.map(p => (side ? baseOp : baseUs)[idx.get(p)]), order: this.perm(R), noise: L.map(() => Array.from({ length: this.SW }, () => Float32Array.from({ length: H }, () => gumbel(R)))) });
      const U = us.map(L => mkLine(L, 0)), O = op.map(L => mkLine(L, 1)), cu = us.map(() => Array.from({ length: 6 }, () => R()));
      const o = this.M.out, rs = (r0 - this.M.rank_mu) / this.M.rank_sd, T = o.t_now;
      const wu = new Float32Array(H), wo = new Float32Array(H);
      for (let h = 0; h < H; h++) { const c = o.b[h] + o.bm[m][h] + rs * o.br[h] + T * o.bt[h]; wu[h] = c + a0 * o.ba[h]; wo[h] = c - a0 * o.ba[h]; }
      const relOf = L => { const r = new Float32Array(H); for (const p of L) for (let h = 0; h < H; h++) r[h] += this.SH[p * H + h]; return r; };
      const relUs = new Float32Array(H); for (const L of us) { const r = relOf(L); for (let h = 0; h < H; h++) relUs[h] += r[h] / us.length; }
      const b = this.M.ban, C = o.C, ub = rel => { const u = new Float32Array(H); for (let h = 0; h < H; h++) { let cr = 0; for (let j = 0; j < H; j++) cr += C[h][j] * rel[j]; u[h] = b.a[h] + b.am[m][h] + b.ab[bd][h] - b.lam * rel[h] + b.gam * cr; } return u; };
      const ubUs = ub(relUs), ubOp = []; for (let j = 0; j < this.LOOK; j++) ubOp.push(ub(relOf(op[j])));
      const gb = Array.from({ length: this.LOOK }, () => Array.from({ length: 6 }, () => Float32Array.from({ length: H }, () => gumbel(R))));
      return { st, hov, U, O, cu, wu, wo, c0: a0 * (o.b0 + o.mm[m]), ubUs, ubOp, gb, prot: new Set(hov.filter(h => h >= 0)) };
    }
    perm(R) { const a = [0, 1, 2, 3, 4, 5]; for (let i = 5; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
    draft(line, legal, fixed, tilt) {                             // Gumbel-max picks with Gibbs sweeps (the notebook's `draft`)
      const H = this.H, role = this.role, picks = fixed.slice(), taken = new Uint8Array(H), rc = [0, 0, 0], bonus = new Float32Array(H);
      const add = (h, sgn) => { taken[h] = sgn > 0 ? 1 : 0; rc[role[h]] += sgn; const q = this.Qp[h]; for (let k = 0; k < H; k++) bonus[k] += sgn * q[k]; };
      for (const h of picks) if (h >= 0) add(h, 1);
      for (let s = 0; s < this.SW; s++) for (let t = 0; t < 6; t++) {
        const i = line.order[t]; if (fixed[i] >= 0) continue;
        if (picks[i] >= 0) { add(picks[i], -1); picks[i] = -1; }
        const bs = line.base[i], nz = line.noise[i][s]; let best = -1, bv = -Infinity;
        for (let h = 0; h < H; h++) {
          if (!legal[h] || taken[h]) continue;
          const v = bs[h] + tilt[h] + this.g[Math.min(rc[role[h]], 5)] + bonus[h] + nz[h];
          if (v > bv) { bv = v; best = h; }
        }
        picks[i] = best; add(best, 1);
      }
      return picks;
    }
    teamScore(pl, pk, w, c0, legal) {                             // one team's side of the outcome model's log-odds
      const o = this.M.out, H = this.H, role = this.role; let e = c0; const cnt = [0, 0, 0];
      for (const h of pk) cnt[role[h]]++;
      for (let i = 0; i < 6; i++) {
        const h = pk[i], p = pl[i], q = p * H + h, c = cnt[role[h]];
        if (this.v4) {                                             // displacement: forced if the main is banned, voluntary if they chose another hero
          const mn = this.main[p]; e += w[h] + this.PH[q] - (legal[mn] ? (h !== mn ? this.kv[p] : 0) : this.kf[p]);
        } else e += w[h] + o.kap * this.LC[q] + o.kap10 * this.LC10[q] + o.kw * this.FORM[q] - (h !== this.main[p] ? this.kdOf(this.ms[p]) : 0);
        e += c === 1 ? o.rc[h][0] : c >= 3 ? o.rc[h][1] : 0;
        for (let j = i + 1; j < 6; j++) e += o.S[h][pk[j]];
      }
      return e + o.sh[cnt[0] * 7 + cnt[1]];
    }
    scoreMask(S, legal, BU, BT) {
      const H = this.H, W = this.M.pick, tu = new Float32Array(H), to = new Float32Array(H);
      for (let b = 0; b < H; b++) { if (BU[b]) for (let h = 0; h < H; h++) { tu[h] += W.Wo[b][h]; to[h] += W.Wp[b][h]; } if (BT[b]) for (let h = 0; h < H; h++) { to[h] += W.Wo[b][h]; tu[h] += W.Wp[b][h]; } }
      const commit = this.M.commit;
      const pu = S.U.map((L, u) => this.draft(L, legal, S.hov.map((h, j) => (h >= 0 && legal[h] && (j === 0 || S.cu[u][j] < commit)) ? h : -1), tu));
      const po = S.O.map(L => this.draft(L, legal, [-1, -1, -1, -1, -1, -1], to));
      const C = this.M.out.C, au = pu.map((pk, u) => this.teamScore(S.U[u].pl, pk, S.wu, S.c0, legal)), ao = po.map((pk, k) => this.teamScore(S.O[k].pl, pk, S.wo, 0, legal));
      let tot = 0;
      for (let u = 0; u < pu.length; u++) for (let k = 0; k < po.length; k++) {
        let x = au[u] - ao[k]; for (const a of pu[u]) { const Ca = C[a]; for (const b of po[k]) x += Ca[b]; }
        tot += 1 / (1 + Math.exp(-x));
      }
      const cu = new Float32Array(H), co = new Float32Array(H);          // how often each hero appears in the simulated drafts
      for (const pk of pu) for (const h of pk) cu[h] += 1 / pu.length;
      for (const pk of po) for (const h of pk) co[h] += 1 / po.length;
      return { p: tot / (pu.length * po.length), cu, co };
    }
    checkEta(c) {                                                 // outcome log-odds of a fixed lineup pair (the notebook's parity lineups)
      const o = this.M.out, H = this.H, a0 = c.first ? 1 : -1, rs = (c.r0 - this.M.rank_mu) / this.M.rank_sd, wu = new Float32Array(H), wo = new Float32Array(H);
      for (let h = 0; h < H; h++) { const b = o.b[h] + o.bm[c.m][h] + rs * o.br[h] + o.t_now * o.bt[h]; wu[h] = b + a0 * o.ba[h]; wo[h] = b - a0 * o.ba[h]; }
      const legal = new Uint8Array(H).fill(1); for (const h of c.banned) legal[h] = 0;
      let x = this.teamScore(c.us, c.pu, wu, a0 * (o.b0 + o.mm[c.m]), legal) - this.teamScore(c.op, c.po, wo, 0, legal);
      for (const a of c.pu) for (const b of c.po) x += o.C[a][b];
      return x;
    }
    future(S, bans, cand, j) {                                    // rest of the ban phase for scenario j (the notebook's `masks`)
      const H = this.H, b = this.M.ban, first = S.st.firstUs, BU = new Uint8Array(H), BT = new Uint8Array(H);
      bans.forEach((h, i) => (((this.ORDER[i] === 0) === first) ? BU : BT)[h] = 1);
      for (const h of cand) BU[h] = 1;
      for (let ep = bans.length + cand.length; ep < 6; ep++) {
        const ours = (this.ORDER[ep] === 0) === first, own = ours ? BU : BT, oth = ours ? BT : BU, base = ours ? S.ubUs : S.ubOp[j];
        let best = -1, bv = -Infinity;
        for (let h = 0; h < H; h++) {
          if (BU[h] || BT[h] || (ours && S.prot.has(h))) continue;
          let v = base[h] + b.ae[ep][h] + S.gb[j][ep][h];
          for (let i = 0; i < H; i++) { if (own[i]) v += b.Ro[i][h]; if (oth[i]) v += b.Rt[i][h]; }
          if (v > bv) { bv = v; best = h; }
        }
        own[best] = 1;
      }
      const legal = new Uint8Array(H); for (let h = 0; h < H; h++) legal[h] = BU[h] || BT[h] ? 0 : 1;
      return { legal, BU, BT };
    }
    /* Evaluate candidate bans on the scenario indices `looks` (and the typical-ban baseline on `baseLooks`), so the work
       can be split across workers; every worker builds the same stand-ins and random numbers from the same seed. */
    evaluate(st, cands, looks, baseLooks, tick) {
      const S = this.setup(st), H = this.H, out = { vals: {}, cnt: {}, base: {}, baseCnt: null };
      const acc = () => ({ u: new Float32Array(H), o: new Float32Array(H) });
      const run = (cand, js, store, cstore) => {
        for (const j of js) {
          const f = this.future(S, st.bans, cand, j), r = this.scoreMask(S, f.legal, f.BU, f.BT); store[j] = r.p;
          for (let h = 0; h < H; h++) { cstore.u[h] += r.cu[h] / js.length; cstore.o[h] += r.co[h] / js.length; }
          if (tick) tick();
        }
      };
      if (baseLooks.length) { out.baseCnt = acc(); run([], baseLooks, out.base, out.baseCnt); }
      for (const h of cands) { out.vals[h] = {}; out.cnt[h] = acc(); run([h], looks, out.vals[h], out.cnt[h]); }
      return out;
    }
    values(st, onProgress) {
      const S = this.setup(st), H = this.H, bans = st.bans, prot = S.prot;
      const cands = []; for (let h = 0; h < H; h++) if (!bans.includes(h) && !prot.has(h)) cands.push(h);
      const run = cand => { const v = []; for (let j = 0; j < this.LOOK; j++) { const f = this.future(S, bans, cand, j); v.push(this.scoreMask(S, f.legal, f.BU, f.BT).p); } return v; };
      const base = run([]); const bm = base.reduce((a, b) => a + b) / base.length;
      const V = new Float64Array(H).fill(NaN), se = new Float64Array(H).fill(NaN), win = new Float64Array(H).fill(NaN);
      cands.forEach((h, k) => {
        const v = run([h]), d = v.map((x, j) => x - base[j]), mu = d.reduce((a, b) => a + b) / d.length;
        V[h] = mu; win[h] = v.reduce((a, b) => a + b) / v.length;
        se[h] = Math.sqrt(d.reduce((a, b) => a + (b - mu) ** 2, 0) / (d.length * Math.max(1, d.length - 1)));
        if (onProgress && k % 4 === 0) onProgress((k + 1) / cands.length);
      });
      return { V, se, win, base: bm };
    }
  }
  root.SimEngine = SimEngine;
  if (typeof module !== "undefined") module.exports = { SimEngine };
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
