"""Guard against a bug class that bit this project three times: an inline comment that swallows code after it on the same
line (for example 'x = 1;   // note y = 2;' or 'f(a,   # note b, c)'). Flags lines whose comment text itself looks like
code: assignments, calls followed by ';' or ')', or statement keywords. Heuristic, so it errs towards flagging.
Usage: python tools/check_comments.py <files...>"""
import re, sys
bad = 0
code = re.compile(r"(\b(const|let|var|return|def|import|if|for)\b.*[=(:]|[A-Za-z_][\w.\]\[\"']*\s*=\s*[^=]|\)\s*;|\bnew\s+\w+\(|[A-Za-z_]\w*=\w)")
for path in sys.argv[1:]:
    py = path.endswith(".py")
    for n, line in enumerate(open(path, encoding="utf-8"), 1):
        s_ = line.rstrip("\n"); st = s_.lstrip()
        if not st or st.startswith(("#", "//", "*", "/*")): continue
        # find the comment start outside string literals
        q = None; i = 0; cut = -1
        while i < len(s_):
            ch = s_[i]
            if q:
                if ch == "\\": i += 2; continue
                if ch == q: q = None
            elif ch in "\"'`": q = ch
            elif py and ch == "#": cut = i; break
            elif not py and s_.startswith("//", i) and not s_[max(0, i - 1)] == ":": cut = i; break
            i += 1
        if cut < 0: continue
        com = s_[cut + (1 if py else 2):]
        if code.search(com) and (com.count("(") != com.count(")") or re.search(r";\s*\S|=\s*[\w\[{(]", com)):
            print(f"{path}:{n}: comment may hide code: {com.strip()[:110]}"); bad += 1
print(f"{bad} suspicious comments" if bad else "no comment swallows code"); sys.exit(1 if bad else 0)
