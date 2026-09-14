import { createRouter, createWebHashHistory } from "vue-router";

export interface NavItem {
  path: string;
  title: string;
  icon: string;
  desc?: string;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

/** 侧边栏导航：按教学闭环分组，而不是功能堆页 */
export const NAV_GROUPS: NavGroup[] = [
  {
    group: "教学闭环",
    items: [
      {
        path: "/",
        title: "当前单元行动台",
        icon: "~icons/ep/data-board",
        desc: "现在教到哪、下节准备什么"
      },
      {
        path: "/course",
        title: "课程设计",
        icon: "~icons/ep/files",
        desc: "学段目标 × 单元结构"
      },
      {
        path: "/lesson",
        title: "备课方案",
        icon: "~icons/ep/edit-pen",
        desc: "教案初稿与一致性检查"
      },
      {
        path: "/teaching",
        title: "授课流程",
        icon: "~icons/ep/clock",
        desc: "课堂环节与快捷工具"
      }
    ]
  },
  {
    group: "作业与评价",
    items: [
      {
        path: "/homework",
        title: "作业设计",
        icon: "~icons/ep/tickets",
        desc: "分层作业与题源"
      },
      {
        path: "/evaluation",
        title: "作业检查与评价",
        icon: "~icons/ep/circle-check",
        desc: "批改建议与错因归集"
      }
    ]
  },
  {
    group: "学情与家校",
    items: [
      {
        path: "/report",
        title: "学习分析与报告",
        icon: "~icons/ep/trend-charts",
        desc: "学情诊断与 PDF 产出"
      },
      {
        path: "/parent",
        title: "家长反馈",
        icon: "~icons/ep/chat-dot-round",
        desc: "沟通文案与可导出版"
      }
    ]
  },
  {
    group: "支撑",
    items: [
      {
        path: "/knowledge",
        title: "AI 知识库",
        icon: "~icons/ep/collection",
        desc: "教材 · 题目 · 知识点"
      },
      {
        path: "/settings",
        title: "底座与设置",
        icon: "~icons/ep/setting",
        desc: "规则引擎 / Dify 切换"
      }
    ]
  }
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      name: "dashboard",
      component: () => import("./views/Dashboard.vue"),
      meta: { title: "当前单元行动台" }
    },
    {
      path: "/course",
      name: "course",
      component: () => import("./views/CourseDesign.vue"),
      meta: { title: "课程设计" }
    },
    {
      path: "/lesson",
      name: "lesson",
      component: () => import("./views/LessonPlan.vue"),
      meta: { title: "备课方案" }
    },
    {
      path: "/teaching",
      name: "teaching",
      component: () => import("./views/Teaching.vue"),
      meta: { title: "授课流程" }
    },
    {
      path: "/homework",
      name: "homework",
      component: () => import("./views/Homework.vue"),
      meta: { title: "作业设计" }
    },
    {
      path: "/evaluation",
      name: "evaluation",
      component: () => import("./views/Evaluation.vue"),
      meta: { title: "作业检查与评价" }
    },
    {
      path: "/report",
      name: "report",
      component: () => import("./views/Report.vue"),
      meta: { title: "学习分析与报告" }
    },
    {
      path: "/parent",
      name: "parent",
      component: () => import("./views/ParentFeedback.vue"),
      meta: { title: "家长反馈" }
    },
    {
      path: "/knowledge",
      name: "knowledge",
      component: () => import("./views/Knowledge.vue"),
      meta: { title: "AI 知识库" }
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("./views/Settings.vue"),
      meta: { title: "底座与设置" }
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
