"""Complete decisions of the exported page policy, computed independently of the browser code, for tools/check_v8.js.

A transcription of the notebook's definition of the page's policy (the notebook's turn_case, section 10): the float16
students of model8/value_v8.json, the ban model and page-view tables of model8/ban_v8.json, and the rule "among bans a typical
team makes with probability >= support (all allowed bans when none is), the highest mean - kappa x SD". With the layout's
`plan` (the notebook's v8.6 second review): the score adds lam x log p, a supported ban must also have counts_ok at its
position and band, and with no supported ban the advice is the likeliest ban. Every state is
random: both camps, every own position, ordered ban histories, 0-6 shown heroes. On a two-ban turn the decision is the
sequence the page advises: the best ban, then the best ban at the state after it.

    python tools/check_decisions.py [<n states>]   ->  tools/reports/check_decisions.json
"""
import json, math, os, sys
import numpy as np

MD = os.environ.get("MODEL_DIR", "model8"); N_STATES = int(sys.argv[1]) if len(sys.argv) > 1 else 400
L = json.load(open(f"{MD}/value_v8.json", encoding="utf-8")); B = json.load(open(f"{MD}/ban_v8.json", encoding="utf-8"))
H, ORDER, BANDS, KAPPA, SUPP = len(L["heroes"]), np.array(L["order"]), np.array(L["bands"]), L["kappa"], L["support"]
PLAN = L.get("plan"); LAM = PLAN["lam"] if PLAN else 0.; CNT = np.asarray(PLAN["counts_ok"], bool) if PLAN else None
O = {b[0]: b[1] for b in L["blocks"]}; FD = L["input_dim"]; NM = len(L["maps"])
assert L.get("student"), "this check covers student exports (v8.2 on)"
buf = {f: np.frombuffer(open(f"{MD}/{v['path']}", "rb").read(), dtype="<f2") for f, v in L["files"].items()}
def net(pos):
    ws = {(w["layer"], w["name"]): w for w in L["weights"] if w["position"] == pos and w["chain"] == "student"}; out = []
    for l in range(len(ws) // 2):
        W, b = ws[(l, "W")], ws[(l, "b")]; get = lambda w: buf[w["file"]][w["offset"] // 2: w["offset"] // 2 + int(np.prod(w["shape"]))].astype(np.float64).reshape(w["shape"])
        out.append((get(W), get(b)))
    return out
NETS = {p: net(p) for p in range(7)}
gelu = lambda z: .5 * z * (1 + np.tanh(math.sqrt(2 / math.pi) * (z + .044715 * z ** 3)))
def fwd(p, x):
    for W, b in NETS[p][:-1]: x = gelu(x @ W + b)
    W, b = NETS[p][-1]; return x @ W + b
band = lambda r0: int((BANDS < r0).sum())
ours = lambda first, i: (ORDER[i] == 0) == first
def inp(s, e, zero_last=False):
    x = np.zeros(FD); x[O["map"] + s["m"]] = 1; x[O["band"] + band(s["r0"])] = 1; x[O["rank_z"]] = (s["r0"] - L["rank_mean"]) / L["rank_sd"]; x[O["we_ban_first"]] = 1. if s["firstUs"] else 0.
    for i in range(e): x[(O["our_bans"] if ours(s["firstUs"], i) else O["their_bans"]) + s["bans"][i]] = 1
    if e > 0 and not zero_last: x[O["last_ban"] + s["bans"][e - 1]] = 1
    if s["you"] >= 0: x[O["your_hero"] + s["you"]] = 1
    for h in s["mates"]: x[O["teammates_heroes"] + h] = 1
    if "ban_order" in O:
        for i in range(e): x[O["ban_order"] + i * H + s["bans"][i]] = 1
    return x
# the ban model as the page sees the lobby (the notebook's ban_probs with the exported tables)
P = {k: np.asarray(v, np.float64) for k, v in B["params"].items()}; C = np.asarray(B["counter"], np.float64); CT = C.T; PRE = B["premade_share"]
T = np.asarray(B["stand_in_team_shares"], np.float64); J = T.shape[1]
TP = np.asarray(B["stand_in_players"], np.float64) if B.get("stand_in_players") is not None else None
if TP is not None: SP = np.asarray(B["shown_profiles"], np.float64); TAIL = np.concatenate([np.flip(np.cumsum(np.flip(TP, 2), 2), 2), np.zeros(TP[:, :, :1].shape)], 2)
else: SS = np.asarray(B["shown_shares"], np.float64); PS = np.asarray(B["player_shares"], np.float64)
g = lambda k, d: P[k] if k in P else d
def rel_tables(bd, shown):
    them = T[bd][(np.arange(J) + J // 2) % J]; shown = sorted(set(shown))
    if TP is not None: return TAIL[bd][:, min(len(shown), 6)] + sum((SP[bd, h] for h in shown), np.zeros(H))[None], them
    us = T[bd].copy()
    for h in shown: us += SS[bd, h] - PS[bd]
    return us, them
def ban_probs(s, e, allowed):
    bd, m, us = band(s["r0"]), s["m"], ours(s["firstUs"], e); own, oth = np.zeros(H), np.zeros(H)
    for i in range(e): (own if ours(s["firstUs"], i) == us else oth)[s["bans"][i]] = 1
    u = P["a"] + P["am"][m] + P["ab"][bd] + P["ae"][e] + own @ P["Ro"] + oth @ P["Rt"] + (1. if ORDER[e] == 0 else -1.) * g("acm", np.zeros((NM, H)))[m]
    if e > 0 and "Lo" in P: u = u + (P["Lo"] if ORDER[e - 1] == ORDER[e] else P["Lt"])[s["bans"][e - 1]]
    lam = P["lam"] + g("lam_e", np.zeros(6))[e] + PRE * g("lam_p", 0.); gam = P["gam"] + g("gam_e", np.zeros(6))[e] + PRE * g("gam_p", 0.); tau = g("tau", 0.) + g("tau_e", np.zeros(6))[e]
    RU, RO = rel_tables(bd, [s["you"]] + s["mates"] if s["you"] >= 0 else s["mates"]); REL, RX = (RU, RO) if us else (RO, RU)
    uj = u[None] - lam * REL + gam * (REL @ CT) + tau * RX; uj = np.where(allowed[None], uj, -np.inf); uj -= uj.max(1, keepdims=True)
    p = np.exp(uj); return (p / p.sum(1, keepdims=True)).mean(0)
def decide(s):
    """The page's advice at the state after len(s['bans']) bans (our turn): the best ban and every allowed ban's mean and SD."""
    e = len(s["bans"]); shown = {h for h in [s["you"]] + s["mates"] if h >= 0}
    allowed = np.array([h not in s["bans"] and h not in shown for h in range(H)]); x0 = inp(s, e, zero_last=True)
    blk = O["our_bans"]; mu, sd = np.full(H, np.nan), np.full(H, np.nan)
    for h in np.where(allowed)[0]:
        x = x0.copy(); x[blk + h] = 1; x[O["last_ban"] + h] = 1
        if "ban_order" in O: x[O["ban_order"] + e * H + h] = 1
        o = fwd(e + 1, x); mu[h] = 1 / (1 + math.exp(-o[0])); sd[h] = math.log1p(math.exp(-abs(o[1]))) + max(o[1], 0.)
    pe = ban_probs(s, e, allowed); sup = allowed & (pe >= SUPP) & (CNT[e, band(s["r0"])] if CNT is not None else True)
    if not sup.any(): sup = allowed if PLAN is None else (np.arange(H) == int(np.where(allowed, pe, -np.inf).argmax()))
    sc = np.where(sup, mu - KAPPA * sd + LAM * np.log(np.maximum(pe, 1e-30)), -np.inf); best = int(sc.argmax()); runner = np.sort(sc[np.isfinite(sc)])[-2] if np.isfinite(sc).sum() > 1 else -np.inf
    return best, float(sc[best] - runner)
rg = np.random.default_rng(20260927); tiers = [4050, 4250, 4450, 4550, 4650, 4850, 5050]; cases = []
while len(cases) < N_STATES:
    first = bool(rg.integers(0, 2)); own = [e for e in range(6) if ours(first, e)]; e = int(rg.choice(own)); heroes = rg.permutation(H)
    k = int(rg.integers(0, 7)); shown = [int(h) for h in heroes[6:6 + k]]; s = dict(m=int(rg.integers(0, NM)), r0=float(rg.choice(tiers)), firstUs=first, bans=[int(h) for h in heroes[:e]],
                                                                              you=shown[0] if shown else -1, mates=shown[1:])
    best, margin = decide(s); case = dict(state=s, position=e, best=best, margin=margin)
    if e + 1 < 6 and ours(first, e + 1): s2 = dict(s, bans=s["bans"] + [best]); b2, m2 = decide(s2); case.update(second=b2, second_margin=m2)
    cases.append(case)
os.makedirs("tools/reports", exist_ok=True); json.dump(dict(run=L["run"], version=L["version"], cases=cases), open("tools/reports/check_decisions.json", "w"))
two = sum("second" in c for c in cases); camps = {c["state"]["firstUs"] for c in cases}
print(f"{len(cases)} decisions from the exported policy ({two} two-ban turns, both camps: {len(camps) == 2}, positions {sorted({c['position'] for c in cases})}, "
      f"shown heroes 0-6: {sorted({len([h for h in [c['state']['you']] + c['state']['mates'] if h >= 0]) for c in cases})}); run {L['run']}")
