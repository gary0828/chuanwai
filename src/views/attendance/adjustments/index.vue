<script setup lang="ts">
import EpRight from "~icons/ep/right";
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useUserStoreHook } from "@/store/modules/user";
import {
  getAdjustmentList,
  approveAdjustment,
  deleteAdjustment,
  getAllClasses
} from "@/api/attendance";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "Adjustments"
});

const isAdmin = computed(() => useUserStoreHook().roles.includes("admin"));

const loading = ref(false);
const list = ref<any[]>([]);
const total = ref(0);
const classOptions = ref<any[]>([]);
const searchForm = reactive({
  status: "",
  class_id: "",
  page: 1,
  pageSize: 10
});

const weekDays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const statusMap: Record<string, any> = {
  待审批: "warning",
  通过: "success",
  驳回: "danger"
};

function loadClasses() {
  getAllClasses().then((res: any) => {
    if (res.success) classOptions.value = res.data;
  });
}

function loadData() {
  loading.value = true;
  const params: any = { page: searchForm.page, pageSize: searchForm.pageSize };
  if (searchForm.status) params.status = searchForm.status;
  if (searchForm.class_id) params.class_id = searchForm.class_id;
  getAdjustmentList(params)
    .then((res: any) => {
      if (res.success) {
        list.value = res.data.list;
        total.value = res.data.total;
      }
    })
    .finally(() => (loading.value = false));
}

function handleSearch() {
  searchForm.page = 1;
  loadData();
}

function handleReset() {
  Object.assign(searchForm, { status: "", class_id: "", page: 1 });
  loadData();
}

function handleApprove(row: any, action: "通过" | "驳回") {
  ElMessageBox.confirm(
    `确定${action}调课申请「${row.course_name}」${weekDays[row.from_day_of_week - 1]}第${row.from_period}节 → ${weekDays[row.to_day_of_week - 1]}第${row.to_period}节 吗？`,
    action === "通过" ? "通过申请" : "驳回申请",
    {
      type: action === "通过" ? "warning" : "info",
      confirmButtonText: action,
      cancelButtonText: "取消"
    }
  )
    .then(() => {
      approveAdjustment(row.id, { action }).then((res: any) => {
        if (res.success) {
          ElMessage.success(`已${action}`);
          loadData();
        }
      });
    })
    .catch(() => {});
}

function handleRevoke(row: any) {
  ElMessageBox.confirm("确定撤销该待审批的调课申请吗？", "提示", {
    type: "warning",
    confirmButtonText: "撤销",
    cancelButtonText: "取消"
  })
    .then(() => {
      deleteAdjustment(row.id).then((res: any) => {
        if (res.success) {
          ElMessage.success("已撤销");
          loadData();
        }
      });
    })
    .catch(() => {});
}

onMounted(() => {
  loadClasses();
  loadData();
});
</script>

<template>
  <div class="app-page">
    <AppPageHeader title="调课审批" description="教师提交调课申请，管理员审批" />
    <el-card shadow="never">
      <!-- 筛选 -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-select
          v-model="searchForm.status"
          placeholder="审批状态"
          clearable
          class="!w-32"
          @change="handleSearch"
        >
          <el-option
            v-for="s in ['待审批', '通过', '驳回']"
            :key="s"
            :label="s"
            :value="s"
          />
        </el-select>
        <el-select
          v-model="searchForm.class_id"
          placeholder="班级"
          clearable
          class="!w-40"
          @change="handleSearch"
        >
          <el-option
            v-for="item in classOptions"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
        <el-button type="primary" @click="handleSearch">查询</el-button>
        <el-button @click="handleReset">重置</el-button>
      </div>

      <div class="overflow-x-auto">
        <el-table
          v-loading="loading"
          :data="list"
          border
          stripe
          style="min-width: 1130px"
        >
          <el-table-column prop="id" label="ID" width="70" align="center" />
          <el-table-column prop="class_name" label="班级" width="130" />
          <el-table-column prop="course_name" label="课程" min-width="120" />
          <el-table-column
            label="原时段 → 目标时段"
            min-width="200"
            align="center"
          >
            <template #default="{ row }">
              <el-tag type="info" size="small"
                >{{ weekDays[row.from_day_of_week - 1] }} 第{{
                  row.from_period
                }}节</el-tag
              >
              <el-icon class="mx-1"><EpRight /></el-icon>
              <el-tag type="primary" size="small"
                >{{ weekDays[row.to_day_of_week - 1] }} 第{{
                  row.to_period
                }}节</el-tag
              >
            </template>
          </el-table-column>
          <el-table-column
            prop="reason"
            label="原因"
            min-width="120"
            show-overflow-tooltip
          />
          <el-table-column prop="apply_user_name" label="申请人" width="100" />
          <el-table-column prop="apply_time" label="申请时间" width="170" />
          <el-table-column label="状态" width="140" align="center">
            <template #default="{ row }">
              <el-tag :type="statusMap[row.status]" size="small">{{
                row.status
              }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" align="center">
            <template #default="{ row }">
              <template v-if="row.status === '待审批'">
                <el-button
                  v-if="isAdmin"
                  link
                  type="success"
                  @click="handleApprove(row, '通过')"
                  >通过</el-button
                >
                <el-button
                  v-if="isAdmin"
                  link
                  type="danger"
                  @click="handleApprove(row, '驳回')"
                  >驳回</el-button
                >
                <el-button link type="info" @click="handleRevoke(row)"
                  >撤销</el-button
                >
              </template>
              <span v-else class="text-[12px] text-gray-400">已处理</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="searchForm.page"
          v-model:page-size="searchForm.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @change="loadData"
        />
      </div>
    </el-card>
  </div>
</template>
