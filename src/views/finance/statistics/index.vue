<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import {
  getRevenueStatistics,
  getArrearsStatistics,
  getLowHoursStatistics,
  getBusinessStatistics,
  getConsumptionStatistics
} from "@/api/attendance";
import { AppPageHeader } from "@/components/AppPageHeader";
import { AppChartCard } from "@/components/AppChartCard";

defineOptions({
  name: "FinanceStatistics"
});

const activeTab = ref("revenue");

/* ---------- 营收统计 ---------- */
const revenueLoading = ref(false);
const granularity = ref<"day" | "month">("day");
const revenueRange = ref<[string, string] | null>(null);
const revenueList = ref<any[]>([]);
const totalRevenue = ref(0);

/* ---------- 欠费统计 ---------- */
const arrearsLoading = ref(false);
const arrearsList = ref<any[]>([]);
const totalArrears = ref(0);

/* ---------- 剩余课时预警 ---------- */
const lowHoursLoading = ref(false);
const lowHoursThreshold = ref(5);
const lowHoursList = ref<any[]>([]);

/* ---------- 经营构成（课程收入占比） ---------- */
const businessLoading = ref(false);
const business = ref<any>(null);

/* ---------- 课消排名 ---------- */
const consumptionLoading = ref(false);
const consumptionDimension = ref<"course" | "class">("course");
const consumptionList = ref<any[]>([]);
/** 学员剩余课时分布（取自课消统计 dimension=student，含 remain_hours） */
const hoursDistLoading = ref(false);
const hoursDistList = ref<any[]>([]);

function fmtMoney(v: any) {
  return `¥${(Number(v) || 0).toFixed(2)}`;
}

/* ---------- 图表配置 ----------
   配色一律走 CSS 变量字符串（如 "var(--chart-finance-gross)"），
   由 AppChartCard 在渲染前解析为当前主题的实际色值 —— ECharts canvas 读不到 CSS 变量。 */

/** 期间内是否存在已审批退费（决定是否画退费线，见下方 series 注释） */
const hasRefund = computed(() =>
  revenueList.value.some(i => Number(i.refunded) > 0)
);

