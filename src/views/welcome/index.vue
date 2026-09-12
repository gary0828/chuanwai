<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useECharts } from "@pureadmin/utils";
import { getDashboardOverview, getLatestNotices } from "@/api/attendance";

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

const cards = computed(() => [
  {
    label: "今日应到学生",
    value: overview.value.today.studentTotal,
    color: "#409EFF",
    icon: "ep:user"
  },
  {
    label: "今日实到",
    value: overview.value.today.present,
    color: "#67C23A",
    icon: "ep:circle-check"
  },
  {
    label: "今日缺勤",
    value: overview.value.today.absent,
    color: "#F56C6C",
    icon: "ep:warning"
  },
  {
    label: "今日请假",
    value: overview.value.today.leave,
    color: "#E6A23C",
    icon: "ep:calendar"
  }
]);

function renderCharts() {
  const trend = overview.value.trend;
  setTrendOptions({
    tooltip: { trigger: "axis" },
    legend: { data: ["正常", "迟到", "早退", "缺勤", "请假"] },
    grid: { left: 40, right: 20, top: 40, bottom: 30 },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: trend.map(i => i.date)
    },
    yAxis: { type: "value", minInterval: 1 },
    series: [
      {
        name: "正常",
        type: "line",
        smooth: true,
        data: trend.map(i => i.normal)
      },
      {
        name: "迟到",
        type: "line",
        smooth: true,
        data: trend.map(i => i.late)
      },
      {
        name: "早退",
        type: "line",
        smooth: true,
        data: trend.map(i => i.early)
      },
      {
        name: "缺勤",
        type: "line",
        smooth: true,
        data: trend.map(i => i.absent)
      },
      {
        name: "请假",
        type: "line",
        smooth: true,
        data: trend.map(i => i.leave)
      }
    ]
  });
  setPieOptions({
    tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
    legend: { bottom: 0 },
    series: [
      {
        name: "考勤状态",
        type: "pie",
        radius: "55%",
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

onMounted(loadData);
</script>

<template>
  <div v-loading="loading" class="p-4">
    <!-- 统计卡片 -->
    <el-row :gutter="16">
      <el-col v-for="card in cards" :key="card.label" :xs="12" :sm="12" :md="6">
        <el-card shadow="hover" class="mb-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-[13px] text-gray-500">{{ card.label }}</div>
              <div
                class="mt-2 text-[26px] font-bold"
                :style="{ color: card.color }"
              >
                {{ card.value }}
              </div>
            </div>
            <el-icon :size="36" :color="card.color">
              <component :is="card.icon" />
            </el-icon>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 次级统计 + 图表 -->
    <el-row :gutter="16">
      <el-col :xs="24" :md="16">
        <el-card shadow="hover" class="mb-4" header="近 7 日出勤趋势">
          <div ref="trendRef" style="height: 340px; width: 100%" />
        </el-card>
      </el-col>
      <el-col :xs="24" :md="8">
        <el-card shadow="hover" class="mb-4" header="考勤状态占比">
          <div ref="pieRef" style="height: 340px; width: 100%" />
        </el-card>
        <el-card shadow="hover" class="mb-4" header="最新公告">
          <div
            v-if="notices.length === 0"
            class="py-6 text-center text-gray-400"
          >
            暂无公告
          </div>
          <ul v-else class="max-h-64 overflow-auto">
            <li
              v-for="n in notices"
              :key="n.id"
              class="cursor-pointer border-b border-gray-100 px-1 py-2 last:border-0 hover:bg-gray-50"
              @click="showNotice(n)"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-[13px]">
                  <el-tag
                    v-if="n.is_top === 1"
                    type="danger"
                    size="small"
                    class="mr-1"
                    >置顶</el-tag
                  >
                  {{ n.title }}
                </span>
                <span class="shrink-0 text-xs text-gray-400">{{
                  n.created_at?.slice(0, 10)
                }}</span>
              </div>
            </li>
          </ul>
        </el-card>
      </el-col>
    </el-row>

    <!-- 公告详情 -->
    <el-dialog
      v-model="noticeVisible"
      :title="noticeDetail.title"
      width="520px"
    >
      <p class="mb-2 text-xs text-gray-400">
        发布时间：{{ noticeDetail.created_at }}
      </p>
      <div class="whitespace-pre-wrap text-sm leading-relaxed">
        {{ noticeDetail.content }}
      </div>
    </el-dialog>
  </div>
</template>
