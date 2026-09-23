<script setup lang="ts">
// 节次时间表配置页（1–8 节 起止时间）
//
// ★ 节次固定 1–8（Q3 不放宽）。
// ★ 口径：生成课次时把这里的 start_time/end_time **快照**写入课次；
//   日后改此表不会回写历史课次（历史不可篡改）。
// ★ 接口全部走 @/api/sessions；无 axios / $route / localStorage。
import { ref, onMounted } from "vue";
import { ElMessage } from "element-plus";
import { getPeriodTimes, savePeriodTimes } from "@/api/sessions";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "PeriodTimes"
});

const PERIODS = Array.from({ length: 8 }, (_, i) => i + 1);

const loading = ref(false);
const saving = ref(false);
const rows = ref<any[]>([]);

/** 用 1–8 补全（后端可能尚未配置某些节次） */
function buildRows(list: any[]) {
  const map: Record<number, any> = {};
  list.forEach(r => (map[Number(r.period)] = r));
  rows.value = PERIODS.map(p => ({
    period: p,
    start_time: map[p]?.start_time || "",
    end_time: map[p]?.end_time || "",
    label: map[p]?.label || `第${p}节`
  }));
}

function load() {
  loading.value = true;
  getPeriodTimes()
    .then((res: any) => {
      if (res.success) buildRows(res.data || []);
    })
    .finally(() => (loading.value = false));
}

async function save() {
  saving.value = true;
  try {
    const res: any = await savePeriodTimes({
      items: rows.value.map(r => ({
        period: r.period,
        start_time: r.start_time || "",
        end_time: r.end_time || "",
        label: r.label || ""
      }))
    });
    if (res.success) {
      ElMessage.success("节次时间已保存");
      load();
    }
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="app-page">
    <AppPageHeader
      title="节次时间"
      description="配置每日 1–8 节的起止时间；生成课次时据此写入起止时间快照"
    >
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </AppPageHeader>

    <div class="page-card">
      <div class="page-toolbar">
        <span class="page-hint">
          修改后仅影响此后新生成的课次，已有课次的时间不会被回写
        </span>
      </div>

      <el-table v-loading="loading" :data="rows" border stripe>
        <el-table-column label="节次" width="110" align="center">
          <template #default="{ row }">第 {{ row.period }} 节</template>
        </el-table-column>
        <el-table-column label="开始时间" min-width="160">
          <template #default="{ row }">
            <el-time-picker
              v-model="row.start_time"
              value-format="HH:mm"
              format="HH:mm"
              placeholder="HH:mm"
              class="!w-32"
            />
          </template>
        </el-table-column>
        <el-table-column label="结束时间" min-width="160">
          <template #default="{ row }">
            <el-time-picker
              v-model="row.end_time"
              value-format="HH:mm"
              format="HH:mm"
              placeholder="HH:mm"
              class="!w-32"
            />
          </template>
        </el-table-column>
        <el-table-column label="显示名" min-width="160">
          <template #default="{ row }">
            <el-input
              v-model="row.label"
              size="small"
              placeholder="如：第1节（留空回落默认）"
              class="!w-48"
            />
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>
