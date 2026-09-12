<script setup lang="ts">
import EpPrinter from "~icons/ep/printer";
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage } from "element-plus";
import { getConsumptionStats } from "@/api/teaching";
import { useUserStoreHook } from "@/store/modules/user";

defineOptions({
  name: "FinanceConsumption"
});

const dimension = ref<"teacher" | "course" | "student">("teacher");
const range = ref<[string, string] | null>(null);

const loading = ref(false);
const list = ref<any[]>([]);
const summary = reactive({
  consumed_total: 0,
  refunded_total: 0,
  revenue_recognized: 0,
  can_see_amount: undefined as boolean | undefined
});

/* 金额可见性：优先使用接口返回的 can_see_amount；未返回时按角色判断（仅 admin 可见） */
const isAdmin = computed(() => useUserStoreHook().roles.includes("admin"));
const canSeeAmount = computed(() => {
  if (typeof summary.can_see_amount === "boolean")
    return summary.can_see_amount;
  return isAdmin.value;
});

function query() {
  loading.value = true;
  const params: Record<string, any> = { dimension: dimension.value };
  if (range.value && range.value.length === 2) {
    params.start = range.value[0];
    params.end = range.value[1];
  }
  getConsumptionStats(params)
    .then((res: any) => {
      if (res.success) {
        list.value = res.data.list || [];
        Object.assign(summary, res.data.summary || {});
      } else {
        ElMessage.error(res.message || "加载课消统计失败");
      }
    })
    .finally(() => (loading.value = false));
}

function reset() {
  dimension.value = "teacher";
  range.value = null;
  query();
}

function n(v: any) {
  return Number(v ?? 0);
}

/* 千分位金额显示 */
function fmtMoney(v: any) {
  return `¥${(Number(v) || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function handlePrint() {
  window.print();
}

onMounted(query);
</script>

<template>
  <div class="p-4">
    <!-- 筛选 -->
    <el-card shadow="never" class="mb-4">
      <div class="flex flex-wrap items-center gap-2">
        <el-radio-group v-model="dimension" @change="query">
          <el-radio-button value="teacher">按老师</el-radio-button>
          <el-radio-button value="course">按课程</el-radio-button>
          <el-radio-button value="student">按学员</el-radio-button>
        </el-radio-group>
        <el-date-picker
          v-model="range"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          class="!w-60"
        />
        <el-button type="primary" @click="query">查询</el-button>
        <el-button @click="reset">重置</el-button>
        <div class="flex-1" />
        <el-button type="primary" plain @click="handlePrint">
          <el-icon class="mr-1"><EpPrinter /></el-icon>
          打印 / 导出
        </el-button>
      </div>
    </el-card>

    <div id="printConsumption">
      <!-- 汇总卡片 -->
      <el-row :gutter="16" class="mb-4">
        <el-col :xs="12" :sm="8" :md="canSeeAmount ? 8 : 12">
          <el-card shadow="never" class="text-center">
            <div class="text-sm text-gray-500">总消耗课时</div>
            <div class="mt-1 text-2xl font-bold text-blue-600">
              {{ summary.consumed_total }}
            </div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="8" :md="canSeeAmount ? 8 : 12">
          <el-card shadow="never" class="text-center">
            <div class="text-sm text-gray-500">回补课时</div>
            <div class="mt-1 text-2xl font-bold text-amber-600">
              {{ summary.refunded_total }}
            </div>
          </el-card>
        </el-col>
        <el-col v-if="canSeeAmount" :xs="24" :sm="8" :md="8">
          <el-card shadow="never" class="text-center">
            <div class="text-sm text-gray-500">课消收入确认金额</div>
            <div class="mt-1 text-2xl font-bold text-green-600">
              {{ fmtMoney(summary.revenue_recognized) }}
            </div>
          </el-card>
        </el-col>
      </el-row>

      <!-- 明细表格（列随维度切换） -->
      <el-card shadow="never">
        <el-table v-loading="loading" :data="list" border stripe>
          <template v-if="dimension === 'teacher'">
            <el-table-column prop="teacher_name" label="老师" min-width="110" />
            <el-table-column prop="class_name" label="班级" min-width="130" />
          </template>
          <template v-else-if="dimension === 'course'">
            <el-table-column prop="course_name" label="课程" min-width="160" />
          </template>
          <template v-else>
            <el-table-column prop="student_no" label="学号" min-width="110" />
            <el-table-column prop="name" label="姓名" min-width="90" />
            <el-table-column prop="class_name" label="班级" min-width="130" />
          </template>

          <el-table-column label="消耗课时" width="100" align="center">
            <template #default="{ row }">{{
              n(row.consumed ?? row.consumed_hours)
            }}</template>
          </el-table-column>
          <el-table-column label="回补课时" width="100" align="center">
            <template #default="{ row }">{{
              n(row.refunded ?? row.refunded_hours)
            }}</template>
          </el-table-column>

          <template v-if="dimension === 'teacher'">
            <el-table-column label="净消耗" width="100" align="center">
              <template #default="{ row }">
                {{
                  n(row.consumed ?? row.consumed_hours) -
                  n(row.refunded ?? row.refunded_hours)
                }}
              </template>
            </el-table-column>
          </template>
          <template v-else-if="dimension === 'course'">
            <el-table-column
              prop="student_count"
              label="学员数"
              width="90"
              align="center"
            />
          </template>
          <template v-else>
            <el-table-column
              prop="total_hours"
              label="总课时"
              width="90"
              align="center"
            />
            <el-table-column
              prop="remain_hours"
              label="剩余课时"
              width="90"
              align="center"
            />
          </template>

          <template #empty>
            <el-empty description="该区间暂无课时消耗数据" :image-size="60" />
          </template>
        </el-table>
      </el-card>
    </div>
  </div>
</template>

<style>
/* 打印：仅输出 #printConsumption 区域 */
@media print {
  body * {
    visibility: hidden;
  }
  #printConsumption,
  #printConsumption * {
    visibility: visible;
  }
  #printConsumption {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    padding: 0;
  }
}
</style>
