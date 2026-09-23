/**
 * 工作台数据源适配层（对应调研报告方案 C 的「数据适配」）
 *
 * - demo：内置演示数据集，任何环境都能完整看到效果（默认）
 * - real：通过教务系统接口读取真实数据
 *     · 只读统一走 `/api/agent/*`（学员 / 考勤 / 成绩 / 课时聚合）
 *     · 成长采集走 `/api/growth/*`（工作台凭证已放行采集三端点，见中间件 auth.js）
 *
 * capabilities 如实反映真实库有哪些数据，界面据此决定展示真实值还是演示内容，
 * **不把「没有数据」渲染成「0 分」**。
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
  /** v18 新增：成长时间轴是否已有数据 */
  timeline: boolean;
  /** v18 新增：知识点评定是否已有数据 */
  kpAssessments: boolean;
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

/** 统一的写操作（POST / PUT / DELETE）；失败时把后端的中文提示原样抛出，便于老师看懂 */
async function sendJson<T>(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  payload?: unknown
): Promise<T> {
  const token = agentToken();
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !(body as any)?.success) {
    throw new Error((body as any)?.message || `提交失败（HTTP ${res.status}）`);
  }
  return (body as any).data as T;
}

/** 写操作（课堂采集） */
function postJson<T>(path: string, payload: unknown): Promise<T> {
  return sendJson<T>("POST", path, payload);
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

/* ----------------------- 成长采集与查询（v18） ----------------------- */

/** 采集表单预填数据（老师打开授课流程页时带出「该评谁、该评哪些知识点」） */
export interface GrowthEvalForm {
  class_id: number;
  date: string;
  students: {
    id: number;
    no: string;
    name: string;
    evaluated: boolean;
    eval: { focus: number; participation: number; mastery: number; note: string } | null;
  }[];
  knowledge_points: {
    id: number;
    code: string;
    name: string;
    unit_no: number;
    /**
     * 所属单元名（如「第一单元 · 全等三角形」）。
     * 后端只下发**叶子知识点**，单元节点作为分组标题折叠到这个字段里 ——
     * 因此这里永远是可评定的对象，采集页可以直接逐行打勾。
     */
    unit_name: string | null;
    seq: number;
    difficulty: number;
  }[];
  already_evaluated: number;
}

/**
 * 读取采集表单（学生 + 可评定知识点）。
 *
 * demo 模式返回一份**演示表单**：不是为了好看，而是因为「课后采集」是老师每天要用的
 * 核心动作，演示态下必须能看见它长什么样、单元分组长什么样，否则无法验收 UI。
 * 演示数据不落库（提交时页面会拦截并提示）。
 */
export async function loadGrowthForm(
  classId: number,
  date: string
): Promise<GrowthEvalForm | null> {
  if (!classId) return null;
  if (sourceMode.value !== "real") return demoGrowthForm(classId, date);
  return getJson<GrowthEvalForm>(
    `/api/growth/eval-form?class_id=${classId}&date=${date}`
  );
}

/** 提交课堂评价（三维 1-5 分 + 可选备注） */
export async function submitClassEval(input: {
  classId: number;
  courseId?: number | null;
  evalDate: string;
  sessionNo?: number;
  items: {
    student_id: number;
    focus: number;
    participation: number;
    mastery: number;
    note?: string;
  }[];
}): Promise<{ saved: number; appended: number }> {
  return postJson<{ saved: number; appended: number }>(
    "/api/growth/class-eval",
    {
      class_id: input.classId,
      course_id: input.courseId ?? null,
      eval_date: input.evalDate,
      session_no: input.sessionNo ?? 0,
      items: input.items
    }
  );
}

/** 提交知识点评定（全班统一 + 个别覆盖） */
export async function submitKpAssessment(input: {
  classId: number;
  courseId?: number | null;
  assessedAt: string;
  kps: { kp_id: number; level: string }[];
  overrides?: { student_id: number; kp_id: number; level: string }[];
  sessionNo?: number;
}): Promise<{ students: number; records: number }> {
  return postJson<{ students: number; records: number }>(
    "/api/growth/kp-assessment",
    {
      class_id: input.classId,
      course_id: input.courseId ?? null,
      assessed_at: input.assessedAt,
      session_no: input.sessionNo ?? 0,
      kps: input.kps,
      overrides: input.overrides || []
    }
  );
}

/** 整班成长概览 */
export interface ClassGrowth {
  classId: number;
  studentCount: number;
  students: { id: number; student_no: string; name: string }[];
  evalSeries: {
    eval_date: string;
    n: number;
    focus: number;
    participation: number;
    mastery: number;
  }[];
  kpMastery: {
    kpId: number;
    code: string;
    name: string;
    unitNo: number;
    seq: number;
    assessed: number;
    mastered: number;
    masteryRate: number | null;
  }[];
  thresholds: Record<string, number>;
}

/** 单学员成长画像 */
export interface StudentGrowth {
  studentId: number;
  range: { from: string; to: string };
  sessionCount: number;
  attendance: { attended: number; absent: number; leave: number; rate: number | null };
  evalTrend: { date: string; focus: number; participation: number; mastery: number }[];
  evalDelta: { focus: number; participation: number; mastery: number } | null;
  examSeries: { date: string; name: string; rate: number }[];
  kpProgress: {
    kpId: number;
    name: string;
    from: string;
    to: string;
    fromDate: string;
    toDate: string;
    delta: number;
    attempts: number;
    jumps: { date: string; from: string; to: string }[];
  }[];
  milestones: { date: string; title: string; kind: string }[];
  breakdown: {
    attendance: number;
    exam: number;
    classEval: number;
    kpAssessment: number;
    total: number;
  };
  eventCount: number;
  thresholds: Record<string, number>;
  dataVersion: string;
}

/** 时间轴事件（成长路径的"每一步"明细） */
export interface TimelineEvent {
  type: string;
  label: string;
  date: string;
  summary: string;
  payload: Record<string, unknown>;
  source?: string;
}

export interface StudentTimeline {
  studentId: number;
  from: string;
  to: string;
  count: number;
  events: TimelineEvent[];
}

/**
 * 取整班成长数据。
 * 真实模式读后端；demo 模式返回内置演示轨迹 —— 否则成长路径页在演示模式下整页空白，
 * 第一次打开的人看不出这个功能长什么样。两个模式的返回结构完全一致，页面无需分支。
 */
export async function loadClassGrowth(
  classId: number,
  range?: { from?: string; to?: string }
): Promise<ClassGrowth | null> {
  if (sourceMode.value !== "real" || !classId) return demoClassGrowth();
  const qs = new URLSearchParams();
  if (range?.from) qs.set("from", range.from);
  if (range?.to) qs.set("to", range.to);
  const suffix = qs.toString() ? `?${qs}` : "";
  return getJson<ClassGrowth>(`/api/growth/classes/${classId}/growth${suffix}`);
}

/** 取单学员成长画像（demo 模式返回演示轨迹） */
export async function loadStudentGrowth(
  studentId: number,
  range?: { from?: string; to?: string }
): Promise<StudentGrowth | null> {
  if (sourceMode.value !== "real" || !studentId) return demoStudentGrowth(studentId);
  const qs = new URLSearchParams();
  if (range?.from) qs.set("from", range.from);
  if (range?.to) qs.set("to", range.to);
  const suffix = qs.toString() ? `?${qs}` : "";
  return getJson<StudentGrowth>(`/api/growth/students/${studentId}/growth${suffix}`);
}

/** 取单学员时间轴（demo 模式返回演示事件） */
export async function loadStudentTimeline(
  studentId: number
): Promise<StudentTimeline | null> {
  if (sourceMode.value !== "real") {
    const ev = demo.DEMO_STUDENT_TIMELINE;
    return {
      studentId: Number(studentId) || 0,
      from: ev[0]?.date || "",
      to: ev[ev.length - 1]?.date || "",
      count: ev.length,
      events: ev as TimelineEvent[]
    };
  }
  if (!studentId) return null;
  return getJson<StudentTimeline>(`/api/growth/students/${studentId}/timeline`);
}

/** demo 模式的采集表单（结构对齐 GrowthEvalForm，不落库） */
function demoGrowthForm(classId: number, date: string): GrowthEvalForm {
  return {
    class_id: classId,
    date,
    students: demo.STUDENTS.slice(0, 8).map((s, i) => ({
      id: s.id,
      no: s.no,
      name: s.name,
      // 前 3 人预填为「已评过」，让老师（和验收者）看到"只补没评的"这个真实交互
      evaluated: i < 3,
      eval: i < 3 ? { focus: 4, participation: 4, mastery: 3, note: "" } : null
    })),
    // 与真实库同构：只列**叶子知识点**（可评定），单元名折叠进 unit_name
    knowledge_points: demo.DEMO_KP_FORM,
    already_evaluated: 3
  };
}

/** demo 模式的整班成长数据（结构对齐 ClassGrowth） */
function demoClassGrowth(): ClassGrowth {
  const names = demo.STUDENTS.slice(0, 6).map(s => ({
    id: s.id,
    student_no: s.no,
    name: s.name
  }));
  return {
    classId: 0,
    studentCount: demo.KLASS.studentCount,
    students: names,
    evalSeries: demo.DEMO_CLASS_EVAL_SERIES,
    kpMastery: demo.DEMO_CLASS_KP,
    thresholds: {}
  };
}

/** demo 模式的单学员成长数据（结构对齐 StudentGrowth） */
function demoStudentGrowth(studentId: number): StudentGrowth {
  const d = demo.DEMO_STUDENT_GROWTH;
  const trend = d.evalTrend;
  const first = trend[0];
  const last = trend[trend.length - 1];
  return {
    studentId: Number(studentId) || 0,
    range: { from: "0000-01-01", to: "9999-12-31" },
    sessionCount: d.attendance.attended + d.attendance.absent,
    attendance: d.attendance,
    evalTrend: trend,
    evalDelta: first && last
      ? {
          focus: Math.round((last.focus - first.focus) * 10) / 10,
          participation: Math.round((last.participation - first.participation) * 10) / 10,
          mastery: Math.round((last.mastery - first.mastery) * 10) / 10
        }
      : null,
    examSeries: d.examSeries,
    kpProgress: d.kpProgress,
    milestones: d.milestones,
    breakdown: d.breakdown,
    eventCount: d.eventCount,
    thresholds: {},
    dataVersion: "demo"
  };
}

/**
 * 当前生效的班级 ID。
 *
 * `activeClassId` 只在**真实模式**下由 /api/agent/context 赋值，demo 模式恒为 null。
 * 但 demo 模式也是有"一个班"的（mock 数据里的 KLASS），成长采集/成长路径
 * 都围绕"当前班"展开，因此这里统一兜一层：demo 下落回演示班级，
 * 避免调用方到处写 `sourceMode === "real" ? ... : KLASS.id`。
 */
export const effectiveClassId = computed(
  () => activeClassId.value ?? (sourceMode.value !== "real" ? demo.KLASS.id : null)
);

/**
 * 工作台可用的成长能力（界面据此决定是否展示采集入口）。
 *
 * 注意 demo 模式**也放行**这两个能力：采集是老师每天用的核心动作，
 * 演示态下必须看得见它的 UI（页面会标注「演示」并拦截落库），
 * 否则新用户/验收者根本无从判断这个功能长什么样。
 */
export const growthCapabilities = computed(() => ({
  /** 可采集：已选班级 +（真实模式有知识点体系 / demo 模式用内置演示知识点） */
  canCollect:
    !!effectiveClassId.value &&
    (sourceMode.value !== "real" || !!capabilities.value?.knowledge),
  /** 可看成长路径：已选班级 +（真实模式时间轴有数据 / demo 模式用内置演示轨迹） */
  canViewGrowth:
    !!effectiveClassId.value &&
    (sourceMode.value !== "real" || !!capabilities.value?.timeline),
  hasEvaluations: !!capabilities.value?.evaluations,
  hasKpAssessments: !!capabilities.value?.kpAssessments
}));

/* --------------------------- 统一数据出口 --------------------------- */

function mapRealStudent(r: RealStudentRow): Student {
  const exams = r.exams.map(e => ({
    name: e.name,
    date: e.date,
    score: e.score,
    full: e.full,
    rate: e.rate
  }));
  const att = r.attendance;
  return {
    id: r.id,
    no: r.no,
    name: r.name,
    attendance: {
      total: att.total,
      normal: att.normal,
      late: att.late,
      early: att.early,
      absent: att.absent,
      leave: att.leave,
      rate: att.rate ?? 0
    },
    exams,
    // 真实库的课堂评价由 /api/growth 提供，此处先占位 0 值；
    // 成长路径页会读真实三维评价，避免列表页重复请求
    eval: {
      date: "",
      focus: 0,
      participation: 0,
      mastery: 0,
      note: ""
    },
    hours: { total: r.hours.total, remain: r.hours.remain, enrollDate: r.enroll_date },
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
  if (!caps.kpAssessments) list.push("知识点评定过程");
  if (!caps.questions) list.push("题库");
  list.push("教学单元与课时进度");
  return list;
});

/* ────────────────────────────  待办（个人事务）  ────────────────────────────
 *
 * 老师在工作台看/管自己的待办，与教务端**同一张表**（`todos`），按 owner 过滤。
 * 后端 `routes/todos.js` 对 teacher 强制只看自己 —— 这里传 `scope=mine` 只是
 * 表达意图，真正的边界在后端。
 *
 * ★ demo 模式下**只读演示数据、不做任何写操作** —— 避免老师以为在演示里点了
 *   「完成」，真实库里却什么都没发生。
 */
export interface WorkbenchTodo {
  id: number;
  title: string;
  content: string;
  status: "待办" | "已完成";
  priority: "普通" | "重要" | "紧急";
  source: "manual" | "auto";
  due_date: string | null;
  created_at: string;
}

/** 演示用的待办（结构对齐真实接口） */
function demoTodos(): WorkbenchTodo[] {
  const today = new Date();
  const d = (n: number) => {
    const x = new Date(today.getTime() + n * 86400_000);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  };
  return [
    {
      id: -1,
      title: "【演示】给小李补一次「两边及夹角」的证明训练",
      content: "上次课该知识点掌握不牢，安排一次一对一",
      status: "待办",
      priority: "重要",
      source: "manual",
      due_date: d(1),
      created_at: d(0) + " 08:30:00"
    },
    {
      id: -2,
      title: "【演示】学员『王小雨』课时余额不足",
      content: "剩余课时低于阈值，建议联系家长续费",
      status: "待办",
      priority: "紧急",
      source: "auto",
      due_date: d(-1),
      created_at: d(0) + " 07:00:00"
    },
    {
      id: -3,
      title: "【演示】提交本周班级学情小结",
      content: "",
      status: "已完成",
      priority: "普通",
      source: "manual",
      due_date: null,
      created_at: d(-2) + " 09:00:00"
    }
  ];
}

/** 我的待办（不含已完成时传 status='待办'） */
export async function loadMyTodos(status?: string): Promise<WorkbenchTodo[]> {
  if (sourceMode.value !== "real") {
    return status ? demoTodos().filter(t => t.status === status) : demoTodos();
  }
  const qs = status
    ? `?scope=mine&status=${encodeURIComponent(status)}&pageSize=100`
    : "?scope=mine&pageSize=100";
  const res = await getJson<{ list: WorkbenchTodo[] }>(`/api/todos${qs}`);
  return res?.list ?? [];
}

/** 标记完成 / 退回待办 */
export async function setTodoStatus(id: number, status: "待办" | "已完成"): Promise<void> {
  if (sourceMode.value !== "real") return; // demo 不写真库
  await sendJson("PUT", `/api/todos/${id}`, { status });
}

/** 新建待办（默认记给自己） */
export async function createMyTodo(payload: {
  title: string;
  content?: string;
  priority?: string;
  due_date?: string | null;
}): Promise<void> {
  if (sourceMode.value !== "real") return; // demo 不写真库
  await sendJson("POST", "/api/todos", payload);
}

/** 删除待办 */
export async function removeTodo(id: number): Promise<void> {
  if (sourceMode.value !== "real") return; // demo 不写真库
  await sendJson("DELETE", `/api/todos/${id}`);
}
