// 顶栏铃铛的展示类型。
//
// ★ 2026-09-21：原同级 `data.ts` 里的演示数据（"小铭 评论了你"、"开发多租户管理"等，
//   还带 3 个第三方 GitHub 图片外链）**已整份删除** —— 铃铛的数据一律来自后端 `/api/notices`。
//   本文件只保留类型定义，不含任何数据。
// ★ 2026-09-23（内容清点 C7）：原先的 `avatar?: string` 字段**已删除** —— 它从未被
//   数据组装方赋值（死字段），渲染层也一并移除；留着它等于给"把图片外链填回来"留了口子。

/** 一条可展示的铃铛条目（展示形状，与后端字段解耦） */
export interface ListItem {
  title: string;
  datetime: string;
  type: string;
  description: string;
  status?: "primary" | "success" | "warning" | "info" | "danger";
  extra?: string;
}

/** 一个分组（tab）。L1 只有「通知」；L2 会加「待办」。 */
export interface TabItem {
  key: string;
  name: string;
  list: ListItem[];
  emptyText: string;
}
