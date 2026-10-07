/**
 * 学科（当前工作学科）
 *
 * ★ 为什么单独一个模块：**每个页面都要知道自己属于哪个学科**
 *   （题目库/三视角/统计/导出/回收站/知识点管理/AI 录题…）。
 *   状态散在各页面里必然出现"这个页面切了、那个页面没切"的不一致。
 *
 * ★ 与 session.ts 的分工：
 *   session 管「我是谁」（登录凭证），本模块管「我在哪个学科」——
 *   两者都会影响每个请求，但生命周期不同（凭证随登录变，学科随老师切换变）。
 *
 * ★ 存储：localStorage。老师通常固定教一两门课，记住上次选择能省一次点击。
 */
import { computed, ref } from "vue";
import { request } from "./session";

const KEY = "qbank:subject";

export interface Subject {
  id: number;
  code: string;
  name: string;
  /** 该学科的题目数（用于切换器上显示「初中数学 (12)」） */
  questionCount: number;
  /** 该学科的章节数 */
  chapterCount: number;
}

const subjects = ref<Subject[]>([]);
/** 当前学科 id；0 = 尚未确定（加载后会被设为第一个） */
const currentId = ref<number>(readStored());

function readStored(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isInteger(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

function persist() {
  try {
    if (currentId.value > 0) localStorage.setItem(KEY, String(currentId.value));
    else localStorage.removeItem(KEY);
  } catch {
    /* 隐私模式等写入失败：不阻塞使用（只是记不住选择） */
  }
}

/** 当前学科对象（未确定时为 null） */
export const currentSubject = computed(
  () => subjects.value.find((s) => s.id === currentId.value) || null
);
/** 当前学科 id（0 表示未确定） */
export const currentSubjectId = computed(() => currentId.value);
/** 全部学科（供切换器渲染） */
export const subjectList = computed(() => subjects.value);

/**
 * 拉取学科清单。
 *
 * ★ 首次进入 / 上次选的学科被删掉 → 回落到第一个学科。
 *   不能停在"未选学科"状态：那样列表页会显示全部学科的题混在一起，
 *   与"按学科隔离"的设计冲突，老师会以为筛选坏了。
 */
export async function loadSubjects(): Promise<void> {
  const data = await request<{ list: Subject[] }>("/api/qbank/subjects");
  subjects.value = data.list || [];
  if (!subjects.value.some((s) => s.id === currentId.value)) {
    // 优先落到**有题目**的学科（老师打开就能看到内容），否则第一个
    const withQuestions = subjects.value.find((s) => s.questionCount > 0);
    currentId.value = withQuestions?.id || subjects.value[0]?.id || 0;
    persist();
  }
}

/** 切换学科（由切换器调用） */
export function setSubject(id: number): void {
  if (id === currentId.value) return;
  currentId.value = id;
  persist();
}

/** 刷新学科计数（录题/删题后调用，让切换器上的数字跟着更新） */
export async function refreshSubjectCounts(): Promise<void> {
  try {
    const data = await request<{ list: Subject[] }>("/api/qbank/subjects");
    subjects.value = data.list || [];
  } catch {
    /* 计数刷新失败不打断主流程 */
  }
}

/**
 * 生成请求用的学科查询片段，形如 `&course_id=3`；未确定学科时返回空串。
 *
 * ★ 用 `&` 开头，直接拼在已有 `?a=1` 之后；调用方仍需自行处理"还没有 ?"的情况。
 *   为减少这类心算，下面给了一个更安全的 `subjectParam()`。
 */
export function subjectQuery(): string {
  return currentId.value > 0 ? `&course_id=${currentId.value}` : "";
}

/**
 * 把学科参数塞进 URLSearchParams（推荐用法）。
 * ★ 比手工拼 `subjectQuery()` 安全 —— 不会因为漏了 `?` 或重复 `&` 出错。
 */
export function withSubject(qs: URLSearchParams): URLSearchParams {
  if (currentId.value > 0) qs.set("course_id", String(currentId.value));
  return qs;
}
