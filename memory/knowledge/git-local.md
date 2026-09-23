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
