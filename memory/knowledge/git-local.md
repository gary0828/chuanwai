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
>
> ✅ **2026-09-23 后记**：删掉死代理（见下方 K-024）后，**直接 `git push gitee main` 已实测成功**
> （`ls-remote` / `push --dry-run` / 真实 push 三条全绿，全程无 `-c` 覆盖）。
> **先试裸推**；只有真的挂住/报 `terminal prompts disabled` 时，才启用下面这套内联 helper 戏法。

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

~~**顺带一颗雷**：`~/.gitconfig` 的 `http.proxy = https.proxy = http://127.0.0.1:7890` 是**失效死代理**~~
→ ✅ **已于 2026-09-23 按用户要求删除**（见下方 K-024 顶部）。**不再需要任何 `-c http.proxy=` 覆盖。**

## ★ 被中断的命令会留孤儿 git 进程 + `.git/index.lock`

症状：后续所有 git 操作**静默失败** ——
`fatal: Unable to create '.git/index.lock': File exists`。

处置：先 `tasklist /FI "IMAGENAME eq git.exe"` 找 PID → `taskkill /F /PID <pid>` → 再删 `.git/index.lock`。

## K-024 · 推送（~~本机配了失效的死代理~~ → ✅ **已根治，2026-09-23**）

> ★ **这颗雷已经拆了，别再绕。** 用户原话：「删除掉那两个代理，确保以后不会再出现不能推送到 gitee 的情况」。
>
> **处置**（已执行，备份在 `~/.gitconfig.bak-20260923`）：
> ```bash
> cp ~/.gitconfig ~/.gitconfig.bak-20260923
> git config --global --unset http.proxy
> git config --global --unset https.proxy
> git config --global --get-regexp proxy   # 应无输出（exit=1）
> ```
> **根治后实测**（均**不带**任何 `-c` 覆盖）：
> - `git ls-remote --heads gitee` → exit=0，返回 `ea873ba… refs/heads/main`
> - `git push --dry-run gitee main` → exit=0，`Everything up-to-date`
> - 真实 `git push gitee main` → 成功（本次提交即证据）
>
> 因此：**下面的"绕法"和 K-039 的凭据戏法只在"GCM 恰好抽风"时才用得上，日常 push 直接 `git push gitee main` 即可。**

<details><summary>历史（死代理还在时的症状，仅供排查时对照）</summary>

- 本机 git 曾配 `http.proxy=127.0.0.1:7890`（已失效）→ 推送会卡死。**当时**必须绕开：
  ```bash
  git -c http.proxy= -c https.proxy= push gitee main
  ```
  同时清掉环境变量 `HTTP_PROXY` / `HTTPS_PROXY` / `http_proxy` / `https_proxy`。
- 不带覆盖时 `ls-remote` 直接报 `Failed to connect to gitee.com:443 over proxy 127.0.0.1 after 2059 ms`。
</details>

剩下仍然成立的两条**纪律**（与代理无关）：
- 推**公开**仓库前必扫敏感数据：`.env`、`*.db`（学员数据）、`evidence/`（截图）。
- 只推 **gitee**，不推 GitHub（用户 2026-09-23 拍板）。

### K-042 · 删完 git 配置代理后，**环境变量里还有一层**（2026-09-23 复查发现）

> 删掉 `http/https.proxy` 后仍**不能算彻底** —— 还有第二个来源：**环境变量**。

- 实测本机（Agent 会话内）**注入了 4 个**环境变量代理：
  `http_proxy` / `https_proxy` / `HTTP_PROXY` / `HTTPS_PROXY` = `http://127.0.0.1:14381`。
- **它是活的**（`netstat` 有 `LISTENING`），且**不在任何 shell 启动文件**
  （`~/.bashrc` `.bash_profile` `.profile` `.zshrc` `/etc/profile` **全查过，无**）→ 属**会话注入**，不是持久化配置。
- ★ **结论：直连本身是通的。** 决定性取证：
  ```bash
  env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy \
    git ls-remote gitee main      # exit=0 → 无代理也能连 gitee
  ```
- **真出问题时怎么查**（优先级从高到低）：
  1. `git config --global --get-regexp proxy`（**已确认清空**）
  2. `env | grep -i -E "^(http|https|all)_proxy"` ← **这一层还在，别漏**
  3. 用 `env -u …` 排除后再试，就能分清是"代理死了"还是"网不通"
- ⚠️ 若某天这 4 个变量还在、但 `14381` 那个监听没了 → 症状会和 K-024 一模一样
  （`Failed to connect … over proxy`）。**到时用 `env -u` 那一行即可自救。**

### K-024 补充 · 2026-09-23 晚推送失败的正确排查姿势（**省时间的，先看这里**）

> ⚠️ 本次**没先读本文件**，从零试了 8 轮并给出错误结论 → 立此四条。

- **死代理的影响面比原先记的更大**：**任何**不带 `-c http.proxy=` 覆盖的远端操作都会失败。
  实测：不带覆盖时 `ls-remote` 直接报
  `Failed to connect to gitee.com:443 over proxy 127.0.0.1 after 2059 ms`。
- **`git push --dry-run` 是分诊利器**：它完成认证 + 协商但**不传对象**。
  - 实测 **4 秒失败 exit=128** → 说明**不是网络卡住**（别往"网络慢/超时"方向查）
  - 对照 `ls-remote` **1.2 秒成功** → 说明直连与代理覆盖都没问题
- **凭据是好的，别再怀疑它**：
  ```bash
  printf 'protocol=https\nhost=gitee.com\n\n' | git -c http.proxy= -c https.proxy= credential fill
  ```
  能返回 `username=` + `password=`（GCM 正常）→ "GCM 取不到凭据"是**错误结论**。
- ★ **看不到报错 ≠ 没有报错**：**PowerShell 管道会吞掉 git 的 stderr**
  （`2>&1 | Out-String`、`*> file` 本次都捞不到）。
  诊断请用 **Bash 文件重定向**（`git ... > out.txt 2> err.txt`）或 `Start-Process -RedirectStandardError`。
- ✅ **2026-09-23 结案**：那条"未定论"的 push 失败，**根因就是死代理**（`127.0.0.1:7890` 连不通，
  git 拿不到远端 → 退化到要用户名 → `terminal prompts disabled`）。
  删掉代理后**同一环境裸推成功**，K-039 的"GCM 取不到凭据"是**错误的中间结论**（被 `credential fill` 证伪过一次，现在再证伪第二次）。
  **排查顺序记住：先看有没有代理，再查凭据。**

## K-013 · `grep -r` + 通配符会静默返回空

据此下结论会**错得很自信**。改用专用工具（`rg` / 内置 Grep），并**用已知存在的样本先验证一次命令本身**。

## 清理临时文件的红线

**不要用 `_` 前缀做删除匹配** —— 会误删 `memory/knowledge/_index.md` 这类正常文件。
（2026-09-23 犯过；现在 `_index.md` 已纳入 check.mjs 的必备文件检查。）
