import Cookies from "js-cookie";
import { getConfig } from "@/config";
import NProgress from "@/utils/progress";
import { buildHierarchyTree } from "@/utils/tree";
import remainingRouter from "./modules/remaining";
import { useMultiTagsStoreHook } from "@/store/modules/multiTags";
import { usePermissionStoreHook } from "@/store/modules/permission";
import {
  isUrl,
  openLink,
  cloneDeep,
  isAllEmpty,
  storageLocal
} from "@pureadmin/utils";
import {
  ascending,
  getTopMenu,
  initRouter,
  isOneOfArray,
  getHistoryMode,
  findRouteByPath,
  handleAliveRoute,
  formatTwoStageRoutes,
  formatFlatteningRoutes
} from "./utils";
import {
  type Router,
  type RouteRecordRaw,
  type RouteComponent,
  createRouter
} from "vue-router";
import {
  type DataInfo,
  userKey,
  removeToken,
  multipleTabsKey
} from "@/utils/auth";

/** 自动导入全部静态路由，无需再手动引入！匹配 src/router/modules 目录（任何嵌套级别）中具有 .ts 扩展名的所有文件，除了 remaining.ts 文件
 * 如何匹配所有文件请看：https://github.com/mrmlnc/fast-glob#basic-syntax
 * 如何排除文件请看：https://cn.vitejs.dev/guide/features.html#negative-patterns
 */
const modules: Record<string, any> = import.meta.glob(
  ["./modules/**/*.ts", "!./modules/**/remaining.ts"],
  {
    eager: true
  }
);

/** 原始静态路由（未做任何处理） */
const routes = [];

Object.keys(modules).forEach(key => {
  routes.push(modules[key].default);
});

/** 导出处理后的静态路由（三级及以上的路由全部拍成二级） */
export const constantRoutes: Array<RouteRecordRaw> = formatTwoStageRoutes(
  formatFlatteningRoutes(buildHierarchyTree(ascending(routes.flat(Infinity))))
);

/** 初始的静态路由，用于退出登录时重置路由 */
const initConstantRoutes: Array<RouteRecordRaw> = cloneDeep(constantRoutes);

/** 用于渲染菜单，保持原始层级 */
export const constantMenus: Array<RouteComponent> = ascending(
  routes.flat(Infinity)
).concat(...remainingRouter);

/** 不参与菜单的路由 */
export const remainingPaths = Object.keys(remainingRouter).map(v => {
  return remainingRouter[v].path;
});

/** 创建路由实例 */
export const router: Router = createRouter({
  history: getHistoryMode(import.meta.env.VITE_ROUTER_HISTORY),
  routes: constantRoutes.concat(...(remainingRouter as any)),
  strict: true,
  scrollBehavior(to, from, savedPosition) {
    return new Promise(resolve => {
      if (savedPosition) {
        return savedPosition;
      } else {
        if (from.meta.saveSrollTop) {
          const top: number =
            document.documentElement.scrollTop || document.body.scrollTop;
          resolve({ left: 0, top });
        }
      }
    });
  }
});

/** 记录已经加载的页面路径 */
const loadedPaths = new Set<string>();

/** 重置已加载页面记录 */
export function resetLoadedPaths() {
  loadedPaths.clear();
}

/** 重置路由 */
export function resetRouter() {
  router.clearRoutes();
  for (const route of initConstantRoutes.concat(...(remainingRouter as any))) {
    router.addRoute(route);
  }
  router.options.routes = formatTwoStageRoutes(
    formatFlatteningRoutes(buildHierarchyTree(ascending(routes.flat(Infinity))))
  );
  usePermissionStoreHook().clearAllCachePage();
  resetLoadedPaths();
}

/** 路由白名单 */
const whiteList = ["/login"];

const { VITE_HIDE_HOME } = import.meta.env;

/**
 * ★ 动态路由只加载一次（2026-09-20 修复冷启动白屏）
 *
 * 背景：pure-admin 原设计把 `initRouter()` 放在「守卫的刷新分支」里，
 * 但**守卫只在 `to` 能匹配到已注册路由时才会执行**。因此直接打开一个
 * 尚未注册的动态路由（刷新页面 / 收藏夹 / 别人发的链接）时：
 *   to.matched = [] → 守卫根本不跑 → initRouter() 永不调用 → 永久白屏。
 * 表现：直达 /attendance/records 白屏，先到 /welcome 再点菜单则一切正常。
 *
 * 修法：把「确保动态路由已加载」提到守卫最前面，且与 to 是否匹配无关。
 * 用单例 Promise 去重，避免并发导航重复请求 /api/auth/async-routes。
 */
let asyncRoutesReady: Promise<void> | null = null;

