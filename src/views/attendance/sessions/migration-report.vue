<script setup lang="ts">
// 课次回填报告页
//
// ★ 口径（拍板补充 3）：页面展示即可（可筛选列表：班级 / 日期 / 原因 + 一键转待办），不另做 xlsx 下载。
// ★ "已匹配 = 总量 − 未匹配"（报告表只落未匹配）。
// ★ 一键转待办调用既有 POST /api/todos（后端），成功写回 todo_id 并刷新该行状态。
// ★ 接口全部走 @/api/sessions；无 axios / $route / localStorage。
import { ref, reactive, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { getAllClasses } from "@/api/attendance";
import { getMigrationReport, migrationReportToTodo } from "@/api/sessions";
import { AppPageHeader } from "@/components/AppPageHeader";
import { AppEmpty } from "@/components/AppEmpty";

defineOptions({
  name: "SessionMigrationReport"
});

const DATA_TYPES = ["考勤", "课消", "课评"];
const REASONS = [
  "当天无对应课次",
  "同日同课程多个课次，无法唯一确定",
  "课程为空"
];

const loading = ref(false);
const dataList = ref<any[]>([]);
const classOptions = ref<any[]>([]);
const summary = ref<any>({ matched: 0, unmatched: 0, total: 0, fail_rate: 0 });

const searchForm = reactive({
  data_type: "",
  class_id: null as number | null,
  dateRange: null as [string, string] | null,
  reason: ""
});
const pagination = reactive({ page: 1, pageSize: 10, total: 0 });

function loadClasses() {
  getAllClasses().then((res: any) => {
    if (res.success) classOptions.value = res.data;
  });
}

function loadData() {
  loading.value = true;
  getMigrationReport({
    data_type: searchForm.data_type || undefined,
    class_id: searchForm.class_id ?? undefined,
    date_start: searchForm.dateRange?.[0] || undefined,
    date_end: searchForm.dateRange?.[1] || undefined,
    reason: searchForm.reason || undefined,
    page: pagination.page,
    pageSize: pagination.pageSize
  })
    .then((res: any) => {
      if (res.success) {
        dataList.value = res.data.list;
        pagination.total = res.data.total;
        summary.value = res.data.summary || summary.value;
      }
    })
    .finally(() => (loading.value = false));
}

function handleSearch() {
  pagination.page = 1;
  loadData();
}

function handleReset() {
  Object.assign(searchForm, {
    data_type: "",
    class_id: null,
    dateRange: null,
    reason: ""
  });
  handleSearch();
}

async function toTodo(row: any) {
  if (row.status === "已转待办" && row.todo_id) {
    ElMessage.info("该项已转待办");
    return;
  }
  try {
    await ElMessageBox.confirm(
      "将该未匹配项转为一个待办（指派给管理员）？",
      "转待办确认",
      { type: "info", confirmButtonText: "转待办", cancelButtonText: "取消" }
    );
  } catch {
    return;
  }
  const res: any = await migrationReportToTodo(row.id);
  if (res.success) {
    ElMessage.success("已转为待办");
    loadData();
  }
}

onMounted(() => {
  loadClasses();
  loadData();
});
</script>

<template>
  <div class="app-page">
    <AppPageHeader
      title="课次回填报告"
      description="历史考勤 / 课消 / 课评 反查课次的结果；未匹配项可一键转待办"
    >
      <template #meta>
        <el-tag v-if="summary.unmatched > 0" type="danger" size="small">
          未匹配 {{ summary.unmatched }}
        </el-tag>
        <el-tag v-else type="success" size="small">全部匹配</el-tag>
      </template>
    </AppPageHeader>

    <div class="stat-grid mb-4">
      <div class="stat-card stat-card--success">
        <div class="stat-card__top">
          <span class="stat-card__label">已匹配</span>
        </div>
        <div class="metric-value">{{ summary.matched }}</div>
      </div>
      <div class="stat-card stat-card--danger">
        <div class="stat-card__top">
          <span class="stat-card__label">未匹配</span>
        </div>
        <div class="metric-value">{{ summary.unmatched }}</div>
      </div>
      <div class="stat-card stat-card--warning">
        <div class="stat-card__top">
          <span class="stat-card__label">回填失败率</span>
        </div>
        <div class="metric-value">{{ summary.fail_rate }}%</div>
      </div>
      <div class="stat-card stat-card--brand">
        <div class="stat-card__top">
          <span class="stat-card__label">源数据总量</span>
        </div>
        <div class="metric-value">{{ summary.total }}</div>
      </div>
    </div>

    <div class="page-card page-card--flush">
      <div class="page-toolbar">
        <el-select
          v-model="searchForm.data_type"
          placeholder="数据类型"
          clearable
          class="!w-32"
          @change="handleSearch"
        >
          <el-option v-for="t in DATA_TYPES" :key="t" :label="t" :value="t" />
        </el-select>
        <el-select
          v-model="searchForm.class_id"
          placeholder="班级"
          clearable
          class="!w-44"
          @change="handleSearch"
        >
          <el-option
            v-for="c in classOptions"
            :key="c.id"
            :label="c.name"
            :value="c.id"
          />
        </el-select>
        <el-date-picker
          v-model="searchForm.dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          class="!w-64"
          @change="handleSearch"
        />
        <el-select
          v-model="searchForm.reason"
          placeholder="原因"
          clearable
          class="!w-52"
          @change="handleSearch"
        >
          <el-option v-for="r in REASONS" :key="r" :label="r" :value="r" />
        </el-select>
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
      </div>

      <el-table v-loading="loading" :data="dataList" border stripe>
        <el-table-column label="数据类型" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.data_type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="班级" min-width="140">
          <template #default="{ row }">{{ row.class_name || "-" }}</template>
        </el-table-column>
        <el-table-column label="课程" min-width="120">
          <template #default="{ row }">{{ row.course_name || "-" }}</template>
        </el-table-column>
        <el-table-column label="日期" min-width="110">
          <template #default="{ row }">{{ row.date || "-" }}</template>
        </el-table-column>
        <el-table-column label="学员" min-width="100">
          <template #default="{ row }">{{ row.student_name || "-" }}</template>
        </el-table-column>
        <el-table-column label="原因" min-width="200">
          <template #default="{ row }">{{ row.reason || "-" }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag
              size="small"
              :type="row.status === '已转待办' ? 'success' : 'danger'"
            >
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" align="center" fixed="right">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              :disabled="row.status === '已转待办'"
              @click="toTodo(row)"
            >
              转待办
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <AppEmpty title="全部回填成功" description="没有需要处理的未匹配项" />
        </template>
      </el-table>

      <div class="page-card__footer">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :total="pagination.total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          background
          @size-change="loadData"
          @current-change="loadData"
        />
      </div>
    </div>
  </div>
</template>
