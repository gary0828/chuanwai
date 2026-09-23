import subprocess, os

base = r"C:\Users\rui08\Desktop\教学管理系统"
env = dict(os.environ)
for k in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
    env.pop(k, None)
env["GIT_HTTP_TIMEOUT"] = "120"

def git(*a, timeout=900):
    r = subprocess.run(["git", "-C", base, "-c", "http.proxy=", "-c", "https.proxy="] + list(a),
                       capture_output=True, env=env, timeout=timeout)
    return r.stdout.decode("utf-8", "replace"), r.stderr.decode("utf-8", "replace"), r.returncode

rep = []
o, e, c = git("add", "-A")
rep.append("git add -A rc=%s" % c)
o, e, c = git("diff", "--cached", "--name-status")
bad = [l for l in o.splitlines() if os.path.basename(l.split("\t")[-1]).startswith("_")]
rep.append("暂存区 _ 开头文件: " + (", ".join(bad) if bad else "无 ✓"))
rep.append("暂存清单:\n" + o.strip())

msg = """chore(deploy): 废弃老三端口遗留资产（工作台单独镜像 / nginx + 专用 e2e）

按用户 2026-09-23 拍板的版本策略：本地 = 服务器（同一份统一入口编排），
老三端口形态彻底废弃，相关资产一并清理。

- 删除 ai-workbench/Dockerfile 与 ai-workbench/nginx.conf
  （此前仅供老三端口 compose 的独立工作台服务使用，已零引用）
- deploy/nginx-unified.conf：注释同步为「唯一的 nginx 配置」
- docs/06-部署/运维约定.md：§1 三份/两份 nginx → 「只有一份」；
  §2 /assets/ 前缀陷阱改写为「工作台自托管时代」的历史事故（原理保留）
- memory/check.mjs：部署文件护栏清单同步

说明：老三端口专用 e2e `_verify_test/ui-docker-e2e.py` 已删除（该目录 gitignored）；
`ui-provider-degrade.py` / `verify-workbench-origin.mjs` 测的是代码行为，未废弃，待适配统一入口。
"""
mp = os.path.join(os.environ["TEMP"], "_cmsg2.txt")
open(mp, "w", encoding="utf-8").write(msg)

o, e, c = git("commit", "-F", mp)
rep.append("")
rep.append("commit rc=%s" % c)
rep.append(o.strip() or "(no stdout)")
if e.strip():
    rep.append("--- stderr ---"); rep.append(e.strip()[:1500])
try: os.remove(mp)
except Exception: pass

o, e, c = git("push", "gitee", "main")
rep.append("")
rep.append("push rc=%s" % c)
rep.append(o.strip())
if e.strip(): rep.append(e.strip())

o, _, _ = git("rev-parse", "HEAD"); local = o.strip()
o2, _, _ = git("ls-remote", "--heads", "gitee")
rep.append("")
rep.append("local HEAD = " + local)
rep.append("gitee refs = " + o2.strip())
rep.append("一致: " + ("是" if local and local in o2 else "否"))
o, _, _ = git("status", "--porcelain")
rep.append("status: " + (o.strip() or "(clean)"))

open(os.path.join(os.environ["TEMP"], "_depout.txt"), "w", encoding="utf-8").write("\n".join(rep))
