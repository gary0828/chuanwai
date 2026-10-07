/**
 * 会话（免登链路）
 *
 * 链路：教务系统已登录 → 签一次性票据 → 跳到题库 /#/sso?ticket=xxx
 *       → 题库 POST /api/ai/sso/verify 换会话 + `qb_agent` 凭证。
 *
 * ★ 为什么凭证类型是 `qb_agent` 而不是工作台的 `ai_agent`：
 *   题库要**写**（老师录题），而 ai_agent 的定位是只读网关（ADR-007）。
 *   两个凭证权限面完全不同，混用会让 ai_agent 的边界论述名存实亡。
 *   详见 server/src/middleware/auth.js 的注释。
 *
 * 与工作台同构的部分（票据 60 秒一次性、jti 防重放、tv 随登出失效）由后端保证，
 * 前端只负责携带与持久化。
 */
import { ref, computed } from "vue";

const KEY = "qbank:session";
const API_KEY = "qbank:api";

export interface CurrentUser {
  id: number;
  name: string;
  role: "admin" | "teacher";
  loginAt: string;
  /** 题库凭证（type=qb_agent）：仅可访问 /api/qbank */
  qbToken: string;
}

/**
 * 演示身份：**仅在直接打开题库地址（未经教务系统跳转）时兜底**。
 * 便于界面评审，但**不发任何写操作** —— 演示身份下所有写接口都会 401，
 * 页面会明确提示「请从教务系统进入」，不会假装成功（K-050）。
 */
const DEMO_USER: CurrentUser = {
  id: 0,
  name: "访客（未从教务系统进入）",
  role: "teacher",
  loginAt: "",
  qbToken: ""
};

const user = ref<CurrentUser>(load());

function load(): CurrentUser {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as CurrentUser;
  } catch {
    /* 落到演示身份 */
  }
  return { ...DEMO_USER, loginAt: new Date().toISOString() };
}

export function saveSession(u: CurrentUser): void {
  user.value = u;
  localStorage.setItem(KEY, JSON.stringify(u));
}

export function currentUser(): CurrentUser {
  return user.value;
}

/** 是否是「有真实凭证」的真实用户（决定能不能写） */
export const isRealUser = computed(() => Boolean(user.value.qbToken));

export function isAdmin(): boolean {
  return user.value.role === "admin";
}

/**
 * 教务系统 API 基地址。
 * 默认同源 —— Docker 部署时由 nginx 把 /api 反代到教务后端；
 * 本地预览由 vite proxy / serve.mjs 反代，两种环境都无需跨域配置。
 */
export function apiBase(): string {
  const fromQuery = new URLSearchParams(location.search).get("api");
  if (fromQuery) return fromQuery.replace(/\/$/, "");
  const stored = localStorage.getItem(API_KEY);
  return stored ? stored.replace(/\/$/, "") : "";
}

export function setApiBase(base: string): void {
  const v = String(base || "").trim();
  if (v) localStorage.setItem(API_KEY, v.replace(/\/$/, ""));
  else localStorage.removeItem(API_KEY);
}

/** 教务系统地址（「返回教务系统」按钮用）。默认同源。 */
export function crmUrl(): string {
  const stored = localStorage.getItem("qbank:crm");
  if (stored) return stored.replace(/\/$/, "");
  // 从 /qb/#/... 里剥出origin
  return location.origin;
}

/** 票据过期后需要回教务系统重新进入 */
export function needReLogin(): void {
  localStorage.removeItem(KEY);
  user.value = { ...DEMO_USER, loginAt: new Date().toISOString() };
}

/**
 * 极简请求层：只处理本题库需要的两种情况（K-050：任何失败都必须有明确反馈）。
 *
 * ★ 刻意不引axios：题库只有一个后端、十几个端点，
 *   且 401（凭证失效）与 403（无权限）需要**不同的用户提示**，手写更直白。
 */
export async function request<T = any>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const method = options.method || "GET";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (user.value.qbToken) headers.Authorization = `Bearer ${user.value.qbToken}`;

  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch {
    // 网络层失败：明确告诉用户「连不上」，而不是空白页
    throw new Error("连不上教务系统后端，请检查网络或确认服务是否在运行");
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    throw new Error(`接口返回了非 JSON 内容（HTTP ${res.status}）`);
  }

  if (res.status === 401) {
    needReLogin();
    throw new Error(json?.message || "登录状态已失效，请返回教务系统重新进入题库");
  }
  if (!res.ok || json?.success === false) {
    const msg = json?.message || `请求失败（HTTP ${res.status}）`;
    const err = new Error(msg) as Error & { status?: number; data?: any };
    err.status = res.status;
    err.data = json?.data;
    throw err;
  }
  return json?.data as T;
}