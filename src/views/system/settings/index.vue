<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { ElMessage } from "element-plus";
import { getSettings, updateSettings } from "@/api/attendance";

defineOptions({
  name: "SysSettings"
});

const loading = ref(false);
const saving = ref(false);

const form = reactive({
  warn_rate: 80,
  warn_consecutive: 3,
  warn_days: 14
});

function loadData() {
  loading.value = true;
  getSettings()
    .then((res: any) => {
      if (res.success) {
        const s = res.data || {};
        form.warn_rate = Number(s.warn_rate ?? 80);
        form.warn_consecutive = Number(s.warn_consecutive ?? 3);
        form.warn_days = Number(s.warn_days ?? 14);
      }
    })
    .finally(() => (loading.value = false));
}

function handleSave() {
  saving.value = true;
  updateSettings({
    warn_rate: form.warn_rate,
    warn_consecutive: form.warn_consecutive,
    warn_days: form.warn_days
  })
    .then((res: any) => {
      if (res.success) {
        ElMessage.success("保存成功");
      }
    })
    .finally(() => (saving.value = false));
}

onMounted(loadData);
</script>

<template>
  <div class="p-4">
    <el-card v-loading="loading" shadow="never" class="max-w-3xl">
      <template #header>
        <span class="font-medium">缺勤预警参数</span>
      </template>
      <p class="mb-4 text-sm text-gray-400">
        以下参数作用于「统计报表」中的缺勤预警：达到阈值的学生将被标记为预警对象。
      </p>
      <el-form :model="form" label-width="160px" class="max-w-xl">
        <el-form-item label="出勤率预警阈值（%）">
          <el-input-number v-model="form.warn_rate" :min="1" :max="100" />
          <span class="ml-2 text-sm text-gray-400">低于该出勤率视为预警</span>
        </el-form-item>
        <el-form-item label="连续缺勤天数">
          <el-input-number v-model="form.warn_consecutive" :min="1" :max="30" />
          <span class="ml-2 text-sm text-gray-400"
            >连续缺勤达到该天数触发预警</span
          >
        </el-form-item>
        <el-form-item label="统计窗口（天）">
          <el-input-number v-model="form.warn_days" :min="1" :max="90" />
          <span class="ml-2 text-sm text-gray-400">预警统计的时间范围</span>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="handleSave"
            >保存</el-button
          >
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>
