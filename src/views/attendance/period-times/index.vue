<script setup lang="ts">
// 节次时间表配置页（★ v24 起**节次可自由增删**，不再是固定 1–8）
//
// 背景：校区反馈「机构不是学校，不能像学校一样固定 8 节课」→
//   节次数 = 本页的行数（增加一节 / 删除一节），时间与显示名都可自定义。
//
// ★ 口径：生成课次时把这里的 start_time/end_time **快照**写入课次；
//   日后改此表不会回写历史课次（历史不可篡改）。
// ★ 删除保护：该节次下有课次或排课模板时**拒绝删除**，提示里说明在哪用了。
// ★ 接口全部走 @/api/sessions；无 axios / $route / localStorage。
import { ref, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  getPeriodTimes,
  savePeriodTimes,
  createPeriodTime,
  deletePeriodTime
} from "@/api/sessions";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "PeriodTimes"
});

const loading = ref(false);
const saving = ref(false);
const adding = ref(false);
const rows = ref<any[]>([]);

/** 直接采用后端的实际配置（有几节就几行）—— v24 起不再用固定节次补全 */
function load() {
  loading.value = true;
  getPeriodTimes()
    .then((res: any) => {
      if (res.success) rows.value = res.data || [];
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

/** 新增一节（自动接在最后一节之后） */
async function addPeriod() {
  adding.value = true;
  try {
    const res: any = await createPeriodTime();
    if (res.success) {
      ElMessage.success(`已增加第 ${res.data?.period} 节，请填写时间后保存`);
      load();
    }
  } finally {
    adding.value = false;
  }
}

/** 删除一节（后端在有课次/排课引用时会拒绝并说明） */
function removePeriod(row: any) {
  ElMessageBox.confirm(
    `确定删除「${row.label || `第${row.period}节`}」吗？若该节次下已有课程安排，系统会拒绝并告诉你在哪用了。`,
    "删除确认",
    { type: "warning", confirmButtonText: "确认删除", cancelButtonText: "取消" }
  )
    .then(() => {
      deletePeriodTime(row.period).then((res: any) => {
        if (res.success) {
          ElMessage.success("已删除该节次");
          load();
        }
      });
    })
    .catch(() => {});
}

onMounted(load);
</script>

<template>
  <div class="app-page">
    <AppPageHeader
      title="节次时间"
      description="按机构自己的作息配置节次：数量、起止时间、显示名都可自定义；生成课次时据此写入时间快照"
    >
      <el-button :loading="adding" @click="addPeriod">增加一节</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </AppPageHeader>

    <div class="page-card">
      <div class="page-toolbar">
        <span class="page-hint">
          当前共 {{ rows.length }} 节；修改后仅影响此后新生成的课次，已有课次的时间不会被回写
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
        <el-table-column label="显示名" min-width="180">
          <template #default="{ row }">
            <el-input
              v-model="row.label"
              size="small"
              placeholder="如：上午第一节（留空回落「第N节」）"
              class="!w-52"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="danger" @click="removePeriod(row)"
              >删除</el-button
            >
          </template>
        </el-table-column>
        <template #empty>
          <el-empty
            description="还没有节次，点右上角「增加一节」开始配置"
            :image-size="60"
          />
        </template>
      </el-table>

      <p class="page-hint mt-3">
        提示：删除某节次后，其余节次号**不会自动前移**（避免改变已有课次的节次含义）。
      </p>
    </div>
  </div>
</template>
