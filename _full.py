import os, subprocess

base = r"C:\Users\rui08\Desktop\教学管理系统"
env = dict(os.environ)
for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
    env.pop(k, None)

def git(*a, timeout=120):
    r = subprocess.run(["git", "-C", base, "-c", "http.proxy=", "-c", "https.proxy="] + list(a),
                       capture_output=True, env=env, timeout=timeout)
    return r.stdout.decode("utf-8", "replace"), r.stderr.decode("utf-8", "replace"), r.returncode

rep = []
o, _, _ = git("rev-parse", "HEAD"); rep.append("HEAD = " + o.strip())
o, _, _ = git("--no-pager", "log", "--oneline", "-3"); rep.append("log:\n" + o.strip())

aw = os.path.join(base, "ai-workbench")
rep.append("")
rep.append("磁盘 ai-workbench 文件数 = %d" % sum(len(fs) for _, _, fs in os.walk(aw)))
o, _, _ = git("ls-tree", "-r", "--name-only", "HEAD", "ai-workbench")
rep.append("HEAD 中 ai-workbench 文件数 = %d" % len([l for l in o.splitlines() if l.strip()]))
o, _, _ = git("ls-files", "ai-workbench")
rep.append("索引中 ai-workbench 文件数 = %d" % len([l for l in o.splitlines() if l.strip()]))

o, _, _ = git("status", "--porcelain")
lines = [l for l in o.strip().splitlines()]
rep.append("")
rep.append("=== status --porcelain（%d 行）===" % len(lines))
rep.append("\n".join(lines[:60]))

o, _, _ = git("diff", "--cached", "--name-status")
cs = [l for l in o.strip().splitlines() if l.strip()]
rep.append("")
rep.append("=== diff --cached（%d 条）===" % len(cs))
rep.append("\n".join(cs[:60]))

left = [f for f in os.listdir(base) if f.startswith("_") and os.path.isfile(os.path.join(base, f))]
rep.append("")
rep.append("根目录 _* 文件: " + (", ".join(sorted(left)) or "无"))

o, e, c = git("ls-remote", "--heads", "gitee")
rep.append("")
rep.append("gitee ls-remote rc=%s -> %s" % (c, o.strip() or e.strip()))

open(os.path.join(os.environ["TEMP"], "_full.txt"), "w", encoding="utf-8").write("\n".join(rep))
