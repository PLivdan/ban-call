"""The own-ban averaging must only use legal histories: a sampled friendly ban can never be a hero the other team bans at
any point of the observed history (or one we show), and the importance weights must stay usable. Replays the engine's
sampler with the same random numbers on random lobbies of the served model.
Usage: python tools/check_histories.py [lobbies=12] [histories=64]"""
import json, os, sys, numpy as np
sys.path.insert(0, os.path.dirname(__file__)); import engine_ref as er
meta = json.load(open("model/meta.json")); raw = np.fromfile("model/weights.bin", np.float16).astype(np.float64); M = dict(meta); M["removal_cost_boot_sd"] = meta["removal_cost_sd"]
M["lineup_models"] = [{k: raw[v["offset"]:v["offset"] + int(np.prod(v["shape"]))].reshape(v["shape"]) for k, v in e.items()} for e in meta["weights"]["models"]]
NL, NH = int(sys.argv[1]) if len(sys.argv) > 1 else 12, int(sys.argv[2]) if len(sys.argv) > 2 else 64
m = er.Model(M, NOWN=NH); H = m.H; rng = np.random.default_rng(0); bad = tot = 0; ess = []
for t in range(NL):
    fu = bool(rng.integers(2)); e = int(rng.choice([k for k in range(1, 6) if (m.ORDER[k] == 0) == fu])); bans = [int(x) for x in rng.choice(H, e, replace=False)]
    c = m.ctx(fu, bans, [int(x) for x in rng.choice([h for h in range(H) if h not in bans], int(rng.integers(0, 3)), replace=False)], int(rng.integers(m.NM)), 4550.)
    if not c["ownU"]: continue
    ess.append(m.lineups(c)["ess"]); R = er.Rng(c["seed_own"] ^ 0x9e3779b9)
    x0 = m.features(c["rev"], [], [], c["m"], c["rf"], c["side_us"], 0); prior = np.mean([m.net_prob(p, x0) for p in m.nets], 0); prior[c["rev"]] = 1
    for s in range(NH):                                   # the same draws, in the same order, as Model.lineups
        own = np.zeros(H, np.uint8); oth = np.zeros(H, np.uint8); done = np.zeros(H, bool); mine = []; last = None
        for i in range(c["e"]):
            h0 = c["bans"][i]
            if not c["ours"](i): oth[h0] = 1; done[h0] = True; last = (h0, False); continue
            u = m.ban_util(i, prior, own, oth, c["m"], c["bd"], last); best, bv = -1, -np.inf
            for h in range(H):
                if done[h] or c["BT"][h] or c["rv"][h]: continue
                v = u[h] + er.gumbel(R)
                if v > bv: bv, best = v, h
            own[best] = 1; done[best] = True; mine.append(best); last = (best, True)
        tot += 1; bad += any(h in c["ownT"] or h in c["rev"] for h in mine) or len(set(mine)) < len(mine)
print(f"impossible own-ban histories: {bad}/{tot}; effective sample size of {NH} weighted histories: median {np.median(ess):.1f}, min {min(ess):.1f} ({len(ess)} lobbies)")
sys.exit(1 if bad else 0)
