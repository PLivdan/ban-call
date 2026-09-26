/* Ban value engine v8: the value networks and the ban model of the ban-solver v8 notebook, in the browser.
   The notebook simulates whole lobbies (stand-in players near your rank, both teams' drafts after the bans, a fitted outcome
   model) and trains one small network per ban position by backward induction: network k values a lobby after k bans,
   assuming our later bans follow the advice and theirs follow the ban model. So a ban's value needs no search here:
     Q(x) = network(k + 1)(the lobby after we ban x), for each of the three optimal members;
     value(x) = mean over members of Q(x) − the same for a typical ban (the ban model's probabilities for our team);
     the advice is the highest  mean − kappa × SD  among bans a typical team makes with probability >= support.
   Inputs are what the page knows: map, rank, whether we ban first, both teams' bans so far and the last one, your hero and
   your teammates' shown heroes. The networks' first layer is linear in the bans, so every next ban costs one row added to a
   shared first-layer sum and two hidden layers.
   Their bans come from the ban model with stand-in teams per rank band (averaged over them): popularity by map, rank and
   position, protection of their own players' heroes, fear of heroes that beat them, reactions to every earlier ban, and
   targeting of the heroes our players play (our stand-ins follow the heroes we show).
   Runs in the browser and in Node (tools/check_v8.js). */
