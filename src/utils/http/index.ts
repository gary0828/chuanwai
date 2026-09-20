import Axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type CustomParamsSerializer
} from "axios";
import type {
  PureHttpError,
  RequestMethods,
  PureHttpResponse,
  PureHttpRequestConfig
} from "./types.d";
import { stringify } from "qs";
import { getToken, formatToken } from "@/utils/auth";
import { useUserStoreHook } from "@/store/modules/user";
import { ElMessage } from "element-plus";

// 相关配置请参考：www.axios-js.com/zh-cn/docs/#axios-request-config-1
const defaultConfig: AxiosRequestConfig = {
  // 请求超时时间
  timeout: 10000,
  headers: {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest"
  },
  // 数组格式参数序列化（https://github.com/axios/axios/issues/5142）
  paramsSerializer: {
    serialize: stringify as unknown as CustomParamsSerializer
  }
};

/** 暂存等待新 token 的请求：刷新成功则放行，失败则一并 reject（不再永久挂起） */
type PendingRequest = {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
};

class PureHttp {
  constructor() {
    this.httpInterceptorsRequest();
    this.httpInterceptorsResponse();
  }

  /** `token`过期后，暂存待执行的请求 */
  private static requests: PendingRequest[] = [];

  /** 防止重复刷新`token` */
  private static isRefreshing = false;

  /** 本页是否已提示过「登录态失效」，避免反复弹提示 */
  private static didNotifyAuthFailure = false;

  /** 初始化配置对象 */
  private static initConfig: PureHttpRequestConfig = {};

  /** 保存当前`Axios`实例对象 */
  private static axiosInstance: AxiosInstance = Axios.create(defaultConfig);

  /**
   * 登录态失效的统一处理：拒绝所有挂起请求 → 清理凭证 → 跳转登录页
   *
   * 修复背景（2026-09-12 上线门禁 H1）：原实现刷新失败时既不 reject 挂起队列，
   * 也没有 401 → 跳登录逻辑，导致 token 真失效时所有请求永久 pending，
   * 用户看到的是「界面卡死」而不是「请重新登录」。
   */
  private static handleAuthFailure(message = "登录状态已失效，请重新登录") {
    const error = new Error(message);
    PureHttp.requests.forEach(item => item.reject(error));
    PureHttp.requests = [];
    PureHttp.isRefreshing = false;
    // 标记置位后不再复位：一次登录态失效只需提示一次，
    // 否则跳转登录页停留期间仍会有请求失败、反复弹出同类提示。
    if (PureHttp.didNotifyAuthFailure) return;
    PureHttp.didNotifyAuthFailure = true;
    ElMessage.error(message);
    try {
      useUserStoreHook().logOut();
    } catch {
      // 兜底：store 尚未就绪时直接跳登录页（本项目使用 hash 路由）
      window.location.href = "/#/login";
    }
  }

  /** 重连原始请求（刷新成功放行；刷新失败时由 handleAuthFailure 统一 reject） */
  private static retryOriginalRequest(config: PureHttpRequestConfig) {
    return new Promise((resolve, reject) => {
      PureHttp.requests.push({
        resolve: (token: string) => {
          config.headers["Authorization"] = formatToken(token);
          resolve(config);
        },
        reject
      });
    });
  }

