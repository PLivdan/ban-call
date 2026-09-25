/* Ban value engine, v7.1 (a port of the notebook's Part B; tools/engine_ref.py is the canonical numpy version and states
   the assumptions behind treating our own bans as interventions).
   A ban's value is a rollout comparison against a typical ban with the same budget:
     value(x) = E[ W(bans from now on | we ban x) ] − E[ W(bans from now on | we ban as a typical team) ]
     W(set)   = Σ over the heroes in the set of  P_them(y)·R_them(y) − P_us(y)·R_us(y)
   The rest of the ban phase is sampled one ban at a time from the ban model (legality, the acting team and the
   response terms updated after every ban), with the same random numbers for every candidate. Because the rollout
   already contains "it would have been banned anyway" and the other team's replies, nothing is added afterwards.
   Information boundaries:
     - the other team sees public information only: the bans so far, never our hovers;
     - our own bans are interventions: they remove heroes, but they are not evidence about our players, so our lineup
       is averaged over legal ban histories a typical team in our seat could have made (never a hero the other team bans
       at any point), weighted by how likely the other team's actual bans are under each history.
   v7.1: optional joint-removal terms (a hero's openers also lose their fallback when it is banned too) and an optional
   richer ban model (responses to the previous ban, position-specific protection and fear), used when the export has them.
   Intervals are conditional on the fitted models: they cover the four lineup networks, the removal-cost bootstrap and
   the rollout noise, not refitting the models.
   Runs in the browser and in Node (tools/check_*.js). */
