# >>> value engine v7 (canonical numpy implementation; the notebook embeds this block verbatim, engine.js mirrors it)
"""Ban value engine v7 in numpy: the reference for the site's engine.js and the notebook's Part B.

A ban's value is a rollout comparison against a typical ban with the same budget:
  value(x) = E[W(bans from now on | we ban x)] - E[W(bans from now on | we ban as a typical team)]
  W(set)   = sum over the heroes in the set of P_them(y) R_them(y) - P_us(y) R_us(y)
The rest of the ban phase is sampled one ban at a time from the ban model (legality, acting team and response terms
updated after every ban) with common random numbers across candidates, so no "banned later" discount or reply bonus is
added afterwards. The other team sees public information only. Our own bans are interventions: our lineup is averaged
over the bans a typical team in our seat would have made. Lineup probabilities are made coherent (six heroes) only when
they describe one availability state (after all six bans, or with six fixed heroes). The two bans of a two-ban turn are
one decision: pairs are scored jointly, and once the first is in, the second completes the pair from the turn's start.
The random numbers are generated exactly as in engine.js, so the two agree to rounding on the same model."""
import numpy as np

def _u32(x): return x & 0xFFFFFFFF
def _imul(a, b): return _u32((a & 0xFFFFFFFF) * (b & 0xFFFFFFFF))
class Rng:
    """engine.js `rng` (a 32-bit counter hash), bit for bit."""
    def __init__(s, seed): s.a = _u32(seed)
    def __call__(s):
        s.a = _u32(s.a + 0x6D2B79F5); t = s.a
        t = _imul(t ^ (t >> 15), t | 1); t = _u32(t ^ _u32(t + _imul(t ^ (t >> 7), t | 61)))
        return _u32(t ^ (t >> 14)) / 4294967296.0
def gumbel(r): return -np.log(-np.log(r() * (1 - 2e-12) + 1e-12))
def seed_of(parts):
    h = 2166136261
    for v in parts: h = _imul(h ^ _u32(int(v)), 16777619)
    return h
def _gelu(z): return .5 * z * (1 + np.tanh(0.7978845608028654 * (z + .044715 * z ** 3)))

