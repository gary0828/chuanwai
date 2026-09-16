import { http } from "@/utils/http";

export type AiTicketResult = {
  success: boolean;
  data: {
    /** 一次性免登票据（60 秒内有效，用后即废） */
    ticket: string;
    /** AI 教学工作台跳转地址（票据置于 hash 片段，不随请求发送） */
    url: string;
    /** 票据有效期（秒） */
    expiresIn: number;
  };
};

/**
 * 获取 AI 教学工作台免登票据。
 * 票据只证明当前用户已在教务系统登录，不授予教务系统任何写权限。
 *
 * 带上当前访问教务系统所用的 host（不含端口）：后端在 `AI_WORKBENCH_URL`
 * 仍是 localhost 时，会用它拼出访问者能打开的工作台地址。
 * 否则老师用自己电脑访问校区机器时，会被跳到"自己电脑的 8082"而打不开。
 */
export const getAiTicket = () => {
  return http.request<AiTicketResult>("post", "/api/ai/sso/ticket", {
    data: { host: window.location.hostname }
  });
};
