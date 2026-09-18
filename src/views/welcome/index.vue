<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useECharts } from "@pureadmin/utils";
import { getDashboardOverview, getLatestNotices } from "@/api/attendance";
import { AppPageHeader } from "@/components/AppPageHeader";
import { AppEmpty } from "@/components/AppEmpty";
import FeedbackPanel from "./components/FeedbackPanel.vue";

// 图标统一使用 unplugin-icons 的编译期图标（项目规范：~icons/ep/xxx）。
// 原实现把图标写成 "ep:user" 字符串交给 <component :is>，规范禁止且实际不渲染。
import RefreshIcon from "~icons/ep/refresh";
import StudentIcon from "~icons/ep/user";
import PresentIcon from "~icons/ep/circle-check";
import AbsentIcon from "~icons/ep/warning";
import LeaveIcon from "~icons/ep/calendar";
import BellIcon from "~icons/ep/bell";

defineOptions({
  name: "Welcome"
});

const loading = ref(false);
const overview = ref({
  today: {
    date: "",
    total: 0,
    present: 0,
    absent: 0,
    leave: 0,
    studentTotal: 0,
    classTotal: 0,
    courseTotal: 0
  },
  trend: [],
  statusDist: []
});

const notices = ref<any[]>([]);
const noticeVisible = ref(false);
const noticeDetail = ref<any>({});

// 图表（复用 @pureadmin/utils 的 useECharts，传入 ref 后自动初始化）
const trendRef = ref<HTMLDivElement>();
const pieRef = ref<HTMLDivElement>();
const { setOptions: setTrendOptions } = useECharts(trendRef);
const { setOptions: setPieOptions } = useECharts(pieRef);

/** ECharts 在 canvas 上绘制，读不到 CSS 变量，必须取计算后的实际色值 */
function token(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/** 考勤五态配色，顺序与后端 dashboard.js 的 statusDist 一致 */
function attendancePalette(): string[] {
  return [
    token("--chart-attendance-normal"),
    token("--chart-attendance-late"),
    token("--chart-attendance-early"),
    token("--chart-attendance-absent"),
    token("--chart-attendance-leave")
  ];
}

const cards = computed(() => [
  {
    label: "今日应到学生",
    value: overview.value.today.studentTotal,
    tone: "brand",
    icon: StudentIcon
  },
  {
    label: "今日实到",
    value: overview.value.today.present,
    tone: "success",
    icon: PresentIcon
  },
  {
    label: "今日缺勤",
    value: overview.value.today.absent,
    tone: "danger",
    icon: AbsentIcon
  },
  {
    label: "今日请假",
    value: overview.value.today.leave,
    tone: "warning",
    icon: LeaveIcon
  }
]);

const STATUS_KEYS = ["normal", "late", "early", "absent", "leave"];

function renderCharts() {
  const trend = overview.value.trend;
  const palette = attendancePalette();
  const axisLabel = { color: token("--chart-axis-label"), fontSize: 12 };

  setTrendOptions({
    color: palette,
    tooltip: {
      trigger: "axis",
      backgroundColor: token("--surface-card"),
      borderColor: token("--border-default"),
      textStyle: { color: token("--ink-700"), fontSize: 12 }
    },
    legend: {
      icon: "roundRect",
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 16,
      textStyle: { color: token("--ink-600"), fontSize: 12 },
      top: 0,
      right: 0
    },
    grid: { left: 4, right: 8, top: 44, bottom: 0, containLabel: true },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: trend.map(i => i.date),
      axisLine: { lineStyle: { color: token("--chart-axis-line") } },
      axisTick: { show: false },
      axisLabel
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      splitLine: { lineStyle: { color: token("--chart-split-line") } },
      axisLabel
    },
    series: ["正常", "迟到", "早退", "缺勤", "请假"].map((name, i) => ({
      name,
      type: "line",
      smooth: true,
      symbol: "circle",
      symbolSize: 5,
      showSymbol: false,
      lineStyle: { width: 2 },
      data: trend.map(item => item[STATUS_KEYS[i]])
    }))
  });

  setPieOptions({
    color: palette,
    tooltip: {
      trigger: "item",
      formatter: "{b}：{c} 次（{d}%）",
      backgroundColor: token("--surface-card"),
      borderColor: token("--border-default"),
      textStyle: { color: token("--ink-700"), fontSize: 12 }
    },
    legend: {
      icon: "roundRect",
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 12,
      bottom: 0,
      textStyle: { color: token("--ink-600"), fontSize: 12 }
    },
    series: [
      {
        name: "考勤状态",
        type: "pie",
        radius: ["46%", "68%"],
        center: ["50%", "44%"],
        itemStyle: { borderColor: token("--surface-card"), borderWidth: 2 },
        label: { show: false },
        data: overview.value.statusDist
      }
    ]
  });
}

