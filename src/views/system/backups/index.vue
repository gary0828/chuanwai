<script setup lang="ts">
import { ref, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  getBackupList,
  createBackup,
  restoreBackup,
  deleteBackup
} from "@/api/attendance";

defineOptions({
  name: "SysBackups"
});

const loading = ref(false);
const backingUp = ref(false);
const backupList = ref<any[]>([]);

function loadData() {
  loading.value = true;
  getBackupList()
    .then((res: any) => {
      if (res.success) backupList.value = res.data;
    })
    .finally(() => (loading.value = false));
}

function formatSize(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function handleBackup() {
  backingUp.value = true;
  createBackup()
    .then((res: any) => {
      if (res.success) {
        ElMessage.success(`备份成功：${res.data.file}`);
        loadData();
      }
    })
    .finally(() => (backingUp.value = false));
}

function handleRestore(row: any) {
  ElMessageBox.confirm(
    `确定用备份「${row.file}」恢复数据吗？恢复后服务将自动重启，当前数据会被备份文件覆盖！`,
    "危险操作",
    {
      type: "warning",
      confirmButtonText: "确认恢复",
      cancelButtonText: "取消"
    }
  )
    .then(() => {
      restoreBackup(row.file).then((res: any) => {
        if (res.success) {
          ElMessage.success(res.message || "恢复成功");
          // 服务即将重启，稍后刷新
          setTimeout(() => loadData(), 4000);
        }
      });
    })
    .catch(() => {});
}

function handleDelete(row: any) {
  ElMessageBox.confirm(`确定删除备份「${row.file}」吗？`, "提示", {
    type: "warning",
    confirmButtonText: "删除",
    cancelButtonText: "取消"
  })
    .then(() => {
      deleteBackup(row.file).then((res: any) => {
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
  <div class="p-4">
    <el-card shadow="never">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-medium">数据备份</span>
          <el-button type="primary" :loading="backingUp" @click="handleBackup"
            >立即备份</el-button
          >
        </div>
      </template>

      <p class="mb-4 text-sm text-gray-400">
        系统每 6 小时自动备份一次（保留最近 20
        份）。也可点击「立即备份」手动创建；恢复后服务会自动重启加载备份数据。
      </p>

      <el-table v-loading="loading" :data="backupList" border stripe>
        <el-table-column type="index" label="#" width="60" align="center" />
        <el-table-column prop="file" label="备份文件" min-width="220" />
        <el-table-column label="大小" width="120" align="center">
          <template #default="{ row }">{{ formatSize(row.size) }}</template>
        </el-table-column>
        <el-table-column prop="created_at" label="备份时间" min-width="170" />
        <el-table-column label="操作" width="180" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="warning" @click="handleRestore(row)"
              >恢复</el-button
            >
            <el-button link type="danger" @click="handleDelete(row)"
              >删除</el-button
            >
          </template>
        </el-table-column>
        <template #empty>
          <el-empty
            description="暂无备份，点击右上角「立即备份」创建"
            :image-size="60"
          />
        </template>
      </el-table>
    </el-card>
  </div>
</template>
