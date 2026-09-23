<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import IconCheck from "~icons/ep/circle-check";
import IconPlus from "~icons/ep/plus";
import IconRefresh from "~icons/ep/refresh";
import IconUser from "~icons/ep/user";
import IconWarning from "~icons/ep/warning";
import AiPanel from "@/components/AiPanel.vue";
import { genTeachingFlow, type AiOutput } from "@/ai/generators";
import {
  classRecords,
  effectiveClassId,
  growthCapabilities,
  klass,
  loadGrowthForm,
  sourceMode,
  students,
  submitClassEval,
  submitKpAssessment,
  unit,
  type GrowthEvalForm
} from "@/workbench-data";

const steps = ref([
  { id: 1, name: "错题回顾", min: 5, goal: "把注意力拉回上次失分点", done: true },
  { id: 2, name: "性质再认识", min: 10, goal: "说清条件与结论，区分正反用法", done: true },
  { id: 3, name: "变式练习", min: 15, goal: "能在新情境中主动作垂线", done: false },
  { id: 4, name: "辅助线入门", min: 10, goal: "记住倍长中线三步走", done: false },
  { id: 5, name: "小结与布置", min: 5, goal: "学生能复述辅助线触发信号", done: false }
]);

const output = ref<AiOutput | null>(null);
const loading = ref(false);

/* 倒计时 */
const remain = ref(0);
const running = ref(false);
let timer: number | undefined;

const clock = computed(() => {
  const m = Math.floor(Math.max(0, remain.value) / 60);
  const s = Math.max(0, remain.value) % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
});

function startTimer(min: number) {
  stopTimer();
  remain.value = min * 60;
  running.value = true;
  timer = window.setInterval(() => {
    remain.value -= 1;
    if (remain.value <= 0) stopTimer();
  }, 1000);
}

function stopTimer() {
  if (timer) window.clearInterval(timer);
  timer = undefined;
  running.value = false;
}

onUnmounted(stopTimer);

/* 随机点名 */
const picked = ref("");
function pickStudent() {
  if (!students.value.length) return;
  const s = students.value[Math.floor(Math.random() * students.value.length)];
  picked.value = `${s.name}（${s.no}）`;
}

/* ------------------------- 课后采集（核心） ------------------------- */
/* 设计原则：老师上完课顺手记，不换页、不新增导航。
   第 1 层：三维评价（专注/参与/掌握）—— 10 秒可完成
   第 2 层：知识点打勾（三档）—— 1 分钟可完成
   两层都可跳过，永远不强制。 */

const today = new Date().toISOString().slice(0, 10);
const padOpen = ref(true);
const activeTab = ref<"eval" | "kp">("eval");

/* 采集表单（真实模式来自后端预填，demo 模式本地构造） */
const form = ref<GrowthEvalForm | null>(null);
const formLoading = ref(false);
const formError = ref("");

/** 本地 1-5 分选择器缓存：studentId -> {focus, participation, mastery} */
interface EvalDraft {
  focus: number;
  participation: number;
  mastery: number;
  note: string;
}
const drafts = ref<Record<number, EvalDraft>>({});
const dirtyIds = ref<Set<number>>(new Set());

/** 一键给全班填同一个分（老师最常用的操作：大部分孩子都一样） */
const bulk = ref({ focus: 4, participation: 4, mastery: 4 });

/* 知识点：本地选中状态 */
const kpLevels = ref<Record<number, string>>({});
const kpOverrides = ref<Record<string, string>>({}); // `${studentId}:${kpId}` -> level

const LEVEL_OPTIONS = ["未掌握", "部分掌握", "已掌握"];

const evalStudents = computed(() =>
  form.value?.students?.length
    ? form.value.students
    : students.value.map(s => ({
        id: s.id,
        no: s.no,
        name: s.name,
        evaluated: false,
        eval: null
      }))
);

const evalKps = computed(() => form.value?.knowledge_points || []);

