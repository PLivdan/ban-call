/* Ban value engine v8: the value networks and the ban model of the ban-solver v8 notebook, in the browser.
   The notebook simulates whole lobbies (stand-in players near your rank, both teams' drafts after the bans, a fitted outcome
   model) and trains networks per ban position by backward induction: network k values a lobby after k bans, assuming our
   later bans follow the advice and theirs follow the ban model. So a ban's value needs no search here:
     Q(x) = network(k + 1)(the lobby after we ban x): the members' mean and SD;
     value(x) = mean Q(x) − the same for a typical ban (the ban model's probabilities for our team);
     the advice is the highest  mean − kappa × SD  among bans a typical team makes with probability >= support.
   Two formats. Members (v8.1): three optimal members, a behaviour and a robust member per position, each giving a logit.
   Student (v8.2 on): one network per position distilled from large teacher ensembles, with three outputs: the logit of the
   teachers' mean, the softplus of their SD, and the logit of the behaviour chain.
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
  const softplus = z => z > 30 ? z : Math.log1p(Math.exp(z));

  class Engine8 {
    constructor(layout, ban) {
      this.L = layout; this.H = layout.heroes.length; this.NM = layout.maps.length; this.NB = layout.bands.length + 1;
      this.ORDER = layout.order; this.KAPPA = layout.kappa; this.SUPP = layout.support; this.M = layout.members; this.FD = layout.input_dim;
      this.S = !!layout.student; this.NN = this.S ? layout.teachers.members : this.M;          // networks behind the spread
      this.O = {}; for (const b of layout.blocks) this.O[b[0]] = b[1];
      this.buf = {}; this.cache = new Map(); this.index = new Map();
      for (const w of layout.weights) this.index.set(`${w.position}|${w.chain}|${w.member}|${w.layer}|${w.name}`, w);
      const P = ban.params, H = this.H; this.B = P; this.pre = ban.premade_share; this.C = ban.counter;
      this.T = ban.stand_in_team_shares; this.SS = ban.shown_shares; this.PS = ban.player_shares; this.J = this.T[0].length;
      this.TP = ban.stand_in_players || null; this.SP = ban.shown_profiles || null;          // v8.4: six profiles per stand-in team
      if (this.TP) {                                 // TAIL[b][j][k]: the summed profiles of team j's players k..5
        this.TAIL = this.TP.map(tb => tb.map(pl => { const t = [new Float64Array(H)]; for (let k = 5; k >= 0; k--) { const u = Float64Array.from(t[0]); for (let h = 0; h < H; h++) u[h] += pl[k][h]; t.unshift(u); } return t; }));
      }
      this.hasTau = P.tau !== undefined; this.hasB = !!P.Lo; this.hasV8 = !!P.acm;
    }
    /* A weight file (ArrayBuffer), checked before anything uses it: its length must be the manifest's, every tensor must lie
       inside it, the layers must chain from the input to the outputs (3 for a student, 1 for a member), and every value must
       decode to a finite number. Throws otherwise, so a truncated or mismatched file never becomes a 50% forecast. */
    addBuffer(file, arrayBuffer) {
      const want = this.L.files && this.L.files[file] ? this.L.files[file].bytes : undefined;
      if (want !== undefined && arrayBuffer.byteLength !== want) throw new Error(`model file ${file}: ${arrayBuffer.byteLength} bytes, the manifest says ${want}`);
      const u = new Uint16Array(arrayBuffer), mine = this.L.weights.filter(w => w.file === file);
      if (!mine.length) throw new Error(`model file ${file}: the manifest lists no tensors in it`);
      for (const w of mine) {
        const n = w.shape.reduce((a, c) => a * c, 1);
        if (w.offset % 2 || w.offset / 2 + n > u.length) throw new Error(`model file ${file}: tensor ${w.position}/${w.chain}/${w.member}/${w.layer}/${w.name} lies outside the file`);
      }
      this.buf[file] = u;
      try { for (const k of new Set(mine.map(w => `${w.position}|${w.chain}|${w.member}`))) { const [p, c, m] = k.split("|"); this.net(+p, c, +m); } }
      catch (e) { delete this.buf[file]; this.cache.clear(); throw e; }
    }
    ready(chain) { return !!this.buf[this.S || chain === "optimal" ? "opt" : "aux"]; }
    band(r0) { let b = 0; for (const t of this.L.bands) if (r0 > t) b++; return b; }
    ours(firstUs, i) { return (this.ORDER[i] === 0) === firstUs; }
    // ---- networks, decoded from float16 the first time they are used
    net(pos, chain, member) {
      if (this.S) { chain = "student"; member = 0; }
      const key = `${pos}|${chain}|${member}`; if (this.cache.has(key)) return this.cache.get(key);
      const layers = [];
      for (let l = 0; ; l++) {
        const w = this.index.get(`${key}|${l}|W`), b = this.index.get(`${key}|${l}|b`); if (!w) break;
        const u = this.buf[w.file]; if (!u) return null;
        const dec = (e) => { const n = e.shape.reduce((a, c) => a * c, 1), o = new Float64Array(n), off = e.offset / 2; for (let i = 0; i < n; i++) o[i] = f16(u[off + i]); return o; };   // float64: the same values, faster loops
        const lay = { W: dec(w), b: dec(b), nin: w.shape[0], nout: w.shape[1] };
        if (lay.b.length !== lay.nout || lay.nin !== (l ? layers[l - 1].nout : this.FD)) throw new Error(`network ${key} layer ${l}: shape ${w.shape} does not chain`);
        for (const a of [lay.W, lay.b]) for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) throw new Error(`network ${key} layer ${l}: a weight is not finite`);
        layers.push(lay);
      }
      if (!layers.length || layers[layers.length - 1].nout !== (this.S ? 3 : 1)) throw new Error(`network ${key}: missing or wrong output layer`);
      this.cache.set(key, layers); return layers;
    }
    static first(layers, x) {                        // first-layer pre-activation for input x
      const { W, b, nout } = layers[0], z = Float64Array.from(b);
      for (let i = 0; i < x.length; i++) { const xi = x[i]; if (!xi) continue; const r = i * nout; for (let j = 0; j < nout; j++) z[j] += xi * W[r + j]; }
      return z;
    }
    static tail(layers, z0) { return Engine8.outs(layers, z0)[0]; }      // the logit (a member, or the student's mean)
    static outs(layers, z0) {                        // the rest of the network from the first layer's pre-activation: all outputs
      let a = new Float64Array(z0.length); for (let j = 0; j < z0.length; j++) a[j] = gelu(z0[j]);
      for (let l = 1; l < layers.length; l++) {
        const { W, b, nin, nout } = layers[l], o = Float64Array.from(b);
        for (let i = 0; i < nin; i++) { const ai = a[i]; if (ai === 0) continue; const r = i * nout; for (let j = 0; j < nout; j++) o[j] += ai * W[r + j]; }
        if (l < layers.length - 1) for (let j = 0; j < nout; j++) o[j] = gelu(o[j]);
        a = o;
      }
      return a;
    }
    logit(pos, chain, member, x) { const n = this.net(pos, chain, member); return n ? Engine8.tail(n, Engine8.first(n, x)) : NaN; }
    outputs(pos, x) { const n = this.net(pos); return n ? Array.from(Engine8.outs(n, Engine8.first(n, x))) : null; }   // the student's three outputs
    // ---- the network input for a lobby after e bans
    input(s, e, zeroLast = false) {
      const O = this.O, H = this.H, x = new Float64Array(this.FD);
      x[O.map + s.m] = 1; x[O.band + this.band(s.r0)] = 1; x[O.rank_z] = (s.r0 - this.L.rank_mean) / this.L.rank_sd; x[O.we_ban_first] = s.firstUs ? 1 : 0;
      for (let i = 0; i < e; i++) x[(this.ours(s.firstUs, i) ? O.our_bans : O.their_bans) + s.bans[i]] = 1;
      if (e > 0 && !zeroLast) x[O.last_ban + s.bans[e - 1]] = 1;
      if (s.you >= 0) x[O.your_hero + s.you] = 1;
      for (const h of s.mates) x[O.teammates_heroes + h] = 1;
      if (O.ban_order !== undefined) for (let i = 0; i < e; i++) x[O.ban_order + i * H + s.bans[i]] = 1;   // v8.4: which hero went at which position
      return x;
    }
    /* Values of every candidate as the next ban (position e, made by `usBan`): Q[member][h] from network e + 1. chain:
       "optimal" (members 0..M-1), "behaviour" or "robust" (one member). */
    children(s, e, cands, usBan, chain = "optimal") {
      if (this.S) { const V = this.studentChildren(s, e, cands, usBan); return V && (chain === "optimal" ? [V.mu] : [V.beh]); }
      const O = this.O, x = this.input(s, e, true), ms = chain === "optimal" ? this.M : 1, out = [];
      for (let m = 0; m < ms; m++) {
        const n = this.net(e + 1, chain, m); if (!n) return null;
        const z0 = Engine8.first(n, x), W = n[0].W, nout = n[0].nout, Q = new Float64Array(this.H).fill(NaN), z = new Float64Array(nout);
        const blk = usBan ? O.our_bans : O.their_bans, sq = O.ban_order !== undefined ? O.ban_order + e * this.H : -1;
        for (const h of cands) {
          const r1 = (blk + h) * nout, r2 = (O.last_ban + h) * nout, r3 = sq >= 0 ? (sq + h) * nout : -1;
          for (let j = 0; j < nout; j++) z[j] = z0[j] + W[r1 + j] + W[r2 + j] + (r3 >= 0 ? W[r3 + j] : 0);
          Q[h] = sig(Engine8.tail(n, z));
        }
        out.push(Q);
      }
      return out;
    }
    /* The student's mean, SD and behaviour value of every candidate as the next ban (Float64Arrays over heroes, NaN elsewhere). */
    studentChildren(s, e, cands, usBan) {
      const O = this.O, x = this.input(s, e, true), n = this.net(e + 1); if (!n) return null;
      const z0 = Engine8.first(n, x), W = n[0].W, nout = n[0].nout, z = new Float64Array(nout), blk = usBan ? O.our_bans : O.their_bans;
      const mu = new Float64Array(this.H).fill(NaN), sd = new Float64Array(this.H).fill(NaN), beh = new Float64Array(this.H).fill(NaN);
      const sq = O.ban_order !== undefined ? O.ban_order + e * this.H : -1;
      for (const h of cands) {
        const r1 = (blk + h) * nout, r2 = (O.last_ban + h) * nout, r3 = sq >= 0 ? (sq + h) * nout : -1;
        for (let j = 0; j < nout; j++) z[j] = z0[j] + W[r1 + j] + W[r2 + j] + (r3 >= 0 ? W[r3 + j] : 0);
        const o = Engine8.outs(n, z); mu[h] = sig(o[0]); sd[h] = softplus(o[1]); beh[h] = sig(o[2]);
      }
      return { mu, sd, beh };
    }
    /* Mean and SD over the networks for every candidate, and the members' values when there are members (Q, else null). */
    values(s, e, cands, usBan) {
      if (this.S) { const V = this.studentChildren(s, e, cands, usBan); return V && { mu: V.mu, sd: V.sd, Q: null }; }
      const Q = this.children(s, e, cands, usBan); if (!Q) return null;
      const mu = new Float64Array(this.H).fill(NaN), sd = new Float64Array(this.H).fill(NaN);
      for (const h of cands) { let a = 0; for (const q of Q) a += q[h]; a /= Q.length; let v = 0; for (const q of Q) v += (q[h] - a) ** 2; mu[h] = a; sd[h] = Math.sqrt(v / Q.length); }
      return { mu, sd, Q };
    }
    winNow(s, chain = "optimal") {                   // P(we win) for the lobby as it stands, per member (the student: one value)
      const e = s.bans.length, x = this.input(s, e), ms = chain === "optimal" ? this.M : 1, o = [];
      if (this.S) { const v = this.outputs(e, x); return v && [sig(chain === "optimal" ? v[0] : v[2])]; }
      for (let m = 0; m < ms; m++) { const v = this.logit(e, chain, m, x); if (isNaN(v)) return null; o.push(sig(v)); }
      return o;
    }
    // ---- the ban model
    relTables(s) {                                   // stand-in teams' summed hero shares: ours (following the shown heroes) and theirs
      const bd = this.band(s.r0), H = this.H, T = this.T[bd], J = this.J, shown = [...new Set([s.you].concat(s.mates).filter(h => h >= 0))];
      const us = [], them = [];
      for (let j = 0; j < J; j++) {
        let u;
        if (this.TP) {                               // v8.4: the shown heroes' profiles in the first slots, team j's own players after
          u = Float64Array.from(this.TAIL[bd][j][Math.min(shown.length, 6)]);
          for (const h of shown) { const S = this.SP[bd][h]; for (let k = 0; k < H; k++) u[k] += S[k]; }
        } else {
          u = Float64Array.from(T[j]);
          if (this.SS) for (const h of shown) { const S = this.SS[bd][h], A = this.PS[bd]; for (let k = 0; k < H; k++) u[k] += S[k] - A[k]; }
        }
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
      const VV = this.values(s, e, cands, true); if (!VV) return null;
      const { mu, sd, Q } = VV, pe = this.banProbs(s, e, allowed);
      let base = 0; for (const h of cands) base += pe[h] * mu[h];
      const sup = cands.filter(h => pe[h] >= this.SUPP), pool = sup.length ? sup : cands;
      let best = pool[0]; for (const h of pool) if (mu[h] - this.KAPPA * sd[h] > mu[best] - this.KAPPA * sd[best]) best = h;
      const V = new Float64Array(H).fill(NaN); for (const h of cands) V[h] = mu[h] - base;
      const votes = Q ? Q.map(q => { let b = pool[0]; for (const h of pool) if (q[h] > q[b]) b = h; return b; }) : null;
      const R = { e, cands, allowed, Q, mu, sd, V, pe, base, best, supported: new Set(sup), votes };
      R.spread = h => this.spread(Q ? Q.map(q => q[h] - base) : null, V[h], sd[h]);
      R.clear = (a, b) => Q ? Q.every(q => q[a] > q[b]) : mu[a] - mu[b] > sd[a] + sd[b];
      return R;
    }
    /* The networks' range for a value v (points against the baseline): the members' lowest and highest, and the members
       themselves; for the student, one SD either side of the mean. */
    spread(mv, v, sd) { return mv ? { lo: Math.min(...mv), hi: Math.max(...mv), pts: mv } : { lo: v - sd, hi: v + sd, pts: [] }; }
    /* A two-ban turn as the advice plays it (and as the notebook evaluates it): the advised first ban, then the advice again at
       the state after it, with the support rule at each state. Values against the single bans' baseline (a typical first ban,
       then the best second ban). */
    sequence(s, R) {
      const R2 = this.ourTurn(Object.assign({}, s, { bans: s.bans.concat([R.best]) })); if (!R2) return null;
      const b = R2.best, mv = R2.Q ? R2.Q.map(q => q[b] - R.base) : null, V = R2.mu[b] - R.base;
      return { a: R.best, b, mu: R2.mu[b], sd: R2.sd[b], V, mv, spread: this.spread(mv, V, R2.sd[b]), seq: true };
    }
    /* Pairs scored together, for comparison with the advice (not the advice itself): after each of the top supported first bans
       x, every second ban y that is supported at the state after x (all legal ones when none is), from network e + 2. */
    pairs(s, R, nFirst = 6, bothOrders = false) {
      const e = R.e, H = this.H, sc = h => R.mu[h] - this.KAPPA * R.sd[h], pool1 = R.supported.size ? R.cands.filter(h => R.supported.has(h)) : R.cands;
      const first = pool1.slice().sort((a, b) => sc(b) - sc(a)).slice(0, nFirst), out = [];
      for (const x of first) {
        const s2 = Object.assign({}, s, { bans: s.bans.concat([x]) }), cands = R.cands.filter(h => h !== x), VV = this.values(s2, e + 1, cands, true); if (!VV) return null;
        const al2 = new Uint8Array(H); for (const h of cands) al2[h] = 1; const pe2 = this.banProbs(s2, e + 1, al2), sup2 = cands.filter(h => pe2[h] >= this.SUPP);
        for (const y of (sup2.length ? sup2 : cands)) {
          const mv = VV.Q ? VV.Q.map(q => q[y] - R.base) : null, V = VV.mu[y] - R.base;
          out.push({ a: x, b: y, mu: VV.mu[y], sd: VV.sd[y], V, mv, spread: this.spread(mv, V, VV.sd[y]) });
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
      const W = this.banProbs(s, e, legal, true), pe = W.p, VV = this.values(s, e, cands, false);
      const mu = VV ? VV.mu : new Float64Array(H).fill(NaN);
      let base = 0; if (VV) for (const h of cands) base += pe[h] * mu[h];
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
