import App from "./App.vue";
import router from "./router";
import { setupStore } from "@/store";
import { getPlatformConfig } from "./config";
import { MotionPlugin } from "@vueuse/motion";
import { useEcharts } from "@/plugins/echarts";
import { createApp, type Directive } from "vue";
import { useElementPlus } from "@/plugins/elementPlus";
import { injectResponsiveStorage } from "@/utils/responsive";
import { getToken } from "@/utils/auth";
import { useUserStoreHook } from "@/store/modules/user";

import Table from "@pureadmin/table";

// 引入重置样式
import "./style/reset.scss";
// 导入公共样式
import "./style/index.scss";
// 一定要在main.ts中导入tailwind.css，防止vite每次hmr都会请求src/style/index.scss整体css文件导致热更新慢的问题
import "./style/tailwind.css";
import "element-plus/dist/index.css";
// Element Plus 视觉重定义：必须晚于官方样式加载。
// 两者规则特异性相同，本文件靠"后加载"取胜，从而避免 !important 泛滥。
import "./style/element-plus-override.scss";
// 导入字体图标
import "./assets/iconfont/iconfont.js";
import "./assets/iconfont/iconfont.css";

const app = createApp(App);

// 自定义指令
import * as directives from "@/directives";
Object.keys(directives).forEach(key => {
  app.directive(key, (directives as { [key: string]: Directive })[key]);
});

// 全局注册@iconify/vue图标库
import {
  IconifyIconOffline,
  IconifyIconOnline,
  FontIcon
} from "./components/ReIcon";
app.component("IconifyIconOffline", IconifyIconOffline);
app.component("IconifyIconOnline", IconifyIconOnline);
app.component("FontIcon", FontIcon);

// 全局注册按钮级别权限组件
import { Auth } from "@/components/ReAuth";
import { Perms } from "@/components/RePerms";
app.component("Auth", Auth);
app.component("Perms", Perms);

// 全局注册vue-tippy
import "tippy.js/dist/tippy.css";
import "tippy.js/themes/light.css";
import VueTippy from "vue-tippy";
app.use(VueTippy);

getPlatformConfig(app).then(async config => {
  setupStore(app);
  app.use(router);
  await router.isReady();
  injectResponsiveStorage(app, config);
  app.use(MotionPlugin).use(useElementPlus).use(Table).use(useEcharts);
  app.mount("#app");

  // ---- 以下都是**挂载后**的异步补数据，一律不阻塞首屏（P2-13）----
  // 站点信息（机构名称 / Logo / 页脚）：登录页就要显示，但不能串在 mount 前面 ——
  // axios 超时是 10s，站点接口慢/不可达时整站会白屏 10s。
  // 先挂载，再异步拉取并补标题与图标；失败静默降级为内置默认值（各处已有回退）。
  const { useSiteStoreHook } = await import("@/store/modules/site");
  useSiteStoreHook()
    .fetch()
    .then(() => {
      useSiteStoreHook().applyDocumentTitle();
      useSiteStoreHook().applyFavicon();
    })
    .catch(() => {});

  // 已登录（刷新页面 / 多标签页打开）时补拉一次用户资料（P2-2）：
  // localStorage 快照可能落后于服务端（改过姓名/头像），失败由 store 内部静默。
  if (getToken()?.accessToken) useUserStoreHook().loadUserInfo();
});
