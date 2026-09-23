import { defineStore } from "pinia";
import {
  type userType,
  store,
  router,
  resetRouter,
  routerArrays,
  storageLocal
} from "../utils";
import { resetAsyncRoutesState } from "@/router";
import {
  type UserResult,
  type RefreshTokenResult,
  getLogin,
  refreshTokenApi,
  logoutApi
} from "@/api/user";
import { useMultiTagsStoreHook } from "./multiTags";
import {
  type DataInfo,
  setToken,
  getToken,
  formatToken,
  removeToken,
  userKey
} from "@/utils/auth";

export const useUserStore = defineStore("pure-user", {
  state: (): userType => ({
    // 头像
    avatar: storageLocal().getItem<DataInfo<number>>(userKey)?.avatar ?? "",
    // 用户名
    username: storageLocal().getItem<DataInfo<number>>(userKey)?.username ?? "",
    // 昵称
    nickname: storageLocal().getItem<DataInfo<number>>(userKey)?.nickname ?? "",
    // 页面级别权限
    roles: storageLocal().getItem<DataInfo<number>>(userKey)?.roles ?? [],
    // 按钮级别权限
    permissions:
      storageLocal().getItem<DataInfo<number>>(userKey)?.permissions ?? [],
    // 是否勾选了登录页的免登录
    isRemembered: false,
    // 登录页的免登录存储几天，默认7天
    loginDay: 7
  }),
  actions: {
    /** 存储头像 */
    SET_AVATAR(avatar: string) {
      this.avatar = avatar;
    },
    /** 存储用户名 */
    SET_USERNAME(username: string) {
      this.username = username;
    },
    /** 存储昵称 */
    SET_NICKNAME(nickname: string) {
      this.nickname = nickname;
    },
    /** 存储角色 */
    SET_ROLES(roles: Array<string>) {
      this.roles = roles;
    },
    /** 存储按钮级别权限 */
    SET_PERMS(permissions: Array<string>) {
      this.permissions = permissions;
    },
    /** 存储是否勾选了登录页的免登录 */
    SET_ISREMEMBERED(bool: boolean) {
      this.isRemembered = bool;
    },
    /** 设置登录页的免登录存储几天 */
    SET_LOGINDAY(value: number) {
      this.loginDay = Number(value);
    },
    /** 登入 */
    async loginByUsername(data) {
      return new Promise<UserResult>((resolve, reject) => {
        getLogin(data)
          .then(data => {
            if (data?.success) setToken(data.data);
            resolve(data);
          })
          .catch(error => {
            reject(error);
          });
      });
    },
    /**
     * 仅清理本地登录态并回登录页（**不通知服务端**）。
     *
     * 用途：凭证**已经在服务端被吊销**的场景 —— 目前是「自助改密码之后」。
     * 那种情况下再调 `/api/auth/logout` 必然拿到 401，
     * 而 401 会走全局 `handleAuthFailure` 弹出红色「登录状态已失效」——
     * 用户刚改密成功却看到报错（2026-09-23 代码审查发现的 UX 缺陷）。
     */
    resetLoginState() {
      this.username = "";
      this.roles = [];
      this.permissions = [];
      removeToken();
      useMultiTagsStoreHook().handleTags("equal", [...routerArrays]);
      resetRouter();
      // ★ 同时重置「动态路由已加载」单例：否则换账号登录（如 admin→teacher）
      //   会复用上一个账号的菜单与路由，导致越权可见或菜单缺失。
      resetAsyncRoutesState();
      router.push("/login");
    },
    /** 登出：通知服务端吊销凭证（best-effort）后清理本地状态 */
    logOut() {
      // 先读取当前 token 并显式带上，避免清理本地凭证后请求取不到 Authorization
      const accessToken = getToken()?.accessToken;
      if (accessToken) {
        logoutApi(formatToken(accessToken)).catch(() => {});
      }
      this.resetLoginState();
    },
    /** 刷新`token`（失败时 reject，避免调用方永久等待） */
    async handRefreshToken(data) {
      return new Promise<RefreshTokenResult>((resolve, reject) => {
        refreshTokenApi(data)
          .then(data => {
            if (data?.data?.accessToken) {
              setToken(data.data);
              resolve(data);
            } else {
              reject(new Error("刷新登录态失败"));
            }
          })
          .catch(error => {
            reject(error);
          });
      });
    }
  }
});

export function useUserStoreHook() {
  return useUserStore(store);
}
