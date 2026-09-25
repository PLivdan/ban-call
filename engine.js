/* Ban value engine: a port of the notebook's Part B `ban_values` (tools/engine_ref.py mirrors it in numpy).
   value(x) = (1 - P_later(x)) * [P_them(x) * R_them(x) - P_us(x) * R_us(x)] + their reply
   Runs in the browser and in Node (tools/check_engine.js compares it with the numpy reference). */
(function (root) {
  "use strict";
  function f16(u) {                                  // IEEE half -> float
    const s = (u & 0x8000) ? -1 : 1, e = (u >> 10) & 0x1f, f = u & 0x3ff;
    if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  }
  const gelu = z => 0.5 * z * (1 + Math.tanh(0.7978845608028654 * (z + 0.044715 * z * z * z)));

  class BanEngine {
    constructor(meta, buffer) {
      this.m = meta; this.H = meta.heroes.length; this.NM = meta.maps.length; this.NB = meta.bands.length + 1;
      this.RE = (meta.feature_layout && meta.feature_layout.rank_edges) || meta.bands; this.NRF = this.RE.length + 1;   // rank one-hot for the lineup network (v5: 9 bins)
      this.ORDER = meta.ban_order; this.role = meta.roles;
      const u16 = new Uint16Array(buffer), all = new Float32Array(u16.length);
      for (let i = 0; i < u16.length; i++) all[i] = f16(u16[i]);
      this.nets = meta.weights.models.map(ent => {
        const o = {};
        for (const k in ent) { const n = ent[k].shape.reduce((a, b) => a * b, 1); o[k] = all.subarray(ent[k].offset, ent[k].offset + n); o[k + "_shape"] = ent[k].shape; }
        return o;
      });
      this.FD = this.nets[0].W1_shape[0]; this.HID = this.nets[0].W1_shape[1];
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
    probs(x, rev, banned) {
      return this.nets.map(net => { const P = this.netProb(net, x); for (const h of banned) P[h] = 0; for (const h of rev) P[h] = 1; return P; });
    }
    // ---- ban model: probability each hero is banned in the remaining positions (after our current turn)
    banUtil(ep, rel, own, oth, m, bd) {
      const b = this.m.ban, H = this.H, u = new Float64Array(H);
      for (let h = 0; h < H; h++) {
        let v = b.a[h] + b.am[m][h] + b.ab[bd][h] + b.ae[ep][h] - b.lam * rel[h], cr = 0, ro = 0;
        const Ch = this.m.C[h]; for (let j = 0; j < H; j++) cr += Ch[j] * rel[j];
        for (let i = 0; i < H; i++) { if (own[i]) ro += b.Ro[i][h]; if (oth[i]) ro += b.Rt[i][h]; }
        u[h] = v + b.gam * cr + ro;
      }
      return u;
    }
    static softmaxMasked(u, mask) {
      let mx = -Infinity; for (let h = 0; h < u.length; h++) if (!mask[h] && u[h] > mx) mx = u[h];
      const p = new Float64Array(u.length); let s = 0;
      for (let h = 0; h < u.length; h++) if (!mask[h]) { p[h] = Math.exp(u[h] - mx); s += p[h]; }
      for (let h = 0; h < u.length; h++) p[h] /= s; return p;
    }
    later(firstUs, eNext, BU, BT, Pu, Pt, m, bd, prot) {
      const H = this.H, surv = new Float64Array(H).fill(1), done = new Uint8Array(H);
      for (let h = 0; h < H; h++) done[h] = BU[h] || BT[h] ? 1 : 0;
      for (let ep = eNext; ep < 6; ep++) {
        const ours = (this.ORDER[ep] === 0) === firstUs;
        const u = this.banUtil(ep, ours ? Pu : Pt, ours ? BU : BT, ours ? BT : BU, m, bd);
        const mask = new Uint8Array(H); for (let h = 0; h < H; h++) mask[h] = done[h] || (ours && prot[h]) ? 1 : 0;
        const p = BanEngine.softmaxMasked(u, mask); for (let h = 0; h < H; h++) surv[h] *= 1 - p[h];
      }
      return surv.map(v => 1 - v);
    }
    // ---- the value of every legal ban for the team to move ("us")
    values(st) {
      const { firstUs, bans, rev, m, r0 } = st, H = this.H, e = bans.length, bd = this.band(r0), sideUs = firstUs ? 0 : 1;
      const cnt = st.cnt || 1, BU = new Uint8Array(H), BT = new Uint8Array(H);
      bans.forEach((h, i) => { ((this.ORDER[i] === 0) === firstUs ? BU : BT)[h] = 1; });
      const rv = new Uint8Array(H); for (const h of rev) rv[h] = 1;
      const ownU = [], ownT = []; for (let h = 0; h < H; h++) { if (BU[h]) ownU.push(h); if (BT[h]) ownT.push(h); }
      const banned = ownU.concat(ownT);
      const rf = this.rankFeat(r0);
      const PuE = this.probs(this.features(rev, ownU, ownT, m, rf, sideUs, e), rev, banned);
      const PtE = this.probs(this.features([], ownT, ownU, m, rf, 1 - sideUs, e), [], banned);
      const mean = A => { const o = new Float64Array(H); for (const a of A) for (let h = 0; h < H; h++) o[h] += a[h] / A.length; return o; };
      const pu = mean(PuE), pt = mean(PtE), revL = rev.length;
      const adjC = new Float64Array(H), adjS = new Float64Array(H), R0 = new Float64Array(H), Rsd = new Float64Array(H);
      for (let x = 0; x < H; x++) {
        let c = 0, s = 0; for (const j of rev) { c += this.m.C[x][j] - this.m.ALTC[x][j]; s += this.m.S[x][j] - this.m.ALTS[x][j]; }
        adjC[x] = 0.25 * (c - revL * this.m.MC[x]); adjS[x] = 0.25 * (s - revL * this.m.MS[x]);
        R0[x] = this.m.removal_cost[x][bd][m]; Rsd[x] = this.m.removal_cost_sd[x][bd][m];
      }
      const legal = new Uint8Array(H); for (let h = 0; h < H; h++) legal[h] = !BU[h] && !BT[h] && !rv[h] ? 1 : 0;
      const PL0 = this.later(firstUs, e + cnt, BU, BT, pu, pt, m, bd, rv);
      const reply = new Float64Array(H);
      if (st.reply !== false) {
        const vy = new Float64Array(H); for (let y = 0; y < H; y++) vy[y] = pt[y] * (R0[y] + adjC[y]) - pu[y] * (R0[y] + adjS[y]);
        for (let x = 0; x < H; x++) {
          if (!legal[x]) continue;
          const BUx = BU.slice(); BUx[x] = 1; const PLx = this.later(firstUs, e + cnt, BUx, BT, pu, pt, m, bd, rv);
          let r = 0; for (let y = 0; y < H; y++) if (y !== x) r += (PLx[y] - PL0[y]) * vy[y];
          reply[x] = r;
        }
      }
      const Vm = PuE.map((Pu, i) => {
        const Pt = PtE[i], PL = this.later(firstUs, e + cnt, BU, BT, Pu, Pt, m, bd, rv), v = new Float64Array(H);
        for (let x = 0; x < H; x++) v[x] = (1 - PL[x]) * (Pt[x] * (R0[x] + adjC[x]) - Pu[x] * (R0[x] + adjS[x]));
        return v;
      });
      const V = new Float64Array(H).fill(NaN), se = new Float64Array(H).fill(NaN), first = new Float64Array(H);
      for (let x = 0; x < H; x++) {
        if (!legal[x]) continue;
        let mu = 0; for (const v of Vm) mu += v[x] / Vm.length; let va = 0; for (const v of Vm) va += (v[x] - mu) ** 2 / Vm.length;
        const rs = (1 - PL0[x]) * (pt[x] - pu[x]) * Rsd[x];
        V[x] = mu + reply[x]; se[x] = Math.sqrt(va + rs * rs); first[x] = mu;
      }
      const R = R0.map((r, x) => r + adjC[x]);
      return { V, se, first, reply, Pu: pu, Pt: pt, R, Rus: R0.map((r, x) => r + adjS[x]), PL: PL0, legal, band: bd };
    }
    // ---- what the other team is likely to ban at position e (they cannot see our hovers)
    theirNextBan(st) {
      const { firstUs, bans, m, r0 } = st, H = this.H, e = bans.length, bd = this.band(r0);
      const BU = new Uint8Array(H), BT = new Uint8Array(H); bans.forEach((h, i) => { ((this.ORDER[i] === 0) === firstUs ? BU : BT)[h] = 1; });
      const ownU = [], ownT = []; for (let h = 0; h < H; h++) { if (BU[h]) ownU.push(h); if (BT[h]) ownT.push(h); }
      const Pt = this.probs(this.features([], ownT, ownU, m, this.rankFeat(r0), firstUs ? 1 : 0, e), [], ownU.concat(ownT));
      const pt = new Float64Array(H); for (const a of Pt) for (let h = 0; h < H; h++) pt[h] += a[h] / Pt.length;
      const u = this.banUtil(e, pt, BT, BU, m, bd), mask = new Uint8Array(H); for (let h = 0; h < H; h++) mask[h] = BU[h] || BT[h];
      return BanEngine.softmaxMasked(u, mask);
    }
  }
  root.BanEngine = BanEngine;
  if (typeof module !== "undefined") module.exports = { BanEngine };
})(typeof window !== "undefined" ? window : globalThis);
