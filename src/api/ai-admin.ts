import { http } from "@/utils/http";

export type AiConfigField = {
  /** 字段中文名（后端下发，前端不硬编码） */
  label: string;
  /** 是否敏感字段：返回值为掩码，原样回传表示「不修改」 */
  secret: boolean;
  value: string;
  hasValue: boolean;
  /** db = 当前使用配置中心的值；env = 回退到环境变量 */
  source: "db" | "env";
};

export type AiConfigData = {
  fields: Record<string, AiConfigField>;
  updatedBy: string;
  updatedAt: string;
};

export type AiBalanceData = {
  available: boolean;
  balances: Array<{
    currency: string;
    total: string;
    granted: string;
    toppedUp: string;
  }>;
};

export type AiUsageData = {
  month: string;
  times: number;
  tin: number;
  tout: number;
  cost: number;
  byScene: Array<{ scene: string; times: number; cost: number }>;
};

/** 读取 AI 配置（敏感值为掩码） */
export const getAiConfig = () => {
  return http.request<{ success: boolean; data: AiConfigData }>(
    "get",
    "/api/ai/admin/config"
  );
};

/** 保存 AI 配置，立即生效，无需重启容器 */
export const saveAiConfig = (data: Record<string, string>) => {
  return http.request<{ success: boolean; data: AiConfigData }>(
    "put",
    "/api/ai/admin/config",
    { data }
  );
};

/** 查询模型账户余额（Key 不出服务端） */
export const getAiBalance = () => {
  return http.request<{ success: boolean; data: AiBalanceData }>(
    "get",
    "/api/ai/admin/balance"
  );
};

/** 本月用量与成本 */
export const getAiUsage = () => {
  return http.request<{ success: boolean; data: AiUsageData }>(
    "get",
    "/api/ai/admin/usage"
  );
};
