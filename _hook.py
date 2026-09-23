import os, subprocess

base = r"C:\Users\rui08\Desktop\教学管理系统"
rep = []

# 1) .git/hooks 下非 sample
hd = os.path.join(base, ".git", "hooks")
if os.path.isdir(hd):
    rep.append("=== .git/hooks（非 .sample）===")
    for f in sorted(os.listdir(hd)):
        if not f.endswith(".sample"):
            p = os.path.join(hd, f)
            rep.append("--- %s (mode=%o) ---" % (f, os.stat(p).st_mode))
            try:
                rep.append(open(p, encoding="utf-8", errors="replace").read()[:600])
            except Exception as e:
                rep.append("read err %s" % e)
else:
    rep.append(".git/hooks 不存在")

# 2) .husky
rep.append("")
rep.append("=== .husky ===")
for root, dirs, files in os.walk(os.path.join(base, ".husky")):
    for f in files:
        rep.append(os.path.relpath(os.path.join(root, f), base))

# 3) git config 里可疑项（filter / fsmonitor / hooksPath / alias）
r = subprocess.run(["git", "-C", base, "config", "--list", "--show-origin"], capture_output=True)
cfg = r.stdout.decode("utf-8", "replace")
sus = [l for l in cfg.splitlines() if any(k in l.lower() for k in ("filter", "fsmonitor", "hookspath", "alias", "clean", "smudge", "prune"))]
rep.append("")
rep.append("=== git config 可疑项 ===")
rep.append("\n".join(sus) or "(无)")

# 4) clean-residue.js 是干嘛的
p = os.path.join(base, "_verify_test", "clean-residue.js")
if os.path.exists(p):
    rep.append("")
    rep.append("=== _verify_test/clean-residue.js 前 40 行 ===")
    rep.append("\n".join(open(p, encoding="utf-8", errors="replace").read().splitlines()[:40]))

open(os.path.join(os.environ["TEMP"], "_hook.txt"), "w", encoding="utf-8").write("\n".join(rep))
