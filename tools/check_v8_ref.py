"""Reference values for tools/check_v8.js: the ban model as the notebook computes it (a transcription of `ban_probs` in
notebooks/02_ban_solver_v8.py, section 6), with the fitted parameters from the run's models_v8.pkl (not the rounded
export), on random lobby states. The stand-in tables are the page's (model8/ban_v8.json), so this checks the formula and
the exported parameters, not the stand-in approximation.

    python tools/check_v8_ref.py [<run folder>]   ->  tools/reports/check_v8_ban.json
"""
import json, os, pickle, sys
import numpy as np

RUN = sys.argv[1] if len(sys.argv) > 1 else "../ban-solver/data/runs/20260926_2120"
MOD = pickle.load(open(f"{RUN}/models_v8.pkl", "rb")); BN = {k: np.asarray(v, np.float64) for k, v in MOD["ban"].items()}
MD = os.environ.get("MODEL_DIR", "model8")                              # a staged bundle (tools/build_site_v8.py)
B = json.load(open(f"{MD}/ban_v8.json", encoding="utf-8")); L = json.load(open(f"{MD}/value_v8.json", encoding="utf-8"))
H = len(L["heroes"]); ORDER = np.array(L["order"]); bands = np.array(L["bands"]); NM = len(L["maps"])
CMAT = np.asarray(B["counter"]); PRE = B["premade_share"]; T = np.asarray(B["stand_in_team_shares"])
TP = np.asarray(B["stand_in_players"]) if B.get("stand_in_players") is not None else None    # v8.4: six profiles per stand-in team
if TP is None: SS = np.asarray(B["shown_shares"]); PS = np.asarray(B["player_shares"])
else: SP = np.asarray(B["shown_profiles"]); TAIL = np.concatenate([np.flip(np.cumsum(np.flip(TP, 2), 2), 2), np.zeros(TP[:, :, :1].shape)], 2)
# v8.7 (V8TB): the ban model's concentration term reads the banning team's summed squared hero shares; the page builds them from
# the stand-in players' squared shares and, per shown hero, shown_profiles_sq (the notebook's VSS2)
if TP is not None:
    TP2 = TP ** 2; TAIL2 = np.concatenate([np.flip(np.cumsum(np.flip(TP2, 2), 2), 2), np.zeros(TP[:, :, :1].shape)], 2)
    SP2 = np.asarray(B["shown_profiles_sq"]) if B.get("shown_profiles_sq") is not None else np.zeros_like(SP)
J = T.shape[1]; Z = lambda *s: np.zeros(s)
G = {"B_" + k: v for k, v in BN.items()}
NB = len(bands) + 1
for k, v in dict(lam_e=Z(6), gam_e=Z(6), Lo=Z(H, H), Lt=Z(H, H), acm=Z(NM, H), lam_p=0., gam_p=0., tau=0., tau_e=Z(6), lam_b=Z(NB), tau_b=Z(NB), lam_m=0.).items(): G.setdefault("B_" + k, v)
G["CT"] = CMAT.T
NEG = -1e9

def softmax(u): u = u - u.max(-1, keepdims=True); e = np.exp(u); return e / e.sum(-1, keepdims=True)

def ban_probs(mo, bo, camp, RELu, RELo, ourB, thB, last, e, allowed, RELu2=None, RELo2=None):
    """notebooks/02_ban_solver_v8.py ban_probs, one state (no batch axis). v8.7: RELu2 / RELo2 the teams' squared-share sums."""
    us = ORDER[e] == camp; own, oth = (ourB, thB) if us else (thB, ourB)
    lastu = 0. if e == 0 else last @ (G["B_Lo"] if ORDER[e - 1] == ORDER[e] else G["B_Lt"])
    u = G["B_a"] + mo @ G["B_am"] + bo @ G["B_ab"] + G["B_ae"][e] + own @ G["B_Ro"] + oth @ G["B_Rt"] + lastu + (1. if ORDER[e] == 0 else -1.) * (mo @ G["B_acm"])
    cr = -(G["B_lam"] + G["B_lam_e"][e] + PRE * G["B_lam_p"]); cf = G["B_gam"] + G["B_gam_e"][e] + PRE * G["B_gam_p"]
    REL, RELX = (RELu, RELo) if us else (RELo, RELu); REL2 = (RELu2 if us else RELo2) if RELu2 is not None else 0.
    lb, tb = float(bo @ G["B_lam_b"]), float(bo @ G["B_tau_b"])                # v8.7 (V8TB): protection and targeting by rank band
    uj = u[None] + (cr - lb) * REL - G["B_lam_m"] * REL2 + cf * (REL @ G["CT"]) + (G["B_tau"] + G["B_tau_e"][e] + tb) * RELX
    return softmax(np.where(allowed[None], uj, NEG)).mean(0)

def rel_tables(bd, shown):
    them = T[bd][(np.arange(J) + J // 2) % J].copy(); shown = sorted(set(shown))
    if TP is not None:                                                         # notebook vis_rel (v8.4; v8.7 with the squared channels)
        rot = (np.arange(J) + J // 2) % J; k = min(len(shown), 6)
        us = TAIL[bd][:, k] + sum((SP[bd, h] for h in shown), np.zeros(H))[None]; us2 = TAIL2[bd][:, k] + sum((SP2[bd, h] for h in shown), np.zeros(H))[None]
        return us, them, us2, TP2[bd].sum(1)[rot]
    us = T[bd].copy()
    for h in shown: us += SS[bd, h] - PS[bd]
    return us, them, None, None

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
    bd = int(np.searchsorted(bands, r0)); RELu, RELo, RELu2, RELo2 = rel_tables(bd, shown)
    p = ban_probs(np.eye(NM)[m], np.eye(len(bands) + 1)[bd], camp, RELu, RELo, ourB, thB, last, e, allowed, RELu2, RELo2)
    cases.append(dict(m=m, r0=r0, firstUs=first, bans=bans, you=you, mates=mates, p=p.tolist()))
maxdiff = max(float(np.abs(np.asarray(B["params"][k], float) - np.asarray(MOD["ban"][k], float)).max()) for k in B["params"] if k in MOD["ban"])
json.dump(dict(cases=cases, export_rounding_max=maxdiff), open("tools/reports/check_v8_ban.json", "w"))
print(f"{len(cases)} ban-model states written; largest difference between exported and fitted parameters {maxdiff:.2e}")
