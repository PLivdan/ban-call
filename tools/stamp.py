"""Stamp every script address with a hash of its content, so a new page never runs with a cached old script.
GitHub Pages lets browsers cache files for ten minutes; without this a fresh index.html can load a stale app8.js.
Run before every commit that changes a script:  python tools/stamp.py
The page (index.html) runs engine.js (lineup network), engine8.js and app8.js; the previous model's page (v7/) runs
../engine.js and v7/app.js with the simulator worker ../sim-worker.js; the studio (studio/) the same engine and worker."""
import hashlib, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
h = lambda *names: hashlib.sha1(b"".join((root / n).read_bytes() for n in names)).hexdigest()[:10]
def sub_script(page, name, src_name=None, prefix=""):
    t = page.read_text(encoding="utf-8"); src = src_name or name
    t = re.sub(rf'<script src="{re.escape(prefix + name)}(\?v=[^"]*)?"></script>', f'<script src="{prefix}{name}?v={h(src)}"></script>', t); page.write_text(t, encoding="utf-8")
    return t
# the page
page = root / "index.html"
for name in ("engine.js", "engine8.js", "app8.js"): t = sub_script(page, name)
print("stamped:", ", ".join(re.findall(r'src="([^"]+\?v=[^"]+)"', t)))
# the previous model's page: its worker version sits inside v7/app.js, so v7/app.js is hashed after it
v7 = root / "v7" / "app.js"
if v7.exists():
    s = re.sub(r'new Worker\("\.\./sim-worker\.js(\?v=[^"]*)?"\)', f'new Worker("../sim-worker.js?v={h("sim.js", "sim-worker.js")}")', v7.read_text(encoding="utf-8")); v7.write_text(s, encoding="utf-8")
    p7 = root / "v7" / "index.html"; sub_script(p7, "engine.js", "engine.js", "../"); t7 = sub_script(p7, "app.js", "v7/app.js")
    print("stamped v7:", ", ".join(re.findall(r'src="([^"]+\?v=[^"]+)"', t7)))
# the lab page (figure options for the v8 model)
lab = root / "lab" / "index.html"
if lab.exists():
    sub_script(lab, "engine.js", "engine.js", "../"); sub_script(lab, "engine8.js", "engine8.js", "../"); tl = sub_script(lab, "lab.js", "lab/lab.js")
    print("stamped lab:", ", ".join(re.findall(r'src="([^"]+\?v=[^"]+)"', tl)))
# the studio page uses the same engine and worker
st_js = root / "studio" / "studio.js"
if st_js.exists():
    s2 = re.sub(r'new Worker\("\.\./sim-worker\.js(\?v=[^"]*)?"\)', f'new Worker("../sim-worker.js?v={h("sim.js", "sim-worker.js")}")', st_js.read_text(encoding="utf-8")); st_js.write_text(s2, encoding="utf-8")
    s2 = re.sub(r'new Worker\("tree-worker\.js(\?v=[^"]*)?"\)', f'new Worker("tree-worker.js?v={h("engine.js", "studio/tree-worker.js")}")', st_js.read_text(encoding="utf-8")); st_js.write_text(s2, encoding="utf-8")
    sp = root / "studio" / "index.html"; t2 = sp.read_text(encoding="utf-8")
    t2 = re.sub(r'<script src="\.\./engine\.js(\?v=[^"]*)?"></script>', f'<script src="../engine.js?v={h("engine.js")}"></script>', t2)
    t2 = re.sub(r'<script src="studio\.js(\?v=[^"]*)?"></script>', f'<script src="studio.js?v={h("studio/studio.js")}"></script>', t2)
    sp.write_text(t2, encoding="utf-8"); print("stamped studio:", ", ".join(re.findall(r'src="([^"]+\?v=[^"]+)"', t2)))
