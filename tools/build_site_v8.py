"""Build the v8 site model (model8/) from a ban-solver v8 run folder.

    python tools/build_site_v8.py <run folder> [<colab_v8 data folder>]

Writes:
  model8/value_opt.bin, model8/value_aux.bin  the value networks as float16: the optimal members first (the page is usable
                                              once they arrive), then the behaviour and robust members. A student run
                                              (v8.2 on) has one network per position with all three outputs: value_opt.bin only
  model8/value_v8.json                        the input layout and the weight manifest (file, offset, shape)
  model8/ban_v8.json                          their ban model (the selected family), stand-in team tables per rank band, and
                                              per band and hero the share vector of a stand-in who shows that hero
  model8/substitutes_v8.json, parity_v8.json  copied from the run
  model8/sim_v8.json, sim_v8.bin              the simulator for the studio, when ban-solver export/build_sim_v8.py has written it
  model8/report_v8.json                       the numbers the method section quotes (selection, test window, world-model
                                              checks, real-outcome test)

From v8.3 the notebook exports the page's view of a lobby itself (stand-in teams per rank band, and per shown hero the
shift it makes to our team's hero shares), the same tables it used for our side's bans, support sets and typical-ban
baselines, so the page and the notebook agree exactly. For earlier runs the shift is rebuilt here from the data bundle:
the players at that rank band weighted by their share of minutes on the hero (as of the end of the validation window).
Without either, a shown hero adds nothing to the stand-in tables (the ban forecast then ignores who shows what).
"""
import json, os, shutil, sys
import numpy as np, pandas as pd

RUN = sys.argv[1] if len(sys.argv) > 1 else "../ban-solver/data/runs/20260926_2120"
DATA = sys.argv[2] if len(sys.argv) > 2 else "../ban-solver/data/colab_v8"
OUT = "model8"; os.makedirs(OUT, exist_ok=True)
L = json.load(open(f"{RUN}/site/value_v8.json", encoding="utf-8")); raw = open(f"{RUN}/site/value_v8.bin", "rb").read()
H = len(L["heroes"])

# ---- value networks, split into the optimal members and the rest
parts = {"opt": [], "aux": []}; off = {"opt": 0, "aux": 0}; man = []
for w in L["weights"]:
    n = int(np.prod(w["shape"])); b = raw[w["offset"]:w["offset"] + 2 * n]; f = "opt" if w["chain"] in ("optimal", "student") else "aux"
    parts[f].append(b); man.append(dict(w, file=f, offset=off[f])); off[f] += len(b)
parts = {f: v for f, v in parts.items() if v}
for f in ("opt", "aux"):
    if f in parts:
        with open(f"{OUT}/value_{f}.bin", "wb") as fh: fh.write(b"".join(parts[f]))
    elif os.path.exists(f"{OUT}/value_{f}.bin"): os.remove(f"{OUT}/value_{f}.bin")
lay = {k: v for k, v in L.items() if k != "weights"}; lay["weights"] = man; lay["files"] = {f: dict(path=f"value_{f}.bin", bytes=off[f]) for f in parts}
json.dump(lay, open(f"{OUT}/value_v8.json", "w", encoding="utf-8"), ensure_ascii=False)
print(f"value networks: " + ", ".join(f"{f} {off[f] / 1e6:.1f} MB" for f in parts))

# ---- their ban model, plus the shown-hero stand-in tables
B = json.load(open(f"{RUN}/site/ban_model_v8.json", encoding="utf-8"))
SUM = json.load(open(f"{RUN}/reports/summary_v8.json", encoding="utf-8"))
bands = np.array(B["bands"]); NB = len(bands) + 1
if B.get("shown_shares") is not None:
    shown = avg = None; print("shown-hero tables: from the run (the notebook's own page view)")
