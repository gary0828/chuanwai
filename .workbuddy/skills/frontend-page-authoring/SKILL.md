---
name: frontend-page-authoring
description: 在本项目新增或修改任何前端页面前必须加载。教务端（src/）与 AI 工作台（ai-workbench/src/）**都用 Element Plus**，但外壳与 CSS 变量完全不同 —— 看错会写出与全站割裂的页面。本 skill 给出"动手前必读哪篇约定 + 逐项自查清单"，覆盖：两端骨架差异、工作台 CSS 变量是 --c-*（不是 --brand/--line）、表单用 .form-row、列表用 .rec-head/.rec-row（工作台不用 el-table）、新增页面前必须先照抄 2–3 个同类页面。触发词：新增页面、改页面、写组件、表单、列表、样式不对、页面像白板、Element Plus、pure-admin、CSS 变量。
description_zh: 新增/修改前端页面前的强制约定与自查清单（两端差异 + CSS 变量 + 照抄同类页面）
agent_created: true
---

# 前端页面编写约定

## 何时用

- 要**新增**任何页面、组件、表单、列表
- 要**改**现有页面的结构或样式
- 发现新页面"观感与全站不一致"（像没样式的白板）

---

## 第 0 步：先读（必读，别跳过）

**`docs/conventions/01-前端两端差异.md`**

核心要点（详见文档，这里只是提醒）：

- 两端**都用 Element Plus**，但只有教务端有 pure-admin 壳
- 工作台 CSS 变量是 **`--c-*`**（`--c-primary`/`--c-border`/`--c-danger`/`--c-text-2`…）
  写成 `--brand`/`--line` **不报错、只是静默失效**
- 教务端骨架：`.app-page` + `AppPageHeader` + `.page-card` + `.page-toolbar`
- 工作台外壳：`.card`/`.card-head`/`.card-title`/`.card-sub`/`.card-body`/`.tag`/`.empty`/`.tip`
- 工作台表单用 **`.form-row`**（`grid: 180px 1fr`），列表用 **`.rec-head`/`.rec-row` grid**
  （**工作台不用 `el-table`**）

## ★★ 第 1 步：先打开 2–3 个同类页面照抄

动手前必须回答：**"我要写的这个控件，项目里已经有别的地方在用吗？用的哪个组件？"**

- 教务端页面 → 看同级 `src/views/**/index.vue`（如 `system/notices/index.vue`）
- 工作台页面 → 看 **`ai-workbench/src/views/Settings.vue`**（表单标准写法）
  和 `Teaching.vue`（采集表单）

> **反面教材**：`ai-workbench/src/views/Todos.vue` 初版用了原生 `<input>/<select>`，
> 全工作台只此一页 → 整页像"没样式的白板"。**自己发明一套 = 与全站割裂。**

## 第 2 步：自查清单（改完逐项过）

- [ ] 控件用的是 `el-*`，**没有**裸露的 `<input>/<select>/<textarea>`
  （原生 `<button class="ghost-btn/mini-btn">` 在工作台是既有惯例，可用）
- [ ] scoped CSS 里的 `var(--xxx)` **都真实存在**（grep 一遍 `styles.css`）
- [ ] 排版抄的是**同端**的页面，没把教务端骨架搬进工作台（或反之）
- [ ] 颜色没硬编码（教务端走 `tokens.scss`，工作台走 `--c-*`）
- [ ] 空状态有内容且说明了下一步（工作台用 `.empty`）
- [ ] 构建通过 + 浏览器实证（**不要只跑沙箱**）

## 常见误判

| 现象 | 真因 |
|---|---|
| 新页面"没样式" | 90% 是用了原生控件 **或** CSS 变量写了不存在的名字 |
| 工作台页面空白 | 先怀疑 **nginx 静态资源 404**（见 `03-部署与nginx.md`），不是代码 |
| 教务端正常、工作台不对 | 两端外壳/变量不同，**别互相照搬** |

## 相关

- `docs/conventions/01-前端两端差异.md`（权威）
- `docs/conventions/05-测试与验证.md`（怎么验）
- `docs/conventions/03-部署与nginx.md`（白屏排查）
