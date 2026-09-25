"""Parity of the browser engine (engine.js) with the numpy reference (tools/engine_ref.py) on the site's own model files.
Both read the same float16 lineup networks and tables, so any difference is implementation, not model.
Also checks that the notebook embeds the reference engine verbatim (so the notebook, the reference and the site agree).
Usage: python tools/check_ref.py [path/to/01_ban_solver_real.py]"""
import json, os, subprocess, sys, numpy as np
sys.path.insert(0, os.path.dirname(__file__)); from engine_ref import Model
NODE = os.environ.get("NODE", os.path.expanduser("~/tools/node/node.exe"))
meta = json.load(open("model/meta.json")); raw = np.fromfile("model/weights.bin", np.float16).astype(np.float64)
M = dict(meta); M["removal_cost_boot_sd"] = meta["removal_cost_sd"]
M["lineup_models"] = [{k: raw[v["offset"]:v["offset"] + int(np.prod(v["shape"]))].reshape(v["shape"]) for k, v in ent.items()} for ent in meta["weights"]["models"]]
IX = {h: i for i, h in enumerate(meta["heroes"])}
L = lambda fu, bans, rev, m, r0, cnt: dict(firstUs=fu, bans=[IX[b] for b in bans], rev=[IX[h] for h in rev], m=m, r0=r0, cnt=cnt)
lobbies = [L(False, ["Devil Dinosaur"], ["Hela", "Ultron", "Magneto", "Invisible Woman"], 0, 4550., 2), L(True, [], ["Gambit"], 3, 4250., 1),
           L(True, ["Hulk", "Loki", "Storm"], ["Thor"], 7, 4900., 2), L(True, ["Hulk", "Loki", "Storm", "Gambit"], ["Thor"], 7, 4900., 1),
           L(False, ["Groot", "Magik", "Mantis", "Rogue", "Blade"], [], 11, 3800., 1), L(False, ["Groot"], ["Hela", "Ultron", "Magneto", "Invisible Woman", "Rocket Raccoon", "Thor"], 5, 4700., 2),
           L(True, ["Groot", "Magik", "Mantis", "Rogue", "Blade", "Hela"], ["Loki", "Thor"], 2, 4400., 1)]
opt = dict(NS=128, NOWN=16); bad = 0
# a variant with the v7.1 extensions (joint-removal terms, the richer ban model), random but plausible sizes, so those paths are checked too
rg = np.random.default_rng(7); H = len(meta["heroes"]); NB = len(meta["bands"]) + 1
ext = dict(pair_removal=np.round(np.abs(rg.normal(0, .004, (H, H, NB))) * (1 - np.eye(H))[:, :, None], 5).tolist())
ban2 = dict(meta["ban"], lam_e=np.round(rg.normal(0, .2, 6), 4).tolist(), gam_e=np.round(rg.normal(0, .2, 6), 4).tolist(),
            Lo=np.round(rg.normal(0, .3, (H, H)), 4).tolist(), Lt=np.round(rg.normal(0, .3, (H, H)), 4).tolist())
TMP = os.path.join(os.environ.get("TEMP", "/tmp"), "bancall_meta_ext.json"); json.dump(dict(meta, ban=ban2, **ext), open(TMP, "w"))
for label, Mx, mpath in (("model as served", M, None), ("with joint-removal terms and the richer ban model", dict(M, ban=ban2, **ext), TMP)):
  print(label + ":")
  js = json.loads(subprocess.run([NODE, "tools/check_engine.js"], input=json.dumps(dict(lobbies=lobbies, opt=opt, meta=mpath)), capture_output=True, text=True, check=True).stdout)
  ref = Model(Mx, NS=opt["NS"], NOWN=opt["NOWN"])
  for lb, j in zip(lobbies, js):
      r = ref.values(lb["firstUs"], lb["bans"], lb["rev"], lb["m"], lb["r0"], cnt=lb["cnt"])
      f = lambda a: np.array([np.nan if v is None else v for v in a], float)
      dP = max(np.nanmax(np.abs(f(j["Pu"]) - r["Pu"])), np.nanmax(np.abs(f(j["Pt"]) - r["Pt"])))
      msg = f"{len(lb['bans'])} bans, {len(lb['rev'])} shown, cnt {lb['cnt']}: lineups max |diff| {dP:.1e}"
      if dP > 1e-5: bad += 1
      if "V" in r:
          dV = np.nanmax(np.abs(f(j["V"]) - r["V"])); dS = np.nanmax(np.abs(f(j["se"]) - r["se"])); msg += f", values {100 * dV:.5f} pp, se {100 * dS:.5f} pp"; bad += dV > 2e-6 or dS > 2e-6
          if r.get("pairs"):
              jp = {(p["a"], p["b"]): p for p in j["pairs"]}; dp = max(max(abs(jp[(p["a"], p["b"])]["V"] - p["V"]), abs(jp[(p["a"], p["b"])]["se"] - p["se"])) for p in r["pairs"])
              msg += f", pairs (value and se) {100 * dp:.5f} pp"; bad += dp > 2e-6
      print(msg)
nb = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/personal/ban-solver/notebooks/01_ban_solver_real.py")
blk = lambda t: t[t.index("# >>> value engine v7"):t.index("# <<< value engine v7")]
if os.path.exists(nb):
    same = blk(open(nb, encoding="utf-8").read()) == blk(open(os.path.join(os.path.dirname(__file__), "engine_ref.py"), encoding="utf-8").read())
    print("notebook embeds tools/engine_ref.py verbatim:", same); bad += not same
print("all reference checks passed" if not bad else f"{bad} reference checks FAILED"); sys.exit(1 if bad else 0)
