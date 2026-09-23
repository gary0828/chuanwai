/**
 * 场景编排层：组装本地指标 → 脱敏 → 调用底座 → 产出结构 + 审计元信息
 * 业务层只调用这里的函数，不直接接触 provider。
 */
import { ALL_KP, MATERIALS } from "@/mock/dataset";
import {
  classRecords,
  course,
  dataVersion,
  homeworkList,
  klass,
  unit
} from "../workbench-data";
import { QUESTIONS, QUESTION_STATS } from "@/mock/questions";
import { currentUser } from "../session";
import * as engine from "./engine";
import { loadConfig, generate, sectionsToText, type SceneKey } from "./provider";
import { redact } from "./redact";
import * as tpl from "./templates";
import type { Section } from "./templates";

export const SCENE_LABELS: Record<SceneKey, string> = {
  course_design: "课程设计",
  lesson_plan: "备课方案",
  teaching_flow: "授课流程",
  homework_design: "作业设计",
  grading_feedback: "作业检查与评价",
  student_insight: "学员学情解读",
  class_diagnosis: "班级学情诊断",
  parent_feedback: "家长反馈文案",
  report_narrative: "学情报告叙述"
};

export interface AiMeta {
  mode: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  elapsedMs: number;
  redacted: string[];
  fallbackReason?: string;
  generatedAt: string;
  operator: string;
  dataVersion: string;
  sourceRows: string;
}

export interface AiOutput {
  scene: SceneKey;
  sceneLabel: string;
  sections: Section[];
  text: string;
  /** 出网载荷（已脱敏），用于界面展示与审计 */
  payloadPreview: Record<string, unknown>;
  meta: AiMeta;
}

/**
 * 数据版本：真实模式下取教务库的 PRAGMA user_version（由 /api/agent/context 下发），
 * 演示模式回落到当前代码所对齐的版本。**不要写死** —— 迁移后忘了改会误导排查。
 */
const DEMO_DATA_VERSION = "v18";

/** 通用出口：脱敏 → 生成 → 记录 */
async function compose(
  scene: SceneKey,
  payload: Record<string, unknown>,
  ruleSections: Section[],
  sourceRows: string
): Promise<AiOutput> {
  const { safe, removed } = redact(payload);
  const cfg = loadConfig();
  const out = await generate({ scene, ruleSections, safePayload: safe }, cfg);
  const operator = currentUser();

  const result: AiOutput = {
    scene,
    sceneLabel: SCENE_LABELS[scene],
    sections: out.sections,
    text: sectionsToText(out.sections),
    payloadPreview: safe,
    meta: {
      mode: out.mode === "server" ? "服务端模型" : "规则引擎",
      model: out.model,
      tokensIn: out.tokensIn,
      tokensOut: out.tokensOut,
      cost: Math.round(out.cost * 10000) / 10000,
      elapsedMs: out.elapsedMs,
      redacted: removed,
      fallbackReason: out.fallbackReason,
      generatedAt: new Date().toISOString(),
      operator: operator.name,
      dataVersion: dataVersion.value || DEMO_DATA_VERSION,
      sourceRows
    }
  };

  saveRecord(result);
  return result;
}

/* ------------------------------- 生成记录 ------------------------------- */

export interface GenRecord {
  scene: SceneKey;
  sceneLabel: string;
  operator: string;
  mode: string;
  model: string;
  cost: number;
  redactedCount: number;
  generatedAt: string;
}

const REC_KEY = "ai-workbench:records";

export function saveRecord(o: AiOutput): void {
  try {
    const list = listRecords();
    list.unshift({
      scene: o.scene,
      sceneLabel: o.sceneLabel,
      operator: o.meta.operator,
      mode: o.meta.mode,
      model: o.meta.model,
      cost: o.meta.cost,
      redactedCount: o.meta.redacted.length,
      generatedAt: o.meta.generatedAt
    });
    localStorage.setItem(REC_KEY, JSON.stringify(list.slice(0, 100)));
  } catch {
    /* 存储不可用时忽略，不影响主流程 */
  }
}

export function listRecords(): GenRecord[] {
  try {
    const raw = localStorage.getItem(REC_KEY);
    return raw ? (JSON.parse(raw) as GenRecord[]) : [];
  } catch {
    return [];
  }
}

export function clearRecords(): void {
  localStorage.removeItem(REC_KEY);
}

/* ------------------------------- 场景实现 ------------------------------- */

/** 课程设计 */
export async function genCourseDesign(): Promise<AiOutput> {
  const kps = engine.kpMasteryRanking();
  const exams = engine.examOverview();
  const payload = {
    subject: course.value.subject,
    grade: course.value.grade,
    textbook: course.value.textbook,
    unitName: `${unit.value.no}${unit.value.name}`,
    unitHours: unit.value.totalHours,
    doneHours: unit.value.doneHours,
    goals: unit.value.goals,
    weakKps: kps.slice(0, 3).map(k => ({ id: k.id, name: k.name, value: k.value })),
    examAvg: Math.round((exams.reduce((s, e) => s + e.avg, 0) / exams.length) * 10) / 10
  };

  const sections = tpl.courseDesign({
    course: course.value,
    unit: unit.value,
    goals: unit.value.goals,
    weakKps: kps.slice(0, 3),
    examAvg: payload.examAvg
  });

  return compose("course_design", payload, sections, "courses / exams / exam_scores");
}

