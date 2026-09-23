import os, subprocess

base = r"C:\Users\rui08\Desktop\教学管理系统"
aw = os.path.join(base, "ai-workbench")
bk = os.path.join(os.environ["TEMP"], "aw-backup")

def count():
    return sum(len(fs) for _, _, fs in os.walk(aw)) if os.path.exists(aw) else -1

def git(*a):
    r = subprocess.run(["git", "-C", base] + list(a), capture_output=True, timeout=120)
    return r.stdout.decode("utf-8", "replace"), r.stderr.decode("utf-8", "replace"), r.returncode

rep = []
rep.append("TEMP 备份存在: %s (%d 个文件)" % (os.path.exists(bk), sum(len(fs) for _, _, fs in os.walk(bk)) if os.path.exists(bk) else -1))
rep.append("起点: %d" % count())

o, e, c = git("checkout", "011d4be", "--", "ai-workbench")
rep.append("① git checkout 011d4be -- ai-workbench rc=%s -> %d" % (c, count()))

o, e, c = git("rm", "-f", "ai-workbench/Dockerfile", "ai-workbench/nginx.conf")
rep.append("② git rm -f Dockerfile nginx.conf rc=%s out=%r -> %d" % (c, o.strip(), count()))

o, e, c = git("add", "-A")
rep.append("③ git add -A rc=%s -> %d" % (c, count()))

o, e, c = git("diff", "--cached", "--name-status")
rep.append("④ diff --cached rc=%s -> %d, 条目数=%d" % (c, count(), len([l for l in o.splitlines() if l.strip()])))
rep.append("   条目: " + "; ".join(o.strip().splitlines()[:8]))

# 若丢了，立刻用 TEMP 备份还原（证明可恢复）
if count() < 32 and os.path.exists(bk):
    import shutil
    if os.path.exists(aw):
        shutil.rmtree(aw, ignore_errors=True)
    shutil.copytree(bk, aw)
    rep.append("")
    rep.append("（检测到丢失，已用 TEMP 备份还原 -> %d）" % count())

open(os.path.join(os.environ["TEMP"], "_pin.txt"), "w", encoding="utf-8").write("\n".join(rep))
