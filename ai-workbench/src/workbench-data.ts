/**
 * 工作台数据源适配层（对应调研报告方案 C 的「数据适配」）
 *
 * - demo：内置演示数据集，任何环境都能完整看到效果（默认）
 * - real：通过教务系统只读网关 `/api/agent/*` 读取真实数据
 *
 * 真实库当前**没有**「课堂评价 / 知识点 / 题库」三类表（capabilities 会如实反映），
 * 因此真实模式下这三部分仍按演示内容展示，并由界面统一标注来源，不把「没有数据」渲染成「0 分」。
 */
import { computed, ref } from "vue";
import * as demo from "./mock/dataset";
import type { KpNode, Student } from "./mock/dataset";
import { QUESTIONS } from "./mock/questions";
import { agentToken, apiBase } from "./session";

export type SourceMode = "demo" | "real";

export interface Capability {
  students: boolean;
  attendance: boolean;
  scores: boolean;
  hours: boolean;
  evaluations: boolean;
  knowledge: boolean;
  questions: boolean;
}

export interface RealClassRow {
  id: number;
  name: string;
  grade: string;
  student_count: number;
}

interface RealStudentRow {
  id: number;
  no: string;
  name: string;
  gender: string;
  status: string;
  enroll_date: string;
  attendance: {
    total: number;
    normal: number;
    late: number;
    early: number;
    absent: number;
    leave: number;
    rate: number | null;
  };
  exams: { name: string; date: string; full: number; score: number; rate: number }[];
  hours: { total: number; remain: number };
  avg_rate: number | null;
  trend: number | null;
}

export interface RealOverview {
  class: { id: number; name: string; grade: string };
  summary: {
    student_count: number;
    attendance_sessions: number;
    absent_total: number;
    score_avg: number | null;
    excellent_rate: number | null;
    scored_students: number;
  };
  students: RealStudentRow[];
  capabilities: Capability;
  data_version: string;
}

const KEY = "ai-workbench:source";

function normalize(v: string | null): SourceMode {
  return v === "real" ? "real" : "demo";
}

export const sourceMode = ref<SourceMode>(normalize(localStorage.getItem(KEY)));
export const realLoading = ref(false);
export const realError = ref("");
export const realClasses = ref<RealClassRow[]>([]);
export const realOverview = ref<RealOverview | null>(null);
export const activeClassId = ref<number | null>(null);
export const capabilities = ref<Capability | null>(null);
export const dataVersion = ref("");

/** 真实数据是否可用（有学员且已选中班级） */
export const realReady = computed(
  () => sourceMode.value === "real" && !!realOverview.value
);

/** 是否处于降级：选了真实数据但没拿到 */
export const realFallback = computed(
  () =>
    sourceMode.value === "real" &&
    (!realOverview.value || !capabilities.value?.students)
);