/**
 * 按单元分组，供采集页做「单元 → 知识点」两级展示。
 * 后端只下发叶子知识点（可评定对象），单元名折叠在 unit_name 里；
 * 这里把它重新展开成标题，老师才知道这个知识点属于哪一章。
 */
const kpGroups = computed(() => {
  const groups: {
    unitNo: number;
    unitName: string;
    items: typeof evalKps.value;
  }[] = [];
  for (const k of evalKps.value) {
    const last = groups[groups.length - 1];
    if (last && last.unitNo === k.unit_no) {
      last.items.push(k);
    } else {
      groups.push({
        unitNo: k.unit_no,
        unitName: k.unit_name || `第 ${k.unit_no} 单元`,
        items: [k]
      });
    }
  }
  return groups;
});

/** 本单元已打勾数 / 总数（老师分组看进度用） */
function groupProgress(items: typeof evalKps.value) {
  const done = items.filter(k => !!kpLevels.value[k.id]).length;
  return `${done}/${items.length}`;
}

const dirtyCount = computed(() => dirtyIds.value.size);
const selectedKpCount = computed(
  () => Object.values(kpLevels.value).filter(Boolean).length
);

const canCollect = computed(() => growthCapabilities.value.canCollect);

function ensureDraft(id: number): EvalDraft {
  if (!drafts.value[id]) {
    const fromServer = form.value?.students.find(s => s.id === id)?.eval;
    drafts.value[id] = fromServer
      ? {
          focus: fromServer.focus,
          participation: fromServer.participation,
          mastery: fromServer.mastery,
          note: fromServer.note || ""
        }
      : { focus: 0, participation: 0, mastery: 0, note: "" };
  }
  return drafts.value[id];
}

function setScore(id: number, key: keyof Omit<EvalDraft, "note">, v: number) {
  const d = ensureDraft(id);
  d[key] = v;
  dirtyIds.value = new Set(dirtyIds.value).add(id);
}

function applyBulk() {
  const next = new Set(dirtyIds.value);
  for (const s of evalStudents.value) {
    drafts.value[s.id] = {
      ...ensureDraft(s.id),
      focus: bulk.value.focus,
      participation: bulk.value.participation,
      mastery: bulk.value.mastery
    };
    next.add(s.id);
  }
  dirtyIds.value = next;
}

function setKpLevel(kpId: number, level: string) {
  kpLevels.value[kpId] = kpLevels.value[kpId] === level ? "" : level;
}

/** 个别学员调整：先在每行选人，再选档位，两步走避免误操作 */
const overrideDraft = ref<Record<number, number | null>>({});

function commitOverride(kpId: number, level: string) {
  const sid = overrideDraft.value[kpId];
  if (!sid || !level) return;
  kpOverrides.value[`${sid}:${kpId}`] = level;
  overrideDraft.value[kpId] = null;
}

function removeOverride(key: string) {
  delete kpOverrides.value[key];
}

/* 提交 */
const submitting = ref(false);
const submitMsg = ref("");
const submitErr = ref("");

async function loadForm() {
  formError.value = "";
  if (!canCollect.value || !effectiveClassId.value) return;
  formLoading.value = true;
  try {
    form.value = await loadGrowthForm(effectiveClassId.value, today);
    drafts.value = {};
    dirtyIds.value = new Set();
    // 预填已评过的学生，老师只补没评的
    for (const s of form.value?.students || []) {
      if (s.eval) {
        drafts.value[s.id] = {
          focus: s.eval.focus,
          participation: s.eval.participation,
          mastery: s.eval.mastery,
          note: s.eval.note || ""
        };
      }
    }
  } catch (err) {
    formError.value = err instanceof Error ? err.message : "读取采集表单失败";
  } finally {
    formLoading.value = false;
  }
}

onMounted(() => {
  void loadForm();
});

