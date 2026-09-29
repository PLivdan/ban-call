"""The importer's all-or-nothing contract (tools/build_site_v8.py): every bad run is refused and leaves model8/ byte for byte
as it was; a run without a simulator is refused unless ALLOW_NO_SIM=1, which publishes a release with no simulator files.
Runs in a temporary copy of the site, on altered copies of a real run folder.

    python tools/check_import.py <run folder> [<colab_v8 data folder>]
"""
import hashlib, json, os, shutil, subprocess, sys, tempfile

RUN = os.path.abspath(sys.argv[1]); DATA = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else "../ban-solver/data/colab_v8")
SITE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
def digest(d): return {f: hashlib.sha256(open(os.path.join(d, f), "rb").read()).hexdigest() for f in sorted(os.listdir(d))} if os.path.isdir(d) else None
def jedit(path, fn):
    with open(path, encoding="utf-8") as f: o = json.load(f)
    fn(o)
    with open(path, "w", encoding="utf-8") as f: json.dump(o, f)
def link_or_copy(src, dst):
    """The run's large model file, shared rather than copied: a symlink, else (Windows without admin or Developer Mode) a hard
    link, else a copy."""
    for how in (os.symlink, os.link, shutil.copy):
        try: how(src, dst); return
        except OSError: pass
    raise OSError(f"could not link or copy {src}")
bad = 0
with tempfile.TemporaryDirectory() as T:
    site = os.path.join(T, "site"); os.makedirs(site)
    for f in ("engine8.js", "sim8.js"): shutil.copy(os.path.join(SITE, f), site)
    shutil.copytree(os.path.join(SITE, "tools"), os.path.join(site, "tools")); shutil.copytree(os.path.join(SITE, "model8"), os.path.join(site, "model8"))
    def run_copy(tag):
        d = os.path.join(T, tag); os.makedirs(d)
        for sub in ("site", "reports"): shutil.copytree(os.path.join(RUN, sub), os.path.join(d, sub))
        if os.path.exists(os.path.join(RUN, "models_v8.pkl")): link_or_copy(os.path.join(RUN, "models_v8.pkl"), os.path.join(d, "models_v8.pkl"))
        return d
    def importer(run, **env):
        return subprocess.run([sys.executable, "tools/build_site_v8.py", run, DATA], cwd=site, env=dict(os.environ, **env), capture_output=True, text=True)
    def expect_refused(name, run, **env):
        global bad
        before = digest(os.path.join(site, "model8")); r = importer(run, **env); after = digest(os.path.join(site, "model8"))
        ok = r.returncode != 0 and "refused, model8 unchanged" in (r.stdout + r.stderr) and before == after
        bad += not ok; print(f"  {'ok  ' if ok else 'FAIL'} {name}: " + ((r.stdout + r.stderr).strip().splitlines() or ["(no output)"])[-1][:150])
    fast = dict(SKIP_CHECKS="1")
    d = run_copy("gate"); jedit(f"{d}/reports/summary_v8.json", lambda o: o.update(deploy_ok=False)); expect_refused("a run that failed the null-world gate", d, **fast)
    d = run_copy("nogate")
    for f_ in ("site/value_v8.json", "reports/summary_v8.json"): jedit(f"{d}/{f_}", lambda o: o.update(version="v8.4"))
    jedit(f"{d}/site/sim_v8.json", lambda o: o.update(version="v8.4")); jedit(f"{d}/reports/summary_v8.json", lambda o: o.pop("deploy_ok", None))
    expect_refused("a v8.4 summary without the gate", d, **fast)
    d = run_copy("simrun"); jedit(f"{d}/site/sim_v8.json", lambda o: o.update(run="19990101_0000")); expect_refused("a simulator from another run", d, **fast)
    d = run_copy("heroes"); jedit(f"{d}/site/ban_model_v8.json", lambda o: o.update(heroes=list(reversed(o["heroes"])))); expect_refused("a ban model with another hero order", d, **fast)
    d = run_copy("premade"); jedit(f"{d}/reports/summary_v8.json", lambda o: o["experiments"].update(premade=dict(mix=True, outcome=False))); expect_refused("a run that kept a premade correction", d, **fast)
    d = run_copy("forced"); jedit(f"{d}/reports/summary_v8.json", lambda o: o.update(deploy_ok=False, deploy_notes=["a test run: FORCE_RUN / FORCE_KEEP overrode the experiments' gates"])); expect_refused("a forced test run", d, **fast)
    d = run_copy("simhash"); jedit(f"{d}/site/sim_v8.json", lambda o: o.update(bin_bytes=1, bin_sha256="0")); expect_refused("a simulator whose binary does not match its manifest", d, **fast)
    d = run_copy("trunc"); b_ = open(f"{d}/site/value_v8.bin", "rb").read()
    with open(f"{d}/site/value_v8.bin", "wb") as f_: f_.write(b_[: len(b_) // 2])
    expect_refused("truncated value networks", d, **fast)
    d = run_copy("nosim"); os.remove(f"{d}/site/sim_v8.json"); os.remove(f"{d}/site/sim_v8.bin"); expect_refused("a run without a simulator", d, **fast)
    r = importer(d, ALLOW_NO_SIM="1", **fast); left = sorted(os.listdir(os.path.join(site, "model8")))
    ok = r.returncode == 0 and not any(f.startswith("sim_v8") for f in left); bad += not ok
    print(f"  {'ok  ' if ok else 'FAIL'} ALLOW_NO_SIM=1 publishes without the old simulator: {left}")
    shutil.rmtree(os.path.join(site, "model8")); shutil.copytree(os.path.join(SITE, "model8"), os.path.join(site, "model8"))
    d = run_copy("simlocal"); jedit(f"{d}/reports/summary_v8.json", lambda o: o.update(deploy_ok=False, training_ok=True, release_bundle_ok=False, deploy_notes=["the site simulator was not written (test)"]))
    r = importer(d, **fast); ok = r.returncode == 0; bad += not ok
    print(f"  {'ok  ' if ok else 'FAIL'} a run whose only problem was the notebook's simulator step imports with a locally built simulator")
    d = run_copy("simlocal_other"); jedit(f"{d}/reports/summary_v8.json", lambda o: o.update(deploy_ok=False, training_ok=False, release_bundle_ok=False, deploy_notes=["the null-world gate failed"]))
    shutil.rmtree(os.path.join(site, "model8")); shutil.copytree(os.path.join(SITE, "model8"), os.path.join(site, "model8"))
    expect_refused("a failed gate is not excused by a locally built simulator", d, **fast)
    d = run_copy("parity"); jedit(f"{d}/site/parity_v8.json", lambda o: o["cases"][0].update(outputs=[v + .5 for v in o["cases"][0]["outputs"]]))
    expect_refused("a bundle that fails the parity checks on staging", d)
print("all import checks passed" if not bad else f"{bad} import check(s) FAILED"); sys.exit(1 if bad else 0)