async function getJson<T>(path: string): Promise<T> {
  const token = agentToken();
  const res = await fetch(`${apiBase()}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !(body as any)?.success) {
    throw new Error((body as any)?.message || `请求失败（HTTP ${res.status}）`);
  }
  return (body as any).data as T;
}

/** 拉取真实数据（上下文 + 默认班级概览） */
export async function loadReal(classId?: number): Promise<void> {
  realLoading.value = true;
  realError.value = "";
  try {
    const ctx = await getJson<{
      classes: RealClassRow[];
      capabilities: Capability;
      data_version: string;
    }>("/api/agent/context");

    realClasses.value = ctx.classes || [];
    capabilities.value = ctx.capabilities || null;
    dataVersion.value = ctx.data_version || "";

    const target =
      classId ??
      activeClassId.value ??
      realClasses.value[0]?.id ??
      null;

    if (target) {
      activeClassId.value = target;
      realOverview.value = await getJson<RealOverview>(
        `/api/agent/classes/${target}/overview`
      );
      capabilities.value = realOverview.value.capabilities;
    } else {
      realOverview.value = null;
    }
  } catch (err) {
    realError.value = err instanceof Error ? err.message : "读取真实数据失败";
    realOverview.value = null;
  } finally {
    realLoading.value = false;
  }
}

export function setSourceMode(mode: SourceMode): void {
  sourceMode.value = mode;
  localStorage.setItem(KEY, mode);
  if (mode === "real") void loadReal();
}

export async function switchClass(classId: number): Promise<void> {
  activeClassId.value = classId;
  if (sourceMode.value === "real") await loadReal(classId);
}

/** 启动时若上一次选的是真实数据，自动拉一次 */
export function initDataSource(): void {
  if (sourceMode.value === "real") void loadReal();
}

/* --------------------------- 统一数据出口 --------------------------- */

function mapRealStudent(r: RealStudentRow): Student {
  const exams = r.exams.map(e => ({
    name: e.name,
    date: e.date,
    score: e.score,
    full: e.full,
    rate: e.rate
  }));
  return {
    id: r.id,
    no: r.no,
    name: r.name,
    attendance: {
      total: r.attendance.total,
      normal: r.attendance.normal,
      late: r.attendance.late,
      early: r.attendance.early,
      absent: r.attendance.absent,
      leave: r.attendance.leave,
      rate: r.attendance.rate ?? 0
    },
    exams,
    // 真实库尚未启用课堂评价：以 0 值占位，界面会统一标注
    eval: {
      date: "",
      focus: 0,
      participation: 0,
      homework: 0,
      mastery: 0,
      note: "真实库尚未启用课堂评价，暂无记录"
    },
    hours: { total: r.hours.total, remain: r.hours.remain, enrollDate: r.enroll_date },
    // 真实库没有知识点标签，留空由界面提示「待建设」
    kpMastery: {},
    tags: buildTags(r),
    avgRate: r.avg_rate ?? 0,
    trend: r.trend ?? 0
  };
}

function buildTags(r: RealStudentRow): string[] {
  const tags: string[] = [];
  if (r.attendance.absent >= 2) tags.push("连续缺勤");
  if (r.trend !== null && r.trend <= -8) tags.push("成绩下滑");
  if (r.hours.total > 0 && r.hours.remain <= 12) tags.push("课时将尽");
  if ((r.avg_rate ?? 0) >= 90 && r.attendance.absent === 0) tags.push("表现优异");
  if (r.trend !== null && r.trend >= 8) tags.push("进步明显");
  return tags;
}

const demoStudents = ref<Student[]>(demo.STUDENTS);

/** 当前学员名单：真实优先，未就绪时回落演示 */
export const students = computed<Student[]>(() => {
  if (realReady.value && realOverview.value) {
    return realOverview.value.students.map(mapRealStudent);
  }
  return demoStudents.value;
});

/** 当前班级信息 */
export const klass = computed(() => {
  if (realReady.value && realOverview.value) {
    const c = realOverview.value.class;
    return {
      id: c.id,
      name: c.name,
      studentCount: realOverview.value.summary.student_count,
      room: "—"
    };
  }
  return demo.KLASS;
});

/** 课程信息：真实库无「教材 / 学期」概念，仅替换班级名 */
export const course = computed(() => demo.COURSE);

/** 教学单元：真实库中无此概念，始终由演示数据提供并标注 */
export const unit = computed(() => demo.UNIT);

export const classRecords = computed(() => demo.CLASS_RECORDS);
export const homeworkList = computed(() => demo.HOMEWORK_LIST);
export const materials = computed(() => demo.MATERIALS);
export const unitProgressRows = computed(() => demo.UNIT_PROGRESS);
export const knowledgeTree = computed<KpNode[]>(() => demo.KNOWLEDGE_TREE);
export const allKp = computed(() => demo.ALL_KP);
export const questions = computed(() => QUESTIONS);

/** 真实模式下哪些模块仍在用演示内容（用于界面统一标注） */
export const demoFallbackModules = computed<string[]>(() => {
  if (sourceMode.value !== "real") return [];
  const caps = capabilities.value;
  if (!caps) return [];
  const list: string[] = [];
  if (!caps.evaluations) list.push("课堂评价（日常表现）");
  if (!caps.knowledge) list.push("知识点体系");
  if (!caps.questions) list.push("题库");
  list.push("教学单元与课时进度");
  return list;
});
