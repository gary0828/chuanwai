<script setup lang="ts">
/**
 * 题目库主页面
 *
 * 功能：列表 + 三视角侧栏（知识点/章节/解题方法）+ 多维筛选 + 查重 + 增删改
 *
 * ★ 三视角是参考系统的核心浏览方式（截图里的三个页签），
 *   本页用侧栏三段实现，语义相同。
 *
 * ★ 权限：teacher 只能改/删**自己录入的**题（后端已强制）。
 *   前端同步禁用按钮，但**不作为安全边界** —— 只是少一次必然失败的请求。
 */
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { apiBase, currentUser, isRealUser, request } from "../session";
import { currentSubjectId, withSubject } from "../subject";
import { renderInline, stemPreview } from "../katex";

interface Question {
  id: number;
  type: string;
  stem: string;
  options: string;
  answer: string;
  analysis: string;
  difficulty: number;
  kp_ids: string;
  chapter_id: number | null;
  solve_method: string;
  source: string;
  custom_tags: string;
  exam_year: number | null;
  region: string;
  status: string;
  parse_status: string;
  ocr_confidence: number | null;
  created_by: number | null;
  created_by_name: string;
  updated_at: string;
  /** 配图路径（/assets/questions/xxx.png），空串=没配图 */
  figure_path: string;
  /** 质量分（录入完整度 0–1） */
  quality_score: number | null;
}

interface Facets {
  knowledge: { id: number; parent_id: number | null; name: string }[];
  chapters: { id: number; parent_id: number | null; name: string }[];
  methods: { name: string; c: number }[];
  tags: { name: string }[];
  years: { year: number }[];
}

const TYPES = ["单选题", "多选题", "填空题", "判断题", "解答题", "简答题"];
const SOURCES = ["自编", "AI 原创", "教材", "授权题库"];
const STATUSES = ["草稿", "待审", "已启用", "已归档"];
const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

const list = ref<Question[]>([]);
const total = ref(0);
const loading = ref(false);
const facets = ref<Facets | null>(null);
const view = ref<"knowledge" | "chapter" | "method">("knowledge");

const filters = reactive({
  keyword: "",
  type: "",
  difficulty: "" as string | number,
  source: "",
  status: "",
  kp_id: "" as string | number,
  chapter_id: "" as string | number,
  solve_method: "",
  exam_year: "" as string | number,
  includeSub: true,
  sort: "updated"
});
const page = ref(1);
const pageSize = ref(20);

/** 排序选项（与后端 QUESTION_SORTS 白名单一一对应） */
const SORT_OPTIONS = [
  { value: "updated", label: "最近修改" },
  { value: "created", label: "最近录入" },
  { value: "difficulty_asc", label: "难度从易到难" },
  { value: "difficulty_desc", label: "难度从难到易" },
  { value: "quality_asc", label: "完善度低的在前" },
  { value: "quality_desc", label: "完善度高的在前" },
  { value: "type", label: "按题型" },
  { value: "year_desc", label: "按年份（新→旧）" }
];

/** 当前勾选的题目 id（批量操作用） */
const selectedIds = ref<number[]>([]);

/** 知识点 id → 名称（列表里显示名字而不是 id） */
const kpName = computed(() => {
  const m = new Map<number, string>();
  for (const k of facets.value?.knowledge || []) m.set(k.id, k.name);
  return m;
});
/** 章节 id → 名称 */
const chapterName = computed(() => {
  const m = new Map<number, string>();
  for (const c of facets.value?.chapters || []) m.set(c.id, c.name);
  return m;
});

/** 把一道题的知识点 id 数组翻成名称数组 */
function kpNamesOf(q: Question): string[] {
  try {
    const ids = JSON.parse(q.kp_ids || "[]");
    return (Array.isArray(ids) ? ids : []).map((id: number) => kpName.value.get(id) || `#${id}`);
  } catch {
    return [];
  }
}

/** 当前列表里「我能改」的题（批量操作只对这些生效） */
const mutableInPage = computed(() => list.value.filter(canMutate));
const selectedMutable = computed(() =>
  list.value.filter((q) => selectedIds.value.includes(q.id) && canMutate(q))
);

/** 知识点树（两层） */
const kpTree = computed(() => {
  const rows = facets.value?.knowledge || [];
  const roots = rows.filter((r) => r.parent_id == null);
  return roots.map((r) => ({ ...r, children: rows.filter((c) => c.parent_id === r.id) }));
});

/**
 * 知识点下拉的**扁平化选项**（带层级缩进）。
 *
 * ★ 为什么需要：知识库有 42 个节点（章 + 节），一期直接用 facets.knowledge 平铺，
 *   结果「第一单元 · 全等三角形」（章）与「全等图形与对应关系」（节）
 *   在下拉里长得一模一样，老师分不清层级。
 * ★ 用全角空格缩进子节点（不用半角，避免被 trim 掉）。
 */
