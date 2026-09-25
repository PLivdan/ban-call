# >>> value engine v7 (canonical numpy implementation; the notebook embeds this block verbatim, engine.js mirrors it)
"""Ban value engine v7.1 in numpy: the reference for the site's engine.js and the notebook's Part B.

A ban's value is a rollout comparison against a typical ban with the same budget:
  value(x) = E[W(bans from now on | we ban x)] - E[W(bans from now on | we ban as a typical team)]
  W(set)   = sum over x in the set of  P_them(x) R_them(x | set) - P_us(x) R_us(x | set)
R(x | set) is the cost of losing x when the other heroes in the set are gone too: the single-hero removal cost plus, when
the model has them, pairwise joint-removal terms (the players who open x lose their fallback y as well, for example a
main and its backup). The rest of the ban phase is sampled one ban at a time from the ban model (legality, acting team
and response terms updated after every ban) with common random numbers across candidates, so no "banned later"
discount or reply bonus is added afterwards. Two-ban turns are scored as pairs; once the first is in, the second
completes the pair from the turn's start. Lineup probabilities are made coherent (six heroes) only when they describe one
availability state (after all six bans, or with six fixed heroes). The random numbers match engine.js bit for bit.

Information boundaries and the intervention on our own bans. The other team's lineup and bans use public information
only. Our own bans are treated as choices, not clues: our lineup is averaged over the ban histories a typical team in our
seat could have made, instead of conditioning on the bans we actually made. The histories are legal (never a hero the
other team banned at any point, never a hero we show) and are weighted by how likely the other team's actual bans are
under each of them, since their later bans responded to ours. What this rests on: (1) the fitted ban model describes a
typical team's choices given the public state and our shown heroes; (2) our actual bans carry information about our
players only through the lineup network's own-ban inputs, and the choice itself (for example, taken from this advisor)
says nothing further; (3) the result is the lineup of a typical team in our seat with our shown heroes and the other
team's observed bans, not of our particular players. Averaging observational predictions does not remove selection in
general: the network's other inputs (the other team's bans, which partly respond to ours) are still observational, and if
(1) or (2) fails, some selection remains."""
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
        s.DP = np.asarray(M["pair_removal"], float) if M.get("pair_removal") is not None else None      # (H, H, bands): R(x | y gone) - R(x)
        s.C, s.S = np.asarray(M["C"], float), np.asarray(M["S"], float); s.ALTC, s.ALTS = np.asarray(M["ALTC"], float), np.asarray(M["ALTS"], float)
        s.MC, s.MS = np.asarray(M["MC"], float), np.asarray(M["MS"], float)
        s.bn = {k: (np.asarray(v, float) if np.ndim(v) else float(v)) for k, v in M["ban"].items()}
        s.B2 = "Lo" in s.bn                                    # the richer ban model: last-ban responses, position-specific protection and fear
        if s.B2: s.lam_e, s.gam_e = np.asarray(s.bn["lam_e"], float), np.asarray(s.bn["gam_e"], float)
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
    def ban_util(s, ep, rel, own, oth, m, bd, last=None):
        """Ban utility for the team banning at position ep. rel: its lineup; own / oth: bans so far by it / by the other
        team (0/1 vectors); last: (hero, same_team) of the ban at position ep - 1, used by the richer ban model."""
        b = s.bn; u = b["a"] + b["am"][m] + b["ab"][bd] + b["ae"][ep] - b["lam"] * rel + b["gam"] * (s.C @ rel) + own @ b["Ro"] + oth @ b["Rt"]
        if s.B2:
            u = u - s.lam_e[ep] * rel + s.gam_e[ep] * (s.C @ rel)
            if last is not None: u = u + (b["Lo"] if last[1] else b["Lt"])[last[0]]
        return u
    def lineups(s, c):
        H = s.H
        xt = s.features([], c["ownT"], c["ownU"], c["m"], c["rf"], 1 - c["side_us"], c["e"])
        PtRaw = [s.net_prob(p, xt) for p in s.nets]; PtE = [s.fix_up(P.copy(), c, []) for P in PtRaw]
        xu = s.features(c["rev"], c["ownU"], c["ownT"], c["m"], c["rf"], c["side_us"], c["e"]); PuRaw = [s.net_prob(p, xu) for p in s.nets]
        se_pu = np.zeros(H); ess = float(s.NOWN)
        if not c["ownU"]: PuE = [s.fix_up(P.copy(), c, c["rev"]) for P in PuRaw]
        else:
            # our bans as interventions: legal typical histories in our seat, weighted by the other team's observed bans
            x0 = s.features(c["rev"], [], [], c["m"], c["rf"], c["side_us"], 0); prior = np.mean([s.net_prob(p, x0) for p in s.nets], 0); prior[c["rev"]] = 1
            x0t = s.features([], [], [], c["m"], c["rf"], 1 - c["side_us"], 0); prior_t = np.mean([s.net_prob(p, x0t) for p in s.nets], 0)
            R = Rng(c["seed_own"] ^ 0x9e3779b9); hist = []
            for _ in range(s.NOWN):
                own = np.zeros(H, np.uint8); oth = np.zeros(H, np.uint8); done = np.zeros(H, bool); mine = []; lw = 0.; last = None   # last: (hero, banned by us)
                for i in range(c["e"]):
                    h0 = c["bans"][i]
                    if not c["ours"](i):                        # their actual ban: how likely it is after this history
                        u = s.ban_util(i, prior_t, oth, own, c["m"], c["bd"], None if last is None else (last[0], not last[1])); u = np.where(done, -np.inf, u)
                        lw += u[h0] - (u.max() + np.log(np.exp(u - u.max()).sum())); oth[h0] = 1; done[h0] = True; last = (h0, False); continue
                    u = s.ban_util(i, prior, own, oth, c["m"], c["bd"], last); best, bv = -1, -np.inf
                    for h in range(H):
                        if done[h] or c["BT"][h] or c["rv"][h]: continue          # never a hero they ban at any point, never one we show
                        v = u[h] + gumbel(R)
                        if v > bv: bv, best = v, h
                    own[best] = 1; done[best] = True; mine.append(best); last = (best, True)
                hist.append((mine, own.copy(), lw))
            lws = np.array([h_[2] for h_ in hist]); wts = np.exp(lws - lws.max()); ess = float(wts.sum() ** 2 / (wts ** 2).sum())
            sm_ = [np.zeros(H) for _ in s.nets]; den = np.zeros(H); m1 = np.zeros(H); m2 = np.zeros(H); w2 = np.zeros(H)
            for (mine, own, _), wt in zip(hist, wts):
                xs = s.features(c["rev"], mine, c["ownT"], c["m"], c["rf"], c["side_us"], c["e"]); ok = own == 0; pm = np.zeros(H)
                for k, p in enumerate(s.nets): P = s.net_prob(p, xs); sm_[k][ok] += wt * P[ok]; pm[ok] += P[ok] / len(s.nets)
                den[ok] += wt; m1[ok] += wt * pm[ok]; m2[ok] += wt * pm[ok] ** 2; w2[ok] += wt * wt
            PuE = [s.fix_up(np.where(den > 0, sm_[k] / np.maximum(den, 1e-300), PuRaw[k]), c, c["rev"]) for k in range(len(s.nets))]
            q = (c["legal"] > 0) & (c["rv"] == 0) & (den > 0); mu = m1[q] / den[q]; var = np.maximum(0, m2[q] / den[q] - mu ** 2)
            se_pu[q] = np.sqrt(var * w2[q] / den[q] ** 2)                    # weighted mean's error (Kish)
        raw = lambda P, fixed: (lambda Q: (Q.__setitem__(list(fixed), 1.) or Q))(np.where(c["legal"] > 0, P, 0.))
        return dict(PuE=PuE, PtE=PtE, se_pu=se_pu, ess=ess, pu=np.mean(PuE, 0), pt=np.mean(PtE, 0),
                    pu_raw=np.mean([raw(P, c["rev"]) for P in PuRaw], 0), pt_raw=np.mean([raw(P, []) for P in PtRaw], 0))
    def rollout_ctx(s, c, pu, pt):
        H = s.H; b = s.bn; base = lambda rel: b["a"] + b["am"][c["m"]] + b["ab"][c["bd"]] - b["lam"] * rel + b["gam"] * (s.C @ rel)
        rU = np.zeros(H); rT = np.zeros(H)
        for h0 in range(H):
            if c["BU"][h0]: rU += b["Ro"][h0]; rT += b["Rt"][h0]
            if c["BT"][h0]: rT += b["Ro"][h0]; rU += b["Rt"][h0]
        last = (c["bans"][-1], c["ours"](c["e"] - 1)) if c["e"] > 0 else None                   # (hero, banned by us)
        return dict(c=c, baseU=base(pu), baseT=base(pt), respU=rU, respT=rT, G=s.noise(c), relU=pu, relT=pt, fearU=s.C @ pu, fearT=s.C @ pt, last=last)
    def noise(s, c):
        key = (c["seed"], s.NS)
        if s._nk != key:
            R = Rng(c["seed"]); s._G = np.array([gumbel(R) for _ in range(s.NS * 6 * s.H)], np.float32).astype(np.float64).reshape(s.NS, 6, s.H); s._nk = key
        return s._G
    def rollout(s, rc, prefix, fix=None):
        """(NS, 6 - e) heroes banned from position e on, for every rollout."""
        c = rc["c"]; H = s.H; b = s.bn; e = c["e"]; out = np.zeros((s.NS, 6 - e), np.int64); fix = fix or {}
        for sc in range(s.NS):
            rU, rT = rc["respU"].copy(), rc["respT"].copy(); done = (c["BU"] > 0) | (c["BT"] > 0); last = rc["last"]
            for ep in range(e, 6):
                us = c["ours"](ep)
                if ep - e < len(prefix): h = prefix[ep - e]
                elif ep in fix and not done[fix[ep]]: h = fix[ep]
                else:
                    v = (rc["baseU"] if us else rc["baseT"]) + b["ae"][ep] + (rU if us else rT) + rc["G"][sc, ep]
                    if s.B2:
                        v = v - s.lam_e[ep] * (rc["relU"] if us else rc["relT"]) + s.gam_e[ep] * (rc["fearU"] if us else rc["fearT"])
                        if last is not None: v = v + (b["Lo"] if last[1] == us else b["Lt"])[last[0]]
                    v = np.where(done | ((c["rv"] > 0) & us), -np.inf, v); h = int(np.argmax(v))
                done[h] = True; out[sc, ep - e] = h; last = (h, us)
                if us: rU += b["Ro"][h]; rT += b["Rt"][h]
                else: rT += b["Ro"][h]; rU += b["Rt"][h]
        return out
    def values(s, first_us, bans, rev, m, r0, cnt=1, short=None):
        c0 = s.ctx(first_us, bans, rev, m, r0); e0 = c0["e"]
        ts = e0 - 1 if 0 < e0 < 6 and c0["ours"](e0) and c0["ours"](e0 - 1) else e0
        pre = list(c0["bans"][ts:]); c = s.ctx(first_us, c0["bans"][:ts], c0["rev"], m, r0) if ts < e0 else c0
        H = s.H; L = s.lineups(c); cnt = min(cnt or 1, 6 - e0)
        out = dict(Pu=L["pu"].copy(), Pt=L["pt"].copy(), PuRaw=L["pu_raw"], PtRaw=L["pt_raw"], legal=c0["legal"], e=e0, cnt=cnt, turn_start=ts, pre=pre, ess=L["ess"])
        for h in pre: out["Pu"][h] = 0.; out["Pt"][h] = 0.
        if e0 >= 6: return out
        bd, mm, NN, NS = c["bd"], c["m"], len(L["PuE"]), s.NS; rv = c["rv"] > 0; nrv = int(rv.sum())
        adjC = .25 * ((s.C[:, rv] - s.ALTC[:, rv]).sum(1) - nrv * s.MC); adjS = .25 * ((s.S[:, rv] - s.ALTS[:, rv]).sum(1) - nrv * s.MS)
        R0 = s.R[:, bd, mm]; Rsd = s.Rsd[:, bd, mm]
        w = np.array([L["PtE"][k] * (R0 + adjC) - L["PuE"][k] * (R0 + adjS) for k in range(NN)]); wm = w.mean(0)
        dpt = np.array([L["PtE"][k] - L["PuE"][k] for k in range(NN)])                 # multiplies the joint-removal terms (same for both teams)
        D2 = s.DP[:, :, bd] if s.DP is not None else None; S0 = list(c["bans"])       # bans made before this turn also remove fallbacks
        rc = s.rollout_ctx(c, L["pu"], L["pt"])
        def Wof(prefix):
            seq = s.rollout(rc, pre + list(prefix)); Wn = w[:, seq].sum(2)             # (NN, NS)
            if D2 is not None:
                ex = D2[seq[:, :, None], seq[:, None, :]].sum(2)                          # (NS, L): sum over the other new bans (diagonal is 0)
                if S0: ex = ex + D2[seq][:, :, S0].sum(2)
                Wn = Wn + (dpt[:, seq] * ex[None]).sum(2)
            return Wn, seq
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
        last = (c["bans"][-1], not c["ours"](c["e"] - 1)) if c["e"] > 0 else None            # same_team from their point of view
        u = s.ban_util(c["e"], pt, c["BT"], c["BU"], c["m"], c["bd"], last); u = np.where((c["BU"] + c["BT"]) > 0, -np.inf, u); u = u - u.max(); p = np.exp(u); return p / p.sum()
# <<< value engine v7