(function (root) {
  "use strict";
  function f16(u) {                                  // IEEE half -> float
    const s = (u & 0x8000) ? -1 : 1, e = (u >> 10) & 0x1f, f = u & 0x3ff;
    if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  }
  const gelu = z => 0.5 * z * (1 + Math.tanh(0.7978845608028654 * (z + 0.044715 * z * z * z)));
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const gumbel = r => -Math.log(-Math.log(r() * (1 - 2e-12) + 1e-12));
  function seedOf(parts) { let h = 2166136261 >>> 0; for (const v of parts) { h ^= (v | 0) >>> 0; h = Math.imul(h, 16777619) >>> 0; } return h; }

  class BanEngine {
    constructor(meta, buffer, opt = {}) {
      this.m = meta; this.H = meta.heroes.length; this.NM = meta.maps.length; this.NB = meta.bands.length + 1;
      this.RE = (meta.feature_layout && meta.feature_layout.rank_edges) || meta.bands; this.NRF = this.RE.length + 1;   // rank one-hot for the lineup network (v5: 9 bins)
      this.ORDER = meta.ban_order; this.role = meta.roles;
      this.NS = opt.NS || 512;                       // rollouts of the rest of the ban phase (common to every candidate)
      this.NOWN = opt.NOWN || 32;                    // typical own-ban histories our lineup is averaged over
      this.SHORT = opt.SHORT || 10;                  // shortlist for joint pair search on two-ban turns
      this.salt = opt.salt || 0; this.saltOwn = opt.saltOwn !== undefined ? opt.saltOwn : this.salt;   // change the random numbers (stability checks only)
      const u16 = new Uint16Array(buffer), all = new Float32Array(u16.length);
      for (let i = 0; i < u16.length; i++) all[i] = f16(u16[i]);
      this.nets = meta.weights.models.map(ent => {
        const o = {};
        for (const k in ent) { const n = ent[k].shape.reduce((a, b) => a * b, 1); o[k] = all.subarray(ent[k].offset, ent[k].offset + n); o[k + "_shape"] = ent[k].shape; }
        return o;
      });
      this.FD = this.nets[0].W1_shape[0]; this.HID = this.nets[0].W1_shape[1];
      this._noiseKey = null;
      this.DP = meta.pair_removal || null;              // [x][y][band]: R(x | y gone too) - R(x)
      const b = meta.ban; this.B2 = !!b.Lo;              // richer ban model
    }
    band(r0) { let b = 0; for (const t of this.m.bands) if (r0 > t) b++; return b; }
    rankFeat(r0) { let b = 0; for (const t of this.RE) if (r0 > t) b++; return b; }
    // ---- features: [revealed | own bans | other bans | map | rank bin | side | stage | revealed role counts]
    features(rev, own, opp, m, bd, side, stage) {
      const H = this.H, x = new Float32Array(this.FD);
      for (const h of rev) x[h] = 1; for (const h of own) x[H + h] = 1; for (const h of opp) x[2 * H + h] = 1;
      let o = 3 * H; x[o + m] = 1; o += this.NM; x[o + bd] = 1; o += this.NRF; x[o] = side; o += 1; x[o + stage] = 1; o += 7;
      for (const h of rev) x[o + this.role[h]] += 1;
      return x;
    }
    netProb(net, x) {                                  // presence probabilities for one lineup network
      const H = this.H, D = this.HID, h1 = new Float32Array(D), h2 = new Float32Array(D), z = new Float32Array(H);
      h1.set(net.b1); z.set(net.b3);
      for (let i = 0; i < this.FD; i++) {
        const xi = x[i]; if (!xi) continue;
        const r = i * D; for (let j = 0; j < D; j++) h1[j] += xi * net.W1[r + j];
        const q = i * H; for (let k = 0; k < H; k++) z[k] += xi * net.Wl[q + k];
      }
      for (let j = 0; j < D; j++) h1[j] = gelu(h1[j]);
      h2.set(net.b2);
      for (let i = 0; i < D; i++) { const a = h1[i]; if (!a) continue; const r = i * D; for (let j = 0; j < D; j++) h2[j] += a * net.W2[r + j]; }
      for (let j = 0; j < D; j++) h2[j] = gelu(h2[j]);
      for (let i = 0; i < D; i++) { const a = h2[i]; const r = i * H; for (let k = 0; k < H; k++) z[k] += a * net.W3[r + k]; }
      const P = new Float64Array(H); for (let k = 0; k < H; k++) P[k] = 1 / (1 + Math.exp(-z[k]));
      return P;
    }
    // ---- one lobby state
    ctx(st) {
      const { firstUs, bans, m, r0 } = st, H = this.H, rev = (st.rev || []).filter(h => !bans.includes(h));
      const BU = new Uint8Array(H), BT = new Uint8Array(H), ours = i => (this.ORDER[i] === 0) === firstUs;
      bans.forEach((h, i) => (ours(i) ? BU : BT)[h] = 1);
      const ownU = [], ownT = []; for (let h = 0; h < H; h++) { if (BU[h]) ownU.push(h); if (BT[h]) ownT.push(h); }
      const rv = new Uint8Array(H); for (const h of rev) rv[h] = 1;
      const legal = new Uint8Array(H); for (let h = 0; h < H; h++) legal[h] = !BU[h] && !BT[h] ? 1 : 0;
      return { firstUs, bans, rev, m, r0, e: bans.length, bd: this.band(r0), rf: this.rankFeat(r0), sideUs: firstUs ? 0 : 1, BU, BT, ownU, ownT, rv, legal, ours,
               seed: seedOf([this.salt, firstUs ? 1 : 0, m, Math.round(r0), ...rev.slice().sort((a, b) => a - b)]),
               seedOwn: seedOf([this.saltOwn, firstUs ? 1 : 0, m, Math.round(r0), ...rev.slice().sort((a, b) => a - b)]) };
    }
    /* Opening probabilities are coherent only when they describe one availability state: after the whole ban phase
       (e = 6), or with all six of our heroes fixed. Then the open slots must hold exactly 6 − (fixed heroes) heroes: a
       common logit shift on the free heroes (bisection) keeps every probability in (0, 1) and makes them add up.
       Before the ban phase ends each probability is "would open it if it stays available", a different hypothetical
       per hero, so those are left as the network gives them (except that six fixed heroes leave no open slot). */
    static coherent(P, free, slots) {
      const H = P.length, z = new Float64Array(H), idx = []; for (let h = 0; h < H; h++) if (free[h]) { idx.push(h); z[h] = Math.log(Math.max(P[h], 1e-12) / Math.max(1 - P[h], 1e-12)); }
      if (slots <= 0 || !idx.length) { for (const h of idx) P[h] = 0; return P; }
      if (slots >= idx.length) { for (const h of idx) P[h] = 1; return P; }
      const sum = c => { let s = 0; for (const h of idx) s += 1 / (1 + Math.exp(-(z[h] + c))); return s; };
      let lo = -40, hi = 40; for (let it = 0; it < 80; it++) { const mid = (lo + hi) / 2; if (sum(mid) > slots) hi = mid; else lo = mid; }
      const c = (lo + hi) / 2; for (const h of idx) P[h] = 1 / (1 + Math.exp(-(z[h] + c)));
      return P;
    }
    fixUp(P, c, fixed) {                               // banned heroes 0, fixed heroes 1, then the coherence rule above
      const H = this.H, free = new Uint8Array(H), fx = new Uint8Array(H); for (const h of fixed) fx[h] = 1;
      for (let h = 0; h < H; h++) { if (!c.legal[h]) P[h] = 0; else if (fx[h]) P[h] = 1; else free[h] = 1; }
      if (fixed.length >= 6) for (let h = 0; h < H; h++) { if (free[h]) P[h] = 0; }
      else if (c.e >= 6) BanEngine.coherent(P, free, 6 - fixed.length);
      return P;
    }
    lineups(c) {
      const H = this.H, nets = this.nets;
      // the other team: public information only (no hovers of ours), and it reacts to the bans it has seen
      const xt = this.features([], c.ownT, c.ownU, c.m, c.rf, 1 - c.sideUs, c.e);
      const PtRaw = nets.map(n => this.netProb(n, xt)), PtE = PtRaw.map(P => this.fixUp(P.slice(), c, []));
      // our team: the raw prediction conditions on our own bans as if they described our players (kept for comparison)
      const xu = this.features(c.rev, c.ownU, c.ownT, c.m, c.rf, c.sideUs, c.e);
      const PuRaw = nets.map(n => this.netProb(n, xu));
      let PuE, sePu = new Float64Array(H), ess = this.NOWN;
      if (!c.ownU.length) PuE = PuRaw.map(P => this.fixUp(P.slice(), c, c.rev));
      else {                                           // our bans are interventions: average over typical own-ban histories
        const prior = new Float64Array(H), x0 = this.features(c.rev, [], [], c.m, c.rf, c.sideUs, 0);
        for (const n of nets) { const P = this.netProb(n, x0); for (let h = 0; h < H; h++) prior[h] += P[h] / nets.length; }
        for (const h of c.rev) prior[h] = 1;
        const priorT = new Float64Array(H), x0t = this.features([], [], [], c.m, c.rf, 1 - c.sideUs, 0);
        for (const n of nets) { const P = this.netProb(n, x0t); for (let h = 0; h < H; h++) priorT[h] += P[h] / nets.length; }
        const R = rng(c.seedOwn ^ 0x9e3779b9), hist = [];
        for (let s = 0; s < this.NOWN; s++) {
          const own = new Uint8Array(H), oth = new Uint8Array(H), done = new Uint8Array(H), mine = []; let lw = 0, last = null;   // last: [hero, banned by us]
          for (let i = 0; i < c.e; i++) {
            const h0 = c.bans[i];
            if (!c.ours(i)) {                            // their actual ban: how likely it is after this history
              const u = this.banUtil(i, priorT, oth, own, c.m, c.bd, last ? [last[0], !last[1]] : null); let mx = -Infinity, se = 0;
              for (let h = 0; h < H; h++) if (!done[h] && u[h] > mx) mx = u[h];
              for (let h = 0; h < H; h++) if (!done[h]) se += Math.exp(u[h] - mx);
              lw += u[h0] - (mx + Math.log(se)); oth[h0] = 1; done[h0] = 1; last = [h0, false]; continue;
            }
            const u = this.banUtil(i, prior, own, oth, c.m, c.bd, last); let best = -1, bv = -Infinity;
            for (let h = 0; h < H; h++) { if (done[h] || c.BT[h] || c.rv[h]) continue; const v = u[h] + gumbel(R); if (v > bv) { bv = v; best = h; } }
            own[best] = 1; done[best] = 1; mine.push(best); last = [best, true];
          }
          hist.push({ mine, own, lw });
        }
        let lmx = -Infinity; for (const x of hist) lmx = Math.max(lmx, x.lw);
        let ws = 0, ws2 = 0; for (const x of hist) { x.w = Math.exp(x.lw - lmx); ws += x.w; ws2 += x.w * x.w; } ess = ws * ws / ws2;
        const sum = nets.map(() => new Float64Array(H)), den = new Float64Array(H), m1 = new Float64Array(H), m2 = new Float64Array(H), w2 = new Float64Array(H);
        for (const x of hist) {
          const xs = this.features(c.rev, x.mine, c.ownT, c.m, c.rf, c.sideUs, c.e), pm = new Float64Array(H), wt = x.w;
          nets.forEach((n, k) => { const P = this.netProb(n, xs); for (let h = 0; h < H; h++) if (!x.own[h]) { sum[k][h] += wt * P[h]; pm[h] += P[h] / nets.length; } });
          for (let h = 0; h < H; h++) if (!x.own[h]) { den[h] += wt; m1[h] += wt * pm[h]; m2[h] += wt * pm[h] * pm[h]; w2[h] += wt * wt; }
        }
        PuE = nets.map((n, k) => { const P = new Float64Array(H); for (let h = 0; h < H; h++) P[h] = den[h] > 0 ? sum[k][h] / den[h] : PuRaw[k][h]; return this.fixUp(P, c, c.rev); });
        for (let h = 0; h < H; h++) if (c.legal[h] && !c.rv[h] && den[h] > 0) {   // weighted mean's error (Kish)
          const m = m1[h] / den[h], v = Math.max(0, m2[h] / den[h] - m * m); sePu[h] = Math.sqrt(v * w2[h] / (den[h] * den[h]));
        }
      }
      const mean = A => { const o = new Float64Array(H); for (const a of A) for (let h = 0; h < H; h++) o[h] += a[h] / A.length; return o; };
      const raw = (P, fixed) => { const Q = P.slice(); for (let h = 0; h < H; h++) if (!c.legal[h]) Q[h] = 0; for (const h of fixed) Q[h] = 1; return Q; };   // v6: banned 0, shown 1, nothing else
      return { PuE, PtE, sePu, ess, pu: mean(PuE), pt: mean(PtE), puRaw: mean(PuRaw.map(P => raw(P, c.rev))), ptRaw: mean(PtRaw.map(P => raw(P, []))) };
    }
    // ---- ban model
    banUtil(ep, rel, own, oth, m, bd, last) {         // last: [hero, same team] of the ban at ep - 1 (richer ban model)
      const b = this.m.ban, H = this.H, u = new Float64Array(H);
      for (let h = 0; h < H; h++) {
        let v = b.a[h] + b.am[m][h] + b.ab[bd][h] + b.ae[ep][h] - b.lam * rel[h], cr = 0, ro = 0;
        const Ch = this.m.C[h]; for (let j = 0; j < H; j++) cr += Ch[j] * rel[j];
        for (let i = 0; i < H; i++) { if (own[i]) ro += b.Ro[i][h]; if (oth[i]) ro += b.Rt[i][h]; }
        u[h] = v + b.gam * cr + ro;
        if (this.B2) { u[h] += -b.lam_e[ep] * rel[h] + b.gam_e[ep] * cr; if (last) u[h] += (last[1] ? b.Lo : b.Lt)[last[0]][h]; }
      }
      return u;
    }
    static softmaxMasked(u, mask) {
      let mx = -Infinity; for (let h = 0; h < u.length; h++) if (!mask[h] && u[h] > mx) mx = u[h];
      const p = new Float64Array(u.length); let s = 0;
      for (let h = 0; h < u.length; h++) if (!mask[h]) { p[h] = Math.exp(u[h] - mx); s += p[h]; }
      for (let h = 0; h < u.length; h++) p[h] /= s; return p;
    }
    /* Rollout context: each team's ban utility without the position and response terms (its own lineup for protection
       and fear), the response terms of the bans made so far, and the common random numbers. */
    rolloutCtx(c, pu, pt) {
      const H = this.H, b = this.m.ban, C = this.m.C;
      const base = rel => { const u = new Float64Array(H); for (let h = 0; h < H; h++) { let cr = 0; for (let j = 0; j < H; j++) cr += C[h][j] * rel[j]; u[h] = b.a[h] + b.am[c.m][h] + b.ab[c.bd][h] - b.lam * rel[h] + b.gam * cr; } return u; };
      const respU = new Float64Array(H), respT = new Float64Array(H);
      for (let h0 = 0; h0 < H; h0++) {
        if (c.BU[h0]) for (let h = 0; h < H; h++) { respU[h] += b.Ro[h0][h]; respT[h] += b.Rt[h0][h]; }
        if (c.BT[h0]) for (let h = 0; h < H; h++) { respT[h] += b.Ro[h0][h]; respU[h] += b.Rt[h0][h]; }
      }
      const fear = rel => { const f = new Float64Array(H); for (let h = 0; h < H; h++) { let cr = 0; for (let j = 0; j < H; j++) cr += C[h][j] * rel[j]; f[h] = cr; } return f; };
      const last = c.e > 0 ? [c.bans[c.e - 1], c.ours(c.e - 1)] : null;          // [hero, banned by us]
      return { c, baseU: base(pu), baseT: base(pt), respU, respT, G: this.noise(c), relU: pu, relT: pt, fearU: fear(pu), fearT: fear(pt), last };
    }
    noise(c) {                                         // Gumbel noise per rollout, ban position and hero; it depends on the lobby, not on the bans
      const key = c.seed + ":" + this.NS;             // so the state after a ban reuses the same draws for the positions still to come
      if (this._noiseKey === key) return this._noise;
      const H = this.H, R = rng(c.seed), G = new Float32Array(this.NS * 6 * H);
      for (let i = 0; i < G.length; i++) G[i] = gumbel(R);
      this._noiseKey = key; return (this._noise = G);
    }
    /* Sample the rest of the ban phase NS times. prefix: heroes we ban now (our positions e, e+1, ...); fix: heroes
       held at later positions (fix[ep]). Every other ban is drawn from the ban model given everything before it.
       visit(s, heroes) gets the heroes banned from position e on, in order. */
    rollout(rc, prefix, fix, visit) {
      const c = rc.c, H = this.H, b = this.m.ban, G = rc.G, NS = this.NS, e = c.e;
      const rU = new Float64Array(H), rT = new Float64Array(H), done = new Uint8Array(H), seq = new Int32Array(6 - e);
      for (let s = 0; s < NS; s++) {
        rU.set(rc.respU); rT.set(rc.respT); done.set(c.BU); for (let h = 0; h < H; h++) if (c.BT[h]) done[h] = 1;
        let last = rc.last;
        for (let ep = e; ep < 6; ep++) {
          const us = c.ours(ep); let h = -1;
          if (ep - e < prefix.length) h = prefix[ep - e];
          else if (fix && fix[ep] !== undefined && !done[fix[ep]]) h = fix[ep];
          else {
            const base = us ? rc.baseU : rc.baseT, resp = us ? rU : rT, ae = b.ae[ep], g = (s * 6 + ep) * H; let bv = -Infinity;
            const B2 = this.B2, rel = us ? rc.relU : rc.relT, fr = us ? rc.fearU : rc.fearT, le = B2 ? b.lam_e[ep] : 0, ge = B2 ? b.gam_e[ep] : 0;
            const Lrow = B2 && last ? (last[1] === us ? b.Lo : b.Lt)[last[0]] : null;
            for (let x = 0; x < H; x++) {
              if (done[x] || (us && c.rv[x])) continue;
              let v = base[x] + ae[x] + resp[x] + G[g + x];
              if (B2) { v += -le * rel[x] + ge * fr[x]; if (Lrow) v += Lrow[x]; }
              if (v > bv) { bv = v; h = x; }
            }
          }
          done[h] = 1; seq[ep - e] = h; last = [h, us];
          const Ro = b.Ro[h], Rt = b.Rt[h], own = us ? rU : rT, oth = us ? rT : rU;
          for (let x = 0; x < H; x++) { own[x] += Ro[x]; oth[x] += Rt[x]; }
        }
        visit(s, seq);
      }
    }
    // ---- the value of every legal ban (and, on a two-ban turn, of the best pairs) for the team to move ("us")
    values(st) {
      /* The two bans of a two-ban turn are one decision. When the first of them is already in, the second is scored as
         completing that pair: lineups and rollouts start from the state at the start of the turn, with the first ban fixed.
         So the page's next suggestion after entering the pair's first ban is the pair's partner. */
      const c0 = this.ctx(st), ts = c0.e > 0 && c0.e < 6 && c0.ours(c0.e) && c0.ours(c0.e - 1) ? c0.e - 1 : c0.e;
      const pre = st.bans.slice(ts), c = ts < c0.e ? this.ctx(Object.assign({}, st, { bans: st.bans.slice(0, ts), rev: c0.rev })) : c0;
      const H = this.H, L = this.lineups(c), cnt = Math.min(st.cnt || 1, 6 - c0.e);
      const out = { Pu: L.pu, Pt: L.pt, PuRaw: L.puRaw, PtRaw: L.ptRaw, legal: c0.legal, band: c.bd, e: c0.e, cnt, turnStart: ts, pre, ess: L.ess };
      if (ts < c0.e) for (const h of pre) { out.Pu = out.Pu.slice(); out.Pt = out.Pt.slice(); out.Pu[h] = 0; out.Pt[h] = 0; }
      if (c0.e >= 6) return out;
      const M = this.m, bd = c.bd, m = c.m, NN = L.PuE.length, NS = this.NS;
      const adjC = new Float64Array(H), adjS = new Float64Array(H), R0 = new Float64Array(H), Rsd = new Float64Array(H);
      for (let x = 0; x < H; x++) {
        let a = 0, s = 0; for (const j of c.rev) { a += M.C[x][j] - M.ALTC[x][j]; s += M.S[x][j] - M.ALTS[x][j]; }
        adjC[x] = 0.25 * (a - c.rev.length * M.MC[x]); adjS[x] = 0.25 * (s - c.rev.length * M.MS[x]);
        R0[x] = M.removal_cost[x][bd][m]; Rsd[x] = M.removal_cost_sd[x][bd][m];
      }
      // w(y): what y being banned (by anyone) is worth to us, per network; the mean is used for the parts
      const w = L.PuE.map((Pu, k) => { const Pt = L.PtE[k], v = new Float64Array(H); for (let y = 0; y < H; y++) v[y] = Pt[y] * (R0[y] + adjC[y]) - Pu[y] * (R0[y] + adjS[y]); return v; });
      const wm = new Float64Array(H); for (const v of w) for (let y = 0; y < H; y++) wm[y] += v[y] / NN;
      const rc = this.rolloutCtx(c, L.pu, L.pt);
      // joint removal: x's openers also lose y when both are banned (new bans in this rollout, and bans made before the turn)
      const DP = this.DP, S0 = c.bans, dpt = L.PuE.map((Pu, k) => { const Pt = L.PtE[k], v = new Float64Array(H); for (let y = 0; y < H; y++) v[y] = Pt[y] - Pu[y]; return v; });
      const ex = new Float64Array(6);
      const Wof = (prefix, rec) => {                   // W per rollout and network: (NN, NS)
        const Wn = w.map(() => new Float64Array(NS));
        this.rollout(rc, pre.concat(prefix), null, (s, seq) => {
          if (DP) for (let i = 0; i < seq.length; i++) { const Dx = DP[seq[i]]; let t = 0; for (let j = 0; j < seq.length; j++) if (j !== i) t += Dx[seq[j]][bd]; for (const y of S0) t += Dx[y][bd]; ex[i] = t; }
          for (let k = 0; k < NN; k++) { let t = 0; for (const y of seq) t += w[k][y]; if (DP) for (let i = 0; i < seq.length; i++) t += dpt[k][seq[i]] * ex[i]; Wn[k][s] = t; }
          if (rec) rec(seq);
        });
        return Wn;
      };
      const PLb = new Float64Array(H), Wb = Wof([], seq => { for (const y of seq) PLb[y] += 1 / NS; });
      const compare = (Wx, x) => {                     // value against the typical bans, its model spread and its rollout error
        const Vn = Wx.map((a, k) => { let t = 0; for (let s = 0; s < NS; s++) t += a[s] - Wb[k][s]; return t / NS; });
        const V = Vn.reduce((p, q) => p + q, 0) / NN, vm = Vn.reduce((p, q) => p + (q - V) ** 2, 0) / NN;
        let m1 = 0, m2 = 0; for (let s = 0; s < NS; s++) { let d = 0; for (let k = 0; k < NN; k++) d += (Wx[k][s] - Wb[k][s]) / NN; m1 += d; m2 += d * d; }
        m1 /= NS; const mc = Math.sqrt(Math.max(0, m2 / NS - m1 * m1) / Math.max(1, NS - 1));
        const rs = x === undefined ? 0 : (1 - PLb[x]) * (L.pt[x] - L.pu[x]) * Rsd[x];
        const so = x === undefined ? 0 : (1 - PLb[x]) * (R0[x] + adjS[x]) * L.sePu[x];   // error of averaging our lineup over typical own bans
        return { V, seModel: Math.sqrt(vm + rs * rs), seMC: Math.sqrt(mc * mc + so * so) };
      };
      const V = new Float64Array(H).fill(NaN), se = new Float64Array(H).fill(NaN), seModel = new Float64Array(H).fill(NaN), seMC = new Float64Array(H).fill(NaN);
      const direct = new Float64Array(H).fill(NaN), other = new Float64Array(H).fill(NaN), cand = new Uint8Array(H);
      for (let x = 0; x < H; x++) {
        if (!c0.legal[x] || c.rv[x]) continue;
        cand[x] = 1; const r = compare(Wof([x]), x);
        V[x] = r.V; seModel[x] = r.seModel; seMC[x] = r.seMC; se[x] = Math.sqrt(r.seModel ** 2 + r.seMC ** 2);
        direct[x] = (1 - PLb[x]) * wm[x]; other[x] = V[x] - direct[x];
      }
      Object.assign(out, { V, se, seModel, seMC, direct, other, R: R0.map((r, x) => r + adjC[x]), Rus: R0.map((r, x) => r + adjS[x]), PL: PLb, cand, w: wm, _rc: rc, _L: L, _pre: pre });
      if (cnt === 2) {                                 // two bans now: score the shortlist's pairs jointly, never by adding two values
        const sl = Array.from(V.keys()).filter(h => cand[h]).sort((a, b) => V[b] - V[a]).slice(0, st.short || this.SHORT), pairs = [];
        for (let i = 0; i < sl.length; i++) for (let j = i + 1; j < sl.length; j++) {
          const a = sl[i], b = sl[j], r = compare(Wof([a, b]));
          pairs.push({ a, b, V: r.V, seModel: r.seModel, seMC: r.seMC, se: Math.sqrt(r.seModel ** 2 + r.seMC ** 2) });
        }
        out.pairs = pairs.sort((p, q) => q.V - p.V); out.shortlist = sl;
      }
      return out;
    }
    // ---- their ban in each later position (for the ban-phase boxes); fix[ep] holds bans already assumed
    forecast(res, fix) {
      const H = this.H, rc = res._rc, e = res.turnStart, NS = this.NS, cnt = Array.from({ length: 6 }, () => new Float64Array(H));
      this.rollout(rc, res._pre, fix, (s, seq) => { for (let i = 0; i < seq.length; i++) cnt[e + i][seq[i]] += 1 / NS; });
      return cnt.map((c, ep) => ep < res.e ? null : Array.from(c.keys()).sort((a, b) => c[b] - c[a]).slice(0, 2).map(h => ({ h, p: c[h] })));
    }
    // ---- what the other team is likely to ban at position e (they cannot see our hovers)
    theirNextBan(st, res) {
      const c = this.ctx(st), pt = res ? res.Pt : this.lineups(c).pt, last = c.e > 0 ? [c.bans[c.e - 1], !c.ours(c.e - 1)] : null;   // same team, from their side
      const u = this.banUtil(c.e, pt, c.BT, c.BU, c.m, c.bd, last), mask = new Uint8Array(this.H); for (let h = 0; h < this.H; h++) mask[h] = c.BU[h] || c.BT[h];
      return BanEngine.softmaxMasked(u, mask);
    }
  }
  root.BanEngine = BanEngine;
  if (typeof module !== "undefined") module.exports = { BanEngine };
})(typeof window !== "undefined" ? window : globalThis);
