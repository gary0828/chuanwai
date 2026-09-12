// 教学结果与课消接口（考试/成绩/学习报告/成长档案/课时消耗统计）
import { http } from "@/utils/http";

/** ---------- 考试管理 ---------- */

/** 考试列表（分页 + 课程/班级/关键字过滤） */
export const getExamList = (params?: object) => {
  return http.request("get", "/api/exams", { params });
};

/** 新增考试 */
export const createExam = (data: object) => {
  return http.request("post", "/api/exams", { data });
};

/** 修改考试 */
export const updateExam = (id: number, data: object) => {
  return http.request("put", `/api/exams/${id}`, { data });
};

/** 删除考试（级联删除成绩记录） */
export const deleteExam = (id: number) => {
  return http.request("delete", `/api/exams/${id}`);
};

/** 考试学生成绩（录入用，返回本班在读学生 + 已录成绩） */
export const getExamScores = (id: number) => {
  return http.request("get", `/api/exams/${id}/scores`);
};

/** 批量保存考试成绩（覆盖式） */
export const saveExamScores = (id: number, data: object) => {
  return http.request("put", `/api/exams/${id}/scores`, { data });
};

/** 考试成绩单（排名/等级 + 平均分） */
export const getExamScorecard = (id: number) => {
  return http.request("get", `/api/exams/${id}/scorecard`);
};

/** ---------- 学习报告 / 成长档案 ---------- */

/** 学员学习报告 */
export const getStudentReport = (id: number) => {
  return http.request("get", `/api/reports/students/${id}`);
};

/** 成长档案时间线 [{time,type,title,content}] */
export const getStudentTimeline = (id: number) => {
  return http.request("get", `/api/reports/students/${id}/timeline`);
};

/** ---------- 课时消耗统计 ---------- */

/** 课消统计（dimension=teacher|course|student，start/end 时间范围） */
export const getConsumptionStats = (params?: object) => {
  return http.request("get", "/api/finance/stats/consumption", { params });
};
