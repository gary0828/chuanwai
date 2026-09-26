// 课次 / 任课关系 / 节次时间 / 回填报告 接口集中点（G1 + G2，v21）
//
// ★ 前端铁律：全部新接口集中在此文件；views 内禁止出现 axios / $route / localStorage。
// ★ 响应体统一 { success: boolean, data?: any, message?: string }（项目既有约定）。
// ★ 生成的三步流程：previewSessions（只读预览）→ generateSessions（落库，幂等）。
import { http } from "@/utils/http";

/** ---------- 课次（/api/sessions） ---------- */

/** 课次列表（分页 + 学期/班级/教师/状态/日期范围筛选） */
export const getSessionList = (params?: object) => {
  return http.request("get", "/api/sessions", { params });
};

/**
 * 周课表：一次取全整张网格（days / periods / sessions），前端零额外请求。
 * @param params { view: 'class' | 'teacher', class_id?, teacher_id?, week_start?, statuses? }
 */
export const getSessionWeek = (params?: object) => {
  return http.request("get", "/api/sessions/week", { params });
};

/** 课次详情（含名单 / 课评现状 / 课消流水 / 关联课次） */
export const getSessionDetail = (id: number) => {
  return http.request("get", `/api/sessions/${id}`);
};

/** 生成预览（纯计算、只读）：返回 { to_create, already_exists, classes, templates, missing_period_times, range } */
export const previewSessions = (data: object) => {
  return http.request("post", "/api/sessions/preview", { data });
};

/** 确认生成整学期课次（幂等：已存在跳过）→ { created, skipped, backfilled, report_unmatched } */
export const generateSessions = (data: object) => {
  return http.request("post", "/api/sessions/generate", { data });
};

/** 历史回填（可重跑、幂等）→ { matched, unmatched } */
export const backfillSessions = (data?: object) => {
  return http.request("post", "/api/sessions/backfill", { data: data || {} });
};

/** 手工新增课次（加课 / 补课；admin）→ { id } */
export const createSession = (data: object) => {
  return http.request("post", "/api/sessions", { data });
};

/** 停课（待上课 → 已停课） */
export const stopSession = (id: number) => {
  return http.request("put", `/api/sessions/${id}/stop`);
};

/** 恢复（已停课 → 待上课） */
export const restoreSession = (id: number) => {
  return http.request("put", `/api/sessions/${id}/restore`);
};

/** 挪课（仅「待上课」；新建新课次 + 双向关联）→ { new_session_id } */
export const rescheduleSession = (id: number, data: object) => {
  return http.request("post", `/api/sessions/${id}/reschedule`, { data });
};

/** 代课（原教师保留，另记代课人） */
export const substituteSession = (id: number, data: object) => {
  return http.request("post", `/api/sessions/${id}/substitute`, { data });
};

/** ---------- 回填报告（/api/sessions/migration-report） ---------- */

/** 回填报告（分页 + 数据类型/班级/日期范围/原因/状态筛选）→ { list, total, summary } */
export const getMigrationReport = (params?: object) => {
  return http.request("get", "/api/sessions/migration-report", { params });
};

/** 未匹配项一键转待办（Q6：仅指派 admin）→ { todo_id } */
export const migrationReportToTodo = (id: number) => {
  return http.request("post", `/api/sessions/migration-report/${id}/todo`);
};

/** ---------- 节次时间（/api/period-times） ---------- */

/** 节次时间表（1–8 节，含起止时间与显示名）→ [{ period, start_time, end_time, label }] */
export const getPeriodTimes = () => {
  return http.request("get", "/api/period-times");
};

/** 批量保存节次时间（admin）→ data:null */
export const savePeriodTimes = (data: object) => {
  return http.request("put", "/api/period-times", { data });
};

/** ---------- 任课关系（/api/teaching-assignments） ---------- */

/** 任课关系列表（分页 + 班级/教师/学期筛选；teacher 仅本班）→ { list, total } */
export const getTeachingAssignments = (params?: object) => {
  return http.request("get", "/api/teaching-assignments", { params });
};

/** 新增任课关系（admin）→ { id } */
export const createTeachingAssignment = (data: object) => {
  return http.request("post", "/api/teaching-assignments", { data });
};

/** 修改任课关系（admin） */
export const updateTeachingAssignment = (id: number, data: object) => {
  return http.request("put", `/api/teaching-assignments/${id}`, { data });
};

/** 删除任课关系（admin） */
export const deleteTeachingAssignment = (id: number) => {
  return http.request("delete", `/api/teaching-assignments/${id}`);
};

/** ---------- 课次内既有流程复用（点名 / 课评） ---------- */

/**
 * 课后课评（既有端点 /api/growth/class-eval，本次新增 session_id 可选参数）。
 * 传 session_id → 按 (session_id, student_id) upsert，session_no 由课次推算。
 * @param data { class_id, course_id, eval_date, session_id?, items:[{ student_id, focus, participation, mastery, note? }] }
 */
export const saveClassEval = (data: object) => {
  return http.request("post", "/api/growth/class-eval", { data });
};
