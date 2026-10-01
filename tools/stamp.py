"""Stamp every script address with a hash of its content, so a new page never runs with a cached old script.
GitHub Pages lets browsers cache files for ten minutes; without this a fresh index.html can load a stale app8.js.
Run before every commit that changes a script:  python tools/stamp.py
The page (index.html, the one-column layout; classic.html keeps the old one unlinked) runs engine8.js, lobby-state.js, methods8.js (the Methods figures) and app8.js, with the v8 simulator worker; the previous model's page (v7/) runs
../engine.js and v7/app.js with the simulator worker ../sim-worker.js. The studio was retired (tag studio-final)."""
import hashlib, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
h = lambda *names: hashlib.sha1(b"".join((root / n).read_bytes() for n in names)).hexdigest()[:10]
def sub_script(page, name, src_name=None, prefix=""):
    t = page.read_text(encoding="utf-8"); src = src_name or name
    t = re.sub(rf'<script src="{re.escape(prefix + name)}(\?v=[^"]*)?"></script>', f'<script src="{prefix}{name}?v={h(src)}"></script>', t); page.write_text(t, encoding="utf-8")
    return t
# the page; app8.js starts the simulator worker (likely comps), whose address is stamped first so app8.js is hashed after it
app = root / "app8.js"
app.write_text(re.sub(r'new Worker\("sim8-worker\.js(\?v=[^"]*)?"\)', f'new Worker("sim8-worker.js?v={h("sim8.js", "engine8.js", "sim8-worker.js")}")', app.read_text(encoding="utf-8")), encoding="utf-8")
page = root / "index.html"
for name in ("engine8.js", "lobby-state.js", "methods8.js", "app8.js"): t = sub_script(page, name)
print("stamped:", ", ".join(re.findall(r'src="([^"]+\?v=[^"]+)"', t)))
# the classic layout (classic.html, unlinked since the test layout became the page on 2026-10-01): the same scripts
classic = root / "classic.html"
if classic.exists():
    for name in ("engine8.js", "lobby-state.js", "methods8.js", "app8.js"): tb = sub_script(classic, name)
    print("stamped classic:", ", ".join(re.findall(r'src="([^"]+\?v=[^"]+)"', tb)))
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
