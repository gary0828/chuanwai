<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { getHoursReconcileList, applyHoursReconcile } from "@/api/attendance";
import { AppPageHeader } from "@/components/AppPageHeader";

defineOptions({
  name: "FinanceHoursReconcile"
});

const loading = ref(false);
const applying = ref(false);
const list = ref<any[]>([]);
const totalGap = ref(0);
const fixableGap = ref(0);

const fixableCount = computed(() => list.value.filter(r => r.fixable).length);
const blockedCount = computed(() => list.value.length - fixableCount.value);

function query() {
  loading.value = true;
  getHoursReconcileList()
    .then((res: any) => {
      if (res.success) {
        list.value = res.data?.list || [];
        totalGap.value = Number(res.data?.total_gap || 0);
        fixableGap.value = Number(res.data?.fixable_gap || 0);
      } else {
        ElMessage.error(res.message || "加载对账清单失败");
      }
    })
    .finally(() => (loading.value = false));
}

function apply(data: object, tip: string) {
  applying.value = true;
  applyHoursReconcile(data)
    .then((res: any) => {
      if (res.success) {
        const fixed = Number(res.data?.fixed || 0);
        // ★ 静默即缺陷：无论补了几节都要给明确反馈（含"补了 0 节"的原因）
        if (fixed > 0) {
          ElMessage.success(`${tip}：已补扣 ${fixed} 课时`);
        } else {
          const reasons = (res.data?.results || [])
            .map((r: any) => r.reason)
            .filter(Boolean);
          ElMessage.warning(
            `${tip}：本次补扣 0 课时${reasons.length ? `（${reasons[0]}）` : ""}`
          );
        }
        query();
      } else {
        ElMessage.error(res.message || "对账失败");
      }
    })
    .finally(() => (applying.value = false));
}

function fixOne(row: any) {
  ElMessageBox.confirm(
    `确认为「${row.student_name}」在课程「${row.course_name}」下补扣 ${row.gap} 课时？\n缺失考勤日期：${row.missing_dates || "—"}`,
    "课时对账",
    { type: "warning", confirmButtonText: "确认补扣", cancelButtonText: "取消" }
  )
    .then(() =>
      apply(
        { student_id: row.student_id, course_id: row.course_id },
        `补扣「${row.student_name} / ${row.course_name}」`
      )
    )
    .catch(() => {});
}

function fixAll() {
  if (!fixableCount.value) {
    ElMessage.info("当前没有可自动补扣的差异");
    return;
  }
  ElMessageBox.confirm(
    `将逐行核对并补扣 ${fixableCount.value} 条差异（合计约 ${fixableGap.value} 课时）。\n对账是幂等的，可重复执行，不会重复扣课时。`,
    "全量对账",
    { type: "warning", confirmButtonText: "开始对账", cancelButtonText: "取消" }
  )
    .then(() => apply({ all: true }, "全量对账"))
    .catch(() => {});
}

onMounted(query);
</script>

<template>
  <div class="app-page">
    <AppPageHeader
      title="课时对账"
      description="核对「出勤考勤」与「已扣课时流水」的差额，并一键补扣"
    />

    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="mb-4"
      title="为什么会有差异？"
      description="旧版扣课时只在「考勤状态发生变化的那一瞬间」执行。若那一刻订单还没有课时包（例如从线索转化自动建的单）、或还没报班，就会漏扣且不会自动补。此处按已有考勤重新核对差额，补扣后不会再重复扣。"
    />

    <el-row :gutter="16" class="mb-4">
      <el-col :xs="12" :sm="8">
        <el-card shadow="never" class="text-center">
          <div class="text-sm text-gray-500">差异笔数</div>
          <div class="mt-1 text-2xl font-bold">{{ list.length }}</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="8">
        <el-card shadow="never" class="text-center">
          <div class="text-sm text-gray-500">待补扣课时合计</div>
          <div class="mt-1 text-2xl font-bold text-red-500">
            {{ totalGap }}
          </div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="8">
        <el-card shadow="never" class="text-center">
          <div class="text-sm text-gray-500">可自动补扣</div>
          <div class="mt-1 text-2xl font-bold text-green-600">
            {{ fixableGap }}
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <el-button
          type="primary"
          :loading="applying"
          :disabled="!fixableCount"
          @click="fixAll"
          >全量对账</el-button
        >
        <el-button :disabled="applying" @click="query">刷新</el-button>
        <div class="flex-1" />
        <span class="text-xs text-gray-500">
          可自动补扣 {{ fixableCount }} 条 ·
          需人工处理 {{ blockedCount }} 条
        </span>
      </div>

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="student_no" label="学号" width="120" />
        <el-table-column prop="student_name" label="学员" width="110" />
        <el-table-column
          prop="course_name"
          label="课程"
          min-width="120"
          show-overflow-tooltip
        />
        <el-table-column
          prop="attend_count"
          label="出勤考勤"
          width="95"
          align="center"
        />
        <el-table-column
          prop="flow_count"
          label="已扣流水"
          width="95"
          align="center"
        />
        <el-table-column label="差额（待补）" width="110" align="center">
          <template #default="{ row }">
            <span class="font-semibold text-red-500">{{ row.gap }}</span>
          </template>
        </el-table-column>
        <el-table-column
          prop="missing_dates"
          label="缺失考勤日期"
          min-width="170"
          show-overflow-tooltip
        />
        <el-table-column label="状态" min-width="180">
          <template #default="{ row }">
            <el-tag v-if="row.fixable" type="success" size="small"
              >可补扣</el-tag
            >
            <el-tooltip v-else :content="row.reason" placement="top">
              <el-tag type="warning" size="small">需人工处理</el-tag>
            </el-tooltip>
            <div v-if="!row.fixable" class="mt-1 text-xs text-gray-400">
              {{ row.reason }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="center">
          <template #default="{ row }">
            <el-button
              type="primary"
              link
              :disabled="!row.fixable || applying"
              @click="fixOne(row)"
              >补扣</el-button
            >
          </template>
        </el-table-column>
        <template #empty>
          <el-empty
            description="没有发现差异：所有出勤考勤都已正确扣课时"
            :image-size="70"
          />
        </template>
      </el-table>
    </el-card>
  </div>
</template>
