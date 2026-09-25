"""Reference (numpy) implementation of the ban value model, read from the notebook's exported JSON.
Mirrors notebook Part B `ban_values` so the browser port (app.js) can be checked against it."""
import json, numpy as np

class Model:
    def __init__(s, path):
        M = json.load(open(path)); s.M = M
        s.H = len(M["heroes"]); s.NM = len(M["maps"]); s.NB = len(M["bands"]) + 1
        s.ROLE = np.array(M["roles"]); s.ORDER = np.array(M["ban_order"]); s.BANDS = np.array(M["bands"])
        s.mlm = [{k: np.array(v, np.float64) for k, v in p.items()} for p in M["lineup_models"]]
        s.R = np.array(M["removal_cost"]); s.Rsd = np.array(M["removal_cost_boot_sd"])
        s.C, s.S = np.array(M["C"]), np.array(M["S"]); s.ALTC, s.ALTS = np.array(M["ALTC"]), np.array(M["ALTS"])
        s.MC, s.MS = np.array(M["MC"]), np.array(M["MS"]); s.bn = {k: np.array(v) for k, v in M["ban"].items()}
    def band(s, r0): return int(np.searchsorted(s.BANDS, r0))
    def feat(s, rev, own, opp, m, bd, side, stage):
        H = s.H; x = np.zeros(3 * H + s.NM + s.NB + 1 + 7 + 3)
        x[list(rev)] = 1; x[[H + h for h in own]] = 1; x[[2 * H + h for h in opp]] = 1
        o = 3 * H; x[o + m] = 1; o += s.NM; x[o + bd] = 1; o += s.NB; x[o] = side; o += 1; x[o + stage] = 1; o += 7
        for q in range(3): x[o + q] = sum(s.ROLE[h] == q for h in rev)
        return x
    @staticmethod
    def gelu(z): return .5 * z * (1 + np.tanh(np.sqrt(2 / np.pi) * (z + .044715 * z ** 3)))
    def probs(s, x, rev, banned):
        out = []
        for p in s.mlm:
            h = s.gelu(x @ p["W1"] + p["b1"]); h = s.gelu(h @ p["W2"] + p["b2"]); z = h @ p["W3"] + p["b3"] + x @ p["Wl"]
            P = 1 / (1 + np.exp(-z)); P[list(banned)] = 0; P[list(rev)] = 1; out.append(P)
        return np.array(out)
    def later(s, first_us, e_next, BU, BT, Pu, Pt, m, bd, prot):
        bn = s.bn; surv = np.ones(s.H); done = (BU + BT) > 0
        for ep in range(e_next, 6):
            ours = (s.ORDER[ep] == 0) == first_us
            rel, own, oth = (Pu, BU, BT) if ours else (Pt, BT, BU)
            u = bn["a"] + bn["am"][m] + bn["ab"][bd] + bn["ae"][ep] - bn["lam"] * rel + bn["gam"] * (s.C @ rel) + own @ bn["Ro"] + oth @ bn["Rt"]
            u = np.where(done, -1e9, u)
            if ours: u = np.where(prot, -1e9, u)
            u = u - u.max(); p = np.exp(u); p /= p.sum(); surv *= 1 - p
        return 1 - surv
    def values(s, first_us, bans, rev, m, r0, cnt=1, reply=True):
        H = s.H; e = len(bans); bd = s.band(r0); side_us = 0 if first_us else 1
        BU = np.zeros(H); BT = np.zeros(H)
        for i, h in enumerate(bans): (BU if (s.ORDER[i] == 0) == first_us else BT)[h] = 1
        rv = np.zeros(H, bool); rv[list(rev)] = True
        own_u = [h for h in range(H) if BU[h]]; own_t = [h for h in range(H) if BT[h]]
        banned = own_u + own_t
        Pu = s.probs(s.feat(rev, own_u, own_t, m, bd, side_us, e), rev, banned)
        Pt = s.probs(s.feat([], own_t, own_u, m, bd, 1 - side_us, e), [], banned)
        adjC = .25 * ((s.C[:, rv] - s.ALTC[:, rv]).sum(1) - rv.sum() * s.MC); adjS = .25 * ((s.S[:, rv] - s.ALTS[:, rv]).sum(1) - rv.sum() * s.MS)
        R0 = s.R[:, bd, m]; pu, pt = Pu.mean(0), Pt.mean(0)
        legal = (BU + BT == 0) & ~rv; rep = np.zeros(H)
        PL0 = s.later(first_us, e + cnt, BU, BT, pu, pt, m, bd, rv)
        if reply:
            vy = pt * (R0 + adjC) - pu * (R0 + adjS)
            for x in np.nonzero(legal)[0]:
                BUx = BU.copy(); BUx[x] = 1; d = s.later(first_us, e + cnt, BUx, BT, pu, pt, m, bd, rv) - PL0; d[x] = 0; rep[x] = d @ vy
        Vm = np.array([(1 - s.later(first_us, e + cnt, BU, BT, Pu[i], Pt[i], m, bd, rv)) * (Pt[i] * (R0 + adjC) - Pu[i] * (R0 + adjS)) for i in range(len(Pu))])
        V = Vm.mean(0) + rep
        se = np.sqrt(Vm.var(0) + ((1 - PL0) * (pt - pu) * s.Rsd[:, bd, m]) ** 2)
        return dict(V=np.where(legal, V, np.nan), se=np.where(legal, se, np.nan), Pu=pu, Pt=pt, R=R0 + adjC, PL=PL0, reply=rep, legal=legal)