class Model:
    """M: the notebook's value-model export (ban_value_model_*.json as a dict), or the same fields built in memory."""
    def __init__(s, M, NS=512, NOWN=32, SHORT=10, salt=0, salt_own=None):
        s.M = M; s.H = len(M["heroes"]); s.NM = len(M["maps"]); s.ROLE = np.array(M["roles"]); s.ORDER = list(M["ban_order"])
        s.BANDS = list(M["bands"]); s.RE = list((M.get("feature_layout") or {}).get("rank_edges") or M["bands"])
        s.nets = [{k: np.asarray(v, np.float64) for k, v in p.items()} for p in M["lineup_models"]]
        s.FD = s.nets[0]["W1"].shape[0]
        s.R = np.asarray(M["removal_cost"], float); s.Rsd = np.asarray(M.get("removal_cost_boot_sd", M.get("removal_cost_sd")), float)
        s.C, s.S = np.asarray(M["C"], float), np.asarray(M["S"], float); s.ALTC, s.ALTS = np.asarray(M["ALTC"], float), np.asarray(M["ALTS"], float)
        s.MC, s.MS = np.asarray(M["MC"], float), np.asarray(M["MS"], float)
        s.bn = {k: (np.asarray(v, float) if np.ndim(v) else float(v)) for k, v in M["ban"].items()}
        s.NS, s.NOWN, s.SHORT, s.salt = NS, NOWN, SHORT, salt; s.salt_own = salt if salt_own is None else salt_own; s._nk = None
    def band(s, r0): return sum(1 for t in s.BANDS if r0 > t)
    def rank_feat(s, r0): return sum(1 for t in s.RE if r0 > t)
    def features(s, rev, own, opp, m, rf, side, stage):
        H = s.H; x = np.zeros(s.FD)
        for h in rev: x[h] = 1
        for h in own: x[H + h] = 1
        for h in opp: x[2 * H + h] = 1
        o = 3 * H; x[o + m] = 1; o += s.NM; x[o + rf] = 1; o += len(s.RE) + 1; x[o] = side; o += 1; x[o + stage] = 1; o += 7
        for h in rev: x[o + s.ROLE[h]] += 1
        return x
    def net_prob(s, p, x):
        h = _gelu(x @ p["W1"] + p["b1"]); h = _gelu(h @ p["W2"] + p["b2"]); return 1 / (1 + np.exp(-(h @ p["W3"] + p["b3"] + x @ p["Wl"])))
    def ctx(s, first_us, bans, rev, m, r0):
        H = s.H; bans = [int(b) for b in bans]; rev = [int(h) for h in rev if int(h) not in bans]
        ours = lambda i: (s.ORDER[i] == 0) == bool(first_us)
        BU = np.zeros(H, np.uint8); BT = np.zeros(H, np.uint8)
        for i, h in enumerate(bans): (BU if ours(i) else BT)[h] = 1
        rv = np.zeros(H, np.uint8); rv[rev] = 1; legal = ((BU == 0) & (BT == 0)).astype(np.uint8); srt = sorted(rev)
        base = [1 if first_us else 0, int(m), int(round(r0)), *srt]
        return dict(first_us=bool(first_us), bans=bans, rev=rev, m=int(m), r0=float(r0), e=len(bans), bd=s.band(r0), rf=s.rank_feat(r0), side_us=0 if first_us else 1,
                    BU=BU, BT=BT, ownU=[h for h in range(H) if BU[h]], ownT=[h for h in range(H) if BT[h]], rv=rv, legal=legal, ours=ours,
                    seed=seed_of([s.salt] + base), seed_own=seed_of([s.salt_own] + base))
    @staticmethod
    def coherent(P, free, slots):
        idx = np.nonzero(free)[0]
        if slots <= 0 or not len(idx): P[idx] = 0; return P
        if slots >= len(idx): P[idx] = 1; return P
        z = np.log(np.maximum(P[idx], 1e-12) / np.maximum(1 - P[idx], 1e-12)); lo, hi = -40., 40.
        for _ in range(80):
            mid = (lo + hi) / 2
            if (1 / (1 + np.exp(-(z + mid)))).sum() > slots: hi = mid
            else: lo = mid
        P[idx] = 1 / (1 + np.exp(-(z + (lo + hi) / 2))); return P
    def fix_up(s, P, c, fixed):
        H = s.H; fx = np.zeros(H, bool); fx[list(fixed)] = True; free = (c["legal"] > 0) & ~fx
        P = np.where(c["legal"] > 0, P, 0.); P[fx] = 1.
        if len(fixed) >= 6: P[free] = 0.
        elif c["e"] >= 6: s.coherent(P, free, 6 - len(fixed))
        return P
    def ban_util(s, ep, rel, own, oth, m, bd):
        b = s.bn; return b["a"] + b["am"][m] + b["ab"][bd] + b["ae"][ep] - b["lam"] * rel + b["gam"] * (s.C @ rel) + own @ b["Ro"] + oth @ b["Rt"]
    def lineups(s, c):
        H = s.H
        xt = s.features([], c["ownT"], c["ownU"], c["m"], c["rf"], 1 - c["side_us"], c["e"])
        PtRaw = [s.net_prob(p, xt) for p in s.nets]; PtE = [s.fix_up(P.copy(), c, []) for P in PtRaw]
        xu = s.features(c["rev"], c["ownU"], c["ownT"], c["m"], c["rf"], c["side_us"], c["e"]); PuRaw = [s.net_prob(p, xu) for p in s.nets]
        se_pu = np.zeros(H)
        if not c["ownU"]: PuE = [s.fix_up(P.copy(), c, c["rev"]) for P in PuRaw]
        else:
            x0 = s.features(c["rev"], [], [], c["m"], c["rf"], c["side_us"], 0); prior = np.mean([s.net_prob(p, x0) for p in s.nets], 0); prior[c["rev"]] = 1
            R = Rng(c["seed_own"] ^ 0x9e3779b9); sm_ = [np.zeros(H) for _ in s.nets]; cnt = np.zeros(H); m1 = np.zeros(H); m2 = np.zeros(H)
            for _ in range(s.NOWN):
                own = np.zeros(H, np.uint8); oth = np.zeros(H, np.uint8); done = np.zeros(H, bool); mine = []
                for i in range(c["e"]):
                    h0 = c["bans"][i]
                    if not c["ours"](i): oth[h0] = 1; done[h0] = True; continue
                    u = s.ban_util(i, prior, own, oth, c["m"], c["bd"]); best, bv = -1, -np.inf
                    for h in range(H):
                        if done[h] or c["rv"][h]: continue
                        v = u[h] + gumbel(R)
                        if v > bv: bv, best = v, h
                    own[best] = 1; done[best] = True; mine.append(best)
                xs = s.features(c["rev"], mine, c["ownT"], c["m"], c["rf"], c["side_us"], c["e"]); ok = own == 0; pm = np.zeros(H)
                for k, p in enumerate(s.nets): P = s.net_prob(p, xs); sm_[k][ok] += P[ok]; pm[ok] += P[ok] / len(s.nets)
                cnt[ok] += 1; m1[ok] += pm[ok]; m2[ok] += pm[ok] ** 2
            PuE = [s.fix_up(np.where(cnt > 0, sm_[k] / np.maximum(cnt, 1), PuRaw[k]), c, c["rev"]) for k in range(len(s.nets))]
            q = (c["legal"] > 0) & (c["rv"] == 0) & (cnt > 1); mu = m1[q] / cnt[q]; se_pu[q] = np.sqrt(np.maximum(0, m2[q] / cnt[q] - mu ** 2) / (cnt[q] - 1))
        raw = lambda P, fixed: (lambda Q: (Q.__setitem__(list(fixed), 1.) or Q))(np.where(c["legal"] > 0, P, 0.))
        return dict(PuE=PuE, PtE=PtE, se_pu=se_pu, pu=np.mean(PuE, 0), pt=np.mean(PtE, 0),
                    pu_raw=np.mean([raw(P, c["rev"]) for P in PuRaw], 0), pt_raw=np.mean([raw(P, []) for P in PtRaw], 0))
    def rollout_ctx(s, c, pu, pt):
        H = s.H; b = s.bn; base = lambda rel: b["a"] + b["am"][c["m"]] + b["ab"][c["bd"]] - b["lam"] * rel + b["gam"] * (s.C @ rel)
        rU = np.zeros(H); rT = np.zeros(H)
        for h0 in range(H):
            if c["BU"][h0]: rU += b["Ro"][h0]; rT += b["Rt"][h0]
            if c["BT"][h0]: rT += b["Ro"][h0]; rU += b["Rt"][h0]
        return dict(c=c, baseU=base(pu), baseT=base(pt), respU=rU, respT=rT, G=s.noise(c))
    def noise(s, c):
        key = (c["seed"], s.NS)
        if s._nk != key:
            R = Rng(c["seed"]); s._G = np.array([gumbel(R) for _ in range(s.NS * 6 * s.H)], np.float32).astype(np.float64).reshape(s.NS, 6, s.H); s._nk = key
        return s._G
    def rollout(s, rc, prefix, fix=None):
        """(NS, 6 - e) heroes banned from position e on, for every rollout."""
        c = rc["c"]; H = s.H; b = s.bn; e = c["e"]; out = np.zeros((s.NS, 6 - e), np.int64); fix = fix or {}
        for sc in range(s.NS):
            rU, rT = rc["respU"].copy(), rc["respT"].copy(); done = (c["BU"] > 0) | (c["BT"] > 0)
            for ep in range(e, 6):
                us = c["ours"](ep)
                if ep - e < len(prefix): h = prefix[ep - e]
                elif ep in fix and not done[fix[ep]]: h = fix[ep]
                else:
                    v = (rc["baseU"] if us else rc["baseT"]) + b["ae"][ep] + (rU if us else rT) + rc["G"][sc, ep]
                    v = np.where(done | ((c["rv"] > 0) & us), -np.inf, v); h = int(np.argmax(v))
                done[h] = True; out[sc, ep - e] = h
                if us: rU += b["Ro"][h]; rT += b["Rt"][h]
                else: rT += b["Ro"][h]; rU += b["Rt"][h]
        return out
    def values(s, first_us, bans, rev, m, r0, cnt=1, short=None):
        c0 = s.ctx(first_us, bans, rev, m, r0); e0 = c0["e"]
        ts = e0 - 1 if 0 < e0 < 6 and c0["ours"](e0) and c0["ours"](e0 - 1) else e0
        pre = list(c0["bans"][ts:]); c = s.ctx(first_us, c0["bans"][:ts], c0["rev"], m, r0) if ts < e0 else c0
        H = s.H; L = s.lineups(c); cnt = min(cnt or 1, 6 - e0)
        out = dict(Pu=L["pu"].copy(), Pt=L["pt"].copy(), PuRaw=L["pu_raw"], PtRaw=L["pt_raw"], legal=c0["legal"], e=e0, cnt=cnt, turn_start=ts, pre=pre)
        for h in pre: out["Pu"][h] = 0.; out["Pt"][h] = 0.
        if e0 >= 6: return out
        bd, mm, NN, NS = c["bd"], c["m"], len(L["PuE"]), s.NS; rv = c["rv"] > 0; nrv = int(rv.sum())
        adjC = .25 * ((s.C[:, rv] - s.ALTC[:, rv]).sum(1) - nrv * s.MC); adjS = .25 * ((s.S[:, rv] - s.ALTS[:, rv]).sum(1) - nrv * s.MS)
        R0 = s.R[:, bd, mm]; Rsd = s.Rsd[:, bd, mm]
        w = np.array([L["PtE"][k] * (R0 + adjC) - L["PuE"][k] * (R0 + adjS) for k in range(NN)]); wm = w.mean(0)
        rc = s.rollout_ctx(c, L["pu"], L["pt"])
        def Wof(prefix):
            seq = s.rollout(rc, pre + list(prefix)); return w[:, seq].sum(2), seq          # (NN, NS)
        Wb, sb = Wof([]); PLb = np.zeros(H); np.add.at(PLb, sb.ravel(), 1. / NS)
        def compare(Wx, x=None):
            Vn = (Wx - Wb).mean(1); V = Vn.mean(); vm = ((Vn - V) ** 2).mean()
            d = (Wx - Wb).mean(0); mc = np.sqrt(max(0., (d ** 2).mean() - d.mean() ** 2) / max(1, NS - 1))
            rs = 0. if x is None else (1 - PLb[x]) * (L["pt"][x] - L["pu"][x]) * Rsd[x]
            so = 0. if x is None else (1 - PLb[x]) * (R0[x] + adjS[x]) * L["se_pu"][x]
            return V, np.sqrt(vm + rs ** 2), np.sqrt(mc ** 2 + so ** 2)
        V, seM, seS = (np.full(H, np.nan) for _ in range(3)); cand = (c0["legal"] > 0) & ~rv
        for x in np.nonzero(cand)[0]: V[x], seM[x], seS[x] = compare(Wof([int(x)])[0], int(x))
        direct = np.where(cand, (1 - PLb) * wm, np.nan)
        out.update(V=V, se=np.sqrt(seM ** 2 + seS ** 2), se_model=seM, se_mc=seS, direct=direct, other=V - direct, R=R0 + adjC, Rus=R0 + adjS, PL=PLb, w=wm, _rc=rc, _pre=pre)
        if cnt == 2:
            sl = [int(h) for h in np.argsort(-np.where(cand, V, -np.inf))[:short or s.SHORT]]; pairs = []
            for i in range(len(sl)):
                for j in range(i + 1, len(sl)):
                    v_, a_, b_ = compare(Wof([sl[i], sl[j]])[0]); pairs.append(dict(a=sl[i], b=sl[j], V=v_, se_model=a_, se_mc=b_, se=np.hypot(a_, b_)))
            out.update(pairs=sorted(pairs, key=lambda p: -p["V"]), shortlist=sl)
        return out
    def their_next_ban(s, first_us, bans, m, r0, pt=None):
        c = s.ctx(first_us, bans, [], m, r0); pt = s.lineups(c)["pt"] if pt is None else pt
        u = s.ban_util(c["e"], pt, c["BT"], c["BU"], c["m"], c["bd"]); u = np.where((c["BU"] + c["BT"]) > 0, -np.inf, u); u = u - u.max(); p = np.exp(u); return p / p.sum()
# <<< value engine v7
