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
 * 带上当前访问教务系统所用的**完整 origin**（协议 + 主机 + 端口）：
 * 后端在 `AI_WORKBENCH_URL` 仍是回环地址（localhost / 127.0.0.1）时，
 * 会直接用它拼出访问者能打开的工作台地址。
 *
 * 为什么必须连协议和端口一起传：工作台与教务系统通常**同源部署**
 * （同一 nginx 托管两个前端，`/api` 反代后端）。如果只传主机名，
 * 后端只能沿用配置里的 `http://...:8082`，那么：
 *   · 用户走 `http://域名`（80 端口）→ 被跳到 `:8082`，打不开
 *   · 用户走 `https://域名`        → 被跳到 `http://域名:8082`（协议降级 + 错端口）
 * 传 origin 后，跳转目标就是用户「正在访问的这个地址」，任何部署形态都不会错。
 *
 * 否则老师用自己电脑访问校区机器时，会被跳到"自己电脑的 8082"而打不开。
 */
export const getAiTicket = () => {
  return http.request<AiTicketResult>("post", "/api/ai/sso/ticket", {
    data: { origin: window.location.origin }
  });
};