/** 营收：缴费毛额 / 退费 / 净额 三条折线 */
const revenueChart = computed(() => {
  if (!revenueList.value.length) return null;
  const periods = revenueList.value.map(i => i.period);
  const money = (v: any) => `¥${(Number(v) || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
  return {
    tooltip: {
      trigger: "axis",
      backgroundColor: "var(--surface-card)",
      borderColor: "var(--border-default)",
      textStyle: { color: "var(--ink-700)", fontSize: 12 },
      formatter: (params: any[]) => {
        const head = `${params[0]?.axisValue ?? ""}<br/>`;
        const rows = params
          .map(p => `${p.marker}${p.seriesName}：${money(p.value)}`)
          .join("<br/>");
        return head + rows;
      }
    },
    legend: {
      icon: "roundRect",
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 16,
      textStyle: { color: "var(--ink-600)", fontSize: 12 },
      top: 0,
      right: 0
    },
    grid: { left: 4, right: 8, top: 44, bottom: 0, containLabel: true },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: periods,
      axisLine: { lineStyle: { color: "var(--chart-axis-line)" } },
      axisTick: { show: false },
      axisLabel: {
        color: "var(--chart-axis-label)",
        fontSize: 12,
        // 期间多时（如按天查一年）隔项显示，避免标签重叠糊成一片
        interval: periods.length > 20 ? Math.ceil(periods.length / 20) - 1 : 0
      }
    },
yAxis: [
      {
        type: "value",
        name: "实收 / 净额",
        nameTextStyle: { color: "var(--chart-axis-label)", fontSize: 11 },
        // 金额轴锁 0 起：负数在"收了多少钱"这个语义下没有意义
        min: 0,
        axisLabel: {
          color: "var(--chart-axis-label)",
          fontSize: 12,
          formatter: (v: number) =>
            v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v)
        },
        splitLine: { lineStyle: { color: "var(--chart-split-line)" } }
      },
      // ★ 退费走第二坐标轴：它与实收量级往往差一个数量级（实测 2500 vs 19200），
      //   共用一根轴要么压扁实收曲线、要么把轴拉出负半区（曾出现 -5000 的荒谬刻度）。
      //   仅在真有退费时才声明第二轴，避免图例出现一条恒 0 的无用曲线。
      ...(hasRefund.value
        ? [
            {
              type: "value",
              name: "退费",
              nameTextStyle: { color: "var(--chart-axis-label)", fontSize: 11 },
              min: 0,
              axisLabel: {
                color: "var(--chart-axis-label)",
                fontSize: 12,
                formatter: (v: number) =>
                  v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v)
              },
              splitLine: { show: false }
            }
          ]
        : [])
    ],
    series: [
      {
        name: "缴费毛额",
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 5,
        showSymbol: false,
        lineStyle: { width: 2 },
        itemStyle: { color: "var(--chart-finance-gross)" },
        data: revenueList.value.map(i => Number(i.gross) || 0)
      },
      // ★ 退费走第二 Y 轴且用**正数**绘制：它与实收量级不同（实测 2500 vs 19200），
      //   共用一根轴会压扁实收曲线；用第二轴则两条线各自清晰。
      //   无退费数据时整条线不画 —— 免得图例里挂一条恒 0 的无用曲线。
      ...(hasRefund.value
        ? [
            {
              name: "已审批退费",
              type: "line",
              yAxisIndex: 1,
              smooth: true,
              symbol: "rect",
              symbolSize: 5,
              showSymbol: false,
              lineStyle: { width: 2 },
              itemStyle: { color: "var(--chart-finance-refund)" },
              data: revenueList.value.map(i => Number(i.refunded) || 0)
            }
          ]
        : []),
      {
        name: "实收净额",
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 5,
        lineStyle: { width: 3 },
        itemStyle: { color: "var(--chart-finance-net)" },
        data: revenueList.value.map(i => Number(i.total) || 0)
      }
    ]
  };
});

/** 课程收入占比环形图 */
const courseShareChart = computed(() => {
  // ★ 后端 stats/business 返回 snake_case（revenue_by_course），勿写成 courseRevenue
  const rows = business.value?.revenue_by_course;
  if (!Array.isArray(rows) || !rows.length) return null;
  return {
    tooltip: {
      trigger: "item",
      backgroundColor: "var(--surface-card)",
      borderColor: "var(--border-default)",
      textStyle: { color: "var(--ink-700)", fontSize: 12 },
      formatter: (p: any) =>
        `${p.name}<br/>实收：${fmtMoney(p.value)}（${p.percent}%）`
    },
    legend: {
      icon: "roundRect",
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 12,
      bottom: 0,
      textStyle: { color: "var(--ink-600)", fontSize: 12 }
    },
    series: [
      {
        name: "课程收入",
        type: "pie",
        // 半径用百分比是相对**容器短边**的：整行宽布局下容器很宽，
        // 环会被画成中间一个小圈、右侧留大片空白（实测）。
        // 给固定像素上限，环才会随分类增多而变大、且视觉尺寸稳定。
        radius: ["46%", "68%"],
        center: ["50%", "46%"],
        itemStyle: {
          borderColor: "var(--surface-card)",
          borderWidth: 2
        },
        label: { show: false },
        data: rows.map((i: any, idx: number) => ({
          name: i.course_name,
          value: Number(i.total) || 0,
          itemStyle: {
            color: `var(--chart-cat-${(idx % 8) + 1})`
          }
        }))
      }
    ]
  };
});

/** 课消排名横向条形图（课时数而非金额，故用分类色板第 1 色） */
const consumptionChart = computed(() => {
  if (!consumptionList.value.length) return null;
  const rows = consumptionList.value.slice(0, 10);
  return {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: "var(--surface-card)",
      borderColor: "var(--border-default)",
      textStyle: { color: "var(--ink-700)", fontSize: 12 },
      formatter: (params: any[]) => {
        const p = params[0];
        const row: any = rows[p.dataIndex];
        return `${p.name}<br/>消耗：${p.value} 课时`;
      }
    },
    grid: { left: 4, right: 48, top: 12, bottom: 0, containLabel: true },
    xAxis: {
      type: "value",
      axisLabel: { color: "var(--chart-axis-label)", fontSize: 12 },
      splitLine: { lineStyle: { color: "var(--chart-split-line)" } }
    },
    yAxis: {
      type: "category",
      // ECharts 类目轴自下而上，反转后最大值在顶部
      data: rows.map((i: any) => i.course_name || i.class_name),
      axisLine: { lineStyle: { color: "var(--chart-axis-line)" } },
      axisTick: { show: false },
      axisLabel: {
        color: "var(--chart-axis-label)",
        fontSize: 12,
        // 类目名可能很长（如"八年级数学提高班"），侧栏容器窄 → 截断防溢出，
        // 完整名称仍可通过 tooltip 与图例下方脚注查看
        width: 96,
        overflow: "truncate"
      }
    },
    series: [
      {
        name: "课时消耗",
        type: "bar",
        barMaxWidth: 22,
        itemStyle: { color: "var(--chart-cat-1)", borderRadius: [0, 4, 4, 0] },
        label: {
          show: true,
          position: "right",
          color: "var(--ink-500)",
          fontSize: 12
        },
        data: rows.map((i: any) => Number(i.consumed) || 0)
      }
    ]
  };
});

function loadRevenue() {
  revenueLoading.value = true;
  const params: Record<string, any> = { granularity: granularity.value };
  if (revenueRange.value && revenueRange.value.length === 2) {
    params.start = revenueRange.value[0];
    params.end = revenueRange.value[1];
  }
  getRevenueStatistics(params)
    .then((res: any) => {
      if (res.success) {
        revenueList.value = res.data.list || [];
        totalRevenue.value = res.data.totalRevenue || 0;
      }
    })
    .finally(() => (revenueLoading.value = false));
}

function loadBusiness() {
  businessLoading.value = true;
  getBusinessStatistics()
    .then((res: any) => {
      if (res.success) business.value = res.data;
    })
    .finally(() => (businessLoading.value = false));
}

function loadConsumption() {
  consumptionLoading.value = true;
  getConsumptionStatistics({ dimension: consumptionDimension.value })
    .then((res: any) => {
      if (res.success) consumptionList.value = res.data.list || [];
    })
    .finally(() => (consumptionLoading.value = false));
}

/** 剩余课时分布直方图
 *  分档依据业务语义而非等宽：0（已耗尽）/ 1-5（告急）/ 6-10（偏紧）/ 11-20（正常）/ 20+（充足）。
 *  等宽分档会把「0 课时」这个最需要被看见的状态稀释掉。 */
const hoursDistChart = computed(() => {
  const rows = hoursDistList.value;
  if (!rows.length) return null;
  const bins = [
    { label: "0", test: (v: number) => v <= 0, color: "var(--chart-attendance-absent)" },
    { label: "1~5", test: (v: number) => v > 0 && v <= 5, color: "var(--chart-attendance-late)" },
    { label: "6~10", test: (v: number) => v > 5 && v <= 10, color: "var(--chart-cat-3)" },
    { label: "11~20", test: (v: number) => v > 10 && v <= 20, color: "var(--chart-cat-1)" },
    { label: "20+", test: (v: number) => v > 20, color: "var(--chart-cat-2)" }
  ];
  const counts = bins.map(b => rows.filter((r: any) => b.test(Number(r.remain_hours) || 0)).length);
  const total = rows.length;
  return {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: "var(--surface-card)",
      borderColor: "var(--border-default)",
      textStyle: { color: "var(--ink-700)", fontSize: 12 },
      formatter: (params: any[]) => {
        const p = params[0];
        const pct = total > 0 ? ((p.value / total) * 100).toFixed(1) : "0.0";
        return `${p.axisValue} 课时<br/>${p.value} 人（${pct}%）`;
      }
    },
    grid: { left: 4, right: 8, top: 16, bottom: 0, containLabel: true },
    xAxis: {
      type: "category",
      data: bins.map(b => `${b.label} 课时`),
      axisLine: { lineStyle: { color: "var(--chart-axis-line)" } },
      axisTick: { show: false },
      axisLabel: { color: "var(--chart-axis-label)", fontSize: 12, interval: 0 }
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      axisLabel: { color: "var(--chart-axis-label)", fontSize: 12 },
      splitLine: { lineStyle: { color: "var(--chart-split-line)" } }
    },
    series: [
      {
        name: "人数",
        type: "bar",
        barCategoryGap: "24%",
        label: { show: true, position: "top", color: "var(--ink-500)", fontSize: 12 },
        data: bins.map((b, i) => ({
          value: counts[i],
          itemStyle: { color: b.color, borderRadius: [4, 4, 0, 0] }
        }))
      }
    ]
  };
});

function loadHoursDist() {
  hoursDistLoading.value = true;
  getConsumptionStatistics({ dimension: "student" })
    .then((res: any) => {
      if (res.success) hoursDistList.value = res.data.list || [];
    })
    .finally(() => (hoursDistLoading.value = false));
}

function loadArrears() {
  arrearsLoading.value = true;
  getArrearsStatistics()
    .then((res: any) => {
      if (res.success) {
        arrearsList.value = res.data.list || [];
        totalArrears.value = res.data.totalArrears || 0;
      }
    })
    .finally(() => (arrearsLoading.value = false));
}

function loadLowHours() {
  lowHoursLoading.value = true;
  getLowHoursStatistics({ threshold: lowHoursThreshold.value })
    .then((res: any) => {
      if (res.success) {
        lowHoursList.value = res.data.list || [];
      }
    })
    .finally(() => (lowHoursLoading.value = false));
}

function handlePrint(id: string) {
  const el = document.getElementById(id);
  if (el) el.style.display = "block";
  window.print();
  setTimeout(() => {
    if (el) el.style.display = "";
  }, 200);
}

function formatPeriod(p: string) {
  // 按天显示 YYYY-MM-DD；按月显示 YYYY-MM
  return p || "—";
}

onMounted(() => {
  loadRevenue();
  loadArrears();
  loadLowHours();
  loadBusiness();
  loadConsumption();
  loadHoursDist();
});
</script>

<template>
  <div class="app-page">
    <AppPageHeader title="财务统计" description="收入确认与欠费概览" />
    <el-tabs v-model="activeTab">
      <!-- ================= 营收统计 ================= -->
      <el-tab-pane label="营收统计" name="revenue">
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <el-radio-group v-model="granularity" @change="loadRevenue">
            <el-radio-button value="day">按天</el-radio-button>
            <el-radio-button value="month">按月</el-radio-button>
          </el-radio-group>
          <el-date-picker
            v-model="revenueRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            class="!w-60"
          />
          <el-button type="primary" @click="loadRevenue">查询</el-button>
          <div class="flex-1" />
          <el-button type="primary" plain @click="handlePrint('printRevenue')"
            >打印 / 导出</el-button
          >
        </div>

        <div id="printRevenueTitle" class="mb-4 text-center print-only">
          <h2 class="text-xl font-bold">营收统计报表</h2>
          <div class="text-sm text-gray-500">
            统计维度：{{ granularity === "day" ? "按天" : "按月" }}　
            统计区间：{{
              revenueRange ? revenueRange.join(" 至 ") : "全部时间"
            }}
          </div>
        </div>

        <!-- 图上表下：折线看趋势，表格用于精确核对与打印（K-050 不静默） -->
        <div v-loading="revenueLoading" class="mb-4">
          <AppChartCard
            title="实收走势"
            :options="revenueChart"
            empty-title="所选区间内没有缴费记录"
            empty-description="换个时间范围，或先在「财务 → 缴费管理」录入收款"
            footnote="退费用右侧坐标轴（量级与实收不同，单独一根轴才看得清）。净额 = 缴费毛额 − 同期已审批退费，即实际留下的钱。"
          />
        </div>

        <el-card shadow="never">
          <div v-loading="revenueLoading">
            <div class="mb-3 flex items-center gap-4">
              <el-statistic
                title="期间实收合计"
                :value="totalRevenue"
                :precision="2"
                prefix="¥"
              />
            </div>
            <el-table id="printRevenue" :data="revenueList" border stripe>
              <el-table-column
                type="index"
                label="#"
                width="60"
                align="center"
              />
              <el-table-column label="期间" min-width="140">
                <template #default="{ row }">{{
                  formatPeriod(row.period)
                }}</template>
              </el-table-column>
              <el-table-column
                prop="cnt"
                label="收费笔数"
                width="120"
                align="center"
              />
              <el-table-column label="实收金额" min-width="140" align="right">
                <template #default="{ row }">
                  <span class="font-medium text-green-600">{{
                    fmtMoney(row.total)
                  }}</span>
                </template>
              </el-table-column>
              <template #empty>
                <el-empty description="暂无缴费数据" :image-size="60" />
              </template>
            </el-table>
          </div>
        </el-card>
      </el-tab-pane>

      <!-- ================= 欠费统计 ================= -->
      <el-tab-pane label="欠费统计" name="arrears">
        <div class="mb-4 flex items-center gap-2">
          <span class="text-sm text-gray-500"
            >统计口径：订单金额大于 0，且实缴合计小于订单金额的在读 /
            结业订单</span
          >
          <div class="flex-1" />
          <el-button type="primary" @click="loadArrears">刷新</el-button>
          <el-button type="primary" plain @click="handlePrint('printArrears')"
            >打印 / 导出</el-button
          >
        </div>

        <div id="printArrearsTitle" class="mb-4 text-center print-only">
          <h2 class="text-xl font-bold">欠费统计报表</h2>
          <div class="text-sm text-gray-500">
            统计时间：{{ new Date().toLocaleString() }}
          </div>
        </div>

        <el-card shadow="never">
          <div v-loading="arrearsLoading">
            <div class="mb-3">
              <el-statistic
                title="当前欠费合计"
                :value="totalArrears"
                :precision="2"
                prefix="¥"
              />
            </div>
            <el-table id="printArrears" :data="arrearsList" border stripe>
              <el-table-column
                type="index"
                label="#"
                width="60"
                align="center"
              />
              <el-table-column prop="student_no" label="学号" width="120" />
              <el-table-column prop="student_name" label="学员" width="110" />
              <el-table-column prop="class_name" label="班级" min-width="130">
                <template #default="{ row }">{{
                  row.class_name || "—"
                }}</template>
              </el-table-column>
              <el-table-column label="订单金额" width="120" align="right">
                <template #default="{ row }">{{
                  fmtMoney(row.amount)
                }}</template>
              </el-table-column>
              <el-table-column label="已缴" width="120" align="right">
                <template #default="{ row }">
                  <span class="text-green-600">{{ fmtMoney(row.paid) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="欠费金额" width="120" align="right">
                <template #default="{ row }">
                  <span class="font-medium text-red-500">{{
                    fmtMoney(row.arrears)
                  }}</span>
                </template>
              </el-table-column>
              <template #empty>
                <el-empty description="暂无欠费订单" :image-size="60" />
              </template>
            </el-table>
          </div>
        </el-card>
      </el-tab-pane>

      <!-- ================= 剩余课时预警 ================= -->
      <el-tab-pane label="剩余课时预警" name="low-hours">
        <div class="mb-4 flex items-center gap-2">
          <span class="text-sm text-gray-500">阈值：剩余课时 ≤</span>
          <el-input-number
            v-model="lowHoursThreshold"
            :min="1"
            :max="50"
            :step="1"
            class="!w-32"
          />
          <el-button type="primary" @click="loadLowHours">查询</el-button>
          <div class="flex-1" />
          <span class="text-sm text-gray-500"
            >口径：在读且设置了课时包的订单，剩余课时 ≤ 阈值</span
          >
        </div>

        <!-- 分布图在表格之上：先看整体水位，再逐行处理 -->
        <div v-loading="hoursDistLoading" class="mb-4">
          <AppChartCard
            title="在读学员剩余课时分布"
            :options="hoursDistChart"
            empty-title="还没有学员课时数据"
            empty-description="报班订单设置了「总课时」后，这里会显示课时水位分布"
            footnote="分档依据业务含义而非等宽：0 课时（已耗尽）与 1~5 课时（告急）是最需要被看见的两档。"
          />
        </div>

        <el-card shadow="never">
          <div v-loading="lowHoursLoading">
            <el-table :data="lowHoursList" border stripe>
              <el-table-column
                type="index"
                label="#"
                width="60"
                align="center"
              />
              <el-table-column prop="student_no" label="学号" width="120" />
              <el-table-column prop="student_name" label="学员" width="110" />
              <el-table-column prop="class_name" label="班级" min-width="130">
                <template #default="{ row }">{{
                  row.class_name || "—"
                }}</template>
              </el-table-column>
              <el-table-column prop="course_name" label="课程" min-width="120">
                <template #default="{ row }">{{
                  row.course_name || "—"
                }}</template>
              </el-table-column>
              <el-table-column
                prop="total_hours"
                label="总课时"
                width="90"
                align="center"
              />
              <el-table-column label="剩余课时" width="100" align="center">
                <template #default="{ row }">
                  <span class="font-semibold text-red-500">{{
                    row.remain_hours
                  }}</span>
                </template>
              </el-table-column>
              <el-table-column
                prop="enroll_date"
                label="报名日期"
                width="110"
              />
              <template #empty>
                <el-empty
                  description="暂无剩余课时不足的学员"
                  :image-size="60"
                />
              </template>
            </el-table>
          </div>
        </el-card>
      </el-tab-pane>

      <!-- ================= 经营构成（仅 admin） ================= -->
      <el-tab-pane label="经营构成" name="business">
        <div v-loading="businessLoading || consumptionLoading">
          <!-- 经营总览卡片：这些数字原来只能靠翻表逐行加 -->
          <div v-if="business?.overview" class="stat-grid mb-4">
            <div class="stat-card">
              <div class="stat-card__top">
                <span class="stat-card__label">在读学员</span>
              </div>
              <div class="metric-value num">
                {{ business.overview.active_students }}
                <span class="text-xs text-gray-500">
                  / {{ business.overview.total_students }}
                </span>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-card__top">
                <span class="stat-card__label">本月实收净额</span>
              </div>
              <div class="metric-value num">{{
                fmtMoney(business.overview.month_revenue)
              }}</div>
            </div>
            <div class="stat-card">
              <div class="stat-card__top">
                <span class="stat-card__label">线索转化率</span>
              </div>
              <div class="metric-value num">
                {{ business.overview.conversion_rate }}%
                <span class="text-xs text-gray-500">
                  （{{ business.overview.converted_leads }} /
                  {{ business.overview.total_leads }}）
                </span>
              </div>
            </div>
            <div class="stat-card">
              <div class="stat-card__top">
                <span class="stat-card__label">半年续班率</span>
              </div>
              <div class="metric-value num">
                {{ business.overview.renewal_rate }}%
                <span class="text-xs text-gray-500">
                  （{{ business.overview.renewed_6m }} /
                  {{ business.overview.graduated_6m }}）
                </span>
              </div>
            </div>
          </div>

          <!-- 环形图半宽：百分比半径在半宽容器里视觉尺寸更合适 -->
          <div class="chart-grid">
            <AppChartCard
              title="各课程实收占比"
              :options="courseShareChart"
              empty-title="还没有课程收入数据"
              empty-description="课程收入在「财务 → 缴费管理」产生缴费记录后才会出现"
              footnote="按实收净额计算（缴费毛额 − 已审批退费），非缴费笔数。"
            />

            <div>
              <div class="mb-2 flex items-center gap-2">
                <span class="text-sm text-gray-500">课消排名维度</span>
                <el-radio-group
                  v-model="consumptionDimension"
                  size="small"
                  @change="loadConsumption"
                >
                  <el-radio-button value="course">按课程</el-radio-button>
                  <el-radio-button value="teacher">按班级</el-radio-button>
                </el-radio-group>
              </div>
              <AppChartCard
                title="课时消耗 Top 10"
                :options="consumptionChart"
                empty-title="还没有课时消耗记录"
                empty-description="在「排课与课表 → 课次」中登记消耗后，这里会出现排名"
                footnote="仅统计「扣减」类型；「回补」不计入消耗。"
              />
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
@media print {
  body * {
    visibility: hidden;
  }
  #printRevenue,
  #printRevenue * {
    visibility: visible;
  }
  #printRevenue {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
  }
  #printArrears,
  #printArrears * {
    visibility: visible;
  }
  #printArrears {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
  }
  #printRevenueTitle,
  #printArrearsTitle {
    display: block !important;
  }
}
.print-only {
  display: none;
}
</style>