// 切换班级 / 数据源后重新取预填数据
watch(
  () => [effectiveClassId.value, sourceMode.value],
  () => {
    form.value = null;
    kpLevels.value = {};
    kpOverrides.value = {};
    submitMsg.value = "";
    submitErr.value = "";
    void loadForm();
  }
);

async function saveEvaluations() {
  submitErr.value = "";
  submitMsg.value = "";
  const ids = [...dirtyIds.value];
  if (!ids.length) {
    submitErr.value = "还没有打分，先点一下分数或在上面「一键填全班」。";
    return;
  }
  const items = ids
    .map(id => {
      const d = drafts.value[id];
      if (!d) return null;
      // 没打分的按 3 分（中性）提交，避免 0 分污染统计
      return {
        student_id: id,
        focus: d.focus || 3,
        participation: d.participation || 3,
        mastery: d.mastery || 3,
        note: d.note || ""
      };
    })
    .filter(Boolean) as {
    student_id: number;
    focus: number;
    participation: number;
    mastery: number;
    note: string;
  }[];

  if (sourceMode.value !== "real") {
    // demo 模式：只做流程演示，不落库（界面已标注）
    submitMsg.value = `演示模式：已模拟提交 ${items.length} 名学员的课堂评价（不写入数据库）。`;
    dirtyIds.value = new Set();
    return;
  }

  submitting.value = true;
  try {
    const r = await submitClassEval({
      classId: effectiveClassId.value as number,
      evalDate: today,
      items
    });
    submitMsg.value = `已保存 ${r.saved} 名学员的课堂评价，成长路径新增 ${r.appended} 条记录。`;
    dirtyIds.value = new Set();
  } catch (err) {
    submitErr.value = err instanceof Error ? err.message : "提交失败";
  } finally {
    submitting.value = false;
  }
}

async function saveKpAssessment() {
  submitErr.value = "";
  submitMsg.value = "";
  const kps = Object.entries(kpLevels.value)
    .filter(([, v]) => !!v)
    .map(([id, level]) => ({ kp_id: Number(id), level }));

  if (!kps.length) {
    submitErr.value = "还没有勾选知识点等级，先在下面点「未掌握 / 部分掌握 / 已掌握」。";
    return;
  }
  const overrides = Object.entries(kpOverrides.value).map(([key, level]) => {
    const [sid, kid] = key.split(":").map(Number);
    return { student_id: sid, kp_id: kid, level };
  });

  if (sourceMode.value !== "real") {
    submitMsg.value = `演示模式：已模拟提交 ${kps.length} 个知识点的评定（不写入数据库）。`;
    return;
  }

  submitting.value = true;
  try {
    const r = await submitKpAssessment({
      classId: effectiveClassId.value as number,
      assessedAt: today,
      kps,
      overrides
    });
    submitMsg.value = `已记录 ${r.students} 名学员 × 本次 ${kps.length} 个知识点，共 ${r.records} 条评定。`;
    kpLevels.value = {};
    kpOverrides.value = {};
    overrideDraft.value = {};
  } catch (err) {
    submitErr.value = err instanceof Error ? err.message : "提交失败";
  } finally {
    submitting.value = false;
  }
}

/* 快捷标记（课后一句话备注，跟随三维评价一起提交） */
const markStudent = ref<number | null>(null);
const markNote = ref("");
const marks = ref<{ id: number; student: string; tag: string; note: string }[]>([]);

function addMark() {
  const s = students.value.find(x => x.id === markStudent.value);
  if (!s) return;
  const text = markNote.value.trim();
  if (!text) return;
  marks.value.unshift({
    id: Date.now(),
    student: s.name,
    tag: "课堂观察",
    note: text
  });
  // 同步写进该生的评价备注，提交时一起落库
  const d = ensureDraft(s.id);
  d.note = text;
  dirtyIds.value = new Set(dirtyIds.value).add(s.id);
  markNote.value = "";
  markStudent.value = null;
}

async function run() {
  loading.value = true;
  try {
    output.value = await genTeachingFlow();
  } finally {
    loading.value = false;
  }
}

