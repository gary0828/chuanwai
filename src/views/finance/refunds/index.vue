<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  getFinanceRefunds,
  approveFinanceRefund,
  deleteFinanceRefund
} from "@/api/attendance";
import { useUserStoreHook } from "@/store/modules/user";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "FinanceRefunds"
});

const isAdmin = computed(() => useUserStoreHook().roles.includes("admin"));
const loading = ref(false);
const dataList = ref<any[]>([]);
const searchForm = reactive({ status: "", keyword: "" });
const pagination = reactive({ page: 1, pageSize: 10, total: 0 });

const STATUS_OPTIONS = [
  { label: "待审批", value: "待审批" },
  { label: "通过", value: "通过" },
  { label: "驳回", value: "驳回" }
];
const STATUS_TAG = {
  待审批: "warning",
  通过: "success",
  驳回: "info"
} as Record<string, string>;

function fmtMoney(v: any) {
  return `¥${(Number(v) || 0).toFixed(2)}`;
}

function loadData() {
  loading.value = true;
  const params: Record<string, any> = {
    ...searchForm,
    page: pagination.page,
    pageSize: pagination.pageSize
  };
  getFinanceRefunds(params)
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
  searchForm.status = "";
  searchForm.keyword = "";
  handleSearch();
}

function handleApprove(row: any, status: string) {
  ElMessageBox.confirm(
    `确定「${status}」学员 ${row.student_name} 的退费申请（${fmtMoney(row.amount)}）吗？`,
    "退费审批",
    {
      type: "warning",
      confirmButtonText: `确认${status}`,
      cancelButtonText: "取消"
    }
  )
    .then(() => {
      approveFinanceRefund(row.id, { status }).then((res: any) => {
        if (res.success) {
          ElMessage.success("审批完成");
          loadData();
        }
      });
    })
    .catch(() => {});
}

function handleDelete(row: any) {
  ElMessageBox.confirm(
    `确定删除该退费记录（${row.student_name} ${fmtMoney(row.amount)}）吗？`,
    "提示",
    {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消"
    }
  )
    .then(() => {
      deleteFinanceRefund(row.id).then((res: any) => {
        if (res.success) {
          ElMessage.success("删除成功");
          loadData();
        }
      });
    })
    .catch(() => {});
}

onMounted(loadData);
</script>

<template>
  <div class="app-page">
    <AppPageHeader title="退费管理" description="退费申请与审批；通过后退班" />
    <el-card shadow="never">
      <!-- 筛选 -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-input
          v-model="searchForm.keyword"
          placeholder="学员姓名 / 学号"
          clearable
          class="!w-44"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-select
          v-model="searchForm.status"
          placeholder="审批状态"
          clearable
          class="!w-32"
        >
          <el-option
            v-for="o in STATUS_OPTIONS"
            :key="o.value"
            :label="o.label"
            :value="o.value"
          />
        </el-select>
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
      </div>

      <!-- 表格 -->
      <el-table v-loading="loading" :data="dataList" border stripe>
        <el-table-column type="index" label="#" width="55" align="center" />
        <el-table-column prop="apply_time" label="申请时间" min-width="160" />
        <el-table-column prop="student_no" label="学号" width="110" />
        <el-table-column prop="student_name" label="学员" width="100" />
        <el-table-column prop="class_name" label="班级" min-width="110">
          <template #default="{ row }">{{ row.class_name || "—" }}</template>
        </el-table-column>
        <el-table-column label="退费金额" width="110" align="right">
          <template #default="{ row }">
            <span class="font-medium text-red-500">{{
              fmtMoney(row.amount)
            }}</span>
          </template>
        </el-table-column>
        <el-table-column
          prop="reason"
          label="原因"
          min-width="140"
          show-overflow-tooltip
        >
          <template #default="{ row }">{{ row.reason || "—" }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="STATUS_TAG[row.status] || 'info'" size="small">{{
              row.status
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column
          prop="apply_user_name"
          label="申请人"
          width="100"
          align="center"
        >
          <template #default="{ row }">{{
            row.apply_user_name || "—"
          }}</template>
        </el-table-column>
        <el-table-column label="审批人" width="100" align="center">
          <template #default="{ row }">
            <span>{{ row.approved_name || "—" }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center" fixed="right">
          <template #default="{ row }">
            <template v-if="isAdmin && row.status === '待审批'">
              <el-button link type="success" @click="handleApprove(row, '通过')"
                >通过</el-button
              >
              <el-button link type="info" @click="handleApprove(row, '驳回')"
                >驳回</el-button
              >
            </template>
            <el-button
              v-if="isAdmin"
              link
              type="danger"
              @click="handleDelete(row)"
              >删除</el-button
            >
            <span v-if="!isAdmin" class="text-gray-400">—</span>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty
            description="暂无退费记录，可在报班管理 → 订单详情中提交退费申请"
            :image-size="60"
          />
        </template>
      </el-table>

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