/** 备课方案 */
export async function genLessonPlan(): Promise<AiOutput> {
  const kps = engine.kpMasteryRanking();
  const support = engine.supportStudents();

  const payload = {
    subject: course.value.subject,
    grade: course.value.grade,
    textbook: course.value.textbook,
    unitName: `${unit.value.no}${unit.value.name}`,
    lessonTitle: unit.value.next.title,
    lessonDate: unit.value.next.date,
    weakKpNames: kps.slice(0, 3).map(k => k.name),
    studentCount: klass.value.studentCount,
    focusStudentCount: support.length,
    // 以下为敏感字段，出网前会被剔除（演示脱敏生效）
    focusStudentNames: support.slice(0, 3).map(s => s.name),
    className: klass.value.name
  };

  const sections = tpl.lessonPlan({
    unit: unit.value,
    lesson: unit.value.next,
    className: klass.value.name,
    weakKps: kps.slice(0, 3),
    focusStudents: support.slice(0, 3).map(s => ({
      name: s.name,
      reason: s.tags.join("、")
    }))
  });

  return compose("lesson_plan", payload, sections, "exams / exam_scores / attendances");
}

/** 授课流程 */
export async function genTeachingFlow(): Promise<AiOutput> {
  const payload = {
    unitName: `${unit.value.no}${unit.value.name}`,
    lessonNo: unit.value.next.no,
    lessonTitle: unit.value.next.title,
    durationMin: 45,
    studentCount: klass.value.studentCount,
    absentCount: 2
  };
  const sections = tpl.teachingFlow({ unit: unit.value, lesson: unit.value.next });
  return compose("teaching_flow", payload, sections, "schedules / attendances");
}

/** 作业设计 */
export async function genHomeworkDesign(): Promise<AiOutput> {
  const kps = engine.kpMasteryRanking();
  const errors = engine.errorRanking();
  const enabled = QUESTIONS.filter(q => q.status === "已启用").length;

  const payload = {
    subject: course.value.subject,
    grade: course.value.grade,
    unitName: `${unit.value.no}${unit.value.name}`,
    lessonNo: unit.value.next.no,
    weakKpNames: kps.slice(0, 3).map(k => k.name),
    topErrors: errors.slice(0, 3).map(e => e.desc),
    questionPoolEnabled: enabled,
    difficulty: 3
  };

  const sections = tpl.homeworkDesign({
    unit: unit.value,
    lesson: unit.value.next,
    weakKps: kps.slice(0, 3),
    errorRank: errors,
    questionPool: { available: QUESTIONS.length, enabled }
  });

  return compose("homework_design", payload, sections, "exam_scores / questions / homework");
}

/** 作业检查与评价 */
export async function genGradingFeedback(homeworkId: number): Promise<AiOutput> {
  const hw = homeworkList.value.find(h => h.id === homeworkId) || homeworkList.value[0];
  const errors = hw.typicalErrors.map(e => ({
    kp: e.kp,
    kpName: ALL_KP.find(k => k.id === e.kp)?.name ?? e.kp,
    desc: e.desc,
    count: e.count
  }));
  const support = engine.supportStudents().slice(0, 3);

  const payload = {
    homeworkTitle: hw.title,
    assigned: hw.assigned,
    submitted: hw.submitted,
    avgScore: hw.avgScore,
    fullScore: hw.fullScore,
    errorItems: errors.map(e => `${e.desc}（${e.count} 人次）`),
    // 敏感字段：出网前被剔除
    missingStudentNames: hw.missing
  };

  const sections = tpl.gradingFeedback({
    hw,
    errorRank: errors,
    className: klass.value.name,
    submitRate: Math.round((hw.submitted / hw.assigned) * 1000) / 10,
    supportList: support.map(s => ({
      name: s.name,
      reason: s.tags.join("、") || "成绩偏低",
      action: s.tags.includes("连续缺勤") ? "先与家长确认缺勤原因" : "当堂面批错题"
    }))
  });

  return compose("grading_feedback", payload, sections, "homework / exam_scores / attendances");
}

