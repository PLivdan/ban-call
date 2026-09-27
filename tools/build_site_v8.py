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

From v8.4 the stand-in teams come as six players' hero shares each (stand_in_players) with, per shown hero, the profile of
a player who shows it (shown_profiles): our team takes the shown heroes' profiles in its first slots and its own players
after them, so every share stays nonnegative and the team's shares sum to six. The value networks also see the order of the
bans (the ban_order block). A v8.4 run that failed the null-world gate (deploy_ok false in the summary) is refused unless
FORCE_DEPLOY=1.

A release is all or nothing. Everything is read and checked before anything is written: the gate (from v8.4 the summary must
carry deploy_ok), the files, versions and run identities, the hero and map order across the value networks, the ban model and
the simulator, and that every tensor and array lies inside its binary. The bundle is then built in model8.staging, checked
there (tools/check_v8_ref.py, check_decisions.py, check_v8.js and check_sim_v8.js with MODEL_DIR; SKIP_CHECKS=1 skips them), and only then
swapped in for model8 in one step. A rejected or failed import leaves model8 as it was. The simulator is part of a release: a
run without sim_v8.json is refused (ALLOW_NO_SIM=1 publishes without one and removes the old simulator, so no page mixes
runs). The manifest records each binary's size and SHA-256 and the ban model and simulator carry the run, so the page can
refuse a file that does not belong to the release.
"""
import hashlib, json, os, shutil, subprocess, sys
import numpy as np, pandas as pd

RUN = sys.argv[1] if len(sys.argv) > 1 else "../ban-solver/data/runs/20260926_2120"
DATA = sys.argv[2] if len(sys.argv) > 2 else "../ban-solver/data/colab_v8"
LIVE, OUT = "model8", "model8.staging"
def refuse(msg): sys.exit(f"refused, model8 unchanged: {msg}")
# ---- read and check everything before writing anything
need = [f"{RUN}/site/{f}" for f in ("value_v8.json", "value_v8.bin", "ban_model_v8.json", "substitutes_v8.json", "parity_v8.json")] + \
       [f"{RUN}/reports/{f}" for f in ("summary_v8.json", "world_model_checks_v8.json", "ope_v8.json", "test_report_v8.json", "selection_v8.json")]
missing = [f for f in need if not os.path.exists(f)]
if missing: refuse(f"missing {missing}")
L = json.load(open(f"{RUN}/site/value_v8.json", encoding="utf-8")); raw = open(f"{RUN}/site/value_v8.bin", "rb").read()
B = json.load(open(f"{RUN}/site/ban_model_v8.json", encoding="utf-8")); SUM = json.load(open(f"{RUN}/reports/summary_v8.json", encoding="utf-8"))
H = len(L["heroes"]); vnum = tuple(int(x) for x in str(L.get("version", "v0")).lstrip("v").split(".")[:2] + ["0"])[:2]
if SUM.get("version") != L.get("version") or SUM.get("run") != L.get("run"): refuse(f"the summary is {SUM.get('version')} run {SUM.get('run')}, the networks {L.get('version')} run {L.get('run')}")
if vnum >= (8, 4) and "deploy_ok" not in SUM: refuse("a v8.4+ summary without deploy_ok (the null-world gate)")
if SUM.get("deploy_ok") is False and os.environ.get("FORCE_DEPLOY") != "1":   # v8.4 runs: the null-world gate
    refuse("this run failed the null-world gate (summary_v8.json deploy_ok is false); FORCE_DEPLOY=1 overrides")
if B.get("heroes") is not None and B["heroes"] != L["heroes"]: refuse("the ban model's hero order differs from the networks'")
if B.get("maps") is not None and [m["label"] if isinstance(m, dict) else m for m in L["maps"]] != list(B["maps"]): refuse("the ban model's map order differs from the networks'")
for w in L["weights"]:
    if w["offset"] + 2 * int(np.prod(w["shape"])) > len(raw): refuse(f"tensor {w['position']}/{w['chain']}/{w['layer']}/{w['name']} lies outside value_v8.bin")
HAS_SIM = os.path.exists(f"{RUN}/site/sim_v8.json") and os.path.exists(f"{RUN}/site/sim_v8.bin")
if HAS_SIM:
    SM = json.load(open(f"{RUN}/site/sim_v8.json", encoding="utf-8")); sbin = open(f"{RUN}/site/sim_v8.bin", "rb").read()
    if SM.get("run") != L.get("run") or SM.get("version") != L.get("version"): refuse(f"the simulator is {SM.get('version')} run {SM.get('run')}, the networks {L.get('version')} run {L.get('run')}")
    if SM["heroes"] != L["heroes"]: refuse("the simulator's hero order differs from the networks'")
    for a_ in SM["arrays"]:
        if a_["offset"] + int(np.prod(a_["shape"])) * np.dtype(a_["dtype"]).itemsize > len(sbin): refuse(f"simulator array {a_['name']} lies outside sim_v8.bin")
elif os.environ.get("ALLOW_NO_SIM") != "1":
    refuse(f"{RUN}/site/sim_v8.json not found: run ban-solver export/build_sim_v8.py {RUN} first (ALLOW_NO_SIM=1 publishes without a simulator)")
sha = lambda b_: hashlib.sha256(b_).hexdigest()
if os.path.exists(OUT): shutil.rmtree(OUT)
os.makedirs(OUT)

# ---- value networks, split into the optimal members and the rest
parts = {"opt": [], "aux": []}; off = {"opt": 0, "aux": 0}; man = []
for w in L["weights"]:
    n = int(np.prod(w["shape"])); b = raw[w["offset"]:w["offset"] + 2 * n]; f = "opt" if w["chain"] in ("optimal", "student") else "aux"
    parts[f].append(b); man.append(dict(w, file=f, offset=off[f])); off[f] += len(b)
parts = {f: v for f, v in parts.items() if v}
for f in parts:
    with open(f"{OUT}/value_{f}.bin", "wb") as fh: fh.write(b"".join(parts[f]))
lay = {k: v for k, v in L.items() if k != "weights"}; lay["weights"] = man; lay["files"] = {f: dict(path=f"value_{f}.bin", bytes=off[f], sha256=sha(b"".join(parts[f]))) for f in parts}
json.dump(lay, open(f"{OUT}/value_v8.json", "w", encoding="utf-8"), ensure_ascii=False)
print(f"value networks: " + ", ".join(f"{f} {off[f] / 1e6:.1f} MB" for f in parts))

# ---- their ban model, plus the shown-hero stand-in tables
bands = np.array(B["bands"]); NB = len(bands) + 1
FROM_RUN = B.get("shown_profiles") is not None or B.get("shown_shares") is not None   # v8.4: players' profiles; v8.3: shifts by an average player
if FROM_RUN:
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
BAN = dict(B, run=L["run"], version=L["version"]) if FROM_RUN else dict(B, run=L["run"], version=L["version"], shown_shares=None if shown is None else np.round(shown, 4).tolist(), player_shares=None if avg is None else np.round(avg, 4).tolist())
json.dump(BAN, open(f"{OUT}/ban_v8.json", "w", encoding="utf-8"), ensure_ascii=False, default=lambda x: np.asarray(x).tolist())
for f in ("substitutes_v8.json", "parity_v8.json"): shutil.copy(f"{RUN}/site/{f}", f"{OUT}/{f}")
# the simulator (the notebook's world model), when the run folder has it: ban-solver export/build_sim_v8.py writes it there
if HAS_SIM:
    shutil.copy(f"{RUN}/site/sim_v8.bin", f"{OUT}/sim_v8.bin"); json.dump(dict(SM, bin_bytes=len(sbin), bin_sha256=sha(sbin)), open(f"{OUT}/sim_v8.json", "w", encoding="utf-8"))
    print("simulator: copied sim_v8.json and sim_v8.bin")
else: print("simulator: none in this release (ALLOW_NO_SIM=1); the pages show the simulator as unavailable")

# ---- the numbers the page quotes
CHK = json.load(open(f"{RUN}/reports/world_model_checks_v8.json", encoding="utf-8")); OPE = json.load(open(f"{RUN}/reports/ope_v8.json", encoding="utf-8"))
TEST = json.load(open(f"{RUN}/reports/test_report_v8.json", encoding="utf-8")); SEL = json.load(open(f"{RUN}/reports/selection_v8.json", encoding="utf-8"))
# the selection as exported: v8.5 wrote pick_recent before the joint-draft check could veto it, so the final state comes from
# the experiment record (the exported pick model has recent preferences only if that record says they stayed on)
_rp = ((SUM.get("experiments") or {}).get("recent_preferences") or {}).get("selected") or {}
SELF = dict(SUM["selected"], **({"pick_recent": bool(_rp.get("on"))} if "pick_recent" in SUM["selected"] else {}))
REP = dict(run=L["run"], version=L["version"], splits=SUM["splits"], selected=SELF, comparisons=SEL["comparisons"], test=TEST["test"],
           world_model=SUM["world_model"], checks=dict(terminal=CHK["terminal"], brute_force=CHK["brute_force"], policy=CHK["policy"], drafts=CHK["drafts"],
           first_ban=CHK["first_ban"], first_ban_by_role=CHK.get("first_ban_by_role"), agreement_by_shown=CHK.get("agreement_by_shown"), students=CHK.get("students"),
           null_world=CHK.get("null_world"), world_model_uncertainty=CHK.get("world_model_uncertainty"), drafts_planner_path=CHK.get("drafts_planner_path")),
           test_consulted=SUM.get("test_consulted"), estimator_checks=OPE.get("estimator_checks"),
           value_chain=CHK["value_chain"], networks=dict(student=bool(L.get("student")), members=L["members"], hidden=L["hidden"], layers=L["layers"], teachers=L.get("teachers")),
           ope=dict(decisions=OPE["decisions"], behaviour_calibration={k: dict(slope=v["behaviour"]["calib_slope"], spread_pts=v["spread_pts"]) for k, v in OPE["behaviour_calibration"].items()},
                    ban_effect_slope=OPE.get("ban_effect_slope"), matches=OPE["matches"]),
           recalibration=SUM.get("recalibration"), draft_calibration={k: v for k, v in SUM.get("draft_calibration", {}).items() if k in ("lam_g", "delta")})
# Season 10 matches per model map in the data bundle: the pages leave out maps the model has barely seen
if os.path.exists(f"{DATA}/maps.parquet"):
    _mp = pd.read_parquet(f"{DATA}/maps.parquet"); _n = dict(zip(_mp.map_id.astype(int), _mp.n_s10.astype(int)))
    REP["map_matches"] = {m["label"]: int(_n.get(int(m["map_id"]), 0)) for m in L["maps"]}
json.dump(REP, open(f"{OUT}/report_v8.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=lambda x: np.asarray(x).tolist())
print("staged", ", ".join(sorted(os.listdir(OUT))))
# ---- check the staged bundle; publish it only if every check passes
if os.environ.get("SKIP_CHECKS") != "1":
    env = dict(os.environ, MODEL_DIR=OUT)
    steps = [[sys.executable, "tools/check_v8_ref.py", RUN], [sys.executable, "tools/check_decisions.py", "400"], ["node", "tools/check_v8.js"]] + ([["node", "tools/check_sim_v8.js"]] if HAS_SIM else [])
    for cmd in steps:
        r = subprocess.run(cmd, env=env, capture_output=True, text=True); print(r.stdout.strip()[-1500:])
        if r.returncode: print(r.stderr.strip()[-1500:]); refuse(f"{' '.join(cmd[1:])} failed on the staged bundle (left in {OUT} for inspection)")
prev = LIVE + ".prev"
if os.path.exists(prev): shutil.rmtree(prev)
if os.path.exists(LIVE): os.rename(LIVE, prev)
try: os.rename(OUT, LIVE)
except OSError:
    if os.path.exists(prev): os.rename(prev, LIVE)
    raise
if os.path.exists(prev): shutil.rmtree(prev)
print(f"published run {L['run']} ({L['version']}) to {LIVE}/: " + ", ".join(sorted(os.listdir(LIVE))) + "; next: python tools/stamp.py")
