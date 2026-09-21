import { http } from "@/utils/http";

/** 站点信息（机构名称 / Logo / 页脚等展示配置） */

export type SiteInfo = {
  "site.name": string;
  "site.title": string;
  "site.orgName": string;
  "site.sinceYear": string;
  "site.slogan": string;
  "site.contact": string;
  "site.address": string;
  "site.icp": string;
  "site.policeNo": string;
  "site.copyrightExtra": string;
  "site.logo": string;
  "site.favicon": string;
};

/** 公开接口：免登录，登录页 / 未登录时用（仅返回展示字段） */
export const getPublicSiteInfo = () => {
  return http.request<{ success: boolean; data: SiteInfo }>(
    "get",
    "/api/site-info"
  );
};

/** 管理接口：登录后可读全部 site.* 键（设置页回填用） */
export const getSiteInfoAdmin = () => {
  return http.request<{ success: boolean; data: SiteInfo }>(
    "get",
    "/api/site-info/admin"
  );
};

/** 保存站点信息（仅 admin，后端按白名单过滤） */
export const updateSiteInfo = (data: Partial<SiteInfo>) => {
  return http.request<{ success: boolean; data: SiteInfo }>(
    "put",
    "/api/site-info",
    { data }
  );
};

/** 上传站点图片（logo / favicon），原始二进制直传，后端做魔数校验 */
export const uploadSiteImage = (file: File, kind: "logo" | "favicon") => {
  return http.request<{ success: boolean; data: { url: string; key: string } }>(
    "post",
    `/api/site-info/upload?kind=${kind}`,
    {
      data: file,
      headers: { "Content-Type": file.type || "application/octet-stream" }
    }
  );
};
