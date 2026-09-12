<script setup lang="ts">
import EpPrinter from "~icons/ep/printer";
import { ref, reactive, onMounted } from "vue";
import { ElMessage } from "element-plus";
import { useECharts } from "@pureadmin/utils";
import {
  getAllClasses,
  getAllCourses,
  getAllTerms,
  getSettings,
  getAttendanceStatistics,
  getAttendanceTrend,
  getAttendanceWarnings,
  getMonthlyStatistics
} from "@/api/attendance";

defineOptions({
  name: "Statistics"
});

const activeTab = ref("detail");

const dimension = ref<"student" | "class">("student");
const courseId = ref<number | null>(null);
const classId = ref<number | null>(null);
const range = ref<[string, string] | null>(null);
const classOptions = ref<any[]>([]);
const courseOptions = ref<any[]>([]);
const termId = ref<number | null>(null);
const termOptions = ref<any[]>([]);
// 预警阈值默认值（来自系统参数，重置时恢复）
const defaultWarn = { rate: 80, consecutive: 3, days: 14 };

const loading = ref(false);
const list = ref<any[]>([]);
const summary = reactive({
  total: 0,
  normal_count: 0,
  late_count: 0,
  early_count: 0,
  absent_count: 0,
  leave_count: 0
});

const chartRef = ref<HTMLDivElement>();
const { setOptions } = useECharts(chartRef);

/* ---------- 出勤趋势（日/周/月） ---------- */
const trendPeriod = ref<"day" | "week" | "month">("day");
const trendLoading = ref(false);
const trendList = ref<any[]>([]);
const trendChartRef = ref<HTMLDivElement>();
const { setOptions: setTrendOptions } = useECharts(trendChartRef);

/* ---------- 缺勤预警 ---------- */
const warningLoading = ref(false);
const warnRate = ref(80);
const warnConsecutive = ref(3);
const warnDays = ref(14);
const warnings = reactive({
  range: { start: "", end: "", days: 14 },
  low_rate: [] as any[],
  consecutive_absent: [] as any[]
});

/* ---------- 月度报表 ---------- */
const monthlyLoading = ref(false);
const monthlyClassId = ref<number | null>(null);
const monthlyRange = ref<[string, string] | null>(null);
const monthlyTitle = ref("月度出勤报表");
const monthlyData = reactive({
  months: [] as string[],
  list: [] as any[],
  summary: { total: 0, absent: 0, attendance_rate: 0 }
});

function loadOptions() {
  getAllClasses().then((res: any) => {
    if (res.success) classOptions.value = res.data;
  });
  getAllCourses().then((res: any) => {
    if (res.success) courseOptions.value = res.data;
  });
  getAllTerms().then((res: any) => {
    if (res.success) termOptions.value = res.data;
  });
}

/** 选择学期 → 自动设置统计日期范围为学期起止并刷新 */
function handleTermChange(val: any) {
  if (val) {
    const t = termOptions.value.find(x => x.id === val);
    if (t) range.value = [t.start_date, t.end_date];
  }
  query();
}

function query() {
  loading.value = true;
  const params: Record<string, any> = { dimension: dimension.value };
  if (courseId.value) params.course_id = courseId.value;
  if (classId.value) params.class_id = classId.value;
  if (range.value && range.value.length === 2) {
    params.start = range.value[0];
    params.end = range.value[1];
  }
  getAttendanceStatistics(params)
    .then((res: any) => {
      if (res.success) {
        list.value = res.data.list;
        Object.assign(summary, res.data.summary);
        renderChart();
      }
    })
    .finally(() => (loading.value = false));
  loadTrend();
  loadWarnings();
}

function commonFilter(): Record<string, any> {
  const params: Record<string, any> = {};
  if (courseId.value) params.course_id = courseId.value;
  if (classId.value) params.class_id = classId.value;
  if (range.value && range.value.length === 2) {
    params.start = range.value[0];
    params.end = range.value[1];
  }
  return params;
}

/* 出勤趋势 */
function loadTrend() {
  trendLoading.value = true;
  getAttendanceTrend({ ...commonFilter(), period: trendPeriod.value })
    .then((res: any) => {
      if (res.success) {
        trendList.value = res.data;
        renderTrendChart();
      }
    })
    .finally(() => (trendLoading.value = false));
}

