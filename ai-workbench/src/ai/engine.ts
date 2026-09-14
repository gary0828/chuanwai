/**
 * 本地指标引擎
 * 原则（对应调研报告 R2/R10）：所有数字在此计算，模型只负责措辞。
 * 禁止把原始表或明细交给模型，也不允许模型生成任何查询语句。
 */
import {
  ALL_KP,
  CLASS_RECORDS,
  EXAMS,
  HOMEWORK_LIST,
  UNIT,
  type Student
} from "@/mock/dataset";
import { students } from "../workbench-data";

/** 当前数据源下的学员名单（演示数据 / 真实数据由适配层决定） */
function S(): Student[] {
  return students.value;
}

export interface ClassOverview {
  studentCount: number;
  attendanceRate: number;
  avgScoreRate: number;
  excellentRate: number;
  homeworkSubmitRate: number;
  warnCount: number;
  avgTrend: number;
}

export interface KpMastery {
  id: string;
  name: string;
  parent: string;
  value: number;
  difficulty: number;
}

export interface ErrorItem {
  kp: string;
  kpName: string;
  desc: string;
  count: number;
  homework: string;
}

function safeDiv(a: number, b: number): number {
  return b > 0 ? a / b : 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 班级概览 */
export function classOverview(): ClassOverview {
  const n = S().length;
  if (n === 0) {
    return {
      studentCount: 0,
      attendanceRate: 0,
      avgScoreRate: 0,
      excellentRate: 0,
      homeworkSubmitRate: 0,
      warnCount: 0,
      avgTrend: 0
    };
  }

  const totalSessions = S().reduce((s, x) => s + x.attendance.total, 0);
  const totalAbsent = S().reduce((s, x) => s + x.attendance.absent, 0);
  const latest = S().map(x => x.exams[x.exams.length - 1]?.rate ?? 0);
  const avgScoreRate = latest.reduce((a, b) => a + b, 0) / n;
  const excellent = latest.filter(r => r >= 90).length;

  const assigned = HOMEWORK_LIST.reduce((s, h) => s + h.assigned, 0);
  const submitted = HOMEWORK_LIST.reduce((s, h) => s + h.submitted, 0);

  return {
    studentCount: n,
    attendanceRate: round1(safeDiv(totalSessions - totalAbsent, totalSessions) * 100),
    avgScoreRate: round1(avgScoreRate),
    excellentRate: round1(safeDiv(excellent, n) * 100),
    homeworkSubmitRate: round1(safeDiv(submitted, assigned) * 100),
    warnCount: S().filter(s => s.tags.length > 0).length,
    avgTrend: round1(S().reduce((s, x) => s + x.trend, 0) / n)
  };
}

/** 全班知识点掌握度（按掌握度升序，最弱在前） */
export function kpMasteryRanking(): KpMastery[] {
  const list = S();
  const n = list.length;
  if (n === 0) return [];
  // 真实库当前没有知识点标签：无数据时返回空数组，
  // 由界面提示「知识点体系待建设」，而不是渲染成一排 0%
  if (!list.some(s => Object.keys(s.kpMastery || {}).length > 0)) return [];
  return ALL_KP.map(kp => {
    const sum = list.reduce((s, stu) => s + (stu.kpMastery[kp.id] ?? 0), 0);
    return {
      id: kp.id,
      name: kp.name,
      parent: kp.parent,
      difficulty: kp.difficulty,
      value: round1(sum / n)
    };
  }).sort((a, b) => a.value - b.value);
}

/** 错因归集（聚合所有作业的典型错误） */
export function errorRanking(): ErrorItem[] {
  const map = new Map<string, ErrorItem>();
  for (const hw of HOMEWORK_LIST) {
    for (const e of hw.typicalErrors) {
      const key = `${e.kp}::${e.desc}`;
      const hit = map.get(key);
      if (hit) {
        hit.count += e.count;
      } else {
        const kpName = ALL_KP.find(k => k.id === e.kp)?.name ?? e.kp;
        map.set(key, { kp: e.kp, kpName, desc: e.desc, count: e.count, homework: hw.title });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** 需要支持的学生：有预警标签，按严重度排序 */
export function supportStudents(): Student[] {
  const weight = (s: Student) => {
    let w = 0;
    if (s.tags.includes("连续缺勤")) w += 3;
    if (s.tags.includes("课时将尽")) w += 2;
    if (s.tags.includes("成绩下滑")) w += 3;
    w += Math.max(0, (75 - s.avgRate) / 10);
    return w;
  };
  return S().filter(s => s.tags.length > 0).sort((a, b) => weight(b) - weight(a));
}

/** 可以拓展的学生 */
export function extendStudents(): Student[] {
  return S().filter(s => s.avgRate >= 88).sort((a, b) => b.avgRate - a.avgRate);
}

/** 离群检测：同班 Z-score（最近一次得分率） */
export function scoreOutliers(): { id: number; name: string; z: number; rate: number }[] {
  const rates = S().map(s => s.exams[s.exams.length - 1]?.rate ?? 0);
  if (rates.length < 3) return [];
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((s, r) => s + (r - mean) ** 2, 0) / rates.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return [];
  return S().map(s => {
    const rate = s.exams[s.exams.length - 1]?.rate ?? 0;
    return { id: s.id, name: s.name, rate, z: Math.round(((rate - mean) / sd) * 100) / 100 };
  })
    .filter(x => Math.abs(x.z) >= 1.2)
    .sort((a, b) => a.z - b.z);
}

/** 单学生画像（含班级对比） */
export function studentInsight(studentId: number) {
  const stu = S().find(s => s.id === studentId);
  if (!stu) return null;

  const overview = classOverview();
  const latest = stu.exams[stu.exams.length - 1];
  const hasKp = Object.keys(stu.kpMastery || {}).length > 0;
  const kpWeak = hasKp
    ? ALL_KP.map(kp => ({
        id: kp.id,
        name: kp.name,
        parent: kp.parent,
        value: stu.kpMastery[kp.id] ?? 0,
        classValue: round1(
          S().reduce((s, x) => s + (x.kpMastery[kp.id] ?? 0), 0) / S().length
        )
      }))
        .sort((a, b) => a.value - b.value)
        .slice(0, 4)
    : [];

  const attendScore =
    stu.attendance.rate >= 95 ? "稳定" : stu.attendance.rate >= 85 ? "偶有波动" : "需关注";

  return {
    student: stu,
    overview,
    latest,
    kpWeak,
    attendScore,
    gapToClass: round1((latest?.rate ?? 0) - overview.avgScoreRate),
    trend: stu.trend
  };
}

/** 单元进度 */
export function unitProgress() {
  return {
    unit: UNIT,
    percent: Math.round((UNIT.doneHours / UNIT.totalHours) * 100),
    remainHours: UNIT.totalHours - UNIT.doneHours
  };
}

/** 最近课堂记录（用于首页"最近发生了什么"） */
export function recentRecords(limit = 3) {
  return [...CLASS_RECORDS].reverse().slice(0, limit);
}

/** 考试概览 */
export function examOverview() {
  return EXAMS.map(e => ({
    ...e,
    kpNames: e.kps.map(id => ALL_KP.find(k => k.id === id)?.name ?? id)
  }));
}