  /** 请求拦截 */
  private httpInterceptorsRequest(): void {
    PureHttp.axiosInstance.interceptors.request.use(
      async (config: PureHttpRequestConfig): Promise<any> => {
        // 优先判断post/get等方法是否传入回调，否则执行初始化设置等回调
        if (typeof config.beforeRequestCallback === "function") {
          config.beforeRequestCallback(config);
          return config;
        }
        if (PureHttp.initConfig.beforeRequestCallback) {
          PureHttp.initConfig.beforeRequestCallback(config);
          return config;
        }
        /** 请求白名单，放置一些不需要`token`的接口（通过设置请求白名单，防止`token`过期后再请求造成的死循环问题）
         *  /logout 也在此列：登出由调用方显式传入 Authorization，且需在清理本地凭证前发出，
         *  不能让拦截器再去读（可能已被清理的）本地 token，否则会触发无意义的 401。 */
        const whiteList = ["/refresh-token", "/login", "/logout"];
        return whiteList.some(url => config.url?.endsWith(url))
          ? config
          : new Promise(resolve => {
              const data = getToken();
              if (data) {
                const now = new Date().getTime();
                // expires 为日期字符串（如 '2026/08/19 18:21:22'），此处统一转为时间戳判断
                const expired = new Date(data.expires).getTime() - now <= 0;
                if (expired) {
                  if (!PureHttp.isRefreshing) {
                    PureHttp.isRefreshing = true;
                    // token过期刷新
                    useUserStoreHook()
                      .handRefreshToken({ refreshToken: data.refreshToken })
                      .then(res => {
                        const token = res?.data?.accessToken;
                        if (!token) throw new Error("刷新登录态失败");
                        config.headers["Authorization"] = formatToken(token);
                        // 放行所有等待中的请求
                        PureHttp.requests.forEach(item => item.resolve(token));
                        PureHttp.requests = [];
                      })
                      .catch(() => {
                        // 刷新失败：拒绝挂起队列并跳登录，避免请求永久挂起
                        PureHttp.handleAuthFailure();
                      })
                      .finally(() => {
                        PureHttp.isRefreshing = false;
                      });
                  }
                  resolve(PureHttp.retryOriginalRequest(config));
                } else {
                  config.headers["Authorization"] = formatToken(
                    data.accessToken
                  );
                  resolve(config);
                }
              } else {
                resolve(config);
              }
            });
      },
      error => {
        return Promise.reject(error);
      }
    );
  }

  /** 响应拦截 */
  private httpInterceptorsResponse(): void {
    const instance = PureHttp.axiosInstance;
    instance.interceptors.response.use(
      (response: PureHttpResponse) => {
        const $config = response.config;
        // 优先判断post/get等方法是否传入回调，否则执行初始化设置等回调
        if (typeof $config.beforeResponseCallback === "function") {
          $config.beforeResponseCallback(response);
          return response.data;
        }
        if (PureHttp.initConfig.beforeResponseCallback) {
          PureHttp.initConfig.beforeResponseCallback(response);
          return response.data;
        }
        return response.data;
      },
      (error: PureHttpError) => {
        const $error = error;
        $error.isCancelRequest = Axios.isCancel($error);
        // 请求被主动取消（如切换页面）不算错误，静默处理
        if ($error.isCancelRequest) return Promise.reject($error);

        const status = $error?.response?.status;
        const backendMessage = $error?.response?.data?.message;

        if (status === 401) {
          // 凭证失效 / 已被吊销（登出、改密、改角色）→ 统一清理并跳登录
          PureHttp.handleAuthFailure(backendMessage);
          return Promise.reject($error);
        }

        // 统一把后端 message 提升为可读文案，供视图层直接展示
        const readable =
          backendMessage ||
          (status === 403
            ? "无权限执行该操作"
            : status === 404
              ? "请求的资源不存在"
              : status >= 500
                ? "服务器开小差了，请稍后重试"
                : $error.message || "请求失败，请检查网络后重试");
        $error.message = readable;
        // 全局提示：大量视图以 catch(() => {}) 静默吞错，此处兜底保证用户能感知失败
        ElMessage.error(readable);
        return Promise.reject($error);
      }
    );
  }

  /** 通用请求工具函数 */
  public request<T>(
    method: RequestMethods,
    url: string,
    param?: AxiosRequestConfig,
    axiosConfig?: PureHttpRequestConfig
  ): Promise<T> {
    const config = {
      method,
      url,
      ...param,
      ...axiosConfig
    } as PureHttpRequestConfig;

    // 单独处理自定义请求/响应回调
    return new Promise((resolve, reject) => {
      PureHttp.axiosInstance
        .request(config)
        .then((response: undefined) => {
          resolve(response);
        })
        .catch(error => {
          reject(error);
        });
    });
  }

  /** 单独抽离的`post`工具函数 */
  public post<T, P>(
    url: string,
    params?: AxiosRequestConfig<P>,
    config?: PureHttpRequestConfig
  ): Promise<T> {
    return this.request<T>("post", url, params, config);
  }

  /** 单独抽离的`get`工具函数 */
  public get<T, P>(
    url: string,
    params?: AxiosRequestConfig<P>,
    config?: PureHttpRequestConfig
  ): Promise<T> {
    return this.request<T>("get", url, params, config);
  }
}

export const http = new PureHttp();
