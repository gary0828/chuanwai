---
title: pure-admin 官方规范
status: active
updated: 2026-09-21
---

# pure-admin 官方规范

> 本项目基于 **pure-admin-thin** 官方模板。所有前端开发必须遵循官方文档与代码规范：
> **不自行发明轮子、不偏离官方写法、不随意修改框架核心文件**。遇到不确定的写法，先查官方文档再动手。

---

## 1. 官方文档入口

| 文档 | 地址 | 用途 |
| --- | --- | --- |
| 官方文档首页 | https://pure-admin.cn/ | 所有指南入口 |
| 路由和菜单 | https://pure-admin.cn/pages/routerMenu/ | 路由与菜单配置 |
| RBAC 权限 | https://pure-admin.cn/pages/RBAC/ | 页面级 / 按钮级权限 |
| HTTP 请求 | https://pure-admin.cn/pages/httpRequest/ | axios 封装、接口调用 |
| 目录结构 | https://pure-admin.cn/pages/directoryStructure/ | 目录规范 |
| 打包部署 | https://pure-admin.cn/pages/buildDeploy/ | Docker / nginx 部署 |

---

## 2. 路由与菜单

- 路由配置遵循官方 `RouteConfigsTable` 接口定义，包含 `path`、`name`、`meta` 等字段。
- `name` 必须唯一，且与组件 `defineOptions` 的 `name` 一致。
- 页面级权限用 `meta.roles`，按钮级用 `meta.auths`。
- 静态路由写在 `src/router/modules/`；动态路由由后端下发，前端用 `filterNoPermissionTree` 过滤。
- **禁止**在 template 中使用 `$route` / `$router`，必须用 `useRoute` / `useRouter`。

## 3. 接口封装（`src/api/`）

- 所有接口集中在 `src/api/`，按业务模块分文件。
- 必须用官方 `http` 封装（`import { http } from "@/utils/http"`），**禁止**直接用 axios。
- 每个接口必须定义返回类型；命名 `getXxx` / `addXxx` / `updateXxx` / `deleteXxx`。

```typescript
import { http } from "@/utils/http";

export type StudentResult = {
  success: boolean;
  data: { id: number; name: string; classId: number };
};

export const getStudentList = (params?: object) => {
  return http.request<StudentResult>("get", "/api/students", { params });
};
```

## 4. 状态管理（Pinia）

- 已有 store：`user` / `app` / `permission` / `multiTags` / `epTheme` / `settings`。
- 新增业务状态优先并入已有 store 或新建独立 store 文件，**禁止**在组件内创建全局状态。
- 持久化用官方 `storageLocal`，**禁止**直接操作 localStorage。

## 5. 组件使用

- 优先使用内置组件（`@pureadmin/table`、`ReIcon`、`ReDialog`、`ReDrawer`、`ReAuth`）。
- 表格统一 `@pureadmin/table`，支持 `cellRenderer` / `headerRenderer`。
- 弹窗 / 抽屉用 `ReDialog` / `ReDrawer`，不要直接用 `ElDialog`。
- 图标用 `ReIcon` 或 `useRenderIcon`；按钮级权限用 `ReAuth` 或 `v-auth`。

## 6. 样式

- 用 TailwindCSS 编写，遵循功能类优先；**禁止**大段自定义 CSS。
- 覆盖 Element Plus 用官方主题变量或 `:deep()`；响应式用 Tailwind 断点类。
- 颜色 / 间距 / 圆角一律引用 `src/style/tokens.scss`，页面内**禁止硬编码色值**。详见 [前端视觉规范](前端视觉规范.md)。

## 7. 环境变量

- 自定义变量必须以 `VITE_` 开头；文件放项目根目录（`.env` / `.env.development` / `.env.production`）。
- 改完必须重启 dev server。

## 8. 代码质量

- 已配置 ESLint + Prettier + Stylelint + commitlint。
- 提交前必须通过 `pnpm lint`；提交信息遵循 `feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`。
- **禁止**绕过 lint 提交。

---

## 9. 禁止事项

- ❌ 修改 `src/router/index.ts`、`src/store/modules/user.ts` 等框架核心文件（除非官方明确允许）。
- ❌ 删除或覆盖 `src/utils/http/` 的封装逻辑。
- ❌ 业务代码中直接引入 axios、直接操作 localStorage、直接用 `$route` / `$router`。
- ❌ 自造新的路由 / 权限 / 接口封装方式。
- ❌ 未查官方文档就凭记忆写 pure-admin 代码。

## 10. 不确定时的处理顺序

1. 查官方文档 https://pure-admin.cn/
2. 查官方 GitHub 仓库 `src/views/` 下的示例页面
3. 查 `@pureadmin/utils` 是否已有现成函数
4. 都没有 → 选最接近官方风格的方案实现，**不要自己发明**，并在日志里记录

## 11. 规范落地判定（实测结论，勿重复踩坑）

| 规范条目 | 官方设计意图 | 本项目做法 |
| --- | --- | --- |
| `ReDialog` / `ReDrawer` | 基于 Element Plus 二次封装的**函数式弹框**（`addDialog({...})` + `contentRenderer`） | 函数式弹窗必须用 `addDialog`；模板内 `v-model` 简单表单沿用 `<el-dialog>` 允许，但**新增**复杂弹窗优先函数式。`src/components/ReDialog/index.vue` **禁止改动** |
| `http` 封装 | 统一走 `src/utils/http` | 全部接口集中在 `src/api/*.ts`；`src/views/**` 内零 axios、零 `http.request` 直调 |
| `$route` / `$router` | 组合式 API 优先 | `src/views/**` 内零 `$route` / `$router` / `localStorage` 直用 |
| `@pureadmin/table` | 表格统一官方组件 | 列表页沿用当前实现；**新增**列表页必须用 `@pureadmin/table` |
| 环境变量 | 必须以 `VITE_` 开头 | 已全部合规（`VITE_PORT` / `VITE_PUBLIC_PATH` / `VITE_ROUTER_HISTORY` / `VITE_CDN` / `VITE_COMPRESSION`） |