const doneCount = computed(() => steps.value.filter(s => s.done).length);

/* 上次课记录（让老师知道上次记到哪） */
const lastRecord = computed(() => classRecords.value[0] || null);
const lastMark = computed(() => lastRecord.value?.note || "");
</script>

<template>
  <div class="page">
    <section class="card">
      <div class="card-head">
        <div class="card-title">课堂环节卡</div>
        <span class="card-sub">
          {{ unit.no }}{{ unit.name }} · 第 {{ unit.next.no }} 课时 · 已完成
          {{ doneCount }}/{{ steps.length }} 环节
        </span>
      </div>
      <div class="card-body">
        <div v-for="s in steps" :key="s.id" class="step" :class="{ done: s.done }">
          <el-checkbox v-model="s.done" />
          <div class="step-main">
            <div class="step-name">{{ s.name }}</div>
            <div class="step-goal">{{ s.goal }}</div>
          </div>
          <div class="step-min">{{ s.min }} 分钟</div>
          <button class="mini-btn" type="button" @click="startTimer(s.min)">计时</button>
        </div>
      </div>
    </section>

    <div class="grid-3">
      <section class="card">
        <div class="card-head"><div class="card-title">倒计时</div></div>
        <div class="card-body center">
          <div class="clock" :class="{ running }">{{ clock }}</div>
          <div class="btn-row">
            <el-button size="small" type="primary" @click="startTimer(12)">12 分钟</el-button>
            <el-button size="small" @click="startTimer(5)">5 分钟</el-button>
            <el-button size="small" @click="stopTimer">停止</el-button>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><div class="card-title">随机点名</div></div>
        <div class="card-body center">
          <div class="picked">
            <IconUser v-if="!picked" class="picked-icon" />
            <span v-if="picked">{{ picked }}</span>
            <span v-else class="picked-empty">点击下方按钮抽取</span>
          </div>
          <el-button size="small" @click="pickStudent">
            <template #icon><IconRefresh /></template>
            抽一位
          </el-button>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-title">课堂随手记</div>
          <span class="card-sub">写进该生课后评价</span>
        </div>
        <div class="card-body">
          <el-select v-model="markStudent" placeholder="选择学生" size="small" filterable>
            <el-option v-for="s in students" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
          <el-input
            v-model="markNote"
            size="small"
            placeholder="一句话说明，如：变式题第 2 题卡住"
            style="margin-top: 8px"
            @keyup.enter="addMark"
          />
          <el-button
            size="small"
            type="primary"
            style="margin-top: 8px; width: 100%"
            :disabled="!markStudent || !markNote.trim()"
            @click="addMark"
          >
            <template #icon><IconPlus /></template>
            记一句
          </el-button>
        </div>
      </section>
    </div>

    <!-- ───────────── 课后采集（本页核心） ───────────── -->
    <section class="card collect" :class="{ 'no-print': true }">
      <div class="card-head">
        <div class="card-title">
          <IconCheck class="collect-icon" />
          课后记录 · {{ klass.name }}
          <span class="tag tag-gray">{{ today }}</span>
          <span v-if="canCollect" class="tag tag-green">已接入教务数据</span>
          <span v-else class="tag tag-amber">演示模式</span>
        </div>
        <button class="ghost-btn" type="button" @click="padOpen = !padOpen">
          {{ padOpen ? "收起" : "展开录入" }}
        </button>
      </div>

      <div v-if="!padOpen" class="card-body collapsed">
        <span v-if="dirtyCount || selectedKpCount">
          待提交：{{ dirtyCount }} 名学员评价 ·
          {{ selectedKpCount }} 个知识点。点「展开录入」继续。
        </span>
        <span v-else>本课还没记录。展开后约 10 秒可完成评价，1 分钟可完成知识点打勾。</span>
      </div>

      <template v-else>
        <div class="tabs">
          <button
            class="tab"
            :class="{ on: activeTab === 'eval' }"
            type="button"
            @click="activeTab = 'eval'"
          >
            ① 课堂评价
            <span class="tab-note">约 10 秒</span>
          </button>
          <button
            class="tab"
            :class="{ on: activeTab === 'kp' }"
            type="button"
            @click="activeTab = 'kp'"
          >
            ② 知识点打勾
            <span class="tab-note">约 1 分钟</span>
          </button>
        </div>

        <div v-if="formError" class="notice notice-err">
          <IconWarning />
          {{ formError }}
        </div>

        <!-- ① 三维评价 -->
        <div v-show="activeTab === 'eval'" class="card-body">
          <div class="bulk">
            <span class="bulk-label">一键填全班</span>
            <div v-for="k in ['focus', 'participation', 'mastery']" :key="k" class="bulk-item">
              <span class="bulk-k">
                {{ k === "focus" ? "专注" : k === "participation" ? "参与" : "掌握" }}
              </span>
              <div class="dots">
                <button
                  v-for="n in 5"
                  :key="n"
                  class="dot"
                  :class="{ on: bulk[k as 'focus'] === n }"
                  type="button"
                  @click="bulk[k as 'focus'] = n"
                >
                  {{ n }}
                </button>
              </div>
            </div>
            <el-button size="small" @click="applyBulk">套用到全部学员</el-button>
          </div>

          <div v-if="formLoading" class="empty">读取班级名单与预填数据…</div>
          <div v-else-if="!evalStudents.length" class="empty">
            当前班级还没有在读学员，先到教务系统建档。
          </div>
          <div v-else class="eval-list">
            <div
              v-for="s in evalStudents"
              :key="s.id"
              class="eval-row"
              :class="{ done: s.evaluated && !dirtyIds.has(s.id), dirty: dirtyIds.has(s.id) }"
            >
              <div class="eval-who">
                <span class="eval-name">{{ s.name }}</span>
                <span class="eval-no">{{ s.no }}</span>
                <span v-if="s.evaluated && !dirtyIds.has(s.id)" class="tag tag-green">已评</span>
                <span v-else-if="dirtyIds.has(s.id)" class="tag tag-amber">待提交</span>
              </div>
              <div v-for="k in ['focus', 'participation', 'mastery']" :key="k" class="eval-cell">
                <span class="eval-k">
                  {{ k === "focus" ? "专注" : k === "participation" ? "参与" : "掌握" }}
                </span>
                <div class="dots">
                  <button
                    v-for="n in 5"
                    :key="n"
                    class="dot"
                    :class="{ on: ensureDraft(s.id)[k as 'focus'] === n }"
                    type="button"
                    @click="setScore(s.id, k as 'focus', n)"
                  >
                    {{ n }}
                  </button>
                </div>
              </div>
              <el-input
                v-model="ensureDraft(s.id).note"
                size="small"
                class="eval-note"
                placeholder="备注（可选）"
                @input="dirtyIds = new Set(dirtyIds).add(s.id)"
              />
            </div>
          </div>

          <div class="collect-foot">
            <span class="foot-hint">
              未打分的学员按 3 分（中性）提交，不会把空白算成 0 分。
              <template v-if="dirtyCount">本次待提交 {{ dirtyCount }} 人。</template>
            </span>
            <el-button type="primary" :loading="submitting" @click="saveEvaluations">
              保存课堂评价
            </el-button>
          </div>
        </div>

        <!-- ② 知识点打勾 -->
        <div v-show="activeTab === 'kp'" class="card-body">
          <div v-if="!evalKps.length" class="empty">
            本班课程还没有配知识点。<br />
            知识点属于「真实库已有知识体系」才有数据 —— 请先在知识库中为这门课建立知识点。
          </div>
          <template v-else>
            <div class="kp-hint">
              先给全班一个默认档位，再对个别学员单独调（不调就跟随全班）。
              每节课都记一次，即使档位没变 —— <strong>这条记录本身就是成长的过程证据</strong>。
            </div>
            <div class="kp-list">
              <template v-for="g in kpGroups" :key="g.unitNo">
                <div class="kp-unit">
                  <span class="kp-unit-name">{{ g.unitName }}</span>
                  <span class="kp-unit-prog">{{ groupProgress(g.items) }}</span>
                </div>
                <div v-for="k in g.items" :key="k.id" class="kp-row">
                  <div class="kp-who">
                    <span class="kp-code">{{ k.code }}</span>
                    <span class="kp-name">{{ k.name }}</span>
                    <span class="kp-diff" :title="`难度 ${k.difficulty}`">
                      难度 {{ k.difficulty }}
                    </span>
                  </div>
                  <div class="kp-choice">
                    <button
                      v-for="lv in LEVEL_OPTIONS"
                      :key="lv"
                      class="lv-btn"
                      :class="[lv === '未掌握' ? 'lv-low' : lv === '部分掌握' ? 'lv-mid' : 'lv-high', { on: kpLevels[k.id] === lv }]"
                      type="button"
                      @click="setKpLevel(k.id, lv)"
                    >
                      {{ lv }}
                    </button>
                  </div>
                  <div v-if="kpLevels[k.id]" class="kp-override">
                    <el-select
                      v-model="overrideDraft[k.id]"
                      size="small"
                      filterable
                      clearable
                      placeholder="个别学员单独调"
                      style="width: 130px"
                    >
                      <el-option
                        v-for="s in evalStudents"
                        :key="s.id"
                        :label="s.name"
                        :value="s.id"
                      />
                    </el-select>
                    <el-select
                      v-if="overrideDraft[k.id]"
                      size="small"
                      placeholder="调成"
                      style="width: 104px"
                      @change="(v: string) => commitOverride(k.id, v)"
                    >
                      <el-option v-for="lv in LEVEL_OPTIONS" :key="lv" :label="lv" :value="lv" />
                    </el-select>
                  </div>
                </div>
              </template>
            </div>

            <div v-if="Object.keys(kpOverrides).length" class="override-list">
              <div class="sec-title">个别学员调整</div>
              <div v-for="(lv, key) in kpOverrides" :key="key" class="ov-row">
                <span class="ov-name">
                  {{ evalStudents.find(s => s.id === Number(String(key).split(":")[0]))?.name || "—" }}
                </span>
                <span class="ov-kp">
                  {{ evalKps.find(k => k.id === Number(String(key).split(":")[1]))?.name || "—" }}
                </span>
                <span class="tag tag-blue">{{ lv }}</span>
                <button class="ov-del" type="button" @click="removeOverride(key)">移除</button>
              </div>
            </div>

            <div class="collect-foot">
              <span class="foot-hint">
                已勾选 {{ selectedKpCount }} 个知识点，将记录给
                {{ evalStudents.length }} 名学员。
              </span>
              <el-button type="primary" :loading="submitting" @click="saveKpAssessment">
                保存知识点评定
              </el-button>
            </div>
          </template>
        </div>

        <div v-if="submitMsg" class="notice notice-ok">{{ submitMsg }}</div>
        <div v-if="submitErr" class="notice notice-err">
          <IconWarning />
          {{ submitErr }}
        </div>
      </template>
    </section>

    <section v-if="marks.length" class="card no-print">
      <div class="card-head">
        <div class="card-title">本课随手记</div>
        <span class="card-sub">已并入对应学员的课后备注，提交后进入成长路径</span>
      </div>
      <div class="card-body">
        <div v-for="m in marks" :key="m.id" class="mark">
          <span class="mark-stu">{{ m.student }}</span>
          <span class="tag tag-blue">{{ m.tag }}</span>
          <span class="mark-note">{{ m.note }}</span>
        </div>
      </div>
    </section>

    <AiPanel
      title="AI 授课流程"
      sub="按课时输出环节卡、快捷工具与本课观察重点"
      :output="output"
      :loading="loading"
      action-text="生成授课流程"
      hint="授课流程依附当前课时生成，不单独占导航；课后记录会实时写入成长路径，形成可追溯的过程证据。"
      @generate="run"
    />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.grid-3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.step {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px dashed var(--c-border);
}

