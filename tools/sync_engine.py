"""Copy the canonical value engine (tools/engine_ref.py, between its >>> / <<< markers) into the notebook source.
Usage: python tools/sync_engine.py [path/to/01_ban_solver_real.py]"""
import os, sys
here = os.path.dirname(os.path.abspath(__file__)); nb = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/personal/ban-solver/notebooks/01_ban_solver_real.py")
A, B = "# >>> value engine v7", "# <<< value engine v7"
blk = lambda t: t[t.index(A):t.index(B)]
ref = open(os.path.join(here, "engine_ref.py"), encoding="utf-8").read(); src = open(nb, encoding="utf-8").read()
new = src.replace(blk(src), blk(ref))
if new != src: open(nb, "w", encoding="utf-8").write(new); print(f"updated the engine block in {nb}")
else: print("notebook engine block already matches tools/engine_ref.py")
