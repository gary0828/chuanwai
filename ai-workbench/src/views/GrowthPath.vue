<script setup lang="ts">
/**
 * 学生成长路径
 *
 * 产品立意（2026-09-18 用户定调）：
 * "看到每一名学生的成长，用多个维度的数据来证实学生在机构的成长……
 *  见证学生的每一步过程，看到孩子如何从 0 到成功。"
 *
 * 因此本页不做"成绩单"，做**过程证据链**：
 *   - 整班视角：谁在进步、卡在哪个知识点、班级课堂表现趋势
 *   - 单学员视角：起点 vs 现在、每一次跃迁发生在哪天、里程碑时间轴
 *
 * 数据来源：GET /api/growth/classes/:id/growth 与 /students/:id/growth
 * 数字全部由后端本地计算，AI 只负责把结果写成叙述（AiPanel）。
 */
import { computed, ref, watch } from "vue";
import IconPrinter from "~icons/ep/printer";
import AiPanel from "@/components/AiPanel.vue";
import KpBar from "@/components/KpBar.vue";
import LineChart, { type LineSeries } from "@/components/LineChart.vue";
import { genReportNarrative, type AiOutput } from "@/ai/generators";
import { currentUser } from "@/session";
import {
  effectiveClassId,
  klass,
  loadClassGrowth,
  loadStudentGrowth,
  loadStudentTimeline,
  sourceMode,
  students,
  type ClassGrowth,
  type StudentGrowth,
  type StudentTimeline
} from "@/workbench-data";

const me = currentUser();
const isAdmin = me.role === "admin";

/* ---------------------------- 状态 ---------------------------- */
const view = ref<"class" | "student">("class");
const studentId = ref<number | null>(null);
const output = ref<AiOutput | null>(null);
const loading = ref(false);

const classGrowth = ref<ClassGrowth | null>(null);
const studentGrowth = ref<StudentGrowth | null>(null);
const timeline = ref<StudentTimeline | null>(null);
const bus = ref<{ class: string; student: string }>({ class: "", student: "" });
const busy = ref(false);

const realMode = computed(() => sourceMode.value === "real");

async function loadClass() {
  bus.value.class = "";
  classGrowth.value = null;
  // demo 模式也取数（返回内置演示轨迹），否则整页空白看不出功能
  if (realMode.value && !effectiveClassId.value) return;
  busy.value = true;
  try {
    classGrowth.value = await loadClassGrowth(effectiveClassId.value || 0);
  } catch (err) {
    bus.value.class = err instanceof Error ? err.message : "读取班级成长数据失败";
  } finally {
    busy.value = false;
  }
}

async function loadStudent() {
  bus.value.student = "";
  studentGrowth.value = null;
  timeline.value = null;
  if (realMode.value && !studentId.value) return;
  busy.value = true;
  try {
    const [g, t] = await Promise.all([
      loadStudentGrowth(studentId.value || 0),
      loadStudentTimeline(studentId.value || 0)
    ]);
    studentGrowth.value = g;
    timeline.value = t;
  } catch (err) {
    bus.value.student = err instanceof Error ? err.message : "读取学员成长数据失败";
  } finally {
    busy.value = false;
  }
}

watch(
  () => [effectiveClassId.value, sourceMode.value],
  () => {
    void loadClass();
    if (studentId.value) void loadStudent();
  },
  { immediate: true }
);

watch(studentId, () => {
  output.value = null;
  void loadStudent();
});

watch(view, () => {
  output.value = null;
});

/* ------------------------ 单学员：列表与默认选中 ------------------------ */
const studentList = computed(() =>
  classGrowth.value?.students?.length
    ? classGrowth.value.students.map(s => ({ id: s.id, name: s.name, no: s.student_no }))
    : students.value.map(s => ({ id: s.id, name: s.name, no: s.no }))
);

watch(
  () => studentList.value.length,
  () => {
    if (!studentId.value && studentList.value.length) {
      studentId.value = studentList.value[0].id;
    }
  },
  { immediate: true }
);

