"""Reference values for tools/check_v8.js: the ban model as the notebook computes it (a transcription of `ban_probs` in
notebooks/02_ban_solver_v8.py, section 6), with the fitted parameters from the run's models_v8.pkl (not the rounded
export), on random lobby states. The stand-in tables are the page's (model8/ban_v8.json), so this checks the formula and
the exported parameters, not the stand-in approximation.

    python tools/check_v8_ref.py [<run folder>]   ->  tools/reports/check_v8_ban.json
"""
import json, pickle, sys
import numpy as np

RUN = sys.argv[1] if len(sys.argv) > 1 else "../ban-solver/data/runs/20260926_2120"
MOD = pickle.load(open(f"{RUN}/models_v8.pkl", "rb")); BN = {k: np.asarray(v, np.float64) for k, v in MOD["ban"].items()}
B = json.load(open("model8/ban_v8.json", encoding="utf-8")); L = json.load(open("model8/value_v8.json", encoding="utf-8"))
H = len(L["heroes"]); ORDER = np.array(L["order"]); bands = np.array(L["bands"]); NM = len(L["maps"])
CMAT = np.asarray(B["counter"]); PRE = B["premade_share"]; T = np.asarray(B["stand_in_team_shares"]); SS = np.asarray(B["shown_shares"]); PS = np.asarray(B["player_shares"])
J = T.shape[1]; Z = lambda *s: np.zeros(s)
G = {"B_" + k: v for k, v in BN.items()}
for k, v in dict(lam_e=Z(6), gam_e=Z(6), Lo=Z(H, H), Lt=Z(H, H), acm=Z(NM, H), lam_p=0., gam_p=0., tau=0., tau_e=Z(6)).items(): G.setdefault("B_" + k, v)
G["CT"] = CMAT.T
NEG = -1e9

def softmax(u): u = u - u.max(-1, keepdims=True); e = np.exp(u); return e / e.sum(-1, keepdims=True)

def ban_probs(mo, bo, camp, RELu, RELo, ourB, thB, last, e, allowed):
    """notebooks/02_ban_solver_v8.py ban_probs, one state (no batch axis)."""
    us = ORDER[e] == camp; own, oth = (ourB, thB) if us else (thB, ourB)
    lastu = 0. if e == 0 else last @ (G["B_Lo"] if ORDER[e - 1] == ORDER[e] else G["B_Lt"])
    u = G["B_a"] + mo @ G["B_am"] + bo @ G["B_ab"] + G["B_ae"][e] + own @ G["B_Ro"] + oth @ G["B_Rt"] + lastu + (1. if ORDER[e] == 0 else -1.) * (mo @ G["B_acm"])
    cr = -(G["B_lam"] + G["B_lam_e"][e] + PRE * G["B_lam_p"]); cf = G["B_gam"] + G["B_gam_e"][e] + PRE * G["B_gam_p"]
    REL, RELX = (RELu, RELo) if us else (RELo, RELu)
    uj = u[None] + cr * REL + cf * (REL @ G["CT"]) + (G["B_tau"] + G["B_tau_e"][e]) * RELX
    return softmax(np.where(allowed[None], uj, NEG)).mean(0)

def rel_tables(bd, shown):
    us = T[bd].copy(); them = T[bd][(np.arange(J) + J // 2) % J].copy()
    for h in shown: us += SS[bd, h] - PS[bd]
    return us, them

rg = np.random.default_rng(7); tiers = [4050, 4250, 4450, 4550, 4650, 4850, 5050]; cases = []
for i in range(40):
    m = int(rg.integers(0, NM)); r0 = float(rg.choice(tiers)); first = bool(rg.integers(0, 2)); e = int(rg.integers(0, 6))
    heroes = rg.permutation(H); bans = [int(h) for h in heroes[:e]]; you = int(heroes[e]) if rg.random() < .75 else -1; mates = [int(h) for h in heroes[e + 1:e + 1 + rg.integers(0, 3)]]
    camp = 0 if first else 1; ours_ = lambda k: (ORDER[k] == 0) == first
    ourB, thB = np.zeros(H), np.zeros(H)
    for k, h in enumerate(bans): (ourB if ours_(k) else thB)[h] = 1
    last = np.zeros(H)
    if e: last[bans[-1]] = 1
    legal = (ourB + thB) < .5; shown = [h for h in [you] + mates if h >= 0]
    allowed = legal & ~np.isin(np.arange(H), shown) if ours_(e) else legal
    bd = int(np.searchsorted(bands, r0)); RELu, RELo = rel_tables(bd, shown)
    p = ban_probs(np.eye(NM)[m], np.eye(len(bands) + 1)[bd], camp, RELu, RELo, ourB, thB, last, e, allowed)
    cases.append(dict(m=m, r0=r0, firstUs=first, bans=bans, you=you, mates=mates, p=p.tolist()))
maxdiff = max(float(np.abs(np.asarray(B["params"][k], float) - np.asarray(MOD["ban"][k], float)).max()) for k in B["params"] if k in MOD["ban"])
json.dump(dict(cases=cases, export_rounding_max=maxdiff), open("tools/reports/check_v8_ban.json", "w"))
print(f"{len(cases)} ban-model states written; largest difference between exported and fitted parameters {maxdiff:.2e}")
