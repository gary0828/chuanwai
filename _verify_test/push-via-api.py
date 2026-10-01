#!/usr/bin/env python3
"""
当 git 协议（github.com:443）被网络/代理封锁时的兜底推送通道。

原理：用 GitHub Git Data REST API 在本地构造与 `git commit` 等价的对象
（blob -> tree -> commit -> 更新 ref），从而把本地已有的提交原样推到远程。

限制（重要）：
- 只适合「改动文件少、体积小」的提交（本仓库日常提交 2~5 个文件，完全够用）。
- 不会推送二进制大文件；如需大文件请恢复 git 协议直连。
- commit SHA 由 GitHub 生成，与本地 `git commit` 的 SHA **不同**（作者/时间相同但
  API 生成的 tree 对象序列化一致，内容一致）。推送后需把本地 origin/main 追平。

用法：
    set GITHUB_TOKEN=xxx
    python _verify_test/push-via-api.py            # 推送 HEAD
"""
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

OWNER = "gary0828"
REPO = "chuanwai"
BRANCH = "main"
API = "https://api.github.com"

TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()
if not TOKEN:
    sys.exit("缺少环境变量 GITHUB_TOKEN")


def api(path, method="GET", payload=None):
    """调用 GitHub API，返回 (status, parsed_json_or_text)。"""
    url = f"{API}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, body
    except Exception as e:  # noqa: BLE001
        return 0, str(e)


def git(args):
    return subprocess.run(
        ["git"] + args, capture_output=True, text=True, encoding="utf-8"
    ).stdout.strip()


# ---------- 1. 收集本次提交改动的全部文件 ----------
# ★ 必须用 -z：中文路径在非 -z 模式下会被 git 转义成
#   "docs/00-\351\241\271\347\233\256\345\257\274\350\210\252.md"，
#   拿这个转义串去 `git show HEAD:<path>` 会取到空内容（e69de29 空 blob），
#   若不校验就会把空文件推上去。加了 blob 一致性校验才拦得住。
raw = subprocess.run(
    ["git", "show", "--pretty=format:", "--name-status", "-z", "HEAD"],
    capture_output=True,
).stdout.decode("utf-8")
fields = [f for f in raw.split("\0") if f != ""]
# -z 下 --name-status 输出为 "status\0path\0"（重命名是 status\0old\0new）
changes = []
i = 0
while i < len(fields):
    status, path = fields[i], fields[i + 1]
    i += 2
    if status.startswith("R"):  # 重命名：跳过 old，只处理 new
        i += 1
        path = fields[i - 1]
    if status == "D":
        changes.append({"path": path, "mode": "100644", "type": "blob", "sha": None})
        continue
    # ★ 必须取「入库版本」而不是工作树原始字节：
    #   本仓库 core.autocrlf=true，工作树是 CRLF、对象库存 LF。
    #   若直接 open(path,'rb') 上传，会把 CRLF 写进远程，
    #   导致远程 blob 与仓库既有规范不一致（GitHub 上整文件显示为改动）。
    content = subprocess.run(
        ["git", "show", f"HEAD:{path}"], capture_output=True
    ).stdout
    # ★ 空内容必须终止：这几乎总是「路径解析失败」的信号，
    #   把空 blob 推上去等于删掉远程文件内容，后果比推不上去严重得多。
    if not content:
        sys.exit(f"读取 {path} 的内容为空，疑似路径解析失败，已终止推送")
    changes.append({"path": path, "content": content, "deleted": False})

if not changes:
    sys.exit("HEAD 没有任何文件改动，无需推送")

subject = git(["log", "-1", "--pretty=format:%s"])
body = git(["log", "-1", "--pretty=format:%b"])
author_name = git(["log", "-1", "--pretty=format:%an"])
author_email = git(["log", "-1", "--pretty=format:%ae"])
author_date = git(["log", "-1", "--pretty=format:%aI"])
message = subject + ("\n\n" + body.strip() if body.strip() else "")

print(f"提交：{subject}")
print(f"改动 {len(changes)} 个文件：" + ", ".join(c["path"] for c in changes))

# ---------- 2. 远程基线 ----------
st, ref = api(f"/repos/{OWNER}/{REPO}/git/ref/heads/{BRANCH}")
if st != 200:
    sys.exit(f"读取远程 ref 失败：{st} {ref}")
remote_sha = ref["object"]["sha"]
print(f"远程 {BRANCH} = {remote_sha[:7]}")

st, commit = api(f"/repos/{OWNER}/{REPO}/git/commits/{remote_sha}")
if st != 200:
    sys.exit(f"读取远程 commit 失败：{st} {commit}")
base_tree = commit["tree"]["sha"]

# 幂等保护：远程 HEAD 的提交标题与本提交完全一致才跳过
# 注意：不能只比对 "fix" 这类类型前缀——上一个提交同样是 fix(...) 开头会误判。
remote_subject = (commit.get("message") or "").strip().splitlines()[0].strip()
if remote_subject == subject:
    print("远程 HEAD 已是该提交，跳过。")
    sys.exit(0)

# ---------- 3. 上传 blob ----------
tree_entries = []
for c in changes:
    if c.get("deleted"):
        tree_entries.append(
            {"path": c["path"], "mode": c["mode"], "type": c["type"], "sha": None}
        )
        continue
    st, blob = api(
        f"/repos/{OWNER}/{REPO}/git/blobs",
        "POST",
        {"content": base64.b64encode(c["content"]).decode("ascii"), "encoding": "base64"},
    )
    if st not in (200, 201):
        sys.exit(f"创建 blob 失败 {c['path']}：{st} {blob}")
    # 上传后校验：远程 blob 必须等于本地 git 对象库里的 SHA（autocrlf 一致性的硬校验）
    local_sha = git(["rev-parse", f"HEAD:{c['path']}"])
    if blob["sha"] != local_sha:
        sys.exit(
            f"blob 不一致（多半是 CRLF/LF 未对齐）：{c['path']}\n"
            f"  远程 {blob['sha']}\n  本地 {local_sha}"
        )
    tree_entries.append(
        {"path": c["path"], "mode": "100644", "type": "blob", "sha": blob["sha"]}
    )
    print(f"  blob {c['path']} -> {blob['sha'][:7]}  (与本地一致)")

# ---------- 4. 创建 tree ----------
st, tree = api(
    f"/repos/{OWNER}/{REPO}/git/trees",
    "POST",
    {"base_tree": base_tree, "tree": tree_entries},
)
if st not in (200, 201):
    sys.exit(f"创建 tree 失败：{st} {tree}")
print(f"  tree -> {tree['sha'][:7]}")

# ---------- 5. 创建 commit ----------
payload = {
    "message": message,
    "tree": tree["sha"],
    "parents": [remote_sha],
    "author": {
        "name": author_name,
        "email": author_email,
        "date": author_date,
    },
}
st, newc = api(f"/repos/{OWNER}/{REPO}/git/commits", "POST", payload)
if st not in (200, 201):
    sys.exit(f"创建 commit 失败：{st} {newc}")
print(f"  commit -> {newc['sha'][:7]}")

# ---------- 6. 更新 ref ----------
st, upd = api(
    f"/repos/{OWNER}/{REPO}/git/refs/heads/{BRANCH}",
    "PATCH",
    {"sha": newc["sha"], "force": False},
)
if st != 200:
    sys.exit(f"更新 ref 失败：{st} {upd}")
print(f"推送成功：{BRANCH} {remote_sha[:7]} -> {newc['sha'][:7]}")
print(f"URL: https://github.com/{OWNER}/{REPO}/commit/{newc['sha']}")
