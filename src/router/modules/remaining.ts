const Layout = () => import("@/layout/index.vue");

export default [
  {
    path: "/login",
    name: "Login",
    component: () => import("@/views/login/index.vue"),
    meta: {
      title: "登录",
      showLink: false
    }
  },
  // 全屏403（无权访问）页面
  {
    path: "/access-denied",
    name: "AccessDenied",
    component: () => import("@/views/error/403.vue"),
    meta: {
      title: "403",
      showLink: false
    }
  },
  // 全屏500（服务器出错）页面
  {
    path: "/server-error",
    name: "ServerError",
    component: () => import("@/views/error/500.vue"),
    meta: {
      title: "500",
      showLink: false
    }
  },
  // AI 配置中心：**不出现在菜单里**，只能凭地址 /ai-admin 进入，且仅 admin 可见。
  // 放在 remaining（不参与菜单渲染）而非后端下发路由，就是为了保证它永远不会被下发成菜单项。
  {
    path: "/ai-admin",
    component: Layout,
    meta: {
      title: "AI 配置中心",
      showLink: false,
      roles: ["admin"]
    },
    children: [
      {
        path: "/ai-admin",
        name: "AiAdmin",
        component: () => import("@/views/ai-admin/index.vue"),
        meta: {
          title: "AI 配置中心",
          showLink: false,
          roles: ["admin"]
        }
      }
    ]
  },
  {
    path: "/redirect",
    component: Layout,
    meta: {
      title: "加载中...",
      showLink: false
    },
    children: [
      {
        path: "/redirect/:path(.*)",
        name: "Redirect",
        component: () => import("@/layout/redirect.vue")
      }
    ]
  }
] satisfies Array<RouteConfigsTable>;