.step:last-child {
  border-bottom: none;
}

.step-main {
  flex: 1;
  min-width: 0;
}

.step-name {
  font-size: 13px;
  font-weight: 500;
}

.step.done .step-name {
  color: var(--c-text-3);
  text-decoration: line-through;
}

.step-goal {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--c-text-3);
}

.step-min {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--c-text-2);
}

.mini-btn {
  flex-shrink: 0;
  height: 24px;
  padding: 0 9px;
  font-family: inherit;
  font-size: 11.5px;
  color: var(--c-primary-dark);
  cursor: pointer;
  background: var(--c-primary-soft);
  border: 1px solid var(--c-primary-line);
  border-radius: 6px;
}

.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 126px;
}

.clock {
  font-size: 30px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--c-text);
}

.clock.running {
  color: var(--c-primary);
}

.btn-row {
  display: flex;
  gap: 6px;
}

.picked {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  font-size: 15px;
  font-weight: 500;
}

.picked-icon {
  font-size: 20px;
  color: var(--c-text-3);
}

.picked-empty {
  font-size: 12.5px;
  font-weight: 400;
  color: var(--c-text-3);
}

.mark {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  font-size: 12.5px;
  border-bottom: 1px dashed var(--c-border);
}

.mark:last-child {
  border-bottom: none;
}

