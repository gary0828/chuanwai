<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  getNotificationList,
  markNotificationRead,
  markAllNotificationsRead
} from "@/api/attendance";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "FamilyNotifications"
});

const loading = ref(false);
const dataList = ref<any[]>([]);
const unreadCount = ref(0);
const searchForm = reactive({
  keyword: "",
  is_read: "" as "" | "0" | "1",
  dateRange: null as [string, string] | null
});
const pagination = reactive({ page: 1, pageSize: 10, total: 0 });

const TYPE_TAG = { 考勤缺勤: "danger" } as Record<string, string>;

function loadData() {
  loading.value = true;
  const params: Record<string, any> = {
    keyword: searchForm.keyword,
    is_read: searchForm.is_read,
    page: pagination.page,
    pageSize: pagination.pageSize
  };
  if (searchForm.dateRange && searchForm.dateRange.length === 2) {
    params.date_start = searchForm.dateRange[0];
    params.date_end = searchForm.dateRange[1];
  }
  getNotificationList(params)
    .then((res: any) => {
      if (res.success) {
        dataList.value = res.data.list;
        pagination.total = res.data.total;
        unreadCount.value = res.data.unreadCount || 0;
      }
    })
    .finally(() => (loading.value = false));
}

function handleSearch() {
  pagination.page = 1;
  loadData();
}

function handleReset() {
  Object.assign(searchForm, { keyword: "", is_read: "", dateRange: null });
  handleSearch();
}

function handleRead(row: any) {
  if (row.is_read === 1) return;
  markNotificationRead(row.id).then((res: any) => {
    if (res.success) {
      ElMessage.success("已标记为已读");
      loadData();
    } else {
      ElMessage.error(res.message || "操作失败");
    }
  });
}

function handleReadAll() {
  ElMessageBox.confirm("确定将当前可见范围的全部通知标记为已读？", "全部已读", {
    type: "info",
    confirmButtonText: "全部已读",
    cancelButtonText: "取消"
  })
    .then(() => {
      markAllNotificationsRead().then((res: any) => {
        if (res.success) {
          ElMessage.success("已全部标记为已读");
          loadData();
        } else {
          ElMessage.error(res.message || "操作失败");
        }
      });
    })
    .catch(() => {});
}

onMounted(loadData);
</script>

<template>
  <div class="app-page">
    <AppPageHeader title="通知记录" description="已发送的家校通知存档" />
    <el-card shadow="never">
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <el-input
          v-model="searchForm.keyword"
          placeholder="学员姓名 / 学号"
          clearable
          class="!w-52"
          @keyup.enter="handleSearch"
        />
        <el-select
          v-model="searchForm.is_read"
          placeholder="已读状态"
          clearable
          class="!w-32"
        >
          <el-option label="未读" value="0" />
          <el-option label="已读" value="1" />
        </el-select>
        <el-date-picker
          v-model="searchForm.dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          class="!w-60"
        />
        <el-button type="primary" @click="handleSearch">搜索</el-button>
        <el-button @click="handleReset">重置</el-button>
        <div class="flex-1" />
        <el-tag v-if="unreadCount > 0" type="danger" effect="plain"
          >未读 {{ unreadCount }} 条</el-tag
        >
        <el-button
          type="primary"
          plain
          :disabled="unreadCount === 0"
          @click="handleReadAll"
          >全部标记已读</el-button
        >
      </div>

      <el-table v-loading="loading" :data="dataList" border stripe>
        <el-table-column type="index" label="#" width="60" align="center" />
        <el-table-column label="学员" min-width="150">
          <template #default="{ row }">
            <span class="font-medium">{{ row.student_name }}</span>
            <span class="text-gray-400 ml-1">{{ row.student_no }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="class_name" label="班级" min-width="120">
          <template #default="{ row }">{{ row.class_name || "—" }}</template>
        </el-table-column>
        <el-table-column label="类型" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="TYPE_TAG[row.type] || 'primary'" size="small">{{
              row.type
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="130" />
        <el-table-column
          prop="content"
          label="内容"
          min-width="260"
          show-overflow-tooltip
        />
        <el-table-column prop="date" label="关联日期" width="110" />
        <el-table-column label="通知家长" min-width="110">
          <template #default="{ row }">{{ row.parent_name || "—" }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.is_read === 1 ? 'info' : 'danger'" size="small">
              {{ row.is_read === 1 ? "已读" : "未读" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="生成时间" width="170" />
        <el-table-column label="操作" width="110" align="center" fixed="right">
          <template #default="{ row }">
            <el-button
              type="primary"
              link
              :disabled="row.is_read === 1"
              @click="handleRead(row)"
            >
              {{ row.is_read === 1 ? "已读" : "标记已读" }}
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无通知记录" :image-size="60" />
        </template>
      </el-table>

      <div class="mt-4 flex justify-end">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :total="pagination.total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @size-change="handleSearch"
          @current-change="loadData"
        />
      </div>
    </el-card>
  </div>
</template>
