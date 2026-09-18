<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { getAuditLogs } from "@/api/attendance";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "SysAuditLogs"
});

const loading = ref(false);
const dataList = ref<any[]>([]);
const searchForm = reactive({ username: "", action: "" });
const dateRange = ref<[string, string] | null>(null);
const pagination = reactive({ page: 1, pageSize: 10, total: 0 });

function loadData() {
  loading.value = true;
  const params: Record<string, any> = {
    ...searchForm,
    page: pagination.page,
    pageSize: pagination.pageSize
  };
  if (dateRange.value && dateRange.value.length === 2) {
    params.start = dateRange.value[0];
    params.end = dateRange.value[1];
  }
  getAuditLogs(params)
    .then((res: any) => {
      if (res.success) {
        dataList.value = res.data.list;
        pagination.total = res.data.total;
      }
    })
    .finally(() => (loading.value = false));
}

function handleSearch() {
  pagination.page = 1;
  loadData();
}

function handleReset() {
  searchForm.username = "";
  searchForm.action = "";
  dateRange.value = null;
  handleSearch();
}

onMounted(loadData);
</script>

<template>
  <div class="app-page">
    <AppPageHeader title="审计日志" description="关键操作的留痕记录" />
    <el-card shadow="never">
      <!-- 筛选 -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-input
          v-model="searchForm.username"
          placeholder="操作人"
          clearable
          class="!w-40"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-input
          v-model="searchForm.action"
          placeholder="操作（如：新增学生）"
          clearable
          class="!w-48"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          class="!w-60"
        />
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
      </div>

      <!-- 表格 -->
      <div class="overflow-x-auto">
        <el-table
          v-loading="loading"
          :data="dataList"
          border
          stripe
          style="min-width: 990px"
        >
          <el-table-column type="index" label="#" width="60" align="center" />
          <el-table-column prop="created_at" label="时间" min-width="170" />
          <el-table-column
            prop="username"
            label="操作人"
            width="110"
            align="center"
          />
          <el-table-column prop="action" label="操作" min-width="120" />
          <el-table-column
            prop="path"
            label="接口"
            min-width="200"
            show-overflow-tooltip
          />
          <el-table-column prop="ip" label="IP" width="200" align="center" />
        </el-table>
      </div>

      <!-- 分页 -->
      <div class="mt-4 flex justify-end">
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
    </el-card>
  </div>
</template>