function renderTrendChart() {
  const data = trendList.value;
  setTrendOptions({
    tooltip: { trigger: "axis" },
    legend: { top: 0 },
    grid: { left: 40, right: 20, top: 30, bottom: 40 },
    xAxis: {
      type: "category",
      data: data.map(i => i.label),
      axisLabel: { interval: 0, rotate: data.length > 10 ? 35 : 0 }
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLabel: { formatter: "{value}%" }
    },
    series: [
      {
        name: "出勤率",
        type: "line",
        smooth: true,
        symbolSize: 6,
        data: data.map(i => i.attendance_rate),
        itemStyle: { color: "#409EFF" },
        areaStyle: { opacity: 0.1 }
      }
    ]
  });
}

/* 缺勤预警 */
function loadWarnings() {
  warningLoading.value = true;
  getAttendanceWarnings({
    ...commonFilter(),
    rate: (warnRate.value / 100).toFixed(2),
    consecutive: warnConsecutive.value,
    days: warnDays.value
  })
    .then((res: any) => {
      if (res.success) {
        warnings.range = res.data.range;
        warnings.low_rate = res.data.low_rate;
        warnings.consecutive_absent = res.data.consecutive_absent;
      }
    })
    .finally(() => (warningLoading.value = false));
}

/* 出勤率 Top 20 柱状图 */
function renderChart() {
  const data = list.value.slice(0, 20);
  setOptions({
    tooltip: { trigger: "axis", formatter: "{b}<br/>出勤率：{c}%" },
    grid: { left: 40, right: 20, top: 30, bottom: 50 },
    xAxis: {
      type: "category",
      data: data.map(i => i.name),
      axisLabel: { interval: 0, rotate: data.length > 8 ? 35 : 0 }
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLabel: { formatter: "{value}%" }
    },
    series: [
      {
        name: "出勤率",
        type: "bar",
        barMaxWidth: 30,
        data: data.map(i => i.attendance_rate),
        itemStyle: {
          color: i =>
            i.value >= 90 ? "#67C23A" : i.value >= 60 ? "#E6A23C" : "#F56C6C"
        }
      }
    ]
  });
}

function reset() {
  dimension.value = "student";
  courseId.value = null;
  classId.value = null;
  termId.value = null;
  range.value = null;
  warnRate.value = defaultWarn.rate;
  warnConsecutive.value = defaultWarn.consecutive;
  warnDays.value = defaultWarn.days;
  query();
}

/* ---------- 月度报表 ---------- */
function loadMonthly() {
  monthlyLoading.value = true;
  const params: Record<string, any> = {};
  if (monthlyClassId.value) params.class_id = monthlyClassId.value;
  if (monthlyRange.value && monthlyRange.value.length === 2) {
    params.start = monthlyRange.value[0];
    params.end = monthlyRange.value[1];
  }
  getMonthlyStatistics(params)
    .then((res: any) => {
      if (res.success) {
        monthlyData.months = res.data.months;
        monthlyData.list = res.data.list;
        Object.assign(monthlyData.summary, res.data.summary);
      }
    })
    .finally(() => (monthlyLoading.value = false));
}

function resetMonthly() {
  monthlyClassId.value = null;
  monthlyRange.value = null;
  loadMonthly();
}

function handlePrint() {
  window.print();
}

function rateColor(rate: number) {
  return rate >= 90 ? "#67C23A" : rate >= 60 ? "#E6A23C" : "#F56C6C";
}

onMounted(() => {
  // 预警阈值初值读取系统参数
  getSettings().then((res: any) => {
    if (res.success) {
      const s = res.data || {};
      defaultWarn.rate = Number(s.warn_rate ?? 80);
      defaultWarn.consecutive = Number(s.warn_consecutive ?? 3);
      defaultWarn.days = Number(s.warn_days ?? 14);
      warnRate.value = defaultWarn.rate;
      warnConsecutive.value = defaultWarn.consecutive;
      warnDays.value = defaultWarn.days;
    }
  });
  loadOptions();
  query();
  loadMonthly();
});
</script>

