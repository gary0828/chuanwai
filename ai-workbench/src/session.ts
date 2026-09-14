/**
 * 会话（免登链路）
 * 正常路径：教务系统签发一次性票据 → 本工作台拿票据换会话 + 只读凭证。
 * 演示路径：直接打开时使用演示身份，便于评审界面与流程。
 */
const KEY = "ai-workbench:session";

export interface CurrentUser {
  id: number;
  name: string;
  role: "admin" | "teacher";
  source: "sso" | "demo";
  loginAt: string;
  /** 工作台只读凭证（type = ai_agent）：仅可访问 /api/agent/* 与 /api/ai/* */
  agentToken?: string;
}

const DEMO_USER: CurrentUser = {
  id: 2,
  name: "王老师",
  role: "teacher",
  source: "demo",
  loginAt: ""
};

/**
 * 教务系统 API 基地址。
 * 优先级：URL `?api=` > 本机设置 > 同源（空串）。
 * 默认同源的原因：Docker 部署时由 nginx 把 /api 反代到教务后端，
 * 本地预览亦由 serve.mjs 反代，两种环境都不需要跨域配置、也不暴露后端端口。
 */
export function apiBase(): string {
  const fromQuery = new URLSearchParams(location.search).get("api");
  if (fromQuery) return fromQuery.replace(/\/$/, "");
  const stored = localStorage.getItem("ai-workbench:api");
  return stored ? stored.replace(/\/$/, "") : "";
}

export function setApiBase(base: string): void {
  const v = String(base || "").trim();
  if (v) localStorage.setItem("ai-workbench:api", v.replace(/\/$/, ""));
  else localStorage.removeItem("ai-workbench:api");
}

/** 教务系统前端地址（「返回教务系统」按钮用） */
export function crmUrl(): string {
  const stored = localStorage.getItem("ai-workbench:crm");
  if (stored) return stored.replace(/\/$/, "");
  return `${location.protocol}//${location.hostname}:8080`;
}

export function currentUser(): CurrentUser {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as CurrentUser;
  } catch {
    /* 落到演示身份 */
  }
  const demo = { ...DEMO_USER, loginAt: new Date().toISOString() };
  localStorage.setItem(KEY, JSON.stringify(demo));
  return demo;
}

export function setUser(u: CurrentUser): void {
  localStorage.setItem(KEY, JSON.stringify(u));
}

export function clearUser(): void {
  localStorage.removeItem(KEY);
}

/**
 * 工作台调用教务只读接口所用的凭证。
 * 正常来自免登换会话；也支持通过 URL `?token=` 传入 —— **仅供本地联调**，
 * 因为 token 会留在浏览器历史里，正式环境请走免登票据。
 */
export function agentToken(): string {
  const fromQuery = new URLSearchParams(location.search).get("token");
  if (fromQuery) return fromQuery;
  return currentUser().agentToken || "";
}

export interface TicketVerifyResponse {
  success: boolean;
  message?: string;
  data?: {
    id: number;
    name: string;
    role: string;
    loginAt?: string;
    scope?: string;
    agentToken?: string;
  };
}

/**
 * 用一次性票据换取会话。
 * 票据由教务系统 /api/ai/sso/ticket 签发，60 秒有效、一次性。
 */
export async function exchangeTicket(ticket: string): Promise<CurrentUser> {
  const res = await fetch(`${apiBase()}/api/ai/sso/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket })
  });

  const json = (await res.json().catch(() => ({}))) as TicketVerifyResponse;
  if (!res.ok || !json.success || !json.data) {
    throw new Error(json.message || `票据校验失败（HTTP ${res.status}）`);
  }

  const user: CurrentUser = {
    id: json.data.id,
    name: json.data.name,
    role: json.data.role === "admin" ? "admin" : "teacher",
    source: "sso",
    loginAt: json.data.loginAt || new Date().toISOString(),
    agentToken: json.data.agentToken
  };
  setUser(user);
  return user;
}