const kpOptionsFlat = computed(() => {
  const rows = facets.value?.knowledge || [];
  const roots = rows.filter((r) => r.parent_id == null);
  const out: { id: number; label: string }[] = [];
  for (const r of roots) {
    out.push({ id: r.id, label: r.name });
    for (const c of rows.filter((x) => x.parent_id === r.id)) {
      out.push({ id: c.id, label: `\u3000${c.name}` });
    }
  }
  // 兜底：若数据里存在"孤儿子节点"（父节点被删但子节点还在），也要能选到
  const inTree = new Set(out.map((o) => o.id));
  for (const r of rows) {
    if (!inTree.has(r.id)) out.push({ id: r.id, label: `\u3000${r.name}` });
  }
  return out;
});


/** 章节树（两层） */
const chapterTree = computed(() => {
  const rows = facets.value?.chapters || [];
  const roots = rows.filter((r) => r.parent_id == null);
  return roots.map((r) => ({ ...r, children: rows.filter((c) => c.parent_id === r.id) }));
});

/** 是否某条能被我改/删 */
function canMutate(q: Question): boolean {
  if (currentUser().role === "admin") return true;
  return q.created_by === currentUser().id;
}

function parseOptions(q: Question): string[] {
  try {
    const v = JSON.parse(q.options || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function loadFacets() {
  try {
    const fs = new URLSearchParams();
    withSubject(fs);
    facets.value = await request<Facets>(`/api/qbank/facets?${fs.toString()}`);
  } catch (err) {
    // 侧栏数据拿不到不阻塞主列表
    console.warn("[qbank] facets 获取失败", err);
  }
}

/**
 * 构造筛选查询串 —— **列表与导出共用同一份**。
 *
 * ★★ 一期这里也是两处各写一遍，结果导出只带了 4 个参数（连难度都没传），
 *   老师筛「知识点=三角函数」后导出 → 拿到整个题库，**不报错**。
 *   后端已重构为共享函数；前端同样必须**只有一份**，否则前后端各漏一半。
 *
 * @param withPaging 是否带分页参数（导出不需要，导出全部）
 */
function buildFilterQuery(withPaging = true): string {
  const qs = new URLSearchParams();
  // ★ 学科（迁移 028）：列表与导出**共用**这个函数，一处加上两边都有 ——
  //   这正是当初把它抽出来的价值（一期导出漏参数就是因为两处各写一遍）。
  withSubject(qs);
  if (filters.keyword.trim()) qs.set("keyword", filters.keyword.trim());
  if (filters.type) qs.set("type", filters.type);
  if (filters.difficulty !== "") qs.set("difficulty", String(filters.difficulty));
  if (filters.source) qs.set("source", filters.source);
  if (filters.status) qs.set("status", filters.status);
  if (filters.kp_id !== "") qs.set("kp_id", String(filters.kp_id));
  if (filters.chapter_id !== "") qs.set("chapter_id", String(filters.chapter_id));
  if (filters.solve_method) qs.set("solve_method", filters.solve_method);
  if (filters.exam_year !== "") qs.set("exam_year", String(filters.exam_year));
  if (filters.includeSub && filters.chapter_id !== "") qs.set("include_sub_folders", "1");
  if (withPaging) {
    qs.set("sort", filters.sort);
    qs.set("page", String(page.value));
    qs.set("pageSize", String(pageSize.value));
  }
  return qs.toString();
}

async function loadList() {
  loading.value = true;
  try {
    const data = await request<{ list: Question[]; total: number }>(
      `/api/qbank/questions?${buildFilterQuery(true)}`
    );
    list.value = data.list || [];
    total.value = data.total || 0;
    // ★ 换页/换筛选后清空勾选 —— 否则"已选 3 道"里混着上一页看不见的题，
    //   用户点批量删除会删掉自己没看到的题目。
    selectedIds.value = [];
  } catch (err) {
    // ★ 加载失败必须显示错误，不能只留一个空列表（K-050）
    list.value = [];
    total.value = 0;
    ElMessage.error(err instanceof Error ? err.message : "题目列表加载失败");
  } finally {
    loading.value = false;
  }
}

/** 点侧栏某一项筛选 */
function pickKp(id: number) {
  filters.kp_id = filters.kp_id === id ? "" : id;
  filters.chapter_id = "";
  page.value = 1;
  loadList();
}
function pickChapter(id: number) {
  filters.chapter_id = filters.chapter_id === id ? "" : id;
  filters.kp_id = "";
  page.value = 1;
  loadList();
}
function pickMethod(name: string) {
  filters.solve_method = filters.solve_method === name ? "" : name;
  page.value = 1;
  loadList();
}

function resetFilters() {
  filters.keyword = "";
  filters.type = "";
  filters.difficulty = "";
  filters.source = "";
  filters.status = "";
  filters.kp_id = "";
  filters.chapter_id = "";
  filters.solve_method = "";
  filters.exam_year = "";
  filters.sort = "updated";
  page.value = 1;
  loadList();
}

// ── 增删改 ──────────────────────────────────────────────
const dialogVisible = ref(false);
const saving = ref(false);
const editingId = ref<number | null>(null);
const dupHint = ref<{ exact: any[]; similar: any[] } | null>(null);
const checkingDup = ref(false);

const form = reactive({
  type: "单选题",
  stem: "",
  options: ["", "", "", ""],
  answer: "",
  analysis: "",
  difficulty: 3,
  source: "",
  solve_method: "",
  kp_ids: [] as number[],
  chapter_id: "" as string | number,
  custom_tags: [] as string[],
  exam_year: "" as string | number,
  region: "",
  status: "草稿",
  /** 配图路径（上传后由后端返回，随题目一起提交） */
  figure_path: ""
});

/**
 * 上传配图。
 *
 * ★ 流程：先传图拿到路径 → 随题目一起提交（后端 `POST /questions/figure`）。
 *   之所以不等到保存时一起传，是因为「新建题目」那一刻题目还不存在，
 *   没有 id 可用于绑定。
 * ★ 走 `fetch` 手写（不是 request 封装）：它要发**原始二进制**，
 *   而 request 会 JSON.stringify 并带上 application/json。
 */
const uploadingFigure = ref(false);
/** 配图文件选择框的 ref（用于触发系统文件选择） */
const figureInput = ref<HTMLInputElement | null>(null);
async function uploadFigure(file: File) {
  if (!file) return;
  // 前端先挡一道（后端还有魔数校验，这里只是省一次往返）
  if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/i.test(file.type)) {
    ElMessage.error("请上传 PNG / JPEG / WebP / GIF / SVG 图片");
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    ElMessage.error(`图片 ${(file.size / 1024 / 1024).toFixed(1)}MB，超过 2MB 上限，请压缩后再传`);
    return;
  }
  uploadingFigure.value = true;
  try {
    const res = await fetch(`${apiBase()}/api/qbank/questions/figure`, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        ...(currentUser().qbToken ? { Authorization: `Bearer ${currentUser().qbToken}` } : {})
      },
      body: file
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      throw new Error(json?.message || `上传失败（HTTP ${res.status}）`);
    }
    form.figure_path = json.data.path;
    ElMessage.success("配图已上传");
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "配图上传失败");
  } finally {
    uploadingFigure.value = false;
  }
}
/** 移除已上传的配图（只清表单里的引用；磁盘文件由后端在换图/彻底删除时清理） */
function removeFigure() {
  form.figure_path = "";
  ElMessage.info("已移除配图（保存后生效）");
}

