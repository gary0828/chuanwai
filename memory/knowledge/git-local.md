---
inclusion: always
---

# 本机 git 与工具红线（L2 · 主题 · 常驻）

> 本机环境特有的坑，**违反会真的丢东西或卡死**。深读：`docs/03-开发指南/环境坑与工具.md`。

## ★★ K-028 · 禁用 `git rm`（2026-09-23 真实事故）

**本机的 `git rm` 会连带清空整个目录**：`git rm -f ai-workbench/Dockerfile ai-workbench/nginx.conf`
只报告删了 2 个文件，**实际把 `ai-workbench/` 34 个文件全部删除**（−10930 行，已推送到 gitee，后经恢复）。

**正确做法 —— 删文件走纯索引操作，不碰工作区：**

```bash
# ① 从索引移除（工作区文件仍在）
git update-index --force-remove <file>
# ② 工作区文件用 os.remove / del 删，不要用 git rm
# ③ 用低层对象直接造提交（可选）
git write-tree && git commit-tree <tree> -p <parent> -F msg && git update-ref refs/heads/main <c>
git reset --mixed HEAD          # 同步索引
```

**恢复被删文件：**
```bash
git checkout <good-commit> -- <path>      # checkout 是安全的
```

## ★★ K-039 · 推送凭据：非交互会话里 GCM 会**卡住或直接失败**（2026-09-23）

> **症状**：`git push gitee main` **挂住不动**（实测 >3 分钟零输出）或秒失败
> `fatal: could not read Username for 'https://gitee.com': terminal prompts disabled`。
> ★ 上一轮 G1+G2 交付就是**因为这一条卡住没推上去**（当时定性为"凭据不可用"），
> 别把它当"网络问题"重排一遍。

**已排除的**（别再重复排查）：网络通（`ls-remote` 秒回）、凭据确实存在
（Windows 凭据管理器 `LegacyGeneric:target=git:https://gitee.com`）。

**根因**：`~/.gitconfig` 用的是 PortableGit 的 **GCM**
（`credential.helper=…/git-credential-manager.exe` + `credential.https://gitee.com.provider=generic`）
→ 它在**非交互 shell 里取不到凭据**：要么等一个看不见的提示把命令挂死，要么直接 `terminal prompts disabled`。
★ 本机**没有 `wincred`**，换 helper 那条路走不通。

**可靠姿势（2026-09-23 实测 9 秒推成功）——先单独把凭据取出来，再用内联 helper 推：**

```bash
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy

CRED=$(printf "protocol=https\nhost=gitee.com\n\n" | GIT_TERMINAL_PROMPT=0 git credential-manager get)
GIT_USER=$(printf '%s\n' "$CRED" | sed -n 's/^username=//p')
GIT_PASS=$(printf '%s\n' "$CRED" | sed -n 's/^password=//p')

GIT_TERMINAL_PROMPT=0 GIT_USER="$GIT_USER" GIT_PASS="$GIT_PASS" \
timeout 180 git -c http.proxy= -c https.proxy= \
  -c credential.helper= \
  -c credential.helper='!f() { echo username=$GIT_USER; echo password=$GIT_PASS; }; f' \
  push gitee main
```

- **关键点**：`git credential-manager get` **单独调用能非交互取到**（它只是不能在 git 的交互流程里工作）；
  `-c credential.helper=`（空）**先清空 helper 列表**，再加自己的 —— 否则是按「追加」语义，GCM 仍会被调用。
- **安全**：凭据只经环境变量传递，**不写进 `.git/config`**（推完已 `grep` 核实为 0）；命令里也别 `echo` 密码。
- 备选：让用户在自己终端手动 `git push gitee main`（会弹 GCM 登录），成功后本机凭据即刷新。

**顺带一颗雷**：`~/.gitconfig` 的 `http.proxy = https.proxy = http://127.0.0.1:7890` 是**失效死代理**
→ **任何不带 `-c http.proxy=` 覆盖的远端操作都会失败**（K-024）。**建议直接删掉这两行**，不必每次靠覆盖绕过。

## ★ 被中断的命令会留孤儿 git 进程 + `.git/index.lock`

症状：后续所有 git 操作**静默失败** ——
`fatal: Unable to create '.git/index.lock': File exists`。

处置：先 `tasklist /FI "IMAGENAME eq git.exe"` 找 PID → `taskkill /F /PID <pid>` → 再删 `.git/index.lock`。

## K-024 · 推送（本机配了失效的死代理）

- 本机 git 配了 `http.proxy=127.0.0.1:7890`（已失效）→ 推送会卡死。**必须绕开：**
  ```bash
  git -c http.proxy= -c https.proxy= push gitee main
  ```
  同时清掉环境变量 `HTTP_PROXY` / `HTTPS_PROXY` / `http_proxy` / `https_proxy`。
- 推**公开**仓库前必扫敏感数据：`.env`、`*.db`（学员数据）、`evidence/`（截图）。
- 只推 **gitee**，不推 GitHub（用户 2026-09-23 拍板）。

## K-013 · `grep -r` + 通配符会静默返回空

据此下结论会**错得很自信**。改用专用工具（`rg` / 内置 Grep），并**用已知存在的样本先验证一次命令本身**。

## 清理临时文件的红线

**不要用 `_` 前缀做删除匹配** —— 会误删 `memory/knowledge/_index.md` 这类正常文件。
（2026-09-23 犯过；现在 `_index.md` 已纳入 check.mjs 的必备文件检查。）