/** 班级学情诊断 */
export async function genClassDiagnosis(): Promise<AiOutput> {
  const overview = engine.classOverview();
  const kps = engine.kpMasteryRanking();
  const errors = engine.errorRanking();
  const support = engine.supportStudents();
  const top = engine.extendStudents();
  const outliers = engine.scoreOutliers();

  const payload = {
    className: klass.value.name,
    studentCount: overview.studentCount,
    attendanceRate: overview.attendanceRate,
    avgScoreRate: overview.avgScoreRate,
    excellentRate: overview.excellentRate,
    homeworkSubmitRate: overview.homeworkSubmitRate,
    weakKps: kps.slice(0, 4).map(k => ({ name: k.name, value: k.value })),
    topErrors: errors.slice(0, 5).map(e => e.desc),
    // 敏感字段：出网前被剔除
    supportNames: support.map(s => s.name),
    topNames: top.map(s => s.name)
  };

  const sections = tpl.classDiagnosis({
    className: klass.value.name,
    overview,
    weakKps: kps,
    errorRank: errors,
    supportList: support,
    topList: top,
    outliers
  });

  return compose("class_diagnosis", payload, sections, "attendances / exam_scores / homework");
}

/** 单学员学情解读 */
export async function genStudentInsight(studentId: number): Promise<AiOutput> {
  const ins = engine.studentInsight(studentId);
  if (!ins) throw new Error("学员不存在");

  const payload = {
    studentRef: `S-${ins.student.id}`,
    grade: course.value.grade,
    latestName: ins.latest?.name,
    latestRate: ins.latest?.rate,
    history: ins.student.exams.map(e => e.rate),
    trend: ins.student.trend,
    attendanceRate: ins.student.attendance.rate,
    absent: ins.student.attendance.absent,
    weakKps: ins.kpWeak.map(k => ({ name: k.name, value: k.value, classValue: k.classValue })),
    // 敏感字段：出网前被剔除
    studentName: ins.student.name,
    parentPhone: "13800000000",
    amount: ins.student.hours.total * 120
  };

  const sections = tpl.studentInsight({
    student: ins.student,
    latest: ins.latest,
    gapToClass: ins.gapToClass,
    kpWeak: ins.kpWeak,
    className: klass.value.name
  });

  return compose("student_insight", payload, sections, "attendances / exam_scores / class_evaluations");
}

/** 家长反馈文案（不含课时余量与任何金额） */
export async function genParentFeedback(studentId: number): Promise<AiOutput> {
  const ins = engine.studentInsight(studentId);
  if (!ins) throw new Error("学员不存在");

  const payload = {
    studentRef: `S-${ins.student.id}`,
    latestRate: ins.latest?.rate,
    history: ins.student.exams.map(e => e.rate),
    attendanceRate: ins.student.attendance.rate,
    weakKpNames: ins.kpWeak.slice(0, 2).map(k => k.name),
    // 敏感字段：出网前被剔除
    studentName: ins.student.name,
    parentName: "（家长）",
    parentPhone: "13800000000",
    amount: 5800
  };

  const sections = tpl.parentFeedback({
    student: ins.student,
    latest: ins.latest,
    kpWeak: ins.kpWeak
  });

  return compose(
    "parent_feedback",
    payload,
    sections,
    "attendances / exam_scores / class_evaluations"
  );
}

/** 学情报告叙述（teacher = 教师版，campus = 教务版含续课建议） */
export async function genReportNarrative(
  studentId: number,
  mode: "teacher" | "campus"
): Promise<AiOutput> {
  const ins = engine.studentInsight(studentId);
  if (!ins) throw new Error("学员不存在");

  const payload = {
    studentRef: `S-${ins.student.id}`,
    studentNo: ins.student.no,
    attendance: ins.student.attendance,
    exams: ins.student.exams.map(e => ({ name: e.name, rate: e.rate })),
    trend: ins.student.trend,
    evalRecord: {
      focus: ins.student.eval.focus,
      participation: ins.student.eval.participation,
      homework: ins.student.eval.homework,
      mastery: ins.student.eval.mastery
    },
    weakKps: ins.kpWeak.map(k => ({ name: k.name, value: k.value })),
    mode,
    ...(mode === "campus" ? { remainHours: ins.student.hours.remain } : {}),
    // 敏感字段：出网前被剔除
    studentName: ins.student.name,
    parentPhone: "13800000000",
    amount: 5800
  };

  const sections = tpl.reportNarrative({
    student: ins.student,
    latest: ins.latest,
    kpWeak: ins.kpWeak,
    className: klass.value.name,
    mode
  });

  return compose("report_narrative", payload, sections, "students / attendances / exam_scores / class_evaluations / orders");
}

/* ------------------------------- 其它聚合 ------------------------------- */

export function unitProgress() {
  return engine.unitProgress();
}

export function recentRecords(limit = 3) {
  return [...classRecords.value].reverse().slice(0, limit);
}

export function knowledgeStats() {
  const kps = engine.kpMasteryRanking();
  return {
    kpCount: ALL_KP.length,
    questionCount: QUESTIONS.length,
    questionEnabled: QUESTION_STATS.enabled,
    questionPending: QUESTION_STATS.pending,
    materialCount: MATERIALS.length,
    materialPending: MATERIALS.filter(m => m.status !== "已入库").length,
    weakest: kps[0],
    strongest: kps[kps.length - 1]
  };
}