// ── 表单草稿（防误关丢失）────────────────────────────────
/**
 * 草稿自动保存。
 *
 * ★ 为什么需要：老师填一条题（题干+4 选项+答案+解析）可能要几分钟，
 *   这时误关标签页/刷新，全部重填 —— 挫败感极强。
 * ★ 存 localStorage（不是后端）：草稿是本机临时状态，不该进数据库
 *   （否则会污染题库统计，且多设备同步会引发"我在哪儿编辑的"困惑）。
 * ★ 只在**新增**时保存草稿：编辑已有题时草稿会与库里的数据打架，
 *   恢复谁都不对。
 */
const DRAFT_KEY = "qbank:question-draft";
let draftTimer: ReturnType<typeof setTimeout> | null = null;

function saveDraft() {
  if (editingId.value) return;            // 编辑态不存草稿（见上方说明）
  if (!form.stem.trim() && !form.answer.trim() && !form.analysis.trim()) {
    localStorage.removeItem(DRAFT_KEY);   // 空表单不占空间
    return;
  }
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ form: { ...form, kp_ids: [...form.kp_ids], custom_tags: [...form.custom_tags] }, at: Date.now() })
    );
  } catch {
    // ★ QuotaExceededError 等写入失败：静默降级（草稿是锦上添花，不该打断录入）
  }
}
/** 防抖版：表单每次改动都会触发，不能每次都写磁盘 */
function scheduleSaveDraft() {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(saveDraft, 800);
}
function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* 忽略 */
  }
}
function restoreDraftIfAny(): boolean {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d?.form?.stem?.trim()) return false;
    Object.assign(form, d.form);
    const mins = Math.round((Date.now() - (d.at || 0)) / 60000);
    const when = mins < 1 ? "刚刚" : mins < 60 ? `${mins} 分钟前` : `${Math.round(mins / 60)} 小时前`;
    ElMessage.info(`已恢复上次未保存的草稿（${when}）`);
    return true;
  } catch {
    return false;
  }
}

function openCreate() {
  editingId.value = null;
  // 先重置成空表单，再尝试用草稿覆盖 —— 避免残留上一次编辑的内容
  Object.assign(form, {
    type: "单选题",
    stem: "",
    options: ["", "", "", ""],
    answer: "",
    analysis: "",
    difficulty: 3,
    source: "",
    solve_method: "",
    kp_ids: [],
    chapter_id: "",
    custom_tags: [],
    exam_year: "",
    region: "",
    status: "草稿",
    figure_path: ""
  });
  dupHint.value = null;
  dialogVisible.value = true;
  // 若有上次未保存的草稿 → 提示并恢复（避免老师辛苦填的内容白丢）
  restoreDraftIfAny();
}

function openEdit(q: Question) {
  if (!canMutate(q)) {
    ElMessage.warning("这道题是其他老师录入的，只能由他自己修改");
    return;
  }
  editingId.value = q.id;
  const opts = parseOptions(q);
  Object.assign(form, {
    type: q.type,
    stem: q.stem,
    options: [0, 1, 2, 3].map((i) => opts[i] || ""),
    answer: q.answer,
    analysis: q.analysis,
    difficulty: q.difficulty,
    source: q.source,
    solve_method: q.solve_method,
    kp_ids: JSON.parse(q.kp_ids || "[]"),
    chapter_id: q.chapter_id ?? "",
    custom_tags: JSON.parse(q.custom_tags || "[]"),
    exam_year: q.exam_year ?? "",
    region: q.region,
    status: q.status,
    figure_path: q.figure_path || ""
  });
  dupHint.value = null;
  dialogVisible.value = true;
}