/* ------------------------------ 图表 ------------------------------ */

const C_FOCUS = "#1f5c99";
const C_PART = "#2e7d5b";
const C_MASTER = "#b7791f";
const C_EXAM = "#1f5c99";
const C_ATT = "#2e7d5b";

/** 整班课堂表现曲线（三维） */
const classEvalSeries = computed<LineSeries[]>(() => {
  const rows = classGrowth.value?.evalSeries || [];
  if (!rows.length) return [];
  return [
    {
      name: "专注度",
      color: C_FOCUS,
      points: rows.map(r => ({ x: r.eval_date, y: r.focus }))
    },
    {
      name: "参与度",
      color: C_PART,
      points: rows.map(r => ({ x: r.eval_date, y: r.participation }))
    },
    {
      name: "掌握度",
      color: C_MASTER,
      points: rows.map(r => ({ x: r.eval_date, y: r.mastery }))
    }
  ];
});

/** 单学员课堂表现曲线 */
const studentEvalSeries = computed<LineSeries[]>(() => {
  const rows = studentGrowth.value?.evalTrend || [];
  if (!rows.length) return [];
  return [
    {
      name: "专注度",
      color: C_FOCUS,
      points: rows.map(r => ({ x: r.date, y: r.focus }))
    },
    {
      name: "参与度",
      color: C_PART,
      points: rows.map(r => ({ x: r.date, y: r.participation }))
    },
    {
      name: "掌握度",
      color: C_MASTER,
      points: rows.map(r => ({ x: r.date, y: r.mastery }))
    }
  ];
});

/** 单学员成绩曲线（百分制量程，单独一张图） */
const studentExamSeries = computed<LineSeries[]>(() => {
  const rows = studentGrowth.value?.examSeries || [];
  if (!rows.length) return [];
  return [
    {
      name: "得分率",
      color: C_EXAM,
      points: rows.map(r => ({ x: r.date, y: r.rate }))
    }
  ];
});

/* ------------------------------ 摘要 ------------------------------ */

const classKpSorted = computed(() => {
  const rows = classGrowth.value?.kpMastery || [];
  return [...rows].sort((a, b) => (a.masteryRate ?? 101) - (b.masteryRate ?? 101));
});

const weakKp = computed(() => classKpSorted.value.filter(k => (k.masteryRate ?? 0) < 60).slice(0, 6));
const strongKp = computed(() =>
  [...classKpSorted.value].reverse().filter(k => (k.masteryRate ?? 0) >= 80).slice(0, 6)
);

const evalSummary = computed(() => {
  const rows = classGrowth.value?.evalSeries || [];
  if (rows.length < 2) return null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  return {
    sessions: rows.length,
    focus: Math.round((last.focus - first.focus) * 10) / 10,
    participation: Math.round((last.participation - first.participation) * 10) / 10,
    mastery: Math.round((last.mastery - first.mastery) * 10) / 10,
    from: first.eval_date,
    to: last.eval_date
  };
});

const delta = computed(() => studentGrowth.value?.evalDelta || null);

const improved = computed(() =>
  (studentGrowth.value?.kpProgress || []).filter(k => k.delta > 0)
);

const needWork = computed(() =>
  (studentGrowth.value?.kpProgress || [])
    .filter(k => k.to !== "已掌握")
    .slice(0, 8)
);

const selectedName = computed(
  () => studentList.value.find(s => s.id === studentId.value)?.name || ""
);

/**
 * 时间范围文案。
 * 后端未传 from/to 时用 '0000-01-01' / '9999-12-31' 作为开区间哨兵，
 * 直接显示会变成「至 9999-12-31」这种可笑的结果 —— 这里换成真实数据的跨度：
 * 用该学员时间轴里最早与最晚事件的日期。
 */