.mark-stu {
  flex-shrink: 0;
  font-weight: 500;
}

.mark-note {
  color: var(--c-text-2);
}

/* ───────────── 课后采集 ───────────── */
.collect {
  border-color: var(--c-primary-line);
}

.collect-icon {
  font-size: 15px;
  color: var(--c-primary);
}

.card-body.collapsed {
  font-size: 12.5px;
  color: var(--c-text-3);
}

.ghost-btn {
  height: 28px;
  padding: 0 12px;
  font-family: inherit;
  font-size: 12px;
  color: var(--c-text-2);
  cursor: pointer;
  background: #fff;
  border: 1px solid var(--c-border-strong);
  border-radius: 7px;
}

.ghost-btn:hover {
  color: var(--c-primary-dark);
  border-color: var(--c-primary-line);
  background: var(--c-primary-soft);
}

.tabs {
  display: flex;
  gap: 6px;
  padding: 10px 18px 0;
  border-bottom: 1px solid var(--c-border);
}

.tab {
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  padding: 8px 14px;
  font-family: inherit;
  font-size: 13px;
  color: var(--c-text-2);
  cursor: pointer;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  transition: all 0.15s;
}

.tab.on {
  font-weight: 600;
  color: var(--c-primary-dark);
  border-bottom-color: var(--c-primary);
}