/** 查重（失焦时触发，不阻塞输入） */
async function checkDuplicate() {
  const stem = form.stem.trim();
  if (stem.length < 4) {
    dupHint.value = null;
    return;
  }
  checkingDup.value = true;
  try {
    const data = await request<{ exact: any[]; similar: any[] }>(
      "/api/qbank/questions/check-duplicate",
      {
        method: "POST",
        body: { stem, excludeId: editingId.value || 0 }
      }
    );
    dupHint.value = { exact: data.exact || [], similar: data.similar || [] };
    if (data.exact?.length || data.similar?.length) {
      ElMessage.warning("题库里可能已有这道题，请确认是不是重复录入");
    }
  } catch {
    // 查重失败不阻塞录入（它是辅助功能，不是闸门）
    dupHint.value = null;
  } finally {
    checkingDup.value = false;
  }
}

async function save() {
  if (!form.stem.trim()) {
    ElMessage.error("请填写题干");
    return;
  }
  if (!form.source) {
    ElMessage.error("请选择题目来源（版权口径必填）");
    return;
  }
  saving.value = true;
  try {
    const body: any = {
      type: form.type,
      stem: form.stem.trim(),
      options: form.options.map((o) => String(o || "").trim()).filter(Boolean),
      answer: form.answer.trim(),
      analysis: form.analysis.trim(),
      difficulty: form.difficulty,
      source: form.source,
      solve_method: form.solve_method.trim(),
      kp_ids: form.kp_ids,
      chapter_id: form.chapter_id === "" ? null : form.chapter_id,
      custom_tags: form.custom_tags,
      exam_year: form.exam_year === "" ? null : form.exam_year,
      region: form.region.trim(),
      status: form.status,
      figure_path: form.figure_path || "",
      // ★ 学科（迁移 028）：录题必须归属学科。用当前切换器选中的那个 ——
      //   老师在「初中物理」下点新增，录的就是物理题。
      course_id: currentSubjectId.value || undefined
    };
    if (editingId.value) {
      await request(`/api/qbank/questions/${editingId.value}`, { method: "PUT", body });
      ElMessage.success("已保存修改");
    } else {
      await request("/api/qbank/questions", { method: "POST", body });
      ElMessage.success("题目已入库");
    }
    dialogVisible.value = false;
    clearDraft();          // ★ 保存成功 → 草稿使命完成，必须清掉
    await loadList();
    await loadFacets();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "保存失败");
  } finally {
    saving.value = false;
  }
}

