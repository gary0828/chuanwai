---
name: testing-and-verification
description: 在本项目写验证脚本、加断言、或用浏览器实证前必须加载。核心六条：① 绝不写"失败态也算通过"的空断言（曾掩盖 /assets 404 的严重 bug）② 权限类功能必须 admin/teacher 双角色对照（只测 admin 会漏整类问题）③ 静态资源问题不能只看根路径（/ 200 但白屏 = JS 404）④ 扫"裸露原生控件"要排除 Element Plus 内部结构 ⑤ 扫代码必须用 ripgrep（shell 的 grep -r 在本环境会静默返回空，据此得出过错误结论）⑥ 测试全绿不等于没问题，先审断言再审被测物。含 Playwright 注入 pure-admin 登录态的正确姿势。触发词：写测试、加断言、验证脚本、Playwright、浏览器实证、权限验证、测试全绿但有问题。
description_zh: 写验证与断言的强制铁律（空断言/双角色对照/静态资源/ripgrep）
agent_created: true
---

# 测试与验证铁律

## 何时用

- 要写/改验证脚本（`_verify_test/`）
- 要加断言
- 要用 Playwright 做浏览器实证
- **测试全绿但用户说"不对"** —— 先来这里审断言

---

## ★★ 六条铁律

### 1. 绝不写「失败态也算通过」的断言

实录：`side_ok is True or side_ok is None` —— `None`（元素根本没找到）被当通过 = **空断言**，
直接掩盖了 `/assets` 404 的严重 bug。

改成**三态**：找不到 → **明确报失败**；找到但值不对 → 失败。
**推论：测试全绿 ≠ 没问题。先审断言，再审被测物。**

### 2. 权限类功能必须「双角色对照」

同一页分别以 **admin / teacher** 登录，断言**看到的与看不到的都对**
（列表可见范围、专属控件的有无）。

> **"我用管理员测过了"不等于权限没问题。**
> （2026-09-21 由用户点出才补上教师侧测试）

参考：`_verify_test/ui-todos-teacher.py`

### 3. 静态资源问题不能只看根路径

`/` 返回 200 但页面白屏 = **JS 404**。
断言里必须包含「**入口 JS 可获取**」+「**无 requestfailed**」，别只断言页面标题存在。

### 4. 排除 Element Plus 内部结构

radio/checkbox/select 内部都有隐藏原生 `<input>`（如 `.el-radio-button__original-radio`）。
扫"有没有裸露原生控件"时要**排除 `.el-*` 内部**，否则必然误报。

### 5. 扫代码必须用 ripgrep（Grep 工具）

**shell 的 `grep -r` + 通配符在本环境会静默返回空** —— 我据此得出过错误结论
「工作台不用 Element Plus」，实际相反。
**"扫不到"要先怀疑命令，再下结论。**

### 6. 测试脚本自身的坑

跨多次请求时，辅助字段要**每次重新计算**（如给响应对象挂的 `owner` 属性，
第二次请求的对象上没有 → 误判失败）。

---

## Playwright 注入 pure-admin 登录态（三者缺一不可）

```
Cookie: authorized-token
Cookie: multiple-tabs
localStorage: user-info   ← 裸 key，无 `pure-` 前缀
```

**症状**：cookie 注入成功 → 3 秒后变空。
根因：SPA 引导时读不到 `user-info` → 走 else `removeToken()` **把刚注入的 cookie 一并清掉**。

★ **登录页有 canvas 验证码 → 自动化只能走接口登录 + 凭证注入**
（`_verify_test/ui-site-info.py` 有完整实现；注意 `expires` 是 `YYYY/MM/DD HH:MM:SS`，要转毫秒）。

## 造数与清理

- 造数脚本跑完**必须 `docker restart attendance-server`**
- 清理测试数据后**必须 `PRAGMA wal_checkpoint(TRUNCATE)`**，否则重启后复活
- 临时改阈值/数据做验证 → **先备份值，验完还原并复核**

## 现有脚本

见 `docs/conventions/05-测试与验证.md` 的清单与 `docs/conventions/06-环境坑与工具.md` 的运行命令。

## 相关

- `docs/conventions/05-测试与验证.md`（权威）
- `docs/conventions/04-权限模型.md`（要验什么）
- `docs/conventions/03-部署与nginx.md`（白屏排查）