const rangeText = computed(() => {
  const r = studentGrowth.value?.range;
  if (!r) return "";

  const dates = [
    ...(studentGrowth.value?.evalTrend || []).map(e => e.date),
    ...(studentGrowth.value?.examSeries || []).map(e => e.date),
    ...(studentGrowth.value?.milestones || []).map(m => m.date),
    ...(timeline.value?.events || []).map(e => e.date)
  ]
    .filter(Boolean)
    .sort();

  const from = r.from !== "0000-01-01" ? r.from : dates[0];
  const to = r.to !== "9999-12-31" ? r.to : dates[dates.length - 1];

  if (!from || !to) return "暂无记录";
  if (from === to) return from;
  return `${from} 至 ${to}`;
});

/* 里程碑按年份分组，让时间轴读起来像一条路径 */
const milestonesByMonth = computed(() => {
  const list = studentGrowth.value?.milestones || [];
  const map = new Map<string, typeof list>();
  for (const m of list) {
    const key = m.date.slice(0, 7);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(m);
  }
  return [...map.entries()].map(([month, items]) => ({ month, items }));
});

/* 时间轴明细（按类型着色） */
const TYPE_TAG: Record<string, string> = {
  attendance: "tag-gray",
  exam_score: "tag-blue",
  class_eval: "tag-green",
  kp_assessment: "tag-amber",
  hour_change: "tag-cyan",
  milestone: "tag-red",
  note: "tag-gray"
};

const timelineDesc = computed(() =>
  [...(timeline.value?.events || [])].reverse().slice(0, 60)
);

/* ------------------------------ AI 叙述 ------------------------------ */

async function run() {
  if (!studentId.value) return;
  loading.value = true;
  try {
    output.value = await genReportNarrative(
      studentId.value,
      isAdmin ? "campus" : "teacher"
    );
  } finally {
    loading.value = false;
  }
}

