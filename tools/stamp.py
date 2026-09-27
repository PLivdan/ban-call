"""Stamp every script address with a hash of its content, so a new page never runs with a cached old script.
GitHub Pages lets browsers cache files for ten minutes; without this a fresh index.html can load a stale app8.js.
Run before every commit that changes a script:  python tools/stamp.py
The page (index.html) runs engine.js (lineup network), engine8.js and app8.js; the previous model's page (v7/) runs
../engine.js and v7/app.js with the simulator worker ../sim-worker.js; the studio (studio/) runs ../engine8.js, studio.js and the
v8 simulator and tree workers."""
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
# the studio: the v8 engine on the page, the simulator worker (../sim8-worker.js with ../sim8.js and ../engine8.js) and the
# tree worker (tree8-worker.js with ../engine8.js); each worker passes its own stamp on to the scripts it imports
st_js = root / "studio" / "studio.js"
if st_js.exists():
    s2 = st_js.read_text(encoding="utf-8")
    s2 = re.sub(r'new Worker\("\.\./sim8-worker\.js(\?v=[^"]*)?"\)', f'new Worker("../sim8-worker.js?v={h("sim8.js", "engine8.js", "sim8-worker.js")}")', s2)
    s2 = re.sub(r'new Worker\("tree8-worker\.js(\?v=[^"]*)?"\)', f'new Worker("tree8-worker.js?v={h("engine8.js", "studio/tree8-worker.js")}")', s2); st_js.write_text(s2, encoding="utf-8")
    sp = root / "studio" / "index.html"; t2 = sp.read_text(encoding="utf-8")
    t2 = re.sub(r'<script src="\.\./engine8?\.js(\?v=[^"]*)?"></script>', f'<script src="../engine8.js?v={h("engine8.js")}"></script>', t2)
    t2 = re.sub(r'<script src="studio\.js(\?v=[^"]*)?"></script>', f'<script src="studio.js?v={h("studio/studio.js")}"></script>', t2)
    sp.write_text(t2, encoding="utf-8"); print("stamped studio:", ", ".join(re.findall(r'src="([^"]+\?v=[^"]+)"', t2)) + ", workers " + ", ".join(re.findall(r'new Worker\("([^"]+)"\)', s2)))