(function (root) {
  "use strict";
  function f16(u) {                                  // IEEE half -> float
    const s = (u & 0x8000) ? -1 : 1, e = (u >> 10) & 0x1f, f = u & 0x3ff;
    if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  }
  const gelu = z => 0.5 * z * (1 + Math.tanh(0.7978845608028654 * (z + 0.044715 * z * z * z)));
  const sig = z => 1 / (1 + Math.exp(-z));

  class Engine8 {
    constructor(layout, ban) {
      this.L = layout; this.H = layout.heroes.length; this.NM = layout.maps.length; this.NB = layout.bands.length + 1;
      this.ORDER = layout.order; this.KAPPA = layout.kappa; this.SUPP = layout.support; this.M = layout.members; this.FD = layout.input_dim;
      this.O = {}; for (const b of layout.blocks) this.O[b[0]] = b[1];
      this.buf = {}; this.cache = new Map(); this.index = new Map();
      for (const w of layout.weights) this.index.set(`${w.position}|${w.chain}|${w.member}|${w.layer}|${w.name}`, w);
      const P = ban.params, H = this.H; this.B = P; this.pre = ban.premade_share; this.C = ban.counter;
      this.T = ban.stand_in_team_shares; this.SS = ban.shown_shares; this.PS = ban.player_shares; this.J = this.T[0].length;
      this.hasTau = P.tau !== undefined; this.hasB = !!P.Lo; this.hasV8 = !!P.acm;
    }
    addBuffer(file, arrayBuffer) { this.buf[file] = new Uint16Array(arrayBuffer); }
    ready(chain) { return !!this.buf[chain === "optimal" ? "opt" : "aux"]; }
    band(r0) { let b = 0; for (const t of this.L.bands) if (r0 > t) b++; return b; }
    ours(firstUs, i) { return (this.ORDER[i] === 0) === firstUs; }
    // ---- networks, decoded from float16 the first time they are used
    net(pos, chain, member) {
      const key = `${pos}|${chain}|${member}`; if (this.cache.has(key)) return this.cache.get(key);
      const layers = [];
      for (let l = 0; ; l++) {
        const w = this.index.get(`${key}|${l}|W`), b = this.index.get(`${key}|${l}|b`); if (!w) break;
        const u = this.buf[w.file]; if (!u) return null;
        const dec = (e) => { const n = e.shape.reduce((a, c) => a * c, 1), o = new Float32Array(n), off = e.offset / 2; for (let i = 0; i < n; i++) o[i] = f16(u[off + i]); return o; };
        layers.push({ W: dec(w), b: dec(b), nin: w.shape[0], nout: w.shape[1] });
      }
      this.cache.set(key, layers); return layers;
    }
    static first(layers, x) {                        // first-layer pre-activation for input x
      const { W, b, nout } = layers[0], z = Float64Array.from(b);
      for (let i = 0; i < x.length; i++) { const xi = x[i]; if (!xi) continue; const r = i * nout; for (let j = 0; j < nout; j++) z[j] += xi * W[r + j]; }
      return z;
    }
    static tail(layers, z0) {                        // the rest of the network from the first layer's pre-activation: the logit
      let a = new Float64Array(z0.length); for (let j = 0; j < z0.length; j++) a[j] = gelu(z0[j]);
      for (let l = 1; l < layers.length; l++) {
        const { W, b, nin, nout } = layers[l], o = Float64Array.from(b);
        for (let i = 0; i < nin; i++) { const ai = a[i]; if (ai === 0) continue; const r = i * nout; for (let j = 0; j < nout; j++) o[j] += ai * W[r + j]; }
        if (l < layers.length - 1) for (let j = 0; j < nout; j++) o[j] = gelu(o[j]);
        a = o;
      }
      return a[0];
    }
    logit(pos, chain, member, x) { const n = this.net(pos, chain, member); return n ? Engine8.tail(n, Engine8.first(n, x)) : NaN; }
    // ---- the network input for a lobby after e bans
    input(s, e, zeroLast = false) {
      const O = this.O, H = this.H, x = new Float64Array(this.FD);
      x[O.map + s.m] = 1; x[O.band + this.band(s.r0)] = 1; x[O.rank_z] = (s.r0 - this.L.rank_mean) / this.L.rank_sd; x[O.we_ban_first] = s.firstUs ? 1 : 0;
      for (let i = 0; i < e; i++) x[(this.ours(s.firstUs, i) ? O.our_bans : O.their_bans) + s.bans[i]] = 1;
      if (e > 0 && !zeroLast) x[O.last_ban + s.bans[e - 1]] = 1;
      if (s.you >= 0) x[O.your_hero + s.you] = 1;
      for (const h of s.mates) x[O.teammates_heroes + h] = 1;
      return x;
    }
    /* Values of every candidate as the next ban (position e, made by `usBan`): Q[member][h] from network e + 1. chain:
       "optimal" (members 0..M-1), "behaviour" or "robust" (one member). */
    children(s, e, cands, usBan, chain = "optimal") {
      const O = this.O, x = this.input(s, e, true), ms = chain === "optimal" ? this.M : 1, out = [];
      for (let m = 0; m < ms; m++) {
        const n = this.net(e + 1, chain, m); if (!n) return null;
        const z0 = Engine8.first(n, x), W = n[0].W, nout = n[0].nout, Q = new Float64Array(this.H).fill(NaN), z = new Float64Array(nout);
        const blk = usBan ? O.our_bans : O.their_bans;
        for (const h of cands) {
          const r1 = (blk + h) * nout, r2 = (O.last_ban + h) * nout;
          for (let j = 0; j < nout; j++) z[j] = z0[j] + W[r1 + j] + W[r2 + j];
          Q[h] = sig(Engine8.tail(n, z));
        }
        out.push(Q);
      }
      return out;
    }
    winNow(s, chain = "optimal") {                   // P(we win) for the lobby as it stands, per member
      const e = s.bans.length, x = this.input(s, e), ms = chain === "optimal" ? this.M : 1, o = [];
      for (let m = 0; m < ms; m++) { const v = this.logit(e, chain, m, x); if (isNaN(v)) return null; o.push(sig(v)); }
      return o;
    }
    // ---- the ban model
    relTables(s) {                                   // stand-in teams' summed hero shares: ours (following the shown heroes) and theirs
      const bd = this.band(s.r0), H = this.H, T = this.T[bd], J = this.J, shown = [s.you].concat(s.mates).filter(h => h >= 0);
      const us = [], them = [];
      for (let j = 0; j < J; j++) {
        const u = Float64Array.from(T[j]);
        if (this.SS) for (const h of shown) { const S = this.SS[bd][h], A = this.PS[bd]; for (let k = 0; k < H; k++) u[k] += S[k] - A[k]; }
        us.push(u); them.push(Float64Array.from(T[(j + (J >> 1)) % J]));   // their stand-ins: a different draw
      }
      return { us, them };
    }
    /* P(ban = h) at position e for the team banning there, averaged over the stand-in teams. allowed: Uint8Array. Also
       returns the utility split into its parts for the page's "why" figure (averaged over the stand-in teams). */
    banProbs(s, e, allowed, parts = false) {
      const P = this.B, H = this.H, m = s.m, bd = this.band(s.r0), usBan = this.ours(s.firstUs, e);
      const own = new Uint8Array(H), oth = new Uint8Array(H);
      for (let i = 0; i < e; i++) ((this.ours(s.firstUs, i) === usBan) ? own : oth)[s.bans[i]] = 1;
      const last = e > 0 ? s.bans[e - 1] : -1, same = e > 0 && this.ORDER[e - 1] === this.ORDER[e], sg = this.ORDER[e] === 0 ? 1 : -1;
      const base = new Float64Array(H), react = new Float64Array(H);
      for (let h = 0; h < H; h++) {
        let v = P.a[h] + P.am[m][h] + P.ab[bd][h] + P.ae[e][h]; if (this.hasV8) v += sg * P.acm[m][h];
        let r = 0; for (let i = 0; i < H; i++) { if (own[i]) r += P.Ro[i][h]; if (oth[i]) r += P.Rt[i][h]; }
        if (last >= 0 && this.hasB) r += (same ? P.Lo : P.Lt)[last][h];
        base[h] = v; react[h] = r;
      }
      const lam = P.lam + (this.hasB ? P.lam_e[e] : 0) + (this.hasV8 ? this.pre * P.lam_p : 0), gam = P.gam + (this.hasB ? P.gam_e[e] : 0) + (this.hasV8 ? this.pre * P.gam_p : 0);
      const tau = this.hasTau ? P.tau + P.tau_e[e] : 0, R = this.relTables(s), p = new Float64Array(H), J = this.J, C = this.C;
      const avg = parts ? { prot: new Float64Array(H), fear: new Float64Array(H), targ: new Float64Array(H) } : null;
      for (let j = 0; j < J; j++) {
        const REL = usBan ? R.us[j] : R.them[j], RX = usBan ? R.them[j] : R.us[j], u = new Float64Array(H); let mx = -Infinity;
        for (let h = 0; h < H; h++) {
          if (!allowed[h]) continue; let fear = 0; const Ch = C[h]; for (let k = 0; k < H; k++) fear += REL[k] * Ch[k];
          u[h] = base[h] + react[h] - lam * REL[h] + gam * fear + tau * RX[h]; if (u[h] > mx) mx = u[h];
          if (avg) { avg.prot[h] += -lam * REL[h] / J; avg.fear[h] += gam * fear / J; avg.targ[h] += tau * RX[h] / J; }
        }
        let se = 0; for (let h = 0; h < H; h++) if (allowed[h]) se += Math.exp(u[h] - mx);
        for (let h = 0; h < H; h++) if (allowed[h]) p[h] += Math.exp(u[h] - mx) / se / J;
      }
      return parts ? { p, base, react, ...avg } : p;
    }
    // ---- one lobby: everything the page shows
    state(st) { return { m: st.m, r0: st.r0, firstUs: st.firstUs, bans: st.bans.slice(), you: st.you, mates: st.mates.slice() }; }
    legal(s) { const L = new Uint8Array(this.H).fill(1); for (const h of s.bans) L[h] = 0; return L; }
    shownSet(s) { return new Set([s.you].concat(s.mates).filter(h => h >= 0)); }
    /* Our turn: every allowed ban's value against a typical ban, the members' spread, the advice. */
    ourTurn(s) {
      const e = s.bans.length, H = this.H, legal = this.legal(s), shown = this.shownSet(s), allowed = new Uint8Array(H), cands = [];
      for (let h = 0; h < H; h++) if (legal[h] && !shown.has(h)) { allowed[h] = 1; cands.push(h); }
      const Q = this.children(s, e, cands, true); if (!Q) return null;
      const mu = new Float64Array(H).fill(NaN), sd = new Float64Array(H).fill(NaN), pe = this.banProbs(s, e, allowed);
      for (const h of cands) { let a = 0; for (const q of Q) a += q[h]; a /= Q.length; let v = 0; for (const q of Q) v += (q[h] - a) ** 2; mu[h] = a; sd[h] = Math.sqrt(v / Q.length); }
      let base = 0; for (const h of cands) base += pe[h] * mu[h];
      const sup = cands.filter(h => pe[h] >= this.SUPP), pool = sup.length ? sup : cands;
      let best = pool[0]; for (const h of pool) if (mu[h] - this.KAPPA * sd[h] > mu[best] - this.KAPPA * sd[best]) best = h;
      const V = new Float64Array(H).fill(NaN); for (const h of cands) V[h] = mu[h] - base;
      const votes = Q.map(q => { let b = pool[0]; for (const h of pool) if (q[h] > q[b]) b = h; return b; });
      return { e, cands, allowed, Q, mu, sd, V, pe, base, best, supported: new Set(sup), votes };
    }
    /* A two-ban turn: after each of the top first bans x, every second ban y from network e + 2. Values against the same
       typical-first-ban baseline as the single bans (a typical first ban, then the best second ban). */
    pairs(s, R, nFirst = 6, bothOrders = false) {
      const e = R.e, H = this.H, first = R.cands.slice().sort((a, b) => (R.mu[b] - this.KAPPA * R.sd[b]) - (R.mu[a] - this.KAPPA * R.sd[a])).slice(0, nFirst), out = [];
      for (const x of first) {
        const s2 = Object.assign({}, s, { bans: s.bans.concat([x]) }), cands = R.cands.filter(h => h !== x), Q = this.children(s2, e + 1, cands, true); if (!Q) return null;
        for (const y of cands) {
          let a = 0; for (const q of Q) a += q[y]; a /= Q.length; let v = 0; for (const q of Q) v += (q[y] - a) ** 2;
          out.push({ a: x, b: y, mu: a, sd: Math.sqrt(v / Q.length), V: a - R.base, mv: Q.map(q => q[y] - R.base) });
        }
      }
      if (bothOrders) return out.sort((p, q) => (q.mu - this.KAPPA * q.sd) - (p.mu - this.KAPPA * p.sd));
      const seen = new Set(), uniq = [];
      for (const p of out.sort((p, q) => (q.mu - this.KAPPA * q.sd) - (p.mu - this.KAPPA * p.sd))) { const k = Math.min(p.a, p.b) + "," + Math.max(p.a, p.b); if (!seen.has(k)) { seen.add(k); uniq.push(p); } }
      return uniq;
    }
    /* Their turn: the forecast of their ban, and what each of their likely bans does to our win chance. */
    theirTurn(s) {
      const e = s.bans.length, H = this.H, legal = this.legal(s), cands = []; for (let h = 0; h < H; h++) if (legal[h]) cands.push(h);
      const W = this.banProbs(s, e, legal, true), pe = W.p, Q = this.children(s, e, cands, false);
      const mu = new Float64Array(H).fill(NaN); if (Q) for (const h of cands) { let a = 0; for (const q of Q) a += q[h]; mu[h] = a / Q.length; }
      let base = 0; if (Q) for (const h of cands) base += pe[h] * mu[h];
      return { e, pe, why: W, mu, base, cands };
    }
    /* The likeliest path through the rest of the ban phase: our bans as advised, theirs the likeliest. */
    path(s) {
      const out = [], t = this.state(s);
      for (let e = t.bans.length; e < 6; e++) {
        let h;
        if (this.ours(t.firstUs, e)) { const R = this.ourTurn(t); if (!R) return out; h = R.best; out.push({ e, h, us: true }); }
        else { const L = this.legal(t), p = this.banProbs(t, e, L); h = 0; for (let k = 0; k < this.H; k++) if (L[k] && p[k] > p[h]) h = k; out.push({ e, h, p: p[h], us: false, top: Array.from(p.keys()).filter(k => L[k]).sort((a, b) => p[b] - p[a]).slice(0, 2).map(k => ({ h: k, p: p[k] })) }); }
        t.bans.push(h);
      }
      return out;
    }
  }
  root.Engine8 = Engine8;
  if (typeof module !== "undefined") module.exports = { Engine8 };
})(typeof window !== "undefined" ? window : globalThis);
