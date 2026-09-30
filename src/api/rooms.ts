// 教室（★ 2026-09-30 v23 新增）
//
// 读：登录即可（加课弹窗 / 课次详情 / 排课模板都要拉下拉）
// 写：仅 admin（教室属排课配置，与学期管理、节次时间同类）
import { http } from "@/utils/http";

/** 教室列表（关键字搜索；教室数量少，不分页） */
export const getRoomList = (params?: object) => {
  return http.request("get", "/api/rooms", { params });
};

/** 新增教室 */
export const createRoom = (data: object) => {
  return http.request("post", "/api/rooms", { data });
};

/** 修改教室 */
export const updateRoom = (id: number, data: object) => {
  return http.request("put", `/api/rooms/${id}`, { data });
};

/** 删除教室（被排课模板 / 课次引用时后端会拒绝并说明） */
export const deleteRoom = (id: number) => {
  return http.request("delete", `/api/rooms/${id}`);
};

/** 修改课次的教室（临时换教室；room_id 传 null 表示清空） */
export const updateSessionRoom = (id: number, roomId: number | null) => {
  return http.request("put", `/api/sessions/${id}/room`, {
    data: { room_id: roomId }
  });
};