/** 确保动态路由已注册（幂等，可并发调用） */
export function ensureAsyncRoutes(): Promise<void> {
  // 已登录且已加载过 → 直接返回
  if (asyncRoutesReady) return asyncRoutesReady;
  const userInfo = storageLocal().getItem<DataInfo<number>>(userKey);
  if (!Cookies.get(multipleTabsKey) || !userInfo) {
    // 未登录，不需要动态路由
    asyncRoutesReady = Promise.resolve();
    return asyncRoutesReady;
  }
  // ★ 失败必须允许重试：若把 rejected 的 Promise 缓存住，
  //   一次网络抖动（后端重启 / 请求被取消）就会让整个会话再也加载不出路由，
  //   用户只能手动刷新。因此失败时清空单例，下次导航自动重试。
  asyncRoutesReady = initRouter()
    .then(() => undefined)
    .catch(err => {
      asyncRoutesReady = null;
      throw err;
    });
  return asyncRoutesReady;
}

/**
 * 重置动态路由加载状态（登出 / 重新登录时调用）
 *
 * 场景：A 账号登出后 B 账号登录，若不清空单例，B 会直接复用 A 的加载结果
 * （`asyncRoutesReady` 已完成），导致 B 拿到的是 A 的菜单与路由。
 * `resetRouter()` 只重置了 vue-router 实例，没有重置这个 Promise 单例。
 */
export function resetAsyncRoutesState() {
  asyncRoutesReady = null;
}

router.beforeEach((to: ToRouteType, _from, next) => {
  to.meta.loaded = loadedPaths.has(to.path);

  if (!to.meta.loaded) {
    NProgress.start();
  }

  // ★ 第一优先：确保动态路由已加载。放在最前面，且不依赖 to 是否匹配，
  //   否则直达未注册路由时本守卫不会被触发（Vue Router 无匹配即不导航）。
  const userInfoEarly = storageLocal().getItem<DataInfo<number>>(userKey);
  if (
    Cookies.get(multipleTabsKey) &&
    userInfoEarly &&
    to.path !== "/login" &&
    usePermissionStoreHook().wholeMenus.length === 0
  ) {
    ensureAsyncRoutes().then(() => {
      // 路由注册完成后重新解析目标：此前 to.matched 可能为空
      const resolved = router.resolve(to.fullPath);
      next(resolved.matched.length ? { ...to, replace: true } : undefined);
    });
    return;
  }

  if (to.meta?.keepAlive) {
    handleAliveRoute(to, "add");
    // 页面整体刷新和点击标签页刷新
    if (_from.name === undefined || _from.name === "Redirect") {
      handleAliveRoute(to);
    }
  }
  const userInfo = storageLocal().getItem<DataInfo<number>>(userKey);
  const externalLink = isUrl(to?.name as string);
  if (!externalLink) {
    to.matched.some(item => {
      if (!item.meta.title) return "";
      const Title = getConfig().Title;
      if (Title) document.title = `${item.meta.title} | ${Title}`;
      else document.title = item.meta.title as string;
    });
  }
  /** 如果已经登录并存在登录信息后不能跳转到路由白名单，而是继续保持在当前页面 */
  function toCorrectRoute() {
    whiteList.includes(to.fullPath) ? next(_from.fullPath) : next();
  }
  if (Cookies.get(multipleTabsKey) && userInfo) {
    // 无权限跳转403页面
    // ★ 必须 return —— 否则会继续往下落到 toCorrectRoute() 再 next() 一次，
    //   同一导航里调用两次 next()，第二次将不再生效并触发 vue-router 警告，
    //   表现为「权限拦截偶发失效」。
    if (to.meta?.roles && !isOneOfArray(to.meta?.roles, userInfo?.roles)) {
      return next({ path: "/error/403" });
    }
    // 开启隐藏首页后在浏览器地址栏手动输入首页welcome路由则跳转到404页面
    if (VITE_HIDE_HOME === "true" && to.fullPath === "/welcome") {
      return next({ path: "/error/404" });
    }
    if (_from?.name) {
      // name为超链接
      if (externalLink) {
        openLink(to?.name as string);
        NProgress.done();
      } else {
        toCorrectRoute();
      }
    } else {
      // 刷新（动态路由已在守卫开头统一加载，此处只处理标签页与回落）
      if (usePermissionStoreHook().wholeMenus.length === 0 && to.path !== "/login") {
        // 兜底：正常情况下 ensureAsyncRoutes() 已在上方完成，这里不该再进来
        ensureAsyncRoutes().then(() => {
          if (isAllEmpty(to.name)) router.push(to.fullPath);
        });
      }
      toCorrectRoute();
    }
  } else {
    if (to.path !== "/login") {
      if (whiteList.indexOf(to.path) !== -1) {
        next();
      } else {
        removeToken();
        next({ path: "/login" });
      }
    } else {
      next();
    }
  }
});

router.afterEach(to => {
  loadedPaths.add(to.path);
  NProgress.done();
});

export default router;