function showNotice(item: any) {
  noticeDetail.value = item;
  noticeVisible.value = true;
}

async function loadData() {
  loading.value = true;
  try {
    const res: any = await getDashboardOverview();
    overview.value = res.data;
    renderCharts();
    const n: any = await getLatestNotices();
    if (n.success) notices.value = n.data;
  } finally {
    loading.value = false;
  }
}

// 明暗主题切换后重绘图表：ECharts 需要具体色值，无法自动跟随 CSS 变量
let themeObserver: MutationObserver | null = null;

onMounted(() => {
  loadData();
  themeObserver = new MutationObserver(() => {
    if (overview.value.trend.length) renderCharts();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"]
  });
});

onUnmounted(() => {
  themeObserver?.disconnect();
  themeObserver = null;
});
</script>

<template>
  <div v-loading="loading" class="app-page">
    <AppPageHeader
      title="工作台"
      description="今天的到课情况与近 7 日出勤走势"
    >
      <el-button :icon="RefreshIcon" @click="loadData">刷新</el-button>
    </AppPageHeader>

    <!-- 今日关键指标：左侧色条 + 等宽数字，四张卡的白底与细边框即信息分组 -->
    <div class="stat-grid">
      <div
        v-for="card in cards"
        :key="card.label"
        :class="['stat-card', `stat-card--${card.tone}`]"
      >
        <div class="stat-card__top">
          <span class="stat-card__label">{{ card.label }}</span>
          <span class="stat-card__icon">
            <component :is="card.icon" />
          </span>
        </div>
        <div class="metric-value num">{{ card.value }}</div>
      </div>
    </div>

    <!-- 趋势（主）+ 占比与公告（侧） -->
    <div class="chart-grid mt-4">
      <section class="page-card">
        <header class="card-head">近 7 日出勤趋势</header>
        <div ref="trendRef" class="chart-box" />
      </section>

      <div class="flex flex-col gap-4">
        <section class="page-card">
          <header class="card-head">考勤状态占比</header>
          <div ref="pieRef" class="chart-box" />
        </section>

        <section class="page-card">
          <header class="card-head">最新公告</header>

          <AppEmpty
            v-if="notices.length === 0"
            title="暂无公告"
            description="管理员发布通知后，会在这里显示"
            :icon="BellIcon"
          />
          <ul v-else class="notice-list">
            <li
              v-for="n in notices"
              :key="n.id"
              class="notice-item"
              @click="showNotice(n)"
            >
              <span class="notice-item__title">
                <el-tag
                  v-if="n.is_top === 1"
                  type="primary"
                  size="small"
                  class="mr-1"
                  >置顶</el-tag
                >
                {{ n.title }}
              </span>
              <span class="notice-item__date num">{{
                n.created_at?.slice(0, 10)
              }}</span>
            </li>
          </ul>
        </section>
      </div>
    </div>

    <!-- 使用反馈：教师提交使用问题与建议，管理员统一查看与处理 -->
    <FeedbackPanel />

    <!-- 公告详情 -->
    <el-dialog v-model="noticeVisible" :title="noticeDetail.title" width="520px">
      <p class="page-hint mb-2">发布时间：{{ noticeDetail.created_at }}</p>
      <div class="whitespace-pre-wrap text-sm leading-relaxed">
        {{ noticeDetail.content }}
      </div>
    </el-dialog>
  </div>
</template>

<style lang="scss" scoped>
/* 公告列表：行与行之间只用 1px 细分隔线，日期等宽对齐便于纵向扫读 */
.notice-list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.notice-item {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-1);
  border-bottom: 1px solid var(--ink-100);
  transition: background-color var(--duration-fast) var(--ease-out);

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: var(--surface-hover);
  }
}

.notice-list .notice-item {
  cursor: pointer;
}

.notice-item__title {
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  font-size: var(--text-sm);
  color: var(--ink-700);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notice-item__date {
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: var(--ink-400);
}
</style>