elif os.path.exists(f"{DATA}/segs.parquet"):
    M = pd.read_parquet(f"{DATA}/matches.parquet"); S = pd.read_parquet(f"{DATA}/slots.parquet", columns=["match_idx", "player_idx", "pre_score", "start_hero"])
    G = pd.read_parquet(f"{DATA}/segs.parquet", columns=["match_idx", "player_idx", "hero_idx", "minutes"])
    last_val = SUM["splits"]["validation"]["last_utc"]; ts_cut = pd.Timestamp(last_val, tz="UTC").timestamp() + 60
    cut = int(M.loc[M.ts <= ts_cut, "match_idx"].max())
    G = G[G.match_idx <= cut]; S = S[S.match_idx <= cut]
    mins = G.groupby(["player_idx", "hero_idx"]).minutes.sum().unstack(fill_value=0.).reindex(columns=range(H), fill_value=0.)
    starts = S[S.start_hero.notna()].groupby("player_idx").size()
    s10 = S[S.match_idx.isin(M.match_idx[M.season == 20])].sort_values("match_idx")
    rank = s10.groupby("player_idx").pre_score.last(); n10 = s10.groupby("player_idx").size()
    pool = mins.index[(starts.reindex(mins.index).fillna(0) >= 10).to_numpy() & (rank.reindex(mins.index).fillna(0) > 0).to_numpy()]
    SH = mins.loc[pool].to_numpy(); SH = SH / np.maximum(SH.sum(1, keepdims=True), 1e-9)
    bd = np.searchsorted(bands, rank.reindex(pool).to_numpy()); wpl = n10.reindex(pool).fillna(0).to_numpy() + 1.
    shown = np.zeros((NB, H, H)); avg = np.zeros((NB, H))
    for b_ in range(NB):
        k = bd == b_; sh, w = SH[k], wpl[k]; avg[b_] = (w[:, None] * sh).sum(0) / w.sum()
        wh = w[:, None] * sh                                                   # weight of each player for each shown hero
        shown[b_] = (wh.T @ sh) / np.maximum(wh.sum(0), 1e-12)[:, None]
    print(f"shown-hero tables from {len(pool):,} players (histories up to match {cut:,}, the end of validation)")
else:
    shown = None; avg = None; print("no data bundle: shown heroes will not shift the stand-in tables")
BAN = dict(B) if B.get("shown_shares") is not None else dict(B, shown_shares=None if shown is None else np.round(shown, 4).tolist(), player_shares=None if avg is None else np.round(avg, 4).tolist())
json.dump(BAN, open(f"{OUT}/ban_v8.json", "w", encoding="utf-8"), ensure_ascii=False, default=lambda x: np.asarray(x).tolist())
for f in ("substitutes_v8.json", "parity_v8.json"): shutil.copy(f"{RUN}/site/{f}", f"{OUT}/{f}")
# the simulator (the notebook's world model), when the run folder has it: ban-solver export/build_sim_v8.py writes it there
if os.path.exists(f"{RUN}/site/sim_v8.json"):
    for f in ("sim_v8.json", "sim_v8.bin"): shutil.copy(f"{RUN}/site/{f}", f"{OUT}/{f}")
    print("simulator: copied sim_v8.json and sim_v8.bin (check with node tools/check_sim_v8.js)")
else: print(f"simulator: {RUN}/site/sim_v8.json not found; run ban-solver export/build_sim_v8.py {RUN} first for the studio's simulator")

# ---- the numbers the page quotes
CHK = json.load(open(f"{RUN}/reports/world_model_checks_v8.json", encoding="utf-8")); OPE = json.load(open(f"{RUN}/reports/ope_v8.json", encoding="utf-8"))
TEST = json.load(open(f"{RUN}/reports/test_report_v8.json", encoding="utf-8")); SEL = json.load(open(f"{RUN}/reports/selection_v8.json", encoding="utf-8"))
REP = dict(run=L["run"], version=L["version"], splits=SUM["splits"], selected=SUM["selected"], comparisons=SEL["comparisons"], test=TEST["test"],
           world_model=SUM["world_model"], checks=dict(terminal=CHK["terminal"], brute_force=CHK["brute_force"], policy=CHK["policy"], drafts=CHK["drafts"],
           first_ban=CHK["first_ban"], first_ban_by_role=CHK.get("first_ban_by_role"), agreement_by_shown=CHK.get("agreement_by_shown"), students=CHK.get("students"),
           null_world=CHK.get("null_world"), world_model_uncertainty=CHK.get("world_model_uncertainty"), drafts_planner_path=CHK.get("drafts_planner_path")),
           test_consulted=SUM.get("test_consulted"), estimator_checks=OPE.get("estimator_checks"),
           value_chain=CHK["value_chain"], networks=dict(student=bool(L.get("student")), members=L["members"], hidden=L["hidden"], layers=L["layers"], teachers=L.get("teachers")),
           ope=dict(decisions=OPE["decisions"], behaviour_calibration={k: dict(slope=v["behaviour"]["calib_slope"], spread_pts=v["spread_pts"]) for k, v in OPE["behaviour_calibration"].items()},
                    ban_effect_slope=OPE.get("ban_effect_slope"), matches=OPE["matches"]),
           recalibration=SUM.get("recalibration"), draft_calibration={k: v for k, v in SUM.get("draft_calibration", {}).items() if k in ("lam_g", "delta")})
json.dump(REP, open(f"{OUT}/report_v8.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=lambda x: np.asarray(x).tolist())
print("wrote", ", ".join(sorted(os.listdir(OUT))))