.tab-note {
  font-size: 11px;
  font-weight: 400;
  color: var(--c-text-3);
}

.notice {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 18px;
  font-size: 12.5px;
  border-top: 1px solid var(--c-border);
}

.notice-ok {
  color: color-mix(in srgb, var(--c-success) 78%, #000);
  background: var(--c-success-soft);
}

.notice-err {
  color: color-mix(in srgb, var(--c-danger) 82%, #000);
  background: var(--c-danger-soft);
}

.bulk {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  padding: 11px 14px;
  margin-bottom: 14px;
  background: var(--c-surface-2);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
}

.bulk-label {
  font-size: 12.5px;
  font-weight: 500;
}

.bulk-item {
  display: flex;
  align-items: center;
  gap: 7px;
}

.bulk-k {
  font-size: 12px;
  color: var(--c-text-3);
}

.dots {
  display: flex;
  gap: 3px;
}

.dot {
  width: 24px;
  height: 24px;
  font-family: inherit;
  font-size: 11.5px;
  color: var(--c-text-2);
  cursor: pointer;
  background: #fff;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--radius-sm);
  font-variant-numeric: tabular-nums;
  transition: all 0.12s;
}

.dot:hover {
  border-color: var(--c-primary-line);
  background: var(--c-primary-soft);
}

.dot.on {
  font-weight: 600;
  color: #fff;
  background: var(--c-primary);
  border-color: var(--c-primary);
}

.eval-list {
  border-top: 1px solid var(--c-border);
}

.eval-row {
  display: grid;
  grid-template-columns: 132px repeat(3, auto) minmax(120px, 1fr);
  align-items: center;
  gap: 14px;
  padding: 9px 0;
  border-bottom: 1px dashed var(--c-border);
}

.eval-row.dirty {
  background: color-mix(in srgb, var(--c-warn) 5%, #fff);
}

.eval-who {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.eval-name {
  font-size: 13px;
  font-weight: 500;
}

.eval-no {
  font-size: 11px;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}

.eval-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.eval-k {
  font-size: 11.5px;
  color: var(--c-text-3);
}

.eval-note {
  min-width: 120px;
}

.collect-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 14px;
  margin-top: 14px;
  border-top: 1px solid var(--c-border);
}

.foot-hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--c-text-3);
}

.kp-hint {
  padding: 10px 12px;
  margin-bottom: 14px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--c-text-2);
  background: var(--c-primary-soft);
  border-radius: var(--radius);
}

