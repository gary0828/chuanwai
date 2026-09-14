import { http } from "@/utils/http";

export type FeedbackItem = {
  id: number;
  user_id?: number;
  username?: string;
  user_role?: string;
  category: string;
  content: string;
  page_path: string;
  status: string;
  admin_reply: string;
  handled_at?: string | null;
  created_at: string;
  updated_at?: string;
};

export type FeedbackListResult = {
  success: boolean;
  data: {
    list: FeedbackItem[];
    total: number;
    page?: number;
    pageSize?: number;
  };
};

/** 统计：status 为中文键（待处理 / 处理中 / 已处理 / 已忽略） */
export type FeedbackSummary = {
  success: boolean;
  data: { total: number } & Record<string, number>;
};

export type FeedbackOptions = {
  success: boolean;
  data: { categories: string[]; statuses: string[] };
};

/** 提交使用反馈（任意登录用户） */
export const submitFeedback = (data: {
  category: string;
  content: string;
  page_path?: string;
}) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/feedback",
    { data }
  );
};

/** 我的反馈 */
export const getMyFeedback = () => {
  return http.request<FeedbackListResult>("get", "/api/feedback/mine");
};

/** 全部反馈（仅 admin，待处理优先） */
export const getFeedbackList = (params?: {
  page?: number;
  pageSize?: number;
  status?: string;
}) => {
  return http.request<FeedbackListResult>("get", "/api/feedback", { params });
};

/** 反馈统计（仅 admin） */
export const getFeedbackSummary = () => {
  return http.request<FeedbackSummary>("get", "/api/feedback/summary");
};

/** 可选值字典 */
export const getFeedbackOptions = () => {
  return http.request<FeedbackOptions>("get", "/api/feedback/options");
};

/** 处理反馈：改状态 / 写回复（仅 admin） */
export const updateFeedback = (
  id: number,
  data: { status?: string; admin_reply?: string }
) => {
  return http.request<{ success: boolean }>("put", `/api/feedback/${id}`, { data });
};
