"""Stamp every script address with a hash of its content, so a new page never runs with a cached old script.
GitHub Pages lets browsers cache files for ten minutes; without this a fresh index.html can load a stale app.js.
Run before every commit that changes a script:  python tools/stamp.py"""
import hashlib, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
h = lambda *names: hashlib.sha1(b"".join((root / n).read_bytes() for n in names)).hexdigest()[:10]
app = root / "app.js"; s = app.read_text()
s = re.sub(r'new Worker\("sim-worker\.js(\?v=[^"]*)?"\)', f'new Worker("sim-worker.js?v={h("sim.js", "sim-worker.js")}")', s)
app.write_text(s)                                   # the worker's version is inside app.js, so app.js is hashed after it
page = root / "index.html"; t = page.read_text()
for name in ("engine.js", "app.js"):
    t = re.sub(rf'<script src="{re.escape(name)}(\?v=[^"]*)?"></script>', f'<script src="{name}?v={h(name)}"></script>', t)
page.write_text(t)
print("stamped:", ", ".join(re.findall(r'src="([^"]+\?v=[^"]+)"', t)), "| worker", re.search(r'sim-worker\.js\?v=[^"]+', s).group(0))
