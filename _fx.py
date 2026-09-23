import os, subprocess, shutil

base = r"C:\Users\rui08\Desktop\教学管理系统"
env = dict(os.environ)
for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
    env.pop(k, None)
env["GIT_HTTP_TIMEOUT"] = "120"

def git(*a, timeout=600):
    r = subprocess.run(["git", "-C", base, "-c", "http.proxy=", "-c", "https.proxy="] + list(a),
                       capture_output=True, env=env, timeout=timeout)
    return r.stdout.decode("utf-8", "replace"), r.stderr.decode("utf-8", "replace"), r.returncode

rep = []

# 0) 仓库外安全备份（防再次意外丢失）
bk = os.path.join(os.environ["TEMP"], "aw-backup")
if os.path.exists(bk):
    shutil.rmtree(bk, ignore_errors=True)
shutil.copytree(os.path.join(base, "ai-workbench"), bk)
rep.append("已备份 ai-workbench → %s（%d 个文件）" % (bk, sum(len(fs) for _, _, fs in os.walk(bk))))

# 1) 删掉本次真正要废弃的 2 个文件 + 清临时脚本（避免被 add）
o, e, c = git("rm", "-f", "ai-workbench/Dockerfile", "ai-workbench/nginx.conf")
rep.append("git rm 2 files rc=%s  %s" % (c, o.strip()))
for n in ["_fix2.py", "_state.py", "_diag.py", "_rec.py"]:
    p = os.path.join(base, n)
    if os.path.isfile(p):
        try: os.remove(p)
        except Exception: pass

# 2) 暂存
o, e, c = git("add", "-A")
rep.append("git add -A rc=%s" % c)

# 3) 护栏
o, e, c = git("diff", "--cached", "--name-status")
staged = [l for l in o.strip().splitlines() if l.strip()]
dels = [l for l in staged if l.startswith("D")]
BAD = [l for l in dels if l.split("\t")[-1] not in ("ai-workbench/Dockerfile", "ai-workbench/nginx.conf")]
rep.append("")
rep.append("staged %d 条；其中删除 %d 条：" % (len(staged), len(dels)))
rep.append("\n".join(dels) if dels else "(无)")
if BAD:
    rep.append("")
    rep.append("!!! 护栏拦截：出现非预期删除，已中止 !!!")
    rep.append("\n".join(BAD))
    open(os.path.join(os.environ["TEMP"], "_fx.txt"), "w", encoding="utf-8").write("\n".join(rep))
    raise SystemExit(1)

# 4) 提交 + 推送
msg = """fix(deploy): 恢复被误删的 ai-workbench 源码，仅废弃工作台单独镜像产物

提交 584535c 误把整个 ai-workbench/ 源码树一并删除（41 files / -10930）。
本次从 011d4be 完整恢复全部 34 个文件，只保留原定的两项废弃：
  - ai-workbench/Dockerfile（老三端口独立工作台镜像用，已零引用）
  - ai-workbench/nginx.conf（同上）
其余内容零改动。
"""
mp = os.path.join(os.environ["TEMP"], "_cmsg4.txt")
open(mp, "w", encoding="utf-8").write(msg)
o, e, c = git("commit", "-F", mp)
rep.append("")
rep.append("commit rc=%s  %s" % (c, o.strip()))
if e.strip(): rep.append("stderr: " + e.strip()[:1200])
try: os.remove(mp)
except Exception: pass

o, e, c = git("push", "gitee", "main")
rep.append("push rc=%s  %s" % (c, o.strip()))
if e.strip(): rep.append("push stderr: " + e.strip())

# 5) 复核
aw = os.path.join(base, "ai-workbench")
rep.append("")
rep.append("磁盘 ai-workbench 文件数: %d（应 32）" % sum(len(fs) for _, _, fs in os.walk(aw)))
o, _, _ = git("ls-tree", "-r", "--name-only", "HEAD", "ai-workbench")
rep.append("HEAD 中 ai-workbench 文件数: %d（应 32）" % len([l for l in o.splitlines() if l.strip()]))
o, _, _ = git("rev-parse", "HEAD"); local = o.strip()
o2, _, _ = git("ls-remote", "--heads", "gitee")
rep.append("local HEAD = " + local)
rep.append("gitee refs = " + o2.strip())
rep.append("一致: " + ("是" if local and local in o2 else "否"))
o, _, _ = git("status", "--porcelain")
rep.append("status: " + (o.strip() or "(clean)"))
o, _, _ = git("--no-pager", "log", "--oneline", "-3")
rep.append("log:\n" + o.strip())

open(os.path.join(os.environ["TEMP"], "_fx.txt"), "w", encoding="utf-8").write("\n".join(rep))
