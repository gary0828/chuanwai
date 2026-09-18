<script setup lang="ts">
import { ref, onMounted } from "vue";
import { getBusinessStatistics } from "@/api/attendance";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "FinanceBusiness"
});

const loading = ref(false);
const overview = ref<any>({});
const revenueByMonth = ref<any[]>([]);
const revenueByCourse = ref<any[]>([]);
const channelStats = ref<any[]>([]);

function fmtMoney(v: any) {
  return `¥${(Number(v) || 0).toFixed(2)}`;
}

function loadData() {
  loading.value = true;
  getBusinessStatistics()
    .then((res: any) => {
      if (res.success) {
        overview.value = res.data.overview || {};
        revenueByMonth.value = res.data.revenue_by_month || [];
        revenueByCourse.value = res.data.revenue_by_course || [];
        channelStats.value = res.data.channel_stats || [];
      }
    })
    .finally(() => (loading.value = false));
}

function handlePrint() {
  window.print();
}

onMounted(loadData);
</script>

<template>
  <div class="app-page">
    <AppPageHeader title="经营报表" description="营收、招生与课消的经营口径汇总" />
    <div class="mb-4 flex items-center gap-2">
      <span class="text-sm text-gray-500"
        >机构经营总览：招生转化 / 营收 / 续班 / 在读</span
      >
      <div class="flex-1" />
      <el-button type="primary" @click="loadData">刷新</el-button>
      <el-button type="primary" plain @click="handlePrint"
        >打印 / 导出</el-button
      >
    </div>

    <div id="printBusiness" v-loading="loading">
      <!-- 总览卡片 -->
      <el-row :gutter="16" class="mb-4">
        <el-col :xs="12" :sm="8" :md="4">
          <el-card shadow="never" class="text-center">
            <div class="text-sm text-gray-500">在读学员</div>
            <div class="text-2xl font-bold text-blue-600">
              {{ overview.active_students }}
              <span class="text-sm font-normal text-gray-400"
                >/ {{ overview.total_students }}</span
              >
            </div>
            <div class="text-xs text-gray-400 mt-1">
              在读率 {{ overview.enrollment_rate }}%
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="4">
          <el-card shadow="never" class="text-center">
            <div class="text-sm text-gray-500">在读订单</div>
            <div class="text-2xl font-bold text-indigo-600">
              {{ overview.active_orders }}
            </div>
            <div class="text-xs text-gray-400 mt-1">有效在读报班</div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="4">
          <el-card shadow="never" class="text-center">
            <div class="text-sm text-gray-500">本月实收</div>
            <div class="text-2xl font-bold text-green-600">
              {{ fmtMoney(overview.month_revenue) }}
            </div>
            <div class="text-xs text-gray-400 mt-1">
              累计 {{ fmtMoney(overview.total_revenue) }}
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="4">
          <el-card shadow="never" class="text-center">
            <div class="text-sm text-gray-500">招生线索</div>
            <div class="text-2xl font-bold text-amber-600">
              {{ overview.total_leads }}
            </div>
            <div class="text-xs text-gray-400 mt-1">
              已转化 {{ overview.converted_leads }}（{{
                overview.conversion_rate
              }}%）
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="4">
          <el-card shadow="never" class="text-center">
            <div class="text-sm text-gray-500">续班率（近6月）</div>
            <div class="text-2xl font-bold text-purple-600">
              {{ overview.renewal_rate }}%
            </div>
            <div class="text-xs text-gray-400 mt-1">
              续报 {{ overview.renewed_6m }} / 结业 {{ overview.graduated_6m }}
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="4">
          <el-card shadow="never" class="text-center">
            <div class="text-sm text-gray-500">线索转化率</div>
            <div class="text-2xl font-bold text-rose-600">
              {{ overview.conversion_rate }}%
            </div>
            <div class="text-xs text-gray-400 mt-1">
              已转化 {{ overview.converted_leads }} 条
            </div>
          </el-card>
        </el-col>
      </el-row>

      <!-- 报表区 -->
      <el-row :gutter="16">
        <el-col :xs="24" :lg="12">
          <el-card shadow="never" class="mb-4">
            <template #header>
              <span class="font-medium">近 12 个月实收趋势</span>
            </template>
            <el-table :data="revenueByMonth" border stripe size="small">
              <el-table-column prop="period" label="月份" min-width="110" />
              <el-table-column
                prop="cnt"
                label="收费笔数"
                width="100"
                align="center"
              />
              <el-table-column label="实收金额" min-width="130" align="right">
                <template #default="{ row }">
                  <span class="font-medium text-green-600">{{
                    fmtMoney(row.total)
                  }}</span>
                </template>
              </el-table-column>
              <template #empty>
                <el-empty description="暂无营收数据" :image-size="50" />
              </template>
            </el-table>
          </el-card>
        </el-col>
        <el-col :xs="24" :lg="12">
          <el-card shadow="never" class="mb-4">
            <template #header>
              <span class="font-medium">近 12 个月按课程实收</span>
            </template>
            <el-table :data="revenueByCourse" border stripe size="small">
              <el-table-column
                prop="course_name"
                label="课程"
                min-width="150"
              />
              <el-table-column
                prop="cnt"
                label="收费笔数"
                width="100"
                align="center"
              />
              <el-table-column label="实收金额" min-width="130" align="right">
                <template #default="{ row }">
                  <span class="font-medium text-green-600">{{
                    fmtMoney(row.total)
                  }}</span>
                </template>
              </el-table-column>
              <template #empty>
                <el-empty description="暂无营收数据" :image-size="50" />
              </template>
            </el-table>
          </el-card>
        </el-col>
      </el-row>

      <el-card shadow="never">
        <template #header>
          <span class="font-medium">招生渠道转化统计</span>
        </template>
        <el-table :data="channelStats" border stripe size="small">
          <el-table-column prop="source" label="来源渠道" min-width="130" />
          <el-table-column
            prop="total"
            label="线索数"
            width="110"
            align="center"
          />
          <el-table-column
            prop="converted"
            label="已转化"
            width="110"
            align="center"
          />
          <el-table-column label="转化率" min-width="130" align="center">
            <template #default="{ row }">
              <el-progress
                :percentage="row.conversion_rate"
                :stroke-width="14"
                :text-inside="true"
                :format="(p: number) => p + '%'"
                :status="
                  row.conversion_rate >= 50
                    ? 'success'
                    : row.conversion_rate > 0
                      ? 'warning'
                      : 'exception'
                "
              />
            </template>
          </el-table-column>
          <template #empty>
            <el-empty description="暂无招生线索数据" :image-size="50" />
          </template>
        </el-table>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
@media print {
  body * {
    visibility: hidden;
  }
  #printBusiness,
  #printBusiness * {
    visibility: visible;
  }
  #printBusiness {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
  }
}
</style>
