<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import {
  getRevenueStatistics,
  getArrearsStatistics,
  getLowHoursStatistics
} from "@/api/attendance";

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

function fmtMoney(v: any) {
  return `¥${(Number(v) || 0).toFixed(2)}`;
}

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
});
</script>

<template>
  <div class="p-4">
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
