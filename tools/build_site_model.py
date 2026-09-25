"""Build the site's model files from the notebook export (Part B, ban_value_model_*.json):
  model/meta.json    small tables (heroes, maps, tiers, removal costs, matchups, ban model, validation)
  model/weights.bin  the lineup networks as float16, one after another (offsets and shapes in meta.json)
Usage: python tools/build_site_model.py <ban_value_model_*.json>"""
import json, sys, os, numpy as np
src = sys.argv[1]; M = json.load(open(src))
parts, layout, off = [], [], 0
for i, p in enumerate(M["lineup_models"]):
    ent = {}
    for k in ("W1", "b1", "W2", "b2", "W3", "b3", "Wl"):
        a = np.asarray(p[k], np.float32); ent[k] = dict(offset=off, shape=list(a.shape)); parts.append(a.astype(np.float16).ravel()); off += a.size
    layout.append(ent)
os.makedirs("model", exist_ok=True)
np.concatenate(parts).tofile("model/weights.bin")
R = lambda x, n=5: np.round(np.asarray(x, float), n).tolist()
meta = {k: M[k] for k in ("version", "heroes", "roles", "ban_order", "bands", "tiers", "maps", "feature_layout", "validation")}
meta.update(source=os.path.basename(src), weights=dict(file="weights.bin", dtype="float16", models=layout, total=off),
            removal_cost=R(M["removal_cost"]), removal_cost_sd=R(M["removal_cost_boot_sd"]), C=R(M["C"], 4), S=R(M["S"], 4),
            ALTC=R(M["ALTC"], 4), ALTS=R(M["ALTS"], 4), MC=R(M["MC"]), MS=R(M["MS"]), alt=R(M["alt"], 3),
            ban={k: (R(v) if isinstance(v, list) else v) for k, v in M["ban"].items()})
json.dump(meta, open("model/meta.json", "w"), separators=(",", ":"))
print(f"model/meta.json {os.path.getsize('model/meta.json') / 1e6:.2f} MB, model/weights.bin {os.path.getsize('model/weights.bin') / 1e6:.2f} MB ({off:,} float16)")