.kp-list {
  border-top: 1px solid var(--c-border);
}

/* 单元分组标题：知识点属于哪一章，以及本单元打勾进度 */
.kp-unit {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  padding: 6px 2px 6px 10px;
  border-left: 3px solid var(--c-primary);
  background: var(--c-primary-soft, rgba(31, 92, 153, 0.05));
  border-radius: 2px 4px 4px 2px;
}

.kp-unit:first-child {
  margin-top: 0;
}

.kp-unit-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text-1);
}

.kp-unit-prog {
  font-size: 12px;
  color: var(--c-text-2);
  font-variant-numeric: tabular-nums;
}

.kp-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--c-border);
}

.kp-who {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 250px;
}

.kp-code {
  padding: 1px 6px;
  font-size: 11px;
  color: var(--c-text-2);
  background: var(--c-surface-2);
  border-radius: var(--radius-sm);
  font-variant-numeric: tabular-nums;
}

.kp-name {
  font-size: 13px;
  font-weight: 500;
}

.kp-diff {
  font-size: 11px;
  color: var(--c-text-3);
}

.kp-choice {
  display: flex;
  gap: 4px;
}

.lv-btn {
  height: 26px;
  padding: 0 11px;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  background: #fff;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--radius-sm);
  transition: all 0.12s;
}

.lv-btn:hover {
  border-color: var(--c-border-strong);
}

.lv-low.on {
  color: #fff;
  background: var(--c-danger);
  border-color: var(--c-danger);
}

.lv-mid.on {
  color: #fff;
  background: var(--c-warn);
  border-color: var(--c-warn);
}

.lv-high.on {
  color: #fff;
  background: var(--c-success);
  border-color: var(--c-success);
}

.kp-override {
  display: inline-flex;
  gap: 6px;
}

.override-list {
  margin-top: 16px;
}

.ov-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  font-size: 12.5px;
  border-bottom: 1px dashed var(--c-border);
}

.ov-name {
  min-width: 62px;
  font-weight: 500;
}

.ov-kp {
  flex: 1;
  color: var(--c-text-2);
}

.ov-del {
  font-family: inherit;
  font-size: 11.5px;
  color: var(--c-text-3);
  cursor: pointer;
  background: none;
  border: none;
}

.ov-del:hover {
  color: var(--c-danger);
}

@media (max-width: 1200px) {
  .grid-3 {
    grid-template-columns: 1fr;
  }

  .eval-row {
    grid-template-columns: 1fr;
    gap: 7px;
  }
}
</style>
