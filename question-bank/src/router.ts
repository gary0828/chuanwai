import { createRouter, createWebHashHistory } from "vue-router";

export interface NavItem {
  path: string;
  title: string;
  icon: string;
  desc?: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    path: "/",
    title: "题目库",
    icon: "~icons/ep/collection",
    desc: "录题 · 查题 · 改题"
  },
  {
    path: "/ocr",
    title: "AI 录题",
    icon: "~icons/ep/magic-stick",
    desc: "截图识别 · AI 出题"
  },
  {
    path: "/import",
    title: "批量导入",
    icon: "~icons/ep/upload",
    desc: "Excel 模板 · 导出"
  },
  {
    path: "/stats",
    title: "题库统计",
    icon: "~icons/ep/data-board",
    desc: "题型 · 来源 · 难度分布"
  },
  {
    path: "/taxonomy",
    title: "知识点与章节",
    icon: "~icons/ep/share",
    desc: "维护教学体系骨架"
  },
  {
    path: "/recycle",
    title: "回收站",
    icon: "~icons/ep/delete",
    desc: "恢复或彻底删除已删题目"
  }
];

export const router = createRouter({
  // hash 路由：挂 /qb/ 子路径下无需服务端配合（与工作台一致）
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      name: "questions",
      component: () => import("./views/QuestionList.vue"),
      meta: { title: "题目库" }
    },
    {
      path: "/ocr",
      name: "ocr",
      component: () => import("./views/AiCapture.vue"),
      meta: { title: "AI 录题" }
    },
    {
      path: "/import",
      name: "import",
      component: () => import("./views/BatchImport.vue"),
      meta: { title: "批量导入" }
    },
    {
      path: "/stats",
      name: "stats",
      component: () => import("./views/Stats.vue"),
      meta: { title: "题库统计" }
    },
    {
      path: "/taxonomy",
      name: "taxonomy",
      component: () => import("./views/Taxonomy.vue"),
      meta: { title: "知识点与章节" }
    },
    {
      path: "/recycle",
      name: "recycle",
      component: () => import("./views/Recycle.vue"),
      meta: { title: "回收站" }
    },
    {
      path: "/taxonomy",
      name: "taxonomy",
      component: () => import("./views/Taxonomy.vue"),
      meta: { title: "知识点与章节" }
    },
    {
      path: "/recycle",
      name: "recycle",
      component: () => import("./views/Recycle.vue"),
      meta: { title: "回收站" }
    },
    {
      path: "/sso",
      name: "sso",
      component: () => import("./views/Sso.vue"),
      meta: { title: "登录中" }
    },
    { path: "/:pathMatch(.*)*", redirect: "/" }
  ],
  scrollBehavior: () => ({ top: 0 })
});