<template>
  <div class="p-4">
    <el-tabs v-model="activeTab">
      <!-- ================= 出勤明细 ================= -->
      <el-tab-pane label="出勤明细" name="detail">
        <el-card shadow="never" class="mb-4">
          <!-- 筛选 -->
          <div class="flex flex-wrap items-center gap-2">
            <el-radio-group v-model="dimension" @change="query">
              <el-radio-button value="student">按学生</el-radio-button>
              <el-radio-button value="class">按班级</el-radio-button>
            </el-radio-group>
            <el-select
              v-model="courseId"
              placeholder="全部课程"
              clearable
              class="!w-40"
              @change="query"
            >
              <el-option
                v-for="item in courseOptions"
                :key="item.id"
                :label="item.name"
                :value="item.id"
              />
            </el-select>
            <el-select
              v-model="classId"
              placeholder="全部班级"
              clearable
              class="!w-40"
              @change="query"
            >
              <el-option
                v-for="item in classOptions"
                :key="item.id"
                :label="item.name"
                :value="item.id"
              />
            </el-select>
            <el-select
              v-model="termId"
              placeholder="按学期"
              clearable
              class="!w-40"
              @change="handleTermChange"
            >
              <el-option
                v-for="item in termOptions"
                :key="item.id"
                :label="item.name"
                :value="item.id"
              />
            </el-select>
            <el-date-picker
              v-model="range"
              type="daterange"
              value-format="YYYY-MM-DD"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              class="!w-60"
              @change="query"
            />
            <el-button @click="reset">重置</el-button>
          </div>
        </el-card>

        <!-- 汇总 -->
        <el-row :gutter="16" class="mb-4">
          <el-col
            v-for="item in [
              { label: '考勤总记录', value: summary.total, color: '#409EFF' },
              { label: '正常', value: summary.normal_count, color: '#67C23A' },
              { label: '迟到', value: summary.late_count, color: '#E6A23C' },
              { label: '早退', value: summary.early_count, color: '#E6A23C' },
              { label: '缺勤', value: summary.absent_count, color: '#F56C6C' },
              { label: '请假', value: summary.leave_count, color: '#909399' }
            ]"
            :key="item.label"
            :xs="12"
            :sm="8"
            :md="4"
          >
            <el-card shadow="hover">
              <div class="text-[13px] text-gray-500">{{ item.label }}</div>
              <div
                class="mt-1 text-[22px] font-bold"
                :style="{ color: item.color }"
              >
                {{ item.value }}
              </div>
            </el-card>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :xs="24" :md="14">
            <el-card shadow="never">
              <el-table
                v-loading="loading"
                :data="list"
                border
                stripe
                max-height="480"
              >
                <el-table-column
                  v-if="dimension === 'student'"
                  prop="student_no"
                  label="学号"
                  min-width="100"
                />
                <el-table-column
                  v-if="dimension === 'class'"
                  prop="grade"
                  label="年级"
                  min-width="90"
                />
                <el-table-column
                  prop="name"
                  :label="dimension === 'student' ? '姓名' : '班级'"
                  min-width="130"
                />
                <el-table-column
                  v-if="dimension === 'student'"
                  prop="class_name"
                  label="班级"
                  min-width="130"
                />
                <el-table-column
                  v-else
                  prop="head_teacher"
                  label="班主任"
                  min-width="90"
                />
                <el-table-column
                  prop="total"
                  label="应出勤"
                  width="90"
                  align="center"
                />
                <el-table-column label="出勤率" width="120" align="center">
                  <template #default="{ row }">
                    <span :style="{ color: rateColor(row.attendance_rate) }">
                      {{ row.attendance_rate }}%
                    </span>
                  </template>
                </el-table-column>
                <el-table-column
                  prop="normal_count"
                  label="正常"
                  width="80"
                  align="center"
                />
                <el-table-column
                  prop="late_count"
                  label="迟到"
                  width="80"
                  align="center"
                />
                <el-table-column
                  prop="early_count"
                  label="早退"
                  width="80"
                  align="center"
                />
                <el-table-column
                  prop="absent_count"
                  label="缺勤"
                  width="80"
                  align="center"
                />
                <el-table-column
                  prop="leave_count"
                  label="请假"
                  width="80"
                  align="center"
                />
              </el-table>
            </el-card>
          </el-col>
          <el-col :xs="24" :md="10">
            <el-card shadow="never" header="出勤率 Top 20">
              <div ref="chartRef" style="height: 480px; width: 100%" />
            </el-card>
          </el-col>
        </el-row>

        <!-- 出勤趋势（日/周/月） -->
        <el-card shadow="never" class="mb-4">
          <template #header>
            <div class="flex items-center justify-between">
              <span>出勤趋势</span>
              <el-radio-group
                v-model="trendPeriod"
                size="small"
                @change="loadTrend"
              >
                <el-radio-button value="day">按日</el-radio-button>
                <el-radio-button value="week">按周</el-radio-button>
                <el-radio-button value="month">按月</el-radio-button>
              </el-radio-group>
            </div>
          </template>
          <div
            ref="trendChartRef"
            v-loading="trendLoading"
            style="height: 320px; width: 100%"
          />
        </el-card>

        <!-- 缺勤预警 -->
        <el-card shadow="never">
          <template #header>
            <div class="flex items-center justify-between">
              <span>缺勤预警</span>
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-[13px] text-gray-500">统计近</span>
                <el-input-number
                  v-model="warnDays"
                  :min="1"
                  :max="90"
                  size="small"
                  controls-position="right"
                  style="width: 90px"
                  @change="loadWarnings"
                />
                <span class="text-[13px] text-gray-500">天，出勤率低于</span>
                <el-input-number
                  v-model="warnRate"
                  :min="10"
                  :max="100"
                  size="small"
                  controls-position="right"
                  style="width: 90px"
                  @change="loadWarnings"
                />
                <span class="text-[13px] text-gray-500">% 或连续缺勤 ≥</span>
                <el-input-number
                  v-model="warnConsecutive"
                  :min="1"
                  :max="30"
                  size="small"
                  controls-position="right"
                  style="width: 90px"
                  @change="loadWarnings"
                />
                <span class="text-[13px] text-gray-500">天</span>
              </div>
            </div>
          </template>
          <div v-loading="warningLoading" class="flex flex-wrap gap-4">
            <div class="flex-1 min-w-[320px]">
              <div class="mb-2 text-[13px] font-medium text-gray-600">
                低出勤率名单（{{ warnings.low_rate.length }} 人）
              </div>
              <el-table
                :data="warnings.low_rate"
                border
                stripe
                max-height="320"
                size="small"
              >
                <el-table-column
                  prop="student_no"
                  label="学号"
                  min-width="100"
                />
                <el-table-column prop="name" label="姓名" min-width="90" />
                <el-table-column
                  prop="class_name"
                  label="班级"
                  min-width="110"
                />
                <el-table-column
                  prop="total"
                  label="应出勤"
                  width="80"
                  align="center"
                />
                <el-table-column
                  prop="absent_count"
                  label="缺勤"
                  width="70"
                  align="center"
                />
                <el-table-column
                  prop="late_early_count"
                  label="迟到/早退"
                  width="90"
                  align="center"
                />
                <el-table-column label="出勤率" width="110" align="center">
                  <template #default="{ row }">
                    <el-tag
                      :type="row.attendance_rate < 60 ? 'danger' : 'warning'"
                      size="small"
                    >
                      {{ row.attendance_rate }}%
                    </el-tag>
                  </template>
                </el-table-column>
                <template #empty>
                  <el-empty
                    description="近 {{ warnings.range.days }} 天暂无低出勤率学生"
                    :image-size="60"
                  />
                </template>
              </el-table>
            </div>
            <div class="flex-1 min-w-[320px]">
              <div class="mb-2 text-[13px] font-medium text-gray-600">
                连续缺勤名单（{{ warnings.consecutive_absent.length }} 人）
              </div>
              <el-table
                :data="warnings.consecutive_absent"
                border
                stripe
                max-height="320"
                size="small"
              >
                <el-table-column
                  prop="student_no"
                  label="学号"
                  min-width="100"
                />
                <el-table-column prop="name" label="姓名" min-width="90" />
                <el-table-column
                  prop="class_name"
                  label="班级"
                  min-width="110"
                />
                <el-table-column
                  prop="max_consecutive_absent"
                  label="连续缺勤(天)"
                  width="110"
                  align="center"
                >
                  <template #default="{ row }">
                    <el-tag type="danger" size="small"
                      >{{ row.max_consecutive_absent }} 天</el-tag
                    >
                  </template>
                </el-table-column>
                <el-table-column label="缺勤日期" min-width="180">
                  <template #default="{ row }">
                    <span class="text-[12px] text-gray-500">{{
                      (row.dates || []).join("、")
                    }}</span>
                  </template>
                </el-table-column>
                <template #empty>
                  <el-empty
                    description="近 {{ warnings.range.days }} 天暂无连续缺勤学生"
                    :image-size="60"
                  />
                </template>
              </el-table>
            </div>
          </div>
        </el-card>
      </el-tab-pane>

      <!-- ================= 月度报表 ================= -->
      <el-tab-pane label="月度报表" name="monthly">
        <div id="printMonthly" class="print-area">
          <el-card shadow="never" class="mb-4">
            <div class="flex flex-wrap items-center gap-2 no-print">
              <span class="text-[13px] text-gray-500">报表标题</span>
              <el-input
                v-model="monthlyTitle"
                placeholder="月度出勤报表"
                class="!w-48"
                clearable
              />
              <el-select
                v-model="monthlyClassId"
                placeholder="全部班级"
                clearable
                class="!w-40"
              >
                <el-option
                  v-for="item in classOptions"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id"
                />
              </el-select>
              <el-date-picker
                v-model="monthlyRange"
                type="daterange"
                value-format="YYYY-MM-DD"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                class="!w-60"
              />
              <el-button type="primary" @click="loadMonthly">查询</el-button>
              <el-button @click="resetMonthly">重置</el-button>
              <div class="flex-1" />
              <el-button type="primary" plain @click="handlePrint">
                <el-icon class="mr-1"><EpPrinter /></el-icon>
                打印 / 导出
              </el-button>
            </div>
          </el-card>

          <div class="mb-4 text-center print-only">
            <h2 class="text-xl font-bold">
              {{ monthlyTitle || "月度出勤报表" }}
            </h2>
            <div class="text-sm text-gray-500">
              统计区间：{{
                monthlyRange ? monthlyRange.join(" 至 ") : "全部时间"
              }}
            </div>
          </div>

          <el-card shadow="never">
            <div v-loading="monthlyLoading">
              <el-table :data="monthlyData.list" border stripe>
                <el-table-column
                  type="index"
                  label="#"
                  width="60"
                  align="center"
                  fixed
                />
                <el-table-column
                  prop="class_name"
                  label="班级"
                  min-width="140"
                  fixed
                />
                <el-table-column
                  v-for="m in monthlyData.months"
                  :key="m"
                  :label="m"
                  align="center"
                  min-width="110"
                >
                  <template #default="{ row }">
                    <template v-if="row.month_data[m]">
                      <div
                        :style="{
                          color: rateColor(row.month_data[m].attendance_rate),
                          fontWeight: 600
                        }"
                      >
                        {{ row.month_data[m].attendance_rate }}%
                      </div>
                      <div class="text-[12px] text-gray-400">
                        缺勤 {{ row.month_data[m].absent }}
                      </div>
                    </template>
                    <span v-else class="text-gray-300">-</span>
                  </template>
                </el-table-column>
                <el-table-column
                  label="合计出勤率"
                  align="center"
                  min-width="110"
                  fixed="right"
                >
                  <template #default="{ row }">
                    <span
                      :style="{
                        color: rateColor(row.attendance_rate),
                        fontWeight: 700
                      }"
                    >
                      {{ row.attendance_rate }}%
                    </span>
                  </template>
                </el-table-column>
                <template #empty>
                  <el-empty description="该区间暂无考勤数据" :image-size="60" />
                </template>
              </el-table>

              <div class="mt-4 flex flex-wrap items-center gap-6 text-sm">
                <span
                  >总考勤记录：<b>{{ monthlyData.summary.total }}</b> 条</span
                >
                <span
                  >缺勤：<b class="text-red-500">{{
                    monthlyData.summary.absent
                  }}</b>
                  次</span
                >
                <span
                  >总出勤率：<b
                    :style="{
                      color: rateColor(monthlyData.summary.attendance_rate)
                    }"
                    >{{ monthlyData.summary.attendance_rate }}%</b
                  ></span
                >
              </div>
            </div>
          </el-card>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style>
/* 打印：仅输出 #printMonthly 区域 */
@media print {
  body * {
    visibility: hidden;
  }
  #printMonthly,
  #printMonthly * {
    visibility: visible;
  }
  #printMonthly {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    padding: 0;
  }
  .no-print {
    display: none !important;
  }
  .print-only {
    display: block !important;
  }
}
.print-only {
  display: none;
}
</style>
