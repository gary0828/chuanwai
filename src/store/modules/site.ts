import { defineStore } from "pinia";
import { store } from "@/store";
import { getPublicSiteInfo, type SiteInfo } from "@/api/site";
import { getConfig } from "@/config";

/** 站点信息默认值：未配置时回退到构建期 platform-config.json 的 Title */
const EMPTY: SiteInfo = {
  "site.name": "",
  "site.title": "",
  "site.orgName": "",
  "site.sinceYear": "",
  "site.slogan": "",
  "site.contact": "",
  "site.address": "",
  "site.icp": "",
  "site.policeNo": "",
  "site.copyrightExtra": "",
  "site.logo": "",
  "site.favicon": ""
};

type SiteState = {
  info: SiteInfo;
  loaded: boolean;
  loading: Promise<SiteInfo> | null;
};

export const useSiteStore = defineStore("site", {
  state: (): SiteState => ({
    info: { ...EMPTY },
    loaded: false,
    loading: null
  }),

  getters: {
    /** 系统简称：优先 site.name，回退构建期 Title */
    name: state => state.info["site.name"] || getConfig().Title || "",

    /** 完整标题：优先 site.title，回退简称（再回退构建期 Title） */
    title: state => {
      const t = state.info["site.title"];
      if (t) return t;
      return state.info["site.name"] || getConfig().Title || "";
    },

    /** Logo 地址：优先上传的图，回退内置 /logo.svg */
    logo: state => {
      const url = state.info["site.logo"];
      if (!url) return new URL("/logo.svg", import.meta.url).href;
      // 后端返回的是 /assets/... 相对路径，开发环境需要指向后端
      return resolveAssetUrl(url);
    },

    favicon: state => {
      const url = state.info["site.favicon"];
      return url ? resolveAssetUrl(url) : "";
    },

    /** 是否配置了任何备案信息（决定页脚是否渲染备案行） */
    hasBeian: state =>
      Boolean(state.info["site.icp"] || state.info["site.policeNo"]),

    /** 机构全称：优先 site.orgName，回退简称 */
    orgName: state =>
      state.info["site.orgName"] || state.info["site.name"] || "",

    /** 版权年份区间：如 2020-2026；无起始年则只显示当前年 */
    copyrightYears: state => {
      const y = new Date().getFullYear();
      const since = state.info["site.sinceYear"];
      if (!since) return `${y}`;
      return since === String(y) ? `${y}` : `${since}-${y}`;
    }
  },

  actions: {
    /** 拉取站点信息（幂等：并发调用共享同一 Promise） */
    async fetch(): Promise<SiteInfo> {
      if (this.loaded) return this.info;
      if (this.loading) return this.loading;
      this.loading = getPublicSiteInfo()
        .then(res => {
          if (res?.success && res.data) {
            this.info = { ...EMPTY, ...res.data };
          }
          this.loaded = true;
          return this.info;
        })
        .catch(() => {
          // 取不到就用默认值，不能让页面挂掉
          this.loaded = true;
          return this.info;
        })
        .finally(() => {
          this.loading = null;
        });
      return this.loading;
    },

    /** 保存后本地即时更新（免重新请求） */
    setInfo(data: Partial<SiteInfo>) {
      this.info = { ...this.info, ...data };
      this.loaded = true;
      this.applyDocumentTitle();
    },

    /** 把标题写入浏览器标签页 */
    applyDocumentTitle() {
      if (this.title) document.title = this.title;
    },

    /** 把 favicon 写入 head */
    applyFavicon() {
      const url = this.favicon;
      if (!url) return;
      const links = document.querySelectorAll("link[rel*='icon']");
      if (links.length === 0) {
        const link = document.createElement("link");
        link.rel = "icon";
        link.href = url;
        document.head.appendChild(link);
        return;
      }
      links.forEach(el => el.setAttribute("href", url));
    }
  }
});

/** 资源地址解析：
 * 后端返回的是 `/assets/site/xxx.svg` 相对路径。
 * 生产环境前后端同源（nginx 反代 /api 与 /assets），直接用即可；
 * 开发环境 vite 已把 /assets 代理到后端，同样直接用。无需拼接 host。
 */
function resolveAssetUrl(url: string) {
  return url;
}

/** 在组件外（守卫 / 启动钩子）也能调用 */
export function useSiteStoreHook() {
  return useSiteStore(store);
}