function printReport() {
  window.print();
}

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v.toFixed(1)}%`;
}

function signed(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
}
</script>

<template>
  <div class="page">
    <!-- 顶部：视图切换 -->
    <section class="card no-print">
      <div class="card-head">
        <div class="card-title">
          成长路径 · {{ klass.name }}
          <span v-if="realMode" class="tag tag-green">教务数据</span>
          <span v-else class="tag tag-amber">演示数据</span>
        </div>
        <div class="tools">
          <el-radio-group v-model="view" size="small">
            <el-radio-button value="class">整班</el-radio-button>
            <el-radio-button value="student">单个学员</el-radio-button>
          </el-radio-group>
          <el-select
            v-if="view === 'student'"
            v-model="studentId"
            size="small"
            filterable
            style="width: 170px"
          >
            <el-option
              v-for="s in studentList"
              :key="s.id"
              :label="`${s.name}（${s.no}）`"
              :value="s.id"
            />
          </el-select>
          <button
            v-if="view === 'student'"
            class="ghost-btn"
            type="button"
            @click="printReport"
          >
            <IconPrinter />
            打印 / 另存为 PDF
          </button>
        </div>
      </div>
      <div v-if="!realMode" class="card-body pad-note">
        当前展示<strong>演示成长轨迹</strong>，用于说明这个页面能做什么。
        要看到真实数据，请把顶部数据源切到「真实教务数据」，并在「授课流程」页完成课后记录。
      </div>
      <div v-else-if="!effectiveClassId" class="card-body pad-note">
        还没有选择班级，请先在顶部选择要查看的班级。
      </div>
    </section>

    <!-- ───────────── 整班视角 ───────────── -->
    <template v-if="view === 'class'">
      <div v-if="bus.class" class="card"><div class="empty">{{ bus.class }}</div></div>

      <template v-if="classGrowth">
        <div class="metrics">
          <div class="metric">
            <div class="metric-label">班级学员</div>
            <div class="metric-value">{{ classGrowth.studentCount }}<small>人</small></div>
          </div>
          <div class="metric">
            <div class="metric-label">已记录课时</div>
            <div class="metric-value">{{ evalSummary?.sessions ?? 0 }}<small>次</small></div>
          </div>
          <div class="metric">
            <div class="metric-label">已评定知识点</div>
            <div class="metric-value">{{ classGrowth.kpMastery.length }}<small>个</small></div>
          </div>
          <div class="metric">
            <div class="metric-label">掌握度变化</div>
            <div class="metric-value" :class="evalSummary && evalSummary.mastery >= 0 ? 'up' : 'down'">
              {{ evalSummary ? signed(evalSummary.mastery) : "—" }}
            </div>
          </div>
        </div>

        <section class="card">
          <div class="card-head">
            <div class="card-title">班级课堂表现趋势</div>
            <span class="card-sub">
              每次课的班级均值（1-5 分）
              <template v-if="evalSummary">
                · 对比 {{ evalSummary.from }} → {{ evalSummary.to }}
              </template>
            </span>
          </div>
          <div class="card-body">
            <LineChart
              v-if="classEvalSeries.length"
              :series="classEvalSeries"
              :height="190"
              :min="1"
              :max="5"
              fit-data
              show-area
            />
            <div v-else class="empty">
              还没有课堂评价记录。<br />
              到「授课流程」页做一次课后记录，这里就会出现班级成长曲线。
            </div>
            <div v-if="classEvalSeries.length" class="axis-note">
              纵轴按实际取值区间自适应（避免把 3.5→4.2 压成一条直线）。
              各次课的参评人数见右表 ——
              <strong>人数不一致的课时之间不宜直接比较</strong>。
            </div>
          </div>
        </section>

        <section v-if="classGrowth.evalSeries.length" class="card">
          <div class="card-head">
            <div class="card-title">各次课明细</div>
            <span class="card-sub">参评人数是这条曲线口径是否可比的依据</span>
          </div>
          <div class="card-body">
            <table class="kp-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th class="ta-r">参评人数</th>
                  <th class="ta-r">专注度</th>
                  <th class="ta-r">参与度</th>
                  <th class="ta-r">掌握度</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in [...classGrowth.evalSeries].reverse()"
                  :key="r.eval_date"
                >
                  <td class="num">{{ r.eval_date }}</td>
                  <td class="ta-r num" :class="{ warn: r.n < classGrowth.studentCount }">
                    {{ r.n }} / {{ classGrowth.studentCount }}
                  </td>
                  <td class="ta-r num">{{ r.focus.toFixed(2) }}</td>
                  <td class="ta-r num">{{ r.participation.toFixed(2) }}</td>
                  <td class="ta-r num">{{ r.mastery.toFixed(2) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div class="grid-2">
          <section class="card">
            <div class="card-head">
              <div class="card-title">掌握度待加强</div>
              <span class="card-sub">已掌握比例 &lt; 60%</span>
            </div>
            <div class="card-body">
              <template v-if="weakKp.length">
                <KpBar
                  v-for="k in weakKp"
                  :key="k.kpId"
                  :name="k.name"
                  :value="k.masteryRate ?? 0"
                  :meta="`${k.mastered}/${k.assessed} 人已掌握`"
                />
              </template>
              <div v-else class="empty">
                <template v-if="classGrowth.kpMastery.length">
                  所有已评定知识点的掌握率都在 60% 以上。
                </template>
                <template v-else>还没有知识点评定记录。</template>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div class="card-title">已较好掌握</div>
              <span class="card-sub">已掌握比例 ≥ 80%</span>
            </div>
            <div class="card-body">
              <template v-if="strongKp.length">
                <KpBar
                  v-for="k in strongKp"
                  :key="k.kpId"
                  :name="k.name"
                  :value="k.masteryRate ?? 0"
                  :meta="`${k.mastered}/${k.assessed} 人已掌握`"
                />
              </template>
              <div v-else class="empty">
                还没有掌握率达到 80% 的知识点。<br />
                可以在「授课流程」页继续记录评定，让数据积累起来。
              </div>
            </div>
          </section>
        </div>

        <section class="card">
          <div class="card-head">
            <div class="card-title">知识点掌握全景</div>
            <span class="card-sub">{{ classKpSorted.length }} 个知识点 · 按掌握率升序</span>
          </div>
          <div class="card-body">
            <div v-if="!classKpSorted.length" class="empty">
              知识点评定还需要先在知识库中建立对应课程的知识点。
            </div>
            <table v-else class="kp-table">
              <thead>
                <tr>
                  <th>知识点</th>
                  <th>单元</th>
                  <th class="ta-r">已评定</th>
                  <th class="ta-r">已掌握</th>
                  <th class="ta-r">掌握率</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="k in classKpSorted" :key="k.kpId">
                  <td>{{ k.name }}</td>
                  <td class="dim">第 {{ k.unitNo }} 单元</td>
                  <td class="ta-r num">{{ k.assessed }}</td>
                  <td class="ta-r num">{{ k.mastered }}</td>
                  <td
                    class="ta-r num"
                    :class="(k.masteryRate ?? 0) < 60 ? 'v-low' : (k.masteryRate ?? 0) < 80 ? 'v-mid' : 'v-high'"
                  >
                    {{ pct(k.masteryRate) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </template>

    <!-- ───────────── 单学员视角 ───────────── -->
    <template v-else>
      <div v-if="bus.student" class="card"><div class="empty">{{ bus.student }}</div></div>

      <template v-if="studentGrowth">
        <section class="card print-area">
          <div class="card-head">
            <div class="card-title">
              {{ selectedName }} 的成长路径
              <span class="tag tag-blue">{{ rangeText }}</span>
              <span v-if="!realMode" class="tag tag-amber">演示轨迹</span>
            </div>
            <span class="card-sub">
              共 {{ studentGrowth.breakdown.total }} 条过程记录 ·
              {{ studentGrowth.eventCount }} 条时间轴事件
            </span>
          </div>

          <div v-if="!realMode" class="demo-note">
            演示模式：{{ selectedName }} 的轨迹为虚构样本（用于说明页面的表达方式），
            与所选学员无关。切换学员会看到同一份演示轨迹。
          </div>

          <div class="card-body">
            <div class="metrics">
              <div class="metric">
                <div class="metric-label">出勤率</div>
                <div class="metric-value">
                  {{ pct(studentGrowth.attendance.rate) }}
                </div>
                <div class="metric-sub">
                  出席 {{ studentGrowth.attendance.attended }} · 请假
                  {{ studentGrowth.attendance.leave }} · 缺勤
                  {{ studentGrowth.attendance.absent }}
                </div>
              </div>
              <div class="metric">
                <div class="metric-label">课堂表现变化</div>
                <div class="metric-value" :class="delta && delta.mastery >= 0 ? 'up' : 'down'">
                  {{ delta ? signed(delta.mastery) : "—" }}
                </div>
                <div class="metric-sub">
                  专注 {{ delta ? signed(delta.focus) : "—" }} · 参与
                  {{ delta ? signed(delta.participation) : "—" }}
                </div>
              </div>
              <div class="metric">
                <div class="metric-label">达成跃迁</div>
                <div class="metric-value">
                  {{ improved.length }}<small>个知识点</small>
                </div>
                <div class="metric-sub">
                  共评定 {{ studentGrowth.breakdown.kpAssessment }} 次
                </div>
              </div>
              <div class="metric">
                <div class="metric-label">成长里程碑</div>
                <div class="metric-value">
                  {{ studentGrowth.milestones.length }}<small>个</small>
                </div>
                <div class="metric-sub">每一步都有记录支撑</div>
              </div>
            </div>

            <div class="sec-title" style="margin-top: 20px">课堂表现曲线（1-5 分）</div>
            <LineChart
              v-if="studentEvalSeries.length"
              :series="studentEvalSeries"
              :height="170"
              :min="1"
              :max="5"
              fit-data
              show-area
            />
            <div v-else class="empty">还没有该学员的课堂评价记录。</div>

            <div v-if="studentExamSeries.length" class="mt-18">
              <div class="sec-title">成绩变化（得分率 %）</div>
              <LineChart
                :series="studentExamSeries"
                :height="150"
                :min="0"
                :max="100"
                fit-data
                :min-span="10"
              />
              <div class="exam-legend">
                <span v-for="e in studentGrowth.examSeries" :key="`${e.name}-${e.date}`">
                  {{ e.date }} {{ e.name }} {{ e.rate }}%
                </span>
              </div>
            </div>
          </div>
        </section>

        <div class="grid-2">
          <section class="card">
            <div class="card-head">
              <div class="card-title">知识点成长（起点 → 现在）</div>
              <span class="card-sub">按提升幅度排序</span>
            </div>
            <div class="card-body">
              <div v-if="!studentGrowth.kpProgress.length" class="empty">
                还没有知识点评定记录。<br />
                老师每次课后打勾一次，就会在这里留下一步。
              </div>
              <div
                v-for="k in studentGrowth.kpProgress"
                :key="k.kpId"
                class="kp-prog"
                :class="{ up: k.delta > 0 }"
              >
                <div class="kpp-head">
                  <span class="kpp-name">{{ k.name }}</span>
                  <span class="kpp-flow">
                    <span class="lv" :class="`lv-${k.from === '未掌握' ? 'low' : k.from === '部分掌握' ? 'mid' : 'high'}`">
                      {{ k.from }}
                    </span>
                    <span class="kpp-arrow">→</span>
                    <span class="lv" :class="`lv-${k.to === '未掌握' ? 'low' : k.to === '部分掌握' ? 'mid' : 'high'}`">
                      {{ k.to }}
                    </span>
                  </span>
                  <span v-if="k.delta > 0" class="kpp-delta">+{{ k.delta }} 档</span>
                </div>
                <div class="kpp-meta">
                  共评定 {{ k.attempts }} 次 · 从 {{ k.fromDate }} 到 {{ k.toDate }}
                  <template v-if="k.jumps.length">
                    · 跃迁 {{ k.jumps.map(j => j.date).join("、") }}
                  </template>
                </div>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div class="card-title">成长里程碑</div>
              <span class="card-sub">{{ studentGrowth.milestones.length }} 个</span>
            </div>
            <div class="card-body">
              <div v-if="!studentGrowth.milestones.length" class="empty">
                还没有识别到里程碑。<br />
                知识点档位提升、连续 4 次课全勤都会自动记为里程碑。
              </div>
              <div v-for="g in milestonesByMonth" :key="g.month" class="ms-group">
                <div class="ms-month">{{ g.month }}</div>
                <div v-for="m in g.items" :key="`${m.date}-${m.title}`" class="ms-item">
                  <span class="ms-dot" :class="m.kind" />
                  <span class="ms-date">{{ m.date.slice(5) }}</span>
                  <span class="ms-title">{{ m.title }}</span>
                </div>
              </div>
            </div>
          </section>
        </div>

        <section class="card">
          <div class="card-head">
            <div class="card-title">过程记录明细</div>
            <span class="card-sub">最近 {{ timelineDesc.length }} 条 · 倒序</span>
          </div>
          <div class="card-body">
            <div v-if="!timelineDesc.length" class="empty">还没有过程记录。</div>
            <table v-else class="tl-table">
              <thead>
                <tr>
                  <th style="width: 96px">日期</th>
                  <th style="width: 92px">类型</th>
                  <th>内容</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(e, i) in timelineDesc" :key="`${e.date}-${e.type}-${i}`">
                  <td class="num">{{ e.date }}</td>
                  <td>
                    <span class="tag" :class="TYPE_TAG[e.type] || 'tag-gray'">{{ e.label }}</span>
                  </td>
                  <td>{{ e.summary }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <div class="card-title">待加强</div>
            <span class="card-sub">尚未达到「已掌握」的知识点</span>
          </div>
          <div class="card-body">
            <div v-if="!needWork.length" class="empty">
              已评定的知识点都已达到「已掌握」。
            </div>
            <div v-else class="chip-row">
              <span v-for="k in needWork" :key="k.kpId" class="chip">
                {{ k.name }}
                <em>{{ k.to }}</em>
              </span>
            </div>
          </div>
        </section>
      </template>
    </template>

    <AiPanel
      v-if="view === 'student'"
      class="no-print"
      title="AI 成长叙述"
      sub="把上面的过程数据组织成一段可交付的成长故事"
      :output="output"
      :loading="loading"
      action-text="生成成长叙述"
      hint="数字全部来自本地指标计算（出勤、课堂表现、知识点跃迁、里程碑）；AI 只负责措辞，不参与算数。"
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

.tools {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pad-note {
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--c-text-2);
}

.metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.metric-sub {
  margin-top: 3px;
  font-size: 11px;
  color: var(--c-text-3);
}

.metric-value.up {
  color: var(--c-success);
}

.metric-value.down {
  color: var(--c-danger);
}

.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.mt-18 {
  margin-top: 18px;
}

.axis-note {
  margin-top: 8px;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--c-text-3);
}

.num.warn {
  color: var(--c-warn);
}

.demo-note {
  padding: 9px 18px;
  font-size: 12px;
  line-height: 1.7;
  color: #b45309;
  background: var(--c-warn-soft);
  border-bottom: 1px solid var(--c-border);
}

.ghost-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 11px;
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

/* 表格：只有横线无竖线（全站线条语言） */
.kp-table,
.tl-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.kp-table th,
.tl-table th {
  padding: 8px 10px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--c-text-3);
  text-align: left;
  border-bottom: 1px solid var(--c-border);
  white-space: nowrap;
}

.kp-table td,
.tl-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--c-border);
}

.kp-table tbody tr:last-child td,
.tl-table tbody tr:last-child td {
  border-bottom: none;
}

.ta-r {
  text-align: right;
}

.num {
  font-variant-numeric: tabular-nums;
}

.dim {
  color: var(--c-text-3);
}

.v-low {
  color: var(--c-danger);
}

.v-mid {
  color: var(--c-warn);
}

.v-high {
  color: var(--c-success);
}

/* 知识点成长 */
.kp-prog {
  padding: 10px 0;
  border-bottom: 1px dashed var(--c-border);
}

.kp-prog:last-child {
  border-bottom: none;
}

.kpp-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.kpp-name {
  flex: 1;
  min-width: 120px;
  font-size: 13px;
  font-weight: 500;
}

.kpp-flow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.lv {
  padding: 1px 7px;
  font-size: 11.5px;
  border-radius: var(--radius-sm);
}

.lv-low {
  color: color-mix(in srgb, var(--c-danger) 82%, #000);
  background: var(--c-danger-soft);
}

.lv-mid {
  color: color-mix(in srgb, var(--c-warn) 80%, #000);
  background: var(--c-warn-soft);
}

.lv-high {
  color: color-mix(in srgb, var(--c-success) 78%, #000);
  background: var(--c-success-soft);
}

.kpp-arrow {
  font-size: 11px;
  color: var(--c-text-3);
}

.kpp-delta {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--c-success);
}

.kpp-meta {
  margin-top: 4px;
  font-size: 11px;
  color: var(--c-text-3);
}

/* 里程碑 */
.ms-group + .ms-group {
  margin-top: 12px;
}

.ms-month {
  margin-bottom: 6px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--c-text-3);
}

.ms-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  font-size: 12.5px;
}

.ms-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c-success);
}

.ms-dot.attendance_streak {
  background: var(--c-primary);
}

.ms-date {
  flex-shrink: 0;
  font-size: 11.5px;
  color: var(--c-text-3);
  font-variant-numeric: tabular-nums;
}

.ms-title {
  color: var(--c-text);
}

.exam-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--c-text-3);
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 12px;
  background: var(--c-surface-2);
  border: 1px solid var(--c-border);
  border-radius: 999px;
}

.chip em {
  font-style: normal;
  color: var(--c-warn);
}

@media print {
  .page {
    gap: 0;
  }
}

@media (max-width: 1200px) {
  .metrics,
  .grid-2 {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