async function remove(q: Question) {
  if (!canMutate(q)) {
    ElMessage.warning("这道题是其他老师录入的，只能由他自己删除");
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确定删除这道题吗？删除后不可恢复。\n\n${stemPreview(q.stem, 50)}`,
      "删除确认",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }
    );
  } catch {
    return; // 用户取消
  }
  try {
    await request(`/api/qbank/questions/${q.id}`, { method: "DELETE" });
    ElMessage.success("已删除");
    await loadList();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "删除失败");
  }
}

/**
 * 批量删除**勾选的**题（软删，进回收站）。
 *
 * ★ 与一期不同：一期只能"删除本页"（整页全删），无法挑着删。
 *   现在改为按勾选操作，且明确告知"可在回收站恢复"。
 */
async function removeSelected() {
  const targets = selectedMutable.value;
  const blocked = selectedIds.value.length - targets.length;
  if (!targets.length) {
    ElMessage.error("请先勾选要删除的题目（只能操作自己录入的）");
    return;
  }
  try {
    await ElMessageBox.confirm(
      `将把 ${targets.length} 道题移入回收站（可恢复）` +
        (blocked > 0 ? `（另有 ${blocked} 道因无权限会被跳过）` : "") + "。",
      "批量删除",
      { type: "warning", confirmButtonText: "移入回收站", cancelButtonText: "取消" }
    );
  } catch {
    return;
  }
  try {
    const data = await request<{ deleted: number; skipped: number; message: string }>(
      "/api/qbank/questions/batch-delete",
      { method: "POST", body: { ids: targets.map((q) => q.id) } }
    );
    // ★ 如实转达后端返回的「跳过」数量
    ElMessage[data.skipped > 0 ? "warning" : "success"](data.message);
    await loadList();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "批量删除失败");
  }
}

// ── 批量操作 ────────────────────────────────────────────
/** 勾选变化（el-table 的 selection-change 事件） */
function onSelectionChange(rows: Question[]) {
  selectedIds.value = rows.map((r) => r.id);
}
function selectAllPage() {
  selectedIds.value = mutableInPage.value.map((q) => q.id);
}
function clearSelection() {
  selectedIds.value = [];
}

/**
 * 批量改状态。★ 复用后端 batch-status（它会按权限过滤并**如实回报跳过数**）。
 */
async function batchStatus(status: string) {
  const targets = selectedMutable.value;
  const blocked = selectedIds.value.length - targets.length;
  if (!targets.length) {
    ElMessage.error("请先勾选要操作的题目（只能操作自己录入的）");
    return;
  }
  try {
    await ElMessageBox.confirm(
      `将把 ${targets.length} 道题设为「${status}」` +
        (blocked > 0 ? `（另有 ${blocked} 道因无权限会被跳过）` : "") + "。",
      "批量修改状态",
      { type: "info", confirmButtonText: "确定", cancelButtonText: "取消" }
    );
  } catch {
    return;
  }
  try {
    const data = await request<{ updated: number; skipped: number; message?: string }>(
      "/api/qbank/questions/batch-status",
      { method: "POST", body: { ids: targets.map((q) => q.id), status } }
    );
    ElMessage[data.skipped > 0 ? "warning" : "success"](
      `已更新 ${data.updated} 道${data.skipped > 0 ? `，${data.skipped} 道因无权限被跳过` : ""}`
    );
    await loadList();
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "批量修改失败");
  }
}

async function exportXlsx() {
  try {
    // ★ 用与列表**同一个** buildFilterQuery —— 一期这里另写一遍、只传 4 个参数，
    //   导致"筛了知识点导出的是全部题"。现在列表与导出不可能再不一致。
    const res = await fetch(`${apiBase()}/api/qbank/questions/export?${buildFilterQuery(false)}`, {
      headers: currentUser().qbToken
        ? { Authorization: `Bearer ${currentUser().qbToken}` }
        : {}
    });
    if (!res.ok) throw new Error(`导出失败（HTTP ${res.status}）`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "题库导出.xlsx";
    a.click();
    URL.revokeObjectURL(url);
    ElMessage.success("已导出");
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "导出失败");
  }
}

watch([page, pageSize], loadList);

// ★ 表单任何字段变动都触发防抖存草稿。
//   deep 监听整个 form（含 kp_ids/options 数组），改动就记下来。
watch(
  form,
  () => {
    if (dialogVisible.value) scheduleSaveDraft();
  },
  { deep: true }
);

onMounted(async () => {
  await loadFacets();
  // ★★ 默认视角自动回落（ROADMAP §12.2 A，用户 2026-10-09 拍板）：
  //   知识点是**刻意不预置**的（教材版本差异大，编不准会污染教学体系，见 ADR-014），
  //   所以 23 门学科里只有原有的「初中数学」有知识点 —— 其余 22 门进来，
  //   三视角侧栏默认停在「知识点」页签就是**一片空白**，老师会以为题库坏了。
  //   ⇒ 本学科没有知识点、但有章节时，默认落到「章节」。
  //
  //   ★ 刻意只在**首屏**判断一次（onMounted 内），不放进 watch/computed：
  //     否则老师正在看「知识点」，一搜索、一翻页就可能被弹到「章节」——
  //     那比空白更糟（操作被"抢走"）。手动切到「知识点」仍尊重老师的选择。
  if (view.value === "knowledge" && !kpTree.value.length && chapterTree.value.length) {
    view.value = "chapter";
  }
  await loadList();
  if (!isRealUser.value) {
    ElMessage.warning({
      message: "当前是只读浏览模式，请从教务系统点「题库」入口进入后才能录题",
      duration: 6000
    });
  }
});
</script>

<template>
  <div class="qb-toolbar">
    <el-input
      v-model="filters.keyword"
      placeholder="搜索题干或解析（支持 LaTeX 内容）"
      clearable
      style="width: 260px"
      @keyup.enter="((page = 1), loadList())"
      @clear="((page = 1), loadList())"
    />
    <el-select v-model="filters.type" placeholder="题型" clearable style="width: 110px" @change="((page = 1), loadList())">
      <el-option v-for="t in TYPES" :key="t" :label="t" :value="t" />
    </el-select>
    <el-select v-model="filters.difficulty" placeholder="难度" clearable style="width: 100px" @change="((page = 1), loadList())">
      <el-option v-for="d in [1, 2, 3, 4, 5]" :key="d" :label="`难度 ${d}`" :value="d" />
    </el-select>
    <el-select v-model="filters.source" placeholder="来源" clearable style="width: 110px" @change="((page = 1), loadList())">
      <el-option v-for="s in SOURCES" :key="s" :label="s" :value="s" />
    </el-select>
    <el-select v-model="filters.status" placeholder="状态" clearable style="width: 100px" @change="((page = 1), loadList())">
      <el-option v-for="s in STATUSES" :key="s" :label="s" :value="s" />
    </el-select>
    <!-- 排序：与后端白名单对应，切换即重查 -->
    <el-select v-model="filters.sort" style="width: 150px" @change="((page = 1), loadList())">
      <el-option v-for="s in SORT_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />
    </el-select>
    <el-button @click="resetFilters">清空</el-button>

    <div class="qb-grow"></div>

    <el-button v-if="selectedIds.length" type="danger" plain @click="removeSelected">
      删除勾选（{{ selectedIds.length }}）
    </el-button>
    <el-button @click="exportXlsx" title="按当前筛选条件导出全部匹配的题目">导出 Excel</el-button>
    <el-button type="primary" @click="openCreate" :disabled="!isRealUser">
      ＋ 新增题目
    </el-button>
  </div>

  <div style="display: flex; align-items: flex-start; gap: 14px">
    <!-- 三视角侧栏 -->
    <aside class="qb-aside" style="margin-bottom: 14px">
      <el-radio-group v-model="view" size="small" style="margin-bottom: 10px">
        <el-radio-button label="knowledge">知识点</el-radio-button>
        <el-radio-button label="chapter">章节</el-radio-button>
        <el-radio-button label="method">方法</el-radio-button>
      </el-radio-group>

      <template v-if="view === 'knowledge'">
        <h3>按知识点</h3>
        <div v-if="!kpTree.length" class="qb-aside-empty">
          本学科还没有知识点。<br />知识点由各校区按自己的教材维护，去「知识点与章节」页新增。
        </div>
        <div v-for="r in kpTree" :key="r.id">
          <div
            class="qb-aside-item"
            :class="{ active: filters.kp_id === r.id }"
            @click="pickKp(r.id)"
          >
            {{ r.name }}
          </div>
          <div
            v-for="c in r.children"
            :key="c.id"
            class="qb-aside-item qb-aside-child"
            :class="{ active: filters.kp_id === c.id }"
            @click="pickKp(c.id)"
          >
            {{ c.name }}
          </div>
        </div>
      </template>

      <template v-else-if="view === 'chapter'">
        <h3>按章节（含下级）</h3>
        <div v-if="!chapterTree.length" class="qb-aside-empty">
          本学科还没有章节。<br />去「知识点与章节」页按自己用的教材补充。
        </div>
        <div v-for="r in chapterTree" :key="r.id">
          <div
            class="qb-aside-item"
            :class="{ active: filters.chapter_id === r.id }"
            @click="pickChapter(r.id)"
          >
            {{ r.name }}
          </div>
          <div
            v-for="c in r.children"
            :key="c.id"
            class="qb-aside-item qb-aside-child"
            :class="{ active: filters.chapter_id === c.id }"
            @click="pickChapter(c.id)"
          >
            {{ c.name }}
          </div>
        </div>
        <div style="margin-top: 10px">
          <el-checkbox v-model="filters.includeSub" @change="loadList">
            含下级章节
          </el-checkbox>
        </div>
      </template>

      <template v-else>
        <h3>按解题方法</h3>
        <div v-if="!facets?.methods?.length" class="qb-aside-empty">
          题库里还没有填过解题方法。<br />录题时填写「解题方法」，这里就能按方法聚合。
        </div>
        <div
          v-for="m in facets?.methods || []"
          :key="m.name"
          class="qb-aside-item"
          :class="{ active: filters.solve_method === m.name }"
          @click="pickMethod(m.name)"
        >
          {{ m.name }}
          <span class="qb-aside-count">{{ m.c }}</span>
        </div>
      </template>
    </aside>

    <!-- 题目列表 -->
    <div style="flex: 1; min-width: 0">
      <div class="qb-hint" style="margin-bottom: 8px">
        共 {{ total }} 道题<template v-if="total > list.length">
          ，当前显示第 {{ page }} 页（{{ list.length }} 道）
        </template>
      </div>

      <div v-loading="loading">
        <div v-if="!list.length && !loading" class="qb-empty">
          <div class="qb-empty-title">没有符合条件的题目</div>
          <div class="qb-hint" style="margin-bottom: 14px">
            试试清空筛选条件，或点右上角「新增题目」录第一道题
          </div>
          <el-button type="primary" @click="openCreate" :disabled="!isRealUser">
            新增题目
          </el-button>
        </div>

        <div
          v-for="q in list"
          :key="q.id"
          class="qb-question"
          :class="{ 'is-selected': selectedIds.includes(q.id) }"
        >
          <div class="qb-q-head">
            <!-- 勾选：只能勾自己录入的（勾别人的会在批量操作时被后端跳过，不如直接不给勾） -->
            <el-checkbox
              v-if="canMutate(q)"
              :model-value="selectedIds.includes(q.id)"
              style="margin-right: 4px; flex: 0 0 auto"
              @change="(v: any) => (v ? selectedIds.push(q.id) : (selectedIds = selectedIds.filter((i) => i !== q.id)))"
            />
            <el-tooltip v-else content="其他老师录入的题不能批量操作" placement="top">
              <span style="flex: 0 0 auto; width: 14px"></span>
            </el-tooltip>

            <div class="qb-q-stem qb-formula" v-html="renderInline(q.stem)" />
            <div style="white-space: nowrap">
              <el-tag size="small" effect="plain">{{ q.type }}</el-tag>
              <el-tag size="small" effect="plain" style="margin-left: 4px">
                难度 {{ q.difficulty }}
              </el-tag>
              <!-- 完善度：帮老师一眼看出"哪道题还没填全"（点排序可把低的排前面） -->
              <el-tooltip
                v-if="q.quality_score != null"
                :content="`录入完善度 ${Math.round((q.quality_score || 0) * 100)}%（解析 / 知识点 / 解题方法 三项的填充率）`"
                placement="top"
              >
                <el-tag
                  size="small"
                  effect="plain"
                  style="margin-left: 4px"
                  :type="q.quality_score >= 1 ? 'success' : q.quality_score >= 0.5 ? 'warning' : 'info'"
                >
                  {{ Math.round((q.quality_score || 0) * 100) }}%
                </el-tag>
              </el-tooltip>
            </div>
          </div>

          <!-- 配图：列表里给缩略图，点开看大图 -->
          <div v-if="q.figure_path" style="margin-top: 8px">
            <el-image
              :src="apiBase() + q.figure_path"
              :preview-src-list="[apiBase() + q.figure_path]"
              fit="contain"
              style="max-height: 90px; max-width: 220px; border: 1px solid var(--qb-border); border-radius: 6px"
              preview-teleported
            />
          </div>

          <div v-if="parseOptions(q).length" class="qb-q-options qb-formula">
            <div
              v-for="(opt, i) in parseOptions(q)"
              :key="i"
              class="qb-q-opt"
              v-html="renderInline(`${OPTION_LETTERS[i]}. ${opt}`)"
            />
          </div>

          <div v-if="q.answer" class="qb-q-answer qb-formula">
            <strong>答案：</strong>
            <span v-html="renderInline(q.answer)" />
          </div>
          <div v-if="q.analysis" class="qb-q-analysis qb-formula">
            <strong>解析：</strong>
            <span v-html="renderInline(q.analysis)" />
          </div>

          <div class="qb-q-meta">
            <!-- ★ 显示知识点**名称**（一期只显示难度/来源，看不出这题挂了什么知识点） -->
            <template v-if="kpNamesOf(q).length">
              <el-tag
                v-for="n in kpNamesOf(q)"
                :key="n"
                size="small"
                type="primary"
                effect="plain"
              >
                {{ n }}
              </el-tag>
            </template>
            <el-tag v-else size="small" effect="plain" type="info">未挂知识点</el-tag>
            <span v-if="q.chapter_id">章节：{{ chapterName.get(q.chapter_id) || '—' }}</span>
            <span>来源：{{ q.source }}</span>
            <span>录入：{{ q.created_by_name || '—' }}</span>
            <span>{{ String(q.updated_at || '').slice(0, 16) }}</span>
            <el-tag v-if="q.status !== '已启用'" size="small" type="info" effect="plain">
              {{ q.status }}
            </el-tag>
            <el-tag v-if="q.solve_method" size="small" type="success" effect="plain">
              {{ q.solve_method }}
            </el-tag>
            <el-tag v-if="q.exam_year" size="small" type="warning" effect="plain">
              {{ q.exam_year }}
            </el-tag>
            <span v-if="q.region">地区：{{ q.region }}</span>

            <div class="qb-grow" style="flex: 1"></div>

            <el-button
              v-if="canMutate(q)"
              link
              type="primary"
              size="small"
              @click="openEdit(q)"
            >
              编辑
            </el-button>
            <el-button
              v-else
              link
              size="small"
              disabled
              title="这道题是其他老师录入的"
            >
              只读
            </el-button>
            <el-button
              v-if="canMutate(q)"
              link
              type="danger"
              size="small"
              @click="remove(q)"
            >
              删除
            </el-button>
          </div>
        </div>
      </div>

      <el-pagination
        v-if="total > pageSize"
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        style="margin-top: 14px; justify-content: center"
      />
    </div>
  </div>

  <!-- 新增/ 编辑 -->
  <el-dialog
    v-model="dialogVisible"
    :title="editingId ? '编辑题目' : '新增题目'"
    width="860px"
    top="5vh"
    :close-on-click-modal="false"
  >
    <el-form label-width="76px">
      <el-form-item label="题型" required>
        <el-radio-group v-model="form.type">
          <el-radio-button v-for="t in TYPES" :key="t" :label="t" />
        </el-radio-group>
      </el-form-item>

      <el-form-item label="题干" required>
        <el-input
          v-model="form.stem"
          type="textarea"
          :rows="4"
          placeholder="支持 LaTeX 公式，如 $\frac{x^2}{2}$ 或 $\vec{a}$；保存后按公式渲染"
          @blur="checkDuplicate"
        />
        <div class="qb-hint" style="margin-top: 4px">
          题干编辑区暂为纯文本（不支持所见即所得的富文本），公式用 $...$ 包裹即可
        </div>
      </el-form-item>

      <div v-if="checkingDup" class="qb-hint">正在查重…</div>
      <div v-else-if="dupHint && (dupHint.exact.length || dupHint.similar.length)" class="qb-dup">
        <strong>⚠ 题库里可能已有这道题</strong>
        <div v-for="d in dupHint.exact" :key="`e${d.id}`" class="qb-dup-item">
          <el-tag size="small" type="danger">完全相同</el-tag>
          <span class="qb-formula" style="margin-left: 6px" v-html="renderInline(stemPreview(d.stem, 70))" />
        </div>
        <div v-for="d in dupHint.similar" :key="`s${d.id}`" class="qb-dup-item">
          <el-tag size="small" type="warning">疑似 {{ (d.similarity * 100).toFixed(0) }}% 相似</el-tag>
          <span class="qb-formula" style="margin-left: 6px" v-html="renderInline(stemPreview(d.stem, 70))" />
        </div>
      </div>

      <el-form-item v-if="form.type === '单选题' || form.type === '多选题'" label="选项">
        <div v-for="(_, i) in form.options" :key="i" style="display: flex; gap: 8px; margin-bottom: 6px">
          <el-tag style="width: 28px; justify-content: center">{{ OPTION_LETTERS[i] }}</el-tag>
          <el-input v-model="form.options[i]" :placeholder="`选项 ${OPTION_LETTERS[i]} 的内容（可用 LaTeX）`" />
        </div>
      </el-form-item>

      <el-form-item label="答案" required>
        <el-input v-model="form.answer" placeholder="选择题填字母；其他题型填答案本身（可用 LaTeX）" />
      </el-form-item>

      <el-form-item label="解析">
        <el-input v-model="form.analysis" type="textarea" :rows="3" placeholder="解题步骤与依据（可用 LaTeX）" />
      </el-form-item>

      <!-- 配图：几何图/函数图像类题目必需（一期缺这一环，AI 提示要上传却无处可传） -->
      <el-form-item label="配图">
        <div style="width: 100%">
          <div v-if="form.figure_path" style="margin-bottom: 8px">
            <el-image
              :src="apiBase() + form.figure_path"
              :preview-src-list="[apiBase() + form.figure_path]"
              fit="contain"
              style="max-height: 120px; max-width: 260px; border: 1px solid var(--qb-border); border-radius: 6px"
              preview-teleported
            />
            <div style="margin-top: 4px">
              <el-button link type="danger" size="small" @click="removeFigure">移除配图</el-button>
            </div>
          </div>
          <div>
            <input
              ref="figureInput"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              style="display: none"
              @change="(e: any) => { const f = e.target.files?.[0]; if (f) uploadFigure(f); e.target.value = ''; }"
            />
            <el-button :loading="uploadingFigure" @click="(figureInput as any)?.click()">
              {{ form.figure_path ? "更换配图" : "上传配图" }}
            </el-button>
            <span class="qb-hint" style="margin-left: 8px">
              支持 PNG / JPEG / WebP / GIF / SVG，上限 2MB
            </span>
          </div>
        </div>
      </el-form-item>

      <!-- 配图：几何图/函数图像类题目必需（一期缺这一环，AI 提示要上传却无处可传） -->
      <el-form-item label="配图">
        <div style="width: 100%">
          <div v-if="form.figure_path" style="margin-bottom: 8px">
            <el-image
              :src="apiBase() + form.figure_path"
              :preview-src-list="[apiBase() + form.figure_path]"
              fit="contain"
              style="max-height: 120px; max-width: 260px; border: 1px solid var(--qb-border); border-radius: 6px"
              preview-teleported
            />
            <div style="margin-top: 4px">
              <el-button link type="danger" size="small" @click="removeFigure">移除配图</el-button>
            </div>
          </div>
          <div>
            <input
              ref="figureInput"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              style="display: none"
              @change="(e: any) => { const f = e.target.files?.[0]; if (f) uploadFigure(f); e.target.value = ''; }"
            />
            <el-button :loading="uploadingFigure" @click="(figureInput as any)?.click()">
              {{ form.figure_path ? "更换配图" : "上传配图" }}
            </el-button>
            <span class="qb-hint" style="margin-left: 8px">
              支持 PNG / JPEG / WebP / GIF / SVG，上限 2MB
            </span>
          </div>
        </div>
      </el-form-item>

      <el-row :gutter="12">
        <el-col :span="8">
          <el-form-item label="难度">
            <el-rate v-model="form.difficulty" :max="5" :texts="['极易', '简单', '中等', '较难', '困难']" show-text />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="来源" required>
            <el-select v-model="form.source" placeholder="必选">
              <el-option v-for="s in SOURCES" :key="s" :label="s" :value="s" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="状态">
            <el-select v-model="form.status">
              <el-option v-for="s in STATUSES" :key="s" :label="s" :value="s" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="12">
        <el-col :span="12">
          <el-form-item label="知识点">
            <el-select
              v-model="form.kp_ids"
              multiple
              filterable
              clearable
              collapse-tags
              placeholder="可不选（通用题）"
            >
              <el-option
                v-for="k in kpOptionsFlat"
                :key="k.id"
                :label="k.label"
                :value="k.id"
              />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="章节">
            <el-select v-model="form.chapter_id" clearable placeholder="可不选">
              <el-option
                v-for="c in facets?.chapters || []"
                :key="c.id"
                :label="c.parent_id ? '　' + c.name : c.name"
                :value="c.id"
              />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="12">
        <el-col :span="8">
          <el-form-item label="解题方法">
            <el-input v-model="form.solve_method" placeholder="如：向量归一化" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="年份">
            <el-input-number v-model="form.exam_year" :min="1980" :max="2100" controls-position="right" style="width: 100%" />
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="地区">
            <el-input v-model="form.region" placeholder="如：北京" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="标签">
        <el-select
          v-model="form.custom_tags"
          multiple
          filterable
          allow-create
          default-first-option
          placeholder="可输入新标签，多个用回车分隔"
        >
          <el-option v-for="t in facets?.tags || []" :key="t.name" :label="t.name" :value="t.name" />
        </el-select>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>